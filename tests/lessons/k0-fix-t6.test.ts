/**
 * K0-FIX-T6: the lane-t6 review's findings, each held where a test can hold it.
 * - The KVBM erratum is a 'changed' entry: the v1.5.0 notes said v1.6.0 when the course read them (the backtest snapshot
 *   holds that body) and say v1.7.0 now.
 * - DeepSeek's dual-batch overlap splits the batch into two micro-batches in both phases: prefill alternates them, decode
 *   runs them through a 5-stage pipeline (open-infra-index day 6; profile-data README). Nothing in the lane says it is
 *   prefill only.
 * - The 545% is profit over cost, as the economics claim's boundary computes it.
 * - The status claims that date t6.l2 and t6.l6 are read through the lesson claim reader.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getClaim } from '../../src/data/claims'
import '../../src/data/claims/lazy/economics'
import { claimRelease } from '../../src/data/claims/cite'
import '../../src/data/claims/all'
import kvbm from '../../src/data/errata/2026-11-21-dynamo-kvbm-removal-v1-7-0'
import l4Erratum from '../../src/data/errata/2026-11-22-t6-l4-deepseek-decode-no-tp-five-stage'
import { T6_KCS } from '../../src/data/kc/t6'
import { lessonById } from '../../src/data/lessons'
import { LESSON_CLAIM_VALUES } from '../../src/data/lessons/claims.generated'

const ROOT = join(import.meta.dir, '../..')

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(strings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings)
  return []
}
const textOf = (id: string): string => strings(lessonById(id)).join('\n')

describe('K0-FIX-T6 finding 1: the KVBM target moved; the course did not misread it', () => {
  test('the backtest snapshot holds the v1.5.0 notes saying v1.6.0', () => {
    const snap = readFileSync(join(ROOT, 'docs/backtest/snapshot.json'), 'utf8')
    expect(snap).toContain('KVBM (KV Block Manager) is deprecated in v1.5.0 and removal is targeted for v1.6.0')
  })

  test("the erratum is kind 'changed' and says the notes moved", () => {
    expect(kvbm.kind).toBe('changed')
    expect(kvbm.title).not.toMatch(/not v1\.6\.0/)
    expect(kvbm.after).toContain('they read v1.6.0 on 2026-10-06')
    for (const s of strings(kvbm)) expect(s).not.toMatch(/that was wrong|misread/i)
  })
})

describe('K0-FIX-T6 finding 2: both phases split the batch into two micro-batches', () => {
  const PREFILL_ONLY = [
    /Dual-batch overlap is its prefill scheme/i,
    /Decode uses a staged pipeline instead/i,
    /micro-batches are DeepSeek's prefill scheme/i,
    /alternating micro-batches in prefill, a pipeline in decode/i,
    /Two equal alternating halves/i,
  ]
  const lane = [
    ...['t6.l2', 't6.l4'].map(textOf),
    strings(l4Erratum).join('\n'),
    strings(T6_KCS).join('\n'),
  ]

  test('no lane text says dual-batch overlap is prefill only', () => {
    for (const t of lane) for (const p of PREFILL_ONLY) expect(t).not.toMatch(p)
  })

  test('t6.l2 gives decode the two micro-batches and the 5-stage pipeline', () => {
    const t = textOf('t6.l2')
    expect(t).toContain('splits a batch of requests into two micro-batches, in both phases')
    expect(t).toContain('*Decode* keeps the two micro-batches')
    expect(t).toContain('"does not occupy GPU SMs"')
  })

  test('the t6.l4 erratum and the knowledge component say both phases', () => {
    expect(l4Erratum.after).toContain('Like prefill it splits the batch into two micro-batches')
    expect(T6_KCS.find((k) => k.id === 't6.comm-overlap')!.can).toContain('two micro-batches hide the all-to-all: alternating in prefill, a 5-stage pipeline in decode')
  })

  test('the t6.l2 erratum that called the alternating schedule prefill only is gone', () => {
    expect(existsSync(join(ROOT, 'src/data/errata/2026-11-22-t6-l2-dual-batch-is-prefill.ts'))).toBe(false)
  })
})

describe('K0-FIX-T6 finding 3: the 545% is profit over cost', () => {
  test('recomputed from the day-6 claims, profit over cost is the 545%, revenue over cost is not', () => {
    const cost = getClaim('bench.deepseek-day6.daily-cost').value as number
    const revenue = getClaim('bench.deepseek-day6.theoretical-revenue').value as number
    const margin = getClaim('bench.deepseek-day6.cost-profit-margin').value as number
    expect(Math.round(((revenue - cost) / cost) * 100)).toBe(margin)
    expect(Math.round((revenue / cost) * 100)).not.toBe(margin)
  })

  test('t6.l2 defines it as profit over cost', () => {
    const t = textOf('t6.l2')
    expect(t).toContain('(profit over cost, at R1 list prices)')
    expect(t).not.toContain('revenue at R1 list prices over cost')
  })
})

describe('K0-FIX-T6 finding 4: the status claims date the lessons that state them', () => {
  test('t6.l2 reads the DeepEP API claim, with its commit and read date, and the first-release claim', () => {
    const t = textOf('t6.l2')
    const api = LESSON_CLAIM_VALUES['status.deepep.api']!.cite
    expect(api).toContain(`as of ${claimRelease('status.deepep.api')}, read ${getClaim('status.deepep.api').verifiedAt}`)
    expect(claimRelease('status.deepep.api')).toBe('DeepEP f6aa38f')
    expect(t).toContain(api)
    expect(t).toContain(`open-sourced a dedicated library for it, in ${LESSON_CLAIM_VALUES['status.deepep.first-release']!.cite}.`)
    expect(t).not.toContain('as it first shipped')
  })

  test('t6.l6 reads the production-drafter and TensorRT-LLM depth claims', () => {
    const t = textOf('t6.l6')
    expect(t).toContain(LESSON_CLAIM_VALUES['status.deepseek.production-drafter']!.cite)
    expect(t).toContain(LESSON_CLAIM_VALUES['status.deepseek.trtllm-mtp-depth']!.cite)
  })
})

describe('K0-FIX-T6 nits in the same lines', () => {
  test('quotes are verbatim and the README is named', () => {
    const t = textOf('t6.l2')
    expect(t).toContain('"A common method is to use moving average of historical statistics"')
    expect(t).toContain('DeepEP\'s V1 README calls them "a set of low-latency kernels with pure RDMA to minimize delays"')
  })

  test('the MTP-1 sentence does not tie it to the V3/R1 module, and the DSpark claim cites the v1 paper', () => {
    expect(textOf('t6.l6')).not.toContain('drafted one token per step with it (MTP-1)')
    expect(getClaim('status.deepseek.production-drafter').source!.url).toBe('https://arxiv.org/html/2607.05147v1')
  })
})
