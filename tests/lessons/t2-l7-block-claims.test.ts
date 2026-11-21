import { describe, expect, test } from 'bun:test'
import { claimNumber } from '@/data/claims'
import { claimCite } from '@/data/claims/cite'
import { ALL_LESSONS } from '@/data/lessons'
import '@/data/claims/lazy/kvpool'

const lesson = ALL_LESSONS.find((l) => l.id === 't2.l7')
if (!lesson) throw new Error('t2.l7 not found')
const text = JSON.stringify(lesson)

describe('t2.l7 block-size and waste claims (K0-D16)', () => {
  test("the 16 is marked as the paper's, and vLLM's default comes from its claim", () => {
    expect(claimNumber('serving.pagedattention.paper-block-size')).toBe(16)
    expect(text).toContain('(16 in the paper)')
    expect(text).toContain('Fixed-size token units (16 in the paper)')
    expect(text).toContain(`16 tokens in the paper, vLLM's default is ${claimCite('production.vllm.block-size')}`)
    expect(text).not.toContain('(default 16)')
    expect(text).not.toContain('Fixed 16-token units')
  })

  test("<4% is gone, and the paper's own words are quoted instead", () => {
    expect(text).not.toContain('<4%')
    expect(text).toContain('near-zero waste')
    expect(text).toContain('20.4% to 38.2%')
  })
})
