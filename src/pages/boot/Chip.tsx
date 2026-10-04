/**
 * Number chips for Boot (spec §12.4): every figure on the page is a tappable chip that opens its
 * label, value, source, `verifiedAt` and "stale since", or, for a derived number, its formula and the
 * claims it reads. The panel opens inline (no popover), so the Boot chunk stays small and the panel
 * never overflows a 360 px screen. Everything inside is phrasing content, so chips sit in a paragraph.
 */
import { useId, useState } from 'react'
import { byId, formatClaimValue, getClaim, staleSince } from '@/data/claims'
import type { Claim } from '@/data/claims'
import { DERIVED_NOTES, type DerivedKey } from '@/lib/boot/model'
import { cn } from '@/lib/utils'

const KIND_NOTE: Record<Claim['kind'], string> = {
  spec: 'vendor spec',
  price: 'dated price',
  benchmark: 'benchmark',
  status: 'status',
  derived: 'derived',
  synthetic: 'synthetic, no real-world source',
}

const CHIP =
  'relative inline cursor-help rounded-sm border-b border-dotted border-text-3 px-0.5 font-mono text-[0.92em] text-accent ' +
  // the visible chip is small and sits in a sentence; the invisible ::after pads the tap target toward 44 px
  'after:absolute after:-inset-y-3 after:inset-x-0 after:content-[""] hover:border-accent ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const PANEL = 'my-2 block rounded-md border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text-2'

function Source({ source }: { source: NonNullable<Claim['source']> }) {
  return (
    <span className="block">
      <a href={source.url} target="_blank" rel="noreferrer" className="text-info underline underline-offset-2">
        {source.title}
      </a>
      {source.row && <span className="text-text-3"> · {source.row}</span>}
      {source.quote && <q className="mt-1 block text-text-3">{source.quote}</q>}
    </span>
  )
}

function ClaimPanel({ claim, now }: { claim: Claim; now: Date }) {
  const stale = staleSince(claim, now)
  return (
    <>
      <span className="block text-text-1">{claim.label}</span>
      <span className="block text-accent">{formatClaimValue(claim)}</span>
      <span className="block text-text-3">
        {KIND_NOTE[claim.kind]} · verified {claim.verifiedAt}
        {stale && <span className="text-amber"> · stale since {stale}</span>}
      </span>
      {claim.source && <Source source={claim.source} />}
      {claim.boundary && <span className="block text-text-3">Holds for: {claim.boundary}</span>}
      {claim.discrepancy && <span className="block text-amber">Discrepancy: {claim.discrepancy}</span>}
    </>
  )
}

function useNow(): Date {
  // Staleness is judged in the browser so a deployed page ages without a rebuild.
  const [now] = useState(() => new Date())
  return now
}

interface ClaimChipProps {
  id: string
  /** Replaces the default "value unit" text. */
  children?: React.ReactNode
}

/** A claim from the registry. */
export function ClaimChip({ id, children }: ClaimChipProps) {
  const claim = getClaim(id)
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const now = useNow()
  const text = children ?? formatClaimValue(claim)
  return (
    <>
      <button
        type="button"
        className={CHIP}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${claim.label}: ${formatClaimValue(claim)}. ${open ? 'Hide' : 'Show'} source`}
        onClick={() => setOpen((o) => !o)}
      >
        {text}
      </button>
      {open && (
        <span id={panelId} className={PANEL}>
          <ClaimPanel claim={claim} now={now} />
        </span>
      )}
    </>
  )
}

interface DerivedChipProps {
  /** Which derived quantity this is (its formula and inputs). */
  of: DerivedKey
  /** The rendered value, from the `fmt` helpers. */
  children: React.ReactNode
}

/** A number derived from claims, marked [derived], opening its formula and its inputs. */
export function DerivedChip({ of, children }: DerivedChipProps) {
  const note = DERIVED_NOTES[of]
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <>
      <button
        type="button"
        className={cn(CHIP, 'text-amber')}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Derived: ${note.formula}. ${open ? 'Hide' : 'Show'} how`}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
        <sup className="ml-0.5 text-[9px] text-text-3">[derived]</sup>
      </button>
      {open && (
        <span id={panelId} className={PANEL}>
          <span className="block text-amber">[derived]</span>
          <span className="block text-text-1">{note.formula}</span>
          <span className="mt-1 block text-text-3">from</span>
          {note.from.map((id) => {
            const input = byId[id]
            return (
              <span key={id} className="block border-l border-line pl-2">
                <span className="text-text-2">{input.label}</span> <span className="text-accent">{formatClaimValue(input)}</span>
                <span className="block text-text-3">
                  {KIND_NOTE[input.kind]} · verified {input.verifiedAt}
                </span>
              </span>
            )
          })}
          {note.scenario && <span className="mt-1 block text-text-3">Scenario, not a claim: {note.scenario}.</span>}
        </span>
      )}
    </>
  )
}
