/**
 * Property-test harness for the ledger core (spec §13). No browser globals: everything here
 * and in src/lib/ledger runs under plain `bun test`.
 *
 * - splitmix32 drives every choice, so a seed replays exactly (`LEDGER_SEED=<n>`).
 * - Pools are fixed, so tests stay independent of content edits.
 * - Devices have their own tz and a deterministic id stream; the clock starts 2026-09-01T08:00Z.
 * - Ops mirror the façade actions (spec §8.3-8.4, the Wave 1 actions of wave-1.md §3.3, the Wave 2 actions of
 *   wave-2.md §3.3 and the Wave 3 shapes of wave-3.md §3.2), including their skip rules. Every shape is one the codec must accept, so the import
 *   properties exercise it.
 */
import { BACKGROUNDS, ENGINE_SLOTS, FAULT_IDS, FLEET_RUN_MODES } from '../../src/lib/ledger/constants'
import { derive, fleetRunOk, fleetRunScore, incidentOk, incidentScore } from '../../src/lib/ledger/fold'
import { compareEvents, compareWorking, type Ledger } from '../../src/lib/ledger/merge'
import { stableStringify } from '../../src/lib/ledger/stable'
import { dayOf } from '../../src/lib/ledger/time'
import type {
  Confidence,
  EngineSlots,
  FaultId,
  FleetRunData,
  IncidentData,
  LedgerEvent,
  Provenance,
  RunRecord,
  WorkingKey,
  WorkingRecord,
} from '../../src/lib/ledger/types'
import { splitmix32 } from '../../src/lib/rng'

export const SEEDS = Number(process.env.LEDGER_SEEDS ?? 100)
export const OPS = Number(process.env.LEDGER_OPS ?? 40)
/**
 * Per-test timeout for files that run seeded properties. Bun's 5 s default is
 * per test, and one property test spans every seed: a hosted CI runner took
 * 5.2 s for a three-device merge that runs in ~2 s locally. Scales with SEEDS.
 */
export const PROPERTY_TIMEOUT_MS = Math.max(60_000, SEEDS * 600)
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
export const PLAY = 'block-placement'
export const FORMS = ['ticket', 'spiral', 'testout'] as const
/** Wave 1 item refs, one of each grammar (wave-1.md §3.2). */
export const WAVE1_ITEM_REFS = ['gen:frag/first-fit', 'gen:kv/bytes-per-token', 'pre:t1.l4#0', 'dia:t1.l3#5', 'cr:t0.l4#0', 'item:r.anchor.e0502-1']
/** Wave 2 pools (wave-2.md §3.2): faults, slots, run modes, module hashes and packet refs, one of each grammar. */
export const FAULTS: readonly FaultId[] = FAULT_IDS
export const SLOTS = ENGINE_SLOTS
export const FLEET_MODES = FLEET_RUN_MODES
export const SHAS = ['a1', 'b2', 'c3', 'd4'].map((p) => p.repeat(32))
export const PACKET_REFS = ['packet:lab/kv-block-manager/cow', 'packet:lesson/t5.l4', 'packet:sim/sim-kv']
const KCS = ['kc.frag.external', 'kc.kv.size', 'kc.roofline.bound']
/** Wave 3 pools (wave-3.md §3.2): form tracks, run ids and the item refs of the form, play, return, field and protégé shapes. */
export const TRACKS = ['t0', 't2', 't5']
export const FORM_REFS = ['gen:kv/bytes-per-token', 'gen:frag/first-fit', 'gen:tiling/raster-ai']
export const RUN_IDS = ['7f3a9c21', '00ab12ef', 'deadbeef', '0123abcd']
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
  const graded = ['item', 'probe', 'quiz', 'predict', 'sim-task', 'lab-check', 'fleet-act', 'capstone-step', 'play', 'prove', 'incident', 'fleet-run'].includes(kind)
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
      // wave-2.md §3.3: `meta` adds the seed, the provenance and `data`
      const meta = chance(d.rand, 0.4)
        ? { seed: int(d.rand, 0, 0xffffffff), provenance: pick(d.rand, ['practice', 'unseen'] as const), data: { goodput: int(d.rand, 1, 99), refGoodput: 50 } }
        : {}
      d.graded('fleet-act', `fw:${act}`, Math.round(d.rand() * 100) / 100, true, meta)
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
  /* ---- Wave 1 (wave-1.md §3.3): every new action, with its skip rule ---- */
  {
    weight: 4,
    name: 'ticket',
    run: (d) => {
      const id = pick(d.rand, LESSONS)
      const form = pick(d.rand, FORMS)
      const n = int(d.rand, 3, 5)
      const grp = `${d.id}:t${d.ms}`
      const src = form === 'testout' ? 'testout' : 'ticket'
      const kcs = shuffle(d.rand, KCS).slice(0, int(d.rand, 1, 3))
      let correct = 0
      let nonMcqOk = false
      for (let i = 0; i < n; i++) {
        const ok = chance(d.rand, 0.7)
        if (ok) correct += 1
        if (ok && i === n - 1) nonMcqOk = true // the last slot is the non-MCQ
        d.graded('item', pick(d.rand, WAVE1_ITEM_REFS), ok ? 1 : 0, ok, {
          rev: `t${i}`,
          provenance: chance(d.rand, 0.4) ? 'unseen' : 'practice',
          seed: int(d.rand, 0, 0xffffffff),
          ...maybeConf(d.rand),
          data: { src, form, grp, slot: i, of: n, kcs, lessonId: id, level: int(d.rand, 0, 3), nsec: int(d.rand, 10, 120), picks: ['b'] },
        })
      }
      const score = correct / n
      const ok = score >= 0.66 && nonMcqOk
      d.graded('quiz', `lesson:${id}`, score, ok, { data: { grp, n, form, nonMcqOk, kcs } })
      if (ok) d.emit('complete', `lesson:${id}`, { data: { via: form === 'testout' ? 'testout' : 'ticket', grp } })
      return `${id} ${form} ${correct}/${n}${ok ? ' pass' : ''}`
    },
  },
  {
    weight: 3,
    name: 'complete-read',
    run: (d) => {
      const id = pick(d.rand, LESSONS)
      if (d.skips) {
        const L = d.agg.lessons[id]
        if (L?.read || L?.passedAt !== undefined) return null
      }
      d.emit('complete', `lesson:${id}`, { data: { via: 'read' } })
      return id
    },
  },
  {
    weight: 3,
    name: 'sim-outcome',
    run: (d) => {
      const t = pick(d.rand, SIM_TASKS)
      if (d.skips && d.agg.sims[SIM]?.outcomes[t]) return null
      const ok = chance(d.rand, 0.6)
      d.graded('sim-task', `sim:${SIM}/${t}`, ok ? 1 : 0, ok, {
        ...maybeConf(d.rand),
        data: {
          v: 2,
          outcome: true,
          predict: { value: int(d.rand, 1, 9), unit: 'ms' },
          actual: int(d.rand, 1, 9),
          logErr: Math.round(d.rand() * 100) / 100,
          explain: 'because the batch is memory bound',
          ideas: [0, 2],
          ...(chance(d.rand, 0.3) ? { phone: true } : {}),
        },
      })
      return `${t} ${ok ? 'ok' : 'miss'}`
    },
  },
  {
    weight: 4,
    name: 'lab-run-v2',
    run: (d) => {
      const lab = pick(d.rand, Object.keys(LABS))
      const { checks, total } = LABS[lab]
      const passed = shuffle(d.rand, checks).slice(0, int(d.rand, 0, checks.length))
      const seeds = pick(d.rand, ['fresh', 'default'] as const)
      const detail = checks.map((id) => ({
        id,
        status: passed.includes(id) ? 'pass' : pick(d.rand, ['fail', 'trap', 'timeout'] as const),
        seed: int(d.rand, 0, 0xffffffff),
        ...(seeds === 'fresh' && chance(d.rand, 0.8) ? { fresh: true } : {}),
      }))
      const known = d.skips ? Object.keys(d.agg.labs[lab]?.checks ?? {}) : []
      const done = new Set([...known, ...passed]).size >= total || (!d.skips && passed.length === total)
      d.graded('lab-check', `lab:${lab}`, passed.length / total, done, {
        provenance: seeds === 'fresh' ? pick(d.rand, ['unseen', 'assisted', 'lab-green'] as const) : 'lab-green',
        data: { passed, total, abi: 2, checks: detail, seeds, stage: int(d.rand, 0, 3) },
        ...(chance(d.rand, 0.3) ? { wasmSha256: 'cd'.repeat(32) } : {}),
      })
      return `${lab} ${seeds} ${passed.join(',')}`
    },
  },
  {
    weight: 3,
    name: 'play',
    run: (d) => {
      const phase = pick(d.rand, ['play', 'compose'] as const)
      const ok = chance(d.rand, 0.6)
      const scheduler = chance(d.rand, 0.35)
      const spec = scheduler
        ? { order: pick(d.rand, ['fcfs', 'sjf'] as const), guard: 2000, headroom: 48, preempt: pick(d.rand, ['none', 'newest'] as const) }
        : { fit: 'best', coalesce: 'eager', minSplit: 16, classes: 'pow2' }
      d.graded('play', `play:${scheduler ? 'scheduler' : PLAY}`, Math.round(d.rand() * 100) / 100, ok, {
        provenance: pick(d.rand, ['practice', 'unseen'] as const),
        seed: int(d.rand, 0, 0xffffffff),
        data: {
          phase,
          turns: int(d.rand, 1, 20),
          survived: int(d.rand, 0, 20),
          ghostSurvived: int(d.rand, 0, 20),
          ...(phase === 'compose' ? { spec, equivalent: ok } : {}),
        },
      })
      return `${scheduler ? 'scheduler ' : ''}${phase} ${ok ? 'ok' : 'miss'}`
    },
  },
  {
    weight: 2,
    name: 'prove',
    run: (d) => {
      const lab = pick(d.rand, Object.keys(LABS))
      const self = [0, 1, 2].map(() => int(d.rand, 0, 1))
      const score = self.reduce((a, b) => a + b, 0) / self.length
      d.graded('prove', `prove:${lab}`, score, chance(d.rand, 0.8), { data: { v: 1, qids: ['q1', 'q2', 'q3'], self } })
      return lab
    },
  },
  {
    weight: 1,
    name: 'placement',
    run: (d) => {
      d.emit('complete', 'placement')
      d.setWorking('placement:result', { at: d.iso, tracks: { t0: int(d.rand, 0, 3), t1: int(d.rand, 0, 3) } })
      return 'placement'
    },
  },
  {
    weight: 3,
    name: 'hint',
    run: (d) => {
      const lab = pick(d.rand, Object.keys(LABS))
      const ref = `hint:${lab}/${pick(d.rand, LABS[lab].checks)}#${pick(d.rand, ['R1', 'R2', 'bottom'])}`
      if (d.skips && d.agg.acks[ref] !== undefined) return null
      d.emit('ack', ref)
      return ref
    },
  },
  {
    weight: 4,
    name: 'today-item',
    run: (d) => {
      const ref = pick(d.rand, WAVE1_ITEM_REFS)
      const ok = chance(d.rand, 0.6)
      const kind = pick(d.rand, ['item', 'probe'] as const)
      d.graded(kind, ref, ok ? 1 : 0, ok, {
        rev: 'g0',
        seed: int(d.rand, 0, 0xffffffff),
        provenance: chance(d.rand, 0.5) ? 'unseen' : 'practice',
        ...maybeConf(d.rand),
        data: {
          src: pick(d.rand, ['today', 'placement', 'practice', 'pre', 'diagram', 'lesson', 'daily'] as const),
          kcs: shuffle(d.rand, KCS).slice(0, 2),
          nsec: int(d.rand, 0, 600),
          slot: int(d.rand, 0, 7),
          of: 8,
          reason: pick(d.rand, ['priority', 'threshold', 'due', 'confirm', 'probe', 'extra'] as const),
          ...(ref.startsWith('gen:') ? { level: 2, variant: 'first-fit', unit: 'B', truth: 64, miss: 'kv.priced-fp16' } : {}),
        },
      })
      return ref
    },
  },
  {
    weight: 2,
    name: 'predict-w1',
    run: (d) => {
      const ok = chance(d.rand, 0.5)
      const lo = int(d.rand, 1, 20)
      d.graded('predict', pick(d.rand, ['pre:t1.l4#0', 'dia:t1.l3#5', 'item:r.anchor.e0502-1']), ok ? 1 : 0, ok, {
        rev: 'p0',
        data: { value: 10, unit: 'KiB', truth: ok ? 10 : 80, src: pick(d.rand, ['pre', 'diagram', 'placement', 'lesson'] as const), lo, hi: lo + int(d.rand, 0, 40), kcs: [KCS[0]], nsec: int(d.rand, 5, 90) },
      })
      return null
    },
  },
  /* ---- Wave 2 (wave-2.md §3.3): every new action, with its skip rule ---- */
  {
    weight: 4,
    name: 'incident',
    run: (d) => {
      const r = d.rand
      const src = pick(r, ['daily', 'drill', 'team'] as const)
      const fault = pick(r, FAULTS)
      const date = dayOf(d.iso, d.tz)
      const ref = src === 'daily' ? `inc:daily/${date}` : src === 'drill' ? `inc:drill/${fault}` : `inc:team/${pick(r, ['blue', 'red'])}/${date}`
      const diagnosed = chance(r, 0.7)
      const data: IncidentData = {
        v: 1,
        src,
        fault,
        severity: pick(r, [1, 2, 3] as const),
        ...(chance(r, 0.6) ? { firstHypothesis: pick(r, [...FAULTS, 'unsure'] as const) } : {}),
        hypothesis: diagnosed ? fault : 'unsure',
        probes: shuffle(r, ['queue-depth', 'kv-pool', 'node-health', 'tenant-mix', 'ttft-split']).slice(0, int(r, 0, 5)),
        ...(chance(r, 0.8) ? { fix: pick(r, ['grow-pool', 'restart-node', 'rate-limit']) } : {}),
        diagnosed,
        fixed: chance(r, 0.7),
        burn: int(r, 0, 300) / 10,
        expertBurn: int(r, 0, 100) / 10,
        streetlight: int(r, 0, 4),
        components: shuffle(r, SHAS).slice(0, int(r, 0, 3)),
        ...(src === 'drill' ? (chance(r, 0.3) ? { act4: true } : {}) : { date }),
        ...(chance(r, 0.3) ? { kcs: [KCS[0]] } : {}),
      }
      d.graded('incident', ref, incidentScore(data), incidentOk(data), {
        provenance: src === 'drill' ? 'unseen' : 'practice',
        seed: int(r, 0, 0xffffffff),
        ms: int(r, 1000, 600_000),
        data,
      })
      return `${ref} ${incidentOk(data) ? 'ok' : 'miss'}`
    },
  },
  {
    weight: 3,
    name: 'fleet-run',
    run: (d) => {
      const r = d.rand
      const parts = shuffle(r, SLOTS).slice(0, int(r, 0, 3))
      if (parts.length === 0) return null // recordFleetRun skips a run with no own component
      const mode = pick(r, FLEET_MODES)
      const refGoodput = int(r, 20, 80)
      const data: FleetRunData = {
        v: 1,
        mode,
        components: parts.map((slot) => ({ slot, labId: pick(r, Object.keys(LABS)), sha256: pick(r, SHAS) })),
        seeds: pick(r, ['fresh', 'practice'] as const),
        goodput: int(r, 10, 90),
        refGoodput,
        ...(chance(r, 0.5) ? { ttftP95: int(r, 100, 3000) } : {}),
      }
      d.graded('fleet-run', `fleet:${mode}`, fleetRunScore(data), fleetRunOk(data), {
        provenance: data.seeds === 'fresh' ? 'unseen' : 'practice',
        seed: int(r, 0, 0xffffffff),
        data,
      })
      return `${mode} ${fleetRunOk(data) ? 'ok' : 'miss'}`
    },
  },
  {
    weight: 2,
    name: 'install-component',
    run: (d) => {
      const slot = pick(d.rand, SLOTS)
      const sha256 = pick(d.rand, SHAS)
      const slots = { ...((d.working.get('engine:slots')?.value ?? {}) as EngineSlots) }
      if (d.skips && slots[slot]?.sha256 === sha256) return null
      slots[slot] = { sha256, labId: pick(d.rand, Object.keys(LABS)), version: int(d.rand, 1, 3), at: d.iso }
      d.setWorking('engine:slots', slots as WorkingRecord['value'])
      return `${slot} ${sha256.slice(0, 4)}`
    },
  },
  {
    weight: 1,
    name: 'remove-component',
    run: (d) => {
      const slot = pick(d.rand, SLOTS)
      const slots = { ...((d.working.get('engine:slots')?.value ?? {}) as EngineSlots) }
      if (d.skips && slots[slot] === undefined) return null
      delete slots[slot]
      d.setWorking('engine:slots', slots as WorkingRecord['value'])
      return slot
    },
  },
  {
    weight: 3,
    name: 'help',
    run: (d) => {
      // never skipped: help-seeking is counted
      const ref = pick(d.rand, PACKET_REFS)
      d.emit('ack', ref, { data: { via: pick(d.rand, ['claude', 'chatgpt', 'copy'] as const), chars: int(d.rand, 0, 6000), ...(chance(d.rand, 0.5) ? { arm: pick(d.rand, ['ladder', 'packet'] as const) } : {}) } })
      return ref
    },
  },
  /* ---- Wave 3 (wave-3.md §3.2): every new shape the codec accepts ---- */
  {
    weight: 4,
    name: 'prove-v2',
    run: (d) => {
      const r = d.rand
      const lab = pick(r, Object.keys(LABS))
      const list = chance(r, 0.4)
      const answer = list ? shuffle(r, [0, 1, 2, 3, 4, 5]).slice(0, int(r, 0, 6)) : int(r, 0, 99)
      const trapped = chance(r, 0.1)
      const actual = trapped ? null : chance(r, 0.6) ? answer : list ? shuffle(r, [0, 1, 2, 3, 4, 5]).slice(0, int(r, 0, 6)) : int(r, 0, 99)
      const ok = actual !== null && stableStringify(actual) === stableStringify(answer)
      const proved = ok && chance(r, 0.7)
      d.graded('prove', `prove:${lab}`, ok ? 1 : 0, ok, {
        provenance: proved ? 'proved' : 'practice',
        ...(proved || chance(r, 0.3) ? { wasmSha256: pick(r, SHAS) } : {}),
        ms: int(r, 1000, 300_000),
        data: {
          v: 2,
          qid: pick(r, ['free-after', 'queue-depth', 'order-after']),
          kcs: shuffle(r, KCS).slice(0, int(r, 0, 3)),
          answer,
          actual,
          calls: int(r, 1, 12),
          ...(chance(r, 0.2) ? { return: true } : {}),
        },
      })
      return `${lab} ${proved ? 'proved' : ok ? 'ok' : 'miss'}`
    },
  },
  {
    weight: 3,
    name: 'form-item',
    run: (d) => {
      const r = d.rand
      const ok = chance(r, 0.6)
      d.graded('item', pick(r, FORM_REFS), ok ? 1 : 0, ok, {
        rev: 'f0',
        provenance: chance(r, 0.5) ? 'unseen' : 'practice',
        seed: int(r, 0, 0xffffffff),
        ...maybeConf(r),
        data: { src: 'form', formId: pick(r, ['A', 'B', 'C'] as const), track: pick(r, TRACKS), formSlot: int(r, 0, 11), formSet: pick(r, [0, 1, 2] as const), kcs: shuffle(r, KCS).slice(0, 2), nsec: int(r, 10, 120) },
      })
      return null
    },
  },
  {
    weight: 2,
    name: 'return-item',
    run: (d) => {
      // The 30-day return's v1 follow-up (§7.5): an authored item back on Today, flagged `return`.
      const r = d.rand
      const ok = chance(r, 0.6)
      d.graded('item', `item:lab02.prove.${pick(r, ['free-order', 'split-merge'])}`, ok ? 1 : 0, ok, {
        rev: 'v0',
        ...maybeConf(r),
        data: { src: 'today', return: true, kcs: [KCS[1]], nsec: int(r, 10, 120), slot: int(r, 0, 7), of: 8, reason: 'due' },
      })
      return null
    },
  },
  {
    weight: 3,
    name: 'play-item',
    run: (d) => {
      // An item or a prediction made inside a play (src `play`), and a prediction with src `practice`.
      const r = d.rand
      const ok = chance(r, 0.5)
      if (chance(r, 0.5)) {
        d.graded('item', pick(r, FORM_REFS), ok ? 1 : 0, ok, { rev: 'pl0', provenance: 'unseen', seed: int(r, 0, 0xffffffff), data: { src: 'play', level: pick(r, [0, 1, 2, 3] as const), variant: 'raster-ai', kcs: [KCS[2]], nsec: int(r, 5, 90) } })
        return 'item'
      }
      d.graded('predict', pick(r, FORM_REFS), ok ? 1 : 0, ok, {
        rev: 'pl1',
        data: { value: int(r, 1, 900), unit: 'FLOP/B', truth: int(r, 1, 900), src: pick(r, ['play', 'practice'] as const), kcs: [KCS[2]], nsec: int(r, 5, 90) },
      })
      return 'predict'
    },
  },
  {
    weight: 2,
    name: 'stretch-item',
    run: (d) => {
      // The stretch shapes (§3.2): field labs and the real-engine run (src practice, provenance field), protégé and the spatial proxy.
      const r = d.rand
      const ok = chance(r, 0.5)
      switch (int(r, 0, 3)) {
        case 0:
          d.graded('item', 'item:field.decode-kv.tps', ok ? 1 : 0, ok, { rev: 'fl0', provenance: 'field', data: { src: 'practice', value: int(r, 10, 400), truth: int(r, 10, 400), unit: 'tok/s' } })
          return 'field item'
        case 1:
          d.graded('predict', 'item:engine.measured-tps', ok ? 1 : 0, ok, { rev: 'fl1', provenance: 'field', data: { value: int(r, 10, 400), truth: int(r, 10, 400), unit: 'tok/s', src: 'practice' } })
          return 'field predict'
        case 2:
          d.graded('item', `item:t4.l3.protege.${int(r, 1, 3)}.${pick(r, ['find', 'tag', 'fix'])}`, ok ? 1 : 0, ok, { rev: 'pr0', data: { src: 'lesson', lessonId: 't4.l3', pick: [int(r, 0, 3)] } })
          return 'protege'
        default:
          d.graded('item', `item:cube.spatial.${int(r, 1, 4)}`, ok ? 1 : 0, ok, { rev: 'sp0', data: { src: 'practice', pick: [int(r, 0, 3)] } })
          return 'spatial'
      }
    },
  },
  {
    weight: 3,
    name: 'play-metric',
    run: (d) => {
      const r = d.rand
      const eplb = chance(r, 0.6)
      const mine = Math.round((1 + r() * 0.8) * 100) / 100
      const ghost = Math.round((1 + r() * 0.3) * 100) / 100
      const phase = eplb ? pick(r, ['play', 'compose'] as const) : 'play'
      const levels = eplb
        ? undefined
        : ['roofline', 'raster', 'tile', 'smem', 'regs', 'cube'].slice(0, int(r, 1, 6)).map((id) => ({
            id,
            ok: chance(r, 0.6),
            ...(chance(r, 0.7) ? { logErr: Math.round(r() * 100) / 100 } : {}),
            ...(chance(r, 0.3) ? { view: pick(r, ['2d', '3d'] as const) } : {}),
          }))
      const ok = eplb ? mine <= ghost + 0.05 : true
      d.graded('play', eplb ? 'play:eplb' : 'play:tiling-cube', eplb ? Math.min(1, ghost / mine) : (levels?.filter((l) => l.ok).length ?? 0) / 6, ok, {
        provenance: 'unseen',
        seed: int(r, 0, 0xffffffff),
        data: {
          phase,
          turns: int(r, 1, 20),
          survived: int(r, 0, 20),
          ghostSurvived: int(r, 0, 20),
          ...(eplb ? { metric: { name: 'imbalance', mine, ghost, lowerIsBetter: true } } : { levels }),
          ...(eplb && phase === 'compose'
            ? { spec: { replicate: pick(r, ['none', 'per-copy', 'total'] as const), place: pick(r, ['round-robin', 'least-loaded'] as const) }, equivalent: ok }
            : {}),
        },
      })
      return `${eplb ? 'eplb' : 'cube'} ${ok ? 'ok' : 'miss'}`
    },
  },
  {
    weight: 3,
    name: 'fleet-act-receipts',
    run: (d) => {
      const r = d.rand
      const act = pick(r, ['engine', 'fleet', 'business'])
      const cited = int(r, 0, 5)
      const verified = int(r, 0, cited)
      d.graded('fleet-act', `fw:${act}`, Math.round(r() * 100) / 100, true, {
        provenance: 'unseen',
        seed: int(r, 0, 0xffffffff),
        data: {
          receipts: { cited, verified, uncited: int(r, 0, 3) },
          ...(chance(r, 0.7) ? { rubric: { capacity: int(r, 0, 3), slo: int(r, 0, 3), cost: int(r, 0, 3), failure: int(r, 0, 3) } } : {}),
          runs: shuffle(r, RUN_IDS).slice(0, Math.min(cited, 3)),
        },
      })
      return act
    },
  },
  {
    weight: 2,
    name: 'engine-race',
    run: (d) => {
      // Lab 06's race (§8.3): one component alone on `fleet:engine`, fresh seeds, within 3 points of the reference or not.
      const r = d.rand
      const data: FleetRunData = {
        v: 1,
        mode: 'engine',
        components: [{ slot: 'scheduler', labId: pick(r, Object.keys(LABS)), sha256: pick(r, SHAS) }],
        seeds: 'fresh',
        goodput: int(r, 30, 60),
        refGoodput: 50,
      }
      d.graded('fleet-run', 'fleet:engine', fleetRunScore(data), fleetRunOk(data), { provenance: 'unseen', seed: int(r, 0, 0xffffffff), data })
      return fleetRunOk(data) ? 'ok' : 'miss'
    },
  },
  {
    weight: 4,
    name: 'working',
    run: (d) => {
      const r = d.rand
      switch (int(r, 0, 15)) {
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
        case 5:
          d.setWorking('settings:codeLang', pick(r, ['python', 'java', 'rust', 'c']))
          return 'settings'
        case 6:
          d.setWorking('queue:laptop', [{ simId: SIM, taskId: pick(r, SIM_TASKS), at: d.iso }])
          return 'queue:laptop'
        case 7:
          d.setWorking('handoff:last', { at: d.iso, events: int(r, 0, 50) })
          return 'handoff:last'
        case 8:
          d.setWorking('today:prefs', { phoneMode: chance(r, 0.5), sessionMinutes: int(r, 5, 12) })
          return 'today:prefs'
        case 10:
          if (d.skips && d.working.has('exp:seed')) return null // created once
          d.setWorking('exp:seed', int(r, 0, 0xffffffff))
          return 'exp:seed'
        case 11:
          d.setWorking('zoo:config', `{"num_hidden_layers": ${int(r, 1, 80)}}`)
          return 'zoo:config'
        case 12:
          d.setWorking('daily:team', pick(r, ['blue', 'red']))
          return 'daily:team'
        case 13: {
          // newest last, at most 50: the same list `setWorking('fw:runs', …)` keeps
          const prior = (d.working.get('fw:runs')?.value ?? []) as unknown as RunRecord[]
          const record: RunRecord = {
            id: pick(r, RUN_IDS),
            act: pick(r, ['engine', 'fleet', 'business'] as const),
            job: { kind: 'engine', seed: int(r, 0, 99), modules: [{ slot: 'scheduler', sha256: pick(r, SHAS) }] },
            entropy: int(r, 0, 0xffffffff),
            values: { goodput: int(r, 100, 900) / 10, shed: int(r, 0, 20) },
            at: d.iso,
          }
          d.setWorking('fw:runs', [...prior, record].slice(-50) as unknown as WorkingRecord['value'])
          return 'fw:runs'
        }
        case 14:
        case 15:
          d.setWorking('profile:background', pick(r, BACKGROUNDS))
          return 'profile:background'
        default:
          d.setWorking('boot:week', { minutesPerWeek: 180, sessionMinutes: 12, phoneDays: [1, 3], laptopDays: [6], slo: 0.9 })
          return 'boot:week'
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
