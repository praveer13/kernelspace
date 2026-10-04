/**
 * Published corrections (PLAN-100X §5.2 S1). One module per erratum:
 * src/data/errata/<YYYY-MM-DD>-<slug>.ts, default-exporting `{ … } satisfies Erratum`,
 * so tsc checks every entry and the Changes page can glob them without an index.
 */
export interface Erratum {
  /** `<YYYY-MM-DD>-<slug>`, identical to the file name without `.ts`. */
  id: string
  /** Day the fix shipped, YYYY-MM-DD. */
  date: string
  /** `error`: the course was wrong. `changed`: the field moved and the course caught up. */
  kind: 'error' | 'changed'
  /** Affected lesson ids, e.g. `['t2.l4']`. */
  lessons: string[]
  /** One line, e.g. "Linux schedules with EEVDF, not CFS". */
  title: string
  /** The claim as it was taught (quoted or tightly paraphrased), at most 240 characters. */
  before: string
  /** The corrected claim, at most 240 characters. */
  after: string
  /** At most 40 words: why it changed and why it matters. */
  why?: string
  /** Id of the earlier erratum this one replaces, when the fix moved again. /freshness lists this entry first and marks the older card superseded. */
  supersedes?: string
  /** Primary source for the corrected claim. */
  source?: { url: string; title: string }
}
