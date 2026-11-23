import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS, LESSONS_BY_TRACK, TRACK_IDS } from '../../src/data/lessons'

/**
 * Lesson prose never refers to the course's own build: no wave numbers, no build-plan sections, no "lesson 3 of 40",
 * no stale lesson counts, no "last lesson of T0" on a lesson that is not last, no phantom T<n>.L<m> ids.
 * Each rule is a function of (text, lesson context) with a fixture that must fire, so a rule that stops matching fails.
 * Only lesson data is scanned (LESSONS_BY_TRACK), not src/data/lessons/types.ts comments, pages or components.
 * A true statement is handled by narrowing the rule (the track or the path is computed from the registry), never by an
 * allow-list keyed by lesson id.
 */

interface Ctx {
  /** canonical id of the lesson being scanned, or a fixture's stand-in */
  id: string
  /** the lesson ids of each track, in registry order */
  tracks: Record<string, string[]>
  /** every real lesson id */
  known: Set<string>
  /** the last lesson of the whole path, in registry order */
  pathLast: string
  /** lesson counts a text may state: the whole registry and each track */
  counts: Set<number>
}

interface Rule {
  name: string
  check: (text: string, ctx: Ctx) => string[]
}

function matches(text: string, re: RegExp): string[] {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))].map((m) => m[0])
}

const trackLast = (ctx: Ctx, n: string): string | undefined => ctx.tracks[`t${n}`]?.at(-1)

export const RULES: Rule[] = [
  { name: 'wave number', check: (t) => matches(t, /\bWave \d/) },
  { name: 'lesson N of M', check: (t) => matches(t, /\blesson \d+ of \d+\b/i) },
  {
    name: 'stale lesson count',
    check: (t, ctx) =>
      [...t.matchAll(/\b(\d+) lessons\b/g)].filter((m) => !ctx.counts.has(Number(m[1]))).map((m) => m[0]),
  },
  {
    // A lesson that says "This is the last lesson of T<n>" claims a position; a pointer ("The final lesson of T5 puts it
    // all together") names another lesson and is true wherever it stands, so only the self-claim is checked.
    name: 'claims to be the last lesson of a track without being it',
    check: (t, ctx) =>
      [...t.matchAll(/\bthis is the (?:last|final) lesson of T(\d)\b/gi)]
        .filter((m) => trackLast(ctx, m[1]) !== ctx.id)
        .map((m) => m[0]),
  },
  {
    name: 'track complete on a lesson that does not end the track',
    check: (t, ctx) =>
      [...t.matchAll(/\bT(\d) is complete\b/g)].filter((m) => trackLast(ctx, m[1]) !== ctx.id).map((m) => m[0]),
  },
  {
    name: 'the stack is complete on a lesson that does not end the path',
    check: (t, ctx) => (ctx.id === ctx.pathLast ? [] : matches(t, /\bthe stack is complete\b/i)),
  },
  {
    name: 'lesson id that does not exist',
    check: (t, ctx) =>
      [...t.matchAll(/\b(T[0-7]|R)\.L(\d+)\b/g)].filter((m) => !ctx.known.has(m[0].toLowerCase())).map((m) => m[0]),
  },
  {
    name: 'build plan reference',
    check: (t) => [
      // "the plan" in a database sense (EXPLAIN, a query or execution plan) is innocent; anywhere else it is the build plan
      ...(/\bEXPLAIN\b|\b(?:query|execution) plan\b/.test(t) ? [] : matches(t, /\bthe plan\b/i)),
      ...matches(t, /\bbuild plan\b/i),
      ...matches(t, /§\s?\d+(?:\.\d+)? of the plan\b/),
      ...matches(t, /\bPLAN(?:-[A-Z0-9]+)?\.md\b/),
    ],
  },
  { name: "topic table names T2.L6's zero-copy", check: (t) => matches(t, /\bT2\.L6's zero-copy\b/) },
]

export function violations(text: string, ctx: Ctx): string[] {
  return RULES.flatMap((r) => r.check(text, ctx).map((h) => `${r.name}: "${h}"`))
}

function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value
  else if (Array.isArray(value)) for (const v of value) yield* strings(v)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* strings(v)
}

const tracks: Record<string, string[]> = Object.fromEntries(
  TRACK_IDS.map((id) => [id, LESSONS_BY_TRACK[id].map((l) => l.id)]),
)
const baseCtx: Omit<Ctx, 'id'> = {
  tracks,
  known: new Set(ALL_LESSONS.map((l) => l.id)),
  pathLast: ALL_LESSONS.at(-1)!.id,
  counts: new Set([ALL_LESSONS.length, ...TRACK_IDS.map((id) => LESSONS_BY_TRACK[id].length)]),
}

describe('lesson text signposts', () => {
  test('every rule fires on its fixture', () => {
    const ctx: Ctx = { ...baseCtx, id: 't1.l1' }
    const fixtures: Record<string, string> = {
      'wave number': 'This lands in Wave 6.',
      'lesson N of M': 'You are on lesson 3 of 40.',
      'stale lesson count': 'all 4000 lessons',
      'claims to be the last lesson of a track without being it': 'This is the last lesson of T0, and it is quiet.',
      'track complete on a lesson that does not end the track': 'T5 is complete here',
      'the stack is complete on a lesson that does not end the path': 'The stack is complete.',
      'lesson id that does not exist': 'see T9.L1 and R.L99',
      'build plan reference': 'the capstone in (§6 of the plan)',
      "topic table names T2.L6's zero-copy": "T2.L6's zero-copy",
    }
    for (const r of RULES) expect(r.check(fixtures[r.name]!, ctx).length).toBeGreaterThan(0)
    expect(Object.keys(fixtures).length).toBe(RULES.length)
    expect(RULES[RULES.findIndex((r) => r.name === 'build plan reference')]!.check("the plan's capstone", ctx).length).toBeGreaterThan(0)
  })

  test('true and innocent wording passes', () => {
    const lastT5 = baseCtx.tracks.t5!.at(-1)!
    const ok: [string, string][] = [
      ['This is the final lesson of T5', lastT5],
      ['The final lesson of T5 puts it all together', 't5.l9'],
      ['T5 is complete', lastT5],
      ['The stack is complete', baseCtx.pathLast],
      ['lesson 3 of this track', 't1.l3'],
      ['EXPLAIN ANALYZE: the plan tells you which node ate the time; the planner picks', 't0.l1'],
      ['Read §§4–6 and §3.2 of the paper', 't2.l7'],
      ['see T1.L3 and R.L4', 't1.l1'],
    ]
    for (const [text, id] of ok) expect(violations(text, { ...baseCtx, id })).toEqual([])
  })

  test('no lesson says anything stale about the course itself', () => {
    const bad: string[] = []
    for (const lesson of ALL_LESSONS) {
      const ctx: Ctx = { ...baseCtx, id: lesson.id }
      for (const text of strings(lesson)) for (const v of violations(text, ctx)) bad.push(`${lesson.id}: ${v}`)
    }
    expect(bad).toEqual([])
  })
})
