/**
 * OS ≡ LLM isomorphism panel (lesson.md §2.8; wave-3.md §11.1, P3).
 *
 * A block without a `breakItem` renders as it always has: an OS card ≡ an LLM card, then "where it breaks:".
 * A block with one runs three steps, because active alignment with the principle given after the comparison is
 * where the effect comes from (learning-science.md:139–145) and a passive side-by-side is much weaker:
 *   1. **Align.** One row per OS element; the shuffled LLM labels are toggle buttons in a labelled group per row
 *      (Tab to a row, arrows across its labels, Space or Enter to choose; a tap works too; nothing drags). Check
 *      grades every row at once and shows each row's own two lines. Retry re-shuffles; nothing locks.
 *   2. **Name the break.** The shared item player plays `breakItem` (a choice with a why per option).
 *   3. **The principle**, then every pair with its break, as the passive view draws them.
 * A work row (a pair's `work`, shown only when `profile:background` matches) joins step 1 with its feedback and is
 * never graded or recorded (src/lib/learner/iso.ts). The panel animates nothing but colour, and the page's
 * reduced-motion rule (index.css) removes that.
 */

import { ArrowLeftRight, Check, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { IsomorphismBlock, IsomorphismPair, Lesson } from '@/data/lessons/types'
import {
  alignResponse,
  alignRows,
  backgroundOf,
  breakItem,
  breakResponse,
  gradeAlign,
  isActive,
  isoNumber,
  shuffledLabels,
  workApplies,
  type AlignGrade,
  type IsoRow,
} from '@/lib/learner/iso'
import type { ItemResult } from '@/lib/items/play'
import type { Background } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'
import { cn } from '@/lib/utils'

const ItemCard = lazy(() => import('@/components/items/ItemCard'))

// the cards' colours, written out whole so Tailwind sees them
const OS_CARD = 'border border-[#22D3EE]/30 bg-[#22D3EE]/5'

/* ------------------------------ the pairs (passive, and step 3) ------------------------------ */

function BreakLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 border-l-2 border-line-bright pl-3 text-[13px] leading-snug text-text-3">
      <span className="mr-1.5 font-mono text-[10px] uppercase">where it breaks:</span>
      {children}
    </p>
  )
}

function PairList({ pairs, background = null }: { pairs: readonly IsomorphismPair[]; background?: Background | null }) {
  return (
    <div className="space-y-3">
      {pairs.map((p, i) => (
        <div key={i}>
          <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <div className="min-w-0 break-words rounded-md border border-[#22D3EE]/30 bg-[#22D3EE]/5 p-3.5">
              <div className="font-mono text-body-sm font-medium text-[#22D3EE]">{p.os}</div>
              <div className="mt-1 text-body-sm text-text-2">{p.osLine}</div>
            </div>
            <div className="flex items-center justify-center font-mono text-h4 text-text-3">≡</div>
            <div className="min-w-0 break-words rounded-md border border-[#FB7185]/30 bg-[#FB7185]/5 p-3.5">
              <div className="font-mono text-body-sm font-medium text-[#FB7185]">{p.llm}</div>
              <div className="mt-1 text-body-sm text-text-2">{p.llmLine}</div>
            </div>
          </div>
          {p.breaks && <BreakLine>{p.breaks}</BreakLine>}
          {workApplies(p, background) && p.work && (
            <div data-work-pair className={cn('mt-2 min-w-0 break-words rounded-md p-3.5', OS_CARD)}>
              <div className="font-mono text-label uppercase text-text-3">at work</div>
              <div className="mt-1 font-mono text-body-sm font-medium text-[#22D3EE]">{p.work.os}</div>
              <div className="mt-1 text-body-sm text-text-2">{p.work.osLine}</div>
              <BreakLine>{p.work.breaks}</BreakLine>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Frame({ title, children, active }: { title?: string; children: ReactNode; active?: boolean }) {
  return (
    <div {...(active ? { 'data-block': 'isomorphism' } : {})} className="my-8 rounded-lg border border-line bg-surface-1 p-5">
      <div className="mb-4 flex items-center gap-2 font-mono text-label uppercase text-text-3">
        <ArrowLeftRight size={14} className="text-text-3" />
        {title ?? 'the same idea, twice'}
      </div>
      {children}
    </div>
  )
}

/* ------------------------------ step 1: align ------------------------------ */

const BUTTON =
  'inline-flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-md border px-3.5 py-2 text-center text-body-sm break-words motion-safe:transition-colors motion-safe:duration-150'
const PRIMARY =
  'min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[.97]'
const SECONDARY = 'min-h-11 rounded-md border border-line-bright px-5 font-display text-[15px] text-text-1 hover:bg-surface-2'

interface AlignRowProps {
  row: IsoRow
  labels: readonly string[]
  picked: string | undefined
  /** Set after Check: the row's verdict. */
  verdict: AlignGrade['rows'][number] | undefined
  onPick: (label: string) => void
}

function AlignRow({ row, labels, picked, verdict, onPick }: AlignRowProps) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const checked = verdict !== undefined
  // one Tab stop per row: the chosen label, else the first
  const stop = Math.max(0, picked === undefined ? 0 : labels.indexOf(picked))
  const move = (e: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const n = labels.length
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (from + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (from + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (to < 0) return
    // the lesson page binds ArrowLeft and ArrowRight to the previous and next lesson on window; a label row owns them
    e.preventDefault()
    e.stopPropagation()
    refs.current[to]?.focus()
  }
  return (
    <li data-row={row.id} className={cn('min-w-0 rounded-md p-3.5', OS_CARD)}>
      <div role="group" aria-labelledby={`${id}-os`}>
        <div id={`${id}-os`} className="break-words font-mono text-body-sm font-medium text-[#22D3EE]">
          {row.work && <span className="mr-2 text-label uppercase text-text-3">at work</span>}
          {row.os}
          <span className="sr-only"> pairs with which LLM idea?</span>
        </div>
        {row.work && !checked && <p className="mt-1 break-words text-body-sm text-text-2">{row.osLine}</p>}
        <div className="mt-2.5 flex flex-wrap gap-2">
          {labels.map((label, i) => {
            const on = picked === label
            const keyed = checked && label === row.llm
            const wrongPick = checked && on && label !== row.llm
            return (
              <button
                key={label}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                data-ks-label
                aria-pressed={on}
                disabled={checked}
                tabIndex={i === stop ? 0 : -1}
                onClick={() => onPick(label)}
                onKeyDown={(e) => move(e, i)}
                className={cn(
                  BUTTON,
                  keyed
                    ? 'border-accent/50 bg-accent-dim/70 text-text-1'
                    : wrongPick
                      ? 'border-danger/50 bg-danger/10 text-text-1'
                      : on
                        ? 'border-line-bright bg-surface-3 text-text-1'
                        : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
                  checked && 'cursor-default',
                )}
              >
                {label}
                {keyed && <Check size={14} className="ml-1.5 shrink-0 text-accent" aria-hidden />}
                {wrongPick && <X size={14} className="ml-1.5 shrink-0 text-danger" aria-hidden />}
                {checked && (keyed || wrongPick) && <span className="sr-only">{keyed ? (on ? ', your pick, right' : ', the right label') : ', your pick, not this one'}</span>}
              </button>
            )
          })}
        </div>
      </div>
      {verdict && (
        <div data-verdict={verdict.right ? 'right' : 'wrong'} className="mt-3 space-y-1 border-t border-line pt-3 text-body-sm text-text-2">
          <p className="font-medium text-text-1">
            {verdict.right ? 'Right.' : `Not that one: ${row.os} pairs with ${row.llm}.`}
            {!verdict.graded && <span className="ml-2 font-mono text-label uppercase text-text-3">not scored</span>}
          </p>
          <p className="break-words">
            <span className="font-mono text-[#22D3EE]">{row.os}</span> {row.osLine}
          </p>
          <p className="break-words">
            <span className="font-mono text-[#FB7185]">{row.llm}</span> {row.llmLine}
          </p>
        </div>
      )}
    </li>
  )
}

/* ------------------------------ the active panel ------------------------------ */

type Active = IsomorphismBlock & { breakItem: NonNullable<IsomorphismBlock['breakItem']> }

function ActivePanel({ block, lesson }: { block: Active; lesson: Pick<Lesson, 'id' | 'kcs' | 'blocks'> }) {
  const uid = useId()
  const recordItems = useProgress((s) => s.recordItems)
  const background = backgroundOf(useProgress((s) => s.working['profile:background']))
  const n = isoNumber(lesson, block)
  const rows = useMemo(() => alignRows(block, background), [block, background])
  const [seed, setSeed] = useState(() => freshSeed())
  const labels = useMemo(() => shuffledLabels(block, seed), [block, seed])
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [grade, setGrade] = useState<AlignGrade | null>(null)
  const [hint, setHint] = useState('')
  const [onBreak, setOnBreak] = useState(false)
  const [breakSeed, setBreakSeed] = useState(() => freshSeed())
  const [broke, setBroke] = useState<boolean | null>(null)
  // the principle stays once shown: a retry of the break question does not take it back
  const [revealed, setRevealed] = useState(false)
  const started = useRef(0) // when the rows were shown (set on mount and on a retry)
  const list = useRef<HTMLOListElement>(null)
  const summary = useRef<HTMLParagraphElement>(null)
  const breakHead = useRef<HTMLHeadingElement>(null)
  const checked = grade !== null

  useEffect(() => {
    started.current = Date.now()
  }, [])
  useEffect(() => {
    if (checked) summary.current?.focus()
  }, [checked])
  useEffect(() => {
    if (onBreak) breakHead.current?.focus()
  }, [onBreak])

  const pick = (row: IsoRow, label: string) => {
    setHint('')
    setPicks((p) => ({ ...p, [row.id]: label }))
  }
  const check = () => {
    const g = gradeAlign(rows, picks)
    if (!g.complete) {
      const left = g.rows.filter((v) => v.picked === null).length
      setHint(`Give every row a label first: ${left} ${left === 1 ? 'row has' : 'rows have'} none.`)
      const first = g.rows.find((v) => v.picked === null)
      list.current?.querySelector<HTMLElement>(`[data-row="${first?.id}"] [data-ks-label][tabindex="0"]`)?.focus()
      return
    }
    setHint('')
    setGrade(g)
    recordItems([alignResponse(lesson.id, n, block, lesson.kcs, g, { seed, ms: started.current === 0 ? 0 : Date.now() - started.current })])
  }
  const retry = () => {
    setSeed(freshSeed())
    setPicks({})
    setGrade(null)
    setHint('')
    started.current = Date.now()
  }
  const again = () => {
    retry()
    setOnBreak(false)
    setBroke(null)
    setRevealed(false)
    setBreakSeed(freshSeed())
  }
  const onResult = (r: ItemResult) => {
    recordItems([breakResponse(lesson.id, r)])
    setBroke(r.ok)
    setRevealed(true)
  }
  const retryBreak = () => {
    setBroke(null)
    setBreakSeed(freshSeed())
  }
  const item = useMemo(() => breakItem(lesson.id, n, block, block.breakItem, lesson.kcs), [lesson.id, lesson.kcs, n, block])

  return (
    <Frame title={block.title} active>
      <h4 className="mb-1 font-display text-[15px] font-semibold text-text-1">1 · Match each idea</h4>
      <p className="mb-3 text-body-sm text-text-2">Give each OS idea the LLM idea that does its job. Tab to a row, arrow keys move across its labels, Space chooses.</p>
      <ol ref={list} className="m-0 list-none space-y-3 p-0">
        {rows.map((row, i) => (
          <AlignRow key={row.id} row={row} labels={labels} picked={picks[row.id]} verdict={grade?.rows[i]} onPick={(label) => pick(row, label)} />
        ))}
      </ol>
      {/* before the buttons in the reading order, so after Check focus lands here and the next Tab reaches them */}
      <p ref={summary} tabIndex={-1} role="status" aria-live="polite" data-align-status className="mt-3 text-body-sm font-medium text-text-1 empty:hidden focus:outline-none">
        {grade ? (grade.ok ? `All ${grade.base} matched.` : `${grade.right} of ${grade.base} matched.`) : hint}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!checked && (
          <button type="button" className={PRIMARY} onClick={check}>
            Check
          </button>
        )}
        {checked && !grade.ok && (
          <button type="button" className={SECONDARY} onClick={retry}>
            Try again
          </button>
        )}
        {checked && !onBreak && (
          <button type="button" className={grade.ok ? PRIMARY : SECONDARY} onClick={() => setOnBreak(true)}>
            Now: where does it break?
          </button>
        )}
      </div>

      {onBreak && (
        <section className="mt-6" aria-labelledby={`${uid}-h`}>
          <h4 ref={breakHead} tabIndex={-1} id={`${uid}-h`} className="mb-3 font-display text-[15px] font-semibold text-text-1 focus:outline-none">
            2 · Name the break
          </h4>
          <Suspense fallback={<p className="text-body-sm text-text-3">Loading the question…</p>}>
            <ItemCard
              key={breakSeed}
              item={item}
              seed={breakSeed}
              onResult={onResult}
              onNext={broke === false ? retryBreak : undefined}
              nextLabel="Try again"
              eyebrow={`break · ${block.title ?? 'the same idea, twice'}`}
            />
          </Suspense>
        </section>
      )}

      {revealed && (
        <section data-step="principle" className="mt-6" aria-labelledby={`${uid}-p`}>
          <h4 id={`${uid}-p`} className="mb-2 font-display text-[15px] font-semibold text-text-1">
            3 · The principle
          </h4>
          {block.principle && <p className="mb-4 rounded-md border border-line-bright bg-surface-2 p-3.5 text-body-sm text-text-1">{block.principle}</p>}
          <PairList pairs={block.pairs} background={background} />
          <div className="mt-4">
            <button type="button" className={SECONDARY} onClick={again}>
              Match them again
            </button>
          </div>
        </section>
      )}
    </Frame>
  )
}

/* ------------------------------ the panel ------------------------------ */

/**
 * The lesson's isomorphism block. `lesson` numbers the block and names its KCs for the ledger; without it, or
 * without a `breakItem`, the panel is the passive pair list.
 */
export function IsomorphismView({ block, lesson }: { block: IsomorphismBlock; lesson?: Pick<Lesson, 'id' | 'kcs' | 'blocks'> }) {
  if (lesson && isActive(block)) return <ActivePanel block={block} lesson={lesson} />
  return (
    <Frame title={block.title}>
      <PairList pairs={block.pairs} />
    </Frame>
  )
}
