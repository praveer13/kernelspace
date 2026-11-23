import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import { claimNumber } from '@/data/lessons/claims'
import { BLOCK_SIZE, PROMPT_TOKENS, tailTokens } from '@/lib/sims/models/blocks'

const lesson = ALL_LESSONS.find((l) => l.id === 't5.l5')
if (!lesson) throw new Error('t5.l5 not found')
const fig = lesson.blocks.find((b) => b.type === 'diagram')
if (!fig || fig.type !== 'diagram') throw new Error('t5.l5 has no diagram')

// Fig 1 and the block-table explorer work the same scenario: the explorer's prompt in the paper's block, and the
// tokens the first writer copies are the tail the explorer's model computes.
const PROMPT = PROMPT_TOKENS
const BLOCK = claimNumber('serving.pagedattention.paper-block-size')
const TAIL = tailTokens(PROMPT, BLOCK)

const copyStep = fig.steps[fig.predictAt?.step ?? -1]

describe('t5.l5 fig 1: copy-on-write on a partly filled block (K0-B6)', () => {
  test('the prompt is not a whole number of blocks, so the tail is partial', () => {
    expect(BLOCK).toBe(BLOCK_SIZE)
    expect(TAIL).toBeGreaterThan(0)
    expect(TAIL).toBeLessThan(BLOCK)
    expect(fig.steps[0]?.caption).toContain(`${PROMPT}-token prompt in blocks of ${BLOCK}`)
  })

  test('the copy step names a partly filled block and copies exactly the tail', () => {
    expect(copyStep).toBeDefined()
    const caption = copyStep?.caption ?? ''
    expect(caption).toMatch(/partly filled/)
    expect(caption).toContain(`copy the ${TAIL} tokens of KV`)
    expect(caption).not.toMatch(/full block/i)
    expect(caption).not.toContain(`copy ${BLOCK} tokens`)
  })

  test('the shared tail block is drawn with its token count', () => {
    const tail = fig.nodes.find((n) => n.id === 'b12')
    expect(tail?.sub).toContain(`${TAIL} tokens`)
  })

  test('the figure is captioned as the paper\'s design and the prompt asks about a partly filled block', () => {
    expect(fig.caption).toContain('2023 paper')
    expect(fig.predictAt?.prompt).toContain('partly filled')
  })
})
