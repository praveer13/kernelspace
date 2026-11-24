/**
 * K0-FIX-T5: the t5 lane's fix round. Each sentence dates its fact by the claim that holds that fact, a list the docs
 * do not close is not written as closed, a sentence starts with a capital, and a learner chip carries no review-process words.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lessonById } from '@/data/lessons'
import { claimRelease } from '@/data/lessons/claims'

const src = (f: string) => readFileSync(join(import.meta.dir, '../../src/data/lessons/t5', f), 'utf8')
const rendered = (id: string) => JSON.stringify(lessonById(id)).replace(/\\n/g, ' ')

describe('t5.l7: the preemption warning is dated by the scheduler claim', () => {
  const text = src('continuous-batching.ts')
  test('the release comes from twin.vllm.scheduler, not from the block-size claim', () => {
    expect(text).not.toContain("claimRelease('production.vllm.block-size')")
    expect(text).toContain("claimRelease('twin.vllm.scheduler')")
    expect(rendered('t5.l7')).toContain(`${claimRelease('twin.vllm.scheduler')} preempts the most recently admitted request`)
  })
})

describe('t5.l8: chunked prefill defaults and the methods list', () => {
  const text = src('speculative-chunked.ts')
  const r = rendered('t5.l8')
  test('the vLLM default is dated by the scheduler claim', () => {
    expect(text).toContain("claimRelease('twin.vllm.scheduler')")
    expect(r).toContain(`vLLM chunks prefill and batches it with running decodes by default (as of ${claimRelease('twin.vllm.scheduler')}`)
  })
  test('TensorRT-LLM\'s default is not typed beside the claim that holds it', () => {
    expect(r).not.toContain('`enable_chunked_prefill` is False')
  })
  test('the methods list is not presented as complete', () => {
    expect(r).not.toContain('methods now are')
    expect(r).toContain('among others')
    expect(r).toContain('LiLiCorr')
    expect(r).toContain('`dflash`')
  })
})

describe('t5.l10: Dynamo paragraph', () => {
  const r = rendered('t5.l10')
  test('no sentence starts in lower case after the newest-release clause', () => {
    expect(r).not.toContain('we have read. its')
    expect(r).not.toContain('call that "the first major release"')
  })
  test('the README sentence is dated by the claim that quotes the README', () => {
    expect(src('production-stack.ts')).toContain("the README at ${claimRelease('status.dynamo.transport')}")
    expect(r).toContain(`the README at ${claimRelease('status.dynamo.transport')} says Dynamo uses TCP`)
  })
})

describe('t5.l3: the ITL chip', () => {
  test('carries no review-process words', () => {
    const r = rendered('t5.l3')
    expect(r).not.toContain('re-read')
    expect(r).not.toContain('secondary pages')
  })
})
