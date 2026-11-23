/**
 * K0-FIX2-T7, the second fix round of the t7 lane:
 * - t7.l4 names the later GetDeploying median as a later reading than the cost stack's, not "the dated median", because the
 *   cost stack two paragraphs up prints a different, dated reading of the same median.
 * - t7.l2's knee note blames a single run past the peak, not past the knee: between the knee and the peak goodput is at
 *   its highest (seed 0 shows it, as the reviewer's 390 run did).
 * - t7.l2 prints the load generators' statuses from their claims, so a re-read of a claim moves the lesson with it.
 */
import { describe, expect, test } from 'bun:test'
import { getClaim } from '../../src/data/claims'
import '../../src/data/claims/lazy/economics'
import { claimCite } from '../../src/data/claims/cite'
import { lessonById } from '../../src/data/lessons'
import { kneeSweep, kneeTruth } from '../../src/lib/world/fleet-ex/knee'

const l2 = JSON.stringify(lessonById('t7.l2'))
const l4 = JSON.stringify(lessonById('t7.l4'))

describe('t7.l4 tells the two GetDeploying medians apart (K0-FIX2-T7)', () => {
  test('the worked example calls its median a later reading of the cost stack\'s, and the claims bear that out', () => {
    expect(l4).not.toContain('the dated median')
    expect(l4).toContain("a later reading of the same GetDeploying median than the cost stack's")
    const older = getClaim('price.h100.median')
    const newer = getClaim('price.h100.median-2026-11')
    expect(newer.source.url).toBe(older.source.url)
    expect(newer.verifiedAt > older.verifiedAt).toBe(true)
  })
})

describe('t7.l2 knee note (K0-FIX2-T7)', () => {
  const note = (lessonById('t7.l2')!.blocks.find((b) => b.type === 'exercise' && (b as { fleet?: string }).fleet === 'knee') as {
    note: string
  }).note

  test('a single run is wrong past the peak, not anywhere past the knee', () => {
    expect(note).not.toContain('past the knee reports a low goodput')
    expect(note).toContain('one run at a load past the peak reports a low goodput and blames the engine')
  })

  test('on seed 0 a load past the knee beats the knee\'s goodput, and every load past the peak falls below the peak', () => {
    const r = kneeSweep(0)
    const slo = 40 // ticks: the burstgpt profile's TTFT SLO, 2 s at 50 ms a tick
    const knee = Math.max(...r.points.filter((p) => p.ttftP95 <= slo).map((p) => p.x))
    const peak = kneeTruth(r)
    const at = (x: number) => r.points.find((p) => p.x === x)!.goodputRps
    expect(knee).toBeLessThan(peak)
    expect(at(peak)).toBeGreaterThan(at(knee))
    for (const p of r.points.filter((q) => q.x > peak)) expect(p.goodputRps).toBeLessThan(at(peak))
  })
})

describe('t7.l2 load generators read their status claims (K0-FIX2-T7)', () => {
  test('no status or read date is typed', () => {
    expect(l2).not.toContain('status read 2026')
    expect(l2).not.toContain('December 2025')
  })
  test('LLMPerf and GenAI-Perf print their claim values; GuideLLM and AIPerf print value, release and read date', () => {
    expect(l2).toContain(`LLMPerf (Ray's load generator: ${getClaim('status.loadgen.llmperf').value})`)
    expect(l2).toContain(`GenAI-Perf (NVIDIA's earlier analyzer: ${getClaim('status.loadgen.genai-perf').value})`)
    expect(l2).toContain(`GuideLLM (${claimCite('status.loadgen.guidellm')})`)
    expect(l2).toContain(`AIPerf (${claimCite('status.loadgen.aiperf')})`)
  })
})
