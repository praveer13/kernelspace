/* eslint-disable react-refresh/only-export-components -- the ledger write for a practised item is exported
   beside the component so the test records exactly what the museum plays */
/**
 * ErrorEntry: one exhibit of the Error Museum (docs/specs/wave-2.md §15.6). For one error code the bank
 * holds: the smallest confirmed snippet with the line rustc rejects marked, the permission diagram drawn
 * from src/data/aquascope/errors.json, the real fix, the `.clone()` that tempts and what it does, the R
 * lessons that teach the code, and "practice this error" (compile items whose key is the code).
 *
 * Text first, colour second: the diff marks are words for a screen reader, the missing permission is
 * named in a sentence, and the snippet scrolls inside its own focusable region at 360 px. Practising
 * plays the shared ItemCard on an item from `practiceInstance` and writes each answer to the ledger as
 * a generated-item response (`src: 'practice'`); a code the bank has no unit for shows no practice.
 */
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import ItemCard from '@/components/items/ItemCard'
import { PermissionTable } from '@/components/lesson/PermissionDiagram'
import errorsFile from '@/data/aquascope/errors.json'
import type { PermissionTrace, PermissionTraceFile } from '@/data/aquascope/types'
import type { Permission } from '@/data/rust-items/types'
import type { ItemResult } from '@/lib/items/play'
import type { Gen, Instance } from '@/lib/items/types'
import type { ItemResponse } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'
import { LESSON_TITLES, type MuseumEntry, type MuseumFix } from '@/lib/rust/museum'
import { cn } from '@/lib/utils'

const TRACES = (errorsFile as unknown as PermissionTraceFile).traces

/** The committed trace of an error code, when there is one. */
export const traceFor = (code: string): PermissionTrace | undefined => (Object.hasOwn(TRACES, code) ? TRACES[code] : undefined)

/** A trace that draws no row: no line changes a permission and no use needs one. */
export const traceIsEmpty = (t: PermissionTrace): boolean => t.changes.length === 0 && t.uses.length === 0

/** Some use in the trace needs a permission the path lacks there: the diagram marks a rejected line. */
export const traceRejects = (t: PermissionTrace): boolean => t.uses.some((u) => [...u.needs].some((l) => !u.has.includes(l)))

const PERMISSION_NAME: Record<Permission, string> = { read: 'Read (R)', write: 'Write (W)', own: 'Own (O)' }

const KIND_LABEL: Record<MuseumEntry['cluster'], string> = { moves: 'moves', borrows: 'borrows', lifetimes: 'lifetimes', cells: 'cells' }

const MAX_KCS = 6

/** The ledger event for one answered practice item (a generated item, `src: 'practice'`, practice credit). */
export function practiceResponse(r: ItemResult): ItemResponse {
  return {
    kind: 'item',
    ref: r.ref as ItemResponse['ref'],
    rev: r.rev,
    score: r.score,
    ok: r.ok,
    ...(r.conf ? { conf: r.conf } : {}),
    seed: r.seed,
    ms: r.ms,
    provenance: 'practice',
    data: {
      src: 'practice',
      kcs: r.kcs.slice(0, MAX_KCS),
      nsec: r.nsec,
      ...(r.level === undefined ? {} : { level: r.level }),
      ...(r.variant === undefined ? {} : { variant: r.variant }),
      ...(r.response.kind === 'choice' ? { picks: r.response.picks } : {}),
      ...(r.grade.diagnosis ? { miss: r.grade.diagnosis.id } : {}),
    },
  }
}

/* ------------------------------ pieces ------------------------------ */

/** The bank writes inline code in backticks: draw each span as `<code>`, the rest as text. */
function Ticks({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="font-mono text-[13px] text-text-1">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

/** Code with a line-number gutter and one marked line, in a focusable region that scrolls sideways. */
function NumberedCode({ code, mark, label }: { code: string; mark?: number; label: string }) {
  return (
    <pre
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-md border border-line bg-surface-2 py-3 font-mono text-[12px] leading-relaxed text-text-1"
    >
      <code className="block min-w-max">
        {code.split('\n').map((line, i) => {
          const n = i + 1
          const marked = n === mark
          return (
            <span key={i} className={cn('flex px-3', marked && 'border-l-2 border-danger bg-danger/10 pl-[10px]')} data-line={n} data-marked={marked ? '' : undefined}>
              <span className="w-7 shrink-0 select-none pr-3 text-right text-text-3">{n}</span>
              <span className="whitespace-pre">{line === '' ? ' ' : line}</span>
              {marked && <span className="sr-only"> (the line rustc reports)</span>}
            </span>
          )
        })}
      </code>
    </pre>
  )
}

/** One edit as a two-line diff: the line it removes and the line it puts in. Marks are words for a screen reader. */
function Diff({ source, fix }: { source: string; fix: Pick<MuseumFix, 'line' | 'text'> }) {
  const before = source.split('\n')[fix.line - 1] ?? ''
  return (
    <pre
      role="region"
      aria-label={`Edit to line ${fix.line}`}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-md border border-line bg-surface-2 py-2 font-mono text-[12px] leading-relaxed"
    >
      <code className="block min-w-max">
        <span className="flex px-3 text-danger line-through decoration-1">
          <span aria-hidden className="w-7 shrink-0 select-none pr-3 text-right">
            {fix.line}
          </span>
          <span className="sr-only">line {fix.line} removed: </span>
          <span className="whitespace-pre">{before}</span>
        </span>
        <span className="flex px-3 text-accent">
          <span aria-hidden className="w-7 shrink-0 select-none pr-3 text-right">
            {fix.line}
          </span>
          <span className="sr-only">line {fix.line} added: </span>
          <span className="whitespace-pre">{fix.text}</span>
        </span>
      </code>
    </pre>
  )
}

/** What the bank recorded after a wrong fix, as a clause. */
function afterClause(f: MuseumFix & { compiles: boolean }): string {
  return f.compiles ? 'rustc accepts it, but it changes what the code does.' : `It does not fix it: the code still fails with ${f.after}.`
}

/* ------------------------------ the entry ------------------------------ */

export interface ErrorEntryProps {
  entry: MuseumEntry
  /** The compile family's item for one code and seed (`practiceInstance`), and the family itself for its checker. */
  practice?: (code: string, seed: number) => Instance | undefined
  gen?: Gen
  /** Pinned practice seed (tests); a fresh one per item otherwise. */
  seed?: number
}

export default function ErrorEntry({ entry, practice, gen, seed: seedProp }: ErrorEntryProps) {
  const uid = useId()
  const recordItems = useProgress((s) => s.recordItems)
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState(() => seedProp ?? freshSeed())
  const trace = traceFor(entry.code)
  const inst = open && practice ? practice(entry.code, seed) : undefined
  const canPractice = useMemo(() => Boolean(practice?.(entry.code, 0)), [practice, entry.code])
  const head = `${uid}-h`
  const ids = { code: `${uid}-code`, diagram: `${uid}-diagram`, fix: `${uid}-fix`, wrong: `${uid}-wrong`, lessons: `${uid}-lessons`, practice: `${uid}-practice` }
  const missing = entry.permission && entry.focus
  return (
    <article id={entry.code} aria-labelledby={head} data-error-code={entry.code} className="scroll-mt-20 rounded-md border border-line bg-surface-1 p-4 sm:p-6">
      <header>
        <p className="font-mono text-label uppercase text-text-3">
          {entry.panic ? 'run-time panic' : 'compile error'} · {KIND_LABEL[entry.cluster]} · {entry.snippets} snippets in the bank
        </p>
        <h2 id={head} tabIndex={-1} className="mt-1 font-mono text-h4 text-text-1 focus-visible:outline-none">
          {entry.code}
        </h2>
        <p className="mt-1 text-body-sm text-text-2">{entry.means.charAt(0).toUpperCase() + entry.means.slice(1)}.</p>
      </header>

      <section aria-labelledby={ids.code} className="mt-5">
        <h3 id={ids.code} className="font-display text-body font-semibold text-text-1">
          The smallest case
        </h3>
        <p className="mt-1 text-body-sm text-text-2">
          {entry.title} ({entry.domain}). {entry.panic ? 'Run it' : 'Compile it'} and line {entry.line} fails: <span className="font-mono text-[13px]">{entry.message}</span>
        </p>
        <div className="mt-2">
          <NumberedCode code={entry.source} mark={entry.line} label={`${entry.code} example code`} />
        </div>
        <p className="mt-2 text-body-sm text-text-2">
          <Ticks text={entry.why} />
          {missing && (
            <>
              {' '}
              <strong className="font-medium text-text-1">
                Line {entry.focus!.line} needs {entry.focus!.needs.map((n) => PERMISSION_NAME[n]).join(' and ')} of <code className="font-mono">{entry.focus!.path}</code> and the path has lost{' '}
                {PERMISSION_NAME[entry.permission!]}.
              </strong>
            </>
          )}
        </p>
      </section>

      <section aria-labelledby={ids.diagram} className="mt-5">
        <h3 id={ids.diagram} className="font-display text-body font-semibold text-text-1">
          The permission diagram
        </h3>
        {trace && !traceIsEmpty(trace) ? (
          <>
            <PermissionTable trace={trace} code={entry.source} className="mt-2" />
            {missing && !traceRejects(trace) && (
              <p className="mt-2 text-body-sm text-text-2">
                Aquascope does not mark line {entry.focus!.line} as rejected in this diagram: it reports only some uses of a path. The sentence above is the bank&apos;s reading of
                the same model, and rustc&apos;s error is the check.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-body-sm text-text-2">
            {trace
              ? 'No line of this program changes a permission: rustc rejects it before the borrow checker runs, so there is nothing to draw.'
              : 'No diagram is committed for this code yet.'}
          </p>
        )}
      </section>

      <section aria-labelledby={ids.fix} className="mt-5">
        <h3 id={ids.fix} className="font-display text-body font-semibold text-text-1">
          The real fix
        </h3>
        <div className="mt-2">
          <Diff source={entry.source} fix={entry.fix} />
        </div>
        <p className="mt-2 text-body-sm text-text-2">
          <Ticks text={entry.fix.why} />
        </p>
      </section>

      {entry.wrong && (
        <section aria-labelledby={ids.wrong} className="mt-5">
          <h3 id={ids.wrong} className="font-display text-body font-semibold text-text-1">
            {entry.wrong.clone ? 'The fix that tempts: .clone()' : 'The fix that tempts'}
          </h3>
          <div className="mt-2">
            <Diff source={entry.source} fix={entry.wrong} />
          </div>
          <p className="mt-2 text-body-sm text-text-2">
            {afterClause(entry.wrong)} <Ticks text={entry.wrong.why} />
          </p>
        </section>
      )}

      <section aria-labelledby={ids.lessons} className="mt-5">
        <h3 id={ids.lessons} className="font-display text-body font-semibold text-text-1">
          Taught in
        </h3>
        <ul className="mt-1 flex flex-wrap gap-x-4">
          {entry.lessons.map((id) => (
            <li key={id}>
              <Link to={`/lesson/${id}`} className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
                {id.toUpperCase().replace('.L', '')} {LESSON_TITLES[id] ?? id}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {canPractice && (
        <section aria-labelledby={ids.practice} className="mt-5">
          <h3 id={ids.practice} className="font-display text-body font-semibold text-text-1">
            Practice this error
          </h3>
          {!open ? (
            <button
              type="button"
              aria-expanded={false}
              aria-controls={`${ids.practice}-card`}
              onClick={() => setOpen(true)}
              className="mt-2 min-h-11 rounded-md border border-line px-4 font-display text-[15px] font-semibold text-text-1 hover:bg-surface-2"
            >
              Try an item on {entry.code}
            </button>
          ) : (
            <div id={`${ids.practice}-card`} className="mt-2">
              {inst ? (
                <ItemCard
                  key={`${inst.rev}:${seed}`}
                  item={{ source: 'gen', inst }}
                  gen={gen}
                  seed={seed}
                  autoFocus
                  onResult={(r) => recordItems([practiceResponse(r)])}
                  onNext={() => setSeed(freshSeed())}
                  nextLabel="Another item"
                  eyebrow={`practice · ${entry.code}`}
                />
              ) : (
                <p role="status" className="text-body-sm text-text-3">
                  No item for {entry.code} yet.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </article>
  )
}
