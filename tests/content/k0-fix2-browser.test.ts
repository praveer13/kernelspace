import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { ALL_LESSONS } from '@/data/lessons'
import type { Erratum } from '@/data/errata/schema'
import { claimNumber } from '@/data/lessons/claims'
import { mixWastePct } from '@/data/lessons/pagedMix'

const PAPER = claimNumber('serving.pagedattention.paper-block-size')
const ENGINE = claimNumber('production.vllm.block-size')

// The closing browser check of k0-repin: what a learner reads on the rendered pages.

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const text = (id: string) => strings(ALL_LESSONS.find((l) => l.id === id)).join('\n')

describe('errata titles render as headings', () => {
  test('every erratum title starts with a letter or a digit, not a quote mark (the heading face draws a straight quote as a closing curl)', async () => {
    const files = readdirSync('src/data/errata').filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.ts$/.test(f))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const mod = (await import(`@/data/errata/${f.replace(/\.ts$/, '')}`)) as { default: Erratum }
      expect({ file: f, first: mod.default.title.charAt(0) }).toEqual({ file: f, first: expect.stringMatching(/^[\p{L}\p{N}]$/u) })
    }
  })
})

describe('the mixed-batch estimate names one figure per block size', () => {
  for (const id of ['t1.l4', 't5.l5']) {
    test(`${id}: no dangling "under 4%" between the two block sizes`, () => {
      const t = text(id)
      // 1.4% and 8.1% today (36 of 2,624 and 228 of 2,816 slots, recomputed by hand by the closing check).
      expect(t).toContain(`${mixWastePct(PAPER)}% at the paper's ${PAPER}-token blocks (under 4%) and ${mixWastePct(ENGINE)}% at vLLM's ${ENGINE}`)
      expect(t).not.toMatch(/blocks, under 4%, and/)
    })
  }
})
