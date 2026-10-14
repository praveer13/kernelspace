/**
 * Lab 06, batching-scheduler (docs/specs/wave-3.md §8.2, §7.2; task 3b-12): the bundle's stages, PRIMM items and
 * reference run on the Fleet's engine, the faded hint ladder (R0 to R2) for the six required checks, the six Prove-it
 * questions and the three Prove-it v2 templates.
 *
 * The v2 templates are held to the rule 3a-22 set (an answer read from your own code, never from the story alone, and
 * a plausible bug changes it) with a fake correct scheduler and a fake with each template's named bug. The fakes are
 * this file's own: line-protocol schedulers over the bridge's `schedule` verb (labs/batching-scheduler/src/lib.rs
 * `bridge`), checked against the app's reference scheduler (src/lib/fleet-model.ts `referenceScheduler`). The private
 * reference (labs/_solutions, gitignored) is not in the repo, so no test here can run it; it was run through the real
 * bridge by hand when `walk-past` landed, and answered every view as the fakes do.
 *
 * The multiple-choice items are held to the item-level blind-strategy gates of `verify:items` here (scripts/item-cues.ts,
 * the same code). Three items are fewer than the pool-level hit-rate bound can judge, so that bound is not asserted on
 * them: `verify:items -- --subset 'forge/batching-scheduler '` reports it, and the merged run decides.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { AskPacketView } from '../../src/components/forge/AskPacket'
import { HintLadderView } from '../../src/components/forge/HintLadder'
import { PrimmPanel } from '../../src/components/forge/PrimmPanel'
import ProveIt from '../../src/components/forge/ProveIt'
import { ReferenceRun } from '../../src/components/forge/ReferenceRun'
import { StagePanel } from '../../src/components/forge/StagePanel'
import { findForgeBundle, forgeBundleIds, loadForgeBundle } from '../../src/data/forge'
import bundle from '../../src/data/forge/batching-scheduler'
import { DISCUSSIONS_LABEL, LAB_ID, LADDER, LADDER_CHECK_IDS, hintRef, restoreState } from '../../src/data/forge/batching-scheduler/ladder'
import {
  LOAD,
  MEM_CAP,
  P1_ARITHMETIC,
  PRACTICE_SEED,
  PRIMM_ITEMS,
  PRIMM_MC_ITEMS,
  PRIMM_STEPS,
  REFERENCE,
  RUN_ITEM,
  RUN_SPEC,
  SCENE,
  STAGES,
  attemptsToGreen,
  currentStage,
  describeRun,
  gradeChoice,
  gradeNumber,
  greenStage,
  itemResponse,
  makeTrace,
  primmRef,
  runResponse,
  runTrace,
  stageRows,
  type NumberPrimm,
} from '../../src/data/forge/batching-scheduler/primm'
import { PROVE_LAB_ID, PROVE_QUESTIONS, buildProveResult, followUpRef, pickQuestions } from '../../src/data/forge/batching-scheduler/prove'
import { ADMIT_COUNT, ADMIT_ORDER, MARGIN, OLD_WAIT, PROVE2, ROOMY_CAP, WALK_PAST, WIDE_MARGIN } from '../../src/data/forge/batching-scheduler/prove2'
import type { ForgeBundle, ProveV2Template } from '../../src/data/forge/types'
import { KC } from '../../src/data/kc/ids'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { Engine, makeRefManager, referenceScheduler, type SchedView } from '../../src/lib/fleet-model'
import { hintRef as hintRefOf } from '../../src/lib/forge/ladder'
import { gradeAnswer, isProve2Answer, PROVE2_MAX_CALLS, planQuestion, proveFromModule, readAnswer } from '../../src/lib/forge/prove2'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { refMatchesKind } from '../../src/lib/ledger/refs'
import { compileSchedPolicy } from '../../src/lib/world/sched-policy'
import { extractHeadings } from '../../src/pages/lesson/markdown'
import { lintBundle } from '../../scripts/lint-mentor'
import { CUE_STRATEGIES, MAX_RANK_LESSON, PASS_BAR, oddOneOut, passProbability } from '../../scripts/item-cues'
import { validateEvent } from '../../src/lib/ledger/codec'
import { dayOf } from '../../src/lib/ledger/time'
import { splitmix32 } from '../../src/lib/rng'
import { fakeBridge, trap } from './fixtures'

const lab = FORGE_LABS.find((l) => l.id === 'batching-scheduler')
if (lab === undefined) throw new Error('lab 06 is missing from labs.ts')
const checks = lab.checks
const required = checks.filter((c) => c.optional !== true).map((c) => c.id)
const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const kcValues = new Set<string>(Object.values(KC))

describe('stages: labs.ts, scheduler.rs and the harness agree (§8.1, §8.2)', () => {
  test('stage 1 is runs_clean, stage 2 slo_light and burst, stage 3 convoy and starvation, stage 4 the goodput floors', () => {
    const byStage = (n: number) => checks.filter((c) => c.stage === n).map((c) => c.id)
    expect(byStage(1)).toEqual(['runs_clean'])
    expect(byStage(2).sort()).toEqual(['burst', 'slo_light'])
    expect(byStage(3).sort()).toEqual(['convoy', 'starvation'])
    expect(byStage(4).sort()).toEqual(['goodput_score', 'overload_seeded'])
    expect(checks.find((c) => c.id === 'overload_seeded')?.optional).toBe(true)
    expect(required).toHaveLength(6)
  })

  test('the bundle’s stages are the four a required check carries, each at most 25 minutes', () => {
    expect(bundle.stages.map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(bundle.stages).toEqual([...STAGES])
    for (const s of STAGES) expect(s.minutes).toBeLessThanOrEqual(25)
  })

  test('the harness lists the same stage for each check', () => {
    const lib = read('labs/batching-scheduler/src/lib.rs')
    for (const c of checks) {
      const m = new RegExp(`id: "${c.id}",[^}]*?stage: (\\d)`).exec(lib)
      expect(m?.[1]).toBe(String(c.stage))
    }
  })

  test('scheduler.rs marks each stage with its checks, and a required check is named by its own stage’s marker', () => {
    const src = read('labs/batching-scheduler/src/scheduler.rs')
    const named = new Map<number, Set<string>>()
    for (const m of src.matchAll(/^\s*\/\/ STAGE (\d) · ([a-z_, ]+?)\s*$/gm)) {
      const n = Number(m[1])
      named.set(n, new Set([...(named.get(n) ?? []), ...m[2].split(', ')]))
    }
    for (const stage of STAGES) {
      const expected = required.filter((id) => checks.find((c) => c.id === id)?.stage === stage.n)
      for (const id of expected) expect(named.get(stage.n)?.has(id), `STAGE ${stage.n} names ${id}`).toBe(true)
    }
  })

  test('stage 1 is the two-minute win (§8.2): the bundle and the code marker agree on the check', () => {
    const src = read('labs/batching-scheduler/src/scheduler.rs')
    expect(STAGES[0].minutes).toBe(2)
    expect(src).toMatch(/^\s*\/\/ STAGE 1 · runs_clean\s*$/m)
  })

  test('the signatures did not change (W19)', () => {
    const src = read('labs/batching-scheduler/src/scheduler.rs')
    expect(src).toContain('pub fn new() -> Self')
    expect(src).toContain('pub fn schedule(&mut self, state: &State) -> Action')
  })

  test('the page walks the PRIMM steps in order', () => {
    expect(PRIMM_STEPS.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
  })
})

describe('stage rows and attempts-to-green, over lab 06’s checks', () => {
  const ids = (...a: string[]) => new Set(a)

  test('nothing passed: stage 1 is next, nothing is green', () => {
    const rows = stageRows(checks, ids())
    expect(rows.every((r) => !r.green)).toBe(true)
    expect(currentStage(rows)?.n).toBe(1)
    expect(greenStage(rows)).toBe(0)
  })

  test('runs_clean alone turns stage 1 green: it is the single check of the first stage', () => {
    const rows = stageRows(checks, ids('runs_clean'))
    expect(rows.map((r) => r.green)).toEqual([true, false, false, false])
    expect(greenStage(rows)).toBe(1)
  })

  test('stage 2 needs both slo_light and burst; stage 3 both convoy and starvation', () => {
    expect(stageRows(checks, ids('runs_clean', 'slo_light')).map((r) => r.green)).toEqual([true, false, false, false])
    expect(stageRows(checks, ids('runs_clean', 'slo_light', 'burst')).map((r) => r.green)).toEqual([true, true, false, false])
    expect(stageRows(checks, ids('runs_clean', 'slo_light', 'burst', 'convoy')).map((r) => r.green)).toEqual([true, true, false, false])
  })

  test('the six required checks make four green stages; the optional seeded overload is not needed', () => {
    const rows = stageRows(checks, ids(...required))
    expect(rows.every((r) => r.green)).toBe(true)
    expect(currentStage(rows)).toBeNull()
    expect(greenStage(rows)).toBe(4)
    expect(rows[3].checks.map((c) => c.id)).toEqual(['goodput_score'])
  })

  test('attempts-to-green counts runs from the run after the previous stage went green', () => {
    const one = ['runs_clean']
    const two = [...one, 'slo_light', 'burst']
    const three = [...two, 'convoy', 'starvation']
    const four = [...three, 'goodput_score']
    // stage 2 comes green on the second run (slo_light alone is not the stage), stages 3 and 4 on the runs after
    expect(attemptsToGreen([one, ['runs_clean', 'slo_light'], two, three, four], checks)).toEqual([1, 2, 1, 1])
    // everything green at once: stage 1 took the run, the others took none after it
    expect(attemptsToGreen([four], checks)).toEqual([1, 0, 0, 0])
    expect(attemptsToGreen([one, two], checks)).toEqual([1, 1, null, null])
  })
})

describe('the reference run: the Fleet’s engine on a seeded trace of 60 requests', () => {
  const ref = runTrace(REFERENCE)

  test('it is deterministic in its config, and a different seed is a different run', () => {
    expect(runTrace(REFERENCE)).toEqual(ref)
    expect(runTrace({ ...REFERENCE, seed: PRACTICE_SEED + 1 })).not.toEqual(ref)
    expect(REFERENCE.seed).toBe(PRACTICE_SEED)
  })

  test('the trace is 60 requests in arrival order with the stated mix: prompts, outputs and arrivals in range', () => {
    for (const seed of [PRACTICE_SEED, 1, 2, 3, 99, 4_000_000_000]) {
      const t = makeTrace(seed)
      expect(t).toHaveLength(SCENE.requests)
      expect(new Set(t.map((r) => r.id)).size).toBe(SCENE.requests)
      for (let i = 1; i < t.length; i++) expect(t[i].arrival).toBeGreaterThanOrEqual(t[i - 1].arrival)
      for (const r of t) {
        expect(r.arrival).toBeGreaterThanOrEqual(0)
        expect(r.arrival).toBeLessThan(SCENE.span)
        expect(r.output).toBeGreaterThanOrEqual(SCENE.output.min)
        expect(r.output).toBeLessThanOrEqual(SCENE.output.max)
        const heavy = r.prompt >= SCENE.heavy.min
        expect(heavy ? r.prompt <= SCENE.heavy.max : r.prompt >= SCENE.light.min && r.prompt <= SCENE.light.max).toBe(true)
      }
    }
  })

  test('it has the shape of the lab’s probe: 60 requests over 300 iterations, 15 % heavy, 6 slots, a 40-iteration bound', () => {
    const lib = read('labs/batching-scheduler/src/lib.rs')
    const probe = lib.slice(lib.indexOf('pub fn probe('), lib.indexOf('/* ------------------------------ wasm ABI'))
    expect(probe).toContain('for i in 0..60u32')
    expect(probe).toContain('rng.below(100) < 15')
    expect(probe).toContain('rng.below(300)')
    expect(probe).toContain('768 + rng.below(1024)')
    expect(probe).toContain('64 + rng.below(320)')
    expect(probe).toContain('16 + rng.below(48)')
    expect(probe).toContain('max_running: 6')
    expect(probe).toContain('slo_ttft: 40')
    expect(SCENE.requests).toBe(60)
    expect(SCENE.span).toBe(300)
    expect(SCENE.heavyPct).toBe(15)
    expect(SCENE.heavy).toEqual({ min: 768, max: 768 + 1024 - 1 })
    expect(SCENE.light).toEqual({ min: 64, max: 64 + 320 - 1 })
    expect(SCENE.output).toEqual({ min: 16, max: 16 + 48 - 1 })
    expect(SCENE.maxRunning).toBe(6)
    expect(SCENE.sloTtft).toBe(40)
    // the pool is tighter than probe's 6,144 tokens, so that headroom shows; the page says so
    expect(MEM_CAP).toBe(2560)
    expect(RUN_SPEC.disclaimer).toContain('tighter pool')
  })

  test('the run is the engine’s own: the same numbers as a hand-driven Engine with referenceScheduler', () => {
    const e = new Engine(
      { numBlocks: SCENE.numBlocks, blockSize: SCENE.blockSize, maxRunning: SCENE.maxRunning, sloTtft: SCENE.sloTtft, prefillChunk: SCENE.prefillChunk },
      makeTrace(PRACTICE_SEED),
      { name: 'ref', schedule: referenceScheduler },
      makeRefManager(SCENE.numBlocks, SCENE.blockSize),
    )
    while (!e.done && e.tick < SCENE.maxTicks) e.step()
    const s = e.stats()
    expect(ref.met).toBe(s.sloMet)
    expect(ref.done).toBe(s.completed)
    expect(ref.forced).toBe(s.autoPreempts)
    expect(ref.ttftP95).toBe(e.ttftP95())
    expect(ref.total).toBe(e.tick)
  })

  test('the reference dials are the Compose dials’ reference: compiled {sjf, 2000, 48, none} gives the same run', () => {
    const e = new Engine(
      { numBlocks: SCENE.numBlocks, blockSize: SCENE.blockSize, maxRunning: SCENE.maxRunning, sloTtft: SCENE.sloTtft, prefillChunk: SCENE.prefillChunk },
      makeTrace(PRACTICE_SEED),
      compileSchedPolicy({ order: 'sjf', guard: 2000, headroom: 48, preempt: 'none' }, SCENE.blockSize),
      makeRefManager(SCENE.numBlocks, SCENE.blockSize),
    )
    while (!e.done && e.tick < SCENE.maxTicks) e.step()
    expect(e.stats().sloMet).toBe(ref.met)
  })

  test('the reference finishes the trace, evicts nothing and serves most of it in time but not all (the engine is overloaded)', () => {
    expect(ref.finished).toBe(true)
    expect(ref.done).toBe(SCENE.requests)
    expect(ref.forced).toBe(0)
    expect(ref.met).toBeGreaterThan(SCENE.requests / 2)
    expect(ref.met).toBeLessThan(SCENE.requests)
    expect(ref.ttftP95).toBeGreaterThan(SCENE.sloTtft)
  })

  test('samples start at iteration 0 with nobody arrived and end at the last iteration with every request finished', () => {
    expect(ref.samples[0].op).toBe(0)
    expect(ref.samples[0].cells.every((c) => c === 0)).toBe(true)
    const last = ref.samples[ref.samples.length - 1]
    expect(last.op).toBe(ref.total)
    expect(last.cells).toHaveLength(SCENE.requests)
    // finished in time is bright, finished late fades (12), and nothing else is left
    expect(last.cells.every((c) => c === 100 || c === 12)).toBe(true)
    expect(last.cells.filter((c) => c === 100).length).toBe(ref.met)
    expect(last.met).toBe(ref.met)
    expect(last.done).toBe(ref.done)
    for (let i = 1; i < ref.samples.length - 1; i++) expect(ref.samples[i].op - ref.samples[i - 1].op).toBe(SCENE.every)
  })

  test('each frame’s counts add up with its cells: waiting, running and finished are what the strip draws', () => {
    for (const s of ref.samples) {
      const waiting = s.cells.filter((c) => c === 25).length
      const running = s.cells.filter((c) => c === 60).length
      const finished = s.cells.filter((c) => c === 100 || c === 12).length
      expect(waiting).toBe(s.waiting)
      expect(running).toBe(s.running)
      expect(finished).toBe(s.done)
      expect(s.cells.filter((c) => c === 100).length).toBe(s.met)
    }
  })

  test('met is monotone over the run, and the run never runs more than the slots', () => {
    for (let i = 1; i < ref.samples.length; i++) {
      expect(ref.samples[i].met).toBeGreaterThanOrEqual(ref.samples[i - 1].met)
      expect(ref.samples[i].running).toBeLessThanOrEqual(SCENE.maxRunning)
    }
  })

  test('as a ReferenceRunSpec: more than one frame, value is the requests in time, truth is all of them', () => {
    const r = RUN_SPEC.run(RUN_SPEC.reference)
    expect(r.frames.length).toBeGreaterThan(1)
    expect(r.value).toBe(ref.met)
    expect(r.truth).toBe(SCENE.requests)
    expect(r.truth).toBeGreaterThanOrEqual(r.value)
    expect(r.clean).toBe(true)
    expect(r.total).toBe(ref.total)
    for (const f of r.frames) {
      expect(f.cells).toHaveLength(SCENE.requests)
      expect(f.stats.map((s) => s.label)).toEqual(['waiting', 'running', 'met the bound', 'evictions'])
      expect(f.alt).toContain(`${SCENE.requests} requests`)
    }
  })

  test('each Modify dial is a whole config on the same trace and pool, measured in evictions', () => {
    const dials = RUN_SPEC.modify?.dials ?? []
    expect(dials.map((d) => d.id)).toEqual(['headroom0', 'fcfs0'])
    for (const d of dials) {
      expect(d.config.seed).toBe(PRACTICE_SEED)
      expect(d.config.report).toBe('forced')
      expect(d.config.headroom).toBe(0)
      const r = RUN_SPEC.run(d.config)
      expect(r.value).toBeGreaterThan(0)
      expect(r.clean).toBe(true)
    }
    expect(dials[0].config.order).toBe('sjf')
    expect(dials[1].config.order).toBe('fcfs')
  })

  test('taking the headroom away makes the engine evict; the reference run evicts none', () => {
    const none = runTrace({ ...REFERENCE, headroom: 0 })
    expect(ref.forced).toBe(0)
    expect(none.forced).toBeGreaterThan(0)
    expect(none.finished).toBe(true)
    // and the goodput falls too: the evicted work is done twice
    expect(none.met).toBeLessThan(ref.met)
  })

  test('first come first served serves fewer in time than shortest-first on the same trace (the convoy, in small)', () => {
    expect(runTrace({ ...REFERENCE, order: 'fcfs' }).met).toBeLessThan(ref.met)
  })

  test('the caption says what the run is, in numbers', () => {
    const text = describeRun(ref)
    expect(text).toContain(`${ref.met} of ${SCENE.requests} met the ${SCENE.sloTtft}-iteration first-token bound`)
    expect(text).toContain('no sequence was evicted')
    expect(describeRun(runTrace({ ...REFERENCE, headroom: 0 }))).toContain('evicted for want of a block')
  })

  test('the reference run is not the lab’s harness, and says so in its disclaimer', () => {
    expect(RUN_SPEC.disclaimer).toContain('not the lab’s harness')
    expect(RUN_SPEC.title(RUN_SPEC.reference)).toContain('shortest prompt first')
  })

  test('the Run step writes one observation for the reference config: the requests in time, of the trace, no KCs', () => {
    const resp = runResponse(ref)
    expect(resp.ref).toBe(`item:${RUN_ITEM.id}`)
    expect(RUN_ITEM.id).toBe('lab06.primm.r1')
    expect(resp.data).toMatchObject({ src: 'practice', kcs: [], value: ref.met, truth: SCENE.requests })
  })
})

describe('items (§8.2): ids, refs, tags, whys', () => {
  const numeric = (id: string) => PRIMM_ITEMS.find((i) => i.id === id) as NumberPrimm

  test('2 predict (one estimate, one choice), 3 investigate and 1 modify', () => {
    const count = (step: string) => PRIMM_ITEMS.filter((i) => i.step === step).length
    expect(count('predict')).toBe(2)
    expect(count('investigate')).toBe(3)
    expect(count('modify')).toBe(1)
    expect(PRIMM_ITEMS).toHaveLength(6)
    const predict = PRIMM_ITEMS.filter((i) => i.step === 'predict')
    expect(predict.map((i) => i.kind).sort()).toEqual(['choice', 'estimate'])
    expect(PRIMM_ITEMS.filter((i) => i.step === 'modify').map((i) => i.kind)).toEqual(['estimate'])
  })

  test('ids are item:lab06.primm.* and unique', () => {
    expect(PRIMM_ITEMS.map((i) => i.id)).toEqual(['lab06.primm.p1', 'lab06.primm.p2', 'lab06.primm.i1', 'lab06.primm.i2', 'lab06.primm.i3', 'lab06.primm.m1'])
    for (const i of PRIMM_ITEMS) {
      expect(i.id.startsWith('lab06.primm.')).toBe(true)
      expect(primmRef(i.id)).toBe(`item:${i.id}`)
      expect(refMatchesKind('item', primmRef(i.id))).toBe(true)
    }
  })

  test('the Predict estimate is graded against the reference run, and the reference lies inside its window', () => {
    const p1 = numeric('lab06.primm.p1')
    expect(p1.kind).toBe('estimate')
    const truth = RUN_SPEC.run(RUN_SPEC.baseline ?? RUN_SPEC.reference).value
    expect(truth).toBe(runTrace(REFERENCE).met)
    expect(gradeNumber(p1, truth, truth).ok).toBe(true)
    expect(gradeNumber(p1, Math.ceil(truth / 1.4), truth).ok).toBe(true)
    expect(gradeNumber(p1, 5, truth).ok).toBe(false)
    expect(p1.prompt).toContain(`${SCENE.requests} requests`)
    expect(p1.prompt).toContain('2,560 tokens')
    expect(p1.explain).toContain(`${truth} of ${SCENE.requests}`)
  })

  test('the Predict explanation says what binds, with arithmetic that holds: the pool before the slots, both under the offered load', () => {
    const p1 = numeric('lab06.primm.p1')
    // the scene's means, worked by hand: 85 % light (64 to 383) and 15 % heavy (768 to 1,791) prompts, 16 to 63 tokens out
    expect(LOAD.prompt).toBeCloseTo(0.85 * 223.5 + 0.15 * 1279.5, 6)
    expect(LOAD.output).toBe(39.5)
    // prefill chunks: light 64-128 take 1 (65 prompts), 129-256 take 2 (128), 257-383 take 3 (127); heavy 768 takes 6,
    // then 128 each of 7 to 13 and 127 of 14 (1,665 to 1,791)
    const light = (65 * 1 + 128 * 2 + 127 * 3) / 320
    const heavy = (6 + 128 * (7 + 8 + 9 + 10 + 11 + 12 + 13) + 127 * 14) / 1024
    expect(LOAD.prefill).toBeCloseTo(0.85 * light + 0.15 * heavy, 9)
    expect(LOAD.life).toBeCloseTo(LOAD.prefill + 39.5 - 1, 9)
    // the token-iterations, summed by brute force over every prompt and output the scene draws
    let sum = 0
    for (let p = 64; p <= 383; p++) for (let o = 16; o <= 63; o++) sum += (0.85 / 320 / 48) * ((p + 48) * (Math.ceil(p / 128) + o - 1) + ((o - 1) * o) / 2)
    for (let p = 768; p <= 1791; p++) for (let o = 16; o <= 63; o++) sum += (0.15 / 1024 / 48) * ((p + 48) * (Math.ceil(p / 128) + o - 1) + ((o - 1) * o) / 2)
    expect(LOAD.tokenIters).toBeCloseTo(sum, 6)
    expect(P1_ARITHMETIC).toEqual({ offered: 0.2, life: 42, slotRate: 0.14, tokenIters: 20_000, poolRate: 0.13 })
    // the printed arithmetic holds at the precision printed, and the unrounded limits are in the same order
    expect((6 / 42).toFixed(2)).toBe('0.14')
    expect((2560 / 20_000).toFixed(2)).toBe('0.13')
    expect(MEM_CAP / LOAD.tokenIters).toBeLessThan(SCENE.maxRunning / LOAD.life)
    expect(SCENE.maxRunning / LOAD.life).toBeLessThan(SCENE.requests / SCENE.span)
    expect(p1.explain).toContain('6 / 42 = 0.14 requests an iteration')
    expect(p1.explain).toContain('2,560 / 20,000 = 0.13 an iteration')
    expect(p1.explain).toContain('3.4 iterations on average')
    expect(p1.explain).toContain('382 tokens on average')
    expect(p1.explain).not.toContain('0.15')
    // two prompts over half the pool never fit together; the run takes 806 iterations
    expect(2 * (MEM_CAP / 2 + 1)).toBeGreaterThan(MEM_CAP)
    const ref = runTrace(REFERENCE)
    expect(ref.total).toBe(806)
    expect(p1.explain).toContain(`two prompts over 1,280 tokens never fit in it together, and this run takes 806 iterations to finish all 60`)
    // and some wait past the bound whatever the order: first come first served, at every headroom the dials offer, misses too
    for (const order of ['sjf', 'fcfs'] as const) for (const headroom of [0, 16, 48] as const) expect(runTrace({ ...REFERENCE, order, headroom }).met).toBeLessThan(SCENE.requests)
  })

  test('the Predict choice: pure smallest-first fails starvation first, and the table it cites is the README’s', () => {
    const p2 = PRIMM_ITEMS.find((i) => i.id === 'lab06.primm.p2')
    if (p2?.kind !== 'choice') throw new Error('p2 is a choice')
    expect(p2.item.q.options[p2.item.q.correct[0]]).toContain('`starvation` in stage 3')
    const readme = read('labs/README.md')
    // the stem's design keeps 48 tokens of headroom and has no aging: the `sjf` mutant, whose scores equal the README's
    // reference column (62.5, 90.6, 76.7; measured with the mutant in the crate), not the no-headroom 'pure SJF' column (91.5 on BurstGPT)
    const row = (name: string) => readme.split('\n').find((l) => l.includes(name))?.split('|').map((c) => c.trim()) ?? []
    const cited = ['62.5 %', '90.6 %', '76.7 %']
    const [syn, burst, lmsys] = [row('synthetic fleet overload'), row('BurstGPT v2 busiest-hour'), row('LMSYS published-aggregate')]
    expect(burst[4]).toBe('91.5%')
    expect([syn[5], burst[5], lmsys[5]]).toEqual(['62.5%', '90.6%', '76.7%'])
    expect([syn[6], burst[6], lmsys[6]]).toEqual(['55.0%', '85.0%', '70.0%'])
    const why = p2.item.q.why[3]
    for (const n of cited) expect(why).toContain(n)
    expect(why).not.toContain('91.5')
    const calibration = JSON.parse(read('labs/batching-scheduler/calibration.json')) as { mutants: Record<string, { caughtBy: string[] }> }
    expect(calibration.mutants.sjf.caughtBy).toEqual(['starvation'])
    // the stage of each check named in the options is the stage labs.ts gives it
    const stageOf = (id: string) => checks.find((c) => c.id === id)?.stage
    expect(stageOf('burst')).toBe(2)
    expect(stageOf('convoy')).toBe(3)
    expect(stageOf('starvation')).toBe(3)
    expect(stageOf('goodput_score')).toBe(4)
  })

  test('the pure smallest-first design the Predict choice describes is the one the calibration table names, and fcfs fails convoy', () => {
    const calibration = JSON.parse(read('labs/batching-scheduler/calibration.json')) as { mutants: Record<string, { caughtBy: string[] }> }
    expect(calibration.mutants.fcfs.caughtBy).toEqual(['convoy', 'goodput_score'])
    expect(calibration.mutants.huge_headroom.caughtBy).toContain('burst')
  })

  test('the convoy numeric is the lab’s own scenario: 8,192 + 88 x 128 in 12,288 tokens, and 32 shorts fit beside the whale', () => {
    const lib = read('labs/batching-scheduler/src/lib.rs')
    const convoy = lib.slice(lib.indexOf('pub fn scn_convoy()'), lib.indexOf('fn starvation_from'))
    expect(convoy).toContain('prompt: 8192')
    expect(convoy).toContain('prompt: 128')
    expect(convoy).toContain('for i in 1..=88u32')
    expect(convoy).toContain('mem_cap: 12288')
    expect(convoy).toContain('slo_ttft: 40')
    const i1 = numeric('lab06.primm.i1')
    expect(i1.kind).toBe('numeric')
    expect(i1.truth).toBe(Math.floor((12288 - 8192) / 128))
    expect(i1.truth).toBe(32)
    // all the shorts fit alone, the whale and all of them do not, and the whale's prefill outlasts the bound
    expect(88 * 128).toBeLessThanOrEqual(12288)
    expect(8192 + 88 * 128).toBeGreaterThan(12288)
    expect(Math.ceil(8192 / SCENE.prefillChunk)).toBe(64)
    expect(64).toBeGreaterThan(SCENE.sloTtft)
    expect(i1.explain).toContain('64 iterations')
  })

  test('no lure of the numeric item is its answer, and each names its mistake', () => {
    const i1 = numeric('lab06.primm.i1')
    expect(i1.lures).toHaveLength(3)
    for (const l of i1.lures ?? []) {
      expect(l.value).not.toBe(i1.truth)
      expect(gradeNumber(i1, l.value, i1.truth ?? NaN)).toMatchObject({ ok: false, miss: l.miss })
    }
    expect(gradeNumber(i1, 32, 32).ok).toBe(true)
    // the arithmetic behind each lure
    expect((i1.lures ?? []).map((l) => l.value).sort((a, b) => a - b)).toEqual([64, 88, 96])
    expect(12288 / 128).toBe(96)
  })

  test('the headroom item cites the engine’s forced preemption of the newest sequence, as lib.rs’s simulator does', () => {
    const lib = read('labs/batching-scheduler/src/lib.rs')
    expect(lib).toContain('force-preempts the NEWEST running seq')
    expect(lib).toContain('Illegal only if THE ACTION pushes resident past the cap')
    const scheduler = read('labs/batching-scheduler/src/scheduler.rs')
    expect(scheduler).toMatch(/catches too little headroom \(even none\)/)
    expect(scheduler).toContain('Leave ~48 tokens of headroom')
  })

  test('the Modify item is one estimate of evictions, and its prompt quotes the reference run’s own count', () => {
    const m1 = numeric('lab06.primm.m1')
    expect(m1.kind).toBe('estimate')
    expect(m1.unit).toBe('evictions')
    expect(m1.prompt).toContain(`ends with ${runTrace(REFERENCE).forced} sequences evicted`)
    // graded against the dial's run: 0 is never right for a run that evicts
    const dial = RUN_SPEC.modify?.dials[0]
    const truth = RUN_SPEC.run(dial?.config ?? REFERENCE).value
    expect(truth).toBeGreaterThan(0)
    expect(gradeNumber(m1, truth, truth).ok).toBe(true)
    expect(gradeNumber(m1, 0, truth).ok).toBe(false)
    expect(gradeNumber(m1, 0, truth).feedback).toContain('cannot be right')
  })

  test('every item is tagged with known KCs of the lab’s checks and a nominal time', () => {
    const labKcs = new Set(checks.flatMap((c) => c.kcs ?? []))
    for (const i of PRIMM_ITEMS) {
      const kcs = i.kind === 'choice' ? i.item.kcs : i.kcs
      expect(kcs.length).toBeGreaterThan(0)
      for (const k of kcs) {
        expect(kcValues.has(k)).toBe(true)
        expect(labKcs.has(k), `${i.id}: ${k}`).toBe(true)
      }
      expect(i.nsec).toBeGreaterThan(0)
    }
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
      expect(q.explanation?.trim().length).toBeGreaterThan(20)
      expect(id.startsWith('lab06.primm.')).toBe(true)
    }
  })

  test('PRIMM_MC_ITEMS is exactly the bundle’s choice items, the pool verify-items reads', () => {
    expect(PRIMM_MC_ITEMS).toEqual(bundle.primm.items.flatMap((i) => (i.kind === 'choice' ? [i.item] : [])))
  })

  test('the answer keys are not all in one position', () => {
    const keys = PRIMM_MC_ITEMS.map((i) => i.q.correct[0])
    expect(new Set(keys).size).toBeGreaterThan(1)
  })
})

describe('grading', () => {
  test('a choice: the key passes and each other option fails with its own why first', () => {
    for (const item of PRIMM_ITEMS) {
      if (item.kind !== 'choice') continue
      const { q } = item.item
      const key = q.correct[0]
      expect(gradeChoice(item, key)).toMatchObject({ ok: true, score: 1 })
      q.options.forEach((_, n) => {
        if (n === key) return
        const g = gradeChoice(item, n)
        expect(g.ok).toBe(false)
        expect(g.feedback.startsWith(q.why?.[n] ?? '')).toBe(true)
        expect(g.feedback).toContain(q.why?.[key] ?? '')
      })
    }
  })

  test('an answer is one practice item event, tagged with the item’s KCs', () => {
    const p2 = PRIMM_ITEMS[1]
    if (p2.kind !== 'choice') throw new Error('p2 is a choice')
    const r = itemResponse({ item: p2, grade: gradeChoice(p2, p2.item.q.correct[0]), pick: p2.item.q.correct[0], ms: 5000 })
    expect(r.kind).toBe('item')
    expect(r.ref).toBe('item:lab06.primm.p2')
    expect(r.provenance).toBe('practice')
    expect(r.data).toMatchObject({ src: 'practice', kcs: p2.item.kcs, pick: [p2.item.q.correct[0]] })
  })
})

/**
 * What verify-items holds a choice item to at the item level, run here on the lab’s three: the key is never strictly
 * the longest option, no key/distractor length ratio above 1.3, and no binary feature isolates the key. The pool-level
 * bounds (a strategy’s hit rate over the whole PRIMM pool) are the merged run’s: three items cannot be judged alone.
 */
describe('multiple-choice items clear the item-level gates of verify-items', () => {
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

  test('no binary feature (a reason connective, a colon, a digit, an absolute, an enumeration ...) isolates the key', () => {
    for (const { ref, q } of items) expect(oddOneOut(q), ref).toEqual([])
  })

  test('no blind strategy passes the lab’s items as a lesson at the pass bar', () => {
    for (const s of CUE_STRATEGIES) {
      expect(passProbability(items.map((i) => s.pick(i.q))), s.name).toBeLessThan(MAX_RANK_LESSON)
    }
    expect(PASS_BAR).toBe(0.8)
  })
})

describe('the hint ladder (§8.2): R0 to R2 for the six required checks, then the packet', () => {
  const h2s = new Map<string, Set<string>>()
  for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))
  const libRs = read('labs/batching-scheduler/src/lib.rs')

  test('the bundle is faded: fade r2, no walkthrough', () => {
    expect(bundle.fade).toBe('r2')
    expect(bundle.walkthrough).toBeUndefined()
  })

  test('it covers the six required checks in the order the module lists them, and not the optional one', () => {
    expect([...LADDER_CHECK_IDS]).toEqual(required)
    expect(bundle.ladder.map((c) => c.checkId)).toEqual(required)
    expect(Object.keys(LADDER).sort()).toEqual([...required].sort())
    expect(required).toEqual(['runs_clean', 'slo_light', 'burst', 'convoy', 'starvation', 'goodput_score'])
  })

  test('every rung is R0, R1 and R2 and nothing else: no R3, no R4', () => {
    for (const c of bundle.ladder) {
      expect(Object.keys(c).sort()).toEqual(['checkId', 'r0', 'r1', 'r2'])
      expect(c.r0.ideas).toHaveLength(3)
    }
  })

  test('verify:mentor’s lint finds nothing: limits, real H2 anchors, real check functions', () => {
    expect(lintBundle(bundle, { required, libRs, h2s })).toEqual([])
  })

  test('R2 names the check’s function in lib.rs, and the file that holds the answer', () => {
    for (const c of bundle.ladder) {
      expect(c.r2.fn).toBe(`check_${c.checkId}`)
      expect(c.r2.text).toContain('lib.rs')
      expect(libRs).toContain(`pub fn ${c.r2.fn}(`)
    }
  })

  test('R1 links an H2 that exists, in a lesson of the lab’s track or the OS lesson the idea comes from', () => {
    for (const c of bundle.ladder) {
      expect(['t5.l7', 't5.l3', 't2.l4']).toContain(c.r1.link.lessonId)
      expect(h2s.get(c.r1.link.lessonId)?.has(c.r1.link.anchor), `${c.checkId}: #${c.r1.link.anchor}`).toBe(true)
    }
  })

  test('the numbers in R0 are the harness’s: scenario sizes, bounds and thresholds', () => {
    const text = (id: string) => [LADDER[id].r0.prompt, ...LADDER[id].r0.ideas].join(' ')
    // runs_clean and slo_light: 20 light requests over 200 iterations, 8 slots, 8,192 tokens, a 40-iteration bound, 95 % of 20 is 19
    expect(libRsHas('for i in 0..20u32')).toBe(true)
    expect(libRsHas('arrival: below(200)')).toBe(true)
    expect(libRsHas('max_running: 8,\n        mem_cap: 8192,\n        slo_ttft: 40')).toBe(true)
    expect(text('runs_clean')).toContain('20 light requests')
    expect(text('slo_light')).toContain('40 iterations')
    expect(Math.ceil(0.95 * 20)).toBe(19)
    expect(text('slo_light')).toContain('19 of the 20')
    // burst: 48 requests in 6 iterations, 24 slots, 8,192 tokens, a 90-iteration bound, 90 % of 48 needs 44
    expect(libRsHas('for i in 0..48u32')).toBe(true)
    expect(libRsHas('arrival: rng.below(6)')).toBe(true)
    expect(libRsHas('max_running: 24,\n        mem_cap: 8192,\n        slo_ttft: 90')).toBe(true)
    expect(Math.ceil(0.9 * 48)).toBe(44)
    expect(43 / 48).toBeLessThan(0.9)
    expect(text('burst')).toContain('44 of 48')
    // convoy: 85 of 89 and the whale finished
    expect(libRsHas('s.slo_met < 85')).toBe(true)
    expect(text('convoy')).toContain('85 of the 89')
    // starvation: three 1,024-token longs, 5 slots, shorts arriving through iteration 1,999, at least 100 finished
    expect(libRsHas('for i in 0..3u32')).toBe(true)
    expect(libRsHas('prompt: 1024')).toBe(true)
    expect(libRsHas('arrival: if i < 40 { i % 3 } else { below(2000) }')).toBe(true)
    expect(libRsHas('s.completed < 100')).toBe(true)
    expect(text('starvation')).toContain('at least 100 requests')
    // goodput_score: the three traces and their floors
    expect(libRsHas('SYNTHETIC_GOODPUT_FLOOR: f64 = 0.55')).toBe(true)
    expect(libRsHas('BURSTGPT_GOODPUT_FLOOR: f64 = 0.85')).toBe(true)
    expect(libRsHas('LMSYS_SHAPE_GOODPUT_FLOOR: f64 = 0.70')).toBe(true)
    expect(text('goodput_score')).toContain('55, 85 and 70 percent')
    const traces = read('labs/batching-scheduler/src/trace_scenarios.rs')
    const rows = (name: string) => {
      const a = traces.indexOf(name)
      return (traces.slice(a, traces.indexOf('];', a)).match(/\(\s*\d+,\s*\d+,\s*\d+\s*\)/g) ?? []).length
    }
    expect(rows('BURSTGPT_REQUESTS')).toBe(480)
    expect(rows('LMSYS_SHAPE_REQUESTS')).toBe(360)
    expect(text('goodput_score')).toContain('400-request')
    expect(text('goodput_score')).toContain('480 BurstGPT')
    expect(text('goodput_score')).toContain('360-request')
    function libRsHas(s: string): boolean {
      return libRs.includes(s)
    }
  })

  test('each rung is about this lab: no block-manager or allocator wording leaks in, and no private file is named', () => {
    for (const c of bundle.ladder) {
      const all = [c.r0.prompt, ...c.r0.ideas, c.r1.text, c.r2.text].join(' ')
      expect(all).not.toMatch(/allocator\.rs|first-fit|coalesc|refcount|manager\.rs/i)
      expect(all).not.toContain('_solutions')
      expect(all).not.toMatch(/\bfn \w+\(|;\s*$/m)
    }
  })

  test('acks live under hint:batching-scheduler/, and a rung acked there comes back open', () => {
    expect(hintRef('convoy', 'R2')).toBe('hint:batching-scheduler/convoy#R2')
    expect(hintRef('convoy', 'R2')).toBe(hintRefOf('convoy', 'R2', LAB_ID))
    const state = restoreState({ [hintRef('burst', 'R0')]: '2026-10-13T00:00:00.000Z' }, 'burst', { red: 1, now: Date.parse('2026-10-13T00:01:00.000Z') })
    expect(state.opened.R0).toBeDefined()
    expect(state.opened.R1).toBeUndefined()
  })

  const row = (id: string): CheckResult => ({ id, label: id, status: 'fail', msg: `${id} says no` })
  const report = (): LabRunReport => ({ lab: LAB_ID, reference: false, abi: 2, version: 3, checks: required.map(row), seeds: 'fresh', ms: 5 })
  const html = (b: ForgeBundle, acks: Record<string, string>) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HintLadderView, { bundle: b, reports: [report()], acks, onAck: () => {}, now: () => 0 })))

  test('the panel draws a card for each of the six red checks, offers R1 and R2, and stops there: no R3, R4 or bottom-out', () => {
    const acks = { [hintRef('convoy', 'R0')]: '2026-10-13T00:00:00.000Z' }
    const out = html(bundle, acks)
    for (const id of required) expect(out).toContain(`data-check="${id}"`)
    expect(out).toContain('Open R1')
    expect(out).toContain('Open R2')
    for (const gone of ['R3', 'R4', 'Open R3', 'Open R4', 'Bottom-out', 'Show the walkthrough', 'Pseudo-code']) expect(out).not.toContain(gone)
    const href = /href="(https:\/\/github\.com\/[^"]*discussions\/new[^"]*)"/.exec(out)?.[1]
    expect(new URL((href ?? '').replace(/&amp;/g, '&')).searchParams.get('title')).toMatch(/^\[lab 06\] /)
  })

  test('with R0 to R2 open the card ends at R2 and says nothing of a rung it lacks', () => {
    const open = Object.fromEntries((['R0', 'R1', 'R2'] as const).map((r) => [hintRef('starvation', r), '2026-10-13T00:00:00.000Z']))
    const out = html(bundle, open)
    expect(out).toContain(LADDER.starvation.r2.text)
    expect(out).not.toMatch(/Open R\d/)
  })

  test('the packet follows R2: offered after R2 and not before', () => {
    const packet = (acks: Record<string, string>) =>
      renderToStaticMarkup(createElement(AskPacketView, { lab, reports: [report()], ladderIds: bundle.ladder.map((x) => x.checkId), acks, expSeed: undefined }))
    const stamp = '2026-10-13T00:00:00.000Z'
    const row = (out: string, id: string) => new RegExp(`<li[^>]*data-packet-check="${id}".*?</li>`, 's').exec(out)?.[0] ?? ''
    const before = packet({ [hintRef('convoy', 'R0')]: stamp, [hintRef('convoy', 'R1')]: stamp })
    expect(row(before, 'convoy')).toContain('The packet opens after R2 of the hints for this check.')
    expect(row(before, 'convoy')).not.toContain('packet:lab/')
    const after = packet({ [hintRef('convoy', 'R0')]: stamp, [hintRef('convoy', 'R1')]: stamp, [hintRef('convoy', 'R2')]: stamp })
    expect(row(after, 'convoy')).not.toContain('The packet opens after R2')
    expect(row(after, 'convoy')).toContain('packet:lab/batching-scheduler/convoy')
    // another check's packet is still closed: the gate is per check
    expect(row(after, 'burst')).toContain('The packet opens after R2')
  })

  test('lab 06 stays outside the ladder-or-packet experiment (labs 01 to 03)', () => {
    const src = read('src/lib/learner/experiments.ts')
    const m = /RANDOMIZED_LABS[^=]*=\s*\[([^\]]*)\]/.exec(src)
    expect(m).not.toBeNull()
    expect(m?.[1]).not.toContain('batching-scheduler')
  })
})

describe('Prove-it v1 (§8.2): six questions, three drawn', () => {
  test('six questions with distinct ids, three checkable ideas each and known KCs', () => {
    expect(PROVE_QUESTIONS).toHaveLength(6)
    expect(new Set(PROVE_QUESTIONS.map((q) => q.id)).size).toBe(6)
    for (const q of PROVE_QUESTIONS) {
      expect(q.ideas).toHaveLength(3)
      expect(q.prompt.trim().length).toBeGreaterThan(20)
      expect(q.model.trim().length).toBeGreaterThan(100)
      expect(q.kcs.length).toBeGreaterThan(0)
      for (const k of q.kcs) expect(kcValues.has(k)).toBe(true)
    }
  })

  test('the pool is about this lab’s code, not another’s', () => {
    for (const q of PROVE_QUESTIONS) {
      expect([q.prompt, q.model, ...q.ideas].join(' ')).not.toMatch(/allocator|refcount|manager\.rs|tokenizer/i)
    }
  })

  test('the draw is three distinct questions of this pool, and a retry takes the ones not yet served', () => {
    const first = pickQuestions([], 11)
    expect(first).toHaveLength(3)
    expect(new Set(first.map((q) => q.id)).size).toBe(3)
    const second = pickQuestions([{ at: '2026-10-13T00:00:00.000Z', qids: first.map((q) => q.id), score: 1 }], 11)
    expect(second.every((q) => !first.some((f) => f.id === q.id))).toBe(true)
  })

  test('the follow-up ref and the ledger payload carry lab 06’s id', () => {
    expect(PROVE_LAB_ID).toBe('batching-scheduler')
    expect(followUpRef('aging')).toBe('item:lab06.prove.aging')
    expect(refMatchesKind('item', followUpRef('aging'))).toBe(true)
    const qs = pickQuestions([], 5)
    const result = buildProveResult(
      qs,
      qs.map(() => ({ answer: 'word '.repeat(20), revealed: true, self: 1 as const })),
    )
    expect(result?.labId).toBe('batching-scheduler')
    expect(result?.data.qids).toEqual(qs.map((q) => q.id))
  })

  test('the panel draws its questions from the bundle', () => {
    const html = renderToString(createElement(ProveIt, { bundle, history: [], now: 0, seed: 3 })).replaceAll('<!-- -->', '')
    expect(html).toContain('data-prove="active"')
    const shown = [...html.matchAll(/data-qid="([a-z-]+)"/g)].map((m) => m[1])
    expect(shown).toHaveLength(1)
    expect(PROVE_QUESTIONS.map((q) => q.id)).toContain(shown[0])
  })
})

describe('the bundle', () => {
  test('the registry finds it by directory name and loads the same object', async () => {
    expect(await forgeBundleIds()).toContain('batching-scheduler')
    expect(await loadForgeBundle('batching-scheduler')).toBe(bundle)
    expect(await findForgeBundle('batching-scheduler')).toBe(bundle)
  })

  test('it is lab 06, labelled "[lab 06]", with the faded ladder, six v1 questions and three v2 templates', () => {
    expect(bundle.labId).toBe(LAB_ID)
    expect(bundle.labId).toBe('batching-scheduler')
    expect(bundle.discussionsLabel).toBe(DISCUSSIONS_LABEL)
    expect(bundle.discussionsLabel).toBe('[lab 06]')
    expect(bundle.prove).toHaveLength(6)
    expect(bundle.prove2).toBe(PROVE2)
    expect(bundle.prove2?.templates.map((t) => t.id)).toEqual(['admit-order', 'admit-count', 'walk-past'])
  })

  test('the generic panels render it: PRIMM steps, the reference strip, the stage list', () => {
    const predict = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks, passed: new Set<string>(), initial: 'predict', title: lab.title }))
    expect(predict).toContain(`aria-label="${lab.title}, in five steps"`)
    expect(predict).toContain('data-item="lab06.primm.p1"')
    expect(predict).toContain('data-item="lab06.primm.p2"')
    const modify = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks, passed: new Set<string>(), initial: 'modify' }))
    expect(modify).toContain('headroom 48 becomes 0')
    const strip = renderToStaticMarkup(createElement(ReferenceRun, { bundle, config: RUN_SPEC.reference }))
    expect(strip).toContain('data-reference-run="batching-scheduler"')
    expect(strip).toContain('role="img"')
    const stages = renderToStaticMarkup(createElement(StagePanel, { bundle, checks, passed: new Set<string>() }))
    expect(stages).toContain('Legal moves')
    expect(stages).toContain('Goodput')
  })
})

/* ---------------------------------------------------------------------------------------------------------------- */
/* Prove-it v2 (§7.2)                                                                                                */
/* ---------------------------------------------------------------------------------------------------------------- */

/* ------------------------------ fake schedulers ------------------------------ */

interface Req {
  id: number
  arrival: number
  prompt: number
}
interface Run extends Req {
  decoded: number
  prefillLeft: number
}
interface Parsed {
  iter: number
  maxRunning: number
  memCap: number
  memUsed: number
  waiting: Req[]
  running: Run[]
}

/** The bridge's parse (lib.rs `bridge`): a five-field header, then W (4 fields) and R (6 fields) entries on any line, split by ';'. */
function parseSchedule(cmd: string): Parsed {
  const lines = cmd.split('\n')
  const head = lines[0].trim().split(/\s+/)
  if (head[0] !== 'schedule' || head.length !== 5) throw new Error(`bad header '${lines[0]}'`)
  const [iter, maxRunning, memCap, memUsed] = head.slice(1).map(Number)
  const waiting: Req[] = []
  const running: Run[] = []
  for (const line of lines.slice(1)) {
    for (const entry of line.split(';')) {
      const f = entry.trim().split(/\s+/)
      if (f[0] === 'W' && f.length === 4) waiting.push({ id: Number(f[1]), arrival: Number(f[2]), prompt: Number(f[3]) })
      if (f[0] === 'R' && f.length === 6) running.push({ id: Number(f[1]), arrival: Number(f[2]), prompt: Number(f[3]), decoded: Number(f[4]), prefillLeft: Number(f[5]) })
    }
  }
  return { iter, maxRunning, memCap, memUsed, waiting, running }
}

/**
 * How a scheduler keeps its margin for decode growth, at `h` tokens (the lab suggests about 48):
 *   js       every running request and every admitted one pays h, the candidate too (fleet-model.ts `referenceScheduler`);
 *   rust     h per request running or already admitted, not the candidate (the private reference solution);
 *   running  h per request that was running when the call began;
 *   none     no margin at all (h is ignored).
 */
type Margin = 'js' | 'rust' | 'running' | 'none'

interface Opts {
  /** Walk order. `sjf` smallest prompt first, `fcfs` arrival order, `largest` the reverse of sjf. */
  order?: 'sjf' | 'fcfs' | 'largest'
  /** Ties between equal prompts: by arrival or by id. */
  tie?: 'arrival' | 'id'
  /** Requests older than this go first, oldest first (iterations). */
  age?: number
  margin?: Margin
  h?: number
  /** The uncaught design: stop at the first request that does not fit. */
  stopAtFirst?: boolean
}

function decide(p: Parsed, o: Opts): { admit: number[]; preempt: number[] } {
  const h = o.h ?? MARGIN
  const margin = o.margin ?? 'js'
  const order = o.order ?? 'sjf'
  const held = p.running.reduce((a, r) => a + r.prompt + r.decoded, 0)
  const age = o.age ?? 1600
  const aged = (r: Req) => p.iter - r.arrival > age
  const key = (r: Req) => (o.tie === 'id' ? r.id : r.arrival)
  const sorted = [...p.waiting].sort((a, b) => {
    if (aged(a) !== aged(b)) return aged(a) ? -1 : 1
    if (aged(a)) return a.arrival - b.arrival
    if (order === 'fcfs') return a.arrival - b.arrival
    if (order === 'largest') return b.prompt - a.prompt || key(a) - key(b)
    return a.prompt - b.prompt || key(a) - key(b)
  })
  const nRun = p.running.length
  let used = held + (margin === 'js' ? h * nRun : 0)
  let count = nRun
  const admit: number[] = []
  for (const r of sorted) {
    if (count >= p.maxRunning) break
    const reserve = margin === 'js' ? h : margin === 'rust' ? h * count : margin === 'running' ? h * nRun : 0
    const cost = r.prompt + (margin === 'js' ? h : 0)
    if (used + cost + (margin === 'js' ? 0 : reserve) > p.memCap) {
      if (o.stopAtFirst) break
      continue
    }
    admit.push(r.id)
    used += cost
    count += 1
  }
  return { admit, preempt: [] }
}

type Handler = (cmd: string) => string

/** A line-protocol scheduler over the bridge's verbs: `init` resets, `schedule` answers `admit …` and `preempt …` as the bridge does. */
function fakeScheduler(o: Opts = {}): () => Handler {
  return () => {
    let ready = false
    return (cmd) => {
      const verb = cmd.trim().split(/\s+/)[0]
      if (verb === 'init') {
        ready = true
        return 'ok'
      }
      if (verb !== 'schedule') return 'err unknown command'
      if (!ready) return 'err not initialized'
      const { admit, preempt } = decide(parseSchedule(cmd), o)
      return `admit ${admit.join(',')}\npreempt ${preempt.join(',')}`
    }
  }
}

const answerOn = async (t: ProveV2Template, seed: number, module: () => Handler): Promise<number | number[]> => {
  const replies = await fakeBridge(module).run(new ArrayBuffer(0), planQuestion(t, seed).calls)
  return t.read(replies)
}

const SEEDS = [...Array.from({ length: 300 }, (_, i) => i), 4_000_000_000, 0xffffffff, 123_456_789]
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Every module the checks can pass differs from these on ties, aging and margin, and agrees on the order. */
const CORRECT_MODULES: Record<string, Opts> = {
  'fleet reference (js margin, age 2000)': { age: 2000 },
  'private reference (rust margin, age 1600)': { margin: 'rust', age: 1600 },
  'margin on running requests only': { margin: 'running' },
  'ties by id, age 900': { tie: 'id', age: 900 },
  'a short age limit of 60': { age: 60 },
  'stops at the first that does not fit': { stopAtFirst: true },
  'no aging at all (fails starvation, still sorts)': { age: Infinity },
}

describe('the fakes stand for real schedulers', () => {
  const asView = (p: Parsed): SchedView => ({
    iter: p.iter,
    maxRunning: p.maxRunning,
    memCap: p.memCap,
    memUsed: p.memUsed,
    waiting: p.waiting,
    running: p.running.map((r) => ({ ...r, prefillLeft: r.prefillLeft })),
  })

  test('the bridge parse reads what the templates write: the header’s memory field is the running requests’ tokens', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS.slice(0, 40)) {
        const call = planQuestion(t, seed).calls[1]
        const p = parseSchedule(call)
        expect(p.memUsed).toBe(p.running.reduce((a, r) => a + r.prompt + r.decoded, 0))
        expect(call.split('\n').filter((l) => l.startsWith('W ')).length).toBe(p.waiting.length)
        expect(call.split('\n').filter((l) => l.startsWith('R ')).length).toBe(p.running.length)
      }
    }
  })

  test('the default fake is the app’s referenceScheduler: the same admit list, in the same order, on every view', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const p = parseSchedule(planQuestion(t, seed).calls[1])
        expect(decide(p, { age: 2000 }).admit).toEqual(referenceScheduler(asView(p)).admit)
      }
    }
  })

  test('the default fake equals the Compose dials’ compiled reference, and no view of the templates makes the reference preempt', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS.slice(0, 80)) {
        const p = parseSchedule(planQuestion(t, seed).calls[1])
        const driver = compileSchedPolicy({ order: 'sjf', guard: 2000, headroom: 48, preempt: 'none' })
        expect(driver.schedule(asView(p))).toEqual(referenceScheduler(asView(p)))
        expect(referenceScheduler(asView(p)).preempt).toEqual([])
      }
    }
  })
})

/* ------------------------------ the trace contract ------------------------------ */

describe('every trace is two calls of the bridge’s verbs, told in words', () => {
  test('on every seed: init, then one schedule entry with a five-field header; an ids or number answer; a question', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        expect(q.calls.length).toBeLessThanOrEqual(PROVE2_MAX_CALLS)
        expect(q.calls).toHaveLength(2)
        expect(q.calls[0]).toBe('init')
        expect(q.calls[1].split('\n')[0]).toMatch(/^schedule \d+ \d+ \d+ \d+$/)
        expect(q.answer).toBe(t === ADMIT_COUNT ? 'number' : 'ids')
        expect(q.ask.endsWith('?') || q.ask.endsWith('.')).toBe(true)
        // the entry is one call, never split: multi-line, W and R lines only after the header
        for (const l of q.calls[1].split('\n').slice(1)) expect(l).toMatch(/^[WR] \d+ \d+ \d+( \d+ \d+)?$/)
      }
    }
  })

  test('the story tells every request of the view, with its numbers; the ask names what is measured', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        const p = parseSchedule(q.calls[1])
        const story = q.story.join('\n')
        expect(q.story[0]).toContain('init')
        expect(story).toContain(`At iteration ${p.iter} the engine allows ${p.maxRunning} running requests at once and holds at most ${p.memCap} tokens`)
        const tokens = (n: number) => (n === 1 ? '1 token' : `${n} tokens`)
        for (const r of p.waiting) expect(story).toContain(`Waiting: request ${r.id} arrived at iteration ${r.arrival} with a prompt of ${tokens(r.prompt)}.`)
        for (const r of p.running) {
          expect(story).toContain(`Running: request ${r.id} arrived at iteration ${r.arrival}, has a prompt of ${tokens(r.prompt)} and has decoded ${tokens(r.decoded)}.`)
        }
        expect(q.story.filter((l) => l.startsWith('Waiting:') || l.startsWith('Running:'))).toHaveLength(p.waiting.length + p.running.length)
        // in the order the call carries them
        const told = q.story.filter((l) => l.startsWith('Waiting:')).map((l) => Number(/request (\d+)/.exec(l)?.[1]))
        expect(told).toEqual(p.waiting.map((r) => r.id))
      }
    }
    expect(planQuestion(ADMIT_ORDER, 1).ask).toContain('admit')
    expect(planQuestion(ADMIT_COUNT, 1).ask).toContain('How many')
    expect(planQuestion(WALK_PAST, 1).ask).toContain('admit')
    expect(planQuestion(WALK_PAST, 1).ask).toContain('none')
  })

  test('ids are distinct in a view, the waiting list is in arrival order, and no id is in order with arrival', () => {
    let outOfOrder = 0
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const p = parseSchedule(planQuestion(t, seed).calls[1])
        const ids = [...p.waiting, ...p.running].map((r) => r.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const list of [p.waiting, p.running]) for (let i = 1; i < list.length; i++) expect(list[i].arrival).toBeGreaterThan(list[i - 1].arrival)
        if (p.waiting.some((r, i) => i > 0 && r.id < p.waiting[i - 1].id)) outOfOrder++
      }
    }
    expect(outOfOrder).toBeGreaterThan(SEEDS.length)
  })

  test('the same seed gives the same question', () => {
    for (const t of PROVE2.templates) expect(planQuestion(t, 77)).toEqual(planQuestion(t, 77))
  })

  test('the replies are read from the schedule line only: init’s reply, an error and a missing line fail the trace', () => {
    for (const t of PROVE2.templates) {
      const plan = planQuestion(t, 9)
      expect(gradeAnswer(t, [], { kind: 'replied', replies: ['ok', 'err not initialized'] })).toMatchObject({ right: false, actual: null, failed: 'error' })
      // the line every template reads, `admit`, must hold ids
      const garbled = 'admit 1,x\npreempt '
      expect(gradeAnswer(t, [], { kind: 'replied', replies: ['ok', garbled] })).toMatchObject({ right: false, actual: null, failed: 'error' })
      expect(gradeAnswer(t, [], { kind: 'replied', replies: ['ok', 'ok'] })).toMatchObject({ right: false, actual: null, failed: 'error' })
      expect(plan.calls).toHaveLength(2)
    }
    // a reply with an empty list reads as an empty list
    expect(ADMIT_ORDER.read(['ok', 'admit \npreempt '])).toEqual([])
    expect(WALK_PAST.read(['ok', 'admit 3,1\npreempt 4'])).toEqual([3, 1])
    expect(ADMIT_COUNT.read(['ok', 'admit 3,1,7\npreempt '])).toBe(3)
  })
})

/* ------------------------------ the rule: your code, not the story ------------------------------ */

describe('the templates avoid the choices the checks pin, and read the ones they leave free', () => {
  test('admit-order: every module the checks can pass sorts alike, whatever its ties, aging, margin or stopping rule', async () => {
    for (const seed of SEEDS) {
      const right = await answerOn(ADMIT_ORDER, seed, fakeScheduler())
      for (const [name, o] of Object.entries(CORRECT_MODULES)) expect(await answerOn(ADMIT_ORDER, seed, fakeScheduler(o)), `${name}, seed ${seed}`).toEqual(right)
    }
  })

  test('admit-order: the answer is the smallest prompts in order, cut at the free slots, and fills them', async () => {
    for (const seed of SEEDS) {
      const q = planQuestion(ADMIT_ORDER, seed)
      const p = parseSchedule(q.calls[1])
      const free = p.maxRunning - p.running.length
      const expected = [...p.waiting].sort((a, b) => a.prompt - b.prompt).slice(0, free).map((r) => r.id)
      expect(await answerOn(ADMIT_ORDER, seed, fakeScheduler())).toEqual(expected)
      expect(expected).toHaveLength(free)
      expect(p.waiting.length).toBeGreaterThanOrEqual(free)
      // distinct prompts, at least 64 apart; nothing old; memory is nowhere near the cap
      const prompts = p.waiting.map((r) => r.prompt).sort((a, b) => a - b)
      for (let i = 1; i < prompts.length; i++) expect(prompts[i] - prompts[i - 1]).toBeGreaterThanOrEqual(64)
      for (const r of p.waiting) expect(p.iter - r.arrival).toBeLessThanOrEqual(40)
      expect(p.memCap).toBe(ROOMY_CAP)
      expect(p.memUsed + prompts.reduce((a, b) => a + b, 0) + MARGIN * 12).toBeLessThan(ROOMY_CAP)
    }
  })

  test('admit-count: modules that keep about 48 tokens a sequence agree however they count it, and one with no margin admits one more', async () => {
    for (const seed of SEEDS) {
      const answers = await Promise.all(
        (['js', 'rust', 'running'] as const).map((margin) => answerOn(ADMIT_COUNT, seed, fakeScheduler({ margin }))),
      )
      expect(new Set(answers).size, `seed ${seed}: ${answers}`).toBe(1)
      const none = await answerOn(ADMIT_COUNT, seed, fakeScheduler({ margin: 'none' }))
      expect(none).toBe((answers[0] as number) + 1)
    }
  })

  test('admit-count: the order is not asked (arrival order and smallest-first agree), nor the slots (they are not the limit)', async () => {
    for (const seed of SEEDS) {
      const base = await answerOn(ADMIT_COUNT, seed, fakeScheduler())
      expect(await answerOn(ADMIT_COUNT, seed, fakeScheduler({ order: 'fcfs' }))).toBe(base)
      expect(await answerOn(ADMIT_COUNT, seed, fakeScheduler({ stopAtFirst: true }))).toBe(base)
      const p = parseSchedule(planQuestion(ADMIT_COUNT, seed).calls[1])
      expect(p.maxRunning - p.running.length).toBeGreaterThan(p.waiting.length)
    }
  })

  test('admit-count: how far the cap sits from the edge, worked by hand on seed 1', () => {
    const p = parseSchedule(planQuestion(ADMIT_COUNT, 1).calls[1])
    // two running requests hold 187 + 39 + 387 + 11 = 624 tokens; the waiting prompts are 178, 259, 358, 494 and 572
    expect(p.memUsed).toBe(624)
    expect(p.waiting.map((r) => r.prompt)).toEqual([178, 259, 358, 494, 572])
    expect(p.memCap).toBe(1466)
    // with no margin: 624 + 178 + 259 + 358 = 1419 fits under 1466, and 494 more does not: three admitted
    expect(624 + 178 + 259 + 358).toBeLessThanOrEqual(1466)
    expect(624 + 178 + 259 + 358 + 494).toBeGreaterThan(1466)
    // with 48 a sequence (the fleet reference: each running and each admitted request pays, the candidate too):
    // 624 + 2 x 48 = 720; +178 +48 = 946; +259 +48 = 1253; +358 +48 = 1659 does not fit: two admitted
    expect(624 + 2 * 48 + (178 + 48) + (259 + 48)).toBeLessThanOrEqual(1466)
    expect(624 + 2 * 48 + (178 + 48) + (259 + 48) + (358 + 48)).toBeGreaterThan(1466)
  })

  test('admit-count: the answer differs across seeds for a module that keeps its margin, and for one that keeps none', async () => {
    for (const margin of ['js', 'rust', 'none'] as const) {
      const answers = new Set<number>()
      for (const seed of SEEDS) answers.add((await answerOn(ADMIT_COUNT, seed, fakeScheduler({ margin }))) as number)
      expect([...answers].sort()).toEqual(margin === 'none' ? [2, 3, 4] : [1, 2, 3])
    }
  })

  /** The view of `walk-past`: the old requests (waited OLD_WAIT or more), the one of them that cannot fit, and the young. */
  const walkView = (seed: number) => {
    const p = parseSchedule(planQuestion(WALK_PAST, seed).calls[1])
    const old = p.waiting.filter((r) => p.iter - r.arrival >= OLD_WAIT)
    const young = p.waiting.filter((r) => p.iter - r.arrival < OLD_WAIT)
    const freeMem = p.memCap - p.memUsed
    const blocked = old.filter((r) => r.prompt > freeMem)
    const fits = old.filter((r) => r.prompt <= freeMem)
    return { p, old, young, blocked, fits, freeMem, slots: p.maxRunning - p.running.length }
  }

  /** The modules the checks can pass, for `walk-past`: every one but the stopping design and the one with no aging. */
  const WALKERS = Object.entries(CORRECT_MODULES).filter(([, o]) => o.stopAtFirst !== true && o.age !== Infinity)

  test('walk-past: every module the checks can pass and that skips agrees, whatever its ties, age limit or margin', async () => {
    expect(WALKERS).toHaveLength(5)
    for (const seed of SEEDS) {
      const right = await answerOn(WALK_PAST, seed, fakeScheduler())
      for (const [name, o] of WALKERS) expect(await answerOn(WALK_PAST, seed, fakeScheduler(o)), `${name}, seed ${seed}`).toEqual(right)
      for (const margin of ['js', 'rust', 'running', 'none'] as const) expect(await answerOn(WALK_PAST, seed, fakeScheduler({ margin })), `${margin}, seed ${seed}`).toEqual(right)
      // headroom up to 96 tokens a sequence, counted any way, does not change it
      for (const margin of ['js', 'rust', 'running'] as const) expect(await answerOn(WALK_PAST, seed, fakeScheduler({ margin, h: WIDE_MARGIN })), `${margin} 96, seed ${seed}`).toEqual(right)
    }
  })

  test('walk-past: one old request cannot fit even with no margin, though an empty engine would take it; the young wait under 41', () => {
    let withFit = 0
    for (const seed of SEEDS) {
      const { p, old, young, blocked, fits, freeMem } = walkView(seed)
      expect(blocked).toHaveLength(1)
      expect(old.length).toBeLessThanOrEqual(2)
      expect(fits).toHaveLength(old.length - 1)
      if (fits.length > 0) withFit++
      const over = blocked[0].prompt - freeMem
      expect(over).toBeGreaterThanOrEqual(1)
      expect(over).toBeLessThanOrEqual(300)
      expect(blocked[0].prompt).toBeLessThanOrEqual(p.memCap)
      // past any age limit that lets starvation's longs (waiting from 0 in a 2,500-iteration run, about 40 to finish) finish
      for (const r of old) expect(p.iter - r.arrival).toBeGreaterThanOrEqual(2500 + 40)
      expect(young.length).toBeGreaterThanOrEqual(3)
      for (const r of young) expect(p.iter - r.arrival).toBeLessThanOrEqual(40)
      // room for every request but the blocked one at 96 tokens a sequence, over every slot
      const rest = [...fits, ...young].reduce((a, r) => a + r.prompt, 0)
      expect(p.memUsed + rest + WIDE_MARGIN * p.maxRunning).toBeLessThanOrEqual(p.memCap)
    }
    expect(withFit).toBeGreaterThan(SEEDS.length / 3)
    expect(withFit).toBeLessThan((2 * SEEDS.length) / 3)
  })

  test('walk-past: the reference admits the old request that fits, then the young smallest first, cut at the free slots', async () => {
    for (const seed of SEEDS) {
      const { fits, young, slots } = walkView(seed)
      const expected = [...fits, ...[...young].sort((a, b) => a.prompt - b.prompt)].slice(0, slots).map((r) => r.id)
      expect(await answerOn(WALK_PAST, seed, fakeScheduler())).toEqual(expected)
      // it always admits a young request, which is what a module that stops can never do
      expect(expected.some((id) => young.some((r) => r.id === id))).toBe(true)
    }
  })
})

describe('a plausible bug changes the answer, and the answer differs across seeds', () => {
  const across = async (t: ProveV2Template, module: () => Handler) => {
    const answers = new Set<string>()
    for (const seed of SEEDS) answers.add(JSON.stringify(await answerOn(t, seed, module)))
    return answers
  }

  test('each template names its bug in a sentence a test can separate', () => {
    for (const t of PROVE2.templates) expect(t.bug.length).toBeGreaterThan(40)
    expect(ADMIT_ORDER.kcs).toEqual([KC.schedOrder])
    expect(ADMIT_COUNT.kcs).toEqual([KC.admissionHeadroom])
    expect(WALK_PAST.kcs).toEqual([KC.continuousBatching])
    const labKcs = new Set(checks.flatMap((c) => c.kcs ?? []))
    for (const t of PROVE2.templates) for (const k of t.kcs) expect(labKcs.has(k)).toBe(true)
  })

  test('admit-order: first come first served and largest-first answer differently from smallest-first on every seed', async () => {
    for (const seed of SEEDS) {
      const right = await answerOn(ADMIT_ORDER, seed, fakeScheduler())
      expect(same(await answerOn(ADMIT_ORDER, seed, fakeScheduler({ order: 'fcfs' })), right), `fcfs, seed ${seed}`).toBe(false)
      expect(same(await answerOn(ADMIT_ORDER, seed, fakeScheduler({ order: 'largest' })), right), `largest, seed ${seed}`).toBe(false)
    }
    expect((await across(ADMIT_ORDER, fakeScheduler())).size).toBeGreaterThan(SEEDS.length / 2)
  })

  test('admit-count: a module with no headroom admits one more, on every seed', async () => {
    for (const seed of SEEDS) {
      const right = (await answerOn(ADMIT_COUNT, seed, fakeScheduler())) as number
      expect(await answerOn(ADMIT_COUNT, seed, fakeScheduler({ margin: 'none' }))).toBe(right + 1)
    }
    expect((await across(ADMIT_COUNT, fakeScheduler())).size).toBe(3)
  })

  test('walk-past: a module that stops at the request that does not fit answers differently on every seed, and the answer differs across seeds', async () => {
    let empty = 0
    for (const seed of SEEDS) {
      const right = await answerOn(WALK_PAST, seed, fakeScheduler())
      const stopped = await answerOn(WALK_PAST, seed, fakeScheduler({ stopAtFirst: true }))
      expect(same(stopped, right), `seed ${seed}`).toBe(false)
      // it admits at most the old request ahead of the blocked one
      expect((stopped as number[]).length).toBeLessThanOrEqual(1)
      if ((stopped as number[]).length === 0) empty++
      // the private reference's own margin and age limit, stopping: still a different answer
      expect(same(await answerOn(WALK_PAST, seed, fakeScheduler({ margin: 'rust', age: 1600, stopAtFirst: true })), right)).toBe(false)
    }
    expect(empty).toBeGreaterThan(SEEDS.length / 2)
    expect((await across(WALK_PAST, fakeScheduler())).size).toBeGreaterThan(SEEDS.length / 2)
    expect((await across(WALK_PAST, fakeScheduler({ margin: 'rust', age: 1600 }))).size).toBeGreaterThan(SEEDS.length / 2)
  })

  test('walk-past: a module with no aging answers differently whenever an old request fits, so aging is read too', async () => {
    let fitting = 0
    for (const seed of SEEDS) {
      const p = parseSchedule(planQuestion(WALK_PAST, seed).calls[1])
      const freeMem = p.memCap - p.memUsed
      const fits = p.waiting.some((r) => p.iter - r.arrival >= OLD_WAIT && r.prompt <= freeMem)
      const right = await answerOn(WALK_PAST, seed, fakeScheduler())
      const unaged = await answerOn(WALK_PAST, seed, fakeScheduler({ age: Infinity }))
      expect(same(unaged, right), `seed ${seed}`).toBe(!fits)
      if (fits) fitting++
    }
    expect(fitting).toBeGreaterThan(SEEDS.length / 3)
  })

  test('worked by hand: seed 1 of each template, its story and the answers', async () => {
    // Six requests wait at iteration 79 and one runs, with 4 slots: 3 free. Smallest first is 64 (id 1), 128 (id 2),
    // 256 (id 13). First come first served would take ids 8, 18, 2.
    const order = planQuestion(ADMIT_ORDER, 1)
    expect(order.story.filter((l) => l.startsWith('Waiting:'))).toEqual([
      'Waiting: request 8 arrived at iteration 41 with a prompt of 320 tokens.',
      'Waiting: request 18 arrived at iteration 56 with a prompt of 384 tokens.',
      'Waiting: request 2 arrived at iteration 65 with a prompt of 128 tokens.',
      'Waiting: request 10 arrived at iteration 66 with a prompt of 448 tokens.',
      'Waiting: request 13 arrived at iteration 67 with a prompt of 256 tokens.',
      'Waiting: request 1 arrived at iteration 68 with a prompt of 64 tokens.',
    ])
    expect(order.story[order.story.length - 1]).toBe('3 slots are free.')
    expect(await answerOn(ADMIT_ORDER, 1, fakeScheduler())).toEqual([1, 2, 13])
    expect(await answerOn(ADMIT_ORDER, 1, fakeScheduler({ order: 'fcfs' }))).toEqual([8, 18, 2])
    // admit-count, seed 1: see the arithmetic in the test above. Margin kept: 2; none: 3.
    expect(await answerOn(ADMIT_COUNT, 1, fakeScheduler())).toBe(2)
    expect(await answerOn(ADMIT_COUNT, 1, fakeScheduler({ margin: 'rust' }))).toBe(2)
    expect(await answerOn(ADMIT_COUNT, 1, fakeScheduler({ margin: 'none' }))).toBe(3)
    // walk-past, seed 1: request 3 runs and holds 193 + 41 = 234 of 2,876 tokens, so 2,642 are free and 3 slots. Requests 6
    // (865 tokens) and 2 (2,817) have waited 3,635 - 756 = 2,879 and 3,635 - 860 = 2,775 iterations, so aging puts 6, then 2,
    // first. 6 fits (234 + 48 + 865 + 48 = 1,195 with the fleet reference's margin); 2 does not, even with no margin
    // (2,817 > 2,642), though it would fit an empty engine (2,817 <= 2,876). Skip it, and the two smallest young prompts
    // take the last slots: 13 (128 tokens) and 17 (192). A module that stops at 2 admits only 6; one with no aging sorts 6
    // behind the young and admits 13, 17 and 7 (256).
    const walk = planQuestion(WALK_PAST, 1)
    expect(walk.story.filter((l) => l.startsWith('Waiting:') || l.startsWith('Running:'))).toEqual([
      'Running: request 3 arrived at iteration 3586, has a prompt of 193 tokens and has decoded 41 tokens.',
      'Waiting: request 6 arrived at iteration 756 with a prompt of 865 tokens.',
      'Waiting: request 2 arrived at iteration 860 with a prompt of 2817 tokens.',
      'Waiting: request 7 arrived at iteration 3597 with a prompt of 256 tokens.',
      'Waiting: request 11 arrived at iteration 3602 with a prompt of 448 tokens.',
      'Waiting: request 17 arrived at iteration 3608 with a prompt of 192 tokens.',
      'Waiting: request 13 arrived at iteration 3614 with a prompt of 128 tokens.',
      'Waiting: request 1 arrived at iteration 3619 with a prompt of 320 tokens.',
    ])
    expect(walk.story[1]).toContain('At iteration 3635 the engine allows 4 running requests at once and holds at most 2876 tokens')
    expect(walk.story[walk.story.length - 1]).toBe('3 slots are free.')
    expect(2876 - (193 + 41)).toBe(2642)
    expect(234 + 48 + 865 + 48).toBeLessThanOrEqual(2876)
    expect(2817).toBeGreaterThan(2642)
    expect(await answerOn(WALK_PAST, 1, fakeScheduler())).toEqual([6, 13, 17])
    expect(await answerOn(WALK_PAST, 1, fakeScheduler({ margin: 'rust', age: 1600 }))).toEqual([6, 13, 17])
    expect(await answerOn(WALK_PAST, 1, fakeScheduler({ stopAtFirst: true }))).toEqual([6])
    expect(await answerOn(WALK_PAST, 1, fakeScheduler({ age: Infinity }))).toEqual([13, 17, 7])
  })
})

/* ------------------------------ through the core ------------------------------ */

describe('graded by the core against your module', () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 2]).buffer
  const hash = async () => 'ab'.repeat(32)

  test('the right answer on the module the unseen run graded is proved; the bug’s answer is a miss that shows the module’s', async () => {
    const bugs: [ProveV2Template, Opts, Opts][] = [
      [ADMIT_ORDER, {}, { order: 'fcfs' }],
      [ADMIT_COUNT, {}, { margin: 'none' }],
      [WALK_PAST, {}, { stopAtFirst: true }],
    ]
    for (const [t, good, bad] of bugs) {
      const seed = 31
      const plan = planQuestion(t, seed)
      const right = await answerOn(t, seed, fakeScheduler(good))
      const wrong = await answerOn(t, seed, fakeScheduler(bad))
      expect(same(wrong, right)).toBe(false)
      const go = (answer: number | number[]) =>
        proveFromModule({ labId: 'batching-scheduler', template: t, plan, answer, bytes, graded: { sha256: 'ab'.repeat(32), credit: 'unseen' }, history: [], now: 0, run: fakeBridge(fakeScheduler(good)).run, hash })
      const hit = await go(right)
      const miss = await go(wrong)
      if (hit.kind !== 'graded' || miss.kind !== 'graded') throw new Error('refused')
      expect(hit.result).toMatchObject({ provenance: 'proved', score: 1, ok: true, seed, data: { v: 2, qid: t.id, answer: right, actual: right, calls: 2 } })
      // a miss is not ok (wave-3.md §3.2), so the fold gives it no proves[lab] and no prove:<lab> fact
      expect(miss.result).toMatchObject({ provenance: 'practice', score: 0, ok: false, data: { answer: wrong, actual: right } })
    }
  })

  test('a module that admits nobody is proved by typing none, and typing an id is a miss', async () => {
    // a seed where the blocked request is first in line, so a module that stops there admits nobody
    const module = fakeScheduler({ stopAtFirst: true })
    let seed = 0
    while (((await answerOn(WALK_PAST, seed, module)) as number[]).length > 0) seed++
    const plan = planQuestion(WALK_PAST, seed)
    const typed = readAnswer('none', 'ids')
    if (!typed.ok) throw new Error('none is an answer')
    const run = fakeBridge(module).run
    const base = { labId: 'batching-scheduler', template: WALK_PAST, plan, bytes, graded: { sha256: 'ab'.repeat(32), credit: 'unseen' as const }, history: [], now: 0, run, hash }
    const hit = await proveFromModule({ ...base, answer: typed.answer })
    const miss = await proveFromModule({ ...base, answer: await answerOn(WALK_PAST, seed, fakeScheduler()) })
    if (hit.kind !== 'graded' || miss.kind !== 'graded') throw new Error('refused')
    expect(hit.result).toMatchObject({ provenance: 'proved', ok: true, data: { answer: [], actual: [] } })
    expect(miss.result).toMatchObject({ provenance: 'practice', ok: false })
  })

  test('an ids answer is read the way the panel takes it: commas or spaces, in order', () => {
    expect(readAnswer('1, 2, 13', 'ids')).toEqual({ ok: true, answer: [1, 2, 13] })
    expect(readAnswer('1 2 13', 'ids')).toEqual({ ok: true, answer: [1, 2, 13] })
    expect(readAnswer('3', 'number')).toEqual({ ok: true, answer: 3 })
  })

  test('a module that replies anything but a schedule fails the trace instead of being read as an answer', () => {
    for (const t of PROVE2.templates) {
      expect(gradeAnswer(t, 1, { kind: 'replied', replies: ['ok', 'err not initialized'] })).toMatchObject({ right: false, actual: null, failed: 'error' })
      expect(gradeAnswer(t, 1, { kind: 'replied', replies: ['ok', 'ok'] })).toMatchObject({ right: false, actual: null, failed: 'error' })
    }
  })
})

/* ------------------------------ every attempt is one the ledger keeps ------------------------------ */

describe('every attempt on lab 06 passes the codec (as tests/forge/prove2-codec.test.ts holds lab 02)', () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 2]).buffer
  const SHA = 'ab'.repeat(32)
  const AT = '2026-10-14T09:30:00.000Z'
  /** Replies a module could send to `schedule`, most of them not the protocol's. */
  const ODD_REPLIES = ['', 'ok', 'admit', 'admit \npreempt ', 'admit 3,x\npreempt ', 'admit 1,2,3\npreempt 9', 'preempt 4', 'err unknown command', 'admit 99999999999999999999', 'admit -1', 'admit 2.5', '\u0000']
  /** What a learner might type. */
  const TYPED = ['', 'none', '6, 13, 17', '3', '2.5', '-1', 'x', '1'.repeat(400), Array.from({ length: 14 }, (_, i) => i).join(', ')]
  type Rand = () => number
  const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const BUGGY: Opts[] = [{ order: 'fcfs' }, { margin: 'none' }, { stopAtFirst: true }, { order: 'largest' }]

  test('its three templates, 400 seeds each, correct, buggy and hostile modules, typed answers and their truths', async () => {
    let built = 0
    let proved = 0
    for (const t of PROVE2.templates) {
      for (let seed = 0; seed < 400; seed++) {
        const r = splitmix32(seed * 7919 + t.id.length)
        const plan = planQuestion(t, seed * 2654435761)
        const kind = int(r, 0, 2)
        const module =
          kind === 0
            ? fakeScheduler(pick(r, Object.values(CORRECT_MODULES)))
            : kind === 1
              ? fakeScheduler(pick(r, BUGGY))
              : () => (cmd: string) => (r() < 0.05 && cmd !== plan.calls[0] ? trap('boom') : pick(r, ODD_REPLIES))
        const run = fakeBridge(module).run
        // the module's own answer, when it has one, half the time; otherwise whatever the learner typed
        const truth = await run(bytes, plan.calls).then(
          (replies) => {
            try {
              return t.read(replies)
            } catch {
              return null
            }
          },
          () => null,
        )
        const typed = readAnswer(pick(r, TYPED), plan.answer)
        const answer = truth !== null && isProve2Answer(truth) && r() < 0.5 ? truth : typed.ok ? typed.answer : null
        if (answer === null) continue
        const graded = pick(r, [{ sha256: SHA, credit: 'unseen' }, { sha256: SHA, credit: 'lab-green' }, null] as const)
        const result = await proveFromModule({ labId: 'batching-scheduler', template: t, plan, answer, bytes, graded, history: [], now: 0, run, hash: async () => SHA })
        if (result.kind === 'refused') throw new Error(result.message)
        // the event `recordProve` writes, envelope and all
        const { labId, provenance, ...rest } = result.result
        const event = { id: 't:1', v: 1, kind: 'prove', ref: `prove:${labId}`, at: AT, tz: 0, day: dayOf(AT, 0), dev: 'dev-1', provenance: provenance ?? 'practice', ...rest }
        const checked = validateEvent(event)
        if (!checked.ok) throw new Error(`${t.id} seed ${seed}: the codec refuses ${JSON.stringify(result.result)}: ${checked.reason}`)
        const d = result.result.data as { answer: number | number[]; actual: number | number[] | null }
        const right = d.actual !== null && same(d.answer, d.actual)
        expect(result.result.ok).toBe(right)
        expect(result.result.score).toBe(right ? 1 : 0)
        built++
        if (provenance === 'proved') proved++
      }
    }
    expect(built).toBeGreaterThan(600)
    expect(proved).toBeGreaterThan(20)
  })
})
