/**
 * K0-FIX4-T5: the t5 lane's fourth fix round.
 * - t5.l3's ITL chip and its erratum name no study: the course read none, so they say only that adult silent reading is
 *   far slower than 50 ms per token at T5.L2's words-per-token rule.
 * - The t5.l8 mixed-batches erratum's title says what the lesson says of TensorRT-LLM: it chunks on request.
 * - t5.l10's comparison table says which cells were read, and takes every release and read date from a claim: the SGLang
 *   "Runs on" cell is its claim's cite, and the sentence before the table types no date and no release.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { lessonById } from '@/data/lessons'
import { claimCite, claimRelease } from '@/data/lessons/claims'
import { ENGINES_STATUS_CLAIMS } from '@/data/claims/lazy/engines-status'
import itl from '@/data/errata/2026-11-22-t5-l3-itl-reading-speed'
import mixed from '@/data/errata/2026-11-22-t5-l8-mixed-batches-not-default-everywhere'
import table from '@/data/errata/2026-11-23-t5-l10-trtllm-pytorch-only'

type Block = { type: string; md?: string; stats?: { label: string; hint?: string }[] }
const blocks = (id: string): Block[] => (lessonById(id) as unknown as { blocks: Block[] }).blocks

const itlHint = (): string => {
  const chip = blocks('t5.l3').flatMap((b) => (b.type === 'statline' ? (b.stats ?? []) : [])).find((s) => s.label === 'ITL comfort')
  if (chip?.hint === undefined) throw new Error('t5.l3 has no ITL comfort chip with a hint')
  return chip.hint
}

describe('t5.l3: the ITL chip and its erratum name no study the course has not read', () => {
  const sentence = 'Adult silent reading is far slower than 50 ms per token at T5.L2\'s rule of about 0.75 words per token'
  test('the chip and the erratum\'s after say the same sentence', () => {
    expect(itlHint()).toContain(sentence)
    expect(itl.after).toContain(sentence)
  })
  test('no study, journal or year is named in the chip or anywhere in the erratum', () => {
    for (const text of [itlHint(), JSON.stringify(itl)]) {
      expect(text).not.toMatch(/Brysbaert|meta-analysis|Memory and Language|2019|study is known/)
    }
    // K0-CLOSE-A: the erratum cites the words-per-token rule its after uses (every new erratum has a source); still no study.
    expect(itl.source?.url).toBe('https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them')
  })
  test('the erratum\'s why gives the arithmetic: 0.75 words per token every 50 ms is 900 words a minute', () => {
    expect((0.75 / 0.05) * 60).toBeCloseTo(900, 9)
    expect(itl.why).toContain('900 words a minute')
  })
})

describe('t5.l8: the mixed-batches erratum title matches the lesson on TensorRT-LLM', () => {
  test('the title says TensorRT-LLM chunks on request and does not say only vLLM mixes', () => {
    expect(mixed.title).toBe('vLLM mixes prefill and decode by default; SGLang chunks but mixes on request, and TensorRT-LLM chunks on request')
    expect(mixed.title.length).toBeLessThanOrEqual(240)
  })
})

describe('t5.l10: the comparison table says which cells were read, from claims', () => {
  const md = blocks('t5.l10').find((b) => b.type === 'prose' && b.md?.startsWith('## The comparison, compressed'))!.md!
  const before = md.slice(0, md.indexOf('| |'))
  const row = (name: string): string[] => md.split('\n').find((l) => l.startsWith(`| **${name}** |`))!.split('|').map((c) => c.trim())

  test('the SGLang "Runs on" cell is its claim\'s cite, release and read date included', () => {
    expect(row('Runs on')[3]).toBe(claimCite('status.sglang.hardware'))
  })
  test('every date before the table is a read date of a claim it cites, and the claims\' releases are named', () => {
    const verified = new Set(ENGINES_STATUS_CLAIMS.map((c) => c.verifiedAt))
    const dates = before.match(/\d{4}-\d{2}-\d{2}/g) ?? []
    expect(dates.length).toBeGreaterThan(0)
    for (const d of dates) expect(verified.has(d)).toBe(true)
    expect(before).toContain(claimCite('status.trtllm.pytorch-sole-backend'))
    expect(before).toContain(claimRelease('status.sglang.hardware'))
    // K0-CLOSE-A: no claim holds vLLM's release-notes line, so the caption no longer counts that cell as checked.
    expect(before).not.toContain(claimRelease('twin.vllm.scheduler'))
    expect(before).toContain('the course\'s summary')
  })
  test('the lesson source types no date and no release in the comparison or the SGLang section', () => {
    const src = readFileSync(new URL('../../src/data/lessons/t5/production-stack.ts', import.meta.url), 'utf8')
    const cut = (from: string, to: string): string => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)))
    for (const part of [cut('## The comparison, compressed', '`,'), cut('**What it is now:**', '**Trade-offs chosen:**')]) {
      expect(part).not.toMatch(/\d{4}-\d{2}-\d{2}/)
      expect(part).not.toMatch(/\bv\d+\.\d+/)
    }
  })
  test('vLLM\'s Rust front end is a second front end beside the Python one', () => {
    expect(row('Language core')[2]).toBe('Python + CUDA; a second, Rust front end')
    expect(before).not.toContain('"the Python and Rust frontends"')
  })
  test('the erratum\'s why says the table names which cells were read, not that every cell names a release', () => {
    expect(table.why).not.toContain('each cell now names')
    expect(table.why).toContain('the table now says which cells were read.')
  })
})
