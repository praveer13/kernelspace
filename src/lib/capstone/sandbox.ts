/**
 * capstone/sandbox.ts — where Capstone learner code runs (spec wave-1 §14.1, PLAN §7.3).
 *
 * Learner JS never runs on the main thread. Two layers:
 *   1. an `<iframe sandbox="allow-scripts">` (no allow-same-origin) loading
 *      public/capstone-sandbox.html. Its origin is opaque: no app IndexedDB,
 *      storage, cookies or BroadcastChannel;
 *   2. inside it, a Blob-URL worker built from capstone.worker's source, which the
 *      page fetches and posts in as a string. One worker per job; a job past
 *      JOB_BUDGET_MS has its worker terminated, so `while(true){}` ends the run
 *      and the page never stalls.
 * Where a browser cannot host that worker in an opaque-origin frame (owner answer
 * O9), the page creates the worker itself and the worker's lockdown is the only
 * wall: weaker, and labelled "sandbox: worker only".
 *
 * Messages carry structured-clone data only. The page accepts a message only from
 * its frame's window and only for the nonce of the job in flight; the frame
 * accepts only from window.parent. public/capstone-sandbox.js mirrors WorkerRelay
 * in plain JS; tests/capstone/sandbox-protocol.test.ts runs both.
 */

import type { StepRunReply } from './steps'

/** The frame (or WorkerRelay) terminates a job's worker after this. */
export const JOB_BUDGET_MS = 2000
/** The page drops and recreates the frame when a job gets no answer by then. */
export const FRAME_DEADLINE_MS = 4000
/** Frame hello plus first worker boot; past this the page falls back to worker only. */
export const BOOT_DEADLINE_MS = 4000

/** Globals the worker removes before any learner code runs: storage, network, other contexts, new code. */
export const LOCKDOWN_NAMES = [
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'navigator',
  'postMessage',
] as const

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export const TAG = 'ks-capstone'

export type ParentToFrame =
  | { tag: typeof TAG; type: 'init'; source: string }
  | { tag: typeof TAG; type: 'job'; nonce: string; stepId: string; code: string }

export type FrameToParent =
  | { tag: typeof TAG; type: 'hello' }
  | { tag: typeof TAG; type: 'ready' }
  | { tag: typeof TAG; type: 'unsupported'; reason: string }
  | { tag: typeof TAG; type: 'result'; nonce: string; reply: StepRunReply }
  | { tag: typeof TAG; type: 'timeout'; nonce: string }

export type RelayToWorker = { type: 'job'; stepId: string; code: string }

export type WorkerToRelay =
  | { type: 'ready'; exposed: string[] }
  | { type: 'done'; reply: StepRunReply }

export type SandboxMode = 'frame' | 'worker'

export type SandboxOutcome =
  | { kind: 'reply'; mode: SandboxMode; reply: StepRunReply }
  /** the learner's code (or the checks on it) ran past the budget */
  | { kind: 'timeout'; mode: SandboxMode; budgetMs: number }
  /** no sandbox could be started; nothing ran */
  | { kind: 'unavailable'; reason: string }

export const MODE_LABEL: Record<SandboxMode, string> = {
  frame: 'sandbox: opaque-origin frame + worker',
  worker: 'sandbox: worker only',
}

/* ------------------------------------------------------------------ */
/* Worker side                                                         */
/* ------------------------------------------------------------------ */

/**
 * Delete each name from `scope` and its prototype chain, then pin it to
 * undefined. Returns the names still reachable afterwards (empty when it worked).
 */
export function lockdown(scope: object, names: readonly string[]): string[] {
  const left: string[] = []
  for (const name of names) {
    for (let o: object | null = scope; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      if (!Object.prototype.hasOwnProperty.call(o, name)) continue
      try {
        delete (o as Record<string, unknown>)[name]
      } catch {
        // non-configurable: the defineProperty below or the check catches it
      }
    }
    try {
      Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false })
    } catch {
      // checked below
    }
    let still: unknown
    try {
      still = (scope as Record<string, unknown>)[name]
    } catch {
      still = undefined
    }
    if (still !== undefined) left.push(name)
  }
  return left
}

/** The slice of a dedicated worker's global scope the worker uses. */
export interface WorkerScope {
  postMessage(msg: WorkerToRelay): void
  onmessage: ((ev: { data: unknown }) => void) | null
}

/**
 * Wire a worker scope: keep a private postMessage, lock the scope down, grade
 * exactly one job, then ignore everything. `run` is runStepJob in the bundle.
 */
export function serveOneJob(scope: WorkerScope, run: (stepId: string, code: string) => StepRunReply) {
  const post = scope.postMessage.bind(scope)
  const exposed = lockdown(scope, LOCKDOWN_NAMES)
  let used = false
  scope.onmessage = (ev) => {
    const m = ev.data as Partial<RelayToWorker> | null
    if (used || m?.type !== 'job') return
    used = true
    post({ type: 'done', reply: run(String(m.stepId), String(m.code)) })
  }
  post({ type: 'ready', exposed })
}

/* ------------------------------------------------------------------ */
/* Relay: warm worker, one job each, a budget per job                  */
/* ------------------------------------------------------------------ */

/** The slice of Worker the relay uses (tests pass fakes). */
export interface WorkerLike {
  postMessage(msg: RelayToWorker): void
  terminate(): void
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as number),
}

interface Warm {
  worker: WorkerLike
  ready: Promise<string[]>
}

export type RelayResult = { kind: 'reply'; reply: StepRunReply } | { kind: 'timeout' }

/**
 * Keeps one booted worker waiting, hands it a single job, and replaces it after.
 * The next worker boots while the learner reads results (tens of ms), so the
 * budget rarely pays for a boot. public/capstone-sandbox.js is this class in plain JS.
 */
export class WorkerRelay {
  private warm: Warm | null = null
  private readonly spawn: () => WorkerLike
  private readonly budgetMs: number
  private readonly timers: Timers

  constructor(spawn: () => WorkerLike, budgetMs = JOB_BUDGET_MS, timers: Timers = realTimers) {
    this.spawn = spawn
    this.budgetMs = budgetMs
    this.timers = timers
  }

  /** Boot (or reuse) the waiting worker; resolves to the globals its lockdown left. */
  boot(): Promise<string[]> {
    return this.ensureWarm().ready
  }

  /** The budget runs from submission, a worker still booting included, so no job outlives it. */
  run(stepId: string, code: string): Promise<RelayResult> {
    const warm = this.ensureWarm()
    this.warm = null
    return new Promise<RelayResult>((resolve, reject) => {
      let settled = false
      const finish = (r: RelayResult | Error) => {
        if (settled) return
        settled = true
        this.timers.clearTimeout(timer)
        warm.worker.onmessage = null
        warm.worker.onerror = null
        warm.worker.terminate()
        this.ensureWarm()
        if (r instanceof Error) reject(r)
        else resolve(r)
      }
      const timer = this.timers.setTimeout(() => finish({ kind: 'timeout' }), this.budgetMs)
      warm.ready.then(
        () => {
          if (settled) return
          warm.worker.onmessage = (ev) => {
            const m = ev.data as WorkerToRelay
            if (m?.type === 'done') finish({ kind: 'reply', reply: m.reply })
          }
          warm.worker.postMessage({ type: 'job', stepId, code })
        },
        (e) => finish(e instanceof Error ? e : new Error(String(e))),
      )
    })
  }

  dispose() {
    this.warm?.worker.terminate()
    this.warm = null
  }

  private ensureWarm(): Warm {
    if (this.warm) return this.warm
    const worker = this.spawn()
    const ready = new Promise<string[]>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => reject(new Error('the sandbox worker did not start')), BOOT_DEADLINE_MS)
      worker.onmessage = (ev) => {
        const m = ev.data as WorkerToRelay
        if (m?.type !== 'ready') return
        this.timers.clearTimeout(timer)
        worker.onmessage = null
        worker.onerror = null
        resolve(m.exposed)
      }
      worker.onerror = () => {
        this.timers.clearTimeout(timer)
        reject(new Error('the sandbox worker failed to start'))
      }
    })
    ready.catch(() => {}) // observed by boot()/run(); never an unhandled rejection
    this.warm = { worker, ready }
    return this.warm
  }
}

/* ------------------------------------------------------------------ */
/* Page side                                                           */
/* ------------------------------------------------------------------ */

/** A mounted frame: its window (the only accepted message source), a poster and a remover. */
export interface FrameHandle {
  window: unknown
  post(msg: ParentToFrame): void
  destroy(): void
}

export interface SandboxDeps {
  /** Create the sandboxed iframe; null where the page cannot (no DOM). */
  mountFrame(): FrameHandle | null
  /** Subscribe to window `message` events; returns the unsubscriber. */
  listen(handler: (source: unknown, data: unknown) => void): () => void
  /** The built capstone.worker bundle as text, for the frame's Blob worker. */
  workerSource(): Promise<string>
  /** A same-origin worker on that bundle, for the worker-only fallback. */
  spawnWorker(): WorkerLike
  nonce(): string
  timers?: Timers
  /** Skip the frame: dev serves an unbundled worker that no Blob can host. */
  workerOnly?: boolean
}

interface Pending {
  nonce: string
  resolve: (o: SandboxOutcome) => void
  timer: unknown
}

/**
 * The page's handle on the sandbox. Starts lazily, serialises jobs, recreates a
 * frame that stops answering, and falls back to worker only (O9) when the frame
 * cannot host a worker.
 */
export class CapstoneSandbox {
  private frame: FrameHandle | null = null
  private relay: WorkerRelay | null = null
  private starting: Promise<SandboxMode> | null = null
  private pending: Pending | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private unlisten: (() => void) | null = null
  private bootWaiter: ((m: FrameToParent) => void) | null = null
  private readonly timers: Timers
  private readonly deps: SandboxDeps
  private disposed = false

  constructor(deps: SandboxDeps) {
    this.deps = deps
    this.timers = deps.timers ?? realTimers
  }

  /** Resolves to the isolation in force, starting it if needed. Rejects when none could start. */
  start(): Promise<SandboxMode> {
    this.starting ??= this.boot().catch((e) => {
      this.starting = null
      throw e
    })
    return this.starting
  }

  run(stepId: string, code: string): Promise<SandboxOutcome> {
    const job = this.chain.then(() => this.runNow(stepId, code))
    this.chain = job.catch(() => {})
    return job
  }

  dispose() {
    this.disposed = true
    this.unlisten?.()
    this.unlisten = null
    this.frame?.destroy()
    this.frame = null
    this.relay?.dispose()
    this.relay = null
    if (this.pending) this.settle({ kind: 'unavailable', reason: 'the sandbox was closed' })
  }

  private async runNow(stepId: string, code: string): Promise<SandboxOutcome> {
    let mode: SandboxMode
    try {
      mode = await this.start()
    } catch (e) {
      return { kind: 'unavailable', reason: e instanceof Error ? e.message : String(e) }
    }
    if (mode === 'worker') {
      try {
        const r = await this.relay!.run(stepId, code)
        return r.kind === 'reply'
          ? { kind: 'reply', mode, reply: r.reply }
          : { kind: 'timeout', mode, budgetMs: JOB_BUDGET_MS }
      } catch (e) {
        return { kind: 'unavailable', reason: e instanceof Error ? e.message : String(e) }
      }
    }
    const frame = this.frame
    if (!frame) return { kind: 'unavailable', reason: 'the sandbox was closed' }
    return new Promise<SandboxOutcome>((resolve) => {
      const nonce = this.deps.nonce()
      const timer = this.timers.setTimeout(() => {
        // the frame itself stopped answering: replace it and report the run as over budget
        this.settle({ kind: 'timeout', mode: 'frame', budgetMs: JOB_BUDGET_MS })
        frame.destroy()
        if (this.frame === frame) {
          this.frame = null
          this.starting = null
        }
      }, FRAME_DEADLINE_MS)
      this.pending = { nonce, resolve, timer }
      frame.post({ tag: TAG, type: 'job', nonce, stepId, code })
    })
  }

  private settle(o: SandboxOutcome) {
    const p = this.pending
    if (!p) return
    this.pending = null
    this.timers.clearTimeout(p.timer)
    p.resolve(o)
  }

  private onMessage = (source: unknown, data: unknown) => {
    if (!this.frame || source !== this.frame.window) return
    const m = data as FrameToParent | null
    if (!m || typeof m !== 'object' || m.tag !== TAG) return
    if (m.type === 'result' || m.type === 'timeout') {
      if (!this.pending || m.nonce !== this.pending.nonce) return
      this.settle(
        m.type === 'result'
          ? { kind: 'reply', mode: 'frame', reply: m.reply }
          : { kind: 'timeout', mode: 'frame', budgetMs: JOB_BUDGET_MS },
      )
      return
    }
    this.bootWaiter?.(m)
  }

  private async boot(): Promise<SandboxMode> {
    if (this.disposed) throw new Error('the sandbox was closed')
    this.unlisten ??= this.deps.listen(this.onMessage)
    if (!this.deps.workerOnly) {
      const ok = await this.bootFrame()
      if (this.disposed) throw new Error('the sandbox was closed')
      if (ok) return 'frame'
    }
    this.relay ??= new WorkerRelay(() => this.deps.spawnWorker(), JOB_BUDGET_MS, this.timers)
    const exposed = await this.relay.boot()
    if (this.disposed) {
      this.relay?.dispose()
      throw new Error('the sandbox was closed')
    }
    if (exposed.length > 0) {
      this.relay.dispose()
      this.relay = null
      throw new Error(`this browser cannot isolate the Capstone (${exposed.join(', ')} stay reachable)`)
    }
    return 'worker'
  }

  /** True once the frame's worker is ready; false (frame removed) when the frame cannot host one. */
  private async bootFrame(): Promise<boolean> {
    const frame = this.deps.mountFrame()
    if (!frame) return false
    this.frame = frame
    const source = this.deps.workerSource()
    source.catch(() => {})
    const outcome = await new Promise<'ready' | 'no'>((resolve) => {
      const timer = this.timers.setTimeout(() => done('no'), BOOT_DEADLINE_MS)
      const done = (r: 'ready' | 'no') => {
        this.timers.clearTimeout(timer)
        this.bootWaiter = null
        resolve(r)
      }
      this.bootWaiter = (m) => {
        if (m.type === 'hello') {
          source.then(
            (text) => frame.post({ tag: TAG, type: 'init', source: text }),
            () => done('no'),
          )
        } else if (m.type === 'ready') done('ready')
        else if (m.type === 'unsupported') done('no')
      }
    })
    if (outcome === 'ready' && this.frame === frame) return true
    frame.destroy()
    if (this.frame === frame) this.frame = null
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Browser wiring                                                      */
/* ------------------------------------------------------------------ */

function randomNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * The sandbox for this page. `workerUrl` is capstone.worker's built bundle
 * (`?worker&url`), `frameUrl` is public/capstone-sandbox.html under the app's base.
 */
export function createCapstoneSandbox(opts: { workerUrl: string; frameUrl: string; workerOnly?: boolean }) {
  return new CapstoneSandbox({
    workerOnly: opts.workerOnly,
    mountFrame: () => {
      if (typeof document === 'undefined') return null
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.tabIndex = -1
      iframe.title = 'Capstone code sandbox'
      // off-screen but not display:none, so browsers do not throttle its timers
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
      iframe.src = opts.frameUrl
      document.body.appendChild(iframe)
      const win = iframe.contentWindow
      return {
        window: win,
        // the frame's origin is opaque, so '*' is the only target that reaches it
        post: (msg) => win?.postMessage(msg, '*'),
        destroy: () => iframe.remove(),
      }
    },
    listen: (handler) => {
      const fn = (ev: MessageEvent) => handler(ev.source, ev.data)
      window.addEventListener('message', fn)
      return () => window.removeEventListener('message', fn)
    },
    workerSource: async () => {
      const res = await fetch(opts.workerUrl)
      if (!res.ok) throw new Error(`the sandbox worker failed to load (${res.status})`)
      return res.text()
    },
    spawnWorker: () => new Worker(opts.workerUrl, { type: import.meta.env.DEV ? 'module' : 'classic' }) as unknown as WorkerLike,
    nonce: randomNonce,
  })
}
