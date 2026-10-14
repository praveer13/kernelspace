/**
 * /me, data ownership: export, import, undo, reset and the donation export, moved from Progress as they were
 * (wave-3.md §12.5, task 3b-06). A lazy section; its toast uses framer-motion, so it renders inside `MotionScope`.
 */

import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useProgress, localDateKey } from '@/lib/progress'
import { getLedgerClient } from '@/lib/ledger/client'
import { IMPORT_MAX_BYTES } from '@/lib/ledger/constants'
import { readOnlyNote } from '@/lib/ledger/read-only'
import type { LedgerClient, LedgerStatus } from '@/lib/ledger/types'
import ImportPreviewDialog, { DialogFrame } from '@/components/ledger/ImportPreview'
import type { ImportFile } from '@/components/ledger/ImportPreview'
import { MotionScope } from '@/lib/motion'

const DonateExport = lazy(() => import('@/components/ledger/DonateExport'))

const BACKUP_NUDGE_DAYS = 30
const DAY_MS = 86_400_000

/** Whole days since `since` (an ISO instant or a local `YYYY-MM-DD`). Kept outside the component so render stays pure. */
function daysSince(since: string): number {
  const t = since.length === 10 ? new Date(`${since}T00:00:00`).getTime() : Date.parse(since)
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / DAY_MS) : 0
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${(n / 1024 ** 3).toFixed(1)} GiB`
}

const UNDO_LABELS: Record<NonNullable<LedgerStatus['undo']>['reason'], string> = {
  'import-merge': 'import (merge)',
  'import-replace': 'import (replace)',
  reset: 'reset',
}

type Estimate = Awaited<ReturnType<LedgerClient['storageEstimate']>>

function DataOwnershipBody() {
  const ledger = useProgress((s) => s.ledger)
  const lessons = useProgress((s) => s.lessons)
  const streakDays = useProgress((s) => s.streakDays)
  const resetProgress = useProgress((s) => s.resetProgress)
  const [toast, setToast] = useState<string | null>(null)
  const [pending, setPending] = useState<ImportFile | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0)
  const [resetText, setResetText] = useState('')
  const [estimate, setEstimate] = useState<Estimate | 'unavailable' | null>(null)
  const [working, setWorking] = useState<'export' | 'import' | 'undo' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLButtonElement>(null)
  const resetRef = useRef<HTMLButtonElement>(null)
  const clientRef = useRef<Promise<LedgerClient> | null>(null)
  const [client, setClient] = useState<LedgerClient | null>(null)

  // One engine handle for the page; a failed chunk load clears it so the next click retries.
  const withClient = () => {
    clientRef.current ??= getLedgerClient().then(
      (c) => {
        setClient(c)
        return c
      },
      (err) => {
        clientRef.current = null
        throw err
      },
    )
    return clientRef.current
  }

  const readOnly = ledger.readOnly
  const readOnlyReason = readOnly ? readOnlyNote(ledger.reason) : null
  const undoAt = ledger.undo?.at

  // The storage line: the engine's own count plus the browser's quota. It refreshes whenever an import,
  // undo or reset changes the ledger (their checkpoint changes `undo.at`) or the engine finishes loading.
  useEffect(() => {
    let live = true
    withClient()
      .then((c) => c.storageEstimate())
      .then((e) => live && setEstimate(e))
      .catch(() => live && setEstimate('unavailable'))
    return () => {
      live = false
    }
  }, [ledger.ready, undoAt])

  const flashToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3500)
  }

  const doExport = async () => {
    if (readOnly || working) return
    setWorking('export')
    try {
      const file = await (await withClient()).exportV3()
      const json = JSON.stringify(file)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kernelspace-progress-${localDateKey(new Date(file.exportedAt))}.json`
      a.click()
      URL.revokeObjectURL(url)
      flashToast(`exported ${file.events.length.toLocaleString()} events · ${formatBytes(blob.size)}`)
    } catch {
      flashToast('export failed — nothing was changed')
    } finally {
      setWorking(null)
    }
  }

  const onFile = async (file: File) => {
    if (readOnly) return
    setImportError(null)
    if (file.size > IMPORT_MAX_BYTES) {
      setImportError(`this file is over ${IMPORT_MAX_BYTES / (1024 * 1024)} MiB`)
      return
    }
    setWorking('import')
    try {
      const text = await file.text()
      const preview = await (await withClient()).previewImport(text, 'merge')
      if ('error' in preview) setImportError(preview.detail ?? "this file can't be imported")
      else setPending({ name: file.name, text, preview })
    } catch {
      setImportError('could not read that file')
    } finally {
      setWorking(null)
    }
  }

  const onApplied = (r: { mode: 'merge' | 'replace'; added: number; removed: number }) => {
    setPending(null)
    flashToast(
      r.mode === 'merge'
        ? `merged · ${r.added.toLocaleString()} new events · undo available`
        : `replaced · +${r.added.toLocaleString()} −${r.removed.toLocaleString()} events · undo available`,
    )
  }

  const doUndo = async () => {
    if (readOnly || working) return
    setWorking('undo')
    try {
      const ok = await (await withClient()).undo()
      flashToast(ok ? 'undone — your progress is back as it was' : 'nothing to undo')
    } catch {
      flashToast('undo failed — nothing was changed')
    } finally {
      setWorking(null)
    }
  }

  const doReset = () => {
    resetProgress()
    setResetStep(0)
    setResetText('')
    flashToast('progress cleared — day 0 · undo available')
  }

  // Backup nudge: 30 days since the last export, or (never exported) since the first graded day.
  const hasAny = streakDays.length > 0 || Object.keys(lessons).length > 0
  const since = ledger.lastExportAt ?? (streakDays.length > 0 ? [...streakDays].sort()[0] : null)
  const age = since ? daysSince(since) : 0
  const nudge = ledger.ready && !readOnly && hasAny && since !== null && age >= BACKUP_NUDGE_DAYS

  const btn =
    'rounded-md border border-line bg-surface-2 px-4 py-2 font-mono text-xs text-text-1 transition-colors enabled:hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-40'
  const rows = [
    {
      icon: Download,
      title: 'Export progress',
      desc: 'Download everything as one JSON file (export v3): your events, settings and Capstone drafts.',
      action: (
        <button
          type="button"
          onClick={() => void doExport()}
          disabled={readOnly}
          aria-busy={working !== null}
          className={btn}
        >
          {working === 'export' ? 'exporting…' : 'download'}
        </button>
      ),
    },
    {
      icon: Upload,
      title: 'Import progress',
      desc: 'Restore or combine an export v3 file. You see what changes before anything is written, and you can undo it.',
      action: (
        <button
          ref={chooseRef}
          type="button"
          onClick={() => !working && fileRef.current?.click()}
          disabled={readOnly}
          aria-busy={working !== null}
          className="rounded-md border border-dashed border-line-bright px-4 py-2 font-mono text-xs text-text-2 transition-colors enabled:hover:border-accent enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {working === 'import' ? 'reading…' : 'choose file'}
        </button>
      ),
    },
    ...(ledger.undo
      ? [
          {
            icon: RotateCcw,
            title: `Undo last ${UNDO_LABELS[ledger.undo.reason]}`,
            desc: `Puts your progress back as it was before the ${UNDO_LABELS[ledger.undo.reason]} on ${new Date(ledger.undo.at).toLocaleString()}. Anything you have done since stays. Available until your next import or reset.`,
            action: (
              <button
                type="button"
                onClick={() => void doUndo()}
                disabled={readOnly}
                aria-busy={working !== null}
                className={btn}
              >
                {working === 'undo' ? 'undoing…' : 'undo'}
              </button>
            ),
          },
        ]
      : []),
    {
      icon: Trash2,
      title: 'Reset everything',
      desc: 'Clear your lessons, quiz and lab results, XP, streak, achievements and saved settings from this browser. Undo is available until your next import or reset.',
      action: (
        <button
          ref={resetRef}
          type="button"
          onClick={() => !working && setResetStep(1)}
          disabled={readOnly}
          aria-busy={working !== null}
          className="rounded-md border border-danger/60 px-4 py-2 font-mono text-xs text-danger transition-colors enabled:hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          reset
        </button>
      ),
    },
  ]

  return (
    <div className="mt-14">
      <h2 className="font-display text-h3 text-text-1">data ownership</h2>
      {readOnlyReason && (
        <p
          role="status"
          className="mt-4 rounded-md border border-amber/50 bg-amber/5 px-4 py-3 text-body-sm text-text-1"
        >
          Export, import, undo and reset are turned off. {readOnlyReason}
        </p>
      )}
      {nudge && (
        <div
          role="region"
          aria-label="Backup reminder"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-body-sm text-text-1">
            {ledger.lastExportAt
              ? `Your last backup was ${age} days ago.`
              : `You have been learning for ${age} days and have not downloaded a backup.`}{' '}
            <span className="text-text-2">
              Browsers can clear site data without asking; a downloaded export is the copy that survives it.
            </span>
          </p>
          <button type="button" onClick={() => void doExport()} aria-busy={working !== null} className={btn}>
            download backup
          </button>
        </div>
      )}
      <div className="mt-5 divide-y divide-line rounded-lg border border-line bg-surface-1">
        {rows.map((row) => (
          <div
            key={row.title}
            className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2"
          >
            <row.icon size={18} strokeWidth={1.75} className="shrink-0 text-text-3" />
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-medium text-text-1">{row.title}</p>
              <p className="text-body-sm text-text-3">{row.desc}</p>
            </div>
            {row.action}
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        {readOnly
          ? 'stored locally · size unavailable while this tab is read-only'
          : estimate === null
            ? 'stored locally · measuring…'
            : estimate === 'unavailable'
              ? 'stored locally · size unavailable'
              : `stored locally · ${estimate.events.toLocaleString()} events · ~${formatBytes(estimate.approxBytes)}${
                estimate.usage !== undefined && estimate.quota !== undefined
                  ? ` · this site uses ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`
                  : ''
              }${
                ledger.persisted === true
                  ? ' · protected from eviction'
                  : ledger.persisted === false
                    ? ' · the browser may clear it when space is short'
                    : ''
              }`}
        {' · no account · no tracking'}
      </p>
      {importError && (
        <p role="alert" className="mt-2 font-mono text-[12px] text-danger">
          {importError}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="import-file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />

      {pending && client && (
        <ImportPreviewDialog
          file={pending}
          client={client}
          returnFocus={chooseRef}
          onClose={() => setPending(null)}
          onApplied={onApplied}
        />
      )}

      {resetStep > 0 && (
        <DialogFrame
          role="alertdialog"
          returnFocus={resetRef}
          tone={resetStep === 2 ? 'danger' : 'default'}
          onClose={() => {
            setResetStep(0)
            setResetText('')
          }}
          title={resetStep === 1 ? 'Reset everything?' : 'Type RESET to confirm'}
          description={
            resetStep === 1 ? (
              <>
                <span className="block">
                  <strong className="font-medium text-text-1">This clears</strong> every lesson, checkpoint
                  answer, sim task, lab result, Fleet Week and Capstone step, achievement, XP point and
                  streak day, plus your saved settings and scroll positions, in this browser.
                </span>
                <span className="mt-2 block">
                  <strong className="font-medium text-text-1">This keeps</strong> any file you exported,
                  your compiled lab modules, your Capstone drafts and flags, and your leaderboard best.
                </span>
                <span className="mt-2 block">
                  Undo is available until your next import or reset. A backup is safer: export first.
                </span>
              </>
            ) : (
              'This is the last step. Your progress is cleared as soon as you confirm.'
            )
          }
        >
          {resetStep === 2 && (
            <input
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              aria-label="Type RESET to confirm"
              placeholder="RESET"
              autoComplete="off"
              autoFocus
              className="mt-4 w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-text-1 placeholder:text-text-3 focus:border-danger focus:outline-none"
            />
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setResetStep(0)
                setResetText('')
              }}
              className="rounded-md border border-line bg-surface-2 px-4 py-2 font-mono text-xs text-text-2 hover:border-line-bright"
            >
              {resetStep === 1 ? 'keep my progress' : 'cancel'}
            </button>
            {resetStep === 1 ? (
              <button
                type="button"
                onClick={() => setResetStep(2)}
                className="rounded-md border border-danger/60 px-4 py-2 font-mono text-xs text-danger hover:bg-danger/10"
              >
                continue →
              </button>
            ) : (
              <button
                type="button"
                disabled={resetText !== 'RESET'}
                onClick={doReset}
                className="rounded-md bg-danger px-4 py-2 font-mono text-xs font-semibold text-ink transition-all enabled:hover:brightness-110 disabled:opacity-40"
              >
                wipe it
              </button>
            )}
          </div>
        </DialogFrame>
      )}

      {/* announced to screen readers; the visible toast below is decoration */}
      <div role="status" aria-live="polite" className="sr-only">
        {toast}
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-16 right-6 z-[80] flex items-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2.5 font-mono text-xs text-text-1 shadow-lg lg:bottom-14"
          >
            <Check size={13} className="text-accent" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function DataOwnership() {
  return (
    <MotionScope>
      <DataOwnershipBody />
      <Suspense fallback={null}>
        <DonateExport />
      </Suspense>
    </MotionScope>
  )
}
