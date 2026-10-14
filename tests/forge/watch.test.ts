/**
 * Folder watch (docs/specs/wave-2.md §16.3; task 2c-08), against a fake directory handle and a fake clock: no browser,
 * no real folder. The fake keeps a log of every call made on it, so "never reads outside target/" is checked as what the
 * watcher actually touched, and it has no listing methods at all, so a watcher that tried to list would throw.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FolderWatch, FolderWatchView } from '../../src/components/forge/FolderWatch'
import { FORGE_LABS } from '../../src/data/labs'
import {
  artifactSegments,
  createWatcher,
  pickBuildFolder,
  POLL_MS,
  watchLine,
  watchSupported,
  type DirHandleLike,
  type FileHandleLike,
  type WatchStatus,
} from '../../src/lib/forge/watch'

// the path labs.ts gives lab 01, not a spelling of ours: the file is rust_allocator.wasm
const ARTIFACT = FORGE_LABS.find((l) => l.id === 'rust-allocator')!.artifact

class DomError extends Error {
  constructor(name: string) {
    super(name)
    this.name = name
  }
}

type Node = FakeDir | FakeFile

class FakeFile implements FileHandleLike {
  constructor(
    private log: string[],
    private path: string,
    public bytes: Uint8Array,
    public modified: number,
    public failNext: string | null = null,
  ) {}
  async getFile(): Promise<File> {
    this.log.push(`file ${this.path}`)
    if (this.failNext) {
      const name = this.failNext
      this.failNext = null
      throw new DomError(name)
    }
    return new File([this.bytes as BlobPart], this.path.split('/').pop()!, { lastModified: this.modified })
  }
}

class FakeDir implements DirHandleLike {
  children = new Map<string, Node>()
  denied = false
  constructor(
    private log: string[],
    public readonly name: string,
    private path = '',
  ) {}
  private at(name: string): string {
    return this.path ? `${this.path}/${name}` : name
  }
  async getDirectoryHandle(name: string): Promise<DirHandleLike> {
    this.log.push(`dir ${this.at(name)}`)
    if (this.denied) throw new DomError('NotAllowedError')
    const n = this.children.get(name)
    if (!(n instanceof FakeDir)) throw new DomError('NotFoundError')
    return n
  }
  async getFileHandle(name: string): Promise<FileHandleLike> {
    this.log.push(`handle ${this.at(name)}`)
    const n = this.children.get(name)
    if (!(n instanceof FakeFile)) throw new DomError('NotFoundError')
    return n
  }
  /** Builds the dirs of `path` under this one and puts a file at its end. */
  put(path: string, bytes: number[], modified: number): FakeFile {
    const parts = path.split('/')
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the walk starts at this directory
    let dir: FakeDir = this
    for (const p of parts.slice(0, -1)) {
      let next = dir.children.get(p)
      if (!(next instanceof FakeDir)) {
        next = new FakeDir(this.log, p, dir.at(p))
        dir.children.set(p, next)
      }
      dir = next
    }
    const file = new FakeFile(this.log, path, new Uint8Array(bytes), modified)
    dir.children.set(parts[parts.length - 1], file)
    return file
  }
}

function setup() {
  const log: string[] = []
  const root = new FakeDir(log, 'labs')
  const ran: File[] = []
  const statuses: WatchStatus[] = []
  const timers = { fns: [] as (() => void)[], cleared: 0, ms: [] as number[] }
  let visible = true
  const w = createWatcher({
    root,
    artifact: ARTIFACT,
    onModule: (f) => void ran.push(f),
    onStatus: (s) => statuses.push(s),
    visible: () => visible,
    timers: {
      set: (fn, ms) => {
        timers.fns.push(fn)
        timers.ms.push(ms)
        return timers.fns.length
      },
      clear: () => {
        timers.cleared++
      },
    },
  })
  return { log, root, ran, statuses, timers, w, hide: () => (visible = false), show: () => (visible = true) }
}

const hadDocument = 'document' in globalThis
afterEach(() => {
  if (!hadDocument) delete (globalThis as { document?: unknown }).document
})

describe('artifactSegments', () => {
  test('accepts the artifacts of every lab, all under target/', () => {
    for (const lab of FORGE_LABS) expect(artifactSegments(lab.artifact)[0]).toBe('target')
  })
  test('refuses anything that could leave target/', () => {
    for (const bad of ['src/lib.rs', 'target', '../target/x.wasm', 'target/../secrets/x.wasm', 'target//x.wasm', '/target/x.wasm', 'target\\x.wasm', 'target/./x.wasm', ''])
      expect(() => artifactSegments(bad)).toThrow()
  })
})

describe('the picker', () => {
  test('is detected, and absent means hidden', () => {
    expect(watchSupported(undefined)).toBe(false)
    expect(watchSupported({})).toBe(false)
    expect(watchSupported({ showDirectoryPicker: () => {} })).toBe(true)
  })
  test('is called once, for reading only, and its handle goes straight to the caller', async () => {
    const log: string[] = []
    const dir = new FakeDir(log, 'labs')
    const calls: unknown[] = []
    const got = await pickBuildFolder({
      showDirectoryPicker: async (o) => {
        calls.push(o)
        return dir
      },
    })
    expect(got).toBe(dir)
    expect(calls).toEqual([{ id: 'kernelspace-forge', mode: 'read' }])
  })
  test('a cancelled picker is null, any other failure is thrown, no picker is null', async () => {
    expect(await pickBuildFolder({ showDirectoryPicker: async () => Promise.reject(new DomError('AbortError')) })).toBeNull()
    expect(pickBuildFolder({ showDirectoryPicker: async () => Promise.reject(new DomError('SecurityError')) })).rejects.toThrow()
    expect(await pickBuildFolder(undefined)).toBeNull()
  })
})

describe('a watcher', () => {
  test('runs a built module once it has held still for two polls, exactly as a drop would hand it over', async () => {
    const t = setup()
    t.root.put(ARTIFACT, [0, 97, 115, 109], 1000)
    await t.w.tick()
    expect(t.ran).toHaveLength(0)
    expect(t.w.status.kind).toBe('settling')
    await t.w.tick()
    expect(t.ran).toHaveLength(1)
    expect(t.ran[0].name).toBe('rust_allocator.wasm')
    expect(t.ran[0].lastModified).toBe(1000)
    expect([...new Uint8Array(await t.ran[0].arrayBuffer())]).toEqual([0, 97, 115, 109])
    expect(t.w.status).toEqual({ kind: 'ran', folder: 'labs', modified: 1000, runs: 1 })
  })

  test('does not run the same build again, and runs every rebuild', async () => {
    const t = setup()
    const f = t.root.put(ARTIFACT, [1], 1000)
    for (let i = 0; i < 5; i++) await t.w.tick()
    expect(t.ran).toHaveLength(1)
    f.modified = 2000
    await t.w.tick()
    expect(t.ran).toHaveLength(1)
    await t.w.tick()
    expect(t.ran).toHaveLength(2)
    expect(t.ran[1].lastModified).toBe(2000)
    f.modified = 3000
    f.bytes = new Uint8Array([1, 2, 3])
    await t.w.tick()
    await t.w.tick()
    expect(t.ran).toHaveLength(3)
    expect(t.ran[2].size).toBe(3)
  })

  test('a file still being written (a new stamp every poll) is not run until it stops', async () => {
    const t = setup()
    const f = t.root.put(ARTIFACT, [1], 1000)
    for (let i = 1; i <= 4; i++) {
      f.modified = 1000 + i
      f.bytes = new Uint8Array(i)
      await t.w.tick()
    }
    expect(t.ran).toHaveLength(0)
    await t.w.tick()
    expect(t.ran).toHaveLength(1)
    expect(t.ran[0].size).toBe(4)
  })

  test('reads only target/…/<artifact>: named lookups on that one path, nothing beside it', async () => {
    const t = setup()
    t.root.put(ARTIFACT, [1], 1000)
    t.root.put('secrets/id_rsa', [9], 1)
    t.root.put('src/lib.rs', [9], 1)
    t.root.put('target/debug/other.wasm', [9], 1)
    for (let i = 0; i < 3; i++) await t.w.tick()
    expect(new Set(t.log)).toEqual(
      new Set([
        'dir target',
        'dir target/wasm32-unknown-unknown',
        'dir target/wasm32-unknown-unknown/release',
        `handle ${ARTIFACT}`,
        `file ${ARTIFACT}`,
      ]),
    )
    expect(t.log.every((l) => l.includes('target'))).toBe(true)
    // no listing method exists on the handle type the watcher accepts
    expect('entries' in t.root || 'values' in t.root || 'keys' in t.root).toBe(false)
  })

  test('a folder without target/ is reported, polled without reading anything else, and picked up once built', async () => {
    const t = setup()
    t.root.put('src/lib.rs', [9], 1)
    await t.w.tick()
    expect(t.w.status).toEqual({ kind: 'no-target', folder: 'labs' })
    expect(t.log).toEqual(['dir target'])
    t.root.put('target/debug/x', [1], 1)
    await t.w.tick()
    expect(t.w.status.kind).toBe('waiting')
    t.root.put(ARTIFACT, [1], 5)
    await t.w.tick()
    await t.w.tick()
    expect(t.ran).toHaveLength(1)
  })

  test('reports a change of state once, not every second', async () => {
    const t = setup()
    for (let i = 0; i < 4; i++) await t.w.tick()
    expect(t.statuses.map((s) => s.kind)).toEqual(['no-target'])
  })

  test('does nothing, and reads nothing, while the tab is hidden', async () => {
    const t = setup()
    t.root.put(ARTIFACT, [1], 1000)
    t.hide()
    for (let i = 0; i < 4; i++) await t.w.tick()
    expect(t.log).toEqual([])
    expect(t.ran).toHaveLength(0)
    t.show()
    await t.w.tick()
    await t.w.tick()
    expect(t.ran).toHaveLength(1)
  })

  test('a file replaced between the lookup and the read is looked at again next poll', async () => {
    const t = setup()
    const f = t.root.put(ARTIFACT, [1], 1000)
    await t.w.tick()
    f.failNext = 'NotFoundError'
    await t.w.tick()
    expect(t.ran).toHaveLength(0)
    await t.w.tick()
    expect(t.ran).toHaveLength(0)
    await t.w.tick()
    expect(t.ran).toHaveLength(1)
  })

  test('lost read access ends the watch with a status, and nothing runs afterwards', async () => {
    const t = setup()
    t.root.put(ARTIFACT, [1], 1000)
    t.root.denied = true
    await t.w.tick()
    expect(t.w.status).toEqual({ kind: 'denied', folder: 'labs' })
    t.root.denied = false
    const before = t.log.length
    await t.w.tick()
    expect(t.log.length).toBe(before)
    expect(t.ran).toHaveLength(0)
  })

  test('a slow grading is awaited: a poll that lands during it starts nothing', async () => {
    const log: string[] = []
    const root = new FakeDir(log, 'labs')
    const f = root.put(ARTIFACT, [1], 1000)
    let release!: () => void
    let runs = 0
    const w = createWatcher({
      root,
      artifact: ARTIFACT,
      visible: () => true,
      onModule: () => {
        runs++
        return runs === 1 ? new Promise<void>((r) => (release = r)) : undefined
      },
    })
    await w.tick()
    const running = w.tick()
    await Bun.sleep(0)
    f.modified = 2000
    await w.tick()
    await w.tick()
    expect(runs).toBe(1)
    release()
    await running
    await w.tick()
    await w.tick()
    expect(runs).toBe(2)
  })

  test('an error thrown by the page handler does not stop the watch or re-run the same build', async () => {
    const log: string[] = []
    const root = new FakeDir(log, 'labs')
    root.put(ARTIFACT, [1], 1000)
    let runs = 0
    const w = createWatcher({
      root,
      artifact: ARTIFACT,
      visible: () => true,
      onModule: () => {
        runs++
        throw new Error('grading failed')
      },
    })
    await w.tick()
    expect(w.tick()).rejects.toThrow('grading failed')
    await Bun.sleep(0)
    await w.tick()
    await w.tick()
    expect(runs).toBe(1)
  })

  test('polls every second, once per start, and stop clears the timer', () => {
    const t = setup()
    t.w.start()
    t.w.start()
    expect(t.timers.ms).toEqual([POLL_MS])
    expect(POLL_MS).toBe(1000)
    t.w.stop()
    expect(t.timers.cleared).toBe(1)
    t.w.start()
    expect(t.timers.ms).toEqual([POLL_MS])
  })

  test('polls again as soon as the tab becomes visible, and stops listening on stop', async () => {
    const listeners: Record<string, () => void> = {}
    const doc = {
      visibilityState: 'hidden',
      addEventListener: (type: string, fn: () => void) => void (listeners[type] = fn),
      removeEventListener: (type: string) => void delete listeners[type],
    }
    ;(globalThis as { document?: unknown }).document = doc
    const t = setup()
    t.root.put(ARTIFACT, [1], 1000)
    t.hide()
    t.w.start()
    expect(typeof listeners.visibilitychange).toBe('function')
    expect(t.log).toEqual([])
    t.show()
    doc.visibilityState = 'visible'
    listeners.visibilitychange()
    await Bun.sleep(5)
    expect(t.log.length).toBeGreaterThan(0)
    t.w.stop()
    expect(listeners.visibilitychange).toBeUndefined()
  })
})

describe('FolderWatch', () => {
  const lab = FORGE_LABS.find((l) => l.id === 'rust-allocator')!

  test('is the hidden marker until a directory picker is found, so Firefox and Safari keep the drop zone alone', () => {
    expect(renderToStaticMarkup(createElement(FolderWatch, { lab, onModule: () => {} }))).toBe(`<div hidden="" data-folder-watch="${lab.id}"></div>`)
  })

  test('says each state in words', () => {
    const f = ARTIFACT.split('/').pop()!
    expect(watchLine(null, f)).toBe('')
    expect(watchLine({ kind: 'no-target', folder: 'labs' }, f)).toContain('No target/ folder in "labs"')
    expect(watchLine({ kind: 'waiting', folder: 'labs' }, f)).toContain('cargo build --release --target wasm32-unknown-unknown')
    expect(watchLine({ kind: 'settling', folder: 'labs', modified: 1 }, f)).toContain('changed')
    expect(watchLine({ kind: 'ran', folder: 'labs', modified: 1, runs: 2 }, f)).toContain('run 2')
    expect(watchLine({ kind: 'denied', folder: 'labs' }, f)).toContain('Pick it again')
  })

  test('the artifact the tests watch is the one labs.ts names', () => {
    expect(ARTIFACT).toBe('target/wasm32-unknown-unknown/release/rust_allocator.wasm')
  })
})

describe('FolderWatch’s visible state', () => {
  const lab = FORGE_LABS.find((l) => l.id === 'rust-allocator')!
  const view = (status: WatchStatus | null) => renderToStaticMarkup(createElement(FolderWatchView, { lab, status, onPick: () => {}, onStop: () => {} }))

  test('before a folder is picked: the pick button, no Stop, nothing said', () => {
    const out = view(null)
    expect(out).toContain('Watch my build folder')
    expect(out).not.toContain('Stop watching')
    expect(out).toContain('data-watching="off"')
    expect(out).toMatch(/<p role="status" data-watch-status="true"[^>]*><\/p>/)
  })

  test('it says what it reads and that nothing is uploaded, with the lab’s own artifact', () => {
    const out = view(null)
    expect(out).toContain(`reads only ${lab.artifact}`)
    expect(out).toContain('nothing is uploaded')
    expect(out).toContain('Chromium only')
  })

  test('every watching state swaps the pick button for Stop, and says its state in the live region', () => {
    const states: [WatchStatus, string][] = [
      [{ kind: 'no-target', folder: 'labs' }, 'No target/ folder in &quot;labs&quot;'],
      [{ kind: 'waiting', folder: 'labs' }, 'is not built yet'],
      [{ kind: 'settling', folder: 'labs', modified: 5 }, 'changed. Running it once'],
      [{ kind: 'ran', folder: 'labs', modified: 5, runs: 3 }, '(run 3)'],
    ]
    for (const [status, said] of states) {
      const out = view(status)
      expect(out).toContain('Stop watching')
      expect(out).not.toContain('Watch my build folder')
      expect(out).toContain('data-watching="on"')
      expect(out).toContain(said)
    }
  })

  test('denied ends the watch: the pick button is back, the reset sentence is shown, and Stop is gone', () => {
    const out = view({ kind: 'denied', folder: 'labs' })
    expect(out).toContain('Watch my build folder')
    expect(out).not.toContain('Stop watching')
    expect(out).toContain('data-watching="off"')
    expect(out).toContain('Pick it again to keep watching.')
  })

  test('where the browser has a directory picker, FolderWatch starts on the pick button', () => {
    const g = globalThis as { window?: unknown }
    const had = 'window' in g
    const before = g.window
    g.window = { showDirectoryPicker: async () => ({}) }
    try {
      const out = renderToStaticMarkup(createElement(FolderWatch, { lab, onModule: () => {}, onWatching: () => {} }))
      expect(out).toContain('Watch my build folder')
      expect(out).not.toContain('Stop watching')
      expect(out).not.toContain('hidden=""')
    } finally {
      if (had) g.window = before
      else delete g.window
    }
  })

  test('the pick button and Stop are real buttons that start and stop through the props', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/components/forge/FolderWatch.tsx'), 'utf8')
    expect(src).toContain('onClick={onStop}')
    expect(src).toContain('onClick={onPick}')
    // a step switch in the walk does not stop it: the walk keeps this component mounted (forge-ui.test.ts)
    expect(src).toContain('PrimmPanel keeps the Make step mounted')
  })
})
