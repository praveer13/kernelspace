/**
 * verify-lesson-shape — the audit's D3, D5, D8 and D10 measures as a ratchet (Wave 1 stage 0, task K5-1).
 *
 * Per lesson: a predict block; the words before the first thing to do; the longest stretch without one; diagrams with no
 * predictAt; analogy callouts with no "where it breaks"; exercise blocks still on legacy `tasks`; a title that says
 * "current", "modern", "new", "today" or a year; errata written into prose. Quiz options over a word limit are reported,
 * not gated.
 *
 * Today's violations are in scripts/baselines/lesson-shape.json. The test fails on a new violation or a lesson that gets
 * worse, and on a baseline entry that is now fixed (remove its line). `--update` refuses an addition.
 *
 *   bun scripts/verify-lesson-shape.ts           the per-lesson table and the audit's counts
 *   bun scripts/verify-lesson-shape.ts --check   exit 1 on a finding
 *   bun scripts/verify-lesson-shape.ts --update  rewrite the baseline with fixes only; refuses additions
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_LESSONS } from '../src/data/lessons'
import type { ContentBlock, Lesson } from '../src/data/lessons/types'

export const AUDIT = {
  noPredict: 39,
  quizFirst: 12,
  over900: 17,
  ungatedDiagram: 10,
  analogyNoBreaks: 53,
  legacyTasks: 16,
} as const

/** A recorded choice, not a violation: the exam and the retrieval opening. */
export const EXEMPT_FIRST = new Set(['t2.l7', 't3.l1'])

export const QUIZ_OPTION_WORDS = 25

export interface ShapeRow {
  lesson: string
  rule: string
  value: number
  note?: string
}

export interface ShapeScan {
  rows: ShapeRow[]
  /** The audit's counts, measured today. */
  totals: Record<string, number>
  /** Quiz options over the limit: reported, not gated. */
  longOptions: { lesson: string; count: number }[]
}

const ACTIVITY = (b: ContentBlock): boolean =>
  b.type === 'predict' ||
  b.type === 'quiz' ||
  b.type === 'exercise' ||
  b.type === 'play' ||
  b.type === 'protege' ||
  (b.type === 'diagram' && !!b.predictAt) ||
  (b.type === 'code' && (b.align?.length ?? 0) > 0) ||
  b.type === 'reading' ||
  (b.type === 'isomorphism' && !!b.breakItem)

const words = (text: string): number => text.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length

/** A block's markdown text, for the errata-in-prose count. */
const proseOf = (b: ContentBlock): string => {
  const md = (b as { md?: unknown }).md
  return typeof md === 'string' ? md : ''
}

/** The prose words of a block: every string field except a code listing (the words a reader reads between tasks). */
const wordsOfBlock = (b: ContentBlock): number => {
  const walk = (v: unknown, k: string): number => {
    if (k === 'lang' || k === 'filename') return 0
    if (typeof v === 'string') return words(v)
    if (Array.isArray(v)) return v.reduce((n, x) => n + walk(x, k), 0)
    if (v && typeof v === 'object') return Object.entries(v).reduce((n, [key, x]) => n + walk(x, key), 0)
    return 0
  }
  return walk(b, '')
}

/** The words before the first activity, the longest activity-free stretch, and the first activity's type. */
export function stretches(lesson: Lesson): { beforeFirst: number; longest: number; first: string | null } {
  let gap = 0
  let longest = 0
  let beforeFirst = 0
  let first: string | null = null
  for (const block of lesson.blocks) {
    if (ACTIVITY(block)) {
      if (first === null) {
        first = block.type
        beforeFirst = gap
      }
      longest = Math.max(longest, gap)
      gap = 0
    } else {
      gap += wordsOfBlock(block)
    }
  }
  longest = Math.max(longest, gap)
  if (first === null) beforeFirst = longest
  return { beforeFirst, longest, first }
}

const TITLE_RULE = /\b(current|modern|new|today)\b|\b20\d{2}\b/i
const ERRATA_PROSE = /\b(now lists|when this lesson was written|since deprecated)\b/gi

/** Every shape violation today, plus the counts the audit recorded. */
export function scanShape(): ShapeScan {
  const rows: ShapeRow[] = []
  const totals = { noPredict: 0, quizFirst: 0, over900: 0, ungatedDiagram: 0, analogyNoBreaks: 0, legacyTasks: 0, title: 0, errataProse: 0 }
  const longOptions: { lesson: string; count: number }[] = []
  for (const lesson of ALL_LESSONS) {
    const s = stretches(lesson)
    if (!lesson.blocks.some((b) => b.type === 'predict')) {
      rows.push({ lesson: lesson.id, rule: 'no-predict', value: 1 })
      totals.noPredict += 1
    }
    if (s.first === 'quiz' && !EXEMPT_FIRST.has(lesson.id)) {
      rows.push({ lesson: lesson.id, rule: 'quiz-first', value: 1 })
      totals.quizFirst += 1
    }
    if (s.longest > 900) {
      rows.push({ lesson: lesson.id, rule: 'long-prose', value: s.longest, note: `${s.longest} words` })
      totals.over900 += 1
    }
    const diagrams = lesson.blocks.filter((b) => b.type === 'diagram' && !b.predictAt).length
    if (diagrams > 0) {
      rows.push({ lesson: lesson.id, rule: 'ungated-diagram', value: diagrams })
      totals.ungatedDiagram += diagrams
    }
    const analogies = lesson.blocks.filter((b) => b.type === 'callout' && b.variant === 'analogy' && !b.breaks).length
    if (analogies > 0) {
      rows.push({ lesson: lesson.id, rule: 'analogy-no-breaks', value: analogies })
      totals.analogyNoBreaks += analogies
    }
    const legacy = lesson.blocks.filter((b) => b.type === 'exercise' && 'tasks' in b && !('taskIds' in b) && !('fleet' in b)).length
    if (legacy > 0) {
      rows.push({ lesson: lesson.id, rule: 'legacy-tasks', value: legacy })
      totals.legacyTasks += legacy
    }
    if (TITLE_RULE.test(lesson.title)) {
      rows.push({ lesson: lesson.id, rule: 'title-rule', value: 1, note: lesson.title })
      totals.title += 1
    }
    const errata = lesson.blocks.reduce((n, b) => n + (proseOf(b).match(ERRATA_PROSE)?.length ?? 0), 0)
    if (errata > 0) {
      rows.push({ lesson: lesson.id, rule: 'errata-prose', value: errata })
      totals.errataProse += errata
    }
    const long = lesson.blocks
      .filter((b) => b.type === 'quiz')
      .flatMap((b) => (b.type === 'quiz' ? b.questions : []))
      .reduce((n, q) => n + q.options.filter((o) => words(o) > QUIZ_OPTION_WORDS).length, 0)
    if (long > 0) longOptions.push({ lesson: lesson.id, count: long })
  }
  return { rows, totals, longOptions }
}

export const BASELINE = join(import.meta.dir, 'baselines/lesson-shape.json')

export const readBaseline = (): ShapeRow[] => {
  if (!existsSync(BASELINE)) return []
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as ShapeRow[]
}

const key = (r: ShapeRow): string => `${r.lesson}|${r.rule}`

export interface ShapeFindings {
  worse: ShapeRow[]
  stale: ShapeRow[]
}

export function findings(baseline: readonly ShapeRow[], scan: ShapeScan = scanShape()): ShapeFindings {
  const base = new Map(baseline.map((r) => [key(r), r]))
  const now = new Map(scan.rows.map((r) => [key(r), r]))
  const worse = scan.rows.filter((r) => (base.get(key(r))?.value ?? 0) < r.value)
  const stale = baseline.filter((r) => (now.get(key(r))?.value ?? 0) < r.value)
  return { worse, stale }
}

export const isEmpty = (f: ShapeFindings): boolean => f.worse.length === 0 && f.stale.length === 0

/** The audit's six counts beside today's, then the two report-only measures. */
export function formatReport(scan: ShapeScan = scanShape()): string {
  const t = scan.totals
  const rows: [string, number, number][] = [
    ['lessons with no predict block', t.noPredict, AUDIT.noPredict],
    ['first activity is the end quiz', t.quizFirst, AUDIT.quizFirst],
    ['a stretch past 900 words', t.over900, AUDIT.over900],
    ['ungated diagrams', t.ungatedDiagram, AUDIT.ungatedDiagram],
    ['analogy callouts without breaks', t.analogyNoBreaks, AUDIT.analogyNoBreaks],
    ['legacy task blocks', t.legacyTasks, AUDIT.legacyTasks],
  ]
  const lines = ['lesson shape (today / audit 2026-11-18)']
  for (const [label, now, audit] of rows) lines.push(`  ${label.padEnd(34)} ${String(now).padStart(3)} / ${audit}`)
  lines.push(`  titles with current/modern/new/today or a year ${String(t.title).padStart(3)} (reported)`)
  lines.push(`  errata phrases in prose                  ${String(t.errataProse).padStart(3)} (reported)`)
  const long = scan.longOptions.reduce((n, x) => n + x.count, 0)
  lines.push(`  quiz options over ${QUIZ_OPTION_WORDS} words             ${String(long).padStart(3)} in ${scan.longOptions.length} lessons (reported, not gated)`)
  return lines.join('\n')
}

const main = (): number => {
  const args = process.argv.slice(2)
  const mode = args[0] ?? ''
  if (!['', '--check', '--update'].includes(mode) || args.length > 1) {
    console.error('usage: bun scripts/verify-lesson-shape.ts [--check | --update]')
    return 2
  }
  const scan = scanShape()
  if (mode === '--update') {
    const first = !existsSync(BASELINE)
    const f = findings(readBaseline(), scan)
    if (!first && f.worse.length > 0) {
      for (const r of f.worse) console.error(`  worse ${r.lesson} ${r.rule} ${r.value}${r.note ? ` (${r.note})` : ''}`)
      console.error('the baseline may only shrink: fix the violation, or record an exception with a reason')
      return 1
    }
    const next = [...scan.rows].sort((a, b) => key(a).localeCompare(key(b)))
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`wrote ${next.length} rows (${f.stale.length} fixed removed)`)
    return 0
  }
  console.log(formatReport(scan))
  const f = findings(readBaseline(), scan)
  if (isEmpty(f)) {
    console.log(`lesson shape: ok, ${scan.rows.length} baselined violations`)
    return 0
  }
  for (const r of f.worse) console.error(`  worse ${r.lesson} ${r.rule} ${r.value}${r.note ? ` (${r.note})` : ''}`)
  for (const r of f.stale) console.error(`  fixed ${r.lesson} ${r.rule} ${r.value}; remove its baseline line`)
  console.error('lesson shape: a new or worse violation fails; a fixed one fails until its line is removed')
  return 1
}

if (import.meta.main) process.exit(main())
