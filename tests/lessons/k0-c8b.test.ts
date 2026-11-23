/**
 * K0-C8b: t5.l10's comparison table is dated, and the engine facts around it read their claims. The fault was an
 * undated table: a learner could not tell which release each cell described.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '../../src/data/lessons'
import { ENGINES_STATUS_CLAIMS } from '../../src/data/claims/lazy/engines-status'
import erratum from '../../src/data/errata/2026-11-23-t5-l10-trtllm-pytorch-only'

const lesson = ALL_LESSONS.find((l) => l.id === 't5.l10')!
const blocks = lesson.blocks as { type: string; md?: string }[]
const comparison = blocks.find((b) => b.type === 'prose' && b.md?.startsWith('## The comparison, compressed'))!
const md = comparison.md!

describe('t5.l10 comparison table', () => {
  test('a sentence before the table says "as of <date>"', () => {
    const before = md.slice(0, md.indexOf('| |'))
    expect(before).toMatch(/as of \d{4}-\d{2}-\d{2}/)
  })
  test('the date is the day the claims behind the table were read', () => {
    const date = /as of (\d{4}-\d{2}-\d{2})/.exec(md)![1]
    for (const id of ['status.sglang.hardware', 'status.trtllm.pytorch-sole-backend']) {
      expect(ENGINES_STATUS_CLAIMS.find((c) => c.id === id)!.verifiedAt).toBe(date!)
    }
  })
  test('SGLang is not "any CUDA" and TRT-LLM is not a build-time compiler', () => {
    expect(md).not.toMatch(/\| any CUDA \|/)
    const text = JSON.stringify(lesson)
    expect(text).not.toContain('the structured-generation specialist')
    expect(text).not.toContain('the PyTorch backend is the default')
    expect(text).not.toContain('Red Hat/Google/CoreWeave')
  })
})

describe('the claims t5.l10 reads', () => {
  test('each is a pinned status claim whose source url holds its tag', () => {
    const ids = ['status.trtllm.pytorch-sole-backend', 'status.trtllm.dynamo-pin', 'status.sglang.hardware', 'status.llm-d.founders']
    for (const id of ids) {
      const c = ENGINES_STATUS_CLAIMS.find((x) => x.id === id)!
      expect(c.kind).toBe('status')
      expect(c.pin).toBeDefined()
      expect(c.source!.url).toContain(c.pin!.ref)
      expect(c.source!.quote!.length).toBeGreaterThan(20)
    }
  })
  test('the erratum supersedes the 2026-10-05 one and names t5.l10', () => {
    expect(erratum.supersedes).toBe('2026-10-05-t5-l10-trtllm-pytorch-default')
    expect(erratum.lessons).toContain('t5.l10')
  })
})
