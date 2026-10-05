/**
 * The Make step's stage list for lab 01 (docs/specs/wave-1.md §13.1): four stages, each with its checks, going
 * green in order. It sits above the drop zone and reads what the last graded run passed. It writes nothing; the
 * page records the `lab-check` event, with `greenStage(rows)` as its `stage`.
 */

import { Check, Circle } from 'lucide-react'
import { clsx as cn } from 'clsx'
import { renderInline } from '@/pages/lesson/markdown'
import type { ForgeLabCheck } from '@/data/labs'
import { attemptsToGreen, currentStage, stageRows, STAGES } from '@/data/forge/rust-allocator/primm'

export interface StagePanelProps {
  checks: readonly ForgeLabCheck[]
  /** Ids of the required checks that the latest run passed. */
  passed: ReadonlySet<string>
  /** Passed check ids of every lab run so far, oldest first: feeds the attempts-to-green counts. Optional. */
  runs?: readonly (readonly string[])[]
}

export function StagePanel({ checks, passed, runs }: StagePanelProps) {
  const rows = stageRows(checks, passed)
  const now = currentStage(rows)
  const attempts = runs === undefined ? undefined : attemptsToGreen(runs, checks)
  const greenCount = rows.filter((r) => r.green).length

  return (
    <section aria-label="Build stages" data-stage-panel data-green-stages={greenCount}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-label uppercase tracking-[0.10em] text-text-3">Build in four stages</h3>
        <span className="font-mono text-[10px] text-text-3">
          {greenCount}/{STAGES.length} green
        </span>
      </div>
      <ol className="space-y-2">
        {rows.map((row, i) => {
          const isNow = now?.n === row.stage.n
          const tries = attempts?.[i]
          return (
            <li
              key={row.stage.n}
              data-stage={row.stage.n}
              data-green={row.green}
              aria-current={isNow ? 'step' : undefined}
              className={cn(
                'rounded-sm border px-3 py-2.5',
                row.green ? 'border-accent/40 bg-accent-dim/30' : isNow ? 'border-line-bright bg-surface-3' : 'border-line bg-surface-2',
              )}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    row.green ? 'border-accent bg-accent text-accent-foreground' : 'border-line-bright',
                  )}
                  aria-hidden
                >
                  {row.green && <Check size={10} strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-medium leading-snug text-text-1">
                    Stage {row.stage.n} &middot; {row.stage.title}
                    <span className="ml-2 font-mono text-[10px] font-normal text-text-3">&asymp; {row.stage.minutes} min</span>
                    <span className="sr-only">{row.green ? ' (green)' : isNow ? ' (next)' : ' (not yet)'}</span>
                  </p>
                  <p className="mt-0.5 text-body-sm leading-snug text-text-2">{renderInline(row.stage.goal)}</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Stage ${row.stage.n} checks`}>
                    {row.checks.map((c) => (
                      <li
                        key={c.id}
                        data-check={c.id}
                        data-passed={c.passed}
                        title={c.label}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 font-mono text-[10px]',
                          c.passed ? 'border-accent/40 text-accent' : 'border-line text-text-3',
                        )}
                      >
                        {c.passed ? <Check size={9} strokeWidth={3} aria-hidden /> : <Circle size={8} aria-hidden />}
                        {c.id}
                        <span className="sr-only">{c.passed ? ' passed' : ' not yet'}</span>
                      </li>
                    ))}
                  </ul>
                  {isNow && (
                    <p className="mt-1.5 font-mono text-[10px] text-text-3">
                      On your machine: <code>cargo test {row.checks[0]?.id ?? ''}</code>, then drop the .wasm here.
                    </p>
                  )}
                  {tries !== undefined && tries !== null && row.green && (
                    <p className="mt-1 font-mono text-[10px] text-text-3" data-attempts>
                      {tries === 0 ? 'green with the stage before' : `${tries} ${tries === 1 ? 'run' : 'runs'} to green`}
                    </p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
