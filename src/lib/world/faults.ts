/**
 * world/faults — fault physics for the Fleet engine, as data (docs/specs/wave-2.md §9.1, task 2b-03).
 *
 * A `FaultSpec` is plain data: it crosses the worker boundary (W10) and is interpreted inside the
 * run by `makeFaultInjector`, which drives the Engine and Cluster hooks in fleet-model.ts (usable
 * blocks, drain rate, tenant tags, step slowdown, scheduler override, route, cordon, revive). Every
 * kind has an onset (`atTick`, or `fromTick` for the two load events) and an optional `untilTick`,
 * the tick its fix lands (`FAULT_FIXES`). Ticks are cluster ticks.
 *
 * This file imports only types from fleet-model.ts, so a page-side module (world/incident-spec)
 * can read the kinds, fixes and validation without pulling the engine into its bundle.
 *
 * tests/world/faults.test.ts holds each kind to the direction of effect its catalog entry
 * (§9.2) claims, on 32 graded seeds, and holds a run with no faults byte-identical to before.
 */

import type { Cluster, Engine, SchedAction, SchedOverride, SchedView, RequestSpec } from '@/lib/fleet-model'

export type FaultSpec =
  /** in-flight work on the worker is lost and the router skips it; fix `replace-node` (a fresh worker joins) */
  | { kind: 'node-death'; worker: number; atTick: number; untilTick?: number }
  /** extra arrivals slammed into a random live worker every `every` ticks; a load event, not a fault (`untilTick` ends it early) */
  | { kind: 'flash-crowd'; fromTick: number; toTick: number; every: number; untilTick?: number }
  /** usable KV blocks drop to `blocks` (a misconfigured memory fraction); fix `restore-pool` */
  | { kind: 'pool-shrink'; worker: number | 'all'; atTick: number; blocks: number; untilTick?: number }
  /** every worker's intake drains `perTick` requests per tick (fractions accrue); fix `restore-drain` */
  | { kind: 'drain-stall'; atTick: number; perTick: number; untilTick?: number }
  /**
   * tenant `BURST_TENANT` sends a `prompt`-token request every `every` ticks through the router, with short
   * answers (4–12 tokens: summarisation or retrieval traffic), so its long prefills keep stalling everyone
   * else's decode steps; fix `limit-tenant` caps its admissions. The burst itself runs to `toTick`.
   */
  | { kind: 'tenant-burst'; fromTick: number; toTick: number; every: number; prompt: number; untilTick?: number }
  /** the worker runs an iteration only every `every` ticks; fix `drain-node` routes new work around it */
  | { kind: 'straggler'; worker: number; atTick: number; every: number; untilTick?: number }
  /** the scheduler loses its decode headroom (a config regression); fix `restore-headroom` */
  | { kind: 'admission-greedy'; atTick: number; untilTick?: number }

export type FaultKind = FaultSpec['kind']

export const FAULT_KINDS: readonly FaultKind[] = [
  'node-death',
  'flash-crowd',
  'pool-shrink',
  'drain-stall',
  'tenant-burst',
  'straggler',
  'admission-greedy',
]

/** The fix that reverts each kind at its `untilTick` (§9.1's Revert column); a flash crowd is load, so it has none. */
export const FAULT_FIXES: Record<FaultKind, string | null> = {
  'node-death': 'replace-node',
  'flash-crowd': null,
  'pool-shrink': 'restore-pool',
  'drain-stall': 'restore-drain',
  'tenant-burst': 'limit-tenant',
  straggler: 'drain-node',
  'admission-greedy': 'restore-headroom',
}

/** The tenant a tenant-burst's requests carry (untagged traffic is tenant 0). */
export const BURST_TENANT = 1
/** `limit-tenant`: the burst tenant's requests running at once on one worker. */
export const TENANT_CAP = 1
/** Tenant-burst request ids start here: above flash-crowd ids (10000 + tick × 10 + 9 < 1e6 within 20,000 ticks), below ballast. */
export const TENANT_ID_BASE = 1_000_000
/** Fleet-model's GUARD_AGE, repeated so this file stays free of value imports (the test checks they agree). */
export const GREEDY_GUARD_AGE = 2000

/** The tick a fault starts. */
export function faultOnset(f: FaultSpec): number {
  return f.kind === 'flash-crowd' || f.kind === 'tenant-burst' ? f.fromTick : f.atTick
}

/** The tick its fix lands, if one does. */
export function faultUntil(f: FaultSpec): number | undefined {
  return f.untilTick
}

/** Whether the fault is in effect at `tick` (the burst windows of the two load kinds aside). */
export function faultActive(f: FaultSpec, tick: number): boolean {
  return tick >= faultOnset(f) && (f.untilTick === undefined || tick < f.untilTick)
}

const wholeTick = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0

/** What is wrong with a FaultSpec read from outside (a worker message, a stored incident); [] when it is sound. */
export function faultSpecProblems(f: FaultSpec, workers?: number): string[] {
  const out: string[] = []
  if (!FAULT_KINDS.includes(f.kind)) return [`unknown fault kind "${String(f.kind)}"`]
  const onset = faultOnset(f)
  if (!wholeTick(onset)) out.push('onset must be a whole tick >= 0')
  if (f.untilTick !== undefined && (!wholeTick(f.untilTick) || f.untilTick <= onset)) out.push('untilTick must be a whole tick after the onset')
  const worker = (w: number) => {
    if (!wholeTick(w) || (workers !== undefined && w >= workers)) out.push(`no worker ${w}`)
  }
  switch (f.kind) {
    case 'node-death':
      worker(f.worker)
      break
    case 'flash-crowd':
    case 'tenant-burst':
      if (!wholeTick(f.toTick) || f.toTick < f.fromTick) out.push('toTick must be a whole tick >= fromTick')
      if (!Number.isInteger(f.every) || f.every < 1) out.push('every must be a whole number >= 1')
      if (f.kind === 'tenant-burst' && (!Number.isInteger(f.prompt) || f.prompt < 1)) out.push('prompt must be a whole number of tokens >= 1')
      break
    case 'pool-shrink':
      if (f.worker !== 'all') worker(f.worker)
      if (!wholeTick(f.blocks)) out.push('blocks must be a whole number >= 0')
      break
    case 'drain-stall':
      if (typeof f.perTick !== 'number' || !Number.isFinite(f.perTick) || f.perTick < 0) out.push('perTick must be a number >= 0')
      break
    case 'straggler':
      worker(f.worker)
      if (!Number.isInteger(f.every) || f.every < 2) out.push('every must be a whole number >= 2')
      break
    case 'admission-greedy':
      break
  }
  return out
}

/**
 * The reference policy with its decode headroom gone (admission-greedy): smallest prompt first behind
 * the same FIFO age guard, fitting prompts only, so decode growth overflows the pool and auto-preempts.
 * It stands in for whatever scheduler is plugged, as a config regression the module cannot opt out of.
 */
export function headroomlessSchedule(v: SchedView): SchedAction {
  let used = v.running.reduce((a, r) => a + r.prompt + r.decoded, 0)
  let slots = v.maxRunning - v.running.length
  const scored = [...v.waiting].sort((a, b) => {
    const aa = v.iter - a.arrival > GREEDY_GUARD_AGE
    const ab = v.iter - b.arrival > GREEDY_GUARD_AGE
    if (aa !== ab) return aa ? -1 : 1
    if (aa && ab) return a.arrival - b.arrival
    return a.prompt - b.prompt || a.arrival - b.arrival
  })
  const admit: number[] = []
  for (const r of scored) {
    if (slots === 0) break
    if (used + r.prompt > v.memCap) continue
    admit.push(r.id)
    slots -= 1
    used += r.prompt
  }
  return { admit, preempt: [] }
}

/** The override for a worker's active admission faults: a tenant cap filters the view and trims admits; greedy swaps the policy. */
function makeOverride(engine: Engine, greedy: boolean, cap: number | null): SchedOverride {
  return (view, base) => {
    let v = view
    let allow = Infinity
    if (cap !== null) {
      const running = view.running.filter((r) => engine.tenantOf(r.id) === BURST_TENANT).length
      allow = Math.max(0, cap - running)
      if (allow === 0) v = { ...view, waiting: view.waiting.filter((r) => engine.tenantOf(r.id) !== BURST_TENANT) }
    }
    const action = greedy ? headroomlessSchedule(v) : base.schedule(v)
    if (allow === Infinity) return action
    let left = allow
    return { admit: action.admit.filter((id) => engine.tenantOf(id) !== BURST_TENANT || left-- > 0), preempt: action.preempt }
  }
}

/** One fault transition, for incident logs and probes. */
export interface FaultEvent {
  tick: number
  kind: FaultKind
  phase: 'onset' | 'revert'
  /** the worker it hit, when it hit one */
  worker?: number
}

/** Kinds that set Engine/Cluster state each tick (the rest are events). */
const STATEFUL: ReadonlySet<FaultKind> = new Set(['pool-shrink', 'drain-stall', 'tenant-burst', 'straggler', 'admission-greedy'])

const hits = (target: number | 'all', w: number) => target === 'all' || target === w

/**
 * Interpret FaultSpecs as a Cluster.disrupt hook. `events` (human lines), `timeline` (transitions)
 * and `injected()` (extra arrivals: flash crowd and tenant burst) report what fired.
 *
 * The node-death and flash-crowd branches are Wave 1's, draw for draw, so Fleet Week's Act II
 * (and every graded seed's baseline) replays exactly. `rng` feeds the flash crowd only; the other
 * kinds draw nothing, so adding one to a list never shifts another's stream.
 */
export function makeFaultInjector(faults: readonly FaultSpec[], rng: () => number) {
  const events: string[] = []
  const timeline: FaultEvent[] = []
  let injected = 0
  let tenantSeq = 0
  const stateful = faults.some((f) => STATEFUL.has(f.kind))
  const started = faults.map(() => false)
  const reverted = faults.map(() => false)
  const overrides = new WeakMap<Engine, { key: string; fn: SchedOverride | null }>()

  const log = (f: FaultSpec, i: number, t: number, worker?: number) => {
    if (!started[i] && t >= faultOnset(f)) {
      started[i] = true
      timeline.push({ tick: t, kind: f.kind, phase: 'onset', ...(worker === undefined ? {} : { worker }) })
      return 'onset'
    }
    if (started[i] && !reverted[i] && f.untilTick !== undefined && t >= f.untilTick) {
      reverted[i] = true
      timeline.push({ tick: t, kind: f.kind, phase: 'revert', ...(worker === undefined ? {} : { worker }) })
      return 'revert'
    }
    return null
  }

  /** Every live worker's hooks, recomputed from the faults in effect at `t` (idempotent: setters ignore no-op changes). */
  const applyState = (c: Cluster, t: number) => {
    for (let w = 0; w < c.workers.length; w++) {
      const engine = c.workers[w]
      if (engine.killed) continue
      let usable: number | null = null
      let drain: number | null = null
      let slow: number | null = null
      let greedy = false
      let cap: number | null = null
      for (const f of faults) {
        const fixed = f.untilTick !== undefined && t >= f.untilTick
        if (f.kind === 'pool-shrink') {
          if (faultActive(f, t) && hits(f.worker, w)) usable = Math.min(usable ?? Infinity, f.blocks)
        } else if (f.kind === 'drain-stall') {
          if (faultActive(f, t)) drain = Math.min(drain ?? Infinity, f.perTick)
        } else if (f.kind === 'admission-greedy') {
          if (faultActive(f, t)) greedy = true
        } else if (f.kind === 'straggler') {
          // the node stays slow after its fix: drain-node only stops new work reaching it
          if (w === f.worker && t >= f.atTick) slow = Math.max(slow ?? 1, f.every)
          if (w === f.worker && fixed) c.cordon(w)
        } else if (f.kind === 'tenant-burst') {
          // the burst keeps arriving after its fix; limit-tenant caps what each worker admits of it
          if (fixed) cap = TENANT_CAP
        }
      }
      engine.setUsableBlocks(usable)
      engine.setDrain(drain)
      engine.setSlowdown(slow)
      const key = `${greedy}|${cap}`
      const had = overrides.get(engine)
      if (!had || had.key !== key || had.fn !== engine.schedOverride) {
        const fn = greedy || cap !== null ? makeOverride(engine, greedy, cap) : null
        engine.schedOverride = fn
        overrides.set(engine, { key, fn })
      }
    }
  }

  const disrupt = (c: Cluster, t: number) => {
    for (const [i, f] of faults.entries()) {
      if (f.kind === 'node-death') {
        // in-flight work on the dying worker is lost
        if (t === f.atTick && c.workers.length > 1 && !c.workers[f.worker].killed) {
          const lost = c.workers[f.worker].kill()
          events.push(`t${f.atTick}: NODE DEATH — worker ${f.worker} lost with ${lost} in-flight requests`)
          started[i] = true
          timeline.push({ tick: t, kind: f.kind, phase: 'onset', worker: f.worker })
        }
        if (t === f.untilTick && started[i] && c.revive(f.worker)) {
          events.push(`t${t}: REPLACE NODE — a fresh worker ${f.worker} joins`)
          reverted[i] = true
          timeline.push({ tick: t, kind: f.kind, phase: 'revert', worker: f.worker })
        }
      } else if (f.kind === 'flash-crowd') {
        if (t >= f.fromTick && t <= f.toTick && t % f.every === 0 && (f.untilTick === undefined || t < f.untilTick)) {
          // extra arrivals slammed into the surviving fleet
          const alive = c.workers.filter((w) => !w.killed)
          if (alive.length > 0) {
            const w = alive[rng() % alive.length]
            w.inject({ id: 10000 + t * 10 + (rng() % 10), arrival: t, prompt: 64 + (rng() % 193), output: 16 + (rng() % 33) })
            injected++
          }
        }
      } else if (f.kind === 'tenant-burst') {
        const phase = log(f, i, t)
        if (phase === 'onset') events.push(`t${t}: TENANT BURST — tenant ${BURST_TENANT} sends ${f.prompt}-token prompts every ${f.every} ticks`)
        if (phase === 'revert') events.push(`t${t}: LIMIT TENANT — tenant ${BURST_TENANT} capped at ${TENANT_CAP} running per worker`)
        if (t >= f.fromTick && t <= f.toTick && (t - f.fromTick) % f.every === 0) {
          const n = tenantSeq++
          const request: RequestSpec = { id: TENANT_ID_BASE + n, arrival: t, prompt: f.prompt, output: 4 + (n % 9), tenant: BURST_TENANT }
          if (c.route(request) >= 0) injected++
        }
      } else {
        const worker = f.kind === 'straggler' ? f.worker : f.kind === 'pool-shrink' && f.worker !== 'all' ? f.worker : undefined
        const phase = log(f, i, t, worker)
        if (phase) events.push(`t${t}: ${describe(f, phase)}`)
      }
    }
    if (stateful) applyState(c, t)
  }
  return { disrupt, events, timeline, injected: () => injected }
}

function describe(f: FaultSpec, phase: 'onset' | 'revert'): string {
  switch (f.kind) {
    case 'pool-shrink': {
      const where = f.worker === 'all' ? 'every worker' : `worker ${f.worker}`
      return phase === 'onset' ? `POOL SHRINK — ${where} down to ${f.blocks} usable KV blocks` : `RESTORE POOL — ${where} back to its full pool`
    }
    case 'drain-stall':
      return phase === 'onset' ? `DRAIN STALL — intake drains ${f.perTick} requests per tick` : 'RESTORE DRAIN — intake back to its configured drain'
    case 'straggler':
      return phase === 'onset' ? `STRAGGLER — worker ${f.worker} steps every ${f.every} ticks` : `DRAIN NODE — new work routed around worker ${f.worker}`
    case 'admission-greedy':
      return phase === 'onset' ? 'ADMISSION GREEDY — the scheduler lost its decode headroom' : 'RESTORE HEADROOM — the scheduler budgets decode growth again'
    default:
      return f.kind
  }
}
