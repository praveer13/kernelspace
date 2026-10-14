/* eslint-disable react-refresh/only-export-components -- the comparison's rows and the gap item sit beside the component so one test reads both */
/**
 * "Your tokenizer vs Qwen3" (docs/specs/wave-2.md §10.5): your installed bpe-tokenizer counts the eight texts of the
 * token corpus, and the count sits beside Qwen3's, which are claims pinned to the tokenizer revision they were counted
 * at, with the ratio between them. Below it, the gap explanation: a self-checked constructed response with three ideas,
 * recorded as `item item:engine.bpe-gap`.
 *
 * Your module never runs on this thread: the counts come from a fleet-worker session (`openTokenSession`), so a
 * `count` that spins stalls that worker and the page says so. A module that predates lab version 3 is told to rebuild,
 * one whose `count` is still a todo!() is told it is not implemented yet. Without an installed tokenizer the table
 * shows Qwen3's side alone and points at lab 03.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import ConstructedAnswer from '@/components/items/ConstructedAnswer'
import { ClaimValue } from '@/components/ClaimValue'
import { getClaim } from '@/data/claims'
import { TOKEN_CORPUS, type CorpusText } from '@/data/engine/token-corpus'
import { openTokenSession, describeFleetError } from '@/lib/fleet-session'
import { gradeItem, revFor } from '@/lib/items/play'
import type { ConstructedPrompt, PlayableItem } from '@/lib/items/types'
import type { ItemResponse } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import { LabAbiError, LabTrapError } from '@/lib/wasm-lab'
import { REBUILD_MESSAGE } from '@/pages/fleet/drivers'
import { useSlots } from '@/pages/fleet/slots'

/* ------------------------------ the comparison ------------------------------ */

export const QWEN3_VOCAB_CLAIM = 'model.qwen3-tokenizer.vocab-size'
export const qwen3CountClaim = (id: string): string => `model.qwen3-tokenizer.tokens-${id}`

export interface CompareRow {
  id: string
  label: string
  note: string
  chars: number
  bytes: number
  /** Qwen3's count, from its claim. */
  qwen: number
  /** Your count, or null before it is known. */
  yours: number | null
  /** yours / qwen, or null before yours is known. */
  ratio: number | null
}

const utf8 = new TextEncoder()

/** The numeric value of a Qwen3 count claim. */
function qwenCount(text: CorpusText): number {
  const { value } = getClaim(qwen3CountClaim(text.id))
  if (typeof value !== 'number') throw new Error(`claim ${qwen3CountClaim(text.id)} is not numeric`)
  return value
}

/** One row per corpus text. `counts` are your counts in corpus order; fewer than eight leaves the rest unknown. */
export function compareRows(counts: readonly number[] = []): CompareRow[] {
  return TOKEN_CORPUS.map((text, i) => {
    const qwen = qwenCount(text)
    const yours = counts[i] ?? null
    return {
      id: text.id,
      label: text.label,
      note: text.note,
      chars: [...text.text].length,
      bytes: utf8.encode(text.text).length,
      qwen,
      yours,
      ratio: yours === null || qwen === 0 ? null : yours / qwen,
    }
  })
}

/** "2.4x": one decimal below ten, none above. */
export function formatRatio(ratio: number): string {
  return `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}x`
}

/** What a failed count tells the learner. Both stale and unfinished modules get a sentence they can act on. */
export function countProblem(e: unknown): string {
  if (e instanceof LabTrapError) return 'not implemented yet: the count verb reached a todo!() in your tokenizer. Finish encode in lab 03, install it again and come back.'
  if (e instanceof LabAbiError && e.message === REBUILD_MESSAGE) return REBUILD_MESSAGE
  return describeFleetError(e, 'token count').detail
}

/* --------------------------- the gap explanation --------------------------- */

/** The ledger id of the explanation: its event ref is `item:engine.bpe-gap`. */
export const GAP_ITEM_ID = 'engine.bpe-gap'

export const GAP_IDEAS: ConstructedPrompt['ideas'] = [
  'Qwen3 splits the text with a pre-tokenizer regex (words, digits, punctuation) before it merges, and yours does not: your merges run across the whole byte string.',
  'About 151k vocabulary entries against your 48 merges, so common words, code and Chinese characters are one token for Qwen3 and many bytes for you.',
  'The training corpus: its merges were learned from a very large multilingual text and code corpus, yours from a few lines.',
]

export const GAP_ITEM: ConstructedPrompt = {
  prompt: "Your counts and Qwen3's differ on the same eight texts. Explain the gap: what does Qwen3's tokenizer have that yours does not?",
  model:
    "Qwen3 pre-splits text with a regex into words, digits and punctuation, so merges never cross those edges; yours merges across the whole byte string. It also has about 151k vocabulary entries to your 48 merges, and its merges were learned from a huge multilingual corpus rather than a few lines.",
  ideas: GAP_IDEAS,
  kcs: [],
}

const gapPlayable: PlayableItem = { source: 'cr', lessonId: 'engine', index: 0, cr: GAP_ITEM }

/** The ledger response for a graded explanation: the ticked ideas only; the text stays on the device. */
export function gapResponse(ideas: readonly [boolean, boolean, boolean], text = ''): ItemResponse {
  const response = { kind: 'cr' as const, text, ideas: [...ideas] as [boolean, boolean, boolean] }
  const grade = gradeItem(gapPlayable, response)
  return {
    kind: 'item',
    ref: `item:${GAP_ITEM_ID}`,
    rev: revFor(gapPlayable),
    score: grade.score,
    ok: grade.ok,
    data: { src: 'practice', ideas: ideas.flatMap((on, i) => (on ? [i] : [])) },
  }
}

/* ------------------------------- the component ------------------------------- */

/** What counting one module came to; `attempt` tells a retry from the run before it. */
type Outcome = { bytes: ArrayBuffer; attempt: number } & ({ ok: true; counts: number[] } | { ok: false; message: string; timedOut: boolean })

export interface TokenizerCompareProps {
  /** Your counts, already known: skips the worker run (tests and previews). */
  counts?: readonly number[]
  className?: string
}

export default function TokenizerCompare({ counts: given, className }: TokenizerCompareProps) {
  const uid = useId()
  const installed = useSlots((s) => s.installed.tokenizer)
  const bytes = installed?.bytes ?? null
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [attempt, setAttempt] = useState(0)

  // A new module (a new install, or Retry) is counted once, in a fleet worker; a stale result never lands.
  useEffect(() => {
    if (given || !bytes) return
    let live = true
    let close = (): void => {}
    openTokenSession({ mode: 'tokens', slots: { tokenizer: bytes } })
      .then(async (session) => {
        close = () => session.close()
        const counts = await session.count(TOKEN_CORPUS.map((t) => t.text))
        if (live) setOutcome({ bytes, attempt, ok: true, counts })
      })
      .catch((e: unknown) => {
        if (live) setOutcome({ bytes, attempt, ok: false, message: countProblem(e), timedOut: describeFleetError(e).timedOut })
      })
      .finally(() => close())
    return () => {
      live = false
      close()
    }
  }, [bytes, given, attempt])

  // the outcome of this module's current attempt; none yet means the worker is still counting
  const current = outcome && outcome.bytes === bytes && outcome.attempt === attempt ? outcome : null
  const counting = !given && bytes !== null && current === null
  const failed = current && !current.ok ? current : null
  const yours = given ?? (current?.ok ? current.counts : undefined)
  const rows = useMemo(() => compareRows(yours), [yours])
  const have = yours !== undefined

  return (
    <section aria-labelledby={`${uid}-h`} className={className}>
      <h2 id={`${uid}-h`} className="font-display text-h3 text-text-1">
        your tokenizer vs Qwen3
      </h2>
      <p className="mt-2 max-w-2xl text-body-sm text-text-2">
        The same eight texts, counted by your lab 03 tokenizer and by Qwen3&apos;s (counts pinned to its tokenizer revision; tap one for the source).
        {!have && !bytes ? (
          <>
            {' '}
            Install a tokenizer from{' '}
            <Link to="/forge/bpe-tokenizer" className="text-accent underline underline-offset-2">
              lab 03
            </Link>{' '}
            to fill the middle column.
          </>
        ) : null}
      </p>

      <div role="status" className="mt-3 font-mono text-[11px] text-text-3 empty:mt-0">
        {counting ? 'counting the corpus with your tokenizer…' : null}
      </div>
      {failed && (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="text-body-sm text-text-2">{failed.message}</p>
            {failed.timedOut && (
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-3 rounded border border-line bg-surface-1 px-3 py-1.5 font-mono text-[11px] text-text-1 hover:border-accent/50">
                try again
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface-1">
        <table className="w-full min-w-[20rem] border-collapse text-left font-mono text-[12px]">
          <caption className="sr-only">Token counts of the eight corpus texts: yours, Qwen3&apos;s, and the ratio between them</caption>
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-text-3">
              <th scope="col" className="px-3 py-2 font-normal">text</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">chars</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">yours</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Qwen3</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <th scope="row" className="px-3 py-2 font-normal text-text-1" title={r.note}>
                  {r.label}
                </th>
                <td className="px-3 py-2 text-right text-text-3">{r.chars}</td>
                <td className="px-3 py-2 text-right text-text-1" data-yours={r.id}>
                  {r.yours ?? '–'}
                </td>
                <td className="px-3 py-2 text-right text-text-1">
                  <ClaimValue id={qwen3CountClaim(r.id)} format={() => String(r.qwen)} />
                </td>
                <td className="px-3 py-2 text-right text-accent">{r.ratio === null ? '–' : formatRatio(r.ratio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-text-3">
        ratio = your tokens ÷ Qwen3&apos;s · Qwen3&apos;s vocabulary has <ClaimValue id={QWEN3_VOCAB_CLAIM} format={(c) => Number(c.value).toLocaleString('en-US')} /> entries; the lab&apos;s bridge counts with the 48-merge table its probe uses.
      </p>

      {have && <GapExplanation />}
    </section>
  )
}

/** Write, reveal the model answer, tick the ideas you covered, record. Two of three is a pass; the text never leaves the device. */
function GapExplanation() {
  const recordItems = useProgress((s) => s.recordItems)
  const [text, setText] = useState('')
  const [ideas, setIdeas] = useState<[boolean, boolean, boolean]>([false, false, false])
  const [revealed, setRevealed] = useState(false)
  const [recorded, setRecorded] = useState<ItemResponse | null>(null)

  const record = () => {
    if (recorded) return
    const response = gapResponse(ideas, text)
    recordItems([response])
    setRecorded(response)
  }
  const got = ideas.filter(Boolean).length

  return (
    <div className="mt-8 max-w-2xl">
      <h3 className="font-display text-h4 text-text-1">Why the gap?</h3>
      <p className="mt-2 text-body-sm text-text-2">{GAP_ITEM.prompt}</p>
      <div className="mt-3">
        <ConstructedAnswer
          cr={GAP_ITEM}
          text={text}
          ideas={ideas}
          revealed={revealed}
          disabled={recorded !== null}
          onText={setText}
          onReveal={() => setRevealed(true)}
          onIdea={(i, on) => setIdeas((prev) => prev.map((v, j) => (j === i ? on : v)) as [boolean, boolean, boolean])}
        />
      </div>
      {revealed && (
        <div className="mt-3">
          {recorded ? (
            <p role="status" className="font-mono text-[12px] text-text-2">
              {recorded.ok ? `You covered ${got} of 3 ideas.` : `You covered ${got} of 3 ideas. Two make it a pass; the model answer has the rest.`} Recorded.
            </p>
          ) : (
            <button type="button" onClick={record} className="min-h-11 rounded-md bg-accent px-4 font-display text-[14px] font-semibold text-accent-foreground">
              Record my check
            </button>
          )}
        </div>
      )}
    </div>
  )
}
