/**
 * Lab 07, radix-cache (docs/specs/wave-3.md §7.2, §8.2; task 3b-13): the bundle's stages, PRIMM items and reference run on
 * the page's radix tree (src/lib/world/radix.ts), the faded hint ladder (R0 to R2) for the six required checks, the six
 * Prove-it questions and the two Prove-it v2 templates.
 *
 * The v2 half is the template rule 3a-22 set (src/data/forge/radix-cache/prove2.ts): this lab's required checks pin a
 * correct cache's lookups, so each template is a tracing question about a correct module. The fakes below, which live in
 * this file, prove that a fake correct module answers each template, that the answer is not given by the story alone (it
 * differs across seeds and is never a number the story states), that a plausible bug changes it, and that every kind of
 * correct lookup agrees: matching token for token, matching at the points where cached paths part or end, and matching
 * whole blocks. The multiple-choice items are held to verify:items' blind-strategy gates here too, as the other labs' are.
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
import { findForgeBundle, forgeBundleIds, loadAllForgeBundles, loadForgeBundle } from '../../src/data/forge'
import bundle from '../../src/data/forge/radix-cache'
import { DISCUSSIONS_LABEL, LAB_ID, LADDER, LADDER_CHECK_IDS, hintRef, restoreState } from '../../src/data/forge/radix-cache/ladder'
import {
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
  percent,
  primmRef,
  runReplay,
  runResponse,
  stageRows,
  type NumberPrimm,
} from '../../src/data/forge/radix-cache/primm'
import { PROVE_LAB_ID, PROVE_QUESTIONS, buildProveResult, followUpRef, pickQuestions } from '../../src/data/forge/radix-cache/prove'
import { BLOCK, MATCH_AFTER_SPLIT, MATCH_LEN, PROVE2 } from '../../src/data/forge/radix-cache/prove2'
import type { ProveV2Template } from '../../src/data/forge/types'
import { KC } from '../../src/data/kc/ids'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { gradeAnswer, planQuestion, proveFromModule } from '../../src/lib/forge/prove2'
import { followUpRefFor } from '../../src/lib/forge/prove-return'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { refMatchesKind } from '../../src/lib/ledger/refs'
import { BlockPool, BLOCK_SIZE, PRACTICE_SEED, REPLAY, RadixCache, store } from '../../src/lib/world/radix'
import { HarnessRng } from '../../src/lib/world/bpe'
import { extractHeadings } from '../../src/pages/lesson/markdown'
import { lintBundle } from '../../scripts/lint-mentor'
import { CUE_STRATEGIES, MAX_RANK_LESSON, PASS_BAR, passProbability, poolCueFailures } from '../../scripts/item-cues'
import { fakeBridge } from './fixtures'

const lab = FORGE_LABS.find((l) => l.id === 'radix-cache')
if (lab === undefined) throw new Error('lab 07 is missing from labs.ts')
const checks = lab.checks
const required = checks.filter((c) => c.optional !== true).map((c) => c.id)
const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const kcValues = new Set<string>([...Object.values(KC), 't5.prefix-cache-keys', 't5.radix-eviction'])
const LIB_RS = read('labs/radix-cache/src/lib.rs')

const ids = (start: number, len: number) => Array.from({ length: len }, (_, i) => start + i)

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

describe('stages: labs.ts, cache.rs and the harness agree (§8.1, §8.2)', () => {
  test('stage 1 is exact_match, then longest_prefix, then eviction and sharing, then the churn and the replay', () => {
    const byStage = (n: number) => checks.filter((c) => c.stage === n).map((c) => c.id)
    expect(byStage(1)).toEqual(['exact_match'])
    expect(byStage(2)).toEqual(['longest_prefix'])
    expect(byStage(3).sort()).toEqual(['cow_divergence', 'eviction_order'])
    expect(byStage(4).sort()).toEqual(['block_conservation', 'chat_hit_rate'])
    expect(checks.every((c) => c.optional !== true)).toBe(true)
  })

  test('the bundle’s stages are the four a required check carries, each at most 25 minutes', () => {
    expect(bundle.stages.map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(bundle.stages).toEqual([...STAGES])
    for (const s of STAGES) expect(s.minutes).toBeLessThanOrEqual(25)
  })

  test('the harness lists the same stage for each check', () => {
    for (const c of checks) {
      const m = new RegExp(`id: "${c.id}",[^}]*?stage: (\\d)`).exec(LIB_RS)
      expect(m?.[1]).toBe(String(c.stage))
    }
  })

  test('cache.rs’s header table names each stage’s checks, as the bundle’s stages do', () => {
    const lines = read('labs/radix-cache/src/cache.rs').split('\n')
    const named = new Map<number, string[]>()
    lines.forEach((line, i) => {
      const m = /^\/\/!\s+STAGE (\d)\s+([a-z_]+(?:, [a-z_]+)?)(,?)\s/.exec(line)
      if (m === null) return
      const names = m[2].split(', ')
      // a trailing comma continues the list on the next header line
      if (m[3] === ',') names.push(/^\/\/!\s+([a-z_]+)/.exec(lines[i + 1])?.[1] ?? '')
      named.set(Number(m[1]), names)
    })
    for (const stage of STAGES) {
      const expected = required.filter((id) => checks.find((c) => c.id === id)?.stage === stage.n)
      expect((named.get(stage.n) ?? []).sort()).toEqual(expected.sort())
    }
  })

  test('the signatures did not change', () => {
    const src = read('labs/radix-cache/src/cache.rs')
    expect(src).toContain('pub fn new(pool: BlockAllocator, max_entries: usize) -> Self')
    expect(src).toContain('pub fn match_prefix(&mut self, tokens: &[u32]) -> PrefixMatch')
    expect(src).toContain('pub fn insert(&mut self, tokens: &[u32], blocks: &[usize]) -> bool')
    expect(src).toContain('pub fn evict_lru(&mut self) -> bool')
    expect(src).toContain('pub fn entry_count(&self) -> usize')
  })

  test('the page walks the PRIMM steps in order', () => {
    expect(PRIMM_STEPS.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
  })
})

describe('stage rows and attempts-to-green, over lab 07’s checks', () => {
  const passed = (...a: string[]) => new Set(a)

  test('nothing passed: stage 1 is next, nothing is green', () => {
    const rows = stageRows(checks, passed())
    expect(rows.every((r) => !r.green)).toBe(true)
    expect(currentStage(rows)?.n).toBe(1)
    expect(greenStage(rows)).toBe(0)
  })

  test('exact_match alone turns stage 1 green, the two-check stages need both checks', () => {
    expect(stageRows(checks, passed('exact_match')).map((r) => r.green)).toEqual([true, false, false, false])
    const half = stageRows(checks, passed('exact_match', 'longest_prefix', 'eviction_order'))
    expect(half.map((r) => r.green)).toEqual([true, true, false, false])
    const three = stageRows(checks, passed('exact_match', 'longest_prefix', 'eviction_order', 'cow_divergence'))
    expect(greenStage(three)).toBe(3)
    expect(greenStage(stageRows(checks, passed(...required)))).toBe(4)
  })

  test('attempts-to-green counts runs from the run after the previous stage went green', () => {
    const runs = [[], ['exact_match'], ['exact_match'], ['exact_match', 'longest_prefix'], required.filter((id) => id !== 'chat_hit_rate'), required]
    expect(attemptsToGreen(runs, checks)).toEqual([2, 2, 1, 1])
  })
})

/* ------------------------------------------------------------------ */
/* The reference run                                                   */
/* ------------------------------------------------------------------ */

describe('the reference run: a radix tree on the lab’s probe traffic', () => {
  const ref = runReplay(REFERENCE)
  const result = RUN_SPEC.run(RUN_SPEC.reference)

  test('it is the lab’s probe at the seed calibration.json records, with the numbers the harness printed', () => {
    expect(REFERENCE.seed).toBe(PRACTICE_SEED)
    expect(PRACTICE_SEED).toBe(7)
    const cal = JSON.parse(read('labs/radix-cache/calibration.json')) as { probe: { seed: number; reply: string } }
    expect(cal.probe.seed).toBe(PRACTICE_SEED)
    expect(cal.probe.reply).toContain(`hit_tokens=${ref.hitTokens} prompt_tokens=${ref.promptTokens}`)
    expect(cal.probe.reply).toContain(`entries=${ref.entries} free_blocks=${ref.freeBlocks}`)
    expect([ref.hitTokens, ref.promptTokens, ref.entries, ref.freeBlocks]).toEqual([1312, 2304, 12, 30])
  })

  test('it is deterministic in its config, and a different seed is a different run', () => {
    expect(runReplay(REFERENCE)).toEqual(ref)
    expect(runReplay({ ...REFERENCE, seed: PRACTICE_SEED + 1 })).not.toEqual(ref)
    expect(RUN_SPEC.run(RUN_SPEC.reference)).toEqual(result)
  })

  test('the strip is the 48-block pool in id order, frame by frame, and each frame conserves it', () => {
    expect(result.frames).toHaveLength(REPLAY.requests + 1)
    expect(result.frames[0]).toMatchObject({ op: 0 })
    expect(result.frames[REPLAY.requests].op).toBe(REPLAY.requests)
    for (const f of result.frames) {
      expect(f.cells).toHaveLength(REPLAY.blocks)
      expect(f.cells.every((c) => c === 0 || c === 40 || c === 100)).toBe(true)
      expect(f.stats.map((s) => s.label)).toEqual(['tokens reused', 'entries', 'free blocks'])
      expect(f.alt.length).toBeGreaterThan(20)
    }
    const last = result.frames[REPLAY.requests]
    expect(last.cells.filter((c) => c === 0).length).toBe(ref.freeBlocks)
    expect(last.stats[2].value).toBe(String(ref.freeBlocks))
    expect(last.stats[1].value).toBe('12 of 12')
    expect(result.clean).toBe(true)
  })

  test('the Run step’s value is the share of prompt tokens served, 56.9%, of a possible 100', () => {
    expect(percent(ref.hitTokens, ref.promptTokens)).toBe(56.9)
    expect(result.value).toBe(56.9)
    expect(result.truth).toBe(100)
    expect(result.total).toBe(REPLAY.requests)
    expect(result.frames[REPLAY.requests].stats[0].value).toBe('56.9%')
    expect(result.summary).toBe(describeRun(ref))
    expect(describeRun(ref)).toContain('1,312 of 2,304 prompt tokens came from the cache (56.9%)')
    expect(describeRun(ref)).toContain('7 requests of 48 found nothing')
  })

  test('each Modify dial is a whole config for the same traffic, measured in requests that find nothing', () => {
    const dials = RUN_SPEC.modify?.dials ?? []
    expect(dials.map((d) => d.id)).toEqual(['entries6', 'entries3', 'entries24'])
    expect(dials.map((d) => RUN_SPEC.run(d.config).value)).toEqual([13, 24, 4])
    for (const d of dials) {
      expect(d.config.seed).toBe(PRACTICE_SEED)
      expect(d.config.blocks).toBe(REPLAY.blocks)
      expect(d.config.report).toBe('misses')
      const r = RUN_SPEC.run(d.config)
      expect(r.clean).toBe(true)
      expect(r.truth).toBe(REPLAY.requests)
      expect(r.value).toBeLessThanOrEqual(r.truth)
      expect(r.summary).toContain('found nothing')
    }
  })

  test('the reference run is not a check, and says so in its disclaimer', () => {
    expect(RUN_SPEC.disclaimer).toContain('not the 240-request replay of a check')
    expect(RUN_SPEC.title(RUN_SPEC.reference)).toBe('Reference: a radix cache of 12 entries over 48 blocks')
    expect(describeRun(ref)).toContain('Free plus allocated blocks equalled the pool throughout')
  })

  test('a cache that cannot admit a request ends its run early, and the caption says so', () => {
    const broken = runReplay({ ...REFERENCE, entries: 1 })
    expect(broken.error).not.toBeNull()
    expect(describeRun(broken)).toContain('could not admit a request')
    expect(RUN_SPEC.run({ ...REFERENCE, entries: 1 }).clean).toBe(false)
  })

  test('the Run step writes one observation for the reference config: the hit rate, no KCs', () => {
    const r = runResponse(ref)
    expect(r.ref).toBe(primmRef(RUN_ITEM.id))
    expect(r.data).toMatchObject({ kcs: [], value: 56.9, truth: 100 })
  })
})

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

describe('items (§8.2): ids, refs, tags, whys', () => {
  test('there are six: two predict (an estimate and a choice), three investigate and one modify', () => {
    expect(PRIMM_ITEMS).toHaveLength(6)
    const step = (s: string) => PRIMM_ITEMS.filter((i) => i.step === s)
    expect(step('predict').map((i) => i.kind).sort()).toEqual(['choice', 'estimate'])
    expect(step('investigate')).toHaveLength(3)
    expect(step('modify')).toHaveLength(1)
    expect(step('modify')[0].kind).toBe('estimate')
    expect(bundle.primm.items).toEqual([...PRIMM_ITEMS])
  })

  test('ids are item:lab07.primm.* and unique', () => {
    const all = PRIMM_ITEMS.map((i) => i.id)
    expect(new Set(all).size).toBe(all.length)
    for (const id of [...all, RUN_ITEM.id]) {
      expect(id.startsWith('lab07.primm.')).toBe(true)
      expect(refMatchesKind('item', primmRef(id))).toBe(true)
    }
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
    expect(PRIMM_MC_ITEMS.length).toBe(3)
    for (const { id, q } of PRIMM_MC_ITEMS) {
      expect(q.options.length).toBe(4)
      expect(q.correct.length).toBe(1)
      expect(q.why?.length).toBe(q.options.length)
      for (const w of q.why ?? []) expect(w.trim().length).toBeGreaterThan(20)
      expect(new Set(q.options).size).toBe(q.options.length)
      expect(q.kcs?.length).toBeGreaterThan(0)
      expect(id.startsWith('lab07.primm.')).toBe(true)
    }
  })

  test('PRIMM_MC_ITEMS is exactly the bundle’s choice items, the pool verify-items reads', () => {
    expect(PRIMM_MC_ITEMS).toEqual(bundle.primm.items.flatMap((i) => (i.kind === 'choice' ? [i.item] : [])))
  })

  test('the answer keys are not all in one position', () => {
    expect(new Set(PRIMM_MC_ITEMS.map((i) => i.q.correct[0])).size).toBeGreaterThan(1)
  })

  test('p1 is a Fermi estimate of the reference run’s hit rate; its window holds the truth, 56.9%, and not a naive “all of the shared prefix”', () => {
    const p1 = PRIMM_ITEMS.find((i) => i.id === 'lab07.primm.p1') as NumberPrimm
    expect(p1.kind).toBe('estimate')
    expect(p1.unit).toBe('%')
    expect(p1.prompt).toContain('2,304 prompt tokens')
    const truth = RUN_SPEC.run(RUN_SPEC.reference).value
    expect(gradeNumber(p1, truth, truth).ok).toBe(true)
    expect(gradeNumber(p1, 48, truth).ok).toBe(true)
    expect(gradeNumber(p1, 70, truth).ok).toBe(true)
    expect(gradeNumber(p1, 5, truth).ok).toBe(false)
    expect(gradeNumber(p1, 100, truth).ok).toBe(false)
    expect(gradeNumber(p1, 0, truth).ok).toBe(false)
  })

  test('p1’s explanation is arithmetic: 32 of 48 is 66.7%, 44 requests x 32 tokens is 1,408 of 2,304 (61.1%), and the run gets 41 hits', () => {
    const p1 = PRIMM_ITEMS.find((i) => i.id === 'lab07.primm.p1') as NumberPrimm
    expect((32 / 48) * 100).toBeCloseTo(66.7, 1)
    expect(44 * 32).toBe(1408)
    expect(percent(1408, 2304)).toBe(61.1)
    expect(percent(1312, 2304)).toBe(56.9)
    expect(1312 / 32).toBe(41)
    for (const quoted of ['66.7%', '1,408', '61.1%', '41 hits', '1,312 tokens', '56.9%', '3 later requests']) expect(p1.explain).toContain(quoted)
    // a cache with room for 24 prompts reaches the ceiling the text names
    expect(runReplay({ ...REFERENCE, entries: 24 }).hitTokens).toBe(1408)
  })

  test('m1 quotes the reference run’s 7 requests that find nothing, 4 of them cold starts, and each dial’s count is in the explanation', () => {
    const m1 = PRIMM_ITEMS.find((i) => i.id === 'lab07.primm.m1') as NumberPrimm
    expect(m1.kind).toBe('estimate')
    expect(m1.unit).toBe('requests')
    expect(m1.prompt).toContain('In the reference run 7 requests find nothing')
    expect(m1.prompt).toContain('4 are the first of a system prompt')
    expect(m1.prompt).toContain('3 arrive after')
    for (const [entries, misses] of [[6, 13], [3, 24], [24, 4]] as const) {
      expect(runReplay({ ...REFERENCE, entries }).misses).toBe(misses)
      expect(m1.explain).toContain(`${misses}`)
    }
    // the unchanged answer is not inside any dial’s window: the modify step cannot be passed by saying “7”
    for (const d of RUN_SPEC.modify?.dials ?? []) expect(gradeNumber(m1, 7, RUN_SPEC.run(d.config).value).ok).toBe(false)
    const truth = RUN_SPEC.run((RUN_SPEC.modify?.dials ?? [])[0].config).value
    expect(gradeNumber(m1, truth, truth).ok).toBe(true)
    expect(m1.kcs.every((k) => kcValues.has(k))).toBe(true)
  })

  test('i1’s arithmetic, on the page’s own tree: a 40-token prompt and a query that shares its first 20 ids match 20 tokens over 2 blocks', () => {
    const i1 = PRIMM_ITEMS.find((i) => i.id === 'lab07.primm.i1') as NumberPrimm
    const pool = new BlockPool(24)
    const cache = new RadixCache(pool, 8)
    store(cache, pool, ids(100, 40))
    const hit = cache.matchPrefix([...ids(100, 20), 9_001, 9_002, 9_003, 9_004, 9_005, 9_006, 9_007])
    expect(hit.len).toBe(20)
    expect(hit.blocks).toHaveLength(2)
    expect(i1.truth).toBe(hit.len)
    expect(i1.lures?.map((l) => l.value)).toEqual([16, 0, 40, 27])
    for (const lure of i1.lures ?? []) expect(lure.value).not.toBe(i1.truth)
    expect(Math.floor(20 / BLOCK_SIZE) * BLOCK_SIZE).toBe(16)
    expect(20 + 7).toBe(27)
  })

  test('i2’s arithmetic: two 48-token prompts that share 32 tokens hold 4 blocks, the shared two at 2 owners', () => {
    const pool = new BlockPool(24)
    const cache = new RadixCache(pool, 8)
    const system = ids(1_000, 32)
    const x = [...system, ...ids(2_000, 16)]
    const y = [...system, ...ids(3_000, 16)]
    expect(store(cache, pool, x) && store(cache, pool, y)).toBe(true)
    expect(pool.allocatedBlocks).toBe(4)
    const a = cache.matchPrefix(x).blocks
    const b = cache.matchPrefix(y).blocks
    expect(a.slice(0, 2)).toEqual(b.slice(0, 2))
    expect(a[2]).not.toBe(b[2])
    expect([...a, b[2]].map((blk) => pool.refcount(blk))).toEqual([2, 2, 1, 1])
    // each prompt was prefilled into 3 fresh blocks, so a cache that never shared would hold 6
    expect((x.length / BLOCK_SIZE) * 2).toBe(6)
    const q = PRIMM_MC_ITEMS.find((i) => i.id === 'lab07.primm.i2')?.q
    expect(q?.options[q.correct[0]].startsWith('4 blocks')).toBe(true)
  })

  test('i3’s scenario on the page’s own tree: with Z just looked up, the coldest leaf is Y, and X, the oldest, stays', () => {
    const pool = new BlockPool(32)
    const cache = new RadixCache(pool, 3)
    const x = ids(5_000, 32)
    const y = [...x, ...ids(6_000, 16)]
    const z = ids(7_000, 16)
    const w = ids(8_000, 16)
    for (const p of [x, y, z]) expect(store(cache, pool, p)).toBe(true)
    expect(cache.matchPrefix(z).len).toBe(16)
    expect(store(cache, pool, w)).toBe(true)
    expect(cache.entryCount).toBe(3)
    expect(cache.matchPrefix(y).len).toBe(32) // Y is gone: only X's 32 tokens are left of it
    expect(cache.matchPrefix(x).len).toBe(32)
    expect(cache.matchPrefix(z).len).toBe(16)
    expect(cache.matchPrefix(w).len).toBe(16)
    const q = PRIMM_MC_ITEMS.find((i) => i.id === 'lab07.primm.i3')?.q
    expect(q?.options[q.correct[0]].startsWith('Y,')).toBe(true)
  })

  test('p2’s lookups: a lookup that wants a whole cached prompt answers what each check asks, except in the chat replay', () => {
    /** The mutant p2 names, as a lookup over a flat list: the longest cached prompt that is wholly a prefix of the query. */
    const wholeOnly = (entries: number[][], q: number[]) => entries.reduce((best, e) => (e.length <= q.length && e.every((t, i) => q[i] === t) ? Math.max(best, e.length) : best), 0)
    const system = ids(1_000, 32)
    const doc = [...system, ...ids(2_000, 16)]
    // exact_match: the prompt it inserted, looked up whole
    expect(wholeOnly([ids(100, 40)], ids(100, 40))).toBe(40)
    // longest_prefix: the document plus 11 new ids picks the document over its 32-token ancestor, and an unknown query misses
    expect(wholeOnly([system, doc, [...system, ...ids(3_000, 12)]], [...doc, ...ids(9_000, 11)])).toBe(48)
    expect(wholeOnly([system, doc], ids(77_000, 20))).toBe(0)
    // cow_divergence: it looks up the two prompts it inserted
    const base = ids(30_000, 20)
    const branch = [...base, ...ids(40_000, 7)]
    expect([wholeOnly([base, branch], base), wholeOnly([base, branch], branch)]).toEqual([20, 27])
    // chat_hit_rate: 240 requests, 8 families, a 64-token system prompt then 16 ids nobody repeats
    const rng = new HarnessRng(0xc4a7)
    const cached: number[][] = []
    let whole = 0
    let tokens = 0
    let real = 0
    const pool = new BlockPool(128)
    const cache = new RadixCache(pool, 32)
    for (let i = 0; i < 240; i++) {
      const family = rng.below(8)
      const prompt = [...ids(200_000 + family * 1_000, 64), ...ids(900_000 + i * 32, 16)]
      whole += wholeOnly(cached, prompt)
      real += cache.matchPrefix(prompt).len
      tokens += prompt.length
      cached.push(prompt)
      expect(store(cache, pool, prompt)).toBe(true)
    }
    expect(whole).toBe(0)
    // the page's tree clears the check's floor of 65% on the same replay; the whole-entry lookup reuses nothing
    expect(real / tokens).toBeGreaterThanOrEqual(0.65)
    expect(real / tokens).toBeLessThanOrEqual(0.8)
    expect(LIB_RS).toContain('rate < 0.65')
    expect(LIB_RS).toContain('const REQUESTS: usize = 240')
    expect(LIB_RS).toContain('rng.below(8)')
    const q = PRIMM_MC_ITEMS.find((i) => i.id === 'lab07.primm.p2')?.q
    expect(q?.options[q.correct[0]].startsWith('`chat_hit_rate`')).toBe(true)
  })

  test('the numeric item’s lures name a mistake each and none is the answer; a lure grades as its named miss', () => {
    const i1 = PRIMM_ITEMS.find((i) => i.id === 'lab07.primm.i1') as NumberPrimm
    expect(i1.lures?.length).toBeGreaterThanOrEqual(3)
    expect(gradeNumber(i1, 20, 20).ok).toBe(true)
    for (const lure of i1.lures ?? []) {
      const g = gradeNumber(i1, lure.value, 20)
      expect(g.ok).toBe(false)
      expect(g.miss).toBe(lure.miss)
      expect(g.feedback).toContain(lure.message)
    }
  })

  test('the checks the items name exist in lib.rs with the numbers the stems quote', () => {
    for (const quoted of ['tokens(100, 40)', 'tokens(1_000, 32)', 'tokens(2_000, 16)', 'tokens(3_000, 12)', 'tokens(9_000, 11)', 'tokens(30_000, 20)', 'tokens(40_000, 7)', 'BlockAllocator::new(24, BS)']) {
      expect(LIB_RS).toContain(quoted)
    }
    expect(LIB_RS).toContain('MAX_ENTRIES: usize = 24')
    expect(LIB_RS).toContain('TOTAL: usize = 128')
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

  test('an answer is one practice item event, tagged with the item’s KCs', () => {
    const i = PRIMM_ITEMS.find((x) => x.id === 'lab07.primm.p2')
    if (i === undefined || i.kind !== 'choice') throw new Error('p2 is a choice')
    const r = itemResponse({ item: i, grade: gradeChoice(i, i.item.q.correct[0]), pick: i.item.q.correct[0] })
    expect(r.ref).toBe('item:lab07.primm.p2')
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ src: 'practice', kcs: ['t5.prefix-cache-keys'] })
  })
})

/**
 * The blind-strategy gates of verify:items, on this pool: the same code (scripts/item-cues.ts) run on lab 07's items. The
 * merged pool is judged by `bun run verify:items`; this is the lab's own margin.
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

  test('no feature isolates a key (the three-item pool is below the hit-rate bar’s minimum, so only the isolation rule applies)', () => {
    const failures = poolCueFailures('lab07.primm', items).filter((f) => f.includes('odd-one-out'))
    expect(failures).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* The hint ladder                                                     */
/* ------------------------------------------------------------------ */

describe('the faded hint ladder (§8.2): R0 to R2 for the six required checks', () => {
  const h2s = new Map<string, Set<string>>()
  for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))

  test('the bundle sets fade r2, and no rung past R2 exists', () => {
    expect(bundle.fade).toBe('r2')
    for (const c of bundle.ladder) {
      expect('r3' in c).toBe(false)
      expect('r4' in c).toBe(false)
    }
    expect(bundle.walkthrough).toBeUndefined()
  })

  test('it covers the six required checks in the order the module lists them', () => {
    expect([...LADDER_CHECK_IDS]).toEqual(required)
    expect(bundle.ladder.map((c) => c.checkId)).toEqual(required)
    expect(Object.keys(LADDER).sort()).toEqual([...required].sort())
    expect(required).toHaveLength(6)
  })

  test('verify:mentor’s lint finds nothing: limits, real H2 anchors, real check functions', () => {
    expect(lintBundle(bundle, { required, libRs: LIB_RS, h2s })).toEqual([])
  })

  test('R2 names the check’s function in lib.rs, and R1 links an H2 of the host lesson or the block-lifecycle lesson', () => {
    for (const c of bundle.ladder) {
      expect(c.r2.fn).toBe(`check_${c.checkId}`)
      expect(c.r2.text).toContain('lib.rs')
      expect(LIB_RS).toContain(`pub fn ${c.r2.fn}(`)
      expect(['t5.l6', 't5.l5']).toContain(c.r1.link.lessonId)
      expect(h2s.get(c.r1.link.lessonId)?.has(c.r1.link.anchor)).toBe(true)
    }
    expect(lab.lessonId).toBe('t5.l6')
  })

  test('every R0 states what the check does, in numbers lib.rs has', () => {
    const quoted: Record<string, string[]> = {
      exact_match: ['tokens(100, 40)', 'first.blocks.len() != 3', 'pool.allocated_blocks() != 3'],
      longest_prefix: ['tokens(1_000, 32)', 'tokens(2_000, 16)', 'tokens(3_000, 12)', 'tokens(9_000, 11)', 'hit.blocks.len() != 3', 'tokens(77_000, 20)'],
      eviction_order: ['BlockAllocator::new(32, BS)', 'RadixCache::new(pool.clone(), 3)', 'external pin', 'internal terminal prefix'],
      block_conservation: ['TOTAL: usize = 128', 'MAX_ENTRIES: usize = 24', '0..2_000usize', '70..=89', 'drains <= MAX_ENTRIES + 1'],
      cow_divergence: ['tokens(30_000, 20)', 'tokens(40_000, 7)', 'base_hit.blocks[0] != branch_hit.blocks[0]', 'pool.allocated_blocks() != 3'],
      chat_hit_rate: ['REQUESTS: usize = 240', 'rng.below(8)', 'tokens(200_000 + family as u32 * 1_000, 64)', '(0..16)', 'BlockAllocator::new(128, BS)', 'RadixCache::new(pool.clone(), 32)', 'rate < 0.65'],
    }
    for (const [id, needles] of Object.entries(quoted)) for (const n of needles) expect(LIB_RS, `${id}: ${n}`).toContain(n)
    expect(bundle.ladder.find((c) => c.checkId === 'block_conservation')?.r0.ideas.join(' ')).toContain('2,000')
    expect(bundle.ladder.find((c) => c.checkId === 'chat_hit_rate')?.r0.ideas.join(' ')).toContain('65%')
  })

  test('each rung is about this lab: no other lab’s wording leaks in, and no rung quotes a private file', () => {
    for (const c of bundle.ladder) {
      const all = [c.r0.prompt, ...c.r0.ideas, c.r1.text, c.r2.text].join(' ')
      expect(all).not.toMatch(/allocator\.rs|first-fit|coalesc|manager\.rs|tokenizer\.rs/i)
      expect(all).not.toContain('_solutions')
    }
  })

  test('acks live under hint:radix-cache/, and a rung acked there comes back open', () => {
    expect(hintRef('cow_divergence', 'R2')).toBe('hint:radix-cache/cow_divergence#R2')
    const state = restoreState({ [hintRef('exact_match', 'R0')]: '2026-10-14T00:00:00.000Z' }, 'exact_match', { red: 1, now: Date.parse('2026-10-14T00:01:00.000Z') })
    expect(state.opened.R0).toBeDefined()
    expect(state.opened.R1).toBeUndefined()
  })

  test('the panel draws a card for each red check, ends at R2 with no bottom-out, and labels its Ask-a-human post "[lab 07]"', () => {
    const rows: CheckResult[] = required.map((id) => ({ id, label: id, status: 'fail', msg: `${id} says no` }))
    const report: LabRunReport = { lab: LAB_ID, reference: false, abi: 2, version: 3, checks: rows, seeds: 'fresh', ms: 5 }
    const acks = { [hintRef('cow_divergence', 'R0')]: '2026-10-14T00:00:00.000Z' }
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HintLadderView, { bundle, reports: [report], acks, onAck: () => {}, now: () => 0 })))
    for (const id of required) expect(html).toContain(`data-check="${id}"`)
    for (const gone of ['R3', 'R4', 'Bottom-out', 'Show the walkthrough', 'Pseudo-code']) expect(html).not.toContain(gone)
    expect(html).toContain('Open R1')
    const href = /href="(https:\/\/github\.com\/[^"]*discussions\/new[^"]*)"/.exec(html)?.[1]
    expect(new URL((href ?? '').replace(/&amp;/g, '&')).searchParams.get('title')).toMatch(/^\[lab 07\] cow_divergence: /)
  })
})

/* ------------------------------------------------------------------ */
/* Prove-it v1                                                         */
/* ------------------------------------------------------------------ */

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
      expect(q.prompt + q.model).not.toContain('_solutions')
    }
    expect(bundle.prove).toEqual([...PROVE_QUESTIONS])
  })

  test('the questions cover the cache’s four jobs: lookup, recency, eviction and blocks', () => {
    const kcs = new Set(PROVE_QUESTIONS.flatMap((q) => q.kcs))
    expect(kcs).toEqual(new Set(['t5.prefix-cache-keys', 't5.radix-eviction', KC.blockRefcounts, KC.kvCopyOnWrite]))
  })

  test('the draw is three distinct questions of this pool, and a retry takes the ones not yet served', () => {
    const first = pickQuestions([], 11)
    expect(first).toHaveLength(3)
    expect(new Set(first.map((q) => q.id)).size).toBe(3)
    const second = pickQuestions([{ at: '2026-10-14T00:00:00.000Z', qids: first.map((q) => q.id), score: 1 }], 11)
    expect(second.every((q) => !first.some((f) => f.id === q.id))).toBe(true)
  })

  test('the follow-up ref and the ledger payload carry lab 07’s id, and the generic ref helper agrees with the lab’s own', () => {
    expect(PROVE_LAB_ID).toBe('radix-cache')
    expect(followUpRef('leaf-only')).toBe('item:lab07.prove.leaf-only')
    expect(followUpRefFor('radix-cache', 'leaf-only')).toBe(followUpRef('leaf-only'))
    expect(refMatchesKind('item', followUpRef('leaf-only'))).toBe(true)
    const qs = pickQuestions([], 5)
    const result = buildProveResult(
      qs,
      qs.map(() => ({ answer: 'word '.repeat(20), revealed: true, self: 1 as const })),
    )
    expect(result?.labId).toBe('radix-cache')
    expect(result?.data.qids).toEqual(qs.map((q) => q.id))
  })

  test('the model answers state what lib.rs and the calibration say: the mutants the questions name are caught by the checks they name', () => {
    const cal = JSON.parse(read('labs/radix-cache/calibration.json')) as { mutants: Record<string, { caughtBy: string[] }> }
    expect(cal.mutants.first_branch.caughtBy).toEqual(expect.arrayContaining(['longest_prefix', 'cow_divergence']))
    expect(cal.mutants.no_touch.caughtBy).toContain('eviction_order')
    expect(cal.mutants.evict_internal.caughtBy).toContain('eviction_order')
    expect(cal.mutants.exact_only.caughtBy).toContain('chat_hit_rate')
    expect(cal.mutants.share_tail.caughtBy).toContain('cow_divergence')
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

/* ------------------------------------------------------------------ */
/* Prove-it v2: fake modules                                           */
/* ------------------------------------------------------------------ */

type Handler = (cmd: string) => string

/** What a fake gets wrong. The default is a correct cache: the longest token prefix any cached prompt shares with the query. */
interface Opts {
  /** match-len's bug: the first cached prompt that shares any prefix with the query wins, not the deepest. */
  firstBranch?: boolean
  /** A lookup that hits only when a whole cached prompt is a prefix of the query. */
  exactOnly?: boolean
  /** match-after-split's bug: a prompt that parts from a cached one cuts the cached prompt down to the shared prefix (the split loses the first branch's tail). */
  dropsFirstBranch?: boolean
  /** A lookup that stops where cached paths part, instead of following the query into a branch. */
  stopsAtSplit?: boolean
  /** The answer rounded down to whole blocks unless a whole cached prompt is a prefix of the query: a block-granular lookup. */
  wholeBlocks?: boolean
  /** A lookup that walks a real trie but only matches at nodes (never into the middle of an edge). */
  nodesOnly?: boolean
}

const common = (a: readonly number[], b: readonly number[]): number => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** A line-protocol cache over the bridge's verbs: reset, insert <ids>, match <ids>. */
function fakeCache(o: Opts = {}): () => Handler {
  return () => {
    let entries: number[][] | null = null
    const parse = (text: string | undefined): number[] | null => {
      if (text === undefined || text === '') return []
      if (!/^\d+(,\d+)*$/.test(text)) return null
      return text.split(',').map(Number)
    }
    return (cmd) => {
      const [op, arg] = cmd.trim().split(/\s+/)
      if (op === 'reset') {
        entries = []
        return 'ok'
      }
      if (entries === null) return 'err not initialized (send reset first)'
      const tokens = parse(arg)
      if (tokens === null) return 'err bad token id'
      if (op === 'insert') {
        if (tokens.length === 0) return 'err insert needs at least one token id'
        if (!entries.some((e) => e.length === tokens.length && common(e, tokens) === tokens.length)) {
          if (o.dropsFirstBranch) {
            entries = entries.map((e) => {
              const c = common(e, tokens)
              return c > 0 && c < e.length && c < tokens.length ? e.slice(0, c) : e
            })
            // cutting two prompts to the same prefix leaves one entry of it
            entries = entries.filter((e, i) => entries?.findIndex((x) => x.length === e.length && common(x, e) === e.length) === i)
          }
          entries.push(tokens)
        }
        return `ok ${entries.length}`
      }
      if (op !== 'match') return `err unknown command '${cmd.slice(0, 20)}'`
      if (o.nodesOnly) return String(nodeMatch(entries, tokens))
      let best = 0
      let seen = false
      for (const e of entries) {
        const c = common(e, tokens)
        if (c === 0) continue
        const whole = c === e.length
        let value = c
        if (o.exactOnly) value = whole ? c : 0
        if (o.wholeBlocks && !whole) value = Math.floor(c / BLOCK_SIZE) * BLOCK_SIZE
        if (o.firstBranch) {
          if (seen) continue
          seen = true
          best = value
          continue
        }
        best = Math.max(best, value)
      }
      if (o.stopsAtSplit) best = Math.min(best, splitPoint(entries, tokens))
      return String(best)
    }
  }
}

/** The length of the shared path where the query first reaches a point at which two cached prompts part (or the longest if none does). */
function splitPoint(entries: number[][], q: number[]): number {
  let point = Infinity
  for (const a of entries) {
    for (const b of entries) {
      if (a === b) continue
      const c = common(a, b)
      if (c < a.length && c < b.length && common(a, q) >= c && common(b, q) >= c) point = Math.min(point, c)
    }
  }
  return point
}

/** A compressed trie built from the entries, matched node by node: a query that parts from an edge halfway stops at the node above it. */
function nodeMatch(entries: number[][], q: number[]): number {
  interface N {
    edge: number[]
    kids: N[]
  }
  const root: N = { edge: [], kids: [] }
  const add = (tokens: number[]) => {
    let at = root
    let depth = 0
    while (depth < tokens.length) {
      const kid = at.kids.find((k) => k.edge[0] === tokens[depth])
      if (kid === undefined) {
        at.kids.push({ edge: tokens.slice(depth), kids: [] })
        return
      }
      const c = common(kid.edge, tokens.slice(depth))
      if (c < kid.edge.length) {
        const rest: N = { edge: kid.edge.slice(c), kids: kid.kids }
        kid.edge = kid.edge.slice(0, c)
        kid.kids = [rest]
      }
      depth += c
      at = kid
    }
  }
  for (const e of entries) add(e)
  let at = root
  let depth = 0
  for (;;) {
    const kid = at.kids.find((k) => k.edge[0] === q[depth])
    if (kid === undefined || common(kid.edge, q.slice(depth)) < kid.edge.length) return depth
    depth += kid.edge.length
    at = kid
  }
}

/** The app's own tree (src/lib/world/radix.ts) behind the same protocol: the bridge's 1,024 blocks and 256 entries. */
function treeCache(): () => Handler {
  return () => {
    let pool: BlockPool | null = null
    let cache: RadixCache | null = null
    return (cmd) => {
      const [op, arg] = cmd.trim().split(/\s+/)
      if (op === 'reset') {
        pool = new BlockPool(1_024)
        cache = new RadixCache(pool, 256)
        return 'ok'
      }
      if (pool === null || cache === null) return 'err not initialized (send reset first)'
      const tokens = arg === undefined ? [] : arg.split(',').map(Number)
      if (op === 'match') return String(cache.matchPrefix(tokens).len)
      if (op === 'insert') return store(cache, pool, tokens) ? `ok ${cache.entryCount}` : 'err the cache could not admit the prompt'
      return 'err unknown command'
    }
  }
}

const answerOn = async (t: ProveV2Template, seed: number, module: () => Handler): Promise<number> => {
  const replies = await fakeBridge(module).run(new ArrayBuffer(0), planQuestion(t, seed).calls)
  return t.read(replies) as number
}

const SEEDS = [...Array.from({ length: 240 }, (_, i) => i), 4_000_000_000, 0xffffffff, 123_456_789]
const VERBS = ['reset', 'insert', 'match']

/* ------------------------------ the bundle ------------------------------ */

describe('lab 07 exposes Prove-it v2', () => {
  test('the bundle carries the two templates, in the order the panel rotates them, and no match-cold', async () => {
    expect(bundle.prove2).toBe(PROVE2)
    expect(PROVE2.templates.map((t) => t.id)).toEqual(['match-len', 'match-after-split'])
    expect((await loadForgeBundle('radix-cache')).prove2?.templates.map((t) => t.id)).toEqual(['match-len', 'match-after-split'])
    expect(PROVE2.templates.some((t) => /cold/.test(t.id))).toBe(false)
  })

  test('each template names the KC of the checks it exercises and the bug its test separates', () => {
    expect(MATCH_LEN.kcs).toEqual(['t5.prefix-cache-keys'])
    expect(MATCH_AFTER_SPLIT.kcs).toEqual(['t5.prefix-cache-keys'])
    for (const t of PROVE2.templates) {
      expect(t.bug.length).toBeGreaterThan(20)
      for (const k of t.kcs) expect(kcValues.has(k)).toBe(true)
    }
  })

  test('the bridge speaks the verbs the templates use: reset, insert <ids> and match <ids>', () => {
    for (const verb of ['["reset"]', '["insert", ids]', '["match", ids]']) expect(LIB_RS).toContain(verb)
    expect(LIB_RS).toContain('const BRIDGE_BLOCKS: usize = 1_024')
    expect(LIB_RS).toContain('const BRIDGE_ENTRIES: usize = 256')
    expect(BLOCK).toBe(BLOCK_SIZE)
  })
})

/* ------------------------------ the trace contract ------------------------------ */

describe('every trace is at most 12 calls of the bridge verbs, told in words, with a number to predict', () => {
  test('on every seed: 4 or 5 calls, a reset first, a match last, only the three verbs, a numeric answer', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        expect(q.calls.length).toBe(t === MATCH_LEN ? 5 : 4)
        expect(q.calls[0]).toBe('reset')
        expect(q.calls[q.calls.length - 1].startsWith('match ')).toBe(true)
        for (const c of q.calls) expect(VERBS).toContain(c.split(' ')[0])
        expect(q.calls.slice(1, -1).every((c) => c.startsWith('insert '))).toBe(true)
        expect(q.answer).toBe('number')
        expect(q.ask.endsWith('?')).toBe(true)
      }
    }
  })

  test('the story tells every insert, in order, with its id runs; the ask names the query’s; no length is stated', () => {
    const runs = (ids: number[]): string => {
      const parts: string[] = []
      for (let i = 0; i < ids.length; ) {
        let j = i
        while (j + 1 < ids.length && ids[j + 1] === ids[j] + 1) j++
        parts.push(j === i ? `id ${ids[i]}` : `ids ${ids[i]} to ${ids[j]}`)
        i = j + 1
      }
      return parts.join(', then ')
    }
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        const inserts = q.calls.filter((c) => c.startsWith('insert '))
        expect(q.story).toHaveLength(inserts.length + 1)
        expect(q.story[0]).toBe(`Reset the cache. Its blocks hold ${BLOCK} tokens each.`)
        inserts.forEach((c, i) => expect(q.story[i + 1]).toBe(`Insert a prompt: ${runs(c.slice('insert '.length).split(',').map(Number))}.`))
        const query = q.calls[q.calls.length - 1].slice('match '.length).split(',').map(Number)
        expect(q.ask).toContain(runs(query))
        expect(q.ask).toContain('`match`')
        // runs split where ids stop being consecutive, so a prompt that goes on from a shared run is told as the runs it is
        for (const line of [...q.story, q.ask]) expect(line).not.toMatch(/prompt of \d+ tokens?/)
      }
    }
  })

  test('the same seed gives the same question', () => {
    for (const t of PROVE2.templates) expect(planQuestion(t, 77)).toEqual(planQuestion(t, 77))
  })

  test('a prompt’s ids are distinct, so a run can be told by its first and last id', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        for (const c of planQuestion(t, seed).calls.slice(1)) {
          const toks = c.split(' ')[1].split(',').map(Number)
          expect(new Set(toks).size).toBe(toks.length)
        }
      }
    }
  })

  test('no trace comes near the bridge’s limits: every insert replies ok and the cache never evicts', async () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        const replies = await fakeBridge(treeCache()).run(new ArrayBuffer(0), q.calls)
        expect(replies[0]).toBe('ok')
        q.calls.forEach((c, i) => {
          if (c.startsWith('insert ')) expect(replies[i]).toMatch(/^ok \d+$/)
          expect(c.length).toBeLessThan(1_000)
        })
        expect(Math.max(...q.calls.map((c) => (c.startsWith('insert ') ? c.split(',').length : 0)))).toBeLessThanOrEqual(1_024 * BLOCK_SIZE)
      }
    }
  })
})

/* ------------------------------ the rule: your code, not the story ------------------------------ */

describe('the fakes stand for real modules', () => {
  test('the correct flat-list fake answers every template as the app’s radix tree does (token for token, 1,024 blocks, 256 entries)', async () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) expect(await answerOn(t, seed, fakeCache()), `${t.id} seed ${seed}`).toBe(await answerOn(t, seed, treeCache()))
    }
  })

  test('every kind of correct lookup agrees on every seed: token for token, at nodes only, and by whole blocks', async () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const right = await answerOn(t, seed, fakeCache())
        expect(await answerOn(t, seed, fakeCache({ nodesOnly: true })), `${t.id} seed ${seed}: nodes only`).toBe(right)
        expect(await answerOn(t, seed, fakeCache({ wholeBlocks: true })), `${t.id} seed ${seed}: whole blocks`).toBe(right)
      }
    }
  })

  test('every shared prefix is a whole number of blocks, and every query leaves the cached paths at an id nothing has used', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        const prompts = q.calls.slice(1).map((c) => c.split(' ')[1].split(',').map(Number))
        const query = prompts[prompts.length - 1]
        const cached = prompts.slice(0, -1)
        // where two cached prompts part, they have shared a whole number of blocks
        for (const a of cached) for (const b of cached) if (a !== b && common(a, b) > 0 && common(a, b) < Math.min(a.length, b.length)) expect(common(a, b) % BLOCK_SIZE).toBe(0)
        // the query's next id after the path it follows is one no cached prompt holds at that depth, and the path ends at a prompt's end or a part
        const follows = Math.max(...cached.map((e) => common(e, query)))
        expect(follows).toBeGreaterThan(0)
        expect(follows).toBeLessThan(query.length)
        for (const e of cached) expect(e[follows] === query[follows]).toBe(false)
        const endsOrParts = cached.some((e) => e.length === follows && common(e, query) === follows) || cached.filter((e) => common(e, query) >= follows).length >= 2
        expect(endsOrParts, `${t.id} seed ${seed}`).toBe(true)
      }
    }
  })
})

describe('the answer is not given by the story alone, and a plausible bug changes it', () => {
  const across = async (t: ProveV2Template, module: () => Handler) => {
    const answers = new Set<number>()
    for (const seed of SEEDS) answers.add(await answerOn(t, seed, module))
    return answers
  }

  test('one correct module answers differently across seeds, and never 0 (every module replies 0 only for a query that shares nothing)', async () => {
    for (const t of PROVE2.templates) {
      const answers = await across(t, fakeCache())
      expect(answers.size).toBeGreaterThanOrEqual(30)
      expect(answers.has(0)).toBe(false)
    }
  })

  test('the answer depends on the code path it exercises: the same story shape gives different answers by the branch the query takes', async () => {
    // match-after-split: the query follows the shared system prompt, the first branch or the second, three different answers
    const seen = new Map<string, Set<number>>()
    for (const seed of SEEDS) {
      const q = planQuestion(MATCH_AFTER_SPLIT, seed)
      const [a, b, m] = q.calls.slice(1).map((c) => c.split(' ')[1].split(',').map(Number))
      const kind = common(a, m) === common(a, b) && common(b, m) === common(a, b) ? 'split' : 'branch'
      seen.set(kind, (seen.get(kind) ?? new Set()).add(await answerOn(MATCH_AFTER_SPLIT, seed, fakeCache())))
    }
    expect(seen.get('split')?.size).toBeGreaterThanOrEqual(3)
    expect(seen.get('branch')?.size).toBeGreaterThanOrEqual(10)
  })

  test('match-len: returning the first cached prompt that shares any prefix answers wrong on a good share of seeds, and never more than the deepest match', async () => {
    let differs = 0
    for (const seed of SEEDS) {
      const right = await answerOn(MATCH_LEN, seed, fakeCache())
      const bugged = await answerOn(MATCH_LEN, seed, fakeCache({ firstBranch: true }))
      expect(bugged).toBeLessThanOrEqual(right)
      if (bugged !== right) differs++
    }
    expect(differs).toBeGreaterThan(SEEDS.length * 0.25)
  })

  test('match-len: a lookup that wants a whole cached prompt answers wrong when the query leaves where two prompts part', async () => {
    let differs = 0
    for (const seed of SEEDS) {
      if ((await answerOn(MATCH_LEN, seed, fakeCache({ exactOnly: true }))) !== (await answerOn(MATCH_LEN, seed, fakeCache()))) differs++
    }
    expect(differs).toBeGreaterThan(SEEDS.length * 0.1)
  })

  test('match-after-split: a split that drops the first branch’s tail answers wrong when the query follows that branch', async () => {
    let differs = 0
    for (const seed of SEEDS) {
      const q = planQuestion(MATCH_AFTER_SPLIT, seed)
      const right = await answerOn(MATCH_AFTER_SPLIT, seed, fakeCache())
      const bugged = await answerOn(MATCH_AFTER_SPLIT, seed, fakeCache({ dropsFirstBranch: true }))
      expect(bugged).toBeLessThanOrEqual(right)
      if (bugged !== right) {
        differs++
        // the first insert is the branch that was dropped, and the query follows it
        const [first, , query] = q.calls.slice(1).map((c) => c.split(' ')[1].split(',').map(Number))
        expect(common(first, query)).toBe(right)
      }
    }
    expect(differs).toBeGreaterThan(SEEDS.length * 0.2)
  })

  test('match-after-split: a lookup that stops where the paths part answers the split point for every query that goes on past it', async () => {
    let differs = 0
    for (const seed of SEEDS) {
      const right = await answerOn(MATCH_AFTER_SPLIT, seed, fakeCache())
      const bugged = await answerOn(MATCH_AFTER_SPLIT, seed, fakeCache({ stopsAtSplit: true }))
      if (bugged !== right) differs++
    }
    expect(differs).toBeGreaterThan(SEEDS.length * 0.5)
  })

  test('worked by hand: seed 1 and 3 of match-len, seeds 1 to 3 of match-after-split, their stories and their answers', async () => {
    // match-len 1: the cache holds S + tools, S + document + extension, S + document, with S = ids 400 to 431 (32 tokens),
    // the document 10800 to 10813 (14) and the extension 25300 to 25315 (16). The query is the extended document and then
    // ids nothing has used, so it follows S, the document and the extension: 32 + 14 + 16 = 62. The first prompt told
    // shares only S with it, so a lookup that takes the first prompt sharing any prefix answers 32.
    const a = planQuestion(MATCH_LEN, 1)
    expect(a.story.slice(1)).toEqual([
      'Insert a prompt: ids 400 to 431, then ids 20900 to 20924.',
      'Insert a prompt: ids 400 to 431, then ids 10800 to 10813, then ids 25300 to 25315.',
      'Insert a prompt: ids 400 to 431, then ids 10800 to 10813.',
    ])
    expect(a.ask).toContain('ids 400 to 431, then ids 10800 to 10813, then ids 25300 to 25315, then ids 30500 to 30504')
    expect(await answerOn(MATCH_LEN, 1, fakeCache())).toBe(32 + 14 + 16)
    expect(await answerOn(MATCH_LEN, 1, fakeCache({ firstBranch: true }))).toBe(32)
    // match-len 3: S = ids 600 to 647 (48), then the document (10100 to 10131), the tools (20800 to 20835, 36 tokens) and the
    // extended document. The query follows S and the tools: 48 + 36 = 84. The first prompt told is S + document, which
    // shares S only.
    expect(planQuestion(MATCH_LEN, 3).ask).toContain('ids 600 to 647, then ids 20800 to 20835, then ids 30800 to 30803')
    expect(await answerOn(MATCH_LEN, 3, fakeCache())).toBe(48 + 36)
    expect(await answerOn(MATCH_LEN, 3, fakeCache({ firstBranch: true }))).toBe(48)
    // match-after-split 1: S (32) then a first branch (10900 to 10934, 35 tokens) and a second (20400 to 20412). The query
    // follows the first branch: 32 + 35 = 67. A split that drops the first branch's tail leaves only S, 32.
    expect(planQuestion(MATCH_AFTER_SPLIT, 1).story.slice(1)).toEqual(['Insert a prompt: ids 400 to 431, then ids 10900 to 10934.', 'Insert a prompt: ids 400 to 431, then ids 20400 to 20412.'])
    expect(await answerOn(MATCH_AFTER_SPLIT, 1, fakeCache())).toBe(32 + 35)
    expect(await answerOn(MATCH_AFTER_SPLIT, 1, fakeCache({ dropsFirstBranch: true }))).toBe(32)
    // match-after-split 2: the query follows the second branch (10700 to 10735, 36 tokens) after S (16): 16 + 36 = 52. The
    // dropped branch is the other one, so that bug still answers 52, and a lookup that stops where the paths part answers 16.
    expect(await answerOn(MATCH_AFTER_SPLIT, 2, fakeCache())).toBe(16 + 36)
    expect(await answerOn(MATCH_AFTER_SPLIT, 2, fakeCache({ dropsFirstBranch: true }))).toBe(52)
    expect(await answerOn(MATCH_AFTER_SPLIT, 2, fakeCache({ stopsAtSplit: true }))).toBe(16)
    // match-after-split 3: the query is S (ids 600 to 647) and ids nothing has used, so it leaves at the split: 48.
    expect(planQuestion(MATCH_AFTER_SPLIT, 3).ask).toContain('ids 600 to 647, then ids 30800 to 30806')
    expect(await answerOn(MATCH_AFTER_SPLIT, 3, fakeCache())).toBe(48)
    // and the cache the app ships answers the same, 62
    expect(await answerOn(MATCH_LEN, 1, treeCache())).toBe(62)
  })
})

/* ------------------------------ through the core ------------------------------ */

describe('graded by the core against your module', () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 2]).buffer
  const hash = async () => 'ab'.repeat(32)

  test('the right answer on the module the unseen run graded is proved; the bug’s answer is a miss that shows the module’s', async () => {
    for (const t of PROVE2.templates) {
      // a seed whose bug changes the answer
      const seed = SEEDS.find((s) => s > 0) as number
      let use = seed
      for (const s of SEEDS) {
        const right = await answerOn(t, s, fakeCache())
        const bug = t === MATCH_LEN ? { firstBranch: true } : { stopsAtSplit: true }
        if ((await answerOn(t, s, fakeCache(bug))) !== right) {
          use = s
          break
        }
      }
      const plan = planQuestion(t, use)
      const right = await answerOn(t, use, fakeCache())
      const wrong = await answerOn(t, use, fakeCache(t === MATCH_LEN ? { firstBranch: true } : { stopsAtSplit: true }))
      expect(wrong).not.toBe(right)
      const go = (answer: number) =>
        proveFromModule({ labId: 'radix-cache', template: t, plan, answer, bytes, graded: { sha256: 'ab'.repeat(32), credit: 'unseen' }, history: [], now: 0, run: fakeBridge(fakeCache()).run, hash })
      const hit = await go(right)
      const miss = await go(wrong)
      if (hit.kind !== 'graded' || miss.kind !== 'graded') throw new Error('refused')
      expect(hit.result).toMatchObject({ provenance: 'proved', score: 1, ok: true, seed: use, data: { v: 2, qid: t.id, answer: right, actual: right, calls: plan.calls.length } })
      expect(miss.result).toMatchObject({ provenance: 'practice', score: 0, ok: false, data: { answer: wrong, actual: right } })
    }
  })

  test('a module that replies anything but ok to an insert, or anything but a number to the match, fails the trace instead of being read as an answer', () => {
    for (const t of PROVE2.templates) {
      const plan = planQuestion(t, 9)
      const good = plan.calls.map((c, i) => (i === 0 ? 'ok' : c.startsWith('insert') ? `ok ${i}` : '5'))
      expect(gradeAnswer(t, 5, { kind: 'replied', replies: good })).toMatchObject({ right: true, actual: 5 })
      const refused = good.map((r, i) => (i === 1 ? 'err the cache could not admit the prompt' : r))
      expect(gradeAnswer(t, 5, { kind: 'replied', replies: refused })).toMatchObject({ right: false, actual: null, failed: 'error' })
      const noMatch = good.map((r, i) => (i === good.length - 1 ? 'err not initialized (send reset first)' : r))
      expect(gradeAnswer(t, 5, { kind: 'replied', replies: noMatch })).toMatchObject({ right: false, actual: null, failed: 'error' })
      const noReset = good.map((r, i) => (i === 0 ? 'err unknown command' : r))
      expect(gradeAnswer(t, 5, { kind: 'replied', replies: noReset })).toMatchObject({ right: false, actual: null, failed: 'error' })
    }
  })
})

/* ------------------------------------------------------------------ */
/* The bundle                                                          */
/* ------------------------------------------------------------------ */

describe('the bundle', () => {
  test('the registry finds it by directory name and loads the same object', async () => {
    expect(await forgeBundleIds()).toContain('radix-cache')
    expect(await loadForgeBundle('radix-cache')).toBe(bundle)
    expect(await findForgeBundle('radix-cache')).toBe(bundle)
    expect((await loadAllForgeBundles()).map((b) => b.labId)).toContain('radix-cache')
  })

  test('it is lab 07, labelled "[lab 07]", faded to R2, with no walkthrough and six Prove-it questions', () => {
    expect(bundle.labId).toBe(LAB_ID)
    expect(bundle.labId).toBe('radix-cache')
    expect(bundle.discussionsLabel).toBe(DISCUSSIONS_LABEL)
    expect(bundle.discussionsLabel).toBe('[lab 07]')
    expect(bundle.fade).toBe('r2')
    expect(bundle.walkthrough).toBeUndefined()
    expect(bundle.prove).toHaveLength(6)
    expect(lab.index).toBe(7)
  })

  test('the generic panels render it: PRIMM steps, the reference strip, the stage list', () => {
    const predict = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks, passed: new Set<string>(), initial: 'predict', title: lab.title }))
    expect(predict).toContain(`aria-label="${lab.title}, in five steps"`)
    expect(predict).toContain('data-item="lab07.primm.p1"')
    expect(predict).toContain('data-item="lab07.primm.p2"')
    const modify = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks, passed: new Set<string>(), initial: 'modify' }))
    expect(modify).toContain('entry limit 12 becomes 6 (halved)')
    expect(modify).toContain('entry limit 12 becomes 24 (doubled)')
    const strip = renderToStaticMarkup(createElement(ReferenceRun, { bundle, config: RUN_SPEC.reference }))
    expect(strip).toContain('data-reference-run="radix-cache"')
    expect(strip).toContain('role="img"')
    const stages = renderToStaticMarkup(createElement(StagePanel, { bundle, checks, passed: new Set<string>() }))
    expect(stages).toContain('Exact')
    expect(stages).toContain('Leaves and sharing')
    expect(stages).toContain('Churn')
  })

  test('the Modify step grades in the item’s own unit: requests, not ops', () => {
    const src = read('src/components/forge/PrimmPanel.tsx')
    expect(src).toContain("m1.unit === 'ops'")
  })
})
