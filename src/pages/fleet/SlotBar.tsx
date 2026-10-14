import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SLOT_LABEL, type LabKind, type SlotState } from './slots'
import type { DroppedFile } from './upload'

const KINDS = ['sched', 'mgr', 'queue'] as const

export interface SlotBarProps {
  /** what the panels run: the saved modules, less any switched to the reference for this visit */
  slots: SlotState
  /** the kind being checked on fresh seeds */
  checking: LabKind | null
  /** why the last drop was refused */
  error: string | null
  /** saved modules the panels are not running this visit (a reset to the reference drivers) */
  parked: number
  onPick(kind: LabKind, file: DroppedFile): void
  /** uninstall the module of this kind: its bytes stay in the store */
  onUseReference(kind: LabKind): void
  /** run on the saved modules again */
  onUseMine(): void
}

/**
 * The three upload buttons of /fleet, one per slot the panels drive (docs/specs/wave-2.md §10.2). A button says what
 * runs there; a drop is checked on fresh seeds before it is installed, and while it is, every button waits.
 */
export default function SlotBar({ slots, checking, error, parked, onPick, onUseReference, onUseMine }: SlotBarProps) {
  const inputsRef = useRef<Record<LabKind, HTMLInputElement | null>>({ sched: null, mgr: null, queue: null })
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {KINDS.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <button
              onClick={() => inputsRef.current[kind]?.click()}
              disabled={checking !== null}
              data-slot-button={kind}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-3.5 py-2 font-mono text-[12px] transition-colors',
                slots[kind] ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-surface-1 text-text-2 hover:border-accent/50 hover:text-text-1',
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              {checking === kind ? `${SLOT_LABEL[kind]}: checking on fresh seeds…` : `${SLOT_LABEL[kind]}: ${slots[kind] ? 'yours ✓' : 'reference'}`}
            </button>
            {slots[kind] && (
              <button
                type="button"
                onClick={() => onUseReference(kind)}
                disabled={checking !== null}
                aria-label={`Use the reference ${SLOT_LABEL[kind]} instead of yours`}
                className="rounded border border-line px-2 py-1.5 font-mono text-[11px] text-text-3 transition-colors hover:text-text-1 disabled:opacity-40"
              >
                use reference
              </button>
            )}
            <input
              ref={(el) => {
                inputsRef.current[kind] = el
              }}
              type="file"
              accept=".wasm,application/wasm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onPick(kind, f)
                e.target.value = ''
              }}
            />
          </span>
        ))}
      </div>
      {parked > 0 && (
        <p className="mt-2 text-body-sm text-text-2" data-parked>
          The panels are running on the reference drivers for this visit. Your saved {parked === 1 ? 'module is' : 'modules are'} still installed and run again next time you open the Fleet.{' '}
          <button type="button" onClick={onUseMine} className="rounded border border-line px-2 py-1 font-mono text-[11px] text-text-1 hover:border-accent/50">
            use my saved {parked === 1 ? 'module' : 'modules'}
          </button>
        </p>
      )}
      <div role="status" className="mt-2 font-mono text-[11px] text-danger empty:mt-0">
        {error}
      </div>
    </>
  )
}
