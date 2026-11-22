import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import erratum from '@/data/errata/2026-11-21-paged-waste-not-the-papers-figure'

const lesson = readFileSync('src/data/lessons/t5/pagedattention-deep-dive.ts', 'utf8')
const kvpool = readFileSync('src/data/claims/lazy/kvpool.ts', 'utf8')

describe('paged-waste erratum matches the paper (arXiv 2309.06180v1, Figure 2)', () => {
  test('the item answer says Figure 2 covers vLLM as well as the earlier systems', () => {
    const why = erratum.items[0].why.join(' ')
    expect(why).toContain('(Figure 2) covers the earlier systems and vLLM')
    expect(why).not.toContain('covers the earlier systems,')
  })
  test('the erratum does not say Figure 2 is unread', () => {
    const all = JSON.stringify(erratum)
    expect(all).not.toContain('Figure 2 is not read')
    // K0-FIX3: Figure 2's vLLM bar is the claim serving.pagedattention.fig2-vllm-token-states, rendered by the lessons;
    // the erratum names the figure and says what it is, and types no number for it
    expect(all).toContain('Figure 2')
    expect(all).not.toContain('96.3')
  })
})

describe('t5.l5 pool sentence reads its release and numbers from claims', () => {
  test('no "Since" release phrasing and no typed 0.92', () => {
    expect(lesson).not.toContain('Since ${POOL_RELEASE}')
    expect(lesson).not.toContain('0.92')
  })
})

describe('the paper block-size claim is not labelled as the engine default', () => {
  test('label names the paper, not vLLM default today', () => {
    expect(kvpool).not.toContain("SOSP 2023): vLLM's default block size")
  })
})
