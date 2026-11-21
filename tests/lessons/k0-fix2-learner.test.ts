import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ALL_LESSONS } from '@/data/lessons'
import { claimCite } from '@/data/lessons/claims'
import { getClaim } from '@/data/claims'
import '@/data/claims/lazy/kvpool'

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
    expect(claimCite('production.vllm.block-size')).toBe('64 tokens/block as of vLLM v0.34.0, read 2026-11-21')
    const t5 = text('t5.l5')
    expect(t5).not.toMatch(/default today|default now|as vLLM's default now/)
    expect(text('t1.l4')).not.toMatch(/default now/)
    expect(text('t2.l7')).not.toMatch(/as vLLM's default\)/)
    expect(t5).not.toMatch(/\([^()]*\([^()]*\)[^()]*as of/)
  })

  test('the extensible-cache sentence does not date the feature from the pin', () => {
    expect(text('t5.l5')).not.toContain('Since vLLM')
    expect(text('t5.l5')).toContain('At vLLM v0.34.0, vLLM reserves')
  })

  test('no literal 0.92 in t5.l5, and the util default is written 1.0', () => {
    expect(text('t5.l5')).not.toContain('0.92')
    expect(text('t5.l5')).toContain('defaults to 1.0 with it on')
  })

  test("t5.l5 says what the erratum's after says: CUDA, ROCm and --block-size", () => {
    const t = text('t5.l5')
    expect(t).toContain('on CUDA')
    expect(t).toContain('ROCm keeps 16')
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
    expect(src('src/data/lessons/t1/fragmentation.ts')).toContain("label: 'KV waste at 16-token blocks (course estimate)'")
  })

  test('t5.l5 gives the batch lengths beside the 8.1%', () => {
    expect(text('t5.l5')).toContain('eight sequences (190 to 455 tokens)')
  })
})
