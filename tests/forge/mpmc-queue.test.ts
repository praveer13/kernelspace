/**
 * Lab 04, mpmc-queue (docs/specs/wave-3.md §8.2; task 3b-10): the bundle's stages, PRIMM items and reference run on the
 * Fleet's reference queue, the faded hint ladder (R0 to R2) for the six required checks, six Prove-it questions, and
 * the three Prove-it v2 templates (§7.2).
 *
 * The facts the items and rungs state about the checks are derived here, not remembered. `ring()` below is Vyukov's
 * queue as the lab's header lays it out, on one thread, with the seven mutants of labs/mpmc-queue/calibration.json as
 * options; `runCheck()` ports the checks of labs/mpmc-queue/src/lib.rs. Which mutant fails which check is held to the
 * committed calibration, so "the first red check is backpressure" is a statement about the harness, not about this file.
 *
 * Prove-it v2 (the template rule of 3a-22, applied to lab 04): the required checks pin a correct module's behaviour, so
 * `last-pop` and `after-wrap` are tracing questions about a correct module, and `full-count` reads the capacity
 * rounding that queue.rs leaves to your design. The fakes are this file's own: line-protocol queues over the bridge's
 * verbs, with the rounding and the plausible wrong models as options.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { HintLadderView } from '../../src/components/forge/HintLadder'
import { PrimmPanel } from '../../src/components/forge/PrimmPanel'
import ProveIt from '../../src/components/forge/ProveIt'
import { ReferenceRun } from '../../src/components/forge/ReferenceRun'
import { StagePanel } from '../../src/components/forge/StagePanel'
import { findForgeBundle, forgeBundleIds, loadForgeBundle } from '../../src/data/forge'
import { PRIMM_MC_ITEMS as BPE_MC } from '../../src/data/forge/bpe-tokenizer/primm'
import { PRIMM_MC_ITEMS as KV_MC } from '../../src/data/forge/kv-block-manager/primm'
import bundle from '../../src/data/forge/mpmc-queue'
import { DISCUSSIONS_LABEL, LAB_ID, LADDER, LADDER_CHECK_IDS, hintRef, restoreState } from '../../src/data/forge/mpmc-queue/ladder'
import {
  BURSTS,
  CAPACITY,
  PRACTICE_SEED,
  PRIMM_ITEMS,
  PRIMM_MC_ITEMS,
  PRIMM_STEPS,
  REFERENCE,
  RUN_ITEM,
  RUN_SPEC,
  STAGES,
  attemptsToGreen,
  burstOps,
  currentStage,
  describeRun,
  gradeChoice,
  gradeNumber,
  greenStage,
  itemResponse,
  primmRef,
  runBursts,
  runResponse,
  stageRows,
  type NumberPrimm,
} from '../../src/data/forge/mpmc-queue/primm'
import { PRIMM_MC_ITEMS as ALLOCATOR_MC } from '../../src/data/forge/rust-allocator/primm'
import { PROVE_LAB_ID, PROVE_QUESTIONS, buildProveResult, followUpRef, pickQuestions } from '../../src/data/forge/mpmc-queue/prove'
import { AFTER_WRAP, FULL_COUNT, LAST_POP, PROVE2, RING, TRACE_OPS, popped } from '../../src/data/forge/mpmc-queue/prove2'
import type { ProveV2Template } from '../../src/data/forge/types'
import { KC } from '../../src/data/kc/ids'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { makeRefQueue } from '../../src/lib/fleet-model'
import { gradeAnswer, PROVE2_MAX_CALLS, planQuestion, proveFromModule } from '../../src/lib/forge/prove2'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { refMatchesKind } from '../../src/lib/ledger/refs'
import { splitmix32u } from '../../src/lib/rng'
import { extractHeadings } from '../../src/pages/lesson/markdown'
import { lintBundle } from '../../scripts/lint-mentor'
import { CUE_STRATEGIES, MAX_RANK_LESSON, PASS_BAR, oddOneOut, passProbability, poolCueFailures } from '../../scripts/item-cues'
import { fakeBridge } from './fixtures'

const lab = FORGE_LABS.find((l) => l.id === 'mpmc-queue')
if (lab === undefined) throw new Error('lab 04 is missing from labs.ts')
const checks = lab.checks
const required = checks.filter((c) => c.optional !== true).map((c) => c.id)
const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const kcValues = new Set<string>(Object.values(KC))
/** The KCs lab 04's checks carry in labs.ts; the graph (src/data/kc/t2.ts) defines them. */
const LAB_KCS = ['t2.mutex-atomics', 't2.aba']

/* ------------------------------ Vyukov's queue, one thread, with the calibration's mutants ------------------------------ */

type Mutant = 'empty-garbage' | 'leak-slot' | 'no-recycle' | 'ok-when-full' | 'one-slot-short' | 'stale-slot' | 'swap-err'

/**
 * The queue of queue.rs's header: seq[i] = i, a push at position t waits for seq == t and publishes t + 1, a pop at h
 * waits for h + 1 and releases h + capacity. One thread, so the compare-exchange always wins. The slot is the position
 * modulo the capacity, so any capacity works; the real one masks and rounds up.
 */
class Ring {
  readonly seq: number[]
  readonly buf: number[]
  head = 0
  tail = 0
  pops = 0
  constructor(
    readonly cap: number,
    readonly mutant?: Mutant,
  ) {
    this.seq = Array.from({ length: cap }, (_, i) => i)
    this.buf = new Array<number>(cap).fill(0)
  }
  push(v: number): { ok: true } | { err: number } {
    const pos = this.tail
    const slot = pos % this.cap
    if (this.mutant === 'one-slot-short' && pos - this.head >= this.cap - 1) return { err: v }
    const dif = this.seq[slot] - pos
    if (dif < 0) return this.mutant === 'ok-when-full' ? { ok: true } : { err: this.mutant === 'swap-err' ? v ^ 1 : v }
    this.tail++
    this.buf[slot] = v
    this.seq[slot] = pos + 1
    return { ok: true }
  }
  pop(): number | null {
    const pos = this.head
    const slot = pos % this.cap
    const dif = this.seq[slot] - (pos + 1)
    if (dif < 0) return this.mutant === 'empty-garbage' ? 0 : null
    this.head++
    const v = this.buf[this.mutant === 'stale-slot' ? (slot + this.cap - 1) % this.cap : slot]
    this.pops++
    if (this.mutant === 'no-recycle') this.seq[slot] = pos + 1
    else if (this.mutant === 'leak-slot' && this.pops % 50 === 0) {
      // the slot is never released
    } else this.seq[slot] = pos + this.cap
    return v
  }
}

const MUTANTS: Mutant[] = ['empty-garbage', 'leak-slot', 'no-recycle', 'ok-when-full', 'one-slot-short', 'stale-slot', 'swap-err']
const CHECK_ORDER = ['fifo', 'backpressure', 'wraparound', 'model_gauntlet', 'slot_conservation', 'burst_model']

/** The checks of lib.rs on `mk`: a failure message, or null for a pass. The two seeded ones draw from splitmix32 here, not the harness's own Rng. */
function runCheck(id: string, mk: (cap: number) => Ring, seed = 0): string | null {
  if (id === 'fifo') {
    const q = mk(8)
    for (let v = 1; v <= 8; v++) if (!('ok' in q.push(v))) return `push(${v}) failed`
    for (let want = 1; want <= 8; want++) if (q.pop() !== want) return `pop != ${want}`
    return q.pop() === null ? null : 'pop on a drained ring must be None'
  }
  if (id === 'backpressure') {
    const q = mk(4)
    for (let v = 10; v < 14; v++) if (!('ok' in q.push(v))) return `push(${v}) failed before the ring was full`
    const over = q.push(99)
    if (!('err' in over)) return '5th push succeeded'
    if (over.err !== 99) return 'the caller’s value was swapped'
    if (q.pop() !== 10) return 'pop after overflow lost the head value'
    return 'ok' in q.push(99) ? null : 'push after pop failed: freed slot was not recycled'
  }
  if (id === 'wraparound') {
    const q = mk(4)
    let nextIn = 0
    let nextOut = 0
    for (let cycle = 0; cycle < 1000; cycle++) {
      for (let i = 0; i < 4; i++) if (!('ok' in q.push(++nextIn))) return `cycle ${cycle}: push failed`
      for (let i = 0; i < 4; i++) if (q.pop() !== ++nextOut) return `cycle ${cycle}: pop wrong`
    }
    return null
  }
  if (id === 'slot_conservation') {
    const q = mk(16)
    for (let cycle = 0; cycle < 100; cycle++) {
      for (let v = 0; v < 16; v++) if (!('ok' in q.push(v))) return `cycle ${cycle}: the ring is leaking slots`
      for (let i = 0; i < 16; i++) if (q.pop() === null) return `cycle ${cycle}: ring dried up early`
    }
    return null
  }
  // model_gauntlet and burst_model: shadowed by a plain queue, every decision compared
  const next = splitmix32u(seed)
  const below = (n: number) => next() % n
  const model: number[] = []
  const cap = id === 'model_gauntlet' ? 4 << below(4) : 8 << below(3)
  const q = mk(cap)
  const push = (v: number): string | null => {
    const r = q.push(v)
    const room = model.length < cap
    if ('ok' in r) {
      if (!room) return 'phantom slot'
      model.push(v)
      return null
    }
    if (room) return 'false full'
    return r.err === v ? null : 'wrong value in Err'
  }
  const pop = (): string | null => {
    const want = model.shift() ?? null
    return q.pop() === want ? null : 'pop disagreed with the model'
  }
  if (id === 'model_gauntlet') {
    const pushPct = 40 + below(25)
    for (let op = 0; op < 3000; op++) {
      const bad = below(100) < pushPct ? push(next()) : pop()
      if (bad !== null) return bad
    }
    return null
  }
  let ops = 0
  while (ops < 2000) {
    for (let n = 1 + below((cap * 3) / 2); n > 0; n--, ops++) {
      const bad = push(next())
      if (bad !== null) return bad
    }
    for (let n = below(cap / 2 + 1); n > 0; n--, ops++) {
      const bad = pop()
      if (bad !== null) return bad
    }
  }
  return null
}

/** The checks that fail, in grading order. */
const failing = (mutant?: Mutant, seeds = [0x44c4]): string[] =>
  CHECK_ORDER.filter((id) => seeds.some((s) => runCheck(id, (cap) => new Ring(cap, mutant), s) !== null))

/** The first check to fail going through the stages in order (1, 2, 3, 4). */
function firstRed(mutant: Mutant): string | undefined {
  const stage = (id: string) => checks.find((c) => c.id === id)?.stage ?? 99
  return [...failing(mutant)].sort((a, b) => stage(a) - stage(b))[0]
}

const calibration = JSON.parse(read('labs/mpmc-queue/calibration.json')) as {
  checks: Record<string, { mutants: Record<Mutant, number> }>
}

/* ------------------------------ stages ------------------------------ */

describe('stages: labs.ts, queue.rs and the harness agree (§8.1, §8.2)', () => {
  test('stage 1 is fifo, 2 backpressure, 3 wraparound and slot_conservation, 4 model_gauntlet and burst_model', () => {
    const byStage = (n: number) => checks.filter((c) => c.stage === n).map((c) => c.id)
    expect(byStage(1)).toEqual(['fifo'])
    expect(byStage(2)).toEqual(['backpressure'])
    expect(byStage(3).sort()).toEqual(['slot_conservation', 'wraparound'])
    expect(byStage(4).sort()).toEqual(['burst_model', 'model_gauntlet'])
    expect(checks.every((c) => c.optional !== true)).toBe(true)
  })

  test('the bundle’s stages are the four a required check carries, each at most 25 minutes, all under the lab’s 120', () => {
    expect(bundle.stages.map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(bundle.stages).toEqual([...STAGES])
    for (const s of STAGES) expect(s.minutes).toBeLessThanOrEqual(25)
    expect(STAGES.reduce((a, s) => a + s.minutes, 0)).toBeLessThanOrEqual(lab.minutes)
  })

  test('the harness lists the same stage for each check, in the order of labs.ts', () => {
    const lib = read('labs/mpmc-queue/src/lib.rs')
    for (const c of checks) {
      const m = new RegExp(`id: "${c.id}",[^}]*?stage: (\\d)`).exec(lib)
      expect(m?.[1]).toBe(String(c.stage))
    }
    const listed = [...lib.matchAll(/CheckDef \{ id: "([a-z_]+)"/g)].map((m) => m[1])
    expect(listed).toEqual(checks.map((c) => c.id))
  })

  test('queue.rs marks each stage with the checks it turns green', () => {
    const src = read('labs/mpmc-queue/src/queue.rs')
    const named = new Map<number, Set<string>>()
    for (const m of src.matchAll(/^\s*\/\/ STAGE (\d) · ([a-z_, ]+?)\s*$/gm)) {
      const n = Number(m[1])
      named.set(n, new Set([...(named.get(n) ?? []), ...m[2].split(', ')]))
    }
    for (const stage of STAGES) {
      const expected = required.filter((id) => checks.find((c) => c.id === id)?.stage === stage.n)
      expect([...(named.get(stage.n) ?? [])].sort()).toEqual(expected.sort())
    }
  })

  test('the signatures did not change, and the file says which check catches which mistake', () => {
    const src = read('labs/mpmc-queue/src/queue.rs')
    expect(src).toContain('pub fn new(capacity: usize) -> Self')
    expect(src).toContain('pub fn push(&self, v: u64) -> Result<(), u64>')
    expect(src).toContain('pub fn pop(&self) -> Option<u64>')
    expect(src).toContain('Which check catches which mistake')
  })

  test('the page walks the PRIMM steps in order', () => {
    expect(PRIMM_STEPS.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
  })

  test('the lab’s KCs are the two the graph tags with this lab', () => {
    const tags = new Set(checks.flatMap((c) => c.kcs ?? []))
    expect([...tags].sort()).toEqual([...LAB_KCS].sort())
    const graph = read('src/data/kc/t2.ts')
    for (const id of LAB_KCS) expect(graph).toContain(`id: '${id}'`)
  })
})

describe('stage rows and attempts-to-green, over lab 04’s checks', () => {
  const ids = (...a: string[]) => new Set(a)

  test('nothing passed: stage 1 is next, nothing is green', () => {
    const rows = stageRows(checks, ids())
    expect(rows.every((r) => !r.green)).toBe(true)
    expect(currentStage(rows)?.n).toBe(1)
    expect(greenStage(rows)).toBe(0)
  })

  test('fifo alone turns stage 1 green, and stage 3 needs both wraparound and slot_conservation', () => {
    expect(stageRows(checks, ids('fifo')).map((r) => r.green)).toEqual([true, false, false, false])
    const half = stageRows(checks, ids('fifo', 'backpressure', 'wraparound'))
    expect(half.map((r) => r.green)).toEqual([true, true, false, false])
    expect(greenStage(stageRows(checks, ids('fifo', 'backpressure', 'wraparound', 'slot_conservation')))).toBe(3)
  })

  test('the six required checks make four green stages', () => {
    const rows = stageRows(checks, ids(...required))
    expect(greenStage(rows)).toBe(4)
    expect(currentStage(rows)).toBeNull()
    expect(rows).toHaveLength(4)
  })

  test('attempts-to-green counts runs from the run after the previous stage went green', () => {
    const runs = [[], ['fifo'], ['fifo'], ['fifo', 'backpressure'], ['fifo', 'backpressure', 'wraparound', 'slot_conservation']]
    expect(attemptsToGreen(runs, checks)).toEqual([2, 2, 1, null])
  })
})

/* ------------------------------ the harness, ported ------------------------------ */

describe('the ported checks hold the facts the items and rungs state', () => {
  test('a correct queue passes all six checks, whatever the seed, at every capacity the checks use', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i * 7919 + 1)
    expect(failing(undefined, seeds)).toEqual([])
  })

  test('which mutant fails which one-thread check is the committed calibration’s answer, exactly', () => {
    for (const id of ['fifo', 'backpressure', 'wraparound', 'slot_conservation']) {
      for (const m of MUTANTS) {
        const fails = runCheck(id, (cap) => new Ring(cap, m)) !== null
        expect(fails, `${id} against ${m}`).toBe(calibration.checks[id].mutants[m] === 1)
      }
    }
  })

  test('a mutant the calibration always catches in a seeded check fails it on every seed here too', () => {
    const seeds = Array.from({ length: 25 }, (_, i) => i * 104729 + 3)
    for (const id of ['model_gauntlet', 'burst_model']) {
      for (const m of MUTANTS) {
        if (calibration.checks[id].mutants[m] !== 1) continue
        for (const s of seeds) expect(runCheck(id, (cap) => new Ring(cap, m), s), `${id} against ${m}, seed ${s}`).not.toBeNull()
      }
    }
  })

  test('the lib.rs header and the queue.rs header say what the browser cannot see', () => {
    const lib = read('labs/mpmc-queue/src/lib.rs')
    expect(lib).toContain('stress_threads')
    expect(lib).toContain('4 producers')
    const header = read('labs/mpmc-queue/src/queue.rs').replace(/^\/\/! ?/gm, '').replace(/\s+/g, ' ')
    expect(header).toContain('a wrong Release or Acquire passes every check above')
  })
})

/* ------------------------------ the reference run ------------------------------ */

describe('the reference run: the Fleet’s queue on bursty traffic', () => {
  const ref = runBursts(REFERENCE)

  test('it is deterministic in its config, and a different seed is a different run', () => {
    expect(runBursts(REFERENCE)).toEqual(ref)
    expect(runBursts({ ...REFERENCE, seed: PRACTICE_SEED + 1 })).not.toEqual(ref)
    expect(RUN_SPEC.run(RUN_SPEC.reference)).toEqual(RUN_SPEC.run(RUN_SPEC.reference))
  })

  test('the traffic is drawn from the seed alone: the Modify step changes the ring and nothing else', () => {
    const ops = burstOps(PRACTICE_SEED)
    expect(ops).toHaveLength(BURSTS.ops)
    expect(burstOps(PRACTICE_SEED)).toEqual(ops)
    expect(runBursts({ seed: PRACTICE_SEED, capacity: 16 }).pushes).toBe(ref.pushes)
    expect(runBursts({ seed: PRACTICE_SEED, capacity: 16 }).pops).toBe(ref.pops)
    expect(ref.pushes + ref.pops).toBe(BURSTS.ops)
    // bursts: every run of pushes is 3 to 8 long, and every run of pops 1 to 5, except where the run is cut at the 40th op
    const runs: { push: boolean; n: number }[] = []
    for (const p of ops) {
      if (runs.length > 0 && runs[runs.length - 1].push === p) runs[runs.length - 1].n++
      else runs.push({ push: p, n: 1 })
    }
    for (const r of runs.slice(0, -1)) {
      expect(r.n).toBeGreaterThanOrEqual(r.push ? BURSTS.pushes.min : BURSTS.pops.min)
      expect(r.n).toBeLessThanOrEqual(r.push ? BURSTS.pushes.max : BURSTS.pops.max)
    }
  })

  test('the numbers: 12 of 28 pushes refused at 8 slots, 4 at 16, the run never over its capacity and in order', () => {
    expect(CAPACITY).toBe(8)
    expect(ref.pushes).toBe(28)
    expect(ref.full).toBe(12)
    expect(ref.pops).toBe(12)
    expect(ref.empty).toBe(0)
    expect(ref.endLen).toBe(4)
    expect(ref.peak).toBe(8)
    expect(ref.fifo).toBe(true)
    const doubled = runBursts({ seed: PRACTICE_SEED, capacity: 16 })
    expect(doubled.full).toBe(4)
    expect(doubled.fifo).toBe(true)
    expect(doubled.peak).toBeLessThanOrEqual(16)
  })

  test('a bigger ring never refuses more, on any seed', () => {
    for (let seed = 1; seed <= 60; seed++) {
      expect(runBursts({ seed, capacity: 16 }).full).toBeLessThanOrEqual(runBursts({ seed, capacity: 8 }).full)
    }
  })

  test('the refusals agree with Vyukov’s ring on the same ops, at both capacities the page shows', () => {
    for (const capacity of [8, 16]) {
      for (const seed of [PRACTICE_SEED, 1, 2, 3, 99]) {
        const r = new Ring(capacity)
        let full = 0
        let n = 0
        for (const push of burstOps(seed)) {
          if (push) {
            if ('err' in r.push(++n)) full++
          } else r.pop()
        }
        expect(full, `capacity ${capacity}, seed ${seed}`).toBe(runBursts({ seed, capacity }).full)
      }
    }
  })

  test('frames: one per op after the start, one cell per slot, the occupied cells are where a ring puts the positions', () => {
    const result = RUN_SPEC.run(RUN_SPEC.reference)
    expect(result.frames).toHaveLength(BURSTS.ops + 1)
    expect(result.value).toBe(ref.full)
    expect(result.truth).toBe(ref.pushes)
    expect(result.truth).toBeGreaterThanOrEqual(result.value)
    expect(result.clean).toBe(true)
    expect(result.frames[0].cells.filter((c) => c > 0)).toHaveLength(0)
    result.frames.forEach((f, i) => {
      expect(f.cells).toHaveLength(CAPACITY)
      expect(f.cells.filter((c) => c > 0)).toHaveLength(ref.samples[i].len)
      expect(f.alt).toContain(`ring of ${CAPACITY} slots`)
    })
    // after 8 pushes and no pop the cells 0..7 are all full: position p sits in slot p
    expect(ref.samples[BURSTS.pushes.min].occupied).toEqual(Array.from({ length: BURSTS.pushes.min }, (_, i) => i))
  })

  test('the Modify dial is a whole config for the same seed with twice the slots', () => {
    const dials = RUN_SPEC.modify?.dials ?? []
    expect(dials.map((d) => d.id)).toEqual(['cap16'])
    expect(dials[0].config).toEqual({ seed: PRACTICE_SEED, capacity: 16 })
    const result = RUN_SPEC.run(dials[0].config)
    expect(result.value).toBe(4)
    expect(result.frames[0].cells).toHaveLength(16)
    expect(result.summary).toContain('16 slots')
  })

  test('the run is not the burst_model check, and says so in its disclaimer and caption', () => {
    expect(RUN_SPEC.disclaimer).toContain('not the check itself')
    expect(RUN_SPEC.title(RUN_SPEC.reference)).toContain('Fleet')
    expect(describeRun(ref)).toContain('12 pushes of 28 replied full')
    expect(describeRun(ref)).toContain('came out in the order they went in')
  })

  test('the Run step writes one observation for the reference config, with no KCs', () => {
    const r = runResponse(ref)
    expect(r.ref).toBe(primmRef(RUN_ITEM.id))
    expect(r.data).toMatchObject({ kcs: [], value: 12, truth: 28 })
  })

  test('the Fleet’s reference queue is the capacity-honest FIFO the run claims', () => {
    const q = makeRefQueue(2)
    expect([q.push(1), q.push(2), q.push(3)]).toEqual([true, true, false])
    expect([q.pop(), q.pop(), q.pop()]).toEqual([1, 2, null])
  })
})

/* ------------------------------ items ------------------------------ */

describe('items (§8.2): ids, refs, tags, whys', () => {
  test('ids are item:lab04.primm.* and unique; two Predict, three Investigate, one Modify', () => {
    const ids = PRIMM_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [...ids, RUN_ITEM.id]) {
      expect(id.startsWith('lab04.primm.')).toBe(true)
      expect(refMatchesKind('item', primmRef(id))).toBe(true)
    }
    const count = (step: string) => PRIMM_ITEMS.filter((i) => i.step === step).length
    expect([count('predict'), count('investigate'), count('modify')]).toEqual([2, 3, 1])
    expect(PRIMM_ITEMS).toHaveLength(6)
  })

  test('Predict is one estimate of refused pushes and one choice on the first check to fail', () => {
    const predict = PRIMM_ITEMS.filter((i) => i.step === 'predict')
    expect(predict.map((i) => i.kind).sort()).toEqual(['choice', 'estimate'])
    const estimate = predict.find((i): i is NumberPrimm => i.kind === 'estimate')
    expect(estimate?.unit).toBe('pushes')
    expect(estimate?.prompt).toContain(`holds ${CAPACITY} values`)
    expect(estimate?.prompt).toContain(`${BURSTS.ops} ops`)
    expect(estimate?.prompt).toContain(`${BURSTS.pushes.min} to ${BURSTS.pushes.max} pushes`)
    expect(estimate?.prompt).toContain(`${BURSTS.pops.min} to ${BURSTS.pops.max} pops`)
  })

  test('the estimate is graded against the reference run, and the reference lies inside its window', () => {
    const p1 = PRIMM_ITEMS.find((i) => i.id === 'lab04.primm.p1') as NumberPrimm
    const truth = RUN_SPEC.run(RUN_SPEC.reference).value
    expect(truth).toBe(12)
    expect(gradeNumber(p1, truth, truth).ok).toBe(true)
    expect(gradeNumber(p1, 8, truth).ok).toBe(true)
    expect(gradeNumber(p1, 18, truth).ok).toBe(true)
    expect(gradeNumber(p1, 28, truth).ok).toBe(false)
    expect(gradeNumber(p1, 0, truth).ok).toBe(false)
    expect(p1.explain).toContain('12 of 28')
  })

  test('the Modify item is one estimate, and its prompt quotes the reference run’s own refusals', () => {
    const modify = PRIMM_ITEMS.filter((i) => i.step === 'modify')
    expect(modify).toHaveLength(1)
    const m1 = modify[0] as NumberPrimm
    expect(m1.kind).toBe('estimate')
    expect(m1.unit).toBe('pushes')
    expect(m1.prompt).toContain(`refused ${ref12()} of its 28 pushes`)
    // the dial's run is the truth the panel grades against
    const truth = RUN_SPEC.run((RUN_SPEC.modify?.dials ?? [])[0].config).value
    expect(gradeNumber(m1, truth, truth).ok).toBe(true)
    expect(gradeNumber(m1, ref12(), truth).ok).toBe(false)
  })

  test('every item is tagged with known KCs and a nominal time', () => {
    for (const i of PRIMM_ITEMS) {
      const kcs = i.kind === 'choice' ? i.item.kcs : i.kcs
      expect(kcs.length).toBeGreaterThan(0)
      for (const k of kcs) expect(LAB_KCS).toContain(k)
      expect(i.nsec).toBeGreaterThan(0)
    }
    expect(kcValues.size).toBeGreaterThan(0)
  })

  test('every multiple-choice item has four options, one key and a why for each option', () => {
    expect(PRIMM_MC_ITEMS).toHaveLength(3)
    for (const { id, q } of PRIMM_MC_ITEMS) {
      expect(q.options.length).toBe(4)
      expect(q.correct.length).toBe(1)
      expect(q.why?.length).toBe(q.options.length)
      for (const w of q.why ?? []) expect(w.trim().length).toBeGreaterThan(20)
      expect(new Set(q.options).size).toBe(q.options.length)
      expect(q.kcs?.length).toBeGreaterThan(0)
      expect(id.startsWith('lab04.primm.')).toBe(true)
    }
  })

  test('PRIMM_MC_ITEMS is exactly the bundle’s choice items, the pool verify-items reads', () => {
    expect(PRIMM_MC_ITEMS).toEqual(bundle.primm.items.flatMap((i) => (i.kind === 'choice' ? [i.item] : [])))
  })

  test('the answer keys are not all in one position', () => {
    const keys = PRIMM_MC_ITEMS.map((i) => i.q.correct[0])
    expect(new Set(keys).size).toBeGreaterThan(1)
  })

  test('i1: a 4-slot ring, four pushes, three pops, two pushes leaves seq[1] at 6, and each lure is a stop on the way', () => {
    const i1 = PRIMM_ITEMS.find((i) => i.id === 'lab04.primm.i1') as NumberPrimm
    const r = new Ring(4)
    expect(r.seq).toEqual([0, 1, 2, 3])
    const afterFirst: number[] = []
    for (let v = 1; v <= 4; v++) r.push(v)
    afterFirst.push(r.seq[1])
    expect(r.seq).toEqual([1, 2, 3, 4])
    for (let i = 0; i < 3; i++) r.pop()
    const afterPops = r.seq[1]
    expect(r.seq).toEqual([4, 5, 6, 4])
    r.push(5)
    r.push(6)
    expect(r.seq).toEqual([5, 6, 6, 4])
    expect(i1.truth).toBe(r.seq[1])
    const lures = Object.fromEntries((i1.lures ?? []).map((l) => [l.value, l.miss]))
    expect(Object.keys(lures).map(Number).sort()).toEqual([1, 2, afterPops].sort())
    expect(afterFirst[0]).toBe(2)
    for (const lure of i1.lures ?? []) {
      expect(lure.value).not.toBe(i1.truth)
      const g = gradeNumber(i1, lure.value, i1.truth ?? -1)
      expect(g.ok).toBe(false)
      expect(g.miss).toBe(lure.miss)
      expect(g.feedback).toContain(lure.message)
    }
    expect(gradeNumber(i1, 6, 6).ok).toBe(true)
  })

  test('p2: a pop that frees at h + 1 passes fifo, fails backpressure first, and fails the three later stages too', () => {
    expect(firstRed('no-recycle')).toBe('backpressure')
    expect(failing('no-recycle')).toEqual(['backpressure', 'wraparound', 'model_gauntlet', 'slot_conservation', 'burst_model'])
    expect(failing('no-recycle')).not.toContain('fifo')
    // the why's numbers: in backpressure, slot 0 must read 4 for the push at position 4, and the release left it at 1
    const q = new Ring(4, 'no-recycle')
    for (let v = 10; v < 14; v++) q.push(v)
    q.push(99)
    q.pop()
    expect(q.seq[0]).toBe(1)
    expect(new Ring(4).seq[0] + 4).toBe(4)
    expect('err' in q.push(99)).toBe(true)
    const p2 = PRIMM_MC_ITEMS.find((i) => i.id === 'lab04.primm.p2')!
    expect(p2.q.options[p2.q.correct[0]]).toContain('`backpressure` in stage 2')
    // the gauntlet option's why counts the checks before stage 4 that fail: three, in stages 2 and 3
    const stage = (id: string) => checks.find((c) => c.id === id)?.stage ?? 99
    const before = failing('no-recycle').filter((id) => stage(id) < 4)
    expect(before).toEqual(['backpressure', 'wraparound', 'slot_conservation'])
    expect(new Set(before.map(stage))).toEqual(new Set([2, 3]))
    expect(calibration.checks.model_gauntlet.mutants['no-recycle']).toBe(1)
    const gauntletWhy = p2.q.why?.[3] ?? ''
    expect(gauntletWhy).toContain('Three checks in two earlier stages')
    for (const id of before) expect(gauntletWhy).toContain(`\`${id}\``)
    expect(gauntletWhy).toContain('`backpressure` in stage 2, then `wraparound` and `slot_conservation` in stage 3')
    expect(gauntletWhy).toContain('every seed the calibration ran')
  })

  test('p2’s options name the checks in stage order, so "going through the stages in order" is well defined', () => {
    const p2 = PRIMM_MC_ITEMS.find((i) => i.id === 'lab04.primm.p2')!
    const named = p2.q.options.map((o) => /^`([a-z_]+)` in stage (\d)/.exec(o))
    expect(named.map((m) => m?.[1])).toEqual(['fifo', 'backpressure', 'wraparound', 'model_gauntlet'])
    for (const m of named) expect(String(checks.find((c) => c.id === m?.[1])?.stage)).toBe(m?.[2])
  })

  test('i2: dif is below zero when the slot holds last lap’s value, above zero when another producer published it', () => {
    const q = new Ring(4)
    for (let v = 0; v < 4; v++) q.push(v)
    // the ring is full: the push at position 4 reads slot 0 at seq 1, and 1 - 4 < 0
    expect(q.seq[4 % 4] - q.tail).toBeLessThan(0)
    expect('err' in q.push(9)).toBe(true)
    // a fresh slot at its own position is dif == 0; once published for that position it is dif == +1
    const f = new Ring(4)
    expect(f.seq[0] - f.tail).toBe(0)
    f.push(1)
    expect(f.seq[0] - 0).toBe(1)
    const i2 = PRIMM_MC_ITEMS.find((i) => i.id === 'lab04.primm.i2')!
    expect(i2.q.options[i2.q.correct[0]]).toContain('the ring is full')
    expect(read('labs/mpmc-queue/src/queue.rs')).toContain('dif > 0: someone beat you')
  })

  test('i3: the other three mistakes are each caught by a one-thread check, and the Relaxed store is invisible to all six', () => {
    expect(firstRed('stale-slot')).toBe('fifo')
    expect(firstRed('swap-err')).toBe('backpressure')
    expect(failing('swap-err')).not.toContain('fifo')
    const leaks = failing('leak-slot')
    expect(leaks).toContain('wraparound')
    expect(leaks).toContain('slot_conservation')
    expect(leaks).not.toContain('fifo')
    expect(leaks).not.toContain('backpressure')
    // the why's 'soon after the 50th pop': the 50th pop (position 49) is the first not released. In wraparound's
    // 4-slot ring that is slot 1, whose next push (position 53, the second of cycle 13) is refused two pops later;
    // in slot_conservation's 16-slot ring it is slot 1 again, refused at the second push of cycle 4, 14 pops later.
    const leak = (cap: number) => new Ring(cap, 'leak-slot')
    expect(runCheck('wraparound', leak)).toBe('cycle 13: push failed')
    expect(runCheck('slot_conservation', leak)).toBe('cycle 4: the ring is leaking slots')
    const q = leak(4)
    let refused: { tail: number; pops: number } | null = null
    for (let cycle = 0; refused === null && cycle < 1000; cycle++) {
      for (let i = 0; refused === null && i < 4; i++) if ('err' in q.push(cycle * 4 + i + 1)) refused = { tail: q.tail, pops: q.pops }
      if (refused === null) for (let i = 0; i < 4; i++) q.pop()
    }
    expect(refused).toEqual({ tail: 53, pops: 52 })
    expect(53 % 4).toBe(49 % 4)
    const q16 = leak(16)
    let refused16: { tail: number; pops: number } | null = null
    for (let cycle = 0; refused16 === null && cycle < 100; cycle++) {
      for (let v = 0; refused16 === null && v < 16; v++) if ('err' in q16.push(v)) refused16 = { tail: q16.tail, pops: q16.pops }
      if (refused16 === null) for (let i = 0; i < 16; i++) q16.pop()
    }
    expect(refused16).toEqual({ tail: 65, pops: 64 })
    expect(65 % 16).toBe(49 % 16)
    // one thread: a correct queue passes everything, so no mutant list here includes a wrong memory ordering
    expect(failing(undefined)).toEqual([])
    expect(MUTANTS).toHaveLength(7)
    const i3 = PRIMM_MC_ITEMS.find((i) => i.id === 'lab04.primm.i3')!
    expect(i3.q.options[i3.q.correct[0]]).toContain('`Relaxed`')
  })
})

function ref12(): number {
  return runBursts(REFERENCE).full
}

describe('grading', () => {
  test('a choice: the key passes and each other option fails with its own why first', () => {
    for (const i of PRIMM_ITEMS) {
      if (i.kind !== 'choice') continue
      const { q } = i.item
      for (let pick = 0; pick < q.options.length; pick++) {
        const g = gradeChoice(i, pick)
        expect(g.ok).toBe(q.correct.includes(pick))
        expect(g.feedback.startsWith(q.why?.[pick] ?? '')).toBe(true)
      }
    }
  })

  test('an answer is one practice item event, tagged with the item’s KCs', () => {
    const i = PRIMM_ITEMS.find((x) => x.id === 'lab04.primm.p2')
    if (i === undefined || i.kind !== 'choice') throw new Error('p2 is a choice')
    const r = itemResponse({ item: i, grade: gradeChoice(i, i.item.q.correct[0]), pick: i.item.q.correct[0] })
    expect(r.ref).toBe('item:lab04.primm.p2')
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ src: 'practice', kcs: ['t2.mutex-atomics', 't2.aba'] })
  })
})

/**
 * The blind-strategy gates of verify:items, on this pool: the key is never strictly the longest option, no key/distractor
 * length ratio above 1.3, no blind strategy passes the pool, and no single-feature strategy beats chance by 15 points.
 */
describe('multiple-choice items clear the verify-items gates', () => {
  const items = PRIMM_MC_ITEMS.map((i) => ({ ref: i.id, q: i.q }))

  test('the key is never strictly the longest option, and never more than 1.3 times a distractor’s length', () => {
    for (const { ref, q } of items) {
      const lens = q.options.map((o) => o.trim().length)
      const key = lens[q.correct[0]]
      expect(key < Math.max(...lens), `${ref}: the key is the longest option`).toBe(true)
      const others = lens.filter((_, n) => n !== q.correct[0])
      expect(key / (others.reduce((a, b) => a + b, 0) / others.length), `${ref}: key / mean distractor`).toBeLessThanOrEqual(1.3)
    }
  })

  test('no blind strategy passes the pool as a lesson at the pass bar', () => {
    for (const s of CUE_STRATEGIES) {
      expect(passProbability(items.map((i) => s.pick(i.q))), s.name).toBeLessThan(MAX_RANK_LESSON)
    }
    expect(PASS_BAR).toBe(0.8)
  })

  test('no feature isolates a key, and with the three labs already on the base the 15 items stay under chance + 15 points', () => {
    // On its own the lab has 3 choice items, below the 12-item minimum for a pool, so a strategy that hits 2 of 3 reads as 67 %;
    // the merged-level `verify:items` decides (spec §8.2). What can be held here is the pool as it stands with this lab added.
    expect(items.flatMap((i) => oddOneOut(i.q))).toEqual([])
    const merged = [...ALLOCATOR_MC, ...KV_MC, ...BPE_MC, ...PRIMM_MC_ITEMS].map((i) => ({ ref: i.id, q: i.q }))
    expect(merged).toHaveLength(15)
    expect(poolCueFailures('primm', merged)).toEqual([])
  })
})

/* ------------------------------ the hint ladder ------------------------------ */

describe('the faded hint ladder (§8.2, D13, D26): R0 to R2 for the six required checks', () => {
  const h2s = new Map<string, Set<string>>()
  for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))
  const libRs = read('labs/mpmc-queue/src/lib.rs')

  test('the bundle is faded: it covers the six required checks in the order the module lists them, with no R3 or R4', () => {
    expect(bundle.fade).toBe('r2')
    expect([...LADDER_CHECK_IDS]).toEqual(required)
    expect(bundle.ladder.map((c) => c.checkId)).toEqual(required)
    expect(Object.keys(LADDER).sort()).toEqual([...required].sort())
    for (const c of bundle.ladder) {
      expect('r3' in c).toBe(false)
      expect('r4' in c).toBe(false)
    }
    expect(bundle.walkthrough).toBeUndefined()
  })

  test('verify:mentor’s lint finds nothing: limits, real H2 anchors, real check functions', () => {
    expect(lintBundle(bundle, { required, libRs, h2s })).toEqual([])
  })

  test('R2 names the check’s function in lib.rs, which exists', () => {
    for (const c of bundle.ladder) {
      expect(c.r2.fn).toBe(`check_${c.checkId}`)
      expect(c.r2.text).toContain('lib.rs')
      expect(libRs).toContain(`pub fn ${c.r2.fn}(`)
    }
  })

  test('R1 links an H2 of the host lesson t2.l5, where the concept is taught', () => {
    for (const c of bundle.ladder) {
      expect(c.r1.link.lessonId).toBe('t2.l5')
      expect(h2s.get('t2.l5')?.has(c.r1.link.anchor)).toBe(true)
    }
    expect(lab.lessonId).toBe('t2.l5')
  })

  test('R0 states the numbers the harness uses, read from lib.rs', () => {
    const text = (id: string) => LADDER[id].r0.ideas.join(' ')
    expect(libRs).toContain('Queue::new(8)')
    expect(text('fifo')).toContain('8-slot')
    expect(libRs).toContain('Queue::new(4)')
    expect(text('backpressure')).toContain('4-slot')
    expect(text('backpressure')).toContain('Err(99)')
    expect(libRs).toContain('for cycle in 0..1000')
    expect(text('wraparound')).toContain('1,000 laps')
    expect(libRs).toContain('for op in 0..3000')
    expect(libRs).toContain('let cap = 4usize << rng.below(4)')
    expect(libRs).toContain('let push_pct = 40 + rng.below(25)')
    expect(text('model_gauntlet')).toContain('4, 8, 16 or 32')
    expect(text('model_gauntlet')).toContain('40 to 64 percent')
    expect(libRs).toContain('Queue::new(16)')
    expect(libRs).toContain('for cycle in 0..100')
    expect(text('slot_conservation')).toContain('16-slot')
    expect(libRs).toContain('let cap = 8usize << rng.below(3)')
    expect(libRs).toContain('while ops < 2000')
    expect(text('burst_model')).toContain('8, 16 or 32')
  })

  test('each rung is about this lab: no block-manager or allocator wording leaks in, and none quotes a private file', () => {
    for (const c of bundle.ladder) {
      const all = [c.r0.prompt, ...c.r0.ideas, c.r1.text, c.r2.text].join(' ')
      expect(all).not.toMatch(/allocator\.rs|first-fit|coalesc|refcount|block table/i)
      expect(all).not.toContain('_solutions')
    }
  })

  test('acks live under hint:mpmc-queue/, and a rung acked there comes back open', () => {
    expect(hintRef('wraparound', 'R2')).toBe('hint:mpmc-queue/wraparound#R2')
    const state = restoreState({ [hintRef('fifo', 'R0')]: '2026-10-13T00:00:00.000Z' }, 'fifo', { red: 1, now: Date.parse('2026-10-13T00:01:00.000Z') })
    expect(state.opened.R0).toBeDefined()
    expect(state.opened.R1).toBeUndefined()
  })

  test('the panel draws a card for each of the six red checks, stops at R2, and labels its Ask-a-human post "[lab 04]"', () => {
    const rows: CheckResult[] = required.map((id) => ({ id, label: id, status: 'fail', msg: `${id} says no` }))
    const report: LabRunReport = { lab: LAB_ID, reference: false, abi: 2, version: 2, checks: rows, seeds: 'fresh', ms: 5 }
    const acks = Object.fromEntries((['R0', 'R1', 'R2'] as const).map((r) => [hintRef('wraparound', r), '2026-10-13T00:00:00.000Z']))
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(HintLadderView, { bundle, reports: [report], acks, onAck: () => {}, now: () => 0 })),
    )
    for (const id of required) expect(html).toContain(`data-check="${id}"`)
    expect(html).toContain(LADDER.wraparound.r2.text)
    for (const gone of ['R3', 'R4', 'Bottom-out', 'Show the walkthrough']) expect(html).not.toContain(gone)
    const href = /href="(https:\/\/github\.com\/[^"]*discussions\/new[^"]*)"/.exec(html)?.[1]
    expect(new URL((href ?? '').replace(/&amp;/g, '&')).searchParams.get('title')).toMatch(/^\[lab 04\] [a-z_]+: /)
  })
})

/* ------------------------------ Prove-it v1 ------------------------------ */

describe('Prove-it v1 (§8.2): six questions, three drawn', () => {
  test('six questions with distinct ids, three checkable ideas each and this lab’s KCs', () => {
    expect(PROVE_QUESTIONS).toHaveLength(6)
    expect(new Set(PROVE_QUESTIONS.map((q) => q.id)).size).toBe(6)
    for (const q of PROVE_QUESTIONS) {
      expect(q.ideas).toHaveLength(3)
      expect(q.prompt.trim().length).toBeGreaterThan(20)
      expect(q.model.trim().length).toBeGreaterThan(100)
      expect(q.kcs.length).toBeGreaterThan(0)
      for (const k of q.kcs) expect(LAB_KCS).toContain(k)
    }
  })

  test('the draw is three distinct questions of this pool, and a retry takes the ones not yet served', () => {
    const first = pickQuestions([], 11)
    expect(first).toHaveLength(3)
    expect(new Set(first.map((q) => q.id)).size).toBe(3)
    const second = pickQuestions([{ at: '2026-10-13T00:00:00.000Z', qids: first.map((q) => q.id), score: 1 }], 11)
    expect(second.every((q) => !first.some((f) => f.id === q.id))).toBe(true)
  })

  test('the follow-up ref and the ledger payload carry lab 04’s id', () => {
    expect(PROVE_LAB_ID).toBe('mpmc-queue')
    expect(followUpRef('claim-cas')).toBe('item:lab04.prove.claim-cas')
    expect(refMatchesKind('item', followUpRef('claim-cas'))).toBe(true)
    const qs = pickQuestions([], 5)
    const result = buildProveResult(
      qs,
      qs.map(() => ({ answer: 'word '.repeat(20), revealed: true, self: 1 as const })),
    )
    expect(result?.labId).toBe('mpmc-queue')
    expect(result?.data.qids).toEqual(qs.map((q) => q.id))
  })

  test('the model answers state the design the header lays out', () => {
    const model = (id: string) => PROVE_QUESTIONS.find((q) => q.id === id)?.model ?? ''
    // release at h + capacity, not h + 1 (the same fact as p2)
    expect(model('release-lap')).toContain('position plus the capacity')
    // full and empty are told apart by the slot, with the cases of the claim loop
    expect(model('full-or-empty')).toContain('h + 1')
    // capacity 6: a ring that rounds up accepts eight, one that keeps it accepts six
    const accepted = (round: (c: number) => number) => {
      const q = new Ring(round(6))
      let n = 0
      while ('ok' in q.push(++n)) continue
      return n - 1
    }
    expect(accepted((c) => 2 ** Math.ceil(Math.log2(c)))).toBe(8)
    expect(accepted((c) => c)).toBe(6)
    expect(model('capacity-rounding')).toContain('eight pushes')
    expect(model('capacity-rounding')).toContain('accept six')
  })

  test('the panel draws its questions from the bundle, with none of another lab’s', () => {
    const html = renderToString(createElement(ProveIt, { bundle, history: [], now: 0, seed: 3 })).replaceAll('<!-- -->', '')
    expect(html).toContain('data-prove="active"')
    const shown = [...html.matchAll(/data-qid="([a-z-]+)"/g)].map((m) => m[1])
    expect(shown).toHaveLength(1)
    expect(PROVE_QUESTIONS.map((q) => q.id)).toContain(shown[0])
    expect(html).not.toContain('allocator')
  })
})

/* ------------------------------ the bundle ------------------------------ */

describe('the bundle', () => {
  test('the registry finds it by directory name and loads the same object', async () => {
    expect(await forgeBundleIds()).toContain('mpmc-queue')
    expect(await loadForgeBundle('mpmc-queue')).toBe(bundle)
    expect(await findForgeBundle('mpmc-queue')).toBe(bundle)
  })

  test('it is lab 04, labelled "[lab 04]", faded to R2, with prove2 and no walkthrough', () => {
    expect(bundle.labId).toBe(LAB_ID)
    expect(bundle.labId).toBe('mpmc-queue')
    expect(bundle.discussionsLabel).toBe(DISCUSSIONS_LABEL)
    expect(bundle.discussionsLabel).toBe('[lab 04]')
    expect(bundle.fade).toBe('r2')
    expect(bundle.walkthrough).toBeUndefined()
    expect(bundle.prove).toHaveLength(6)
    expect(bundle.prove2).toBe(PROVE2)
  })

  test('the generic panels render it: PRIMM steps, the reference strip, the stage list', () => {
    const predict = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks, passed: new Set<string>(), initial: 'predict', title: lab.title }))
    expect(predict).toContain(`aria-label="${lab.title}, in five steps"`)
    expect(predict).toContain('data-item="lab04.primm.p1"')
    expect(predict).toContain('data-item="lab04.primm.p2"')
    const modify = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks, passed: new Set<string>(), initial: 'modify' }))
    expect(modify).toContain('slots 8 becomes 16')
    const strip = renderToStaticMarkup(createElement(ReferenceRun, { bundle, config: RUN_SPEC.reference }))
    expect(strip).toContain('data-reference-run="mpmc-queue"')
    expect(strip).toContain('role="img"')
    const stages = renderToStaticMarkup(createElement(StagePanel, { bundle, checks, passed: new Set<string>() }))
    expect(stages).toContain('The ring')
    expect(stages).toContain('The model')
  })
})

/* ------------------------------ Prove-it v2 ------------------------------ */

/**
 * How a module's `new` treats a capacity that is not a power of two. `up`: rounds up (the lab's reference, `next_power_of_two`).
 * `exact`: keeps it (the slot is a remainder). `down`: rounds down. All three pass the six checks, which use only powers of two.
 */
type Rounding = 'up' | 'exact' | 'down'

interface Opts {
  rounding?: Rounding
  /** A wrong model of the prediction: a pop that takes the newest value. */
  stack?: boolean
  /** A wrong model of the prediction: a push into a full queue that overwrites the oldest value. */
  overwrite?: boolean
}

type Handler = (cmd: string) => string

const effective = (c: number, r: Rounding): number => (r === 'up' ? 2 ** Math.ceil(Math.log2(c)) : r === 'down' ? 2 ** Math.floor(Math.log2(c)) : c)

/** A line-protocol queue over the bridge's verbs: Vyukov's ring for the correct modules, a plain deque for the wrong models. */
function fakeQueue(o: Opts = {}): () => Handler {
  const rounding = o.rounding ?? 'up'
  return () => {
    let ring: Ring | null = null
    let cap = 0
    const deque: number[] = []
    const wrong = o.stack === true || o.overwrite === true
    return (cmd) => {
      const [op, arg] = cmd.trim().split(/\s+/)
      if (op === 'init') {
        cap = effective(Number(arg), rounding)
        ring = new Ring(cap)
        deque.length = 0
        return 'ok'
      }
      if (ring === null) return 'err not initialized'
      if (op === 'push') {
        const v = Number(arg)
        if (!wrong) return 'ok' in ring.push(v) ? 'ok' : 'full'
        if (deque.length >= cap) {
          if (!o.overwrite) return 'full'
          deque.shift()
        }
        deque.push(v)
        return 'ok'
      }
      if (op === 'pop') {
        if (!wrong) return String(ring.pop() ?? 'empty')
        const v = o.stack ? deque.pop() : deque.shift()
        return v === undefined ? 'empty' : String(v)
      }
      return 'err unknown command'
    }
  }
}

const answerOn = async (t: ProveV2Template, seed: number, module: () => Handler): Promise<number> => {
  const replies = await fakeBridge(module).run(new ArrayBuffer(0), planQuestion(t, seed).calls)
  return t.read(replies) as number
}

const SEEDS = [...Array.from({ length: 200 }, (_, i) => i), 4_000_000_000, 0xffffffff, 123_456_789]
const VERBS = ['init', 'push', 'pop']
const ROUNDINGS: Rounding[] = ['up', 'exact', 'down']

describe('lab 04 exposes Prove-it v2', () => {
  test('the bundle carries the three templates, in the order the panel rotates them', async () => {
    expect(bundle.prove2).toBe(PROVE2)
    expect(PROVE2.templates.map((t) => t.id)).toEqual(['last-pop', 'full-count', 'after-wrap'])
    expect((await loadForgeBundle('mpmc-queue')).prove2?.templates.map((t) => t.id)).toEqual(['last-pop', 'full-count', 'after-wrap'])
  })

  test('each template names the KCs of the checks it exercises and the bug its test separates', () => {
    expect(LAST_POP.kcs).toEqual(['t2.mutex-atomics'])
    expect(FULL_COUNT.kcs).toEqual(['t2.mutex-atomics'])
    expect(AFTER_WRAP.kcs).toEqual(['t2.aba'])
    for (const t of PROVE2.templates) {
      expect(t.bug.length).toBeGreaterThan(20)
      for (const k of t.kcs) expect(LAB_KCS).toContain(k)
    }
  })
})

describe('every trace is at most 12 calls of the bridge verbs, told in words, with a number to predict', () => {
  test('on every seed: 1 to 12 calls, an init first, only init, push and pop, a numeric answer', () => {
    expect(TRACE_OPS + 1).toBe(PROVE2_MAX_CALLS)
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        expect(q.calls.length).toBeLessThanOrEqual(PROVE2_MAX_CALLS)
        expect(q.calls[0]).toMatch(/^init \d+$/)
        for (const c of q.calls) expect(VERBS).toContain(c.split(' ')[0])
        expect(q.calls.slice(1).some((c) => c.startsWith('init'))).toBe(false)
        expect(q.answer).toBe('number')
        expect(q.ask.endsWith('?') || q.ask.endsWith(')')).toBe(true)
      }
    }
  })

  test('last-pop and after-wrap start a 4-slot queue (the size backpressure and wraparound pin); full-count starts 3, 5, 6 or 7', () => {
    expect(RING).toBe(4)
    for (const seed of SEEDS) {
      expect(planQuestion(LAST_POP, seed).calls[0]).toBe('init 4')
      expect(planQuestion(AFTER_WRAP, seed).calls[0]).toBe('init 4')
      const cap = Number(planQuestion(FULL_COUNT, seed).calls[0].split(' ')[1])
      expect([3, 5, 6, 7]).toContain(cap)
      expect(Number.isInteger(Math.log2(cap))).toBe(false)
    }
    const caps = new Set(SEEDS.map((s) => planQuestion(FULL_COUNT, s).calls[0]))
    expect(caps.size).toBe(4)
  })

  test('the story tells every push and pop in order, with its value; the last pop of two templates is the one measured', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        const told = t === FULL_COUNT ? q.calls.slice(1) : q.calls.slice(1, -1)
        expect(q.story).toHaveLength(told.length + 1)
        expect(q.story[0]).toBe(`Start a queue with capacity ${q.calls[0].split(' ')[1]}.`)
        told.forEach((c, i) => {
          expect(q.story[i + 1]).toBe(c === 'pop' ? 'Pop.' : `Push ${c.split(' ')[1]}.`)
        })
        if (t !== FULL_COUNT) expect(q.calls[q.calls.length - 1]).toBe('pop')
        expect(q.ask).toContain(t === FULL_COUNT ? 'full' : 'pop')
      }
    }
  })

  test('pushed values are distinct two-digit numbers, so an answer names one push', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const pushed = planQuestion(t, seed)
          .calls.filter((c) => c.startsWith('push'))
          .map((c) => Number(c.split(' ')[1]))
        expect(new Set(pushed).size).toBe(pushed.length)
        for (const v of pushed) {
          expect(v).toBeGreaterThanOrEqual(10)
          expect(v).toBeLessThanOrEqual(99)
        }
      }
    }
  })

  test('the same seed gives the same question', () => {
    for (const t of PROVE2.templates) expect(planQuestion(t, 77)).toEqual(planQuestion(t, 77))
  })

  test('together the templates drive init, push and pop, the three verbs the bridge answers for this lab', () => {
    const used = new Set(PROVE2.templates.flatMap((t) => SEEDS.flatMap((s) => planQuestion(t, s).calls.map((c) => c.split(' ')[0]))))
    expect([...used].sort()).toEqual([...VERBS].sort())
    expect(read('labs/mpmc-queue/src/lib.rs')).toContain('init <capacity>     → ok')
  })

  test('a correct module replies ok to every init and every push it accepts, a number or empty to a pop, and nothing else', async () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        const replies = await fakeBridge(fakeQueue()).run(new ArrayBuffer(0), q.calls)
        expect(replies[0]).toBe('ok')
        q.calls.forEach((c, i) => {
          if (c.startsWith('push')) expect(['ok', 'full']).toContain(replies[i])
          if (c === 'pop') expect(replies[i]).toMatch(/^(\d+|empty)$/)
        })
      }
    }
  })
})

/* ------------------------------ the rule: a correct module, and your own rounding ------------------------------ */

describe('the fakes stand for real queues', () => {
  test('a ring of any rounding answers as the Fleet’s reference queue does at the capacity it keeps', async () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const plan = planQuestion(t, seed)
        for (const rounding of ROUNDINGS) {
          const cap = effective(Number(plan.calls[0].split(' ')[1]), rounding)
          const q = makeRefQueue(cap)
          const ref = plan.calls.slice(1).map((c) => {
            if (c === 'pop') return String(q.pop() ?? 'empty')
            return q.push(Number(c.split(' ')[1])) ? 'ok' : 'full'
          })
          const got = await fakeBridge(fakeQueue({ rounding })).run(new ArrayBuffer(0), plan.calls)
          expect(got.slice(1), `${t.id} seed ${seed} ${rounding}`).toEqual(ref)
        }
      }
    }
  })

  test('last-pop and after-wrap pin a correct module: every rounding gives one answer (the checks fix FIFO and backpressure at 4)', async () => {
    for (const t of [LAST_POP, AFTER_WRAP]) {
      for (const seed of SEEDS.slice(0, 80)) {
        const answers = new Set<number>()
        for (const rounding of ROUNDINGS) answers.add(await answerOn(t, seed, fakeQueue({ rounding })))
        expect(answers.size).toBe(1)
      }
    }
  })

  test('the fake is a queue that passes the six checks, for every rounding', () => {
    for (const rounding of ROUNDINGS) {
      const mk = (cap: number) => new Ring(effective(cap, rounding))
      expect(CHECK_ORDER.filter((id) => runCheck(id, mk, 0x44c4) !== null)).toEqual([])
    }
  })
})

describe('the answer is not the story’s: it differs across seeds, and a plausible mistake changes it', () => {
  const across = async (t: ProveV2Template, module: () => Handler) => {
    const answers = new Set<number>()
    for (const seed of SEEDS) answers.add(await answerOn(t, seed, module))
    return answers
  }

  test('last-pop: a push that overwrites the oldest value, or a pop that takes the newest, answers something else on every seed', async () => {
    for (const seed of SEEDS) {
      const right = await answerOn(LAST_POP, seed, fakeQueue())
      expect(await answerOn(LAST_POP, seed, fakeQueue({ overwrite: true })), `overwrite, seed ${seed}`).not.toBe(right)
      expect(await answerOn(LAST_POP, seed, fakeQueue({ stack: true })), `stack, seed ${seed}`).not.toBe(right)
    }
    expect((await across(LAST_POP, fakeQueue())).size).toBeGreaterThanOrEqual(40)
  })

  test('last-pop: every trace refuses a push and pops at least twice before the last, so the oldest value left is not the first pushed', async () => {
    for (const seed of SEEDS) {
      const plan = planQuestion(LAST_POP, seed)
      const replies = await fakeBridge(fakeQueue()).run(new ArrayBuffer(0), plan.calls)
      expect(replies.filter((r) => r === 'full').length).toBeGreaterThanOrEqual(1)
      expect(plan.calls.filter((c) => c === 'pop').length).toBeGreaterThanOrEqual(3)
      // pops that return a value, not pop calls: a pop on the empty queue pops nothing (with empty pops counted, some
      // seeds kept a trace with one real pop before the last)
      expect(replies.filter((r) => /^\d+$/.test(r)).length, `seed ${seed}`).toBeGreaterThanOrEqual(3)
      expect(replies[replies.length - 1]).toMatch(/^\d+$/)
      const firstPushed = plan.calls[1].split(' ')[1]
      expect(replies[replies.length - 1]).not.toBe(firstPushed)
    }
  })

  test('popped counts the values pops returned: ok, full and empty replies pop nothing', () => {
    expect(popped(['ok', 'full', 'empty', '42', 'ok', 'empty', '17'])).toEqual(['42', '17'])
    expect(popped(['empty', 'empty', 'empty'])).toEqual([])
  })

  test('after-wrap: 6 pushes and 5 pops, no push refused and no pop empty, the fifth pop returns the fifth value pushed', async () => {
    for (const seed of SEEDS) {
      const plan = planQuestion(AFTER_WRAP, seed)
      const replies = await fakeBridge(fakeQueue()).run(new ArrayBuffer(0), plan.calls)
      expect(plan.calls.filter((c) => c.startsWith('push'))).toHaveLength(6)
      expect(plan.calls.filter((c) => c === 'pop')).toHaveLength(5)
      expect(replies).not.toContain('full')
      expect(replies).not.toContain('empty')
      const fifth = plan.calls.filter((c) => c.startsWith('push'))[4].split(' ')[1]
      expect(replies[replies.length - 1]).toBe(fifth)
      // by the last pop the head position is 4: it has gone once round the 4 slots, and the tail is past 4 as well
      expect(plan.calls.filter((c) => c === 'pop').length - 1).toBe(RING)
    }
  })

  test('after-wrap: a pop that takes the newest value answers something else on every seed', async () => {
    for (const seed of SEEDS) expect(await answerOn(AFTER_WRAP, seed, fakeQueue({ stack: true }))).not.toBe(await answerOn(AFTER_WRAP, seed, fakeQueue()))
    expect((await across(AFTER_WRAP, fakeQueue())).size).toBeGreaterThanOrEqual(40)
  })

  test('after-wrap: the stale-slot release the checks catch (a pop that frees at h + 1) fails the trace, as a module that failed backpressure would', async () => {
    // a ring with that mutant refuses the push after the first lap, so the queue cannot hold what the story says
    const mutant = (): Handler => {
      let ring: Ring | null = null
      return (cmd) => {
        const [op, arg] = cmd.split(' ')
        if (op === 'init') return ((ring = new Ring(Number(arg), 'no-recycle')), 'ok')
        if (op === 'push') return ring !== null && 'ok' in ring.push(Number(arg)) ? 'ok' : 'full'
        return String(ring?.pop() ?? 'empty')
      }
    }
    let differs = 0
    for (const seed of SEEDS) if ((await fakeBridge(mutant).run(new ArrayBuffer(0), planQuestion(AFTER_WRAP, seed).calls)).includes('full')) differs++
    expect(differs).toBe(SEEDS.length)
  })

  test('full-count reads your own new(): round-up, kept and round-down refuse a different number of pushes on every seed', async () => {
    const answers = await Promise.all(ROUNDINGS.map((rounding) => Promise.all(SEEDS.map((s) => answerOn(FULL_COUNT, s, fakeQueue({ rounding }))))))
    for (let k = 0; k < SEEDS.length; k++) {
      expect(new Set([answers[0][k], answers[1][k], answers[2][k]]).size, `seed ${SEEDS[k]}`).toBe(3)
    }
    for (const a of answers) expect(new Set(a).size).toBeGreaterThanOrEqual(5)
  })

  test('full-count: the answer counts the module’s own full replies, including a design none of the three rounds to', async () => {
    // a module that keeps capacity + 1 slots (an off-by-one new) is read as well: the answer is whatever it replies
    const plusOne = (): Handler => {
      const inner = fakeQueue({ rounding: 'exact' })()
      return (cmd) => (cmd.startsWith('init') ? inner(`init ${Number(cmd.split(' ')[1]) + 1}`) : inner(cmd))
    }
    let differs = 0
    for (const seed of SEEDS) if ((await answerOn(FULL_COUNT, seed, plusOne)) !== (await answerOn(FULL_COUNT, seed, fakeQueue({ rounding: 'exact' })))) differs++
    expect(differs).toBeGreaterThan(SEEDS.length / 2)
  })

  test('worked by hand: seed 1 of each template, its story and the answers', async () => {
    // Capacity 4. 76, 81, 65 and 88 fill it; 80 is refused (full). Pop 76. 14 fills it again; 67 is refused. Pop 81. 75 joins
    // [65, 88, 14]. The last pop returns 65. A queue that overwrote its oldest value would have dropped 76, then 65,
    // and answers 80; one that popped the newest answers 75.
    expect(planQuestion(LAST_POP, 1).calls).toEqual(['init 4', 'push 76', 'push 81', 'push 65', 'push 88', 'push 80', 'pop', 'push 14', 'push 67', 'pop', 'push 75', 'pop'])
    expect(planQuestion(LAST_POP, 1).story.slice(1)).toEqual(['Push 76.', 'Push 81.', 'Push 65.', 'Push 88.', 'Push 80.', 'Pop.', 'Push 14.', 'Push 67.', 'Pop.', 'Push 75.'])
    expect(await answerOn(LAST_POP, 1, fakeQueue())).toBe(65)
    expect(await answerOn(LAST_POP, 1, fakeQueue({ overwrite: true }))).toBe(80)
    expect(await answerOn(LAST_POP, 1, fakeQueue({ stack: true }))).toBe(75)
    // Capacity 3: 51, 63, 13 fill a queue that keeps 3. 72 is refused (1). Pop, 67 in, pop, 21 in, 73 refused (2): two.
    // Rounded up to 4, 72 is accepted and only 73 is refused: one. Rounded down to 2, 13 and 72 are refused, and 73 as well: three.
    expect(planQuestion(FULL_COUNT, 1).calls).toEqual(['init 3', 'push 51', 'push 63', 'push 13', 'push 72', 'pop', 'push 67', 'pop', 'push 21', 'push 73'])
    expect(await answerOn(FULL_COUNT, 1, fakeQueue({ rounding: 'exact' }))).toBe(2)
    expect(await answerOn(FULL_COUNT, 1, fakeQueue({ rounding: 'up' }))).toBe(1)
    expect(await answerOn(FULL_COUNT, 1, fakeQueue({ rounding: 'down' }))).toBe(3)
    // 76, 81, 65 pushed; pops take 76 and 81; 88 and 80 join [65]; pops take 65 and 88; 77 joins [80]; the fifth pop is 80,
    // the fifth value pushed (76, 81, 65, 88, 80). A stack answers 77.
    expect(planQuestion(AFTER_WRAP, 1).calls).toEqual(['init 4', 'push 76', 'push 81', 'push 65', 'pop', 'pop', 'push 88', 'push 80', 'pop', 'pop', 'push 77', 'pop'])
    expect(await answerOn(AFTER_WRAP, 1, fakeQueue())).toBe(80)
    expect(await answerOn(AFTER_WRAP, 1, fakeQueue({ stack: true }))).toBe(77)
  })
})

/* ------------------------------ through the core ------------------------------ */

describe('graded by the core against your module', () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 2]).buffer
  const hash = async () => 'ab'.repeat(32)

  test('the right answer on the module the unseen run graded is proved; the mistake’s answer is a miss that shows the module’s', async () => {
    for (const t of PROVE2.templates) {
      const seed = 31
      const plan = planQuestion(t, seed)
      const right = await answerOn(t, seed, fakeQueue())
      const wrong = await answerOn(t, seed, t === FULL_COUNT ? fakeQueue({ rounding: 'down' }) : fakeQueue({ stack: true }))
      expect(wrong).not.toBe(right)
      const go = (answer: number) =>
        proveFromModule({ labId: 'mpmc-queue', template: t, plan, answer, bytes, graded: { sha256: 'ab'.repeat(32), credit: 'unseen' }, history: [], now: 0, run: fakeBridge(fakeQueue()).run, hash })
      const hit = await go(right)
      const miss = await go(wrong)
      if (hit.kind !== 'graded' || miss.kind !== 'graded') throw new Error('refused')
      expect(hit.result).toMatchObject({ provenance: 'proved', score: 1, ok: true, seed, data: { v: 2, qid: t.id, answer: right, actual: right, calls: plan.calls.length } })
      expect(miss.result).toMatchObject({ provenance: 'practice', score: 0, ok: false, data: { answer: wrong, actual: right } })
    }
  })

  test('full-count credits the learner’s own rounding: the same answer is right for one module and a miss for another', async () => {
    const seed = 1
    const plan = planQuestion(FULL_COUNT, seed)
    const run = (rounding: Rounding) => fakeBridge(fakeQueue({ rounding })).run
    const go = (rounding: Rounding, answer: number) =>
      proveFromModule({ labId: 'mpmc-queue', template: FULL_COUNT, plan, answer, bytes, graded: { sha256: 'ab'.repeat(32), credit: 'unseen' }, history: [], now: 0, run: run(rounding), hash })
    const roundsUp = await go('up', 1)
    const keeps = await go('exact', 1)
    if (roundsUp.kind !== 'graded' || keeps.kind !== 'graded') throw new Error('refused')
    expect(roundsUp.result).toMatchObject({ provenance: 'proved', ok: true })
    expect(keeps.result).toMatchObject({ provenance: 'practice', ok: false, data: { actual: 2 } })
  })

  test('a module that replies anything but ok, full, empty or a value fails the trace instead of being read as an answer', () => {
    for (const t of PROVE2.templates) {
      const plan = planQuestion(t, 9)
      const replies = plan.calls.map(() => 'err not initialized')
      expect(gradeAnswer(t, 1, { kind: 'replied', replies })).toMatchObject({ right: false, actual: null, failed: 'error' })
    }
  })

  test('a module that pops empty where the trace has a value fails last-pop and after-wrap, and cannot make full-count read 0', () => {
    for (const t of [LAST_POP, AFTER_WRAP]) {
      const plan = planQuestion(t, 9)
      const replies = plan.calls.map((c) => (c === 'pop' ? 'empty' : 'ok'))
      expect(gradeAnswer(t, 1, { kind: 'replied', replies })).toMatchObject({ right: false, actual: null, failed: 'error' })
    }
    const plan = planQuestion(FULL_COUNT, 9)
    const replies = plan.calls.map((c) => (c === 'pop' ? '10' : 'ok'))
    expect(gradeAnswer(FULL_COUNT, 0, { kind: 'replied', replies })).toMatchObject({ right: true, actual: 0 })
  })
})
