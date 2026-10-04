/**
 * IMPORT PREVIEW — the dialog between choosing an export file and writing it (ledger spec §10.3-10.5, task L4).
 * The engine derives the result in memory (`previewImport`), so what the learner reads here is exactly what
 * `importFile` will do. Merge is the default; replace says what it drops. Both leave one level of undo.
 *
 * `DialogFrame` is the shared Radix shell (focus trap, Escape, labelled title and description) that /progress
 * also uses for the reset confirmation.
 */

import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  ImportErrorCode,
  ImportMode,
  ImportPreview,
  ImportResult,
  LedgerClient,
  ProgressSummary,
} from '@/lib/ledger/types'
import { cn } from '@/lib/utils'

/* ---------------- dialog shell ---------------- */

export function DialogFrame({
  onClose,
  title,
  description,
  role = 'dialog',
  tone = 'default',
  returnFocus,
  children,
}: {
  onClose: () => void
  title: string
  description: React.ReactNode
  /** `alertdialog` for destructive confirmations. */
  role?: 'dialog' | 'alertdialog'
  tone?: 'default' | 'danger'
  /** Where focus goes on close. Radix only restores focus to a `Dialog.Trigger`, and these dialogs open from code. */
  returnFocus?: React.RefObject<HTMLElement | null>
  children: React.ReactNode
}) {
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-ink/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          role={role}
          onCloseAutoFocus={(e) => {
            if (!returnFocus?.current) return
            e.preventDefault()
            returnFocus.current.focus()
          }}
          className="fixed left-1/2 top-1/2 z-[91] max-h-[calc(100dvh-3rem)] w-[calc(100%-3rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line-bright bg-surface-1 p-6 shadow-[0_24px_80px_rgba(0,0,0,.6)] focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
        >
          <Dialog.Title
            className={cn('font-display text-h4', tone === 'danger' ? 'text-danger' : 'text-text-1')}
          >
            {title}
          </Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-3 text-body-sm text-text-2">{description}</div>
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ---------------- preview ---------------- */

const ROWS: { key: keyof ProgressSummary; label: string }[] = [
  { key: 'lessonsDone', label: 'lessons done' },
  { key: 'xp', label: 'XP' },
  { key: 'activeDays', label: 'active days' },
  { key: 'labsDone', label: 'labs done' },
  { key: 'events', label: 'events' },
]

function signed(n: number): string {
  if (n === 0) return '±0'
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString()}`
}

type PreviewOrError = ImportPreview | { error: ImportErrorCode; detail?: string }

const isError = (p: PreviewOrError): p is { error: ImportErrorCode; detail?: string } => 'error' in p

export interface ImportFile {
  name: string
  text: string
  /** The merge preview the page already computed, so the dialog opens with numbers. */
  preview: ImportPreview
}

export default function ImportPreviewDialog({
  file,
  client,
  returnFocus,
  onClose,
  onApplied,
}: {
  file: ImportFile
  client: LedgerClient
  returnFocus?: React.RefObject<HTMLElement | null>
  onClose: () => void
  onApplied: (result: Extract<ImportResult, { ok: true }>) => void
}) {
  const [mode, setMode] = useState<ImportMode>('merge')
  const [preview, setPreview] = useState<PreviewOrError>(file.preview)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  // Only the latest request may set the preview, so a slow merge answer cannot overwrite a replace one.
  const seq = useRef(0)

  const pick = (next: ImportMode) => {
    if (next === mode || busy) return
    setMode(next)
    setApplyError(null)
    setLoading(true)
    const mine = ++seq.current
    client
      .previewImport(file.text, next)
      .then((p) => {
        if (mine === seq.current) setPreview(p)
      })
      .catch(() => {
        if (mine === seq.current) setPreview({ error: 'invalid', detail: 'the preview failed; try again' })
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false)
      })
  }

  useEffect(() => () => void seq.current++, [])

  const ready = !isError(preview) && !loading
  const nothingToMerge = ready && mode === 'merge' && preview.newEvents === 0 && preview.workingChanges === 0

  const apply = async () => {
    if (!ready || nothingToMerge || busy) return
    setBusy(true)
    setApplyError(null)
    try {
      const res = await client.importFile(file.text, mode)
      if (res.ok) onApplied(res)
      else setApplyError(res.detail ?? 'the import failed')
    } catch {
      setApplyError('the import failed; nothing was changed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame
      onClose={() => !busy && onClose()}
      returnFocus={returnFocus}
      title="Import this export?"
      description={
        <>
          <span className="font-mono text-[12px] text-text-3">{file.name}</span>
          <span className="mt-1 block">
            Nothing is written until you apply. Undo stays available until your next import or
            reset.
          </span>
        </>
      }
    >
      <fieldset className="mt-4" disabled={busy}>
        <legend className="sr-only">How to import</legend>
        <div className="grid gap-2">
          {(
            [
              ['merge', 'Merge', 'Add what this file has and your ledger lacks. Keeps everything you have.'],
              ['replace', 'Replace', "Swap your ledger for the file's contents. Events that are not in the file are dropped."],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                mode === value ? 'border-accent bg-accent/5' : 'border-line hover:border-line-bright',
                'focus-within:ring-2 focus-within:ring-accent/60',
              )}
            >
              <input
                type="radio"
                name="import-mode"
                value={value}
                checked={mode === value}
                onChange={() => pick(value)}
                className="mt-1 accent-accent"
              />
              <span>
                <span className="block text-body-sm font-medium text-text-1">{label}</span>
                <span className="block text-[12px] leading-snug text-text-3">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div aria-live="polite" aria-busy={loading} className="mt-4">
        {loading && <p className="font-mono text-[11px] text-text-3">calculating…</p>}
        {!loading && isError(preview) && (
          <p role="alert" className="font-mono text-[12px] leading-relaxed text-danger">
            {preview.detail ?? "this file can't be imported"}
          </p>
        )}
        {ready && (
          <>
            <table className="w-full font-mono text-[12px]">
              <caption className="sr-only">
                Your progress before and after a {mode}, from {preview.fileEvents} events in the file
              </caption>
              <thead>
                <tr className="text-left text-[11px] text-text-3">
                  <th scope="col" className="pb-1 font-normal">
                    &nbsp;
                  </th>
                  <th scope="col" className="pb-1 text-right font-normal">
                    now
                  </th>
                  <th scope="col" className="pb-1 text-right font-normal">
                    after
                  </th>
                  <th scope="col" className="pb-1 text-right font-normal">
                    change
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const a = preview.before[row.key]
                  const b = preview.after[row.key]
                  return (
                    <tr key={row.key} className="border-t border-line">
                      <th scope="row" className="py-1 text-left font-normal text-text-2">
                        {row.label}
                      </th>
                      <td className="py-1 text-right text-text-2">{a.toLocaleString()}</td>
                      <td className="py-1 text-right text-text-1">{b.toLocaleString()}</td>
                      <td
                        className={cn(
                          'py-1 text-right',
                          b > a ? 'text-accent' : b < a ? 'text-danger' : 'text-text-3',
                        )}
                      >
                        {signed(b - a)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-2 font-mono text-[11px] text-text-3">
              {preview.fileEvents.toLocaleString()} events in the file ·{' '}
              {preview.newEvents.toLocaleString()} {mode === 'merge' ? 'new to this device' : 'written'} ·{' '}
              {preview.workingChanges.toLocaleString()} setting
              {preview.workingChanges === 1 ? '' : 's'} changed
            </p>
            {nothingToMerge && (
              <p className="mt-2 text-body-sm text-text-2">
                Nothing to merge: your ledger already has every event in this file. (This is what
                re-importing your own export looks like.)
              </p>
            )}
            {preview.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 font-mono text-[11px] leading-relaxed text-amber">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {applyError && (
        <p role="alert" className="mt-3 font-mono text-[12px] text-danger">
          {applyError}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md border border-line bg-surface-2 px-4 py-2 font-mono text-xs text-text-2 hover:border-line-bright disabled:opacity-40"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!ready || nothingToMerge || busy}
          className={cn(
            'rounded-md px-4 py-2 font-mono text-xs font-semibold transition-transform enabled:active:scale-[.97] disabled:opacity-40',
            mode === 'replace'
              ? 'bg-danger text-ink enabled:hover:brightness-110'
              : 'bg-accent text-accent-foreground',
          )}
        >
          {busy ? 'importing…' : mode === 'merge' ? 'merge into my progress' : 'replace my progress'}
        </button>
      </div>
    </DialogFrame>
  )
}
