/**
 * PermissionDiagram (F4, docs/specs/wave-2.md §17.1): a permission trace drawn as a table, lines down
 * and paths across. Each cell holds the path's Read/Write/Own permissions after that line; a letter
 * the line gave is marked `+`, one it took away `−`, and each use of the path says what it needs and,
 * when the compiler rejects it, which permission is missing. Text first, colour second: every mark
 * reads without colour, and screen readers hear "gains read", "loses own", "missing write".
 *
 * Attached to a code block by `CodeBlockData.permissions: {trace}` (not a block type of its own). The
 * default export loads the lesson's trace file (`src/data/aquascope/<lessonId>.json`) on demand, so a
 * lesson without diagrams never downloads one; `PermissionTable` draws a trace already in hand.
 * The table scrolls sideways inside its own focusable region at 360 px.
 */
import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  AQUASCOPE_TOOLCHAIN,
  PERM_NAMES,
  traceTable,
  type PermCell,
  type PermissionTrace,
  type PermissionTraceFile,
} from '@/data/aquascope/types'

type TraceLoader = () => Promise<unknown>

/** Vite's lazy map of the lesson trace files (not the sample); undefined under Bun, which has no glob. */
function traceLoaders(): Record<string, TraceLoader> | undefined {
  try {
    return import.meta.glob(['/src/data/aquascope/*.json', '!/src/data/aquascope/sample.json'], { import: 'default' })
  } catch {
    return undefined
  }
}

const fileCache = new Map<string, Promise<PermissionTraceFile | null>>()

function loadTraceFile(lessonId: string): Promise<PermissionTraceFile | null> {
  let p = fileCache.get(lessonId)
  if (!p) {
    const load = traceLoaders()?.[`/src/data/aquascope/${lessonId}.json`]
    p = load ? load().then((f) => f as PermissionTraceFile, () => null) : Promise.resolve(null)
    fileCache.set(lessonId, p)
  }
  return p
}

const sign = { gained: '+', lost: '−' } as const

function CellView({ cell }: { cell: PermCell }) {
  if (cell.empty) {
    return (
      <>
        <span aria-hidden className="text-text-3">
          ·
        </span>
        <span className="sr-only">not live</span>
      </>
    )
  }
  const none = cell.marks.every((m) => !m.held && !m.change)
  return (
    <div className="space-y-1">
      <div className="flex gap-1.5 font-mono text-[13px]">
        {none ? (
          <span className="text-text-3">none</span>
        ) : (
          cell.marks.map((m) => {
            if (m.change) {
              return (
                <span key={m.letter} className={cn('font-medium', m.change === 'gained' ? 'text-accent' : 'text-danger line-through decoration-1')}>
                  <span aria-hidden>
                    {sign[m.change]}
                    {m.letter}
                  </span>
                  <span className="sr-only">
                    {m.change === 'gained' ? 'gains' : 'loses'} {PERM_NAMES[m.letter]},
                  </span>
                </span>
              )
            }
            if (m.held) {
              return (
                <span key={m.letter} className="text-text-2">
                  <span aria-hidden>{m.letter}</span>
                  <span className="sr-only">{PERM_NAMES[m.letter]},</span>
                </span>
              )
            }
            return (
              <span key={m.letter} aria-hidden className="w-[1ch] text-text-3">
                ·
              </span>
            )
          })
        )}
      </div>
      {cell.uses.map((u, i) => (
        <p key={i} className={cn('font-mono text-[11px] leading-snug', u.missing.length > 0 ? 'text-danger' : 'text-text-3')}>
          <span className="whitespace-nowrap">needs {u.needs.join('')}</span>
          {u.missing.length > 0 ? (
            <>
              {' '}
              <span className="whitespace-nowrap">
                <span aria-hidden>✗</span> missing {u.missing.map((l) => PERM_NAMES[l]).join(' and ')}
              </span>
            </>
          ) : (
            <>
              {' '}
              <span aria-hidden>✓</span>
              <span className="sr-only">, has it</span>
            </>
          )}
        </p>
      ))}
    </div>
  )
}

export interface PermissionTableProps {
  trace: PermissionTrace
  /** The block's Rust, for the row labels (the trace holds only its hash). */
  code: string
  className?: string
}

/** A trace already loaded, drawn as the table. */
export function PermissionTable({ trace, code, className }: PermissionTableProps) {
  const uid = useId()
  const rows = traceTable(trace, code)
  const captionId = `${uid}-caption`
  const rejected = rows.filter((r) => r.rejected).map((r) => r.line)
  return (
    <figure className={cn('rounded-md border border-line bg-surface-1', className)}>
      <figcaption id={captionId} className="border-b border-line px-4 py-2.5">
        <span className="font-mono text-label uppercase text-text-3">Permissions, line by line</span>
        <span className="mt-1 block text-[13px] leading-snug text-text-2">
          R read · W write · O own. <span className="text-accent">+</span> the line gives it, <span className="text-danger">−</span> the line
          takes it away.
          {rejected.length > 0 && <> The compiler rejects line {rejected.join(' and ')}: a use there lacks a permission.</>}
        </span>
        <span className="mt-1 block font-mono text-[11px] text-text-3">
          {trace.source === 'aquascope' ? `from Aquascope (${trace.tool?.toolchain ?? AQUASCOPE_TOOLCHAIN})` : "drawn after Aquascope's model"}
        </span>
      </figcaption>
      {/* `relative` makes the region the sr-only labels' containing block, so they scroll with the table instead of widening the page at 360 px */}
      <div role="region" aria-labelledby={captionId} tabIndex={0} className="relative overflow-x-auto scrollbar-slim focus-visible:-outline-offset-2">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 font-mono text-[11px] font-normal uppercase text-text-3">
                Line
              </th>
              {trace.paths.map((p) => (
                <th key={p} scope="col" className="px-3 py-2 font-mono text-[13px] font-medium text-text-1">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} className={cn('border-b border-line/70 align-top last:border-b-0', r.rejected && 'bg-danger/5')}>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <span className={cn('font-mono text-[12px]', r.rejected ? 'text-danger' : 'text-text-3')}>
                    {r.rejected && <span aria-hidden>✗ </span>}L{r.line}
                    {r.rejected && <span className="sr-only">, rejected</span>}
                  </span>
                  <code title={r.text.trim()} className="block max-w-[20ch] truncate whitespace-pre font-mono text-[12px] text-text-2 sm:max-w-[34ch]">
                    {r.text.trim()}
                  </code>
                </th>
                {r.cells.map((c) => (
                  <td key={c.path} className="px-3 py-2">
                    <CellView cell={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

export interface PermissionDiagramProps {
  lessonId: string
  /** `CodeBlockData.permissions.trace`: the key in the lesson's trace file. */
  traceKey: string
  code: string
  className?: string
}

/** Loads the lesson's trace file and draws one trace. A missing trace draws nothing (the test fails first). */
export default function PermissionDiagram({ lessonId, traceKey, code, className }: PermissionDiagramProps) {
  const [state, setState] = useState<{ lessonId: string; file: PermissionTraceFile | null } | null>(null)
  useEffect(() => {
    let live = true
    void loadTraceFile(lessonId).then((file) => {
      if (live) setState({ lessonId, file })
    })
    return () => {
      live = false
    }
  }, [lessonId])
  if (!state || state.lessonId !== lessonId) {
    return (
      <p role="status" className="mt-3 font-mono text-body-sm text-text-3">
        loading the permission diagram…
      </p>
    )
  }
  const trace = state.file && Object.hasOwn(state.file.traces, traceKey) ? state.file.traces[traceKey] : undefined
  if (!trace) return null
  return <PermissionTable trace={trace} code={code} className={cn('mt-3', className)} />
}
