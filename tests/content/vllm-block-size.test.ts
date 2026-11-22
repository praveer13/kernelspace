import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative } from 'node:path'
import { claimNumber } from '@/data/claims'
import { ALL_CLAIMS } from '@/data/claims/all'
import '@/data/claims/lazy/kvpool'
import { ALL_LESSONS } from '@/data/lessons'
import { PAIRS } from '@/data/glossary'
import * as pagedMix from '@/data/lessons/pagedMix'

/**
 * K0-D23. vLLM's default KV block size moved from 16 to 64 at v0.34.0 and the course said 16 in nine places, because prose
 * never read the claim. No learner-facing string may type vLLM's default as a number that is not the claim's value. A number
 * is excused only when it is attributed to the paper and not to vLLM's default (K0-FIX3: "the paper's 16", "16 in the 2023
 * paper", never "vLLM defaults to 16, the paper's choice"), or when its clause names a vLLM release before v0.34.0.
 */

/**
 * The paper's own figure: the word paper (or 2023) right before the number with no engine, 'and' or 'unlike' between them
 * ("the paper's 16", "In the paper, blocks hold 16 tokens"), or right after it ("16 in the paper", "16 (the 2023 paper").
 * "(see the paper)" and "The paper and vLLM both default to 16" are not the paper's figure.
 */
const PAPER_BEFORE = /\b(?:paper|2023)\b([^;:\u2014()]{0,40})$/i
const PAPER_BEFORE_BREAKS = /\bvLLM\b|\bengine|\band\b|\bunlike\b|\bboth\b|\bnow\b|\btoday\b/i
const PAPER_AFTER = /^([^;:\u2014)]{0,60}?)\b(?:paper|2023)\b/i
const PAPER_AFTER_BREAKS = /\bvLLM\b|\bengine|\band\b|\bboth\b|\bsee\b|\bcf\b|\blike\b/i
/**
 * The number given as vLLM's default (K0-FIX3): the engine named with a default verb before the number, in the same stretch
 * of the sentence ('vLLM defaults to 16, the paper's choice', 'Today vLLM keeps the paper's 16 as its default'), or named
 * as vLLM's default right after it with no 'and' or 'against' between ('16 tokens is vLLM's default, as the paper chose';
 * not '16-token blocks and 8.1% at vLLM's default of 64'). Such a number is vLLM's default whatever paper it also names.
 */
/**
 * K0-FIX3B: a default word anywhere in the sentence with vLLM, and nothing that sets the two apart ('and', 'against', 'versus',
 * 'vs', 'but', 'while', 'whereas', 'unlike', ';' or a dash) between the number, the default word and the engine's name:
 * 'The paper's 16 remains vLLM's default block.', 'vLLM still ships the paper's 16 as its default.', '16 tokens, the paper's
 * choice, is what vLLM uses by default.', 'The default in vLLM is the paper's 16.'
 */
const DEFAULT_WORD = /\bdefault(?:s|ed)?\b/gi
const SETS_APART = /\b(?:and|against|versus|vs|but|while|whereas|unlike)\b|;|\u2014/i
/** A default bound to a number of its own: 'vLLM's default of 64', 'vLLM's default is 64 tokens/block'. */
const DEFAULT_BOUND = /^default(?:s|ed)?(?:\s+(?:block\s+)?(?:size\s+)?)?(?:\s*(?:of|is|to|=|:)\s*(?:now\s+|today\s+)?)(\d+)/i
function defaultInSentence(masked: string, i: number, len: number): boolean {
  const own = masked.slice(i, i + len)
  const engines = [...masked.matchAll(/\bvLLM\b/g)].map((m) => m.index ?? 0)
  const defaults = [...masked.matchAll(DEFAULT_WORD)]
    .map((m) => m.index ?? 0)
    .filter((d) => {
      const bound = DEFAULT_BOUND.exec(masked.slice(d))
      return !bound || bound[1] === own
    })
  for (const v of engines)
    for (const d of defaults) {
      const from = Math.min(i, v, d)
      const to = Math.max(i + len, v + 4, d + 7)
      if (!SETS_APART.test(masked.slice(from, to))) return true
    }
  return false
}
const VLLM_DEFAULT_BEFORE = /\bvLLM\b(?!['’]?s?\s+paper)[^;:\u2014]{0,60}\b(?:defaults?|default(?:ed)?|keeps|sets|uses)\b[^;:\u2014]*$/i
const VLLM_DEFAULT_AFTER = /^(?:(?!\b(?:and|but|while|against|versus|vs)\b)[^;:\u2014,])*?\bvLLM['’]?s?\s+(?:own\s+)?default\b/i
/** 'vLLM's 64': the engine's possessive right before the number reads as its default. */
const VLLM_POSSESSIVE = /\bvLLM['’]s\s+$/i
/**
 * A vLLM release old enough to carry the paper's 16, in the number's clause: v0.10.2 (the benchmark's pin) or anything
 * through v0.33.x. An SGLang release is not vLLM's, and 'since v0.1' says the number still holds.
 */
const OLD_RELEASE = /\bv0\.(?:10\.2|\d|[12]\d|3[0-3])\b/i
const NOT_VLLM_RELEASE = /\b(?:SGLang|TensorRT-LLM|TGI|llama\.cpp)\s+v?\d+(?:\.\d+)*|\b(?:since|from|as of)\s+(?:vLLM\s+)?v\d+(?:\.\d+)*/gi
/** Spelled-out block sizes, read as digits. */
const WORD_NUMBERS: Record<string, string> = { four: '4', eight: '8', sixteen: '16', 'thirty-two': '32', 'sixty-four': '64', 'one hundred twenty-eight': '128' }
const WORD_NUMBER = new RegExp(`\\b(?:${Object.keys(WORD_NUMBERS).join('|')})\\b`, 'gi')
/** vLLM the engine: the name, unless it is the paper's ('the vLLM paper', 'the 2023 vLLM paper'). */
const ENGINE = /\bvLLM\b/
/** A default phrase, then the number: 'default 16', 'defaults to 16', 'default of 16', 'the default block in vLLM v0.34.0 is 16'. */
const DEFAULT_BEFORE = /\bdefault(?:s|ed)?\b(?:\s+(?:to|of|is|are|at|=|:|--block-size|block_size|block|size|value|a|an|the|in|for|set|vLLM|V+)\b)*\W{0,3}$/i
/** A block-size phrase right before the number: 'block size is 16', '--block-size 16', 'block_size = 16'. */
const SIZE_BEFORE = /(?:(?:--block-size|\bblock_size)(?:\s+(?:to|of|at|=))?|\bBLOCK\s*=|\bblock[ _-]?size(?:\s+(?:of|is|are|at|=|:|set to))?)\W{0,3}$/i
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
 *   - a token count after 'KV token block (' or 'uniform' / 'fixed' ('KV token block (16 tok)', 'Uniform 16-token blocks'), or
 *   - a token count in parentheses after a block is named ('a KV block is a software choice (16 tokens)'), or
 *   - a token count in a sentence that names --block-size ('Unless --block-size is passed, each block is 16 tokens').
 * Spelled-out sizes ('sixteen tokens') count as digits. Each number carries whether the paper is named next to it and
 * whether its clause names a vLLM release before v0.34.0.
 */
export function blockNumbers(text: string): Array<{ n: number; clause: string; paper: boolean; oldRelease: boolean }> {
  const sentence = text.replace(WORD_NUMBER, (w) => WORD_NUMBERS[w.toLowerCase()] ?? w)
  const masked = sentence
    .replace(/\bvLLM['’]?s? paper\b/gi, (m) => `${' '.repeat(m.length - 5)}paper`)
    .replace(/\bv?\d+\.\d+(?:\.\d+)*/g, (m) => 'V'.repeat(m.length))
  const out: Array<{ n: number; clause: string; paper: boolean; oldRelease: boolean }> = []
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
    // 'A KV block is a software choice (16 tokens)': a parenthesised token count after a block is named.
    const asAside = tokens && /\bblock\s+(?:is|size)\b[^.()]{0,40}\(\s*$/i.test(before)
    // 'Unless --block-size is passed, each block is 16 tokens': the flag's unset value.
    const asFlag = tokens && /--block-size/i.test(masked)
    // "the paper's 16 against vLLM's 64": the engine's possessive names its default (K0-FIX3).
    const asPossessive = VLLM_POSSESSIVE.test(before) && !OTHER_UNIT.test(after)
    // A number the sentence attributes to the paper is a candidate too when the same sentence gives it as vLLM's default
    // (K0-FIX3B: 'The paper's 16 remains vLLM's default block.').
    const pb = PAPER_BEFORE.exec(masked.slice(0, i))
    const pa = PAPER_AFTER.exec(after)
    const named = (pb !== null && !PAPER_BEFORE_BREAKS.test(pb[1] ?? '')) || (pa !== null && !PAPER_AFTER_BREAKS.test(pa[1] ?? ''))
    // ...as long as it counts tokens or blocks, not something else ('the paper's 8 GPUs').
    const countsOther = !tokens && (OTHER_UNIT.test(after) || /^\s+(?!(?:as|is|was|remains|in|from|per|blocks?|by|tokens?)\b)[a-z]/i.test(after))
    // The paper's number, unless the sentence gives it as vLLM's default, before it, right after it, or anywhere in the
    // sentence with nothing setting the default apart from the number.
    const asVllmDefault =
      VLLM_DEFAULT_BEFORE.test(masked.slice(0, i)) || VLLM_DEFAULT_AFTER.test(after.slice(0, 40)) || defaultInSentence(masked, i, len)
    if (!asDefault && !asDefaultAfter && !asSize && !asTokens && !asGlossary && !asAside && !asFlag && !asPossessive && !(named && asVllmDefault && !countsOther)) continue
    const cut = (c: string, from: number, dir: 'back' | 'fwd') => (dir === 'back' ? masked.lastIndexOf(c, from) : masked.indexOf(c, from))
    const start = Math.max(...[',', ';', ':', '—', '('].map((c) => cut(c, i, 'back')))
    const ends = [',', ';', ':', '—', ')'].map((c) => cut(c, i, 'fwd')).filter((x) => x >= 0)
    const end = ends.length ? Math.min(...ends) : masked.length
    const clause = sentence.slice(start + 1, end)
    const paper = named && !asVllmDefault
    const oldRelease = OLD_RELEASE.test(clause.replace(NOT_VLLM_RELEASE, ''))
    out.push({ n: Number(m[1]), clause, paper, oldRelease })
  }
  return out
}

/**
 * '<4%' presented as the paper's figure: a sentence that names the paper and the 4% bound without calling it the course's.
 * The paper's words are "near-zero waste" and its Figure 2 is one experiment's average (K0-FIX3); under 4% is the course's
 * estimate, so a sentence is excused only when its 4% clause says so (K0-FIX3B: a disclaimer in another clause,
 * 'the course estimate agrees', excuses nothing). 'percent' counts as '%'.
 * K0-FIX4: 'four percent' counts too, and a sentence names the paper by its figure, its authors or its venue as well as by
 * the word: 'Figure 2 shows under 4% waste for vLLM.', 'PagedAttention cuts waste to below 4%, per Kwon et al.', 'The
 * authors measured waste under four percent.' all present the bound as the paper's.
 */
const FOUR = String.raw`(?:4\s?(?:%|percent\b|per cent\b)|four(?:\s|-)(?:percent|per cent)\b)`
const FOUR_PERCENT = new RegExp(String.raw`((?:<=?|\u2264)\s?${FOUR}|\b(?:under|below|less than|at most|capped at|sub)[-\s]+${FOUR})`, 'i')
/** Words that name the paper: the word itself, its Figure 2, its first author, its authors, its venue. */
const NAMES_PAPER = /\b(?:paper|fig(?:ure|\.)?\s*2|kwon|authors|sosp)\b/i
/** Abbreviations whose period does not end a sentence ('Fig. 2', 'Kwon et al. report'). */
const unbreak = (s: string) => s.replace(/\b(Fig|al|e\.g|i\.e)\.\s+/g, '$1\u00a0')
/** The clauses of a sentence: split at ';', ',', ':' and dashes; a parenthesis stays with the clause it follows. */
const clauses = (s: string) => s.split(/\s*[;,:\u2014\u2013]\s+|\s*;\s*/).filter(Boolean)
const DISCLAIMS = /(course'?s (?:own )?estimate|course estimate|not in (?:the|its) (?:paper|text)|not in the paper.s text)/i

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
    // An old vLLM release in the number's clause dates it; the paper's own figure is allowed where the paper is named next to it.
    if (found.every((b) => b.oldRelease || (b.n === paper && b.paper))) continue
    bad.push(s.trim())
  }
  return bad
}

export function fourPercentAsPaper(text: string): string[] {
  const bad: string[] = []
  for (const s of sentences(unbreak(text))) {
    if (!FOUR_PERCENT.test(s) || !NAMES_PAPER.test(s)) continue
    // Excused only when every clause that gives the 4% carries the disclaimer itself.
    // A disclaimer inside a parenthesis does not count: '... under 4% (the course's estimate agrees)' still says it as the paper's.
    if (clauses(s).filter((c) => FOUR_PERCENT.test(c)).every((c) => DISCLAIMS.test(c.replace(/\([^()]*\)/g, ' ')))) continue
    bad.push(s.trim())
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
  // K0-FIX3B: the KV simulator and the home page's story carry block-size and waste text this pull request changed.
  'src/components/sims/KvCacheSim.tsx',
  'src/components/home/ScrollStory.tsx',
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

/**
 * K0-FIX3B: every erratum module, read as data. Its `before` is left out: it quotes what the course taught, which is the
 * wrong statement the erratum corrects, by design.
 */
const errataDir = `${root}src/data/errata/`
const errataSurfaces: Array<[string, string]> = []
/** Errata another erratum supersedes: the superseder corrects them, so their typed number is dated history. */
const SUPERSEDED = new Set<string>()
for (const f of readdirSync(errataDir).filter((x) => /^\d.*\.ts$/.test(x)).sort()) {
  const e = ((await import(`${errataDir}${f}`)) as { default: Record<string, unknown> & { supersedes?: string } }).default
  errataSurfaces.push([`src/data/errata/${f}`, strings({ ...e, before: '' }).join('\n')])
  if (e.supersedes) SUPERSEDED.add(`src/data/errata/${e.supersedes}.ts`)
}

const surfaces: Array<[string, string]> = [
  ...ALL_LESSONS.map((l): [string, string] => [l.id, strings(l).join('\n')]),
  ['glossary', strings(PAIRS).join('\n')],
  ...taskLists.map(([id, v]): [string, string] => [id, strings(v).join('\n')]),
  ['claims', ALL_CLAIMS.map((c) => [c.label, c.boundary, c.discrepancy ?? ''].join('\n')).join('\n')],
  ...EXTRA_SOURCES.flatMap(sourceFiles).map((f): [string, string] => [f, prose(f, readFileSync(`${root}${f}`, 'utf8'))]),
  ...errataSurfaces,
]

const N = claimNumber('production.vllm.block-size')

describe('no learner-facing text types vLLM default block size', () => {
  test('the scan covers lessons, the glossary, sim task lists, the sim components, the home story and the errata', () => {
    expect(ALL_LESSONS.length).toBeGreaterThan(50)
    expect(taskLists.map(([id]) => id)).toContain('blockTableExplorer.tasks.ts:BLOCK_TABLE_EXPLORER_TASKS')
    expect(surfaces.length).toBeGreaterThan(ALL_LESSONS.length + 1 + taskLists.length + 2)
    const ids = surfaces.map(([id]) => id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'claims',
        'src/components/sims/AllocatorSim.tsx',
        'src/data/plays.ts',
        'src/components/sims/KvCacheSim.tsx',
        'src/components/home/ScrollStory.tsx',
        'src/data/errata/2026-11-21-paged-waste-not-the-papers-figure.ts',
        'src/data/errata/2026-11-21-vllm-default-block-size-64.ts',
      ]),
    )
  })

  test('every surface passes the typed-default rule', () => {
    const found: string[] = []
    for (const [id, text] of surfaces) {
      if (WHITELIST[id] || SUPERSEDED.has(id)) continue
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
    // K0-E3: a default typed around the flag name.
    expect(typedDefaults('vLLM defaults --block-size to 32.', 64)).toHaveLength(1)
    expect(typedDefaults('vLLM defaults block_size to 32.', 64)).toHaveLength(1)
    expect(typedDefaults('vLLM defaults --block-size to 64.', 64)).toEqual([])
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
      // K0-FIX2-RULES: the closing check's probes, and master's t2.l7 sentence the guard missed.
      'Like SGLang v0.5.23, vLLM\'s default block size is 16.',
      "vLLM's default block size is 16, the same since v0.1.",
      "vLLM's default block size is 16 (see the paper).",
      'The paper and vLLM both default to 16 tokens.',
      'Unless --block-size is passed, each block is 16 tokens.',
      'vLLM ships with a block size of sixteen tokens.',
      'A KV block is a software choice (16 tokens).',
      "a KV block is a software choice (16 tokens) whose byte size depends on the model's layers, heads and dtype",
    ]
    for (const t of typed) expect(typedDefaults(t, 64).length, t).toBe(1)
    // JSX text split across source lines is one sentence once the markup is joined.
    const jsx = "larger blocks amortize table-entry overhead.\n   16 tokens is the{' '}\n   <b>vLLM default</b>."
    expect(typedDefaults(joinMarkup(jsx), 64).length).toBe(1)
  })

  test("K0-FIX3: the paper's number given as vLLM's default fires, and \"vLLM's <n>\" reads as the default", () => {
    // The closing check's six shapes passed the old exemption, which excused any number next to the word paper.
    const asDefault = [
      "vLLM's default block size is 16 tokens, as in the paper.",
      "vLLM defaults to 16, the paper's choice.",
      "vLLM's default is still 16 tokens per block from the 2023 paper.",
      "vLLM's default block size is 16 tokens (as the paper chose).",
      "Today vLLM keeps the paper's 16 as its default.",
      "vLLM's default block size, 16 tokens, comes from the paper.",
      "16 tokens is vLLM's default, as the paper chose.",
    ]
    for (const t of asDefault) expect(typedDefaults(t, 64), t).toHaveLength(1)
    // t1.l4's exercise note typed vLLM's default as "vLLM's 64": at the next re-pin it must fire
    expect(typedDefaults("remember this when T5 weighs the paper's 16 against vLLM's 64.", 128)).toHaveLength(1)
    expect(typedDefaults("remember this when T5 weighs the paper's 16 against vLLM's default of 64.", 128)).toHaveLength(1)
    expect(typedDefaults("remember this when T5 weighs the paper's 16 against vLLM's default of 64.", 64)).toEqual([])
    expect(typedDefaults("wastes 1.4% at the paper's 16-token blocks and 8.1% at vLLM's default of 64.", 64)).toEqual([])
  })

  test("K0-FIX3B: five more shapes of the paper's 16 given as vLLM's default fire", () => {
    const asDefault = [
      "The paper's 16 remains vLLM's default block.",
      "vLLM still ships the paper's 16 as its default.",
      "16 tokens, the paper's choice, is what vLLM uses by default.",
      'The default in vLLM is the paper\'s 16.',
      "vLLM adopted the paper's 16 as its default block size.",
      // The paper's own sentence, undated: in present tense it gives 16 as vLLM's default today (it was a 'form the course
      // keeps' until K0-FIX3B; the course quotes it only in a claim's source quote, which the scan does not read).
      'vLLM sets its default block size as 16 (the 2023 paper, section 7.2).',
    ]
    for (const t of asDefault) expect(typedDefaults(t, 64), t).toHaveLength(1)
    // A separator between the paper's number and vLLM's default still excuses it.
    expect(typedDefaults("The paper chose 16, against vLLM's default of 64.", 64)).toEqual([])
    expect(typedDefaults("The paper's 16 versus vLLM's default of 64.", 64)).toEqual([])
    // A paper number that no sentence calls a default stays out of the scan.
    expect(typedDefaults("The paper's 8 GPUs ran vLLM with its default scheduler.", 64)).toEqual([])
  })

  test('the forms the course keeps do not fire', () => {
    const ok = [
      "The paper's default was 16 tokens per block.",
      'vLLM v0.33.0 defaulted to 16 tokens per block.',
      "vLLM's default is 64 tokens per block (v0.34.0).",
      "ROCm keeps 16, and an explicit --block-size wins over vLLM's default of 64.",
      'The sweep found 16 to 128 tokens best; vLLM\u2019s default now is 64 tokens/block.',
      'A sequence has 100 tokens and the block size is 16.',
      'Waste is at most block_size \u2212 1 tokens.',
      'JSON text is UTF-8 by default (RFC 8259).',
      'the small-tier defaults (256 sequences, 2,048 tokens).',
      // K0-FIX2-RULES: a correct sentence the closing check found firing.
      "In the paper, blocks hold 16 tokens; vLLM's default is now 64 tokens per block.",
      'This lesson works the 2023 paper\'s block of 16 tokens; vLLM\'s default today is 64 tokens/block on CUDA (ROCm\'s paged attention keeps its own size, and an explicit `--block-size` wins).',
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

describe("'<4%' is the course's estimate, never presented as the paper's figure", () => {
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

  test('K0-FIX3B: a disclaimer counts only in the 4% clause, and percent counts as %', () => {
    const bad = [
      "The paper's Figure 2 gives vLLM <4% waste; the course estimate agrees.",
      "Figure 2 of the paper shows waste under 4%, not the course estimate's 8%.",
      'The paper reports under 4 percent waste.',
    ]
    for (const t of bad) expect(fourPercentAsPaper(t), t).toHaveLength(1)
    expect(fourPercentAsPaper("Under 4% KV waste is the course's estimate, not a figure from the PagedAttention paper.")).toEqual([])
    expect(fourPercentAsPaper("The course estimate is under 4 percent; the paper's words are near-zero waste.")).toEqual([])
  })

  test('K0-E3: the written forms of <4% (≤, <=, under-4%, sub-4%) and a disclaimer in a parenthesis', () => {
    const bad = [
      'The paper reports \u22644% waste.',
      'The paper reports <=4% waste.',
      "The paper's under-4% waste figure is famous.",
      'The paper reports sub-4% waste.',
      "The paper says waste is under 4% (the course's estimate agrees).",
    ]
    for (const t of bad) expect(fourPercentAsPaper(t), t).toHaveLength(1)
    expect(fourPercentAsPaper("Under 4% KV waste is the course's estimate, not a figure from the paper (which says near-zero waste).")).toEqual([])
  })

  test('K0-FIX4: the paper is named by its Figure 2, its authors or its venue, and "four percent" counts', () => {
    // The last confirmation's three probes returned [] on the guard of K0-FIX3B, which needed the literal word "paper".
    const bad = [
      'Figure 2 shows under 4% waste for vLLM.',
      'PagedAttention cuts waste to below 4%, per Kwon et al.',
      'The authors measured waste under four percent.',
      'Fig. 2 puts vLLM under 4% waste.',
      'Kwon et al. report waste below 4%.',
      'At SOSP 2023, vLLM showed waste under four per cent.',
    ]
    for (const t of bad) expect(fourPercentAsPaper(t), t).toHaveLength(1)
    // What Figure 2 does imply, said as the lessons and the erratum say it, passes; so do the course's own words.
    const fig2Rest = (pagedMix as Record<string, unknown>).fig2Rest as (() => string) | undefined
    expect(fig2Rest).toBeFunction()
    expect(fourPercentAsPaper(fig2Rest!())).toEqual([])
    expect(fourPercentAsPaper(pagedMix.wasteStory())).toEqual([])
    expect(fourPercentAsPaper("Figure 2 is one experiment's average; under four percent is the course's estimate.")).toEqual([])
  })
})
