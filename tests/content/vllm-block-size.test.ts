import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { claimNumber } from '@/data/claims'
import { ALL_LESSONS } from '@/data/lessons'
import { PAIRS } from '@/data/glossary'

/**
 * K0-D23. vLLM's default KV block size moved from 16 to 64 at v0.34.0 and the course said 16 in nine places, because prose
 * never read the claim. No learner-facing string may type vLLM's default as a number that is not the claim's value, unless
 * the sentence names the paper (the 2023 figure) or v0.10.2 (the benchmark's pin).
 */

const DEFAULT_RULE = /\b(default[^.]{0,30}\b\d+\b[- ]tokens?|\d+[- ]tokens?[^.]{0,30}\bdefault|vLLM'?s \d+-token)/i
const NAMES_SOURCE = /\bpaper|\b2023\b|v?0\.10\.2/i

/** '<4%' presented as the paper's figure: a sentence that names the paper and the 4% bound and does not disclaim it. */
const FOUR_PERCENT = /(<\s?4\s?%|\b(?:under|below|less than|at most|capped at)\s+4\s?%)/i
const DISCLAIMS = /(does not report|do not report|not report|never the paper|not a figure|not the paper|not in (?:the|its) (?:paper|text)|not in the paper.s text|course'?s (?:own )?estimate|course estimate)/i

export function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)

export function typedDefaults(text: string, n: number): string[] {
  const bad: string[] = []
  for (const s of sentences(text)) {
    const m = DEFAULT_RULE.exec(s)
    if (!m) continue
    if (NAMES_SOURCE.test(s)) continue
    const nums = (m[0].match(/\b\d+\b/g) ?? []).map(Number)
    if (nums.length > 0 && nums.every((x) => x === n)) continue
    bad.push(s.trim())
  }
  return bad
}

export function fourPercentAsPaper(text: string): string[] {
  const bad: string[] = []
  for (const s of sentences(text)) {
    if (FOUR_PERCENT.test(s) && /\bpaper/i.test(s) && !DISCLAIMS.test(s)) bad.push(s.trim())
  }
  return bad
}

// Whitelist by surface id, with the reason. Empty: every surface passes on the rule itself.
const WHITELIST: Record<string, string> = {}

// t2.l7's '<4%' sites belong to K0-C17; they are scanned like the rest once that task's text is in the tree.
const SKIP_FOUR_PERCENT: Record<string, string> = {}

const root = new URL('../../', import.meta.url).pathname
const tasksDir = `${root}src/components/sims/`
const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith('.tasks.ts'))
const taskLists: Array<[string, unknown]> = []
for (const f of taskFiles) {
  const mod = (await import(`${tasksDir}${f}`)) as Record<string, unknown>
  for (const [k, v] of Object.entries(mod)) if (Array.isArray(v)) taskLists.push([`${f}:${k}`, v])
}

const surfaces: Array<[string, string]> = [
  ...ALL_LESSONS.map((l): [string, string] => [l.id, strings(l).join('\n')]),
  ['glossary', strings(PAIRS).join('\n')],
  ...taskLists.map(([id, v]): [string, string] => [id, strings(v).join('\n')]),
  ['AllocatorSim.tsx', readFileSync(`${tasksDir}AllocatorSim.tsx`, 'utf8')],
  ['BlockTableExplorer.tsx', readFileSync(`${tasksDir}BlockTableExplorer.tsx`, 'utf8')],
]

const N = claimNumber('production.vllm.block-size')

describe('no learner-facing text types vLLM default block size', () => {
  test('the scan covers lessons, the glossary, sim task lists and both sim components', () => {
    expect(ALL_LESSONS.length).toBeGreaterThan(50)
    expect(taskLists.map(([id]) => id)).toContain('blockTableExplorer.tasks.ts:BLOCK_TABLE_EXPLORER_TASKS')
    expect(surfaces.length).toBe(ALL_LESSONS.length + 1 + taskLists.length + 2)
  })

  test('every surface passes the typed-default rule', () => {
    const found: string[] = []
    for (const [id, text] of surfaces) {
      if (WHITELIST[id]) continue
      for (const s of typedDefaults(text, N)) found.push(`${id}: ${s.slice(0, 160)}`)
    }
    expect(found).toEqual([])
  })

  test('the rule fires on fixtures and spares the allowed forms', () => {
    expect(typedDefaults('vLLM uses a default of 16 tokens per block.', 64).length).toBe(1)
    expect(typedDefaults("vLLM's 16-token blocks hold the line.", 64).length).toBe(1)
    expect(typedDefaults('Blocks of 16 tokens are the default.', 64).length).toBe(1)
    expect(typedDefaults('vLLM uses a default of 64 tokens per block.', 64)).toEqual([])
    expect(typedDefaults('The paper used a default of 16 tokens per block.', 64)).toEqual([])
    expect(typedDefaults('At v0.10.2 the default is 16 tokens.', 64)).toEqual([])
  })

  test('the lessons that state the default carry the claim value', () => {
    for (const id of ['t5.l5', 't1.l4', 't5.l6']) {
      const l = ALL_LESSONS.find((x) => x.id === id)
      if (!l) throw new Error(`${id} not found`)
      expect(strings(l).join('\n')).toContain(String(N))
    }
  })

  test('the engine default is larger than the paper block, or the trade sentences need rewriting', () => {
    expect(N).toBeGreaterThan(claimNumber('serving.pagedattention.paper-block-size'))
  })
})

describe("'<4%' is never the paper's figure", () => {
  test('no surface calls it the paper figure or headline', () => {
    const found: string[] = []
    for (const [id, text] of surfaces) {
      if (SKIP_FOUR_PERCENT[id]) continue
      for (const s of fourPercentAsPaper(text)) found.push(`${id}: ${s.slice(0, 160)}`)
    }
    expect(found).toEqual([])
  })

  test('the rule fires on fixtures and spares the disclaimers', () => {
    expect(fourPercentAsPaper("The paper's headline: waste under 4%.").length).toBe(1)
    expect(fourPercentAsPaper('Waste capped at <4% in the paper.').length).toBe(1)
    expect(fourPercentAsPaper('The course estimate is under 4%, a figure the paper does not report.')).toEqual([])
    expect(fourPercentAsPaper('Waste under 4% for a mixed batch.')).toEqual([])
  })
})
