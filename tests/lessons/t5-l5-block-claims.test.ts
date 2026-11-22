import { describe, expect, test } from 'bun:test'
import { claimNumber } from '@/data/claims'
import { claimRelease } from '@/data/claims/cite'
import { ALL_LESSONS } from '@/data/lessons'
import { fractionText } from '@/data/lessons/claims'
import { wasteStory } from '@/data/lessons/pagedMix'

const lesson = ALL_LESSONS.find((l) => l.id === 't5.l5')
if (!lesson) throw new Error('t5.l5 not found')

/** Every string reachable from the lesson, however deep. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const all = strings(lesson)
const text = all.join('\n')
// T5.L4's 8B model: KV bytes per token are a claim, so the MiB per block follow it (K0-FIX4).
const kib = claimNumber('model.llama3-8b.kv-bytes-per-token') / 1024
const paper = claimNumber('serving.pagedattention.paper-block-size')
const engine = claimNumber('production.vllm.block-size')

describe('t5.l5 block-size claims (K0-D12)', () => {
  test("the JSON carries vLLM's default and its release from the claim", () => {
    expect(JSON.stringify(lesson)).toContain(String(engine))
    expect(text).toContain(claimRelease('production.vllm.block-size'))
    expect(text).toContain(`${engine} × ${kib} KiB = ${(engine * kib) / 1024} MiB`)
  })

  test("the worked block is the paper's 16 and says so", () => {
    expect(text).toContain("2023 paper's block of 16 tokens")
    expect(text).toContain(`${paper} × ${kib} KiB = ${(paper * kib) / 1024} MiB`)
  })

  test('no string types vLLM default as 16', () => {
    for (const s of all) expect(s).not.toMatch(/default 16\b|16 tokens by default|16-token default|16 is the default|\(default 16/)
  })

  test('the pool sentence names where N comes from, with both pool claims', () => {
    expect(text).toContain('N is what is left of the GPU after the weights and warmup')
    expect(text).toContain(claimRelease('production.vllm.extensible-kv-cache'))
    expect(text).toContain(`With the extensible KV cache on, \`gpu_memory_utilization\` defaults to ${fractionText(claimNumber('production.vllm.gpu-memory-utilization'))};`)
  })

  test("<4% is not called the paper's figure", () => {
    expect(text).not.toContain('**<4%**')
    expect(text).toContain('near-zero waste in the paper')
    expect(text).toContain(`${claimNumber('model.kv.static-utilization-low')}%–${claimNumber('model.kv.static-utilization-high')}%`)
    expect(text).toContain(wasteStory())
    expect(text).toContain("is the course's estimate, not the paper's")
    expect(text).not.toContain('does not report')
  })

  test('the block-size quiz keeps correct [1]', () => {
    const quiz = lesson.blocks.find((b) => b.type === 'quiz')
    if (quiz?.type !== 'quiz') throw new Error('no quiz block')
    const q = quiz.questions.find((x) => x.q.startsWith('The block size ('))
    expect(q?.correct).toEqual([1])
    expect(q?.q).toContain(`${engine} by default in ${claimRelease('production.vllm.block-size')}`)
  })
})
