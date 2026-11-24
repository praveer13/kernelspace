/**
 * K0-C27: t7.l1 states one percentile rule and every place that states it agrees with the course's own sizing on p95.
 * The old rule, "p50 for design, p95/p99 for contracts", sized on the median while the lesson's contract, its exit
 * ticket and the Fleet scoreboard it points to use p95. Meta's two figures are goals, not SLOs, and the lesson reads them
 * and MLPerf's limits from the claims snapshot.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '../../src/data/lessons'
import { ECONOMICS_CLAIMS } from '../../src/data/claims/lazy/economics'

const lesson = ALL_LESSONS.find((l) => l.id === 't7.l1')!
const text = JSON.stringify(lesson).replace(/\\n/g, ' ').replace(/\\"/g, '"')

describe('t7.l1 percentile rule', () => {
  test('no place designs at the median', () => {
    expect(text).not.toMatch(/design (at|for)[^.]{0,20}p50/i)
    expect(text).not.toContain('p50 for design')
    expect(text).not.toContain('Why design at p50')
  })

  test('the rule says to size on p95 or p99, as the exit ticket and the scoreboard do', () => {
    expect(text).toContain('size and contract on p95 or p99')
    expect(text).toContain('a contract binds at p95')
    expect(text).toContain('TTFT p95 beside it')
  })

  test('Meta\'s figures are goals and not called SLOs', () => {
    expect(text).not.toMatch(/Meta('s app)? targets/)
    expect(text).not.toMatch(/Meta TT[A-Z]+ SLO/)
    expect(text).toContain('Meta TTFT goal')
    expect(text).toContain('Meta TTIT goal')
  })

  test('the lesson reads Meta and MLPerf claims, each a status claim with a quote', () => {
    for (const id of ['status.meta.ttft-goal', 'status.meta.ttit-goal', 'status.mlperf.server-tail-percentile', 'status.mlperf.llama31-8b.interactive-tpot']) {
      const c = ECONOMICS_CLAIMS.find((x) => x.id === id)
      expect(c?.kind).toBe('status')
      expect(c?.source?.quote?.length ?? 0).toBeGreaterThan(0)
    }
    expect(ECONOMICS_CLAIMS.find((c) => c.id === 'status.meta.ttft-goal')!.value).toBe(350)
    expect(text).toContain('99th percentile')
  })
})
