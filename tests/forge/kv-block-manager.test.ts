/**
 * Lab 02, kv-block-manager (docs/specs/wave-2.md §13.2; task 2c-09): the bundle's stages, PRIMM items and reference
 * run on the Fleet's `RefBlockManager`, the hint ladder for the six required checks and the six Prove-it questions.
 * The multiple-choice items are held to the blind-strategy gates of `verify:items` here, because that script reads
 * lab 01's items only until 2a-18 collects every `src/data/forge/*` pool; the check below is the same code
 * (scripts/item-cues.ts), run on this pool. `verify:mentor` already lints the ladder (lintBundle is run here too).
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
import bundle from '../../src/data/forge/kv-block-manager'
import { DISCUSSIONS_LABEL, LAB_ID, LADDER, LADDER_CHECK_IDS, hintRef, restoreState } from '../../src/data/forge/kv-block-manager/ladder'
import {
  CHURN,
  PRACTICE_SEED,
  PRIMM_ITEMS,
  PRIMM_MC_ITEMS,
  PRIMM_STEPS,
  REFERENCE,
  RUN_ITEM,
  RUN_SPEC,
  STAGES,
  attemptsToGreen,
  currentStage,
  describeRun,
  gradeChoice,
  gradeNumber,
  greenStage,
  itemResponse,
  primmRef,
  runChurn,
  runResponse,
  stageRows,
  type NumberPrimm,
} from '../../src/data/forge/kv-block-manager/primm'
import { PROVE_LAB_ID, PROVE_QUESTIONS, buildProveResult, followUpRef, pickQuestions } from '../../src/data/forge/kv-block-manager/prove'
import { KC } from '../../src/data/kc/ids'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { RefBlockManager } from '../../src/lib/fleet-model'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { refMatchesKind } from '../../src/lib/ledger/refs'
import { extractHeadings } from '../../src/pages/lesson/markdown'
import { lintBundle } from '../../scripts/lint-mentor'
import { CUE_STRATEGIES, MAX_RANK_LESSON, PASS_BAR, passProbability, poolCueFailures } from '../../scripts/item-cues'

const lab = FORGE_LABS.find((l) => l.id === 'kv-block-manager')
if (lab === undefined) throw new Error('lab 02 is missing from labs.ts')
const checks = lab.checks
const required = checks.filter((c) => c.optional !== true).map((c) => c.id)
const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const kcValues = new Set<string>(Object.values(KC))

describe('stages: labs.ts, manager.rs and the harness agree (§13.2)', () => {
  test('stage 1 is the single check paging, then capacity, then sharing, then copy-on-write and the gauntlet', () => {
    const byStage = (n: number) => checks.filter((c) => c.stage === n).map((c) => c.id)
    expect(byStage(1)).toEqual(['paging'])
    expect(byStage(2)).toEqual(['capacity'])
    expect(byStage(3).sort()).toEqual(['fork_shares', 'free_refcount'])
    expect(byStage(4).sort()).toEqual(['cow', 'gauntlet'])
    expect(byStage(5)).toEqual(['adapter_unified_paging'])
    expect(checks.find((c) => c.id === 'adapter_unified_paging')?.optional).toBe(true)
  })

  test('the bundle’s stages are the four a required check carries, each at most 25 minutes', () => {
    expect(bundle.stages.map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(bundle.stages).toEqual([...STAGES])
    for (const s of STAGES) expect(s.minutes).toBeLessThanOrEqual(25)
  })

  test('the harness lists the same stage for each check', () => {
    const lib = read('labs/kv-block-manager/src/lib.rs')
    for (const c of checks) {
      const m = new RegExp(`id: "${c.id}",[^}]*?stage: (\\d)`).exec(lib)
      expect(m?.[1]).toBe(String(c.stage))
    }
  })

  test('manager.rs marks each stage with its checks, and the first marker of a stage carries the minutes the bundle states', () => {
    const src = read('labs/kv-block-manager/src/manager.rs')
    const named = new Map<number, Set<string>>()
    const minutes = new Map<number, number>()
    for (const m of src.matchAll(/^\s*\/\/ STAGE (\d) · ([a-z_, ]+?)(?: · ≈ (\d+) min)?\s*$/gm)) {
      const n = Number(m[1])
      named.set(n, new Set([...(named.get(n) ?? []), ...m[2].split(', ')]))
      if (m[3] !== undefined && !minutes.has(n)) minutes.set(n, Number(m[3]))
    }
    for (const stage of STAGES) {
      const expected = required.filter((id) => checks.find((c) => c.id === id)?.stage === stage.n)
      expect([...(named.get(stage.n) ?? [])].sort()).toEqual(expected.sort())
      expect(minutes.get(stage.n)).toBe(stage.minutes)
    }
  })

  test('stage 1 is the two-minute win (§13.2) in the bundle, the code marker and the header table alike', () => {
    const src = read('labs/kv-block-manager/src/manager.rs')
    expect(STAGES[0].minutes).toBe(2)
    expect(src).toMatch(/^\/\/!\s+STAGE 1\s+paging\s+≈ 2 min\b/m)
    expect(src).toMatch(/^\s*\/\/ STAGE 1 · paging · ≈ 2 min$/m)
    expect(src).not.toContain('≈ 5 min')
  })

  test('the signatures did not change', () => {
    const src = read('labs/kv-block-manager/src/manager.rs')
    expect(src).toContain('pub fn new(num_blocks: usize, block_size: usize) -> Self')
    expect(src).toContain('pub fn allocate(&mut self, seq: u32, tokens: usize) -> bool')
    expect(src).toContain('pub fn append(&mut self, seq: u32, n: usize) -> bool')
    expect(src).toContain('pub fn fork(&mut self, src: u32, dst: u32) -> bool')
    expect(src).toContain('pub fn free(&mut self, seq: u32)')
    expect(src).toContain('pub fn translate(&self, seq: u32, token: usize) -> Option<usize>')
  })

  test('the page walks the PRIMM steps in order', () => {
    expect(PRIMM_STEPS.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
  })
})

describe('stage rows and attempts-to-green, over lab 02’s checks', () => {
  const ids = (...a: string[]) => new Set(a)

  test('nothing passed: stage 1 is next, nothing is green', () => {
    const rows = stageRows(checks, ids())
    expect(rows.every((r) => !r.green)).toBe(true)
    expect(currentStage(rows)?.n).toBe(1)
    expect(greenStage(rows)).toBe(0)
  })

  test('paging alone turns stage 1 green: it is the single check of the first stage', () => {
    const rows = stageRows(checks, ids('paging'))
    expect(rows.map((r) => r.green)).toEqual([true, false, false, false])
    expect(greenStage(rows)).toBe(1)
  })

  test('stage 3 needs both fork_shares and free_refcount', () => {
    const half = stageRows(checks, ids('paging', 'capacity', 'fork_shares'))
    expect(half.map((r) => r.green)).toEqual([true, true, false, false])
    const full = stageRows(checks, ids('paging', 'capacity', 'fork_shares', 'free_refcount'))
    expect(greenStage(full)).toBe(3)
  })

  test('the six required checks make four green stages; the optional adapter check is not a stage', () => {
    const rows = stageRows(checks, ids(...required))
    expect(greenStage(rows)).toBe(4)
    expect(currentStage(rows)).toBeNull()
    expect(rows).toHaveLength(4)
  })

  test('attempts-to-green counts runs from the run after the previous stage went green', () => {
    const runs = [[], ['paging'], ['paging'], ['paging', 'capacity'], ['paging', 'capacity', 'fork_shares', 'free_refcount']]
    expect(attemptsToGreen(runs, checks)).toEqual([2, 2, 1, null])
  })
})

describe('the reference run: the Fleet’s RefBlockManager on fork-heavy churn', () => {
  const ref = runChurn(REFERENCE)

  test('it is deterministic in its config, and a different seed is a different run', () => {
    expect(runChurn(REFERENCE)).toEqual(ref)
    expect(runChurn({ ...REFERENCE, seed: PRACTICE_SEED + 1 })).not.toEqual(ref)
    expect(RUN_SPEC.run(RUN_SPEC.reference)).toEqual(RUN_SPEC.run(RUN_SPEC.reference))
  })

  test('the pool is the Fleet’s: 32 blocks of 16, and the run conserves every block after every op', () => {
    expect(CHURN.numBlocks).toBe(32)
    expect(CHURN.blockSize).toBe(16)
    expect(ref.conserved).toBe(true)
    expect(RUN_SPEC.run(RUN_SPEC.reference).clean).toBe(true)
    for (const s of ref.samples) {
      expect(s.cells).toHaveLength(32)
      expect(s.free).toBe(s.cells.filter((c) => c === 0).length)
      expect(s.shared).toBe(s.cells.filter((c) => c === 100).length)
      expect(s.free + s.cells.filter((c) => c > 0).length).toBe(32)
    }
  })

  test('the traffic is fork-heavy: the four ops are drawn in the stated proportions', () => {
    expect(CHURN.allocatePct + CHURN.appendPct + CHURN.forkPct + CHURN.freePct).toBe(100)
    expect(CHURN.forkPct).toBeGreaterThan(CHURN.allocatePct)
    expect(CHURN.forkPct).toBeGreaterThan(CHURN.appendPct)
    expect(CHURN.forkPct).toBeGreaterThan(CHURN.freePct)
  })

  test('samples start at op 0 on an empty pool and end at the last op', () => {
    expect(ref.samples[0]).toMatchObject({ op: 0, free: 32, shared: 0, waste: 0 })
    expect(ref.samples[ref.samples.length - 1].op).toBe(CHURN.ops)
    expect(ref.samples.length).toBe(CHURN.ops / CHURN.every + 1)
  })

  test('the Run step’s value is the peak of shared blocks, which the strip really shows', () => {
    const result = RUN_SPEC.run(RUN_SPEC.reference)
    expect(result.value).toBe(ref.peakShared)
    expect(result.truth).toBe(32)
    expect(Math.max(...ref.samples.map((s) => s.shared))).toBeLessThanOrEqual(ref.peakShared)
    expect(ref.peakShared).toBeGreaterThan(0)
    expect(ref.peakShared).toBeLessThan(32)
    expect(result.truth).toBeGreaterThanOrEqual(result.value)
    expect(result.frames).toHaveLength(ref.samples.length)
  })

  test('the numbers agree with a RefBlockManager driven by hand through the same ops', () => {
    const m = new RefBlockManager(32, 16)
    expect(m.allocate(0, 40)).toBe(true)
    expect(m.fork(0, 1)).toBe(true)
    expect(m.freeBlocks).toBe(29)
    expect(m.refcountMultiset().filter((r) => r > 1)).toHaveLength(3)
    expect(m.append(1, 1)).toBe(true) // a shared partial tail: one copy
    expect(m.freeBlocks).toBe(28)
    expect(m.refcountMultiset().filter((r) => r > 1)).toHaveLength(2)
  })

  test('each Modify dial is a whole config for the same pool and seed, measured in empty token slots', () => {
    const dials = RUN_SPEC.modify?.dials ?? []
    expect(dials.map((d) => d.id)).toEqual(['bs32', 'bs64'])
    for (const d of dials) {
      expect(d.config.seed).toBe(PRACTICE_SEED)
      expect(d.config.report).toBe('waste')
      const result = RUN_SPEC.run(d.config)
      expect(result.clean).toBe(true)
      expect(result.value).toBeLessThanOrEqual(result.truth)
      expect(result.summary).toContain('token slots')
    }
  })

  test('internal waste grows with the block size: about double for each doubling, on the practice seed and on average', () => {
    const waste = (blockSize: number, seed = PRACTICE_SEED) => runChurn({ seed, blockSize, report: 'waste' }).endWaste
    const [w16, w32, w64] = [waste(16), waste(32), waste(64)]
    expect(w32 / w16).toBeGreaterThan(1.7)
    expect(w32 / w16).toBeLessThan(2.3)
    expect(w64 / w32).toBeGreaterThan(1.7)
    expect(w64 / w32).toBeLessThan(2.5)
    let a = 0
    let b = 0
    for (let s = 1; s <= 40; s++) {
      a += waste(16, s * 7919)
      b += waste(32, s * 7919)
    }
    expect(b / a).toBeGreaterThan(1.6)
    expect(b / a).toBeLessThan(2.5)
  })

  test('the reference run is not the gauntlet, and says so in its disclaimer and caption', () => {
    expect(RUN_SPEC.disclaimer).toContain('not the gauntlet')
    expect(RUN_SPEC.title(RUN_SPEC.reference)).toContain('Fleet')
    expect(describeRun(ref)).toContain('shared')
    expect(describeRun(ref)).toContain('Free plus referenced blocks equalled the pool')
  })

  test('the Run step writes one observation for the reference config: the peak of the pool, no KCs', () => {
    const r = runResponse(ref)
    expect(r.ref).toBe(primmRef(RUN_ITEM.id))
    expect(r.data).toMatchObject({ kcs: [], value: ref.peakShared, truth: 32 })
  })
})

describe('items (§13.2): ids, refs, tags, whys', () => {
  test('ids are item:lab02.primm.* and unique, and the spec’s three Investigate prompts are all there', () => {
    const ids = PRIMM_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [...ids, RUN_ITEM.id]) {
      expect(id.startsWith('lab02.primm.')).toBe(true)
      expect(refMatchesKind('item', primmRef(id))).toBe(true)
    }
    expect(ids).toEqual(expect.arrayContaining(['lab02.primm.p1', 'lab02.primm.p2', 'lab02.primm.i1', 'lab02.primm.m1']))
    const investigate = PRIMM_ITEMS.filter((i) => i.step === 'investigate')
    expect(investigate.length).toBeGreaterThanOrEqual(3)
    expect(investigate.length).toBeLessThanOrEqual(5)
  })

  test('Predict is the spec’s pair: a Fermi estimate of shared blocks and a choice on the first check to fail', () => {
    const predict = PRIMM_ITEMS.filter((i) => i.step === 'predict')
    expect(predict.map((i) => i.kind).sort()).toEqual(['choice', 'estimate'])
    const estimate = predict.find((i): i is NumberPrimm => i.kind === 'estimate')
    expect(estimate?.unit).toBe('blocks')
    expect(estimate?.prompt).toContain(`${CHURN.numBlocks} blocks of ${CHURN.blockSize} tokens`)
    expect(estimate?.prompt).toContain(`${CHURN.forkPct} fork`)
  })

  test('the estimate is graded against the reference run, and the reference lies inside its window', () => {
    const p1 = PRIMM_ITEMS.find((i) => i.id === 'lab02.primm.p1') as NumberPrimm
    const truth = RUN_SPEC.run(RUN_SPEC.reference).value
    expect(gradeNumber(p1, truth, truth).ok).toBe(true)
    expect(gradeNumber(p1, Math.round(truth * 1.4), truth).ok).toBe(true)
    expect(gradeNumber(p1, truth * 3, truth).ok).toBe(false)
    expect(gradeNumber(p1, 0, truth).ok).toBe(false)
  })

  test('the Modify item is one estimate, and its prompt quotes the reference run’s own waste', () => {
    const modify = PRIMM_ITEMS.filter((i) => i.step === 'modify')
    expect(modify).toHaveLength(1)
    const m1 = modify[0] as NumberPrimm
    expect(m1.kind).toBe('estimate')
    expect(m1.unit).toBe('token slots')
    expect(m1.prompt).toContain(`${runChurn({ ...REFERENCE, report: 'waste' }).endWaste} token slots`)
    expect(m1.kcs).toContain(KC.internalFrag)
  })

  test('every item is tagged with known KCs and a nominal time', () => {
    for (const i of PRIMM_ITEMS) {
      const kcs = i.kind === 'choice' ? i.item.kcs : i.kcs
      expect(kcs.length).toBeGreaterThan(0)
      for (const k of kcs) expect(kcValues.has(k)).toBe(true)
      expect(i.nsec).toBeGreaterThan(0)
    }
  })

  test('every multiple-choice item has four options, one key and a why for each option', () => {
    expect(PRIMM_MC_ITEMS.length).toBeGreaterThanOrEqual(4)
    for (const { id, q } of PRIMM_MC_ITEMS) {
      expect(q.options.length).toBe(4)
      expect(q.correct.length).toBe(1)
      expect(q.why?.length).toBe(q.options.length)
      for (const w of q.why ?? []) expect(w.trim().length).toBeGreaterThan(20)
      expect(new Set(q.options).size).toBe(q.options.length)
      expect(q.kcs?.length).toBeGreaterThan(0)
      expect(id.startsWith('lab02.primm.')).toBe(true)
    }
  })

  test('PRIMM_MC_ITEMS is exactly the bundle’s choice items, the pool verify-items reads', () => {
    expect(PRIMM_MC_ITEMS).toEqual(bundle.primm.items.flatMap((i) => (i.kind === 'choice' ? [i.item] : [])))
  })

  test('the answer keys are not all in one position', () => {
    const keys = PRIMM_MC_ITEMS.map((i) => i.q.correct[0])
    expect(new Set(keys).size).toBeGreaterThan(2)
  })

  test('the numeric items are the arithmetic they say they are, and no lure is the answer', () => {
    const i1 = PRIMM_ITEMS.find((i) => i.id === 'lab02.primm.i1') as NumberPrimm
    expect(i1.truth).toBe(Math.floor(37 / 16))
    const i3 = PRIMM_ITEMS.find((i) => i.id === 'lab02.primm.i3') as NumberPrimm
    const m = new RefBlockManager(8, 16)
    expect(m.allocate(1, 40)).toBe(true)
    expect(m.fork(1, 2)).toBe(true)
    expect(i3.truth).toBe(2)
    for (const n of [i1, i3]) {
      expect(n.lures?.length).toBeGreaterThanOrEqual(2)
      for (const lure of n.lures ?? []) expect(lure.value).not.toBe(n.truth)
    }
  })

  test('the full-tail item matches the manager: a shared full tail costs one new block and no copy', () => {
    const m = new RefBlockManager(8, 16)
    m.allocate(1, 32)
    m.fork(1, 2)
    const multiset = m.refcountMultiset()
    expect(multiset).toEqual([2, 2])
    expect(m.append(2, 1)).toBe(true)
    expect(m.freeBlocks).toBe(8 - 2 - 1)
    expect(m.refcountMultiset()).toEqual([1, 2, 2])
  })

  test('the conservation message adds up to more than the pool, which is a double free', () => {
    const q = PRIMM_MC_ITEMS.find((i) => i.id === 'lab02.primm.i5')?.q
    expect(q?.q).toContain('3 free + 62 referenced')
    expect(3 + 62).toBeGreaterThan(64)
    expect(q?.options[q.correct[0]]).toContain('in the pool and in a table')
  })
})

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

  test('numeric: exact is right and each lure names its mistake', () => {
    for (const id of ['lab02.primm.i1', 'lab02.primm.i3']) {
      const n = PRIMM_ITEMS.find((i) => i.id === id) as NumberPrimm
      expect(gradeNumber(n, n.truth ?? -1, n.truth ?? -1).ok).toBe(true)
      for (const lure of n.lures ?? []) {
        const g = gradeNumber(n, lure.value, n.truth ?? -1)
        expect(g.ok).toBe(false)
        expect(g.miss).toBe(lure.miss)
        expect(g.feedback).toContain(lure.message)
      }
    }
  })

  test('an answer is one practice item event, tagged with the item’s KCs', () => {
    const i = PRIMM_ITEMS.find((x) => x.id === 'lab02.primm.p2')
    if (i === undefined || i.kind !== 'choice') throw new Error('p2 is a choice')
    const r = itemResponse({ item: i, grade: gradeChoice(i, i.item.q.correct[0]), pick: i.item.q.correct[0] })
    expect(r.ref).toBe('item:lab02.primm.p2')
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ src: 'practice', kcs: [KC.blockRefcounts] })
  })
})

/**
 * The blind-strategy gates of verify:items, on this pool. Wave 1's script judges lab 01's items only; 2a-18's
 * version finds every `src/data/forge/*` pool by `readdir`, so these are the checks lab 02 will meet there:
 * the key is never strictly the longest option, no key/distractor length ratio above 1.3, no blind strategy passes
 * the pool, and no single-feature strategy (length rank, lexical, surface) beats chance by 15 points.
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

  test('no single-feature strategy beats chance by 15 points on the pool, and no feature isolates a key', () => {
    expect(poolCueFailures('lab02.primm', items)).toEqual([])
  })
})

describe('the hint ladder (§13.2): R0 to R4 for the six required checks', () => {
  const h2s = new Map<string, Set<string>>()
  for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))
  const libRs = read('labs/kv-block-manager/src/lib.rs')

  test('it covers the six required checks in the order the module lists them, and not the optional one', () => {
    expect([...LADDER_CHECK_IDS]).toEqual(required)
    expect(bundle.ladder.map((c) => c.checkId)).toEqual(required)
    expect(Object.keys(LADDER).sort()).toEqual([...required].sort())
    expect(required).toHaveLength(6)
  })

  test('verify:mentor’s lint finds nothing: limits, real H2 anchors, real check functions, R3 not Rust', () => {
    expect(lintBundle(bundle, { required, libRs, h2s })).toEqual([])
  })

  test('R2 names the check’s function in lib.rs, and the TODO file that holds the answer', () => {
    for (const c of bundle.ladder) {
      expect(c.r2.fn).toBe(`check_${c.checkId}`)
      expect(c.r2.text).toContain('lib.rs')
      expect(libRs).toContain(`pub fn ${c.r2.fn}(`)
    }
  })

  test('R1 links a lesson of this lab’s track or the OS lesson the idea comes from', () => {
    for (const c of bundle.ladder) expect(['t5.l5', 't2.l2']).toContain(c.r1.link.lessonId)
  })

  test('each rung is about this lab: no allocator wording from lab 01 leaks in', () => {
    for (const c of bundle.ladder) {
      const all = [c.r0.prompt, ...c.r0.ideas, c.r1.text, c.r2.text, c.r3, c.r4].join(' ')
      expect(all).not.toMatch(/allocator\.rs|first-fit|coalesc/i)
      expect(all).not.toContain('_solutions')
    }
  })

  test('acks live under hint:kv-block-manager/, and a rung acked there comes back open', () => {
    expect(hintRef('cow', 'R2')).toBe('hint:kv-block-manager/cow#R2')
    const state = restoreState({ [hintRef('paging', 'R0')]: '2026-10-13T00:00:00.000Z' }, 'paging', { red: 1, now: Date.parse('2026-10-13T00:01:00.000Z') })
    expect(state.opened.R0).toBeDefined()
    expect(state.opened.R1).toBeUndefined()
  })

  test('the panel draws a card for each of the six red checks, and labels its Ask-a-human post "[lab 02]"', () => {
    const rows: CheckResult[] = required.map((id) => ({ id, label: id, status: 'fail', msg: `${id} says no` }))
    const report: LabRunReport = { lab: LAB_ID, reference: false, abi: 2, version: 2, checks: rows, seeds: 'fresh', ms: 5 }
    const acks = { [hintRef('cow', 'R0')]: '2026-10-13T00:00:00.000Z' }
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(HintLadderView, { bundle, reports: [report], acks, onAck: () => {}, now: () => 0 })),
    )
    for (const id of required) expect(html).toContain(`data-check="${id}"`)
    expect(html).not.toContain('Bottom-out')
    const href = /href="(https:\/\/github\.com\/[^"]*discussions\/new[^"]*)"/.exec(html)?.[1]
    expect(new URL((href ?? '').replace(/&amp;/g, '&')).searchParams.get('title')).toMatch(/^\[lab 02\] cow: /)
  })
})

describe('Prove-it v1 (§13.2): six questions, three drawn', () => {
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

  test('the spec’s example question is in the pool', () => {
    expect(PROVE_QUESTIONS.some((q) => q.prompt === 'What does your `free` do to a block another sequence still shares?')).toBe(true)
  })

  test('the draw is three distinct questions of this pool, and a retry takes the ones not yet served', () => {
    const first = pickQuestions([], 11)
    expect(first).toHaveLength(3)
    expect(new Set(first.map((q) => q.id)).size).toBe(3)
    const second = pickQuestions([{ at: '2026-10-13T00:00:00.000Z', qids: first.map((q) => q.id), score: 1 }], 11)
    expect(second.every((q) => !first.some((f) => f.id === q.id))).toBe(true)
  })

  test('the follow-up ref and the ledger payload carry lab 02’s id', () => {
    expect(PROVE_LAB_ID).toBe('kv-block-manager')
    expect(followUpRef('cow-trigger')).toBe('item:lab02.prove.cow-trigger')
    expect(refMatchesKind('item', followUpRef('cow-trigger'))).toBe(true)
    const qs = pickQuestions([], 5)
    const result = buildProveResult(
      qs,
      qs.map(() => ({ answer: 'word '.repeat(20), revealed: true, self: 1 as const })),
    )
    expect(result?.labId).toBe('kv-block-manager')
    expect(result?.data.qids).toEqual(qs.map((q) => q.id))
  })

  test('the panel draws its questions from the bundle, with none of lab 01’s', () => {
    const html = renderToString(createElement(ProveIt, { bundle, history: [], now: 0, seed: 3 })).replaceAll('<!-- -->', '')
    expect(html).toContain('data-prove="active"')
    const shown = [...html.matchAll(/data-qid="([a-z-]+)"/g)].map((m) => m[1])
    expect(shown).toHaveLength(1)
    expect(PROVE_QUESTIONS.map((q) => q.id)).toContain(shown[0])
    expect(html).not.toContain('allocator')
  })
})

describe('the bundle', () => {
  test('the registry finds it by directory name and loads the same object', async () => {
    expect(await forgeBundleIds()).toContain('kv-block-manager')
    expect(await loadForgeBundle('kv-block-manager')).toBe(bundle)
    expect(await findForgeBundle('kv-block-manager')).toBe(bundle)
  })

  test('it is lab 02, labelled "[lab 02]", with no walkthrough (the ladder ends at R4)', () => {
    expect(bundle.labId).toBe(LAB_ID)
    expect(bundle.labId).toBe('kv-block-manager')
    expect(bundle.discussionsLabel).toBe(DISCUSSIONS_LABEL)
    expect(bundle.discussionsLabel).toBe('[lab 02]')
    expect(bundle.walkthrough).toBeUndefined()
    expect(bundle.prove).toHaveLength(6)
  })

  test('the generic panels render it: PRIMM steps, the reference strip, the stage list', () => {
    const predict = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks, passed: new Set<string>(), initial: 'predict', title: lab.title }))
    expect(predict).toContain(`aria-label="${lab.title}, in five steps"`)
    expect(predict).toContain('data-item="lab02.primm.p1"')
    expect(predict).toContain('data-item="lab02.primm.p2"')
    const modify = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks, passed: new Set<string>(), initial: 'modify' }))
    expect(modify).toContain('block size 16 becomes 32')
    const strip = renderToStaticMarkup(createElement(ReferenceRun, { bundle, config: RUN_SPEC.reference }))
    expect(strip).toContain('data-reference-run="kv-block-manager"')
    expect(strip).toContain('role="img"')
    const stages = renderToStaticMarkup(createElement(StagePanel, { bundle, checks, passed: new Set<string>() }))
    expect(stages).toContain('Paging')
    expect(stages).toContain('Copy-on-write')
  })

  test('a locked Modify prediction reads in the item’s own unit, not in ops', () => {
    const src = read('src/components/forge/PrimmPanel.tsx')
    expect(src).toContain("m1.unit === 'ops'")
  })
})
