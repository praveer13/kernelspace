/**
 * fleet-model — the JS reference block manager + dump parser for /fleet.
 *
 * The Fleet runs a student's kv-block-manager wasm against a live traffic
 * stream and checks CONFORMANCE against this reference: same op stream in,
 * and after every tick we compare the three implementation-agnostic
 * invariants — op return values, free_blocks, and the sorted refcount
 * multiset (physical block ids legitimately differ between allocators).
 *
 * Semantics mirror the lab 02 contract exactly: ceil paging, fork shares
 * all blocks (refcount++), append copy-on-writes a shared partial tail,
 * free returns blocks at refcount 0, all-or-nothing on failure.
 */

export interface RefSeq {
  len: number
  blocks: number[]
}

export class RefBlockManager {
  readonly numBlocks: number
  private bs: number
  private freeList: number[]
  private refs: number[]
  private tables = new Map<number, number[]>()
  private lens = new Map<number, number>()

  constructor(numBlocks: number, blockSize: number) {
    this.numBlocks = numBlocks
    this.bs = blockSize
    this.freeList = []
    for (let i = numBlocks - 1; i >= 0; i--) this.freeList.push(i)
    this.refs = new Array(numBlocks).fill(0)
  }

  get freeBlocks(): number {
    return this.freeList.length
  }

  allocate(seq: number, tokens: number): boolean {
    if (tokens <= 0 || this.tables.has(seq)) return false
    const need = Math.ceil(tokens / this.bs)
    if (this.freeList.length < need) return false
    const table: number[] = []
    for (let i = 0; i < need; i++) {
      const b = this.freeList.pop() as number
      this.refs[b] = 1
      table.push(b)
    }
    this.tables.set(seq, table)
    this.lens.set(seq, tokens)
    return true
  }

  append(seq: number, n: number): boolean {
    const len = this.lens.get(seq)
    if (len === undefined) return false
    if (n === 0) return true
    const table = this.tables.get(seq) as number[]
    const partial = len % this.bs !== 0
    const last = table[table.length - 1]
    const tailShared = this.refs[last] > 1
    const cow = partial && tailShared
    const spaceInTail = partial ? this.bs - (len % this.bs) : 0
    const newBlocks = Math.ceil(Math.max(0, n - spaceInTail) / this.bs)
    const need = newBlocks + (cow ? 1 : 0)
    if (this.freeList.length < need) return false
    if (cow) {
      const fresh = this.freeList.pop() as number
      this.refs[last] -= 1
      this.refs[fresh] = 1
      table[table.length - 1] = fresh
    }
    for (let i = 0; i < newBlocks; i++) {
      const b = this.freeList.pop() as number
      this.refs[b] = 1
      table.push(b)
    }
    this.lens.set(seq, len + n)
    return true
  }

  fork(src: number, dst: number): boolean {
    const table = this.tables.get(src)
    if (!table || this.tables.has(dst)) return false
    for (const b of table) this.refs[b] += 1
    this.tables.set(dst, [...table])
    this.lens.set(dst, this.lens.get(src) as number)
    return true
  }

  free(seq: number): void {
    const table = this.tables.get(seq)
    if (!table) return
    this.tables.delete(seq)
    this.lens.delete(seq)
    for (const b of table) {
      this.refs[b] -= 1
      if (this.refs[b] === 0) this.freeList.push(b)
    }
  }

  /** sorted refcount multiset of allocated blocks (conformance key) */
  refcountMultiset(): number[] {
    return this.refs.filter((r) => r > 0).sort((a, b) => a - b)
  }

  seqs(): IterableIterator<[number, RefSeq]> {
    const m = new Map<number, RefSeq>()
    for (const [id, blocks] of this.tables) m.set(id, { len: this.lens.get(id) ?? 0, blocks })
    return m.entries()
  }
}

/* ------------------------------ dump ------------------------------ */

export interface ManagerDump {
  numBlocks: number
  blockSize: number
  free: number
  /** block id → refs (allocated blocks only) */
  refs: Map<number, number>
  /** seq id → { len, blocks } */
  seqs: Map<number, RefSeq>
}

/** Parse the student dump format (lab 02 contract). Throws on garbage. */
export function parseDump(text: string): ManagerDump {
  const out: ManagerDump = {
    numBlocks: 0,
    blockSize: 0,
    free: 0,
    refs: new Map(),
    seqs: new Map(),
  }
  let sawCapacity = false
  let sawFree = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const p = line.split(/\s+/)
    if (p[0] === 'capacity' && p.length === 3) {
      out.numBlocks = Number(p[1])
      out.blockSize = Number(p[2])
      sawCapacity = Number.isFinite(out.numBlocks) && Number.isFinite(out.blockSize)
    } else if (p[0] === 'free' && p.length === 2) {
      out.free = Number(p[1])
      sawFree = Number.isFinite(out.free)
    } else if (p[0] === 'block' && p.length === 4 && p[2] === 'refs') {
      out.refs.set(Number(p[1]), Number(p[3]))
    } else if (p[0] === 'seq' && p.length >= 6 && p[2] === 'len' && p[4] === 'blocks') {
      const blocks = p[5] === '' ? [] : p[5].split(',').map(Number)
      out.seqs.set(Number(p[1]), { len: Number(p[3]), blocks })
    } else {
      throw new Error(`unparseable dump line: "${line}"`)
    }
  }
  if (!sawCapacity || !sawFree) throw new Error('dump missing capacity/free lines')
  return out
}

/** sorted refcount multiset from a parsed dump (conformance key) */
export function dumpRefMultiset(d: ManagerDump): number[] {
  return [...d.refs.values()].filter((r) => r > 0).sort((a, b) => a - b)
}

/* --------------------------- traffic gen ---------------------------- */

export interface FleetOp {
  kind: 'allocate' | 'append' | 'fork' | 'free'
  /** seq ids involved (src for fork) */
  a: number
  b?: number
  n?: number
}

/** Deterministic xorshift — same stream every run. */
export function makeRng(seed: number): () => number {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x >> 12
    x ^= x << 25
    x ^= x >> 27
    x >>>= 0
    return (x * 0x2545f491) >>> 0
  }
}

/* ------------------------ engine mode (fleet v1) ------------------------ */

export interface RequestSpec {
  id: number
  arrival: number
  prompt: number
  output: number
}

/**
 * Chat-ish request stream: mixed prompts, ~12% heavy, hidden outputs —
 * plus three sharp arrival bursts (the intake queue's reason to exist).
 */
export function makeRequestStream(count: number, span: number, seed: number): RequestSpec[] {
  const rng = makeRng(seed)
  const out: RequestSpec[] = []
  for (let i = 0; i < count; i++) {
    const heavy = rng() % 100 < 12
    out.push({
      id: i + 1,
      arrival: rng() % span,
      prompt: heavy ? 768 + (rng() % 257) : 64 + (rng() % 449),
      output: 16 + (rng() % 81),
    })
  }
  // three flash crowds of 45 over 2 ticks (the intake queue's reason to exist)
  const burstAt = [Math.floor(span / 4), Math.floor(span / 2), Math.floor((span * 3) / 4)]
  for (let i = 0; i < 135 && i < out.length; i++) {
    out[i].arrival = burstAt[Math.floor(i / 45)] + (i % 2)
  }
  return out.sort((a, b) => a.arrival - b.arrival || a.id - b.id)
}

export interface SchedViewReq { id: number; arrival: number; prompt: number }
export interface SchedViewRun extends SchedViewReq { decoded: number; prefillLeft: number }
export interface SchedView {
  iter: number
  maxRunning: number
  memCap: number
  memUsed: number
  waiting: SchedViewReq[]
  running: SchedViewRun[]
}
export interface SchedAction { admit: number[]; preempt: number[] }

/** A scheduler implementation: JS reference or wasm bridge adapter. */
export interface SchedulerDriver {
  name: string
  schedule(view: SchedView): SchedAction
}

/** A block-manager implementation: JS reference or wasm bridge adapter. */
export interface ManagerDriver {
  name: string
  allocate(seq: number, tokens: number): boolean
  append(seq: number, n: number): boolean
  free(seq: number): void
  freeBlocks(): number
  /** dump for the grid — parsed dump or direct construction */
  dump(): ManagerDump
}

/**
 * The reference admission policy (mirrors forge lab 06 reference):
 * smallest-first with a FIFO starvation guard and decode-growth headroom.
 */
export const GUARD_AGE = 2000
export const HEADROOM_TOKENS = 48

export function referenceScheduler(v: SchedView): SchedAction {
  let used = v.running.reduce((a, r) => a + r.prompt + r.decoded + HEADROOM_TOKENS, 0)
  let slots = v.maxRunning - v.running.length
  const scored = [...v.waiting].sort((a, b) => {
    const aa = v.iter - a.arrival > GUARD_AGE
    const ab = v.iter - b.arrival > GUARD_AGE
    if (aa !== ab) return aa ? -1 : 1
    if (aa && ab) return a.arrival - b.arrival
    return a.prompt - b.prompt || a.arrival - b.arrival
  })
  const admit: number[] = []
  for (const r of scored) {
    if (slots === 0) break
    const cost = r.prompt + HEADROOM_TOKENS
    if (used + cost > v.memCap) continue
    admit.push(r.id)
    slots -= 1
    used += cost
  }
  return { admit, preempt: [] }
}

/** JS reference scheduler driver. */
export function makeRefScheduler(): SchedulerDriver {
  return { name: 'reference', schedule: referenceScheduler }
}

/** JS reference manager driver (wraps RefBlockManager with a dump view). */
export function makeRefManager(numBlocks: number, blockSize: number): ManagerDriver {
  const m = new RefBlockManager(numBlocks, blockSize)
  return {
    name: 'reference',
    allocate: (s, t) => m.allocate(s, t),
    append: (s, n) => m.append(s, n),
    free: (s) => m.free(s),
    freeBlocks: () => m.freeBlocks,
    dump: () => {
      const refs = new Map<number, number>()
      for (const [, s] of m.seqs()) for (const b of s.blocks) refs.set(b, (refs.get(b) ?? 0) + 1)
      return { numBlocks, blockSize, free: m.freeBlocks, refs, seqs: new Map(m.seqs()) }
    },
  }
}

export interface EngineConfig {
  numBlocks: number
  blockSize: number
  maxRunning: number
  sloTtft: number
  prefillChunk: number
  /** EPD mode: this engine only prefills — seqs leave at prefill completion */
  prefillOnly?: boolean
  /** ITL coupling: prefilling seqs suppress decode appends in this worker
   * (chunked-prefill reality). The mechanism EPD exists to eliminate. */
  interference?: boolean
  /** SLO on inter-token latency (ticks/token) — the second contract, where
   * decode isolation actually shows up */
  sloItl?: number
}

export interface EngineStats {
  completed: number
  sloMet: number
  ttfts: number[]
  autoPreempts: number
  capacityMisses: number
  waitingNow: number
  runningNow: number
  shed: number
}

/** Per-tick telemetry sample (Fleet Week incident panels). */
export interface TickSample {
  tick: number
  waiting: number
  running: number
  completed: number
  sloMet: number
  shed: number
  autoPreempts: number
  capMisses: number
  freeBlocks: number
  ttftP95: number
}

interface EngineSeq {
  spec: RequestSpec
  prefillLeft: number
  decoded: number
  ttft?: number
  firstTokenTick?: number
  lastDecodeTick?: number
  maxGap?: number
}

const p95 = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] : 0

/**
 * The engine simulator. One instance per stack under test; same traffic,
 * same rules — the only difference is which scheduler/manager drivers are
 * plugged in. Legality violations by the scheduler are reported, not
 * enforced silently.
 */
export class Engine {
  tick = 0
  cfg: EngineConfig
  private stream: RequestSpec[]
  private sched: SchedulerDriver
  private mgr: ManagerDriver
  private intake: QueueDriver | null
  private intakeShadow: QueueDriver | null
  private drainPerTick: number
  private byId = new Map<number, RequestSpec>()
  private shed = 0
  private inQueue = 0
  divergence: string[] = []
  private waiting: RequestSpec[] = []
  private running: EngineSeq[] = []
  private ttfts: number[] = []
  private completed = 0
  private sloMet = 0
  private autoPreempts = 0
  private capacityMisses = 0
  private streamIdx = 0
  /** optional per-tick telemetry hook (Fleet Week incident panels) */
  recorder: ((s: TickSample) => void) | null = null
  /** prefillOnly mode: specs whose prefill completed, ready for transfer */
  prefillDoneOut: RequestSpec[] = []
  violations: string[] = []

  constructor(
    cfg: EngineConfig,
    stream: RequestSpec[],
    sched: SchedulerDriver,
    mgr: ManagerDriver,
    opts?: { intake?: QueueDriver; intakeShadow?: QueueDriver; drainPerTick?: number },
  ) {
    this.cfg = cfg
    this.stream = stream
    this.sched = sched
    this.mgr = mgr
    this.intake = opts?.intake ?? null
    this.intakeShadow = opts?.intakeShadow ?? null
    this.drainPerTick = opts?.drainPerTick ?? 32
    for (const r of stream) this.byId.set(r.id, r)
  }

  get done(): boolean {
    return (
      this.killed ||
      (this.streamIdx >= this.stream.length &&
        this.waiting.length === 0 &&
        this.running.length === 0 &&
        this.inQueue === 0)
    )
  }

  /** true once kill() fired — the node is gone; in-flight work was shed */
  killed = false

  /** Node death: in-flight requests are LOST (their KV dies with the node). */
  kill(): number {
    const lost = this.waiting.length + this.running.length + this.inQueue
    this.shed += lost
    this.waiting = []
    this.running = []
    this.inQueue = 0
    this.killed = true
    return lost
  }

  /**
   * EPD decode side: a transferred seq goes straight into decode — no
   * intake, no scheduler, NO re-prefill. Returns false when the decode
   * pool can't cover the KV yet (the cluster retries next tick — that
   * delay is the disaggregation budget overrun, made visible).
   */
  injectDecode(r: RequestSpec): boolean {
    this.byId.set(r.id, r)
    // decode-pool admission control: blocks + growth headroom, same rule
    // the scheduler enforces — without it, transfers thrash the pool
    const need = Math.ceil(r.prompt / this.cfg.blockSize) + Math.ceil(HEADROOM_TOKENS / this.cfg.blockSize)
    if (this.mgr.freeBlocks() < need) return false
    if (!this.mgr.allocate(r.id, r.prompt)) return false
    this.running.push({ spec: r, prefillLeft: 0, decoded: 0 })
    return true
  }

  mgrDump(): ManagerDump {
    return this.mgr.dump()
  }

  /** free blocks in this worker's pool (router/EPD placement signal) */
  freeBlocks(): number {
    return this.mgr.freeBlocks()
  }

  get memUsedTokens(): number {
    return (this.cfg.numBlocks - this.mgr.freeBlocks()) * this.cfg.blockSize
  }

  /** Inject an arrival (used by step's own stream loop and by Cluster routing). */
  inject(r: RequestSpec): void {
    this.byId.set(r.id, r)
    if (this.intake) {
      const ok = this.intake.push(r.id)
      const shadow = this.intakeShadow?.push(r.id)
      if (this.intakeShadow && ok !== shadow) {
        this.divergence.push(`t${this.tick}: queue push(${r.id}) → ${ok} but reference ${shadow} — backpressure dishonesty`)
      }
      if (!ok) this.shed++
      else this.inQueue++
    } else {
      this.waiting.push(r)
    }
  }

  step(): void {
    const t = this.tick
    for (; this.streamIdx < this.stream.length && this.stream[this.streamIdx].arrival <= t; this.streamIdx++) {
      this.inject(this.stream[this.streamIdx])
    }
    if (this.intake) {
      for (let i = 0; i < this.drainPerTick; i++) {
        const id = this.intake.pop()
        const shadowId = this.intakeShadow?.pop()
        if (this.intakeShadow && id !== shadowId) {
          this.divergence.push(`t${t}: queue pop → ${id ?? 'empty'} but reference ${shadowId ?? 'empty'} — FIFO violated`)
        }
        if (id == null) break
        this.inQueue--
        const spec = this.byId.get(id)
        if (spec) this.waiting.push(spec)
      }
    }
    const view: SchedView = {
      iter: t,
      maxRunning: this.cfg.maxRunning,
      memCap: this.cfg.numBlocks * this.cfg.blockSize,
      memUsed: this.memUsedTokens,
      waiting: this.waiting.map((r) => ({ id: r.id, arrival: r.arrival, prompt: r.prompt })),
      running: this.running.map((s) => ({
        id: s.spec.id,
        arrival: s.spec.arrival,
        prompt: s.spec.prompt,
        decoded: s.decoded,
        prefillLeft: s.prefillLeft,
      })),
    }
    const action = this.sched.schedule(view)

    // legality
    const waitingIds = new Set(this.waiting.map((r) => r.id))
    const runningIds = new Set(this.running.map((s) => s.spec.id))
    for (const id of action.admit) {
      if (!waitingIds.has(id)) this.violations.push(`t${t}: scheduler admitted non-waiting id ${id}`)
    }
    for (const id of action.preempt) {
      if (!runningIds.has(id)) this.violations.push(`t${t}: scheduler preempted non-running id ${id}`)
    }
    const legalAdmit = action.admit.filter((id) => waitingIds.has(id))
    if (this.running.length + legalAdmit.length - action.preempt.length > this.cfg.maxRunning) {
      this.violations.push(`t${t}: action exceeds max_running ${this.cfg.maxRunning}`)
    }

    // preempt (progress discarded — recompute mode)
    for (const id of action.preempt) {
      const i = this.running.findIndex((s) => s.spec.id === id)
      if (i < 0) continue
      const [s] = this.running.splice(i, 1)
      this.mgr.free(id)
      this.waiting.push(s.spec)
    }
    // admit through the block manager — over-admission degrades to a miss
    for (const id of legalAdmit) {
      if (this.running.length >= this.cfg.maxRunning) break
      const i = this.waiting.findIndex((r) => r.id === id)
      if (i < 0) continue
      const spec = this.waiting[i]
      if (this.mgr.allocate(id, spec.prompt)) {
        this.waiting.splice(i, 1)
        this.running.push({ spec, prefillLeft: Math.ceil(spec.prompt / this.cfg.prefillChunk), decoded: 0 })
      } else {
        this.capacityMisses++
      }
    }

    // progress: prefill chunk/iter, then 1 token/iter via the manager
    // ITL coupling: the iteration budget is shared — with P prefills in
    // flight, decode appends land every (P+1)th tick. The convoy EPD
    // eliminates by splitting pools.
    const prefilling = this.cfg.interference
      ? this.running.filter((s) => s.prefillLeft > 0).length
      : 0
    const decodeEvery = 1 + prefilling
    const still: EngineSeq[] = []
    for (const s of this.running) {
      if (s.prefillLeft > 0) {
        s.prefillLeft -= 1
        if (s.prefillLeft === 0) {
          if (this.cfg.prefillOnly) {
            // EPD: KV goes on the wire — the prefill pool frees now, the
            // decode pool pays the block cost when the transfer lands
            this.mgr.free(s.spec.id)
            this.prefillDoneOut.push(s.spec)
            continue
          }
          s.decoded = 1
          s.ttft = t - s.spec.arrival
          s.firstTokenTick = t
        }
        still.push(s)
        continue
      }
      if ((t + s.spec.id) % decodeEvery !== 0) {
        // iteration slot consumed by prefill — ITL inflates
        still.push(s)
        continue
      }
      if (!this.mgr.append(s.spec.id, 1)) {
        // allocation failure mid-decode → auto-preempt (vLLM recompute mode)
        this.mgr.free(s.spec.id)
        this.waiting.push(s.spec)
        this.autoPreempts++
        continue
      }
      if (s.ttft === undefined) {
        // transferred seq (decode worker): first token lands here
        s.ttft = t - s.spec.arrival
        s.firstTokenTick = t
      }
      if (s.lastDecodeTick !== undefined) {
        s.maxGap = Math.max(s.maxGap ?? 0, t - s.lastDecodeTick)
      }
      s.lastDecodeTick = t
      s.decoded += 1
      if (s.decoded >= s.spec.output) {
        this.mgr.free(s.spec.id)
        this.completed++
        this.ttfts.push(s.ttft ?? Number.MAX_SAFE_INTEGER)
        const ttftOk = (s.ttft ?? Infinity) <= this.cfg.sloTtft
        const itlOk = this.cfg.sloItl === undefined || (s.maxGap ?? 0) <= this.cfg.sloItl
        if (ttftOk && itlOk) this.sloMet++
      } else {
        still.push(s)
      }
    }
    this.running = still
    this.tick++
    this.recorder?.({
      tick: t,
      waiting: this.waiting.length,
      running: this.running.length,
      completed: this.completed,
      sloMet: this.sloMet,
      shed: this.shed,
      autoPreempts: this.autoPreempts,
      capMisses: this.capacityMisses,
      freeBlocks: this.mgr.freeBlocks(),
      ttftP95: this.ttftP95(),
    })
  }

  stats(): EngineStats {
    return {
      completed: this.completed,
      sloMet: this.sloMet,
      ttfts: this.ttfts,
      autoPreempts: this.autoPreempts,
      capacityMisses: this.capacityMisses,
      waitingNow: this.waiting.length,
      runningNow: this.running.length,
      shed: this.shed,
    }
  }

  goodput(total: number): number {
    return total ? Math.round((this.sloMet / total) * 1000) / 10 : 0
  }

  ttftP95(): number {
    return p95(this.ttfts)
  }
}

/* ------------------------------ cluster ------------------------------ */

export type RouterKind = 'rr' | 'jsq'

/**
 * A fleet of engines behind a router. Each worker is a full Engine (its
 * own scheduler, block manager, intake queue); the router assigns each
 * arrival to a worker — round-robin or join-shortest-queue (by
 * waiting+running depth). The mega-scale lesson: what the routing layer
 * knows determines what the workers waste.
 */
export class Cluster {
  tick = 0
  private streamIdx = 0
  private rrCursor = 0
  private stream: RequestSpec[]
  public workers: Engine[]
  public router: RouterKind

  constructor(stream: RequestSpec[], workers: Engine[], router: RouterKind) {
    this.stream = stream
    this.workers = workers
    this.router = router
  }

  get done(): boolean {
    return this.streamIdx >= this.stream.length && this.workers.every((w) => w.done)
  }

  private pick(): Engine {
    if (this.router === 'rr') {
      const alive = this.workers.filter((w) => !w.killed)
      const w = alive[this.rrCursor % alive.length]
      this.rrCursor++
      return w
    }
    // jsq: shallowest backlog (waiting + running)
    let best = this.workers[0]
    let bestLoad = Infinity
    for (const w of this.workers) {
      if (w.killed) continue
      const s = w.stats()
      const load = s.waitingNow + s.runningNow
      if (load < bestLoad) {
        bestLoad = load
        best = w
      }
    }
    return best
  }

  /** optional per-tick disruption hook (Fleet Week): called before arrivals */
  disrupt: ((c: Cluster, tick: number) => void) | null = null

  step(): void {
    const t = this.tick
    this.disrupt?.(this, t)
    for (; this.streamIdx < this.stream.length && this.stream[this.streamIdx].arrival <= t; this.streamIdx++) {
      const alive = this.workers.some((w) => !w.killed)
      if (alive) this.pick().inject(this.stream[this.streamIdx])
    }
    for (const w of this.workers) if (!w.killed) w.step()
    this.tick++
  }

  aggregate(): { completed: number; sloMet: number; shed: number; autoPreempts: number; capMisses: number } {
    const a = { completed: 0, sloMet: 0, shed: 0, autoPreempts: 0, capMisses: 0 }
    for (const w of this.workers) {
      const s = w.stats()
      a.completed += s.completed
      a.sloMet += s.sloMet
      a.shed += s.shed
      a.autoPreempts += s.autoPreempts
      a.capMisses += s.capacityMisses
    }
    return a
  }
}

/* --------------------------- EPD cluster --------------------------- */

export interface EpdConfig {
  prefillCfg: EngineConfig
  decodeCfg: EngineConfig
  /** KV transfer rate, tokens/tick — the fabric's budget line */
  transferRate: number
}

interface Transfer {
  spec: RequestSpec
  readyAt: number
}

/**
 * Encode-Prefill-Decode's P/D split as a first-class topology: prefill
 * workers produce KV, a timed transfer moves it (prefill pool frees at
 * send; decode pool pays at receive), decode workers run the long tail.
 * The disaggregation lesson made executable: TTFT pays the transfer, ITL
 * gains the isolation — and the metrics say which won.
 */
export class EpdCluster {
  tick = 0
  private streamIdx = 0
  transfers: Transfer[] = []
  transferDelays: number[] = []
  totalTransferred = 0
  private stream: RequestSpec[]
  public prefillWorkers: Engine[]
  public decodeWorkers: Engine[]
  public cfg: EpdConfig

  constructor(stream: RequestSpec[], prefillWorkers: Engine[], decodeWorkers: Engine[], cfg: EpdConfig) {
    this.stream = stream
    this.prefillWorkers = prefillWorkers
    this.decodeWorkers = decodeWorkers
    this.cfg = cfg
  }

  get done(): boolean {
    return (
      this.streamIdx >= this.stream.length &&
      this.prefillWorkers.every((w) => w.done) &&
      this.transfers.length === 0 &&
      this.decodeWorkers.every((w) => w.done)
    )
  }

  private pickPrefill(): Engine {
    let best = this.prefillWorkers[0]
    let bestLoad = Infinity
    for (const w of this.prefillWorkers) {
      const s = w.stats()
      const load = s.waitingNow + s.runningNow
      if (load < bestLoad) {
        bestLoad = load
        best = w
      }
    }
    return best
  }

  private pickDecode(): Engine {
    let best = this.decodeWorkers[0]
    let bestFree = -1
    for (const w of this.decodeWorkers) {
      const free = w.freeBlocks()
      if (free > bestFree) {
        bestFree = free
        best = w
      }
    }
    return best
  }

  step(): void {
    const t = this.tick
    for (; this.streamIdx < this.stream.length && this.stream[this.streamIdx].arrival <= t; this.streamIdx++) {
      this.pickPrefill().inject(this.stream[this.streamIdx])
    }
    for (const w of this.prefillWorkers) {
      w.step()
      if (w.prefillDoneOut.length > 0) {
        for (const spec of w.prefillDoneOut.splice(0)) {
          this.transfers.push({ spec, readyAt: t + Math.ceil(spec.prompt / this.cfg.transferRate) })
          this.totalTransferred++
        }
      }
    }
    // land due transfers; a full decode pool delays them (the overrun lesson)
    const pending: Transfer[] = []
    for (const tr of this.transfers) {
      if (tr.readyAt > t) {
        pending.push(tr)
        continue
      }
      const target = this.pickDecode()
      if (target.injectDecode(tr.spec)) {
        this.transferDelays.push(t - tr.readyAt)
      } else {
        pending.push(tr)
      }
    }
    this.transfers = pending
    for (const w of this.decodeWorkers) w.step()
    this.tick++
  }

  aggregate(): { completed: number; sloMet: number; shed: number; autoPreempts: number; avgDelay: number; ttftP95: number; inFlight: number } {
    let completed = 0
    let sloMet = 0
    let shed = 0
    let autoPreempts = 0
    let ttfts: number[] = []
    for (const w of [...this.prefillWorkers, ...this.decodeWorkers]) {
      const s = w.stats()
      completed += s.completed
      sloMet += s.sloMet
      shed += s.shed
      autoPreempts += s.autoPreempts
      ttfts = ttfts.concat(s.ttfts)
    }
    const avgDelay = this.transferDelays.length
      ? Math.round((this.transferDelays.reduce((a, b) => a + b, 0) / this.transferDelays.length) * 10) / 10
      : 0
    return {
      completed,
      sloMet,
      shed,
      autoPreempts,
      avgDelay,
      ttftP95: p95(ttfts),
      inFlight: this.transfers.length,
    }
  }
}

/** An intake queue implementation: JS reference or wasm bridge adapter. */
export interface QueueDriver {
  name: string
  /** false = full → the request is shed */
  push(v: number): boolean
  pop(): number | null
}

/** JS reference bounded FIFO queue (capacity-honest). */
export function makeRefQueue(capacity: number): QueueDriver {
  const buf: number[] = []
  return {
    name: 'reference',
    push(v) {
      if (buf.length >= capacity) return false
      buf.push(v)
      return true
    },
    pop() {
      return buf.length ? (buf.shift() as number) : null
    },
  }
}

/**
 * A deterministic "day in the fleet" script: chat-ish arrivals over
 * `ticks` ticks; ~1 in 5 sequences forks once mid-life (beam search);
 * completions free. Sizes tuned so a 64-block × 16-token pool hovers
 * around 70–90% — pressure without deadlock.
 */
export function makeScript(ticks: number, intensity: number): FleetOp[][] {
  const rng = makeRng(0xf1e37)
  const timeline: FleetOp[][] = Array.from({ length: ticks }, () => [])
  const live: { id: number; left: number; forked: boolean }[] = []
  let nextId = 1
  for (let t = 0; t < ticks; t++) {
    // arrivals
    const arrivals = Math.round((rng() % 100) / 100 < 0.34 * intensity ? 1 + (rng() % 2) : 0)
    for (let i = 0; i < arrivals && live.length < 40; i++) {
      const id = nextId++
      const prompt = 16 + (rng() % 185) // 16..200 tokens → 1..13 blocks
      timeline[t].push({ kind: 'allocate', a: id, n: prompt })
      live.push({ id, left: 12 + (rng() % 49), forked: false })
    }
    // progress + forks + completions
    for (let i = live.length - 1; i >= 0; i--) {
      const s = live[i]
      const step = 1 + (rng() % 3)
      timeline[t].push({ kind: 'append', a: s.id, n: Math.min(step, s.left) })
      s.left -= step
      if (!s.forked && s.left > 6 && rng() % 100 < 18) {
        timeline[t].push({ kind: 'fork', a: s.id, b: nextId })
        live.push({ id: nextId++, left: 8 + (rng() % 20), forked: true })
        s.forked = true
      }
      if (s.left <= 0) {
        timeline[t].push({ kind: 'free', a: s.id })
        live.splice(i, 1)
      }
    }
  }
  // drain anything left
  for (const s of live) timeline[ticks - 1].push({ kind: 'free', a: s.id })
  return timeline
}
