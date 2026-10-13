/**
 * Lab 03 (bpe-tokenizer) as a Forge bundle (docs/specs/wave-2.md §13.3; task 2c-10): its stages agree with labs.ts and
 * tokenizer.rs, the reference run is the page's own BPE, every PRIMM item's answer is true of the harness, the ladder
 * passes lint-mentor, the walkthrough replays the reference, and Prove-it has six questions. The items' answers are
 * checked against a small TypeScript copy of the harness's six checks run on the mutants calibration.json names, so a key
 * that a real mistake would not produce fails here. There is no DOM in this suite: interaction is checked in a browser.
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
import { findForgeBundle, forgeBundleIds } from '../../src/data/forge'
import bundle from '../../src/data/forge/bpe-tokenizer'
import { LADDER, LADDER_CHECK_IDS, LAB_ID, walkthroughFor } from '../../src/data/forge/bpe-tokenizer/ladder'
import {
  PRIMM_ITEMS,
  PRIMM_MC_ITEMS,
  PRIMM_STEPS,
  REFERENCE_MERGES,
  RUN_ITEM,
  RUN_SPEC,
  RUN_TEXT,
  STAGES,
  fullTable,
  idsAt,
  maxMerges,
  tokensAt,
} from '../../src/data/forge/bpe-tokenizer/primm'
import { PROVE_LAB_ID, PROVE_QUESTIONS, followUpRef } from '../../src/data/forge/bpe-tokenizer/prove'
import type { NumberPrimm } from '../../src/data/forge/types'
import { KC } from '../../src/data/kc/ids'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { hintRef } from '../../src/lib/forge/ladder'
import { gradeChoice, gradeNumber, itemResponse, observationResponse, primmRef, sameConfig, stageRows } from '../../src/lib/forge/primm'
import { pickQuestions } from '../../src/lib/forge/prove'
import { isKnownKind, refMatchesKind } from '../../src/lib/ledger/refs'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { CONTRACT_TEXT, CORPUS, HarnessRng, bytesOf, decode, encode, seededText, trainBpe, type Merge } from '../../src/lib/world/bpe'
import { lintBundle } from '../../scripts/lint-mentor'
import { poolCueFailures } from '../../scripts/item-cues'
import { extractHeadings } from '../../src/pages/lesson/markdown'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const LIB_RS = read('labs/bpe-tokenizer/src/lib.rs')
const TOKENIZER_RS = read('labs/bpe-tokenizer/src/tokenizer.rs')
const kcValues = new Set<string>(Object.values(KC))
const lab = FORGE_LABS.find((l) => l.id === 'bpe-tokenizer')
if (lab === undefined) throw new Error('lab 03 is missing from labs.ts')
const required = lab.checks.filter((c) => c.optional !== true)

/* -------------------- a copy of the harness's six checks, over any encode and decode -------------------- */

interface Impl {
  encode(text: string, merges: readonly Merge[]): number[]
  decode(ids: readonly number[], merges: readonly Merge[]): string
}

const REFERENCE_IMPL: Impl = { encode, decode }

function expectedIds(): number[] {
  const block = /const EXPECTED_IDS: &\[u32\] = &\[([^\]]*)\]/.exec(LIB_RS)
  if (block === null) throw new Error('EXPECTED_IDS missing from lib.rs')
  return block[1].split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number)
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** lib.rs's six checks in grading order, true when the check passes. A throw is a failure (a trap). */
const CHECKS: Record<string, (impl: Impl, seed: number) => boolean> = {
  bytes_are_ids(impl) {
    const ids = impl.encode('hello', [])
    return same(ids, bytesOf('hello')) && impl.decode(ids, []) === 'hello'
  },
  merge_priority(impl) {
    return same(impl.encode('abc', [[98, 99, 256], [97, 98, 257]]), [97, 256])
  },
  leftmost_nonoverlap(impl) {
    const t: Merge[] = [[97, 97, 256]]
    return same(impl.encode('aaaa', t), [256, 256]) && same(impl.encode('aaa', t), [256, 97]) && same(impl.encode('aa', t), [256])
  },
  roundtrip(impl, seed) {
    const rng = new HarnessRng(seed)
    const merges = 16 + rng.below(33)
    const table = trainBpe(CORPUS, merges)
    const texts = [
      'the scheduler schedules the batch.',
      'hello world, hello world, hello',
      'emoji: 🦀🚀 and cjk: 推し活 and accents: naïve café',
      '— em-dash, “quotes”, and a newline\ninside',
    ]
    for (let i = 0; i < 8; i++) texts.push(seededText(rng, 4 + rng.below(21)))
    return texts.every((s) => impl.decode(impl.encode(s, table), table) === s)
  },
  robust_decode(impl) {
    const t: Merge[] = [[97, 98, 256]]
    return impl.decode([], t) === '' && impl.decode([9999], t) === '�' && impl.decode([256, 9999, 97], t) === 'ab�a'
  },
  contract(impl, seed) {
    const merges = trainBpe(CORPUS, 48)
    if (!same(impl.encode(CONTRACT_TEXT, merges), expectedIds())) return false
    const rng = new HarnessRng(seed)
    for (let n = 0; n < 6; n++) {
      const text = seededText(rng, 6 + rng.below(15))
      const ids = impl.encode(text, merges)
      for (let i = 0; i + 1 < ids.length; i++) if (merges.some((m) => m[0] === ids[i] && m[1] === ids[i + 1])) return false
      if (impl.decode(ids, merges) !== text) return false
    }
    return true
  },
}

const DEFAULT_SEEDS: Record<string, number> = { roundtrip: 0x0b9e, contract: 0xc0de }

/** The checks an implementation fails on the default seeds; a throw counts as a failure. */
function failures(impl: Impl): string[] {
  return LADDER_CHECK_IDS.filter((id) => {
    try {
      return !CHECKS[id](impl, DEFAULT_SEEDS[id] ?? 0)
    } catch {
      return true
    }
  })
}

const key = (a: number, b: number) => a * 1048576 + b

function replaceAll(ids: readonly number[], l: number, r: number, id: number): number[] {
  const out: number[] = []
  for (let i = 0; i < ids.length; i++) {
    if (i + 1 < ids.length && ids[i] === l && ids[i + 1] === r) {
      out.push(id)
      i++
    } else out.push(ids[i])
  }
  return out
}

/** Merges the leftmost adjacent pair that has a rule, instead of the lowest rank (calibration's `leftmost-pair`). */
function leftmostFirst(text: string, merges: readonly Merge[]): number[] {
  const rules = new Map(merges.map((m) => [key(m[0], m[1]), m[2]] as const))
  let ids = bytesOf(text)
  for (;;) {
    const at = ids.findIndex((_, i) => i + 1 < ids.length && rules.has(key(ids[i], ids[i + 1])))
    if (at < 0) return ids
    ids = replaceAll(ids, ids[at], ids[at + 1], rules.get(key(ids[at], ids[at + 1])) as number)
  }
}

/** One round of the loop: merges the lowest-rank pair everywhere once, then stops (calibration's `one-round`). */
function oneRound(text: string, merges: readonly Merge[]): number[] {
  const ids = bytesOf(text)
  const rules = new Map(merges.map((m, rank) => [key(m[0], m[1]), rank] as const))
  let best = -1
  for (let i = 0; i + 1 < ids.length; i++) {
    const rank = rules.get(key(ids[i], ids[i + 1]))
    if (rank !== undefined && (best < 0 || rank < best)) best = rank
  }
  return best < 0 ? ids : replaceAll(ids, merges[best][0], merges[best][1], merges[best][2])
}

/** Expands a merge id into its two children and no further; a child that is not a byte is lost (calibration's `shallow-decode`). */
function shallowDecode(ids: readonly number[], merges: readonly Merge[]): string {
  const kids = new Map(merges.map((m) => [m[2], [m[0], m[1]]] as const))
  const bytes: number[] = []
  for (const id of ids) {
    if (id < 256) bytes.push(id)
    else if (!kids.has(id)) bytes.push(0xef, 0xbf, 0xbd)
    else for (const k of kids.get(id) ?? []) if (k < 256) bytes.push(k)
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

describe('the harness copy used below agrees with the harness', () => {
  test('the reference passes all six checks, on the default seeds and on 32 more', () => {
    expect(failures(REFERENCE_IMPL)).toEqual([])
    for (let i = 1; i <= 32; i++) {
      const seed = Math.imul(i, 0x9e3779b9) >>> 0
      expect(CHECKS.roundtrip(REFERENCE_IMPL, seed)).toBe(true)
      expect(CHECKS.contract(REFERENCE_IMPL, seed)).toBe(true)
    }
  })

  test('the mutants it can build fail the checks calibration.json says they fail', () => {
    const cal = JSON.parse(read('labs/bpe-tokenizer/calibration.json')) as { mutants: Record<string, { defaultSeedFails: string[] }> }
    const built: Record<string, Impl> = {
      'leftmost-pair': { encode: leftmostFirst, decode },
      'one-round': { encode: oneRound, decode },
      'shallow-decode': { encode, decode: shallowDecode },
    }
    for (const [name, impl] of Object.entries(built)) expect([name, failures(impl)]).toEqual([name, cal.mutants[name].defaultSeedFails])
  })
})

/* ------------------------------------ the bundle ------------------------------------ */

describe('the bundle', () => {
  test('the registry finds it by directory name, and it default-exports a ForgeBundle for lab 03', async () => {
    expect(await forgeBundleIds()).toContain('bpe-tokenizer')
    expect(await findForgeBundle('bpe-tokenizer')).toBe(bundle)
    expect(bundle.labId).toBe('bpe-tokenizer')
    expect(LAB_ID).toBe(bundle.labId)
    expect(PROVE_LAB_ID).toBe(bundle.labId)
    expect(bundle.discussionsLabel).toBe('[lab 03]')
    expect(typeof bundle.walkthrough).toBe('function')
  })

  test('the parts are the lab modules’ own', () => {
    expect(bundle.stages).toEqual([...STAGES])
    expect(bundle.primm.items).toEqual([...PRIMM_ITEMS])
    expect(bundle.primm.steps).toEqual([...PRIMM_STEPS])
    expect(bundle.primm.run).toBe(RUN_SPEC)
    expect(bundle.prove).toEqual([...PROVE_QUESTIONS])
    expect(bundle.ladder.map((c) => c.checkId)).toEqual([...LADDER_CHECK_IDS])
  })
})

describe('stages: labs.ts, tokenizer.rs and the harness agree', () => {
  test('the four stages are the ones the six required checks carry', () => {
    expect(required.map((c) => c.id)).toEqual([...LADDER_CHECK_IDS])
    expect(STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(STAGES.map((s) => required.filter((c) => c.stage === s.n).map((c) => c.id))).toEqual([
      ['bytes_are_ids'],
      ['merge_priority', 'leftmost_nonoverlap'],
      ['roundtrip', 'robust_decode'],
      ['contract'],
    ])
  })

  test('stage 1 is the single check bytes_are_ids, the two-minute win', () => {
    const one = required.filter((c) => c.stage === 1)
    expect(one.map((c) => c.id)).toEqual(['bytes_are_ids'])
    expect(STAGES[0].minutes).toBe(2)
    for (const s of STAGES) expect(s.minutes).toBeLessThanOrEqual(25)
  })

  test('lib.rs lists the same stage for each check, and tokenizer.rs marks each stage with its minutes', () => {
    for (const c of required) expect(LIB_RS).toMatch(new RegExp(`id: "${c.id}", label: [A-Z_]+, stage: ${c.stage},`))
    for (const s of STAGES) expect(TOKENIZER_RS).toMatch(new RegExp(`STAGE ${s.n}\\b[^\\n]*≈ ${s.minutes} min`))
  })

  test('the stage panel counts four stages and offers the next command', () => {
    const html = renderToStaticMarkup(createElement(StagePanel, { bundle, checks: lab.checks, passed: new Set(['bytes_are_ids']) }))
    expect(html).toContain('Build in four stages')
    expect(html).toContain('1/4 green')
    expect(html).toContain('<code>cargo test merge_priority</code>')
    const rows = stageRows(STAGES, lab.checks, new Set(['bytes_are_ids', 'merge_priority']))
    expect(rows.map((r) => r.green)).toEqual([true, false, false, false])
  })
})

/* ------------------------------------ the reference run ------------------------------------ */

describe('the reference run is the page’s own BPE', () => {
  test('the sentence is not any check’s text, and it is made of bytes the table can merge', () => {
    expect(RUN_TEXT).not.toBe(CONTRACT_TEXT)
    expect(LIB_RS).not.toContain(RUN_TEXT)
    expect(bytesOf(RUN_TEXT)).toHaveLength(54)
  })

  test('the reference is the first 48 merges, and its observed value is that encode’s token count', () => {
    expect(REFERENCE_MERGES).toBe(48)
    expect(RUN_SPEC.reference).toEqual({ merges: 48 })
    expect(RUN_SPEC.baseline).toBeUndefined()
    const run = RUN_SPEC.run(RUN_SPEC.reference)
    expect(run.value).toBe(encode(RUN_TEXT, trainBpe(CORPUS, 48)).length)
    expect(run.value).toBe(23)
    expect(run.truth).toBe(54)
    expect(run.total).toBe(48)
    expect(run.clean).toBe(true)
    expect(run.summary).toContain('23 tokens')
  })

  test('the run is a pure function of its config, and frames walk from the bytes to the end', () => {
    const a = RUN_SPEC.run({ merges: 48 })
    expect(RUN_SPEC.run({ merges: 48 })).toEqual(a)
    expect(a.frames[0].op).toBe(0)
    expect(a.frames[0].cells).toHaveLength(54)
    expect(a.frames[a.frames.length - 1].op).toBe(48)
    expect(a.frames[a.frames.length - 1].cells).toHaveLength(23)
    const counts = a.frames.map((f) => f.cells.length)
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    for (const f of a.frames) {
      for (const c of f.cells) {
        expect(c).toBeGreaterThan(0)
        expect(c).toBeLessThanOrEqual(100)
      }
      expect(f.alt).toContain(`${f.cells.length} tokens`)
    }
  })

  test('a long run still plays in a few seconds, ending exactly on its merge count', () => {
    for (const n of [1, 24, 96, maxMerges()]) {
      const run = RUN_SPEC.run({ merges: n })
      expect(run.frames.length).toBeLessThanOrEqual(50)
      expect(run.frames[run.frames.length - 1].op).toBe(n)
      expect(run.total).toBe(n)
    }
    expect(RUN_SPEC.run({ merges: 0 }).frames).toHaveLength(1)
  })

  test('the table is the lab’s, trained as far as the corpus goes (168 merges), and a prefix is the harness’s table', () => {
    expect(maxMerges()).toBe(168)
    expect(fullTable().slice(0, 48)).toEqual(trainBpe(CORPUS, 48))
    expect(RUN_SPEC.run({ merges: 100000 }).total).toBe(168)
    expect(RUN_SPEC.run({ merges: -5 }).total).toBe(0)
  })

  test('the strip shows counts, never the ids a check expects', () => {
    const shown = JSON.stringify(RUN_SPEC.run({ merges: 48 }).frames)
    expect(shown).not.toContain(expectedIds().join(','))
    expect(idsAt(48, CONTRACT_TEXT)).toEqual(expectedIds())
    expect(RUN_SPEC.disclaimer).toContain('not a check')
  })

  test('the Modify dials are whole configs: 96 merges, 24 merges and every merge', () => {
    const dials = RUN_SPEC.modify?.dials ?? []
    expect(dials.map((d) => d.id)).toEqual(['merges96', 'merges24', 'merges-all'])
    expect(dials[0].label).toContain('96')
    expect(dials.map((d) => RUN_SPEC.run(d.config).value)).toEqual([15, 31, 14])
    expect(dials.map((d) => tokensAt(Number(d.config.merges)))).toEqual([15, 31, 14])
    for (const d of dials) expect(sameConfig(d.config, RUN_SPEC.reference)).toBe(false)
    expect(RUN_SPEC.modify?.lead).toContain('first 48 merges, 23 tokens')
  })

  test('more merges never make more tokens', () => {
    let prev = Infinity
    for (let n = 0; n <= maxMerges(); n += 8) {
      const t = tokensAt(n)
      expect(t).toBeLessThanOrEqual(prev)
      prev = t
    }
  })

  test('the Run step counts only the reference config, and writes an observation with no KCs', () => {
    expect(sameConfig(RUN_SPEC.reference, { merges: 48 })).toBe(true)
    const res = observationResponse(RUN_ITEM, RUN_SPEC.run(RUN_SPEC.reference), 1500)
    expect(res.ref).toBe('item:lab03.primm.r1')
    expect(res.data).toMatchObject({ kcs: [], value: 23, truth: 54 })
    expect(refMatchesKind('item', res.ref)).toBe(true)
  })
})

/* ------------------------------------ items ------------------------------------ */

describe('items: ids, refs, tags, whys', () => {
  test('ids are item:lab03.primm.* and unique', () => {
    const ids = PRIMM_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [...ids, RUN_ITEM.id]) {
      expect(id.startsWith('lab03.primm.')).toBe(true)
      expect(refMatchesKind('item', primmRef(id))).toBe(true)
    }
    expect(isKnownKind('item')).toBe(true)
  })

  test('the spec shape: an estimate and a choice to predict, 3 to 5 to investigate, an estimate to modify', () => {
    expect(PRIMM_ITEMS.filter((i) => i.step === 'predict').map((i) => i.kind).sort()).toEqual(['choice', 'estimate'])
    const investigate = PRIMM_ITEMS.filter((i) => i.step === 'investigate')
    expect(investigate.length).toBeGreaterThanOrEqual(3)
    expect(investigate.length).toBeLessThanOrEqual(5)
    expect(PRIMM_ITEMS.filter((i) => i.step === 'modify').map((i) => i.kind)).toEqual(['estimate'])
    expect(bundle.primm.steps.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
  })

  test('every item is tagged with known KCs of this lab and a nominal time', () => {
    const own = new Set([KC.tokenizerBytes, KC.bpeMerges] as string[])
    for (const i of PRIMM_ITEMS) {
      const kcs = i.kind === 'choice' ? i.item.kcs : i.kcs
      expect(kcs.length).toBeGreaterThan(0)
      for (const k of kcs) {
        expect(kcValues.has(k)).toBe(true)
        expect(own.has(k)).toBe(true)
      }
      expect(i.nsec).toBeGreaterThan(0)
    }
  })

  test('every multiple-choice item has four distinct options, one key and a why for each', () => {
    expect(PRIMM_MC_ITEMS.length).toBeGreaterThanOrEqual(3)
    for (const { id, q } of PRIMM_MC_ITEMS) {
      expect(q.options.length).toBe(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.correct.length).toBe(1)
      expect(q.why?.length).toBe(4)
      for (const w of q.why ?? []) expect(w.trim().length).toBeGreaterThan(40)
      expect(q.explanation?.length).toBeGreaterThan(20)
      expect(q.kcs?.length).toBeGreaterThan(0)
      expect(id.startsWith('lab03.primm.')).toBe(true)
    }
    expect(new Set(PRIMM_MC_ITEMS.map((i) => i.q.correct[0])).size).toBeGreaterThan(1)
  })

  test('the pool passes verify-items’ item-level cue gates on its own, and no key is the longest option', () => {
    const items = PRIMM_MC_ITEMS.map((i) => ({ ref: `lab03 ${i.id}`, q: i.q }))
    expect(poolCueFailures('lab03 PRIMM', items)).toEqual([])
    // verify-items' ratchet: the key is never strictly the longest option
    for (const { q } of items) {
      const lens = q.options.map((o) => o.trim().length)
      const longest = Math.max(...lens)
      expect(lens[q.correct[0]] < longest || lens.filter((l) => l === longest).length > 1).toBe(true)
    }
  })

  test('p2 says stage order', () => {
    const p2 = PRIMM_ITEMS.find((i) => i.id === 'lab03.primm.p2')
    if (p2?.kind !== 'choice') throw new Error('p2 missing')
    expect(p2.item.q.q).toContain('in stage order')
  })
})

describe('the answers are true of the harness', () => {
  const num = (id: string) => PRIMM_ITEMS.find((i) => i.id === id) as NumberPrimm
  const mc = (id: string) => PRIMM_MC_ITEMS.find((i) => i.id === id)!

  test('p1: the estimate is graded against the reference run, 23 tokens, and the prompt states the sentence and 54 bytes', () => {
    const p1 = num('lab03.primm.p1')
    expect(p1.kind).toBe('estimate')
    expect(p1.prompt).toContain(RUN_TEXT)
    expect(p1.prompt).toContain('54 bytes')
    expect(gradeNumber(p1, 23, RUN_SPEC.run(RUN_SPEC.reference).value).ok).toBe(true)
    expect(gradeNumber(p1, 30, 23).ok).toBe(true)
    expect(gradeNumber(p1, 54, 23).ok).toBe(false)
    expect(gradeNumber(p1, 23, 23).feedback).toContain('23 tokens')
  })

  test('p2: a leftmost-first encoder goes red on merge_priority first, and not on stage 1 or leftmost_nonoverlap', () => {
    const impl: Impl = { encode: leftmostFirst, decode }
    expect(failures(impl)).toEqual(['merge_priority', 'contract'])
    const q = mc('lab03.primm.p2').q
    expect(q.options[q.correct[0]]).toContain('`merge_priority` in stage 2')
    // the first red check in stage order is merge_priority, and the other options name checks that are green or later
    expect(LADDER_CHECK_IDS.find((id) => failures(impl).includes(id))).toBe('merge_priority')
    expect(leftmostFirst('abc', [[98, 99, 256], [97, 98, 257]])).toEqual([257, 99])
    expect(q.why?.[q.correct[0]]).toContain('[257, 99]')
  })

  test('i1: the first id of encode("abc") is 97, and merging the leftmost pair gives 257', () => {
    const i1 = num('lab03.primm.i1')
    const table: Merge[] = [[98, 99, 256], [97, 98, 257]]
    expect(encode('abc', table)).toEqual([97, 256])
    expect(i1.truth).toBe(encode('abc', table)[0])
    expect(i1.lures?.map((l) => l.value)).toContain(leftmostFirst('abc', table)[0])
    expect(i1.lures?.find((l) => l.value === 256)?.value).toBe(encode('abc', table)[1])
    for (const l of i1.lures ?? []) expect(l.value).not.toBe(i1.truth)
    expect(gradeNumber(i1, 257, 97)).toMatchObject({ ok: false, miss: 'bpe.leftmost-first' })
  })

  test('i2: "aaaaa" under one (a, a) rule is three tokens, and each lure is a real mistake’s count', () => {
    const i2 = num('lab03.primm.i2')
    const t: Merge[] = [[97, 97, 256]]
    expect(encode('aaaaa', t)).toEqual([256, 256, 97])
    expect(i2.truth).toBe(3)
    expect(i2.lures?.map((l) => l.value).sort()).toEqual([2, 4, 5])
    // overlapping merges count four pairs; no merge is five tokens; dropping the tail leaves two
    expect(bytesOf('aaaaa')).toHaveLength(5)
    expect(gradeNumber(i2, 4, 3)).toMatchObject({ ok: false, miss: 'bpe.overlapping' })
    expect(gradeNumber(i2, 3, 3).ok).toBe(true)
  })

  test('i3: a decode that stops one level down goes red on roundtrip and contract, and on neither of the other two decode checks', () => {
    const impl: Impl = { encode, decode: shallowDecode }
    const red = failures(impl)
    expect(red).toEqual(['roundtrip', 'contract'])
    const q = mc('lab03.primm.i3').q
    expect(q.options[q.correct[0]]).toContain('`roundtrip` and `contract`')
    // id 259 is merged from 256 and 258, and 258 from two bytes? In the 48-merge table 259 = (256, 258), 256 = (32, 116), 258 = (257, 32)
    const t = trainBpe(CORPUS, 48)
    expect(t[259 - 256]).toEqual([256, 258, 259])
    expect(CHECKS.robust_decode(impl, 0)).toBe(true)
    expect(CHECKS.bytes_are_ids(impl, 0)).toBe(true)
  })

  test('i4: the string "ab", U+FFFD, "a" is six UTF-8 bytes, and the lures are the strings of the mistakes they name', () => {
    const i4 = num('lab03.primm.i4')
    const out = decode([256, 9999, 97], [[97, 98, 256]])
    expect(out).toBe('ab�a')
    expect(bytesOf(out)).toHaveLength(i4.truth as number)
    expect(i4.truth).toBe(6)
    expect(bytesOf('aba')).toHaveLength(3)
    expect(bytesOf('ab?a')).toHaveLength(4)
    expect(i4.lures?.map((l) => l.value).sort()).toEqual([3, 4, 5])
    expect(gradeNumber(i4, 3, 6)).toMatchObject({ ok: false, miss: 'bpe.dropped-unknown' })
    expect(bytesOf('�')).toEqual([0xef, 0xbf, 0xbd])
  })

  test('i5: an encoder that stops after one round passes the two small tables and fails contract alone', () => {
    const impl: Impl = { encode: oneRound, decode }
    expect(failures(impl)).toEqual(['contract'])
    expect(CHECKS.merge_priority(impl, 0)).toBe(true)
    expect(CHECKS.leftmost_nonoverlap(impl, 0)).toBe(true)
    const q = mc('lab03.primm.i5').q
    expect(q.options[q.correct[0]]).toContain('merges the lowest-rank pair once and stops')
  })

  test('m1: the prompt quotes the reference count, and the three dials’ answers are in the grading band for a sensible guess', () => {
    const m1 = num('lab03.primm.m1')
    expect(m1.prompt).toContain('23 tokens')
    expect(m1.kcs).toEqual([KC.bpeMerges])
    expect(gradeNumber(m1, 17, 15).ok).toBe(true) // 96 merges: 15
    expect(gradeNumber(m1, 23, 15).ok).toBe(false) // "no change" is not a prediction
  })
})

describe('grading and ledger responses', () => {
  test('a choice answer writes pick by authored index with kcs; the key passes and a miss says why', () => {
    const p2 = PRIMM_ITEMS.find((i) => i.id === 'lab03.primm.p2')
    if (p2?.kind !== 'choice') throw new Error('p2 missing')
    const key = p2.item.q.correct[0]
    expect(gradeChoice(p2, key).ok).toBe(true)
    const miss = gradeChoice(p2, (key + 1) % 4)
    expect(miss.ok).toBe(false)
    expect(miss.feedback.length).toBeGreaterThan(40)
    const res = itemResponse({ item: p2, grade: gradeChoice(p2, key), pick: key, ms: 4000 })
    expect(res.ref).toBe('item:lab03.primm.p2')
    expect(res.data).toMatchObject({ kcs: [KC.bpeMerges], nsec: p2.nsec })
  })
})

/* ------------------------------------ the panels, rendered ------------------------------------ */

describe('the generic panels render lab 03', () => {
  const panel = (initial: 'predict' | 'run' | 'investigate' | 'modify' | 'make') =>
    renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks: lab.checks, passed: new Set<string>(), initial }))

  test('Predict names the lab and shows the estimate and the choice', () => {
    const html = panel('predict')
    expect(html).toContain('aria-label="Lab 03 in five steps"')
    expect(html).toContain('data-item="lab03.primm.p1"')
    expect(html).toContain('data-item="lab03.primm.p2"')
    expect(html).toContain(RUN_TEXT)
    expect(html).not.toContain('allocator')
  })

  test('Investigate shows all five items, and Modify the three dials and its prompt', () => {
    const inv = panel('investigate')
    for (const id of ['i1', 'i2', 'i3', 'i4', 'i5']) expect(inv).toContain(`data-item="lab03.primm.${id}"`)
    const mod = panel('modify')
    expect(mod).toContain('Change one thing about the reference run (the first 48 merges, 23 tokens).')
    expect(mod).toContain('48 merges becomes 96 merges')
    expect(mod).toContain('48 merges becomes 24 merges')
    expect(mod).toContain('every merge the corpus has (168)')
    expect(mod).toContain('How many tokens does your changed run make?')
  })

  test('the reference run is titled, labelled a stand-in, and starts on the bytes', () => {
    const html = renderToStaticMarkup(createElement(ReferenceRun, { bundle, config: RUN_SPEC.reference }))
    expect(html).toContain('Reference: the first 48 merges of the lab’s table')
    expect(html).toContain('data-reference-run="bpe-tokenizer"')
    expect(html).toContain('op 0 / 48')
    expect(html).toContain('54-byte sentence as 54 tokens after 0 merges')
    expect(html).toContain('bytes per token')
    expect(html).toContain('It is not a check')
  })

  test('Prove it shows three of the lab’s six questions and no other lab’s', () => {
    const html = renderToString(createElement(ProveIt, { bundle, history: [], now: 0, seed: 4 })).replaceAll('<!-- -->', '')
    expect(html).toContain('data-prove="active"')
    const qids = [...html.matchAll(/data-qid="([a-z-]+)"/g)].map((m) => m[1])
    expect(qids.length).toBeGreaterThan(0)
    for (const q of qids) expect(PROVE_QUESTIONS.map((p) => p.id)).toContain(q)
    expect(html).not.toContain('allocator')
  })
})

/* ------------------------------------ the ladder ------------------------------------ */

const h2s = new Map<string, Set<string>>()
for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))

const ISO = '2026-10-04T09:00:00.000Z'
const row = (id: string, status: CheckResult['status'] = 'fail', extra: Partial<CheckResult> = {}): CheckResult => ({ id, label: id, status, msg: `${id} says no`, ...extra })
const report = (checks: CheckResult[]): LabRunReport => ({ lab: 'bpe-tokenizer', reference: false, abi: 2, version: 3, checks, seeds: 'fresh', ms: 5 })

describe('the ladder', () => {
  test('lint-mentor finds nothing: six required checks, R0 to R4 each, every limit held', () => {
    expect(lintBundle(bundle, { required: required.map((c) => c.id), libRs: LIB_RS, h2s })).toEqual([])
    expect(bundle.ladder).toHaveLength(6)
    expect(Object.keys(LADDER).sort()).toEqual([...LADDER_CHECK_IDS].sort())
  })

  test('each rung’s facts are true: the bytes of "hello", the ids of "abc", the lengths in R0', () => {
    expect(bytesOf('hello').join(' ')).toBe('104 101 108 108 111')
    expect(LADDER.bytes_are_ids.r0.ideas.join(' ')).toContain('104 101 108 108 111')
    const t: Merge[] = [[98, 99, 256], [97, 98, 257]]
    expect(LADDER.merge_priority.r0.ideas.join(' ')).toContain(JSON.stringify(encode('abc', t)).replace(',', ', '))
    const aa: Merge[] = [[97, 97, 256]]
    const wants = ['aaaa', 'aaa', 'aa'].map((s) => JSON.stringify(encode(s, aa)).replace(',', ', '))
    for (const w of wants) expect(LADDER.leftmost_nonoverlap.r0.ideas.join(' ')).toContain(w)
    expect(LADDER.robust_decode.r0.ideas.join(' ')).toContain('9999')
    expect(LIB_RS).toContain('9999')
    expect(LADDER.roundtrip.r0.ideas[0]).toContain('16 to 48')
    expect(LIB_RS).toContain('16 + rng.below(33)')
    expect(LADDER.contract.r0.ideas[0]).toContain('48-merge')
    expect(LADDER.contract.r0.ideas[1]).toContain('six')
  })

  test('R3 is pseudo-code and R4 is prose, with no code span in either', () => {
    for (const c of bundle.ladder) {
      expect(c.r3.split('\n')).toHaveLength(3)
      expect(c.r3).not.toContain('`')
      expect(c.r4).not.toContain('`')
      expect(c.r2.text).toContain('lib.rs')
      expect(c.r2.fn).toBe(`check_${c.checkId}`)
    }
  })

  test('the card for a red check shows its rungs, under the lab’s acks and label', () => {
    const acks = Object.fromEntries((['R0', 'R1', 'R2', 'R3', 'R4', 'bottom'] as const).map((r) => [hintRef('merge_priority', r, LAB_ID), ISO]))
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(HintLadderView, { bundle, reports: [report([row('merge_priority', 'fail', { msg: 'encode("abc") = [257, 99]' })])], acks, onAck: () => {}, now: () => 0 })),
    )
    expect(html).toContain('data-check="merge_priority"')
    expect(html).toContain(LADDER.merge_priority.r0.prompt)
    expect(html).toContain('A merge table is ordered by priority')
    expect(html).toContain('href="/lesson/r.l6#build-the-forge-data-paths"')
    expect(html).toContain('Bottom-out')
    expect(hintRef('merge_priority', 'R1', bundle.labId)).toBe('hint:bpe-tokenizer/merge_priority#R1')
    const href = /href="(https:\/\/github\.com\/[^"]*discussions\/new[^"]*)"/.exec(html)?.[1]
    expect(href).toBeDefined()
    expect(new URL((href ?? '').replace(/&amp;/g, '&')).searchParams.get('title')).toStartWith('[lab 03] merge_priority:')
  })
})

describe('the walkthrough', () => {
  test('without a trace it replays the reference on a small case from the check, pass by pass', () => {
    for (const id of LADDER_CHECK_IDS) {
      const w = walkthroughFor(id)
      expect(w.source).toBe('script')
      expect(w.divergedAt).toBeNull()
      expect(w.steps.length).toBeGreaterThan(0)
      w.steps.forEach((s, i) => {
        expect(s.n).toBe(i + 1)
        expect(s.yours).toBe('-')
        expect(s.diverges).toBe(false)
      })
    }
    const abc = walkthroughFor('merge_priority')
    expect(abc.steps.map((s) => s.op)).toEqual(['encode("abc"), pass 1', 'encode("abc")'])
    expect(abc.steps[0].reference).toContain('rank 0, (98, 99) into 256, 1 place: [97, 256]')
    expect(abc.steps[1].reference).toBe('[97, 256]')
    expect(abc.headline).toContain('kslab::trace!')
  })

  test('robust_decode shows the three decodes of the check, and the contract case never shows the check’s own text', () => {
    const w = walkthroughFor('robust_decode')
    expect(w.steps.map((s) => s.op)).toEqual(['decode([])', 'decode([9999])', 'decode([256, 9999, 97])'])
    for (const id of LADDER_CHECK_IDS) expect(JSON.stringify(walkthroughFor(id))).not.toContain(expectedIds().join(', '))
    const c = walkthroughFor('contract')
    expect(c.steps.length).toBeGreaterThan(2)
    expect(c.steps[c.steps.length - 1].op).toBe('encode("the stream")')
  })

  test('the contract case runs several passes, each making pairs the next one uses', () => {
    const c = walkthroughFor('contract')
    const passes = c.steps.filter((s) => / pass \d+$/.test(s.op))
    expect(passes.length).toBeGreaterThanOrEqual(3)
    const ranks = passes.map((s) => Number(/rank (\d+),/.exec(s.reference)?.[1]))
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThan(ranks[i - 1])
    const final = c.steps[c.steps.length - 1]
    expect(final.reference).toBe(`[${encode('the stream', trainBpe(CORPUS, 48)).join(', ')}]`)
  })

  test('a trace that agrees with the reference diverges nowhere; a wrong line is the divergence', () => {
    const agree = walkthroughFor('merge_priority', ['encode("abc") -> [97, 256]'])
    expect(agree.source).toBe('trace')
    expect(agree.divergedAt).toBeNull()
    expect(agree.steps[agree.steps.length - 1].yours).toBe('[97, 256]')
    expect(agree.headline).toContain('agrees with the reference')

    const bad = walkthroughFor('merge_priority', ['noise', 'encode("abc") -> [257, 99]'])
    expect(bad.source).toBe('trace')
    expect(bad.divergedAt).toBe(2)
    expect(bad.steps[bad.steps.length - 1]).toMatchObject({ n: 2, yours: '[257, 99]', reference: '[97, 256]', diverges: true })
    expect(bad.headline).toContain('first leaves the reference at encode("abc")')
    expect(bad.headline).toContain('[257, 99]')
  })

  test('the first of several cases that differs is the divergence, and later cases are not shown', () => {
    const w = walkthroughFor('leftmost_nonoverlap', ['encode("aaaa") -> [256, 256]', 'encode("aaa") -> [256, 256]', 'encode("aa") -> [256]'])
    const bad = w.steps.find((s) => s.diverges)
    expect(bad?.op).toBe('encode("aaa")')
    expect(w.divergedAt).toBe(w.steps.length)
    expect(w.steps.some((s) => s.op === 'encode("aa")')).toBe(false)
  })

  test('other spellings of a trace line parse, and a hostile trace is bounded', () => {
    const w = walkthroughFor('merge_priority', ['encode("abc") = [97,256]'])
    expect(w.divergedAt).toBeNull()
    expect(w.steps[w.steps.length - 1].yours).toBe('[97, 256]')
    const huge = Array.from({ length: 50000 }, () => 'encode("zzz") -> [1]')
    expect(walkthroughFor('bytes_are_ids', huge).source).toBe('script')
    // lines that name no case of the check change nothing
    expect(walkthroughFor('merge_priority', ['encode("xyz") -> [1]']).source).toBe('script')
  })

  test('the bundle adapter passes the drained lines through', () => {
    expect(bundle.walkthrough?.('merge_priority', ['encode("abc") -> [257, 99]'])?.divergedAt).toBe(2)
    expect(bundle.walkthrough?.('contract', [])?.source).toBe('script')
  })
})

/* ------------------------------------ Prove it ------------------------------------ */

describe('Prove it v1', () => {
  test('six questions with unique ids, three ideas each, and a model answer the prompt does not contain', () => {
    expect(PROVE_QUESTIONS).toHaveLength(6)
    expect(new Set(PROVE_QUESTIONS.map((q) => q.id)).size).toBe(6)
    for (const q of PROVE_QUESTIONS) {
      expect(q.prompt.endsWith('?')).toBe(true)
      expect(q.model.length).toBeGreaterThan(120)
      expect(q.ideas).toHaveLength(3)
      expect(new Set(q.ideas).size).toBe(3)
      expect(q.prompt).not.toContain(q.model)
      expect(q.kcs.length).toBeGreaterThan(0)
      for (const k of q.kcs) expect(kcValues.has(k)).toBe(true)
    }
  })

  test('the facts in the model answers are true of the table and the checks', () => {
    const q = (id: string) => PROVE_QUESTIONS.find((p) => p.id === id)!
    const t: Merge[] = [[98, 99, 256], [97, 98, 257]]
    expect(q('two-rules').model).toContain(JSON.stringify(encode('abc', t)).replace(',', ', '))
    expect(q('two-rules').model).toContain(JSON.stringify(leftmostFirst('abc', t)).replace(',', ', '))
    expect(q('run-of-a').model).toContain(JSON.stringify(encode('aaa', [[97, 97, 256]])).replace(',', ', '))
    // "In the 48-merge table, " t" and "he " each become one id, and rule 259 then merges those two ids"
    const table = trainBpe(CORPUS, 48)
    expect(table[257 - 256]).toEqual([104, 101, 257])
    expect(table[258 - 256]).toEqual([257, 32, 258])
    expect(table[256 - 256]).toEqual([32, 116, 256])
    expect(table[259 - 256]).toEqual([256, 258, 259])
    expect(q('loop-until').model).toContain('rule 259')
    expect(bytesOf('�')).toHaveLength(3)
    expect(q('bad-id').model).toContain('three UTF-8 bytes of U+FFFD')
  })

  test('the draw takes three of the lab’s questions, and the second attempt gets exactly the other three', () => {
    const first = pickQuestions([], 3, bundle.prove)
    expect(first).toHaveLength(3)
    for (const p of first) expect(PROVE_QUESTIONS).toContain(p)
    const second = pickQuestions([{ at: ISO, qids: first.map((p) => p.id) }], 3, bundle.prove)
    expect(second).toHaveLength(3)
    expect(new Set([...first, ...second].map((p) => p.id)).size).toBe(6)
  })

  test('the 30-day follow-up is a lab 03 item ref the ledger accepts', () => {
    for (const q of PROVE_QUESTIONS) {
      expect(followUpRef(q.id)).toBe(`item:lab03.prove.${q.id}`)
      expect(refMatchesKind('item', followUpRef(q.id))).toBe(true)
    }
  })
})
