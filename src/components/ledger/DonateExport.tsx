/**
 * "Donate a redacted export" on /me, at the foot of its data ownership section (src/pages/me/DataOwnership.tsx mounts
 * it lazily; it lived on /progress before 3b-06; docs/specs/wave-2.md §20.2, task 2a-21). A partner previews what a
 * donation would hold, then downloads `kernelspace-donation-<n>.json` and sends it to the owner privately.
 * Nothing is uploaded: the file is built here from the learner's own export by `redactForPartner`, which keeps
 * a whitelist (kind, ref, score, correctness, confidence, provenance, time on task and a day offset per event,
 * plus a few structural fields) and no free text, seed, hash, device id or calendar date.
 */
import { useRef, useState } from 'react'
import { Gift } from 'lucide-react'
import { getLedgerClient } from '@/lib/ledger/client'
import { redactForPartner, summarizeDonation, type Donation, type DonationSummary } from '@/lib/learner/redact'
import { useProgress } from '@/lib/progress'
import { DialogFrame } from './ImportPreview'

export type DonateExportProps = Record<string, never>

/** How many events the preview shows verbatim. */
const SAMPLE = 6
const COUNTER_KEY = 'ks:donation-n'

interface Preview {
  donation: Donation
  text: string
  summary: DonationSummary
}

/** The `<n>` of the file name: this browser's count of donations, so two files never share a name. Storage may be blocked; then it is 1. */
function nextNumber(): number {
  try {
    const n = Number(window.localStorage.getItem(COUNTER_KEY))
    return Number.isInteger(n) && n >= 0 ? n + 1 : 1
  } catch {
    return 1
  }
}

function rememberNumber(n: number): void {
  try {
    window.localStorage.setItem(COUNTER_KEY, String(n))
  } catch {
    // a blocked store only means the next file may reuse a number
  }
}

const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`

export default function DonateExport() {
  const readOnly = useProgress((s) => s.ledger.readOnly)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const openPreview = async () => {
    if (busy || readOnly) return
    setBusy(true)
    setNote(null)
    try {
      const donation = redactForPartner(await (await getLedgerClient()).exportV3())
      setPreview({ donation, text: JSON.stringify(donation), summary: summarizeDonation(donation) })
    } catch {
      setNote('Could not read your progress. Nothing was changed; try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!preview) return
    const n = nextNumber()
    const name = `kernelspace-donation-${n}.json`
    const url = URL.createObjectURL(new Blob([preview.text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    rememberNumber(n)
    setNote(`Saved ${name} (${kib(preview.text.length)}, ${preview.summary.events.toLocaleString()} events). Send it to the owner privately.`)
    setPreview(null)
  }

  const btn =
    'rounded-md border border-line bg-surface-2 px-4 py-2 font-mono text-xs text-text-1 transition-colors enabled:hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <section aria-labelledby="donate-heading" className="mt-10">
      <h2 id="donate-heading" className="font-display text-h3 text-text-1">
        donate a redacted export
      </h2>
      <div className="mt-5 flex items-center gap-4 rounded-lg border border-line bg-surface-1 px-5 py-4">
        <Gift size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text-3" />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium text-text-1">Help the partner study</p>
          <p className="text-body-sm text-text-3">
            A file with how you did and when, in days since your first event. No text you typed, no dates, seeds
            or device ids; the numbers you gave to number questions stay, with the right ones. You see it before it
            is saved.
          </p>
        </div>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => void openPreview()}
          disabled={readOnly}
          aria-busy={busy}
          className={btn}
        >
          {busy ? 'reading…' : 'preview'}
        </button>
      </div>
      {note && (
        <p role="status" className="mt-3 font-mono text-[12px] text-text-2">
          {note}
        </p>
      )}

      {preview && (
        <DialogFrame
          returnFocus={triggerRef}
          onClose={() => setPreview(null)}
          title="What the owner would receive"
          description={
            <>
              <span className="block">
                {preview.summary.events.toLocaleString()} events over {preview.summary.days}{' '}
                {preview.summary.days === 1 ? 'day' : 'days'}, {kib(preview.text.length)}. Each event keeps its kind,
                what it was about, whether you got it right, how long it took (to the second) and its day number.
              </span>
              <span className="mt-2 block">
                Left out: any text you typed, your Boot answer, seeds, module hashes, device ids, dates, clock times
                and your Capstone drafts. Kept besides: the number you answered a number question with and the right
                one, except for measurements of your own hardware, and the names of the checks each lab run passed.
              </span>
            </>
          }
        >
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-2" aria-label="events by kind">
            {preview.summary.kinds.map((k) => (
              <li key={k.kind}>
                {k.kind} {k.count.toLocaleString()}
              </li>
            ))}
          </ul>
          <p className="mt-4 font-mono text-[11px] text-text-3" id="donate-sample-label">
            the first {Math.min(SAMPLE, preview.donation.events.length)} events, as they appear in the file
          </p>
          {/* A scrollable region takes focus, so a keyboard user can read it. */}
          <pre
            role="region"
            tabIndex={0}
            aria-labelledby="donate-sample-label"
            className="mt-2 max-h-48 overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[11px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {JSON.stringify(preview.donation.events.slice(0, SAMPLE), null, 1)}
          </pre>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-md border border-line bg-surface-2 px-4 py-2 font-mono text-xs text-text-2 hover:border-line-bright"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={download}
              className="rounded-md bg-accent px-4 py-2 font-mono text-xs font-semibold text-ink transition-all hover:brightness-110"
            >
              download
            </button>
          </div>
        </DialogFrame>
      )}
    </section>
  )
}
