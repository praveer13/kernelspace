/**
 * P1 prequestions (Wave 1, docs/specs/wave-1.md §9.1; task B20): the two guesses that open a T0-T1 lesson.
 *
 * Before reading, the learner answers each one (a choice, or a number with a unit) with optional
 * confidence. There is no verdict yet: the card collapses to "Your guesses are saved; the answers appear
 * as you read." The answer is written to the ledger at once (`pre:<lessonId>#<i>`, src 'pre', with the
 * item's KCs), and shown later:
 *   - when the H2 named by `revealAt` scrolls out of view upward, an inline reveal appears at the end of
 *     that section ("You said X. It is Y, because ..."), and
 *   - a guess still unrevealed when the learner reaches the exit ticket is revealed just above it. The
 *     ticket's root carries `data-block="exit-ticket"` (the checkpoint quiz's `aria-label` is the same
 *     hook until B19 lands it).
 * When every KC of the block is solid (a card with predicted recall >= 0.9, or placement-solid) the card
 * starts collapsed, "You know this. Skip, or answer anyway.", and a skip writes nothing.
 *
 * The shared item player (ItemCard) draws and grades each question; this file owns the sequence, the
 * ledger write and the reveal. The pure parts are in src/lib/learner/prequestions.ts.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { ClaimValue } from '@/components/ClaimValue'
import ItemCard from '@/components/items/ItemCard'
import type { Prequestion } from '@/data/lessons/types'
import {
  PRE_GEN,
  blockKcs,
  eventsOf,
  depsFrom,
  expertFor,
  prequestionItem,
  preResponse,
  revealFor,
  savedGuesses,
  scrolledPast,
  type SavedGuess,
} from '@/lib/learner/prequestions'
import { useProgress } from '@/lib/progress'
import { slugify } from '@/pages/lesson/markdown'

export interface PrequestionsProps {
  lessonId: string
  /** The `predict` block's items, in authored order (refs `pre:<lessonId>#<i>`). */
  items: Prequestion[]
  trackColor: string
}

/** Where the exit ticket is: B19's root, or the checkpoint quiz it replaces. */
const TICKET_SELECTOR = '[data-block="exit-ticket"], section[aria-label="Checkpoint quiz"]'

/** A guess whose answer is showing: `el` is where, or null when it shows inside the card. */
interface Revealed {
  el: HTMLElement | null
}

/** A mount point just before `next`, kept in `made` so one section's guesses share it. */
function mountBefore(next: Element | null, key: string, made: Map<string, HTMLElement>): HTMLElement | null {
  if (!next) return null
  const found = made.get(key)
  if (found) return found
  const el = document.createElement('div')
  el.dataset.preReveal = key
  next.before(el)
  made.set(key, el)
  return el
}

/** The end of the H2 section named `revealAt`: just before the next H2, else just before the ticket. */
function sectionEnd(revealAt: string, made: Map<string, HTMLElement>): HTMLElement | null {
  const h = document.getElementById(slugify(revealAt))
  if (!h) return null
  const h2s = [...(h.closest('article') ?? document).querySelectorAll('h2')]
  const next = h2s[h2s.indexOf(h as HTMLHeadingElement) + 1] ?? document.querySelector(TICKET_SELECTOR)
  return mountBefore(next, `h2:${slugify(revealAt)}`, made)
}

export default function Prequestions({ lessonId, items, trackColor }: PrequestionsProps) {
  const recordItems = useProgress((s) => s.recordItems)
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState<(SavedGuess | null)[]>(() => items.map(() => null))
  const [expert, setExpert] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [forceAsk, setForceAsk] = useState(false)
  /** The item on screen; null once nothing is left to ask. */
  const [current, setCurrent] = useState<number | null>(0)
  const [revealed, setRevealed] = useState<Record<number, Revealed>>({})
  const revealedRef = useRef<Record<number, Revealed>>({})
  const made = useRef(new Map<string, HTMLElement>())

  // What the ledger already holds (a reload keeps the answers) and whether the block can be skipped.
  useEffect(() => {
    let live = true
    const deps = depsFrom(useProgress)
    eventsOf(deps, 'pre', lessonId)
      .then((events) => savedGuesses(events, lessonId, items))
      .catch(() => items.map(() => null))
      .then(async (found) => {
        const fresh = found.every((g) => g === null)
        const skip = fresh && (await expertFor(blockKcs(items), deps))
        if (!live) return
        setSaved(found)
        setExpert(skip)
        const open = found.findIndex((g) => g === null)
        setCurrent(open < 0 ? null : open)
        setReady(true)
      })
    return () => {
      live = false
    }
  }, [lessonId, items])

  // The reveal: a section's guesses when its H2 has scrolled past, every remaining one at the ticket.
  useEffect(() => {
    if (!saved.some(Boolean)) return
    const madeNow = made.current
    let raf = 0
    const check = () => {
      raf = 0
      const ticket = document.querySelector(TICKET_SELECTOR)
      const atTicket = ticket !== null && ticket.getBoundingClientRect().top < window.innerHeight
      const next = { ...revealedRef.current }
      let changed = false
      items.forEach((p, i) => {
        if (!saved[i] || next[i]) return
        const heading = document.getElementById(slugify(p.revealAt))
        if (heading && scrolledPast(heading.getBoundingClientRect())) {
          next[i] = { el: sectionEnd(p.revealAt, madeNow) }
          changed = true
        } else if (atTicket) {
          next[i] = { el: mountBefore(ticket, 'ticket', madeNow) }
          changed = true
        }
      })
      if (!changed) return
      revealedRef.current = next
      setRevealed(next)
    }
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(check)
    }
    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [saved, items])

  // The mount points are ours: take them out of the page with the block.
  useEffect(() => {
    const madeNow = made.current
    return () => {
      for (const el of madeNow.values()) el.remove()
      madeNow.clear()
    }
  }, [])

  const answered = (i: number, g: SavedGuess) => setSaved((s) => s.map((x, j) => (j === i ? g : x)))
  const advance = (from: number) => {
    const open = items.findIndex((_, j) => j > from && saved[j] === null)
    setCurrent(open < 0 ? null : open)
  }

  const showExpert = ready && expert && !skipped && !forceAsk
  const asking = ready && !showExpert && !skipped && current !== null
  const allRevealed = saved.every(Boolean) && items.every((_, i) => revealed[i])
  const item = current === null ? null : items[current]

  return (
    <aside
      className="my-8 rounded-lg border border-line bg-surface-1 px-4 py-4 sm:px-5"
      data-block="predict"
      data-lesson={lessonId}
      aria-label="Before you read"
      aria-busy={!ready}
    >
      <p className="font-mono text-label uppercase" style={{ color: trackColor }}>
        Before you read
      </p>

      {!ready && <p className="mt-2 min-h-11 font-mono text-body-sm text-text-3">loading…</p>}

      {showExpert && (
        <div className="mt-2">
          <p className="text-body-sm text-text-1">You know this. Skip, or answer anyway.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setSkipped(true)}
              className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => setForceAsk(true)}
              className="min-h-11 rounded-md border border-line bg-surface-2 px-5 text-body-sm text-text-1 hover:border-line-bright"
            >
              Answer anyway
            </button>
          </div>
        </div>
      )}

      {ready && skipped && <p className="mt-2 text-body-sm text-text-2">Skipped. Nothing was recorded.</p>}

      {asking && item && current !== null && (
        <div className="mt-3">
          <p className="mb-3 text-body-sm text-text-2">Guess before you read. There is no verdict yet.</p>
          <ItemCard
            key={`pre:${lessonId}#${current}`}
            item={prequestionItem(lessonId, current, item)}
            gen={PRE_GEN}
            deferVerdict
            eyebrow={`guess ${current + 1} of ${items.length}`}
            nextLabel={items.findIndex((_, j) => j > current && saved[j] === null) < 0 ? 'Done' : 'Next guess'}
            onResult={(r) => {
              recordItems([preResponse(lessonId, current, item, r)])
              answered(current, {
                ok: r.ok,
                ...(r.pick ? { pick: r.pick } : {}),
                ...(r.response.kind === 'estimate' ? { value: r.response.value } : {}),
                ...(r.conf ? { conf: r.conf } : {}),
              })
            }}
            onNext={() => advance(current)}
          />
        </div>
      )}

      {ready && !asking && !showExpert && !skipped && saved.some(Boolean) && (
        <p role="status" className="mt-2 text-body-sm text-text-2">
          {allRevealed ? 'Your guesses are answered in the lesson below.' : 'Your guesses are saved; the answers appear as you read.'}
        </p>
      )}

      {items.map((p, i) => {
        const g = saved[i]
        const at = revealed[i]
        if (!g || !at) return null
        const view = <RevealView key={i} p={p} g={g} trackColor={trackColor} />
        return at.el ? createPortal(view, at.el, `reveal-${i}`) : view
      })}
    </aside>
  )
}

/** "You said X. It is Y, because …": one guess, answered, at the end of the section that teaches it. */
function RevealView({ p, g, trackColor }: { p: Prequestion; g: SavedGuess; trackColor: string }) {
  const r = revealFor(p, g)
  return (
    <aside
      aria-label="Your guess, answered"
      data-pre-reveal-card
      className="my-6 rounded-lg border border-line border-l-2 bg-surface-1 px-4 py-3"
      style={{ borderLeftColor: trackColor }}
    >
      <p className="font-mono text-label uppercase" style={{ color: trackColor }}>
        Your guess, answered
      </p>
      <p className="mt-2 text-body-sm text-text-2">{p.q}</p>
      <p className="mt-2 flex items-start gap-2 text-body-sm text-text-1">
        {r.ok ? <Check size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden /> : <X size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
        <span className="min-w-0 break-words">
          <span className="sr-only">{r.ok ? (p.kind === 'numeric' ? 'Close enough. ' : 'Right. ') : 'Not quite. '}</span>
          You said <strong className="font-medium">{r.said}</strong>. It is <strong className="font-medium">{r.truth}</strong>
          {r.off ? ` (you were ${r.off} off)` : ''}.
        </span>
      </p>
      {r.slip.map((w, i) => (
        <p key={`slip-${i}`} className="mt-2 text-body-sm text-text-2">
          <span className="mr-1.5 font-mono text-[10px] uppercase text-danger">your pick</span>
          {w}
        </p>
      ))}
      {r.because.map((w, i) => (
        <p key={`because-${i}`} className="mt-2 text-body-sm text-text-2">
          <span className="mr-1.5 font-mono text-[10px] uppercase text-accent">because</span>
          {w}
        </p>
      ))}
      {p.kind === 'numeric' && p.claims && p.claims.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-text-2">
          <span className="font-mono text-[10px] uppercase text-text-3">sourced</span>
          {p.claims.map((id) => (
            <ClaimValue key={id} id={id} />
          ))}
        </p>
      )}
    </aside>
  )
}
