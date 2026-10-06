import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrimmPanel } from '../../src/components/forge/PrimmPanel'
import { ReferenceRun } from '../../src/components/forge/ReferenceRun'
import { KC } from '../../src/data/kc/ids'
import { FORGE_LABS } from '../../src/data/labs'
import {
  BUMP,
  CHURN,
  PRACTICE_SEED,
  PRIMM_ITEMS,
  PRIMM_MC_ITEMS,
  PRIMM_STEPS,
  REFERENCE,
  STAGES,
  attemptsToGreen,
  currentStage,
  describeRun,
  gradeChoice,
  gradeNumber,
  greenStage,
  heapOptions,
  itemResponse,
  makeChurnTrace,
  mergedGap,
  predictGraded,
  primmRef,
  runChurn,
  runResponse,
  stageRows,
  type NumberPrimm,
} from '../../src/data/forge/rust-allocator/primm'
import { createHeap, viewOf } from '../../src/lib/world/heap'
import { isKnownKind, refMatchesKind } from '../../src/lib/ledger/refs'

const lab = FORGE_LABS.find((l) => l.id === 'rust-allocator')
if (lab === undefined) throw new Error('lab 01 is missing from labs.ts')
const checks = lab.checks
const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const kcValues = new Set<string>(Object.values(KC))

describe('stages: labs.ts, allocator.rs and the harness agree (§13.1)', () => {
  test('labs.ts puts the six checks in the spec stages', () => {
    const byStage = (n: number) => checks.filter((c) => c.stage === n).map((c) => c.id)
    expect(byStage(1)).toEqual(['boot'])
    expect(byStage(2).sort()).toEqual(['align', 'no_overlap'])
    expect(byStage(3)).toEqual(['reuse'])
    expect(byStage(4).sort()).toEqual(['coalesce', 'fragmentation'])
  })

  test('every check carries known KCs', () => {
    for (const c of checks) {
      expect(c.kcs?.length ?? 0).toBeGreaterThan(0)
      for (const k of c.kcs ?? []) expect(kcValues.has(k)).toBe(true)
    }
  })

  test('the harness lists the same stage for each check', () => {
    const lib = read('labs/rust-allocator/src/lib.rs')
    for (const c of checks) {
      const m = new RegExp(`id: "${c.id}",[^}]*?stage: (\\d)`).exec(lib)
      expect(m?.[1]).toBe(String(c.stage))
    }
  })

  test('allocator.rs marks each stage in the code with its checks and minutes', () => {
    const src = read('labs/rust-allocator/src/allocator.rs')
    for (const stage of STAGES) {
      const marker = new RegExp(`^\\s*// STAGE ${stage.n} · ([a-z_, ]+) · ≈ (\\d+) min`, 'm').exec(src)
      const expected = checks.filter((c) => c.stage === stage.n).map((c) => c.id)
      expect(marker?.[1].split(', ').sort()).toEqual(expected.sort())
      expect(Number(marker?.[2])).toBe(stage.minutes)
    }
  })

  test('the signatures did not change', () => {
    const src = read('labs/rust-allocator/src/allocator.rs')
    expect(src).toContain('pub fn new(capacity: usize) -> Self')
    expect(src).toContain('pub fn alloc(&mut self, size: usize, align: usize) -> Option<usize>')
    expect(src).toContain('pub fn free(&mut self, offset: usize, size: usize)')
  })

  test('every stage is at most 25 minutes, and stage 1 is the two-minute win', () => {
    expect(STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4])
    for (const s of STAGES) expect(s.minutes).toBeLessThanOrEqual(25)
    expect(STAGES[0].minutes).toBe(2)
  })

  test('the brief and the page walk the PRIMM steps in order', () => {
    expect(PRIMM_STEPS.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
    expect(lab.brief.join(' ')).toContain('stage 1')
  })
})

describe('stage rows and attempts-to-green', () => {
  const ids = (...a: string[]) => new Set(a)

  test('nothing passed: stage 1 is next, nothing is green', () => {
    const rows = stageRows(checks, ids())
    expect(rows.every((r) => !r.green)).toBe(true)
    expect(currentStage(rows)?.n).toBe(1)
    expect(greenStage(rows)).toBe(0)
  })

  test('a stage is green only when every one of its checks passed', () => {
    const rows = stageRows(checks, ids('boot', 'align'))
    expect(rows.map((r) => r.green)).toEqual([true, false, false, false])
    expect(currentStage(rows)?.n).toBe(2)
    expect(greenStage(rows)).toBe(1)
  })

  test('greenStage stops at the first gap: stage 4 green without stage 3 is stage 2', () => {
    const rows = stageRows(checks, ids('boot', 'align', 'no_overlap', 'coalesce', 'fragmentation'))
    expect(rows.map((r) => r.green)).toEqual([true, true, false, true])
    expect(greenStage(rows)).toBe(2)
    expect(currentStage(rows)?.n).toBe(3)
  })

  test('all six passed: four green stages, nothing next', () => {
    const rows = stageRows(checks, ids('boot', 'align', 'no_overlap', 'reuse', 'coalesce', 'fragmentation'))
    expect(greenStage(rows)).toBe(4)
    expect(currentStage(rows)).toBeNull()
  })

  test('an optional check does not count toward its stage', () => {
    const withOptional = [...checks, { id: 'profile', label: 'profile', stage: 1, optional: true }]
    expect(stageRows(withOptional, ids('boot'))[0].checks.map((c) => c.id)).toEqual(['boot'])
  })

  test('attempts-to-green counts runs from the run after the previous stage went green', () => {
    const runs = [[], ['boot'], ['boot'], ['boot', 'align', 'no_overlap'], ['boot', 'align', 'no_overlap', 'reuse']]
    expect(attemptsToGreen(runs, checks)).toEqual([2, 2, 1, null])
  })

  test('a stage that came green on the same run as the one before counts 0', () => {
    const runs = [['boot', 'align', 'no_overlap', 'reuse']]
    expect(attemptsToGreen(runs, checks)).toEqual([1, 0, 0, null])
  })

  test('no runs: nothing has an attempt count', () => {
    expect(attemptsToGreen([], checks)).toEqual([null, null, null, null])
  })
})

describe('the reference run', () => {
  const ref = runChurn(REFERENCE)
  const bump = runChurn(BUMP)

  test('the trace is deterministic and own-seeded', () => {
    const a = makeChurnTrace(PRACTICE_SEED, 75)
    const b = makeChurnTrace(PRACTICE_SEED, 75)
    expect(a).toEqual(b)
    expect(makeChurnTrace(PRACTICE_SEED + 1, 75).ops).not.toEqual(a.ops)
    expect(a.source).toContain('not check 6')
    expect(a.capacity).toBe(1 << 20)
  })

  test('the trace has check 6 request sizes and fills to the occupancy before it churns', () => {
    const trace = makeChurnTrace(PRACTICE_SEED, 75)
    let live = 0
    let maxLive = 0
    const sizes = new Map<number, number>()
    for (const op of trace.ops) {
      if (op.op === 'alloc') {
        expect(op.size % CHURN.grain).toBe(0)
        expect(op.size).toBeGreaterThanOrEqual(16)
        expect(op.size).toBeLessThanOrEqual(32 * 1024)
        expect(op.align).toBe(CHURN.grain)
        sizes.set(op.id, op.size)
        live += op.size
      } else {
        live -= sizes.get(op.id) ?? 0
      }
      maxLive = Math.max(maxLive, live)
    }
    const target = Math.floor((CHURN.capacity * 75) / 100)
    expect(maxLive).toBeGreaterThanOrEqual(target)
    expect(maxLive).toBeLessThan(target + 32 * 1024)
    expect(trace.ops.length).toBeGreaterThan(CHURN.churnOps)
  })

  test('first-fit with coalescing serves the whole churn, as check 6 requires', () => {
    expect(ref.clean).toBe(true)
    expect(ref.survived).toBe(ref.total)
    expect(describeRun(ref)).toContain('all')
  })

  test('a bump allocator fails early, a refusal with merged space free', () => {
    expect(bump.clean).toBe(false)
    expect(bump.survived).toBeLessThan(ref.total / 2)
    expect(bump.survived).toBeGreaterThan(CHURN.capacity / (32 * 1024)) // not on the first request
    expect(bump.failure).toContain('refused')
    expect(describeRun(bump)).toContain('check 6 would fail it')
  })

  test('first-fit without coalescing fails too, later than bump', () => {
    const run = runChurn({ ...REFERENCE, coalesce: false })
    expect(run.clean).toBe(false)
    expect(run.survived).toBeGreaterThan(bump.survived)
    expect(run.survived).toBeLessThan(run.total)
  })

  test('the Modify dials: worst-fit and the two occupancies stay correct', () => {
    expect(runChurn({ ...REFERENCE, fit: 'worst' }).clean).toBe(true)
    expect(runChurn({ ...REFERENCE, occupancyPct: 45 }).clean).toBe(true)
    expect(runChurn({ ...REFERENCE, occupancyPct: 90 }).clean).toBe(true)
  })

  test('a bump allocator never coalesces whatever the config says', () => {
    expect(heapOptions({ ...BUMP, coalesce: true }).coalesce).toBe(false)
  })

  test('samples start at op 0 and end at the last op, with a live strip that fits the heap', () => {
    expect(ref.samples[0].op).toBe(0)
    expect(ref.samples[0].liveBytes).toBe(0)
    expect(ref.samples[ref.samples.length - 1].op).toBe(ref.total)
    for (const s of ref.samples) {
      expect(s.map.length).toBe(CHURN.buckets)
      expect(s.liveBytes).toBeLessThanOrEqual(CHURN.capacity)
      expect(s.largestFree).toBeLessThanOrEqual(CHURN.capacity - s.liveBytes)
      expect(s.gap).toBeGreaterThanOrEqual(s.largestFree)
    }
    expect(bump.samples[bump.samples.length - 1].op).toBe(bump.survived)
  })

  test('mergedGap spans adjacent free runs; the empty heap is one gap', () => {
    const empty = viewOf(createHeap(heapOptions(REFERENCE)))
    expect(mergedGap(empty)).toEqual({ bytes: CHURN.capacity, runs: 1 })
  })

  test('the run is deterministic', () => {
    expect(runChurn(REFERENCE)).toEqual(ref)
  })
})

describe('items (§13.1): ids, refs, tags, whys', () => {
  test('ids are item:lab01.primm.* and unique', () => {
    const ids = PRIMM_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id.startsWith('lab01.primm.')).toBe(true)
      expect(refMatchesKind('item', primmRef(id))).toBe(true)
    }
  })

  test('the spec ids exist: p1-p2, i1-i5 (3 to 5 investigate items), m1', () => {
    const ids = PRIMM_ITEMS.map((i) => i.id.replace('lab01.primm.', ''))
    expect(ids).toEqual(expect.arrayContaining(['p1', 'p2', 'i1', 'i2', 'i3', 'm1']))
    const investigate = PRIMM_ITEMS.filter((i) => i.step === 'investigate')
    expect(investigate.length).toBeGreaterThanOrEqual(3)
    expect(investigate.length).toBeLessThanOrEqual(5)
  })

  test('Predict has an estimate and a choice', () => {
    const predict = PRIMM_ITEMS.filter((i) => i.step === 'predict').map((i) => i.kind)
    expect(predict.sort()).toEqual(['choice', 'estimate'])
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
      expect(id.startsWith('lab01.primm.')).toBe(true)
    }
  })

  test('the answer keys are not all in one position', () => {
    const keys = PRIMM_MC_ITEMS.map((i) => i.q.correct[0])
    expect(new Set(keys).size).toBeGreaterThan(1)
  })

  test('the investigate numeric item is align_up(13, 8)', () => {
    const i2 = PRIMM_ITEMS.find((i) => i.id === 'lab01.primm.i2') as NumberPrimm
    const alignUp = (off: number, align: number) => Math.floor((off + align - 1) / align) * align
    expect(i2.truth).toBe(alignUp(13, 8))
    for (const lure of i2.lures ?? []) expect(lure.value).not.toBe(i2.truth)
  })
})

describe('grading', () => {
  const mc = PRIMM_ITEMS.filter((i) => i.kind === 'choice')

  test('the key passes and each other option fails with its own why first', () => {
    for (const i of mc) {
      if (i.kind !== 'choice') continue
      const { q } = i.item
      for (let pick = 0; pick < q.options.length; pick++) {
        const g = gradeChoice(i, pick)
        expect(g.ok).toBe(q.correct.includes(pick))
        expect(g.score).toBe(g.ok ? 1 : 0)
        expect(g.feedback.startsWith(q.why?.[pick] ?? '')).toBe(true)
      }
    }
  })

  test('numeric: exact is right, a lure names the mistake, anything else is wrong', () => {
    const i2 = PRIMM_ITEMS.find((i) => i.id === 'lab01.primm.i2') as NumberPrimm
    expect(gradeNumber(i2, 16, 16).ok).toBe(true)
    const lure = i2.lures?.[0]
    if (lure === undefined) throw new Error('i2 has no lures')
    const g = gradeNumber(i2, lure.value, 16)
    expect(g.ok).toBe(false)
    expect(g.miss).toBe(lure.miss)
    expect(g.feedback).toContain(lure.message)
    const other = gradeNumber(i2, 17, 16)
    expect(other.ok).toBe(false)
    expect(other.miss).toBeUndefined()
  })

  test('estimate: right inside the factor either way, and the score falls with the log error', () => {
    const p1 = PRIMM_ITEMS.find((i) => i.id === 'lab01.primm.p1') as NumberPrimm
    const truth = runChurn(BUMP).survived
    expect(gradeNumber(p1, truth, truth).score).toBe(1)
    expect(gradeNumber(p1, Math.round(truth * 1.4), truth).ok).toBe(true)
    expect(gradeNumber(p1, Math.round(truth / 1.4), truth).ok).toBe(true)
    const off = gradeNumber(p1, truth * 3, truth)
    expect(off.ok).toBe(false)
    expect(off.score).toBeLessThan(1)
    expect(off.score).toBeGreaterThan(gradeNumber(p1, truth * 30, truth).score)
    expect(gradeNumber(p1, 0, truth).score).toBe(0)
    expect(gradeNumber(p1, 0, truth).feedback).toContain('cannot be right')
  })
})

describe('ledger responses (item:lab01.primm.*)', () => {
  test('a choice answer writes pick by authored index, with kcs and nsec', () => {
    const i = PRIMM_ITEMS.find((x) => x.id === 'lab01.primm.p2')
    if (i === undefined || i.kind !== 'choice') throw new Error('p2 missing')
    const r = itemResponse({ item: i, grade: gradeChoice(i, 2), pick: 2, ms: 4200 })
    expect(r.kind).toBe('item')
    expect(r.ref).toBe('item:lab01.primm.p2')
    expect(r.ok).toBe(true)
    expect(r.provenance).toBe('practice')
    expect(r.ms).toBe(4200)
    expect(r.data).toMatchObject({ src: 'practice', pick: [2], nsec: i.nsec })
    expect((r.data as { kcs?: string[] }).kcs).toEqual(i.item.kcs)
  })

  test('a number answer writes value and truth; a lure writes miss', () => {
    const i2 = PRIMM_ITEMS.find((x) => x.id === 'lab01.primm.i2') as NumberPrimm
    const lure = i2.lures?.[0]
    if (lure === undefined) throw new Error('no lure')
    const r = itemResponse({ item: i2, grade: gradeNumber(i2, lure.value, 16), value: lure.value, truth: 16 })
    expect(r.ok).toBe(false)
    expect(r.score).toBe(0)
    expect(r.data).toMatchObject({ value: lure.value, truth: 16, miss: lure.miss })
    expect((r.data as { pick?: number[] }).pick).toBeUndefined()
  })

  test('the revision changes when the text changes, and not between calls', () => {
    const a = PRIMM_ITEMS[0]
    const b = PRIMM_ITEMS[1]
    const ra = itemResponse({ item: a, grade: { ok: true, score: 1, feedback: '' }, value: 1, truth: 1 })
    expect(itemResponse({ item: a, grade: { ok: true, score: 1, feedback: '' }, value: 1, truth: 1 }).rev).toBe(ra.rev)
    expect(itemResponse({ item: b, grade: { ok: true, score: 1, feedback: '' }, pick: 0 }).rev).not.toBe(ra.rev)
  })

  test('the Run step writes what the run observed, as an item the ledger accepts', () => {
    const r = runResponse(runChurn(BUMP), 1500)
    expect(r.ref).toBe('item:lab01.primm.r1')
    expect(isKnownKind(r.kind)).toBe(true)
    expect(refMatchesKind(r.kind, r.ref)).toBe(true)
    expect(r.data).toMatchObject({ src: 'practice', value: runChurn(BUMP).survived, truth: runChurn(BUMP).total })
    expect(r.ms).toBe(1500)
  })

  test('the Run step is an observation, not mastery evidence: no KCs', () => {
    const data = runResponse(runChurn(REFERENCE)).data as { kcs?: string[] }
    expect(data.kcs).toEqual([])
    // Every graded item still names the KCs it is evidence for.
    for (const i of PRIMM_ITEMS) expect((itemResponse({ item: i, grade: { ok: true, score: 1, feedback: '' } }).data as { kcs: string[] }).kcs.length).toBeGreaterThan(0)
  })
})

describe('the peek (show me anyway) withholds credit', () => {
  test('after a peek the Predict step takes no new graded answer; one given before it stands', () => {
    expect(predictGraded(false, false)).toBe(true)
    expect(predictGraded(true, false)).toBe(false)
    expect(predictGraded(true, true)).toBe(true)
  })

  test('the button no longer promises something the page does not do', () => {
    expect(read('src/components/forge/PrimmPanel.tsx')).not.toContain('no credit for predicting')
  })
})

describe('item wording', () => {
  test('p2 says stage order, and i5 names every seeded check', () => {
    const p2 = PRIMM_ITEMS.find((i) => i.id === 'lab01.primm.p2')
    const i5 = PRIMM_ITEMS.find((i) => i.id === 'lab01.primm.i5')
    if (p2?.kind !== 'choice' || i5?.kind !== 'choice') throw new Error('p2 or i5 missing')
    expect(p2.item.q.q).toContain('in stage order')
    // The harness seeds these three (allocator.rs header); the item must not name fewer.
    for (const id of ['align', 'no_overlap', 'fragmentation']) {
      expect(checks.some((c) => c.id === id)).toBe(true)
      expect(i5.item.q.q).toContain(`\`${id}\``)
    }
  })
})

/** Server renders only: there is no DOM in this suite, so interaction (focus after submit, the peek click) is checked in a browser. */
describe('the panel as rendered (ARIA and focus structure)', () => {
  const panel = (initial: 'predict' | 'run' | 'investigate' | 'modify' | 'make') =>
    renderToStaticMarkup(createElement(PrimmPanel, { checks, passed: new Set<string>(), initial }))

  test('every graded item mounts an empty live region the verdict is written into, and no result yet', () => {
    for (const step of ['predict', 'investigate'] as const) {
      const html = panel(step)
      const items = html.match(/data-item="lab01\.primm\.[a-z0-9]+"/g) ?? []
      const regions = html.match(/<p role="status" class="sr-only" data-verdict="true"><\/p>/g) ?? []
      expect(items.length).toBeGreaterThan(0)
      expect(regions.length).toBe(items.length)
      expect(html).not.toContain('data-feedback')
    }
  })

  test('the step lead-in is a focus target, and the Predict step is gated before the Run step', () => {
    expect(panel('predict')).toContain('data-step-lead')
    expect(panel('predict')).toMatch(/<p[^>]*tabindex="-1"[^>]*data-step-lead/)
    const gate = panel('run')
    expect(gate).toContain('Go predict')
    expect(gate).toContain('Show me anyway')
    expect(gate).not.toContain('data-reference-run')
  })

  test('the reference run has one persistent button and a status region that starts empty', () => {
    const html = renderToStaticMarkup(createElement(ReferenceRun, { config: REFERENCE, title: 'Reference' }))
    expect(html.match(/<button/g)?.length).toBe(1)
    expect(html).toContain('data-run-button="idle"')
    expect(html).toMatch(/<p role="status" aria-live="polite"[^>]*data-caption="true"><\/p>/)
  })
})
