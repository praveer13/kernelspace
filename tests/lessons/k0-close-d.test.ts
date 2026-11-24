/**
 * K0-CLOSE-D: t5.l8 says what its output-distribution erratum says everywhere it states the guarantee, SGLang's
 * enable_mixed_chunk default is not typed without a claim, and t2.l5's ABA node agrees with its step caption.
 * The figures' fit is held by tests/lessons/diagram-fit.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { lessonById } from '@/data/lessons'
import { claimRelease } from '@/data/lessons/claims'
import type { DiagramBlock } from '@/data/lessons/types'
import erratum from '@/data/errata/2026-11-22-t5-l8-speculative-output-distribution'

const rendered = (id: string) => JSON.stringify(lessonById(id)).replace(/\\n/g, ' ')

function diagrams(v: unknown, out: DiagramBlock[] = []): DiagramBlock[] {
  if (Array.isArray(v)) for (const x of v) diagrams(x, out)
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.type === 'diagram' && Array.isArray(o.nodes)) out.push(o as unknown as DiagramBlock)
    else for (const x of Object.values(o)) diagrams(x, out)
  }
  return out
}

describe('t5.l8: the output guarantee is on the distribution, up to floating-point rounding', () => {
  const r = rendered('t5.l8')
  test('the erratum this follows says so', () => {
    expect(erratum.after).toContain('up to floating-point rounding')
  })
  test('no place says the output is exactly the target\'s', () => {
    expect(r).not.toContain('EXACTLY')
    expect(r).not.toContain('follow *exactly*')
    expect(r).not.toContain('output distribution exactly')
    expect(r).not.toContain('distributionally identical')
  })
  test('the figure caption, the statline hint and the quiz why carry the rounding', () => {
    expect(r).toContain("rejection sampling keeps the output on the target's distribution, up to floating-point rounding")
    expect(r).toContain("Rejection sampling keeps the output on the target model's distribution, up to floating-point rounding.")
    expect(r).toContain("Speculation reproduces that target's output distribution, up to floating-point rounding, because of its acceptance rule.")
  })
})

describe('t5.l8: SGLang\'s enable_mixed_chunk', () => {
  const r = rendered('t5.l8')
  test('its default is not typed, since no claim holds it', () => {
    expect(r).not.toContain('defaults to False')
    expect(r).toContain('only when `enable_mixed_chunk` is set')
  })
  test('the source link is at the release the sentence is dated by', () => {
    const tag = claimRelease('production.sglang.chunked-prefill-size').replace(/^SGLang /, '')
    expect(tag).toMatch(/^v\d/)
    expect(r).toContain(`https://github.com/sgl-project/sglang/blob/${tag}/python/sglang/srt/arg_groups/fields/schedule.py`)
  })
})

describe('t2.l5: the ABA node says what the step says', () => {
  const d = diagrams(lessonById('t2.l5')).find((x) => x.nodes.some((n) => n.id === 'boom'))!
  test('CAS sets head = B, a freed node; B is not lost', () => {
    const boom = d.nodes.find((n) => n.id === 'boom')!
    expect(boom.sub).toBe('head = B (freed!)')
    expect(JSON.stringify(d)).not.toContain('B lost')
    expect(d.steps?.at(-1)?.caption).toContain('sets head = B')
  })
})
