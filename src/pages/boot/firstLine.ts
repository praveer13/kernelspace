/**
 * The line under Boot's path choice (wave-2.md §7.3): where the chosen path begins, placement applied. The path
 * blurbs describe each path before any placement; this line is what the learner's own plan does, so it names the
 * first lesson, the Rust lessons before it, or when Rust starts on the braided full ramp ("full course" never reads
 * as "no Rust"), and says so when a placement leaves the path with nothing to teach.
 */

export interface NamedLesson {
  code: string
  title: string
}

export interface FirstLessonsView {
  /** The plan's first non-R lesson, or null when it has none. */
  t: NamedLesson | null
  /** The R lessons before `t` (all of the plan's lessons when `t` is null). */
  r: NamedLesson[]
  /** The first R lesson after `t` when none runs before it, and how many lessons sit between them. */
  rNext?: (NamedLesson & { gap: number }) | null
}

const name = (l: NamedLesson) => `${l.code} · ${l.title}`
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** What the line reads of a plan, and of the lessons (`paths.ts`'s PathPlan and the lesson list satisfy both). */
interface PlanView {
  lessons: readonly string[]
  skipped: readonly string[]
  testOut: readonly string[]
}

/**
 * Boot's line and whether a placement changed the plan. `first` is firstLessonsNow's result for the same path and
 * placement. The first R lesson after `t` is found here, in Boot's own chunk, so the shared up-next chunk that /today
 * loads does not grow (D32). `skips` is true only when the placement moved something (a skipped lesson or a Rust
 * test-out), so the legend never claims a placement that changed nothing or that readPlacement refused.
 */
export function bootLine(
  first: { t: (NamedLesson & { id: string }) | null; r: NamedLesson[] },
  plan: PlanView,
  lessons: readonly { id: string; title: string; trackId: string }[],
): { line: string; skips: boolean } {
  const byId = new Map(lessons.map((l) => [l.id, l]))
  const after = first.t && first.r.length === 0 ? plan.lessons.slice(plan.lessons.indexOf(first.t.id) + 1) : []
  const gap = after.findIndex((id) => byId.get(id)?.trackId === 'r')
  const rNext = gap < 0 ? null : { code: after[gap].toUpperCase(), title: byId.get(after[gap])?.title ?? after[gap], gap }
  return { line: firstLessonLine({ t: first.t, r: first.r, rNext }), skips: plan.skipped.length > 0 || plan.testOut.length > 0 }
}

export function firstLessonLine({ t, r, rNext }: FirstLessonsView): string {
  if (!t && r.length === 0) return 'Your placement already covers this path, so Today offers practice; another path still has lessons for you.'
  if (!t) return `Your path is ${plural(r.length, 'Rust lesson')}, starting with ${name(r[0])}; your placement covers the rest.`
  if (r.length === 1) return `Your path starts with ${name(r[0])}, then ${name(t)}.`
  if (r.length > 1) return `Your path starts with ${name(r[0])} and reaches ${name(t)} after ${r.length} Rust lessons.`
  if (!rNext) return `Your first lesson is ${name(t)}.`
  if (rNext.gap === 0) return `Your first lesson is ${name(t)}. Rust starts right after it, with ${name(rNext)}.`
  const more = rNext.gap === 1 ? 'After it comes 1 more lesson' : `After it come ${rNext.gap} more lessons`
  return `Your first lesson is ${name(t)}. ${more}, then Rust starts with ${name(rNext)}.`
}
