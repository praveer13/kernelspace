import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ALL_LESSONS } from '@/data/lessons'
import { ENGINE_BLOCK_SCOPE, claimCite, claimNumber, fractionText } from '@/data/lessons/claims'
import { getClaim } from '@/data/claims'
import { VLLM_PIN } from '@/data/claims/engines'
import '@/data/claims/lazy/kvpool'
import { mixRange } from '@/data/lessons/pagedMix'

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const text = (id: string) => strings(ALL_LESSONS.find((l) => l.id === id)).join('\n')
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('the closing learner check, fix round 2', () => {
  test('a claim read in prose names its release and read date and does not say today or now', () => {
    // K0-FIX3: built from the pin and the claim, so the next re-pin moves it with no hand edit
    const c = getClaim('production.vllm.block-size')
    expect(claimCite('production.vllm.block-size')).toBe(`${c.value} ${c.unit} as of vLLM ${VLLM_PIN.ref}, read ${c.verifiedAt}`)
    const t5 = text('t5.l5')
    expect(t5).not.toMatch(/default today|default now|as vLLM's default now/)
    expect(text('t1.l4')).not.toMatch(/default now/)
    expect(text('t2.l7')).not.toMatch(/as vLLM's default\)/)
    expect(t5).not.toMatch(/\([^()]*\([^()]*\)[^()]*as of/)
  })

  test('the extensible-cache sentence does not date the feature from the pin', () => {
    expect(text('t5.l5')).not.toContain('Since vLLM')
    expect(text('t5.l5')).toContain(`At vLLM ${VLLM_PIN.ref}, vLLM reserves`)
  })

  test('no typed estimate-sized default in t5.l5, and the util default is the claim value as the claim gives it', () => {
    const util = claimNumber('production.vllm.gpu-memory-utilization')
    if (util !== 0.92) expect(text('t5.l5')).not.toContain('0.92')
    expect(text('t5.l5')).toContain(`With the extensible KV cache on, \`gpu_memory_utilization\` defaults to ${fractionText(util)};`)
  })

  test("t5.l5 says what the erratum's after says: CUDA, ROCm and --block-size", () => {
    const t = text('t5.l5')
    expect(t).toContain('on CUDA')
    // K0-FIX3 (B1): no claim holds ROCm's block size, so the lesson words it without a number, as t1.l4 does
    expect(t).not.toMatch(/ROCm[^.;\n]{0,60}?\b(?:keeps|uses)\s+\d/)
    expect(t).toContain(ENGINE_BLOCK_SCOPE)
    expect(t).toContain('--block-size')
  })

  test("the sweep exercise names the sim's own 64, not the claim", () => {
    expect(src('src/data/lessons/t5/pagedattention-deep-dive.ts')).not.toMatch(/tail waste at \$\{ENGINE_BLOCK\}/)
    expect(text('t5.l5')).toContain('sweep block size 4 → 64')
  })

  test("the paper's claim is not labelled as vLLM's default", () => {
    expect(getClaim('serving.pagedattention.paper-block-size').label).not.toContain("vLLM's default")
  })

  test('the home page and t1.l4 and t5.l6 do not leave a bare 16, or promise 16 vs 32', () => {
    expect(src('src/components/home/ScrollStory.tsx')).not.toContain('16-token blocks')
    expect(text('t1.l4')).not.toContain('16 vs 32')
    expect(text('t5.l6')).toContain("With the paper's 16-token blocks")
  })

  test('the t1.l4 chip names its block size in its label', () => {
    const paper = claimNumber('serving.pagedattention.paper-block-size')
    expect(text('t1.l4')).toContain(`KV waste, mixed batch at the paper's ${paper}-token blocks (course estimate)`)
    expect(src('src/data/lessons/t1/fragmentation.ts')).toContain("label: `KV waste, mixed batch at the paper's ${PAPER_BLOCK}-token blocks (course estimate)`")
  })

  test('t5.l5 gives the batch lengths beside the 8.1%', () => {
    expect(text('t5.l5')).toContain(`eight sequences (${mixRange()} tokens)`)
  })
})
