/**
 * Property-test harness for the ledger core (spec §13). No browser globals: everything here
 * and in src/lib/ledger runs under plain `bun test`.
 *
 * - splitmix32 drives every choice, so a seed replays exactly (`LEDGER_SEED=<n>`).
 * - Pools are fixed, so tests stay independent of content edits.
 * - Devices have their own tz and a deterministic id stream; the clock starts 2026-09-01T08:00Z.
 * - Ops mirror the façade actions (spec §8.3-8.4), including their skip rules.
 */
import { derive } from '../../src/lib/ledger/fold'
import { compareEvents, compareWorking, type Ledger } from '../../src/lib/ledger/merge'
import { stableStringify } from '../../src/lib/ledger/stable'
import { dayOf } from '../../src/lib/ledger/time'
import type {
  Confidence,
  LedgerEvent,
  Provenance,
  WorkingKey,
  WorkingRecord,
} from '../../src/lib/ledger/types'
import { splitmix32 } from '../../src/lib/rng'

export const SEEDS = Number(process.env.LEDGER_SEEDS ?? 100)
export const OPS = Number(process.env.LEDGER_OPS ?? 40)
const ONLY_SEED = process.env.LEDGER_SEED === undefined ? null : Number(process.env.LEDGER_SEED)

export const LESSONS = ['t0.l1', 't0.l2', 't0.l3', 't0.l4', 't0.l5', 't0.l6', 't5.l1', 't5.l2', 't5.l3', 't5.l4']
export const SIM = 'sim-kv'
export const SIM_TASKS = ['a', 'b', 'c']
export const LABS: Record<string, { checks: string[]; total: number }> = {
  'lab-a': { checks: ['c1', 'c2', 'c3', 'c4'], total: 4 },
  'lab-b': { checks: ['c1', 'c2'], total: 2 },
}
export const ACTS = ['engine', 'fleet', 'business', 'incident']
export const STEPS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7']
export const TZS = [-420, 0, 330, 540]
export const START_MS = Date.parse('2026-09-01T08:00:00.000Z')
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export type Rand = () => number
export const pick = <T>(rand: Rand, items: readonly T[]): T => items[Math.floor(rand() * items.length)]
export const int = (rand: Rand, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
export const chance = (rand: Rand, p: number) => rand() < p
export function shuffle<T>(rand: Rand, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

let handBuilt = 0

/** A hand-made event for unit tests: graded kinds get `score: 1, ok: true, provenance: 'practice'` unless `extra` says otherwise. */
export function evt(kind: LedgerEvent['kind'], ref: string, at: string, extra: Record<string, unknown> = {}, tz = 0): LedgerEvent {
  const graded = ['item', 'probe', 'quiz', 'predict', 'sim-task', 'lab-check', 'fleet-act', 'capstone-step'].includes(kind)
  return {
    id: `h${handBuilt++}`,
    v: 1,
    kind,
    ref,
    at,
    tz,
    day: dayOf(at, tz),
    dev: 'hand',
    ...(graded ? { score: 1, ok: true, provenance: 'practice' } : {}),
    ...extra,
  } as unknown as LedgerEvent
}

/** One simulated browser profile. */
export class SimDevice {
  events = new Map<string, LedgerEvent>()
  working = new Map<WorkingKey, WorkingRecord>()
  ms = START_MS
  private counter = 0
  /** `skips`: honour the façade's skip rules (needs the aggregate; slow, so the year generator turns it off). */
  skips = true

  constructor(
    readonly id: string,
    public tz: number,
    readonly rand: Rand,
    private trace: string[] = [],
  ) {}

  note(line: string) {
    this.trace.push(`${this.id}: ${line}`)
  }

  /** Start from another device's state (a shared base, or a synced copy). */
  adopt(ledger: Ledger, ms = this.ms) {
    for (const e of ledger.events) this.events.set(e.id, e)
    for (const r of ledger.working) this.working.set(r.key, r)
    this.ms = ms
    return this
  }

  advance(minutes: number) {
    this.ms += minutes * MINUTE
  }

  get iso() {
    return new Date(this.ms).toISOString()
  }

  get agg() {
    return derive(this.events.values())
  }

  ledger(): Ledger {
    return { events: [...this.events.values()], working: [...this.working.values()] }
  }

  /** Append one event; `extra` carries the kind-specific fields. */
  emit(kind: LedgerEvent['kind'], ref: string, extra: Record<string, unknown> = {}): LedgerEvent {
    const at = this.iso
    const e = {
      id: `${this.id}:${(this.counter++).toString(36)}`,
      v: 1,
      kind,
      ref,
      at,
      tz: this.tz,
      day: dayOf(at, this.tz),
      dev: this.id,
      ...extra,
    } as unknown as LedgerEvent
    this.events.set(e.id, e)
    return e
  }

  graded(kind: LedgerEvent['kind'], ref: string, score: number, ok: boolean, extra: Record<string, unknown> = {}) {
    return this.emit(kind, ref, { score, ok, provenance: 'practice' satisfies Provenance, ...extra })
  }

  setWorking(key: WorkingKey, value: WorkingRecord['value']) {
    this.working.set(key, { key, value, at: this.iso, dev: this.id })
  }
}

type OpFn = (d: SimDevice) => string | null

const maybeConf = (rand: Rand): { conf?: Confidence } =>
  chance(rand, 0.6) ? { conf: pick(rand, ['guess', 'think', 'sure'] as const) } : {}

const OPS_TABLE: { weight: number; name: string; run: OpFn }[] = [
  {
    weight: 6,
    name: 'visit-lesson',
    run: (d) => {
      const id = pick(d.rand, LESSONS)
      const last = d.skips ? d.agg.lessons[id]?.lastAt : undefined
      if (last && dayOf(last, d.tz) === dayOf(d.iso, d.tz)) return null
      d.emit('visit', `lesson:${id}`)
      return id
    },
  },
  {
    weight: 4,
    name: 'complete-lesson',
    run: (d) => {
      const id = pick(d.rand, LESSONS)
      if (d.skips && d.agg.lessons[id]?.done) return null
      d.emit('complete', `lesson:${id}`)
      return id
    },
  },
  {
    weight: 6,
    name: 'quiz-attempt',
    run: (d) => {
      const id = pick(d.rand, LESSONS)
      const n = int(d.rand, 3, 5)
      const grp = `${d.id}:g${d.ms}`
      let correct = 0
      for (let qi = 0; qi < n; qi++) {
        const ok = chance(d.rand, 0.7)
        if (ok) correct += 1
        d.graded('item', `quiz:${id}#${qi}`, ok ? 1 : 0, ok, {
          rev: `r${qi}`,
          ...maybeConf(d.rand),
          data: { src: 'quiz', pick: [int(d.rand, 0, 3)], grp, lessonId: id },
        })
      }
      const score = correct / n
      d.graded('quiz', `lesson:${id}`, score, score >= 0.8, { data: { grp, n } })
      return `${id} ${correct}/${n}`
    },
  },
  {
    weight: 2,
    name: 'exercise',
    run: (d) => {
      const id = pick(d.rand, LESSONS)
      if (d.skips && d.agg.lessons[id]?.exercise) return null
      d.emit('exercise', `lesson:${id}`)
      return id
    },
  },
  {
    weight: 3,
    name: 'sim-visit',
    run: (d) => {
      d.emit('visit', `sim:${SIM}`)
      return SIM
    },
  },
  {
    weight: 3,
    name: 'sim-task',
    run: (d) => {
      const t = pick(d.rand, SIM_TASKS)
      if (d.skips && d.agg.sims[SIM]?.tasks[t]) return null
      d.graded('sim-task', `sim:${SIM}/${t}`, 1, true)
      return t
    },
  },
  {
    weight: 4,
    name: 'lab-run',
    run: (d) => {
      const lab = pick(d.rand, Object.keys(LABS))
      const { checks, total } = LABS[lab]
      const passed = shuffle(d.rand, checks).slice(0, int(d.rand, 0, checks.length))
      const known = d.skips ? Object.keys(d.agg.labs[lab]?.checks ?? {}) : []
      const done = new Set([...known, ...passed]).size >= total || (!d.skips && passed.length === total)
      d.graded('lab-check', `lab:${lab}`, passed.length / total, done, {
        provenance: 'lab-green',
        data: { passed, total },
        ...(chance(d.rand, 0.3) ? { wasmSha256: 'ab'.repeat(32) } : {}),
      })
      return `${lab} ${passed.join(',')}`
    },
  },
  {
    weight: 3,
    name: 'fleet-act',
    run: (d) => {
      const act = pick(d.rand, ACTS)
      d.graded('fleet-act', `fw:${act}`, Math.round(d.rand() * 100) / 100, true)
      if (d.skips) {
        const agg = d.agg
        if (Object.keys(agg.fleetWeek.acts).length >= 4 && agg.achievements['fleet-week'] === undefined) {
          d.emit('achievement', 'ach:fleet-week')
        }
      }
      return act
    },
  },
  {
    weight: 3,
    name: 'capstone-step',
    run: (d) => {
      const i = int(d.rand, 0, STEPS.length - 1)
      if (d.skips && d.agg.capstone.steps[STEPS[i]]) return null
      d.graded('capstone-step', `cap:${STEPS[i]}`, 1, true, { data: { index: i } })
      return STEPS[i]
    },
  },
  {
    weight: 1,
    name: 'achievement',
    run: (d) => {
      const id = pick(d.rand, ['first-quiz', 'night-owl', 'lab-rat'])
      if (d.skips && d.agg.achievements[id] !== undefined) return null
      d.emit('achievement', `ach:${id}`)
      return id
    },
  },
  {
    weight: 2,
    name: 'ack',
    run: (d) => {
      const id = pick(d.rand, ['2026-10-04-dynamo-kvbm-deprecated', '2026-10-04-eevdf-not-cfs'])
      if (d.skips && d.agg.acks[`erratum:${id}`] !== undefined) return null
      d.emit('ack', `erratum:${id}`)
      return id
    },
  },
  {
    weight: 2,
    name: 'boot',
    run: (d) => {
      const step = pick(d.rand, ['decode-tps', 'kv-bytes', 'cost'])
      const ok = chance(d.rand, 0.5)
      d.graded('predict', `boot:${step}`, ok ? 1 : 0, ok, {
        rev: `b-${step}`,
        data: { value: 10, unit: 'tok/s', truth: ok ? 10 : 40, src: 'boot' },
        ...maybeConf(d.rand),
      })
      if (chance(d.rand, 0.3)) d.emit('complete', 'boot')
      return step
    },
  },
  {
    weight: 2,
    name: 'card-item',
    run: (d) => {
      const ok = chance(d.rand, 0.6)
      d.graded('item', `card:2026-10-04-dynamo-kvbm-deprecated#${int(d.rand, 0, 1)}`, ok ? 1 : 0, ok, {
        rev: 'c0',
        data: { src: 'card' },
        ...maybeConf(d.rand),
      })
      return null
    },
  },
  {
    weight: 4,
    name: 'working',
    run: (d) => {
      const r = d.rand
      switch (int(r, 0, 5)) {
        case 0: {
          const id = pick(r, LESSONS)
          if (d.skips && !d.agg.lessons[id]) return null
          d.setWorking(`scroll:${id}`, Math.round(r() * 100))
          return `scroll ${id}`
        }
        case 1:
          d.setWorking(`sim-config:${SIM}`, { batch: int(r, 1, 64) })
          return 'sim-config'
        case 2:
          d.setWorking('fw:doc', `draft ${int(r, 0, 999)}`)
          return 'fw:doc'
        case 3:
          d.setWorking(`fw:evidence:${pick(r, ACTS)}`, { analysis: `a${int(r, 0, 99)}` })
          return 'fw:evidence'
        case 4:
          d.setWorking('capstone:metrics', { ttft: int(r, 1, 9), itl: int(r, 1, 9), throughput: int(r, 1, 999) })
          return 'capstone:metrics'
        default:
          d.setWorking('settings:codeLang', pick(r, ['python', 'java', 'rust', 'c']))
          return 'settings'
      }
    },
  },
]

const TOTAL_WEIGHT = OPS_TABLE.reduce((n, op) => n + op.weight, 0)

function pickOp(rand: Rand) {
  let roll = rand() * TOTAL_WEIGHT
  for (const op of OPS_TABLE) {
    roll -= op.weight
    if (roll < 0) return op
  }
  return OPS_TABLE[OPS_TABLE.length - 1]
}

/** Run one random op (the clock moves 1-3000 minutes first), noting it in the device's trace. */
export function randomOp(d: SimDevice) {
  d.advance(int(d.rand, 1, 3000))
  const op = pickOp(d.rand)
  const detail = op.run(d)
  d.note(`${d.iso} ${op.name}${detail === null ? ' (skipped)' : ` ${detail}`}`)
}

export function runOps(d: SimDevice, n: number) {
  for (let i = 0; i < n; i++) randomOp(d)
}

/** Everything a property body needs for one seed. */
export interface SeedCtx {
  seed: number
  rand: Rand
  trace: string[]
  device(tz?: number, id?: string): SimDevice
}

/** Run `body` for each seed (or `LEDGER_SEED`); on failure the error names the seed and the op trace. */
export function forSeeds(body: (ctx: SeedCtx) => void, seeds = SEEDS) {
  const list = ONLY_SEED === null ? Array.from({ length: seeds }, (_, i) => i + 1) : [ONLY_SEED]
  for (const seed of list) {
    const rand = splitmix32(seed)
    const trace: string[] = []
    let devices = 0
    const ctx: SeedCtx = {
      seed,
      rand,
      trace,
      device: (tz = pick(rand, TZS), id = `dev${String.fromCharCode(97 + devices++)}`) => new SimDevice(id, tz, rand, trace),
    }
    try {
      body(ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`seed ${seed} failed (replay: LEDGER_SEED=${seed})\n${message}\n--- ops ---\n${trace.join('\n')}`)
    }
  }
}

/** "Identical ledgers" (spec §13): events by id, working by key, and the derived aggregate. */
export function ledgerKey(l: Ledger): string {
  return stableStringify({
    events: [...l.events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    working: [...l.working].sort(compareWorking),
    aggregate: derive(l.events),
  })
}

export const sortedEvents = (l: Ledger) => [...l.events].sort(compareEvents)

/**
 * A synthetic year for the 12-month round trip (P8): about 85% of days are active; a light
 * profile writes about 10 events on an active day, a heavy one about 60.
 */
export function syntheticYear(seed: number, profile: 'light' | 'heavy'): Ledger {
  const rand = splitmix32(seed)
  const d = new SimDevice('year', 330, rand)
  d.skips = false
  const perDay = profile === 'light' ? 10 : 60
  for (let day = 0; day < 365; day++) {
    if (!chance(rand, 0.85)) continue
    d.tz = pick(rand, TZS)
    d.ms = START_MS + day * DAY
    const n = Math.max(1, Math.round(perDay * (0.5 + rand())))
    for (let i = 0; i < n; i++) {
      d.advance(int(rand, 0, Math.floor((14 * 60) / n)))
      pickOp(rand).run(d)
    }
  }
  return d.ledger()
}
