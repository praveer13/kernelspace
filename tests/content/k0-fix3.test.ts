import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { claimNumber, getClaim } from '@/data/claims'
import { claimCite as registryCite, claimRelease as registryRelease } from '@/data/claims/cite'
import '@/data/claims/lazy/kvpool'
import { ALL_LESSONS } from '@/data/lessons'
import * as lessonClaims from '@/data/lessons/claims'
import { mixRange, mixWastePct } from '@/data/lessons/pagedMix'
import pagedWaste from '@/data/errata/2026-11-21-paged-waste-not-the-papers-figure'
import blockErratum from '@/data/errata/2026-11-21-vllm-default-block-size-64'
import { CTX_STEPS } from '@/lib/sims/models/kv'
import * as kvModel from '@/lib/sims/models/kv'

/**
 * K0-FIX3, the last fix round of k0-repin. One account of vLLM's block size and of KV waste, given the same way by the
 * lessons (t1.l4, t2.l7, t5.l5, t5.l6), the two errata, the KV simulator and the claims:
 *   - vLLM's default block is production.vllm.block-size, read at the pinned release; it is the default on CUDA, ROCm's
 *     paged-attention backend keeps its own size, and an explicit --block-size overrides either (the release notes).
 *   - The 2023 paper chose serving.pagedattention.paper-block-size (Section 7.2).
 *   - The paper's words on waste are "near-zero waste"; its Figure 2 labels vLLM's bar with
 *     serving.pagedattention.fig2-vllm-token-states (token states), an average over one experiment (§6.2), not a bound.
 *   - "Under 4%" is the course's estimate (synthetic.kv.paged-waste), not the paper's: the lessons' mixed batch is under it
 *     at the paper's block and over it at vLLM's; the KV calculator books it flat and shows the mean tail it stands for.
 */

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const lesson = (id: string) => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return l
}
const text = (id: string) => strings(lesson(id)).join('\n')
const root = new URL('../../', import.meta.url).pathname
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8')

const FIG2 = 'serving.pagedattention.fig2-vllm-token-states'
const PAPER = claimNumber('serving.pagedattention.paper-block-size')
const ENGINE = claimNumber('production.vllm.block-size')
const CITE = registryCite('production.vllm.block-size')
const BOUND = claimNumber('synthetic.kv.paged-waste')
const scope = () => (lessonClaims as Record<string, unknown>).ENGINE_BLOCK_SCOPE as string | undefined

describe("B1/R1: vLLM's default is stated once per lesson, on CUDA, with the same scope words and no ROCm number", () => {
  test('the scope words exist and name no number', () => {
    expect(scope()).toBeString()
    expect(scope()).toContain('ROCm')
    expect(scope()).toContain('--block-size')
    expect(scope()).not.toMatch(/\d/)
  })

  for (const id of ['t1.l4', 't2.l7', 't5.l5', 't5.l6']) {
    test(`${id}: "vLLM's default on CUDA is <cite>" with the scope words, exactly once`, () => {
      const t = text(id)
      expect(t).toContain(`vLLM's default on CUDA is ${CITE}`)
      expect(t).toContain(String(scope()))
      expect(t.match(/\bon CUDA\b/g)).toHaveLength(1)
      expect(read(`public/lessons-md/${id}.md`)).toContain(`vLLM's default on CUDA is ${CITE}`)
    })
  }

  test('no lesson types a ROCm block size', () => {
    for (const l of ALL_LESSONS) expect(strings(l).join('\n')).not.toMatch(/ROCm[^.;\n]{0,60}?\b(?:keeps|uses)\s+\d/)
  })

  test("the block-size erratum's after gives the same scope words", () => {
    expect(blockErratum.after).toContain('on CUDA')
    expect(blockErratum.after).toContain(String(scope()).replace(/`/g, ''))
  })
})

describe("B2/R10: t1.l4's exercise note reads both block sizes from their claims, and t5.l5 still weighs them", () => {
  test('the source types no number after "vLLM\'s"', () => {
    expect(read('src/data/lessons/t1/fragmentation.ts')).not.toMatch(/vLLM's \d/)
  })
  test('the rendered note names the paper and vLLM default from the claims', () => {
    expect(text('t1.l4')).toContain(`remember this when T5 weighs the paper's ${PAPER} against vLLM's default of ${ENGINE}.`)
    expect(text('t1.l4')).not.toMatch(/16 vs 32/)
  })
  test('t5.l5 does weigh them, as the note promises', () => {
    expect(text('t5.l5')).toContain(`The paper chose ${PAPER} tokens, and ${registryRelease('production.vllm.block-size')} defaults to ${ENGINE}.`)
  })
})

describe('R2: the KV simulator says what the lessons say: a course figure, with the mean tail it stands for', () => {
  const sim = read('src/components/sims/KvCacheSim.tsx')
  test('the simulator computes the mean tail share and no longer prints the stand-in as a bound', () => {
    const tail = (kvModel as Record<string, unknown>).tailWastePct as ((ctx: number) => number) | undefined
    expect(typeof tail).toBe('function')
    expect(tail!(CTX_STEPS[0])).toBeCloseTo((100 * (ENGINE / 2)) / CTX_STEPS[0], 10)
    expect(tail!(CTX_STEPS[0])).toBeLessThanOrEqual(BOUND)
    expect(sim).not.toContain('waste &lt;{PAGED_WASTE_PCT}%')
    expect(sim).not.toMatch(/waste <\$\{PAGED_WASTE_PCT\}%/)
    expect(sim).toContain('tailWastePct(ctx)')
    expect(sim).toContain('course estimate')
  })
  test("the stand-in claim's boundary gives the same account", () => {
    const b = getClaim('synthetic.kv.paged-waste').boundary ?? ''
    expect(b).not.toContain('No source for this exact figure')
    expect(b).toContain("course's estimate")
    expect(b).toContain('near-zero waste')
    expect(b).toContain(FIG2)
    // what the boundary says of the lessons' mixed batch holds for the claims as they stand
    expect(Number(mixWastePct(PAPER))).toBeLessThan(BOUND)
    expect(Number(mixWastePct(ENGINE))).toBeGreaterThan(BOUND)
  })
})

describe("R3: t1.l4's waste chip names its block size in the visible label", () => {
  test('the label reads the paper block from its claim', () => {
    const chip = lesson('t1.l4').blocks.find((b) => b.type === 'statline')
    if (chip?.type !== 'statline') throw new Error('no statline')
    const waste = chip.stats.find((s) => s.value === `<${BOUND}%`)
    expect(waste?.label).toBe(`KV waste, mixed batch at the paper's ${PAPER}-token blocks (course estimate)`)
    expect(read('src/data/lessons/t1/fragmentation.ts')).not.toContain("label: 'KV waste at 16-token blocks")
  })
})

describe('R4: one story for "<4%" and Figure 2, in the erratum, t1.l4, t2.l7, t5.l5 and the claim', () => {
  test("Figure 2's vLLM bar is a claim, quoted from the caption, and rendered where a lesson gives it", () => {
    const c = getClaim(FIG2)
    expect(c.value).toBe(96.3)
    expect(c.source?.quote).toBe('Average percentage of memory wastes in different LLM serving systems during the experiment in §6.2.')
    expect(c.source?.url).toBe('https://arxiv.org/html/2309.06180v1')
    expect(c.verifiedAt).toBe('2026-11-21')
    for (const id of ['t1.l4', 't2.l7', 't5.l5']) expect(text(id)).toContain(`${claimNumber(FIG2)}% token states`)
  })

  test('no source file types the Figure 2 number', () => {
    for (const f of [
      'src/data/lessons/t1/fragmentation.ts',
      'src/data/lessons/t2/exam-pagedattention.ts',
      'src/data/lessons/t5/pagedattention-deep-dive.ts',
      'src/data/lessons/pagedMix.ts',
      'src/data/errata/2026-11-21-paged-waste-not-the-papers-figure.ts',
      'src/components/sims/KvCacheSim.tsx',
    ])
      expect(read(f)).not.toContain('96.3')
  })

  const PHRASES = ['near-zero waste', 'Figure 2', 'one experiment', 'not a bound', "the course's estimate"]
  test('the erratum after, t1.l4 and t5.l5 give the same account', () => {
    for (const p of PHRASES) {
      expect(pagedWaste.after).toContain(p)
      expect(text('t1.l4')).toContain(p)
      expect(text('t5.l5')).toContain(p)
    }
  })

  test('t1.l4 and t5.l5 give the same waste sentences, built once from the claims and the mix', () => {
    const story = `The paper's Figure 2 labels vLLM's bar ${claimNumber(FIG2)}% token states: an average over one experiment (§6.2), not a bound. "Under ${BOUND}%" is the course's estimate, not the paper's, and it holds only where blocks are small next to the sequences: the course's mixed batch of eight sequences (${mixRange()} tokens) wastes ${mixWastePct(PAPER)}% at the paper's ${PAPER}-token blocks and ${mixWastePct(ENGINE)}% at vLLM's default of ${ENGINE}.`
    expect(text('t1.l4')).toContain(story)
    expect(text('t5.l5')).toContain(story)
    expect(read('src/data/lessons/t5/pagedattention-deep-dive.ts')).not.toMatch(/\(\d+ to \d+ tokens\)/)
  })

  test("the erratum's title, source and item answer tell the same story", () => {
    // the heading face draws U+0022 as a closing curl wherever it sits, so neither erratum of this pull request uses it
    for (const e of [pagedWaste, blockErratum]) expect(e.title).not.toContain('"')
    expect(pagedWaste.title).toMatch(/^[\p{L}\p{N}]/u)
    expect(pagedWaste.title).toMatch(/[\p{L}\p{N}]$/u)
    expect(pagedWaste.source.title).toContain('Figure 2')
    const why = pagedWaste.items[0]!.why
    expect(why[1]).toContain("the course's estimate")
    expect(why[1]).not.toContain('rounding')
    expect(why[2]).toContain('(Figure 2) covers the earlier systems and vLLM')
  })
})

describe('R6: t5.l5 prints the pool claims as the claims give them, and reads cleanly', () => {
  const fraction = () => (lessonClaims as Record<string, unknown>).fractionText as ((v: number) => string) | undefined
  test('a fraction prints with its own digits, and a whole number keeps one decimal', () => {
    expect(fraction()?.(0.92)).toBe('0.92')
    expect(fraction()?.(1)).toBe('1.0')
    expect(fraction()?.(0.9)).toBe('0.9')
  })
  test('the util default is the claim value, and no sentence points at an unnamed file', () => {
    const t = text('t5.l5')
    expect(t).toContain(`defaults to ${fraction()?.(claimNumber('production.vllm.gpu-memory-utilization'))} with it on`)
    expect(t).not.toContain('same file')
  })
  test('the first block-size sentences are whole sentences', () => {
    expect(text('t5.l5')).not.toMatch(/tokens; vLLM's default on CUDA is [^;\n]*; ROCm/)
    expect(text('t1.l4')).not.toMatch(/2023 paper, vLLM's default/)
  })
})

describe('R7: t2.l7 points at Figure 2 and the paper\'s sections as they are', () => {
  test('the Figure 2 callout names its legend and Section 3.1', () => {
    const t = text('t2.l7')
    expect(t).toContain('token states, reservation, internal frag., and external frag. & others')
    expect(t).toContain('§3.1')
    expect(t).not.toContain('never says "allocator,"')
    expect(t).not.toMatch(/§2 (?:is an allocator autopsy|diagnose)/)
  })
  test("the waste question keeps its options, key and position", () => {
    const quiz = lesson('t2.l7').blocks.filter((b) => b.type === 'quiz')[0]
    if (quiz?.type !== 'quiz') throw new Error('no quiz')
    const q = quiz.questions[0]!
    expect(q.correct).toEqual([1])
    expect(q.options[1]).toBe('Internal fragmentation from worst-case reservation, external fragmentation from variable segments, and duplicated KV prefixes')
    expect(q.q).toContain('Section 1')
    expect(q.explanation).toContain('§3.1')
  })
})

describe('R8: no stale statement that Figure 2 is unread, and boundaries cite what their sources hold', () => {
  test('the spec no longer lists Figure 2 as unsettled', () => {
    expect(read('docs/specs/k0.md')).not.toContain("whether the PagedAttention paper's Figure 2 supports")
  })
  test("the guard's name and disclaimers match the account", () => {
    const g = read('tests/content/vllm-block-size.test.ts')
    expect(g).not.toContain("describe(\"'<4%' is never the paper's figure\"")
    expect(g).not.toContain('never the paper|')
  })
  test("the engine default's boundary names the release notes for what cache.py does not hold", () => {
    const b = getClaim('production.vllm.block-size').boundary ?? ''
    expect(b).toContain('release notes')
    expect(b).toContain('Backends with a preferred block size still override it')
  })
  test("the paper claim's boundary does not say today", () => {
    expect(getClaim('serving.pagedattention.paper-block-size').boundary).not.toMatch(/\btoday\b/)
  })
})
