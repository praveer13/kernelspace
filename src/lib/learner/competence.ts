/**
 * Competence statements for /me (wave-3.md §12.4). A KC's `can` line ("You can …", kc/types.ts) is shown once the
 * learner has shown it on fresh evidence:
 *
 * - at least 6 credited fresh items on the KC, over at least 2 local days, with at least 5 of the last 6 right;
 * - **credited** is weight 1.0 (provenance.ts): `unseen` or `proved`, so authored items, lab greens and assisted
 *   answers never count;
 * - a **form item** (src `form`, §12.6) counts for nothing here (D34): forms are measurement (W18), and a 'can' line
 *   that a form moved would be the measuring moving what /me shows. VRK30 and the scheduler skip them the same way;
 * - **fresh** is a generated item (`gen:` ref, `item` or `probe`) on a seed the learner had not met, or a `proved`
 *   prove event. A generated instance met again (the same ref, level and seed; a merge can bring a second copy
 *   that its own device also stamped `unseen`) counts the first time only.
 *
 * The copy is informational, never a badge (informational competence signals, d = +0.33; learning-science.md):
 * "You can size KV for an MLA model: 6 of your last 6, on new numbers each time." Pure: `now` is a parameter.
 */

import type { KcId } from '@/lib/kc/types'
import type { LedgerEvent, LocalDay } from '@/lib/ledger/types'
import { isFormItem, type CardsContent } from './cards'
import { isCredited } from './provenance'
import { asOf } from './vrk'

/** Credited fresh items a KC needs. */
export const COMPETENCE_MIN_ITEMS = 6
/** Local days they must span. */
export const COMPETENCE_MIN_DAYS = 2
/** The window the right answers are counted in, and how many of it must be right. */
export const COMPETENCE_WINDOW = 6
export const COMPETENCE_MIN_RIGHT = 5

/** What a KC has shown so far, met or not. */
export interface CompetenceEvidence {
  kc: KcId
  /** Credited fresh items. */
  n: number
  /** Distinct local days they fell on. */
  days: number
  /** Right answers among the last `COMPETENCE_WINDOW` (or fewer, while n is below it). */
  right: number
  /** The size of that window: min(n, COMPETENCE_WINDOW). */
  of: number
  /** The day of the latest item. */
  last: LocalDay
  /** All three rules hold. */
  met: boolean
}

/** A shown statement: the KC's `can` line and the evidence that earned it. */
export interface CompetenceStatement extends CompetenceEvidence {
  can: string
  /** The line /me shows, e.g. "You can size KV for an MLA model: 6 of your last 6, on new numbers each time." */
  text: string
}

const dataOf = (e: LedgerEvent): Record<string, unknown> => {
  const d = (e as { data?: unknown }).data
  return typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : {}
}

/** The identity of a served generated instance (today.ts `instanceKey`, kept inline so /me loads no Today code). */
const instanceOf = (e: LedgerEvent): string | null => {
  const seed = (e as { seed?: unknown }).seed
  return typeof seed === 'number' ? `${e.ref}@${(dataOf(e).level as number | undefined) ?? '-'}:${seed}` : null
}

/** Whether a rule set holds for the evidence counts. */
const meets = (n: number, days: number, right: number): boolean =>
  n >= COMPETENCE_MIN_ITEMS && days >= COMPETENCE_MIN_DAYS && right >= COMPETENCE_MIN_RIGHT

/** Every KC's credited fresh evidence as of `now`, sorted by KC id. */
export function competenceEvidence(
  events: Iterable<LedgerEvent>,
  content: Pick<CardsContent, 'resolve'>,
  now: LocalDay,
): CompetenceEvidence[] {
  const seen = new Set<string>()
  const byKc = new Map<KcId, { oks: boolean[]; days: Set<LocalDay> }>()
  for (const e of asOf(events, now)) {
    if (isFormItem(e)) continue
    let fresh = false
    if ((e.kind === 'item' || e.kind === 'probe') && e.ref.startsWith('gen:')) {
      const key = instanceOf(e)
      fresh = key === null || !seen.has(key)
      if (key !== null) seen.add(key)
    } else if (e.kind === 'prove') {
      fresh = (e as { provenance?: string }).provenance === 'proved'
    }
    if (!fresh || !isCredited(e)) continue
    const ok = (e as { ok?: boolean }).ok === true
    for (const kc of new Set(content.resolve(e))) {
      const rec = byKc.get(kc) ?? { oks: [], days: new Set<LocalDay>() }
      rec.oks.push(ok)
      rec.days.add(e.day)
      byKc.set(kc, rec)
    }
  }
  return [...byKc.keys()].sort().map((kc) => {
    const { oks, days } = byKc.get(kc) as { oks: boolean[]; days: Set<LocalDay> }
    const window = oks.slice(-COMPETENCE_WINDOW)
    const right = window.filter(Boolean).length
    return { kc, n: oks.length, days: days.size, right, of: window.length, last: [...days].sort().at(-1) as LocalDay, met: meets(oks.length, days.size, right) }
  })
}

/** "You can … ." → "You can …: 6 of your last 6, on new numbers each time." */
export const statementText = (can: string, right: number, of: number): string =>
  `${can.trim().replace(/[.!]+$/, '')}: ${right} of your last ${of}, on new numbers each time.`

/** The competence statements as of `now`, in the KC graph's order (§12.4). A KC the graph does not hold has no line. */
export function selectCompetence(
  events: Iterable<LedgerEvent>,
  content: Pick<CardsContent, 'kcs' | 'resolve'>,
  now: LocalDay,
): CompetenceStatement[] {
  const met = new Map(competenceEvidence(events, content, now).filter((x) => x.met).map((x) => [x.kc, x]))
  const out: CompetenceStatement[] = []
  for (const k of content.kcs) {
    const x = met.get(k.id)
    if (x && k.can) out.push({ ...x, can: k.can, text: statementText(k.can, x.right, x.of) })
  }
  return out
}
