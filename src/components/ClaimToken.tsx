/**
 * ClaimToken — a `[[c:<id>]]` token in lesson prose (Wave 1 stage 0, task K3-1). The visible text comes from the
 * generated token map, so a lesson chunk carries no claims registry. The source popover fetches the published
 * `claims.json` once per page and portals its panel to the body, so a callout's or exercise's `overflow-hidden` cannot
 * clip it (K0-Z-D12: no claims chunk in the entry's preload map).
 *
 * `[[c:<id>|pin]]` prints the cite (value, release and read date) instead of the value alone.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { claimCite, claimText } from '@/lib/claim-tokens'
import { cn } from '@/lib/utils'

/** What `public/claims.json` holds for one claim (the fields a popover shows). */
interface ClaimJson {
  id: string
  label: string
  value: number | string
  unit?: string
  kind: string
  verifiedAt: string
  ttlDays: number
  boundary?: string
  discrepancy?: string
  source?: { title: string; url: string; quote?: string; row?: string }
  derived?: { formula: string; from: string[] }
}

const KIND_NOTE: Record<string, string> = {
  spec: 'vendor spec',
  price: 'dated price',
  benchmark: 'benchmark',
  status: 'status',
  derived: 'derived',
  synthetic: 'synthetic, no real-world source',
}

const PANEL_WIDTH = 320
const MARGIN = 8

const valueText = (c: ClaimJson): string => {
  const v = typeof c.value === 'number' ? c.value.toLocaleString('en-US') : c.value
  return c.unit ? `${v} ${c.unit}` : String(v)
}

/** The day the claim went stale, or null while it is fresh; computed in the browser so a page ages without a rebuild. */
const staleSince = (c: ClaimJson, now: Date): string | null => {
  const verified = Date.parse(`${c.verifiedAt}T00:00:00Z`)
  if (Number.isNaN(verified)) return null
  const expiry = verified + c.ttlDays * 86_400_000
  return now.getTime() > expiry ? new Date(expiry).toISOString().slice(0, 10) : null
}

/** One fetch of claims.json per page, shared by every token (the file is about 420 KB). */
let claimsPromise: Promise<ClaimJson[]> | null = null
const loadClaims = (): Promise<ClaimJson[]> => {
  claimsPromise ??= fetch(`${import.meta.env.BASE_URL}claims.json`).then((r) => {
    if (!r.ok) throw new Error(`claims.json: HTTP ${r.status}`)
    return r.json().then((data: { claims?: ClaimJson[] }) => data.claims ?? [])
  })
  // a failed fetch is not cached: a later open retries
  claimsPromise = claimsPromise.catch((e) => {
    claimsPromise = null
    throw e
  })
  return claimsPromise
}

export function ClaimToken({ id, pin = false, className, style }: { id: string; pin?: boolean; className?: string; style?: CSSProperties }) {
  const [open, setOpen] = useState(false)
  const [claim, setClaim] = useState<ClaimJson | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLSpanElement>(null)
  const panelId = useId()
  const text = pin ? claimCite(id) : claimText(id)

  useEffect(() => {
    if (!open || claim !== null || problem !== null) return
    let live = true
    loadClaims()
      .then((claims) => {
        if (!live) return
        const found = claims.find((c) => c.id === id)
        if (found) setClaim(found)
        else setProblem(`claim ${id} is not in claims.json`)
      })
      .catch((e) => {
        if (live) setProblem(e instanceof Error ? e.message : String(e))
      })
    return () => {
      live = false
    }
  }, [open, claim, problem, id])

  useEffect(() => {
    if (!open) return
    const returnFocus = trigger.current
    const skipFocus = { current: false }
    const place = () => {
      const t = trigger.current?.getBoundingClientRect()
      if (!t) return
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * MARGIN)
      const left = Math.max(MARGIN, Math.min(t.left, window.innerWidth - width - MARGIN))
      const below = window.innerHeight - t.bottom - MARGIN
      const above = t.top - MARGIN
      const useBelow = below >= 240 || below >= above
      const maxHeight = Math.max(120, Math.min(384, useBelow ? below : above))
      const top = useBelow ? t.bottom + 4 : Math.max(MARGIN, t.top - maxHeight - 4)
      setPos({ top, left, width, maxHeight })
    }
    place()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        skipFocus.current = false
        setOpen(false)
      }
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!wrap.current?.contains(target) && !panel.current?.contains(target)) {
        skipFocus.current = true
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      if (!skipFocus.current) returnFocus?.focus()
      setPos(null)
    }
  }, [open])

  useEffect(() => {
    if (open && pos !== null) panel.current?.focus()
  }, [open, pos])

  const stale = claim ? staleSince(claim, new Date()) : null
  const panelNode = (
    <span
      ref={panel}
      id={panelId}
      role="dialog"
      aria-label="Claim source"
      tabIndex={-1}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, width: pos?.width ?? PANEL_WIDTH, maxHeight: pos?.maxHeight ?? 384 }}
      className="z-50 block overflow-auto rounded-md border border-line bg-surface-1 p-3 text-left font-mono text-[11px] leading-relaxed text-text-2 shadow-lg"
    >
      {problem !== null ? (
        <span className="block space-y-1">
          <span className="block text-danger">{problem}</span>
          <span className="block text-text-3">{claimCite(id)}</span>
        </span>
      ) : claim === null ? (
        <span className="text-text-3">Loading the source…</span>
      ) : (
        <span className="block space-y-2">
          <span className="block">
            <span className="block text-text-1">{claim.label}</span>
            <span className="block text-accent">{valueText(claim)}</span>
          </span>
          <span className="block text-text-3">
            {KIND_NOTE[claim.kind] ?? claim.kind} · verified {claim.verifiedAt}
            {stale && <span className="text-amber"> · stale since {stale}</span>}
          </span>
          {claim.source && (
            <span className="block">
              <a href={claim.source.url} target="_blank" rel="noreferrer" className="text-info underline underline-offset-2">
                {claim.source.title}
              </a>
              {claim.source.row && <span className="text-text-3"> · {claim.source.row}</span>}
              {claim.source.quote && <q className="mt-1 block text-text-3">{claim.source.quote}</q>}
            </span>
          )}
          {claim.derived && (
            <span className="block text-text-3">
              {claim.derived.formula} from {claim.derived.from.join(', ')}
            </span>
          )}
          {claim.boundary && <span className="block text-text-3">Holds for: {claim.boundary}</span>}
          {claim.discrepancy && <span className="block text-amber">Discrepancy: {claim.discrepancy}</span>}
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-3 hover:text-text-1"
      >
        Close
      </button>
    </span>
  )

  return (
    <span ref={wrap} className="relative inline-block">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={`${text}: show its source`}
        className={cn(
          'rounded-sm text-accent underline decoration-accent/40 decoration-dotted underline-offset-2 transition-colors hover:decoration-accent',
          className,
        )}
        style={style}
      >
        {text}
      </button>
      {open && pos !== null && createPortal(panelNode, document.body)}
    </span>
  )
}
