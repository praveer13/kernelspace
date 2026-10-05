import { useState } from 'react'
import { deltaFile, handoffLabel, handoffSince, parseHandoffMarker } from '@/lib/learner/handoff'
import { getLedgerClient } from '@/lib/ledger/client'
import type { Json } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'

export interface HandoffButtonProps {
  /** Events newer than the last handoff and the last export (`pendingHandoff`); 0 hides the count. */
  pending: number
}

/**
 * "Hand off to my other device" (spec §6.6): downloads `kernelspace-delta-<date>.json`, an export v3 of only
 * what changed since the last handoff, and writes `handoff:last`. The other device imports it with merge.
 * QR handoff is deferred to Wave 2 (D11).
 */
export default function HandoffButton({ pending }: HandoffButtonProps) {
  const working = useProgress((s) => s.working['handoff:last'])
  const readOnly = useProgress((s) => s.ledger.readOnly)
  const setWorking = useProgress((s) => s.setWorking)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const last = parseHandoffMarker(working)
  const label = handoffLabel(pending)

  const run = async () => {
    if (busy || readOnly) return
    setBusy(true)
    setNote(null)
    try {
      const client = await getLedgerClient()
      const file = deltaFile(await client.exportV3(last ? { sinceAt: handoffSince(last) } : {}))
      const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setWorking('handoff:last', file.marker as unknown as Json)
      setNote(`Saved ${file.name} with ${file.marker.events} ${file.marker.events === 1 ? 'event' : 'events'}. On your other device, import it with Merge.`)
    } catch {
      setNote('Could not make the file. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy || readOnly}
        aria-describedby={label ? 'handoff-pending' : undefined}
        className="min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-60"
      >
        Hand off to my other device
      </button>
      {label && (
        <p id="handoff-pending" className="mt-1 font-mono text-[12px] text-text-3">
          {label}
        </p>
      )}
      <p role="status" aria-live="polite" className="mt-1 text-body-sm text-text-2 empty:hidden">
        {note}
      </p>
    </div>
  )
}
