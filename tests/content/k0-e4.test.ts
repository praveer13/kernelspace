import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ENGINE_BLOCK_SCOPE, claimNumber } from '@/data/lessons/claims'
import { ALL_LESSONS } from '@/data/lessons'
import { ENGINE_BLOCK_SCOPE_TEXT } from '@/lib/sims/models/kv'

/**
 * K0-E4, the block-size account's leftovers: the scope words state the backend rule, the block-table explorer says
 * "on CUDA", and t5.l6 reads the paper's block from its claim.
 */
const read = (p: string) => readFileSync(p, 'utf8')

describe('the scope words state the preferred-size rule, with ROCm as its example', () => {
  test('ENGINE_BLOCK_SCOPE names the rule and ROCm and carries no digit', () => {
    expect(ENGINE_BLOCK_SCOPE).toMatch(/preferred block size/i)
    expect(ENGINE_BLOCK_SCOPE).toMatch(/ROCm/)
    expect(ENGINE_BLOCK_SCOPE).toContain('--block-size')
    expect(ENGINE_BLOCK_SCOPE).not.toMatch(/\d/)
  })
  test('the simulator copy says the same without code marks', () => {
    expect(ENGINE_BLOCK_SCOPE_TEXT).toBe(ENGINE_BLOCK_SCOPE.replace(/`/g, ''))
  })
})

describe("the block-table explorer states vLLM's default with its scope", () => {
  const src = read('src/components/sims/BlockTableExplorer.tsx')
  test("the sentence that states vLLM's default says 'on CUDA' and prints the scope words", () => {
    const i = src.indexOf('vLLM&apos;s default')
    expect(i).toBeGreaterThanOrEqual(0)
    const sentence = src.slice(i, src.indexOf('</p>', i))
    expect(sentence).toContain('on CUDA')
    expect(sentence).toContain('<ClaimValue id="production.vllm.block-size" />')
    expect(sentence).toContain('{ENGINE_BLOCK_SCOPE_TEXT}')
  })
})

describe("t5.l6 reads the paper's block from its claim", () => {
  const src = read('src/data/lessons/t5/prefix-caching.ts')
  test("the source types no 16-token, 'eight reusable' or '(128 tokens)' outside the two stems", () => {
    const rest = src
      .split('\n')
      .filter((l) => !l.includes('The engine caches only full 16-token blocks') && !l.includes('With 16-token blocks'))
      .join('\n')
    expect(rest).not.toContain('16-token')
    expect(rest).not.toContain('eight reusable')
    expect(rest).not.toContain('(128 tokens)')
  })
  test('the rendered setup sentence is computed from the claim', () => {
    const lesson = ALL_LESSONS.find((l) => l.id === 't5.l6')
    if (!lesson) throw new Error('t5.l6 not found')
    const text = JSON.stringify(lesson)
    const b = claimNumber('serving.pagedattention.paper-block-size')
    const full = Math.floor(130 / b)
    expect(text).toContain(
      `With the paper's ${b}-token blocks, 130 identical leading tokens produce ${full} reusable blocks (${full * b} tokens); the ${130 - full * b}-token tail`,
    )
  })
})
