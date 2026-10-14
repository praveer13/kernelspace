import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type ReactNode } from 'react'
import { Check, CircleDashed, X } from 'lucide-react'
import { parseReceipts, type Figure, type Receipt, type ReceiptCheck } from '@/lib/fleet-receipts'
import { RECEIPT_STATUS_TEXT } from '@/lib/fleet-week'
import { cn } from '@/lib/utils'

/**
 * Fleet Week's write-up editor (docs/specs/wave-3.md §10.2-10.3). The analysis is plain text, and a receipt in it is a
 * token such as `[[r:7f3a9c21 goodput=41.2]]`: every metric row of a run offers "cite", which inserts one at the caret.
 * Below the text the tokens show as chips, each with where its check stands, the figures that sit outside every token are
 * listed ("cite it or cut it"), and a checked write-up lists what each receipt's re-run found.
 */

/** What a chip says: not checked yet, or the status the check found. */
export type ChipStatus = ReceiptCheck['status'] | 'unchecked'

const CHIP_WORDS: Record<ChipStatus, string> = {
  verified: 'verified',
  unchecked: 'unchecked',
  mismatch: 'not verified',
  'too-precise': 'not verified',
  'no-value': 'not verified',
  'no-record': 'not verified',
  tampered: 'not verified',
  'bad-record': 'not verified',
  'module-missing': 'not verified',
  'run-failed': 'not verified',
}

/** The text with each receipt token drawn as a chip; the characters between them stay as they were written. */
export function ReceiptText({ text, statusOf }: { text: string; statusOf?: (receipt: Receipt) => ChipStatus }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const r of parseReceipts(text)) {
    if (r.index > at) parts.push(text.slice(at, r.index))
    const status = statusOf?.(r) ?? 'unchecked'
    parts.push(
      <span
        key={r.index}
        data-receipt-chip
        data-status={status}
        className={cn(
          'mx-0.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 align-baseline font-mono text-[11px]',
          status === 'verified' ? 'border-accent/60 bg-accent/10 text-accent' : status === 'unchecked' ? 'border-line bg-surface-2 text-text-2' : 'border-amber/60 bg-amber/5 text-amber',
        )}
      >
        {status === 'verified' ? <Check className="h-3 w-3" aria-hidden /> : status === 'unchecked' ? <CircleDashed className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
        <span>
          {r.key} {r.text}
        </span>
        <span className="sr-only">{`, run ${r.id}, ${CHIP_WORDS[status]}`}</span>
        <span aria-hidden>· {CHIP_WORDS[status]}</span>
      </span>,
    )
    at = r.index + r.length
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

export interface ReceiptEditorHandle {
  /** Insert a receipt token at the caret (the end of the text if the box was never used). False when it does not fit. */
  insert(token: string): boolean
}

export interface ReceiptEditorProps {
  label: string
  /** What to write about, under the label. */
  hint?: ReactNode
  value: string
  onChange(next: string): void
  placeholder?: string
  maxLength?: number
  /** The run the write-up is graded against; a receipt of another run is listed as such. */
  runId: string | null
  /** The checks of exactly this text, or null when it was not checked, or has been edited since. */
  checks: readonly ReceiptCheck[] | null
  uncited: readonly Figure[]
}

export const ReceiptEditor = forwardRef<ReceiptEditorHandle, ReceiptEditorProps>(function ReceiptEditor(
  { label, hint, value, onChange, placeholder, maxLength = 2400, runId, checks, uncited },
  ref,
) {
  const id = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<{ start: number; end: number } | null>(null)
  const wanted = useRef<number | null>(null)

  const track = () => {
    const el = box.current
    if (el) caret.current = { start: el.selectionStart, end: el.selectionEnd }
  }

  useImperativeHandle(
    ref,
    () => ({
      insert(token) {
        const length = value.length
        const start = Math.min(caret.current?.start ?? length, length)
        const end = Math.min(Math.max(caret.current?.end ?? length, start), length)
        const before = value.slice(0, start)
        const after = value.slice(end)
        const lead = before && !/\s$/.test(before) ? ' ' : ''
        const trail = after && /^\s/.test(after) ? '' : ' '
        const next = `${before}${lead}${token}${trail}${after}`
        if (next.length > maxLength) return false
        wanted.current = before.length + lead.length + token.length + trail.length
        onChange(next)
        return true
      },
    }),
    [value, maxLength, onChange],
  )

  // after an insert, the caret sits after the token (the next citation goes on from there)
  useEffect(() => {
    const at = wanted.current
    wanted.current = null
    if (at !== null && box.current) {
      caret.current = { start: at, end: at }
      if (document.activeElement === box.current) box.current.setSelectionRange(at, at)
    }
  }, [value])

  const status = (r: Receipt): ChipStatus => checks?.find((c) => c.receipt.index === r.index)?.status ?? 'unchecked'
  const hasText = value.trim().length > 0

  return (
    <div data-receipt-editor>
      <label htmlFor={`${id}-text`} className="block font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">
        {label}
      </label>
      {hint && <p className="mt-1 max-w-2xl text-body-sm text-text-2">{hint}</p>}
      <textarea
        id={`${id}-text`}
        ref={box}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          track()
        }}
        onSelect={track}
        onBlur={track}
        rows={7}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={`${id}-count`}
        className="mt-2 w-full rounded-md border border-line bg-surface-1 p-3 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-accent/60"
      />
      <p id={`${id}-count`} className="mt-1 font-mono text-[10px] text-text-3">
        {value.length}/{maxLength} characters. Cite a number with the &ldquo;cite&rdquo; buttons, or type <code>[[r:&lt;run id&gt; &lt;name&gt;=&lt;number&gt;]]</code>.
      </p>

      {hasText && (
        <div className="mt-3 rounded-md border border-line bg-surface-2 p-3" data-receipt-preview>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">Your analysis, receipts as chips</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-body-sm leading-7 text-text-1">
            <ReceiptText text={value} statusOf={status} />
          </p>
        </div>
      )}

      {uncited.length > 0 && (
        <div className="mt-3 rounded-md border border-amber/50 bg-amber/5 p-3 text-body-sm text-text-1" data-uncited>
          <p className="font-mono text-[11px] text-amber">Cite it or cut it: {uncited.length} figure{uncited.length === 1 ? '' : 's'} with a unit outside a receipt</p>
          <p className="mt-1 break-words font-mono text-[12px] text-text-2">{uncited.map((f) => f.text).join(' · ')}</p>
        </div>
      )}

      {checks && checks.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label="What re-running each receipt found" data-receipt-checks>
          {checks.map((c) => {
            const ok = c.status === 'verified'
            const other = runId !== null && c.receipt.id !== runId
            return (
              <li key={c.receipt.index} data-status={c.status} className={cn('flex items-start gap-2 rounded-md border-l-2 bg-surface-2 px-3 py-2 text-body-sm text-text-2', ok ? 'border-accent' : 'border-amber')}>
                {ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" aria-hidden />}
                <span className="min-w-0 break-words">
                  <span className="font-mono text-[11px] text-text-1">
                    r:{c.receipt.id} {c.receipt.key}={c.receipt.text}
                  </span>{' '}
                  {ok ? 'verified' : 'not verified'}: {RECEIPT_STATUS_TEXT[c.status]}
                  {c.status === 'mismatch' && c.actual !== undefined ? ` (the re-run gives ${c.actual})` : ''}
                  {c.status === 'module-missing' && c.missing?.length ? ` (${c.missing.join(', ')})` : ''}
                  {ok && other ? '; it is not the run being graded, so it does not count' : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})
