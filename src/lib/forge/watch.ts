/**
 * Folder watch (docs/specs/wave-2.md §16.3): the learner picks the folder that holds `target/` once, and every rebuild of
 * the lab's `.wasm` runs through the same handler a drop calls.
 *
 * Three promises, each enforced here rather than in the UI:
 * - it never reads outside `target/`: the only calls on the picked handle are named lookups down one fixed path
 *   (`target` > `wasm32-unknown-unknown` > `release` > the artifact), never `entries()`, `values()` or `keys()`;
 * - it never uploads: a `File` goes to `onModule` and nowhere else;
 * - the handle is not persisted: nothing here touches storage, so a reload forgets the folder.
 *
 * The watcher is a plain object over structural handle types, so a test drives it with a fake directory and a fake
 * clock. A change is acted on once it holds still for two polls in a row: `cargo build` rewrites the file in place, and
 * a half-written module would be graded as a broken one.
 */

/** The slice of `FileSystemFileHandle` the watcher uses. */
export interface FileHandleLike {
  getFile(): Promise<File>
}

/** The slice of `FileSystemDirectoryHandle` the watcher uses: named lookups only, no listing. */
export interface DirHandleLike {
  readonly name: string
  getDirectoryHandle(name: string): Promise<DirHandleLike>
  getFileHandle(name: string): Promise<FileHandleLike>
}

export const POLL_MS = 1000

/** Where the learner is told the artifact is, as segments below the picked folder. */
export function artifactSegments(artifact: string): string[] {
  const parts = artifact.split('/')
  if (parts.length < 2 || parts[0] !== 'target' || parts.some((p) => p === '' || p === '.' || p === '..' || p.includes('\\'))) {
    throw new Error(`folder watch only reads inside target/: "${artifact}"`)
  }
  return parts
}

/** What the watcher needs of `window`; lib.dom's own type for it differs between TypeScript versions. */
export interface PickerScope {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandleLike>
}

const browserScope = (): PickerScope | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as PickerScope))

/** True where the browser can show a directory picker (Chromium; Firefox and Safari keep drag and drop). */
export function watchSupported(scope: PickerScope | undefined = browserScope()): boolean {
  return !!scope && typeof scope.showDirectoryPicker === 'function'
}

export type WatchStatus =
  /** the picked folder has no `target/`: the learner picked the wrong one, and nothing is being watched */
  | { kind: 'no-target'; folder: string }
  /** `target/` exists, but the artifact is not built yet (or is being rewritten) */
  | { kind: 'waiting'; folder: string }
  /** the artifact was seen and is settling: it will run once it holds still */
  | { kind: 'settling'; folder: string; modified: number }
  /** the artifact ran (or is running) for this `lastModified` */
  | { kind: 'ran'; folder: string; modified: number; runs: number }
  /** the browser withdrew read access; the learner has to pick again */
  | { kind: 'denied'; folder: string }

export interface WatchOptions {
  /** The folder the learner picked. */
  root: DirHandleLike
  /** The lab's artifact, `target/...`, relative to that folder. */
  artifact: string
  /** What a drop calls. Awaited, so a slow grading never overlaps the next run. */
  onModule(file: File): void | Promise<void>
  onStatus?(status: WatchStatus): void
  /** Poll interval; default one second. */
  intervalMs?: number
  /** Whether the tab is visible; the poll does nothing while it is not. Default `document.visibilityState`. */
  visible?(): boolean
  /** Injected clock for tests. */
  timers?: {
    set(fn: () => void, ms: number): unknown
    clear(handle: unknown): void
  }
}

export interface Watcher {
  /** One poll, awaited. The timer calls this; tests call it directly. */
  tick(): Promise<void>
  /** Start polling (and polling again as soon as the tab is visible). Calling it twice does nothing. */
  start(): void
  stop(): void
  readonly status: WatchStatus
}

const errorName = (e: unknown): string => (e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '')

/** A missing folder or file is an ordinary state while a build runs; permission loss is not. */
const isDenied = (e: unknown): boolean => {
  const n = errorName(e)
  return n === 'NotAllowedError' || n === 'SecurityError'
}

type Found = { kind: 'file'; handle: FileHandleLike } | { kind: 'no-target' } | { kind: 'waiting' }

/** Walks `target/…/artifact` by name. The only reads the watcher ever makes on the picked folder. */
async function locate(root: DirHandleLike, segments: string[]): Promise<Found> {
  let dir: DirHandleLike
  try {
    dir = await root.getDirectoryHandle(segments[0])
  } catch (e) {
    if (isDenied(e)) throw e
    return { kind: 'no-target' }
  }
  try {
    for (const seg of segments.slice(1, -1)) dir = await dir.getDirectoryHandle(seg)
    return { kind: 'file', handle: await dir.getFileHandle(segments[segments.length - 1]) }
  } catch (e) {
    if (isDenied(e)) throw e
    return { kind: 'waiting' }
  }
}

export function createWatcher(opts: WatchOptions): Watcher {
  const segments = artifactSegments(opts.artifact)
  const interval = opts.intervalMs ?? POLL_MS
  const visible = opts.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const timers = opts.timers ?? {
    set: (fn, ms) => setInterval(fn, ms),
    clear: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  }
  const folder = opts.root.name

  let status: WatchStatus = { kind: 'waiting', folder }
  let handle: unknown = null
  let running = false
  let stopped = false
  let polling = false
  let runs = 0
  /** The last `lastModified:size` seen, and the last one that ran. */
  let seen = ''
  let ran = ''
  let onVisible: (() => void) | null = null

  const set = (next: WatchStatus) => {
    status = next
    opts.onStatus?.(next)
  }

  async function tick(): Promise<void> {
    // One poll at a time: grading a module can take longer than a second, and a poll must not start a second run.
    if (stopped || polling || !visible()) return
    polling = true
    let file: File | null = null
    try {
      file = await poll()
    } catch (e) {
      if (isDenied(e)) {
        set({ kind: 'denied', folder })
        stop()
      } else if (errorName(e) === 'NotFoundError') {
        // The file went away between the lookup and the read: a rebuild is replacing it. Look again next poll.
        seen = ''
      } else {
        polling = false
        throw e
      }
    }
    try {
      // Outside the try above: what the page's handler throws is the page's to report, not a reason to stop watching.
      if (file && !stopped) await opts.onModule(file)
    } finally {
      polling = false
    }
  }

  /** One look at the artifact: the file to run if it has settled on a new build, else null. */
  async function poll(): Promise<File | null> {
    const found = await locate(opts.root, segments)
    if (stopped) return null
    if (found.kind !== 'file') {
      seen = ''
      // Only report a change of state, so a screen reader is not told "waiting" every second.
      if (status.kind !== found.kind) set({ kind: found.kind, folder })
      return null
    }
    const file = await found.handle.getFile()
    if (stopped) return null
    const stamp = `${file.lastModified}:${file.size}`
    if (stamp === ran) {
      seen = stamp
      return null
    }
    if (stamp !== seen) {
      // Changed since the last poll: wait for one more identical poll before reading it as a finished build.
      seen = stamp
      set({ kind: 'settling', folder, modified: file.lastModified })
      return null
    }
    ran = stamp
    runs++
    set({ kind: 'ran', folder, modified: file.lastModified, runs })
    return file
  }

  function start(): void {
    if (running || stopped) return
    running = true
    handle = timers.set(() => void tick().catch(() => {}), interval)
    if (typeof document !== 'undefined') {
      onVisible = () => {
        if (document.visibilityState === 'visible') void tick().catch(() => {})
      }
      document.addEventListener('visibilitychange', onVisible)
    }
    void tick().catch(() => {})
  }

  function stop(): void {
    stopped = true
    if (running) timers.clear(handle)
    running = false
    if (onVisible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    onVisible = null
  }

  return {
    tick,
    start,
    stop,
    get status() {
      return status
    },
  }
}

/** What the live region says for a watcher state: plain words first, no colour. */
export function watchLine(status: WatchStatus | null, file: string): string {
  if (!status) return ''
  switch (status.kind) {
    case 'no-target':
      return `No target/ folder in "${status.folder}" yet. Run cargo build there, or stop and pick the folder you unzipped, the one that holds target/, not the crate inside it.`
    case 'waiting':
      return `Watching "${status.folder}". ${file} is not built yet: run cargo build --release --target wasm32-unknown-unknown.`
    case 'settling':
      return `${file} changed. Running it once the build has finished writing.`
    case 'ran':
      return `Ran ${file}, built ${new Date(status.modified).toLocaleTimeString()} (run ${status.runs}). Rebuild and it runs again.`
    case 'denied':
      return 'The browser took back read access to the folder. Pick it again to keep watching.'
  }
}

/**
 * Shows the directory picker once and returns the chosen folder, or null if the learner cancelled.
 * `mode: 'read'` asks for read access only; the handle is returned to the caller and never stored.
 */
export async function pickBuildFolder(scope: PickerScope | undefined = browserScope()): Promise<DirHandleLike | null> {
  if (!scope || typeof scope.showDirectoryPicker !== 'function') return null
  try {
    return await scope.showDirectoryPicker({ id: 'kernelspace-forge', mode: 'read' })
  } catch (e) {
    if (errorName(e) === 'AbortError') return null
    throw e
  }
}
