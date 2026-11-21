import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative } from 'node:path'
import { claimNumber } from '@/data/claims'
import { ALL_CLAIMS } from '@/data/claims/all'
import '@/data/claims/lazy/kvpool'
import { ALL_LESSONS } from '@/data/lessons'
import { PAIRS } from '@/data/glossary'

/**
 * K0-D23. vLLM's default KV block size moved from 16 to 64 at v0.34.0 and the course said 16 in nine places, because prose
 * never read the claim. No learner-facing string may type vLLM's default as a number that is not the claim's value, unless
 * the sentence names the paper (the 2023 figure) or v0.10.2 (the benchmark's pin).
 */

const NAMES_SOURCE = /\bpaper|\b2023\b/i
/** A release old enough to carry the paper's 16: v0.10.2 (the benchmark's pin) or anything through v0.33.x. */
const OLD_RELEASE = /\bv0\.(?:10\.2|\d|[12]\d|3[0-3])\b/i
/** vLLM the engine: the name, unless it is the paper's ('the vLLM paper', 'the 2023 vLLM paper'). */
const ENGINE = /\bvLLM\b/
/** A default phrase, then the number: 'default 16', 'defaults to 16', 'default of 16', 'the default block in vLLM v0.34.0 is 16'. */
const DEFAULT_BEFORE = /\bdefault(?:s|ed)?\b(?:\s+(?:to|of|is|are|at|=|:|block|size|value|a|an|the|in|for|set|vLLM|V+)\b)*\W{0,3}$/i
/** A block-size phrase right before the number: 'block size is 16', '--block-size 16', 'block_size = 16'. */
const SIZE_BEFORE = /(?:--block-size|\bBLOCK\s*=|\bblock[ _-]?size(?:\s+(?:of|is|are|at|=|:|set to))?)\W{0,3}$/i
/** Block sizes are powers of two, so no other integer is a candidate. */
const POWERS = new Set([4, 8, 16, 32, 64, 128, 256, 512, 1024])
const TOKEN_UNIT = /^[- ]?tok(?:en)?s?\b/i
const OTHER_UNIT = /^\s*(?:B|bytes?|%|GiB|GB|MiB|KiB|sequences|seqs|experts|ms|s|x)\b/

/**
 * The integers of a sentence that read as vLLM's default block size, each with its clause. Versions ('v0.34.0') and decimals
 * are masked first, so the dots of a release number neither hide a number nor end a window, and windows are counted in
 * characters, so no word order escapes. A number counts when
 *   - a default phrase ends just before it ('default 16', 'defaults to 16', 'the default block in vLLM v0.34.0 is 16'), or
 *   - a block-size phrase ends just before it and the sentence names the engine ('vLLM's block size is 16', '--block-size 16'), or
 *   - it is a token count ('16-token', '16 tokens', '16 tok') within 45 characters of 'default' or the engine's name
 *     ('vLLM uses 16-token blocks', '16 tokens is the vLLM default'), or
 *   - a token count after 'KV token block (' or 'uniform' / 'fixed' ('KV token block (16 tok)', 'Uniform 16-token blocks').
 */
export function blockNumbers(sentence: string): Array<{ n: number; clause: string }> {
  const masked = sentence
    .replace(/\bvLLM['’]?s? paper\b/gi, 'paper')
    .replace(/\bv?\d+\.\d+(?:\.\d+)*/g, (m) => 'V'.repeat(m.length))
  const out: Array<{ n: number; clause: string }> = []
  for (const m of masked.matchAll(/(?<![\w.-])(\d{1,4})(?!\w|\.\d|,\d)/g)) {
    const i = m.index ?? 0
    if (!POWERS.has(Number(m[1]))) continue
    const len = m[1]!.length
    // '16 to 128 tokens' is a range the paper swept, not a default.
    if (/\d\s*(?:to|[-\u2013])\s*$/.test(masked.slice(Math.max(0, i - 8), i)) || /^\s*(?:to|[-\u2013])\s*\d/.test(masked.slice(i + len))) continue
    const before = masked.slice(Math.max(0, i - 60), i)
    const after = masked.slice(i + len)
    const near = masked.slice(Math.max(0, i - 45), i + len + 45)
    const tokens = TOKEN_UNIT.test(after)
    const asDefault = DEFAULT_BEFORE.test(before) && !OTHER_UNIT.test(after)
    const asDefaultAfter = /^\s*(?:tokens?\s+)?(?:is|are|was|as)\s+(?:also\s+)?(?:the|its)\s+(?:vLLM\s+|engine\s+)?default\b|^\s*(?:tokens?\s+)?(?:by|as)\s+default\b/i.test(after)
    const asSize = SIZE_BEFORE.test(before) && ENGINE.test(masked)
    const asTokens = tokens && (/default/i.test(near) || ENGINE.test(near))
    const asGlossary = tokens && (/\bKV (?:token )?blocks?\s*\($/i.test(before) || /\b(?:uniform|fixed)[- ]$/i.test(before))
    if (!asDefault && !asDefaultAfter && !asSize && !asTokens && !asGlossary) continue
    const cut = (c: string, from: number, dir: 'back' | 'fwd') => (dir === 'back' ? masked.lastIndexOf(c, from) : masked.indexOf(c, from))
    const start = Math.max(...[',', ';', ':', '—', '('].map((c) => cut(c, i, 'back')))
    const ends = [',', ';', ':', '—', ')'].map((c) => cut(c, i, 'fwd')).filter((x) => x >= 0)
    const end = ends.length ? Math.min(...ends) : masked.length
    out.push({ n: Number(m[1]), clause: sentence.slice(start + 1, end) })
  }
  return out
}

/** '<4%' presented as the paper's figure: a sentence that names the paper and the 4% bound and does not disclaim it. */
const FOUR_PERCENT = /(<\s?4\s?%|\b(?:under|below|less than|at most|capped at)\s+4\s?%)/i
const DISCLAIMS = /(does not report|do not report|not report|never the paper|not a figure|not the paper|not in (?:the|its) (?:paper|text)|not in the paper.s text|course'?s (?:own )?estimate|course estimate)/i

const PAPER = claimNumber('serving.pagedattention.paper-block-size')

export function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

/** Joins JSX and markup text onto one line first, so a sentence split across source lines is still one sentence. */
export const joinMarkup = (src: string) => src.replace(/\{' '\}/g, ' ').replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ')

/** A .tsx file's text with tags joined onto one line; a .ts file's string literals, one per line (code and comments carry no prose). */
export const prose = (file: string, src: string) =>
  file.endsWith('.tsx') ? joinMarkup(src) : (src.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`/g) ?? []).join('\n')

const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)

export function typedDefaults(text: string, n: number, paper = PAPER): string[] {
  const bad: string[] = []
  for (const s of sentences(text)) {
    const found = blockNumbers(s).filter((b) => b.n !== n)
    if (found.length === 0) continue
    if (OLD_RELEASE.test(s)) continue
    // The paper's own figure is allowed where the word paper (or 2023) sits in the same clause as the number.
    if (found.every((b) => b.n === paper && NAMES_SOURCE.test(b.clause))) continue
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

/** Source files whose prose a learner reads and that no data module above covers: scanned as joined text. */
const EXTRA_SOURCES = [
  'src/components/sims/AllocatorSim.tsx',
  'src/components/sims/BlockTableExplorer.tsx',
  'src/data/plays.ts',
  'src/data/twins',
  'src/data/forge',
  'src/components/play',
  'src/lib/items/families/frag.ts',
  'src/lib/items/families/kv.ts',
  'src/lib/capstone-checks.ts',
]
function sourceFiles(path: string): string[] {
  const full = `${root}${path}`
  if (!statSync(full).isDirectory()) return [path]
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => `${path}/${relative(full, `${e.parentPath}/${e.name}`)}`)
}

const surfaces: Array<[string, string]> = [
  ...ALL_LESSONS.map((l): [string, string] => [l.id, strings(l).join('\n')]),
  ['glossary', strings(PAIRS).join('\n')],
  ...taskLists.map(([id, v]): [string, string] => [id, strings(v).join('\n')]),
  ['claims', ALL_CLAIMS.map((c) => [c.label, c.boundary, c.discrepancy ?? ''].join('\n')).join('\n')],
  ...EXTRA_SOURCES.flatMap(sourceFiles).map((f): [string, string] => [f, prose(f, readFileSync(`${root}${f}`, 'utf8'))]),
]

const N = claimNumber('production.vllm.block-size')

describe('no learner-facing text types vLLM default block size', () => {
  test('the scan covers lessons, the glossary, sim task lists and both sim components', () => {
    expect(ALL_LESSONS.length).toBeGreaterThan(50)
    expect(taskLists.map(([id]) => id)).toContain('blockTableExplorer.tasks.ts:BLOCK_TABLE_EXPLORER_TASKS')
    expect(surfaces.length).toBeGreaterThan(ALL_LESSONS.length + 1 + taskLists.length + 2)
    expect(surfaces.map(([id]) => id)).toEqual(expect.arrayContaining(['claims', 'src/components/sims/AllocatorSim.tsx', 'src/data/plays.ts']))
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

  test("the nine sentences master typed, and the phrasings a reviewer probed, all fire at 64", () => {
    const typed = [
      '- **vLLM KV blocks** \u2014 every block holds the same number of tokens (default 16). A 300-token sequence needs 19 blocks.',
      "Block tables grow; vLLM's 16-token default is a balance, not a proven optimum.",
      'partition each sequence\'s KV cache into **blocks** of a fixed number of tokens (default 16).',
      'The block manager splits GPU KV memory into fixed-size **blocks** \u2014 default 16 tokens per block.',
      'BLOCK = 16                      # tokens per block (vLLM default)',
      'The block size (default 16 tokens) trades off\u2026',
      '16 is the default because it is large enough to use the GPU efficiently.',
      'Blocks have a fixed size, 16 tokens by default.',
      'In one line: why is 16 tokens the default block size, and not 4 or 64?',
      'KV token block (16 tok)',
      'Uniform 16-token blocks cap waste at the tail.',
      'exactly why vLLM pages the KV cache in uniform 16-token blocks',
      "vLLM's default block size is 16.",
      'vLLM defaults to 16.',
      '--block-size defaults to 16 in vLLM.',
      'vLLM uses 16-token blocks.',
      'The default block in vLLM v0.34.0 is 16 tokens.',
      "Unlike the 2023 paper's sweep, vLLM's default is 16 tokens.",
      "vLLM's block size is 16.",
    ]
    for (const t of typed) expect(typedDefaults(t, 64).length, t).toBe(1)
    // JSX text split across source lines is one sentence once the markup is joined.
    const jsx = "larger blocks amortize table-entry overhead.\n   16 tokens is the{' '}\n   <b>vLLM default</b>."
    expect(typedDefaults(joinMarkup(jsx), 64).length).toBe(1)
  })

  test('the forms the course keeps do not fire', () => {
    const ok = [
      "The paper's default was 16 tokens per block.",
      'vLLM sets its default block size as 16 (the 2023 paper, section 7.2).',
      'vLLM v0.33.0 defaulted to 16 tokens per block.',
      "vLLM's default is 64 tokens per block (v0.34.0).",
      "ROCm keeps 16, and an explicit --block-size wins over vLLM's default of 64.",
      'The sweep found 16 to 128 tokens best; vLLM\u2019s default now is 64 tokens/block.',
      'A sequence has 100 tokens and the block size is 16.',
      'Waste is at most block_size \u2212 1 tokens.',
      'JSON text is UTF-8 by default (RFC 8259).',
      'the small-tier defaults (256 sequences, 2,048 tokens).',
    ]
    for (const t of ok) expect(typedDefaults(t, 64), t).toEqual([])
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
