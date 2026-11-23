import { describe, expect, test } from 'bun:test'
import { claimNumber } from '@/data/claims'
import { claimCite } from '@/data/claims/cite'
import { ALL_LESSONS } from '@/data/lessons'

const lesson = ALL_LESSONS.find((l) => l.id === 't5.l6')
if (!lesson) throw new Error('t5.l6 not found')

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const text = strings(lesson).join('\n')
const n = claimNumber('production.vllm.block-size')
const blocks = Math.floor(130 / n)
const paper = claimNumber('serving.pagedattention.paper-block-size')
const paperBlocks = Math.floor(130 / paper)

describe('t5.l6 block boundary at vLLM default (K0-D13)', () => {
  test('the text holds floor(130/n) blocks, their tokens and the n - 1 unshared tail for the claim value', () => {
    expect(text).toContain(`At ${n} tokens per block the same 130 tokens give ${blocks} blocks (${blocks * n} tokens)`)
    expect(text).toContain(`up to ${n - 1} matching tokens`)
    expect(text).toContain(`vLLM's default on CUDA is ${claimCite('production.vllm.block-size')}`)
  })

  test("the paper's block stays as the worked case", () => {
    expect(text).toContain(
      `With the paper's ${paper}-token blocks, 130 identical leading tokens produce ${paperBlocks} reusable blocks (${paperBlocks * paper} tokens)`,
    )
  })
})

describe('t5.l6 router listing (K0-C22)', () => {
  const listing = lesson.blocks.find((b) => b.type === 'code' && b.filename?.startsWith('prefix_router.rs'))
  test('the listing returns an Option and has no unwrap or fallback', () => {
    if (!listing || listing.type !== 'code') throw new Error('router listing not found')
    expect(listing.code).toContain('-> Option<usize>')
    expect(listing.code).not.toContain('.unwrap()')
    expect(listing.code).not.toContain('unwrap_or_else')
    expect(listing.chips ?? []).not.toContain('JSQ fallback')
  })
  test('the reading lead no longer teaches unwrap_or_else on this chain', () => {
    const reading = lesson.blocks.find((b) => b.type === 'reading')
    if (!reading || reading.type !== 'reading') throw new Error('reading block not found')
    expect(reading.lead).not.toContain('unwrap_or_else')
  })
})
