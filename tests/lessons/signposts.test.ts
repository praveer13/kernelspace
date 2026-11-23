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
  /** the whole registry's lesson count; a track's own count is valid only beside its track's name */
  total: number
}

interface Rule {
  name: string
  check: (text: string, ctx: Ctx) => string[]
}

function matches(text: string, re: RegExp): string[] {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))].map((m) => m[0])
}

const trackLast = (ctx: Ctx, n: string): string | undefined => ctx.tracks[`t${n}`]?.at(-1)

/** the characters on each side of a match that may carry the words which excuse it */
const NEAR = 80
const near = (t: string, m: RegExpMatchArray, chars = NEAR): string =>
  t.slice(Math.max(0, m.index! - chars), m.index! + m[0].length + chars)

// "the plan" in a database sense (EXPLAIN, a query or execution plan) is innocent; a prose block is one string, so
// only words near the phrase excuse it, never an EXPLAIN elsewhere in the block
const DB_PLAN = /\bEXPLAIN\b|\b(?:[Qq]uery|[Ee]xecution) plan\b/

export const RULES: Rule[] = [
  { name: 'wave number', check: (t) => matches(t, /\bwave \d/i) },
  { name: 'lesson N of M', check: (t) => matches(t, /\blesson \d+ of \d+\b/i) },
  {
    name: 'stale lesson count',
    check: (t, ctx) =>
      [...t.matchAll(/\b(\d+) lessons\b/g)]
        .filter((m) => {
          const n = Number(m[1])
          if (n === ctx.total) return false
          // "T5's 10 lessons" or "the 10 lessons of T5": a track's size, true only beside that track's name
          return ![...near(t, m, 12).matchAll(/\b(T[0-7]|R)\b/g)].some((k) => ctx.tracks[k[1]!.toLowerCase()]?.length === n)
        })
        .map((m) => m[0]),
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
      ...[...t.matchAll(/\bthe plan\b(?!['’]s\b)/gi)].filter((m) => !DB_PLAN.test(near(t, m))).map((m) => m[0]),
      // a database plan has no capstone: "the plan's" is the build plan wherever it stands
      ...matches(t, /\bthe plan['’]s\b/i),
      ...matches(t, /\bbuild plan\b/i),
      ...matches(t, /§\s?\d+(?:\.\d+)? of the plan\b/),
      ...matches(t, /\bPLAN(?:-[A-Z0-9]+)?\.md\b/),
    ],
  },
  { name: "topic table names T2.L6's zero-copy", check: (t) => matches(t, /\bT2\.L6['’]s zero-copy\b/) },
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
  total: ALL_LESSONS.length,
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
  })

  test('each build-plan pattern fires on a fixture of its own, by the text it matched', () => {
    const ctx: Ctx = { ...baseCtx, id: 't1.l1' }
    const plan = RULES.find((r) => r.name === 'build plan reference')!
    // [fixture, a hit that only this pattern produces]; EXPLAIN beside a phrase silences the bare "the plan" pattern,
    // so a fixture that carries it shows the other pattern still fires on its own
    const own: [string, string][] = [
      ['as the plan says', 'the plan'],
      ["EXPLAIN ANALYZE shows it. Fleet Week (the plan's capstone 2.0) follows.", "the plan's"],
      ['EXPLAIN ANALYZE shows it. Fleet Week (the plan’s capstone) follows.', 'the plan’s'],
      ['EXPLAIN ANALYZE shows it, and the build plan has it next', 'build plan'],
      ['EXPLAIN ANALYZE shows it (§6 of the plan)', '§6 of the plan'],
      ['EXPLAIN ANALYZE shows it, per PLAN-W0.md', 'PLAN-W0.md'],
    ]
    for (const [text, hit] of own) expect(plan.check(text, ctx)).toEqual([hit])
    // EXPLAIN far from the phrase does not excuse it
    const far = `EXPLAIN ANALYZE shows it. ${'x'.repeat(100)} Then, as the plan says, Fleet Week.`
    expect(plan.check(far, ctx)).toEqual(['the plan'])
  })

  test('each signpost rule reads case and curly apostrophes, and a track size only beside its track', () => {
    const ctx: Ctx = { ...baseCtx, id: 't1.l1' }
    const fire = (name: string, text: string) => RULES.find((r) => r.name === name)!.check(text, ctx)
    expect(fire('wave number', 'this lands in wave 6')).toEqual(['wave 6'])
    expect(fire("topic table names T2.L6's zero-copy", 'T2.L6’s zero-copy')).toEqual(['T2.L6’s zero-copy'])
    const t5 = baseCtx.tracks.t5!.length
    expect(fire('stale lesson count', `the course's ${t5} lessons`)).toEqual([`${t5} lessons`])
    expect(fire('stale lesson count', `T5's ${t5} lessons`)).toEqual([])
    expect(fire('stale lesson count', `all ${ALL_LESSONS.length} lessons`)).toEqual([])
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
