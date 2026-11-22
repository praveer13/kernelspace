/**
 * K0-C2: the benchmarking lesson (t7.l2) names the load generators that are alive, and names LLMPerf (archived) and
 * GenAI-Perf (being phased out) only with that status beside them. Each tool the lesson names has a status claim with a
 * life of at most 60 days and a quote. Expiry never fails a test by design; only the claim's shape is asserted.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '../../src/data/lessons'
import { ECONOMICS_CLAIMS } from '../../src/data/claims/lazy/economics'

const lesson = ALL_LESSONS.find((l) => l.id === 't7.l2')!
const text = JSON.stringify(lesson).replace(/\\n/g, ' ')
const TOOLS: Record<string, string> = {
  LLMPerf: 'status.loadgen.llmperf',
  'GenAI-Perf': 'status.loadgen.genai-perf',
  GuideLLM: 'status.loadgen.guidellm',
  AIPerf: 'status.loadgen.aiperf',
}

describe('t7.l2 load generators', () => {
  for (const [tool, id] of Object.entries(TOOLS)) {
    test(`${tool} has a status claim with a life of at most 60 days and a quote`, () => {
      if (text.includes(tool)) {
        const claim = ECONOMICS_CLAIMS.find((c) => c.id === id)
        expect(claim).toBeDefined()
        expect(claim!.kind).toBe('status')
        expect(claim!.ttlDays).toBeLessThanOrEqual(60)
        expect(claim!.source?.quote?.trim().length ?? 0).toBeGreaterThan(0)
      }
      expect(text.includes(tool)).toBe(true)
    })
  }

  test('LLMPerf and GenAI-Perf appear only beside "archived" or "phased out"', () => {
    const sentences = text.split(/(?<=[.!?])\s+/)
    const bad = sentences.filter((s) => /LLMPerf|GenAI-Perf/.test(s) && !/archived|phased out/i.test(s))
    expect(bad).toEqual([])
  })

  test('the live tools are what the stat chip and the deep dive name', () => {
    expect(text).toContain('GuideLLM + AIPerf')
    expect(text).toContain('GuideLLM or AIPerf adds the rest')
  })
})
