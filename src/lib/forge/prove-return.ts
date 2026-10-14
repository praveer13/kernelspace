/**
 * The 30-day return (docs/specs/wave-3.md §7.5): one question per lab, 30 local days after the lab's first `prove`
 * event, v1 or v2. Pure: events and bundles in, a plan or a ledger payload out. The card is
 * src/components/learner/ProveReturnCard.tsx; the timing (`returnDue`) and the v2 attempt (`proveFromModule`) are
 * prove2.ts's.
 *
 * Which question:
 * - the lab's installed component is on this device (its bytes) and the bundle has `prove2`: a v2 question on a fresh
 *   seed, run against the installed bytes. Installing needs a fresh-seed green of every required check
 *   (`checkInstall`, engine/store.ts), so the installed module is one an `unseen` run graded; the card hands that run
 *   to `proveFromModule` as the graded one;
 * - otherwise v1's follow-up item (`item:lab0N.prove.<qid>`, the lab's `followUpRef`), a constructed response the
 *   learner checks themselves, recorded as an ordinary `item` event with `data.return`.
 *
 * A return is a recall check on a lab already proved, so it is never a credited attempt (prove2.ts, `attemptsOf`):
 * a miss starts no 24 h wait. Once a lab has a return event of either kind, it does not come again.
 */

import type { ForgeBundle, ProveQuestion, ProveV2Template } from '@/data/forge/types'
import { FORGE_LABS } from '@/data/labs'
import { CR_PASS_IDEAS } from '@/lib/items/play'
import { rev32 } from '@/lib/ledger/stable'
import type { ItemResponse, LocalDay, ProveResult } from '@/lib/ledger/types'
import { daysBetween } from '@/lib/learner/reentry'
import { formatWait } from './prove'
import { attemptsOf, firstProve, pickTemplate, planQuestion, returnDay, returnDue } from './prove2'
import type { Prove2Attempt, Prove2Plan, ProveAttemptResult, ProveEventLike, RunCalls } from './prove2'

/** One lab whose return question is due. */
export interface ReturnDue {
  labId: string
  /** The lab's first prove event (v1 or v2). */
  firstAt: string
  firstDay: LocalDay
  /** The local day the question came due: 30 local days after `firstDay`. */
  dueDay: LocalDay
  /** Whole local days past the due day (0 on the day itself). */
  overdueDays: number
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** `lab02` for the lab whose index is 2: the number in a follow-up item's ref (`item:lab02.prove.<qid>`). Undefined for an unknown lab. */
export function labRefNo(labId: string): string | undefined {
  const lab = FORGE_LABS.find((l) => l.id === labId)
  // Rust Zero labs (r1 to r10) have their own index space and no Prove-it, so only the systems labs carry a `labNN` ref.
  if (lab === undefined || lab.id.startsWith('rust-zero')) return undefined
  return `lab${String(lab.index).padStart(2, '0')}`
}

/** The Today follow-up ref for a v1 question of `labId`: what the lab's own `followUpRef(qid)` gives (tested). */
export function followUpRefFor(labId: string, qid: string): `item:${string}` | undefined {
  const no = labRefNo(labId)
  return no === undefined ? undefined : `item:${no}.prove.${qid}`
}

/** The lab a prove event or follow-up item belongs to, or undefined. */
function labOfProve(e: ProveEventLike): string | undefined {
  return e.kind === 'prove' && e.ref.startsWith('prove:') ? e.ref.slice('prove:'.length) : undefined
}

/** Whether `e` is a return that was answered: a prove event with `data.return`, or a follow-up item of the lab with `data.return`. */
function isReturnOf(e: ProveEventLike, labId: string): boolean {
  if (!isObject(e.data) || e.data.return !== true) return false
  if (e.kind === 'prove') return e.ref === `prove:${labId}`
  const no = labRefNo(labId)
  return e.kind === 'item' && no !== undefined && e.ref.startsWith(`item:${no}.prove.`)
}

/** Whether the lab's return has been answered (either kind). */
export const returnAnswered = (events: readonly ProveEventLike[], labId: string): boolean => events.some((e) => isReturnOf(e, labId))

/**
 * The labs whose return question is due on `today` and not yet answered, most overdue first (ties by lab id). Only the
 * labs in `labIds` (the labs with a Forge bundle, by default every systems lab) count, and a lab's first prove event is
 * never a return itself.
 */
export function dueReturns(events: readonly ProveEventLike[], today: LocalDay, labIds?: readonly string[]): ReturnDue[] {
  const known = new Set(labIds ?? FORGE_LABS.filter((l) => labRefNo(l.id) !== undefined).map((l) => l.id))
  const labs = new Set<string>()
  for (const e of events) {
    const id = labOfProve(e)
    if (id !== undefined && known.has(id)) labs.add(id)
  }
  const out: ReturnDue[] = []
  for (const labId of labs) {
    const first = firstProve(events, labId)
    if (first === null || !returnDue(first.day, today) || returnAnswered(events, labId)) continue
    const dueDay = returnDay(first.day)
    out.push({ labId, firstAt: first.at, firstDay: first.day, dueDay, overdueDays: Math.max(0, daysBetween(dueDay, today)) })
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays || (a.labId < b.labId ? -1 : a.labId > b.labId ? 1 : 0))
}

/* ------------------------------------------------------------------ */
/* The question                                                         */
/* ------------------------------------------------------------------ */

/** The installed component of a lab, as the card finds it: its hash and bytes (null when only the hash is known). */
export interface InstalledModule {
  sha256: string
  bytes: ArrayBuffer | null
}

export type ReturnPlan =
  | {
      kind: 'v2'
      labId: string
      template: ProveV2Template
      plan: Prove2Plan
      /** The installed module the calls run on. */
      installed: { sha256: string; bytes: ArrayBuffer }
      /** The lab's v2 attempts so far (for the rotation and the retry window). */
      history: Prove2Attempt[]
    }
  | { kind: 'v1'; labId: string; question: ProveQuestion; ref: `item:${string}` }

/**
 * The v1 question to bring back. The first v1 prove event's questions are the candidates, only the "not yet" ones when there
 * are any (the one most worth seeing again), and `seed` chooses among them. A lab whose first prove event was v2 has no v1
 * questions served, so the draw is over the whole pool. Undefined when the bundle has no question with a follow-up ref.
 */
export function pickFollowUp(events: readonly ProveEventLike[], labId: string, pool: readonly ProveQuestion[], seed: number): ProveQuestion | undefined {
  const byId = new Map(pool.map((q) => [q.id, q]))
  const v1 = events
    .filter((e) => e.kind === 'prove' && e.ref === `prove:${labId}` && isObject(e.data) && e.data.v !== 2 && Array.isArray(e.data.qids))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  let ranked: ProveQuestion[] = []
  const first = v1[0]?.data as { qids?: unknown; self?: unknown } | undefined
  if (first !== undefined && Array.isArray(first.qids)) {
    const self = Array.isArray(first.self) ? first.self : []
    const served = first.qids
      .map((id, i) => ({ q: typeof id === 'string' ? byId.get(id) : undefined, got: self[i] === 1 }))
      .filter((s): s is { q: ProveQuestion; got: boolean } => s.q !== undefined)
    const missed = served.filter((s) => !s.got)
    ranked = (missed.length > 0 ? missed : served).map((s) => s.q)
  }
  const from = ranked.length > 0 ? ranked : [...pool]
  return from.length === 0 ? undefined : from[(seed >>> 0) % from.length]
}

/**
 * The question for a due lab. A v2 question when the bundle has templates and the installed bytes are here, otherwise
 * v1's follow-up; undefined when neither can be asked (the card then shows nothing, and the return waits).
 */
export function planReturn(i: {
  labId: string
  prove2: readonly ProveV2Template[] | undefined
  prove: readonly ProveQuestion[]
  installed: InstalledModule | null
  events: readonly ProveEventLike[]
  seed: number
}): ReturnPlan | undefined {
  if (i.prove2 !== undefined && i.prove2.length > 0 && i.installed !== null && i.installed.bytes !== null) {
    const history = attemptsOf(i.events, i.labId)
    const template = pickTemplate(i.prove2, history)
    return { kind: 'v2', labId: i.labId, template, plan: planQuestion(template, i.seed), installed: { sha256: i.installed.sha256, bytes: i.installed.bytes }, history }
  }
  const question = pickFollowUp(i.events, i.labId, i.prove, i.seed)
  const ref = question === undefined ? undefined : followUpRefFor(i.labId, question.id)
  return question === undefined || ref === undefined ? undefined : { kind: 'v1', labId: i.labId, question, ref }
}

/* ------------------------------------------------------------------ */
/* Recording the v1 follow-up                                           */
/* ------------------------------------------------------------------ */

/** Nominal seconds of a constructed response (items/play.ts, NSEC_CR). */
const NSEC_CR = 90

/**
 * The ledger write for a self-checked follow-up: an `item` event on the lab's follow-up ref, practice weight (the
 * learner grades it), `data.return`. Like every constructed response, the text stays on the device and only the
 * ticked ideas are recorded; two of the three is a pass.
 */
export function followUpResponse(i: { ref: `item:${string}`; question: ProveQuestion; ideas: readonly [boolean, boolean, boolean]; ms?: number }): ItemResponse {
  const ticked = i.ideas.flatMap((on, k) => (on ? [k] : []))
  const ok = ticked.length >= CR_PASS_IDEAS
  return {
    kind: 'item',
    ref: i.ref,
    rev: rev32({ prompt: i.question.prompt, model: i.question.model, ideas: i.question.ideas }),
    score: ok ? 1 : 0,
    ok,
    provenance: 'practice',
    ...(i.ms === undefined || !Number.isFinite(i.ms) ? {} : { ms: Math.max(0, Math.round(i.ms)) }),
    data: { src: 'today', ideas: ticked, kcs: [...i.question.kcs].slice(0, 6), nsec: NSEC_CR, return: true },
  }
}

/* ------------------------------------------------------------------ */
/* Showing a v2 attempt                                                 */
/* ------------------------------------------------------------------ */

/** An answer or a module's reply as the page prints it: a number, ids in order, or `none` for an empty list. */
export const formatValue = (v: number | number[] | null): string => (v === null ? 'nothing' : typeof v === 'number' ? String(v) : v.length === 0 ? 'none' : v.join(', '))

/** `Tue 14:05`, in the learner's own zone. */
const clockLabel = (at: number): string => new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/** When the next credited attempt opens, as the page says it: "opens in 23 h 10 min (Wed 09:41)". */
export const opensLine = (opensAt: number, now: number): string => `opens in ${formatWait(opensAt - now)} (${clockLabel(opensAt)})`

type GradedAttempt = Extract<ProveAttemptResult, { kind: 'graded' }>

export interface Verdict {
  tone: 'right' | 'miss' | 'failed'
  /** One sentence: what happened, with your prediction beside what your module actually replied. */
  headline: string
  /** What it was recorded as, and what happens next. */
  lines: string[]
}

/**
 * The verdict for a graded attempt (§7.4). A miss shows your module's actual reply beside your prediction and, when the
 * attempt was credited, when the next credited attempt opens; an attempt that could not be credited says why it is
 * practice. `ret` marks the 30-day return, which is recall, not an attempt: it starts no wait.
 */
export function verdictFor(out: GradedAttempt, answer: number | number[], opts: { now: number; ret?: boolean }): Verdict {
  const { grade, eligibility: elig, result } = out
  const lines: string[] = []
  const tone: Verdict['tone'] = grade.failed !== null ? 'failed' : grade.right ? 'right' : 'miss'
  const headline =
    grade.failed !== null
      ? `Your module did not answer the calls: ${(grade.message ?? grade.failed).trim().replace(/[.\s]+$/, '')}.`
      : grade.right
        ? `Right: your module replied ${formatValue(grade.actual)}.`
        : `Not quite: you said ${formatValue(answer)}, and your module replied ${formatValue(grade.actual)}.`
  if (result.provenance === 'proved') {
    lines.push('Saved as proved: you predicted your own module on a fresh question, and it replied that. This credits the checks the question covers in full.')
  } else if (!elig.credited) {
    lines.push(
      elig.reason === 'credit'
        ? 'Saved as practice: the run behind this module was not graded on fresh seeds.'
        : elig.reason === 'module'
          ? 'Saved as practice: this is not the module ForgeLab just graded.'
          : 'Saved as practice: a credited attempt is still waiting out its 24 h.',
    )
  } else if (grade.right) {
    lines.push('Saved as practice: the module could not be fingerprinted, so it cannot be named as the one that was graded.')
  } else {
    lines.push('Saved as a credited miss.')
  }
  if (grade.failed === null && !grade.right) lines.push('Open the code that handles these calls and follow what it does with them, then try a fresh question.')
  if (opts.ret) {
    if (!grade.right) lines.push('A 30-day check is recall, not an attempt: it starts no wait.')
  } else if (out.opensAt !== null) {
    lines.push(`The next credited attempt ${opensLine(out.opensAt, opts.now)}. Until then you can keep practising; those attempts say so.`)
  }
  return { tone, headline, lines }
}

/* ------------------------------------------------------------------ */
/* What the panel and the card take from the page                       */
/* ------------------------------------------------------------------ */

/**
 * The page's side of one v2 attempt. Every part is optional on the components (the defaults are the lab worker, the
 * ledger façade, the clock and `sha256Hex`), so tests drive them with fake modules and a memory ledger.
 */
export interface ProveEnv {
  /** `runLabCalls`: the module's replies in the lab worker. */
  run: RunCalls
  /** `recordProve`. */
  record(result: ProveResult): void
  /** Epoch ms. */
  now(): number
  hash?(bytes: ArrayBuffer): Promise<string>
}

/** What ForgeLab's panel adds: where the next question's seed comes from, and the lab's earlier v2 attempts. */
export interface PanelEnv extends ProveEnv {
  seed(): number
  history(labId: string): Promise<Prove2Attempt[]>
}

/** What the Today card adds: the day, the ledger's events, a lab's bundle and its component on this device. */
export interface ReturnEnv extends ProveEnv {
  seed(): number
  today(): LocalDay
  /** Every `prove` event, every follow-up `item` event and every `lab-check` event, of any lab. */
  events(): Promise<ProveEventLike[]>
  bundle(labId: string): Promise<ForgeBundle | undefined>
  installed(labId: string): Promise<InstalledModule | null>
  recordItems(items: ItemResponse[]): void
}
