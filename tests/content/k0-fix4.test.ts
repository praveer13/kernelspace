import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { claimNumber, getClaim } from '@/data/claims'
import { claimCite as registryCite, claimRelease as registryRelease } from '@/data/claims/cite'
import '@/data/claims/lazy/kvpool'
import { ALL_LESSONS } from '@/data/lessons'
import { ENGINE_BLOCK_SCOPE } from '@/data/lessons/claims'
import * as pagedMix from '@/data/lessons/pagedMix'
import pagedWaste from '@/data/errata/2026-11-21-paged-waste-not-the-papers-figure'
import * as kvModel from '@/lib/sims/models/kv'
import { BLOCK_SIZE as POOL_BLOCK } from '@/lib/sims/models/blocks'
import { LESSON_CLAIMS } from '../../scripts/gen-lesson-claims'

/**
 * K0-FIX4, the fix round after the second last confirmation of k0-repin. One account, read from arXiv 2309.06180v1 on
 * 2026-11-21 and given the same way everywhere:
 *   - Throughput: "improves the throughput of popular LLMs by 2-4× with the same level of latency" against
 *     FasterTransformer and Orca (abstract); "up to 22× higher request rates" against FasterTransformer (§6.2). The paper
 *     has no 24×; 3.58× is one shared-prefix workload against Orca (Oracle) (§6.4). Each number is a kvpool claim.
 *   - The indirection's cost: "20–26% higher attention kernel latency" than FasterTransformer's (§7.1), which the authors
 *     call small because it "only affects the attention operator". t2.l7 and t5.l5 give it in one sentence.
 *   - Figure 2: vLLM's bar is 96.3% token states in one experiment, so about 3.7% held something else there. wasteStory(),
 *     t2.l7's Figure 2 callout and the paged-waste erratum give that in one sentence, computed from the claim.
 *   - vLLM's default block: the first statement a learner meets in each lesson and in the KV simulator says "on CUDA"
 *     with the shared scope words.
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
const fn = (mod: unknown, name: string) => (mod as Record<string, unknown>)[name] as (() => string) | undefined

const GAIN_LOW = 'serving.pagedattention.throughput-gain-low'
const GAIN_HIGH = 'serving.pagedattention.throughput-gain-high'
const FT_RATE = 'serving.pagedattention.ft-request-rate'
const KERNEL_LOW = 'serving.pagedattention.kernel-overhead-low'
const KERNEL_HIGH = 'serving.pagedattention.kernel-overhead-high'
const FIG2 = 'serving.pagedattention.fig2-vllm-token-states'
const KV_BYTES = 'model.llama3-8b.kv-bytes-per-token'
const PAPER = claimNumber('serving.pagedattention.paper-block-size')
const ENGINE = claimNumber('production.vllm.block-size')
const CITE = registryCite('production.vllm.block-size')

describe("B1: t2.l7 gives the paper's throughput as the paper does, from claims", () => {
  test('the five paper figures are kvpool claims quoting the paper, read 2026-11-21', () => {
    const want: Array<[string, number, string]> = [
      [GAIN_LOW, 2, 'improves the throughput of popular LLMs by 2-4× with the same level of latency'],
      [GAIN_HIGH, 4, 'improves the throughput of popular LLMs by 2-4× with the same level of latency'],
      [FT_RATE, 22, 'Compared to FasterTransformer, vLLM can sustain up to 22× higher request rates'],
      [KERNEL_LOW, 20, 'this leads to 20–26% higher attention kernel latency'],
      [KERNEL_HIGH, 26, 'this leads to 20–26% higher attention kernel latency'],
    ]
    for (const [id, value, quote] of want) {
      const c = getClaim(id)
      expect(c.value, id).toBe(value)
      expect(c.source?.url, id).toBe('https://arxiv.org/html/2309.06180v1')
      expect(c.source?.quote, id).toContain(quote)
      expect(c.verifiedAt, id).toBe('2026-11-21')
      expect(c.pin, id).toBeUndefined()
      expect(LESSON_CLAIMS, id).toContain(id)
    }
  })

  test('t2.l7 no longer gives 24× or 3.5×, and renders the throughput sentence from the claims', () => {
    const t = text('t2.l7')
    expect(t).not.toMatch(/24×|3\.5× Orca/)
    const story = fn(pagedMix, 'throughputStory')
    expect(story).toBeFunction()
    const s = story!()
    expect(s).toContain(`vLLM improves throughput ${claimNumber(GAIN_LOW)}–${claimNumber(GAIN_HIGH)}× at the same level of latency over FasterTransformer and Orca (abstract)`)
    expect(s).toContain(`up to ${claimNumber(FT_RATE)}× higher request rates (§6.2)`)
    expect(t).toContain(s)
    expect(read('public/lessons-md/t2.l7.md')).toContain(s)
  })

  test('no lesson source types the throughput or kernel figures the claims hold', () => {
    for (const f of ['src/data/lessons/t1/fragmentation.ts', 'src/data/lessons/t2/exam-pagedattention.ts', 'src/data/lessons/t5/pagedattention-deep-dive.ts', 'src/data/lessons/pagedMix.ts'])
      expect(read(f), f).not.toMatch(/\b2[–-]4\s?[×x]|\b20[–-]26\s?%|\b22×/)
  })
})

describe('B2: t5.l5 reads the 8B model\'s KV bytes per token from its claim', () => {
  test('the claim is in the snapshot list and the source types no KiB constant', () => {
    expect(LESSON_CLAIMS).toContain(KV_BYTES)
    expect(read('src/data/lessons/t5/pagedattention-deep-dive.ts')).not.toMatch(/KV_KIB_PER_TOKEN = \d/)
  })
  test('the rendered sentence carries the claim in KiB and the block sizes it implies', () => {
    const kib = claimNumber(KV_BYTES) / 1024
    const t = text('t5.l5')
    expect(t).toContain(`(${kib} KiB of KV per token, so one paper block holds ${PAPER} × ${kib} KiB = ${(PAPER * kib) / 1024} MiB`)
    expect(t).toContain(`${ENGINE} × ${kib} KiB = ${(ENGINE * kib) / 1024} MiB`)
  })
})

describe('R1: the first statement of vLLM\'s default a learner meets says "on CUDA" with the shared scope words', () => {
  // The rendered order of a lesson is the order of its blocks; a prequestion's why and a chip's hint come before the body.
  for (const id of ['t1.l4', 't2.l7', 't5.l5', 't5.l6']) {
    test(`${id}: the first "vLLM's default" is the qualified one, in the lesson and in its export`, () => {
      const qualified = `vLLM's default on CUDA is ${CITE} (${ENGINE_BLOCK_SCOPE})`
      for (const t of [text(id), read(`public/lessons-md/${id}.md`)]) {
        const first = t.indexOf("vLLM's default")
        expect(first).toBeGreaterThanOrEqual(0)
        expect(t.slice(first, first + qualified.length)).toBe(qualified)
      }
    })
  }

  test('the KV simulator qualifies its default with the same scope words', () => {
    const scope = (kvModel as Record<string, unknown>).ENGINE_BLOCK_SCOPE_TEXT
    expect(scope).toBe(ENGINE_BLOCK_SCOPE.replace(/`/g, ''))
    const sim = read('src/components/sims/KvCacheSim.tsx')
    expect(sim).toContain('(vLLM&apos;s default on CUDA; {ENGINE_BLOCK_SCOPE_TEXT})')
    expect(sim).not.toContain('(vLLM&apos;s default)')
  })
})

describe('R2: what Figure 2 implies for vLLM, in one sentence computed from the claim', () => {
  test('the sentence is 100 minus the claim, in that experiment', () => {
    const rest = fn(pagedMix, 'fig2Rest')
    expect(rest).toBeFunction()
    expect(rest!()).toBe(`So by Figure 2, about ${(100 - claimNumber(FIG2)).toFixed(1)}% of vLLM's KV memory held something other than token states in that experiment.`)
  })
  test('wasteStory(), the t2.l7 callout and the paged-waste erratum give it word for word', () => {
    const s = fn(pagedMix, 'fig2Rest')?.() ?? 'fig2Rest is missing'
    expect(pagedMix.wasteStory()).toContain(s)
    expect(text('t1.l4')).toContain(s)
    expect(text('t5.l5')).toContain(s)
    expect(text('t2.l7')).toContain(`vLLM's is ${claimNumber(FIG2)}% token states. ${s}`)
    expect(pagedWaste.after).toContain(s)
    // "Under 4%" stays the course's estimate, after the Figure 2 sentence
    expect(pagedWaste.after).toContain("Under 4% is the course's estimate.")
    expect(pagedMix.wasteStory()).toContain(`${s} "Under ${claimNumber('synthetic.kv.paged-waste')}%" is the course's estimate, not the paper's`)
  })
})

describe('R4: t2.l7 and t5.l5 give the paper\'s account of what the indirection costs', () => {
  test('one sentence from the claims, rendered in both lessons and their exports', () => {
    const story = fn(pagedMix, 'kernelCostStory')
    expect(story).toBeFunction()
    const s = story!()
    expect(s).toContain(`(§7.1): ${claimNumber(KERNEL_LOW)}–${claimNumber(KERNEL_HIGH)}% higher attention-kernel latency than FasterTransformer's kernel`)
    expect(s).toContain('touches only the attention operator')
    for (const id of ['t2.l7', 't5.l5']) {
      expect(text(id)).toContain(s)
      expect(read(`public/lessons-md/${id}.md`)).toContain(s)
    }
  })
  test('neither lesson calls the cost near zero or noise', () => {
    for (const id of ['t2.l7', 't5.l5']) expect(text(id)).not.toMatch(/cost near zero|keeping that cost near zero|are noise against/)
  })
})

describe('R6: small things in the same files', () => {
  test('the KV simulator prints no "a 8k"-style article', () => {
    const sim = read('src/components/sims/KvCacheSim.tsx')
    expect(sim).not.toContain('% of a {fmtCtx(ctx)} context')
    expect(sim).toContain('% of a context of {fmtCtx(ctx)} tokens')
  })
  test('t5.l5 names the extensible KV cache before "with it off"', () => {
    const t = text('t5.l5')
    expect(t).not.toContain('with it on;')
    expect(t).toContain('With the extensible KV cache on, `gpu_memory_utilization` defaults to')
  })
  test("t5.l5 says whose words the change to vLLM's default is, and asserts no reason the release notes do not give", () => {
    const t = text('t5.l5')
    expect(t).not.toContain('the reason given for the change')
    expect(t).toContain(`The ${registryRelease('production.vllm.block-size')} release notes list the change to ${ENGINE} under "Before you upgrade" without giving a reason`)
  })
  test("BlockTableExplorer renders its pool's block size, the paper's", () => {
    expect(read('src/components/sims/BlockTableExplorer.tsx')).toContain("this pool uses {BLOCK_SIZE}, the paper&apos;s size.")
    expect(POOL_BLOCK).toBe(PAPER)
  })
})
