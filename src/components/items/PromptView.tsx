/**
 * PromptView: an item's stem, givens and worked steps (docs/specs/wave-1.md §6.8). Claims render as
 * chips (a tap opens the source), scenario values as plain chips; either way the DOM carries the text.
 * Givens are a definition list. Code scrolls inside its own box, never the page.
 */
import { ClaimValue } from '@/components/ClaimValue'
import { cellText, partText } from '@/lib/items/core'
import { formatNumber } from '@/lib/items/units'
import type { Prompt, PromptPart, SolutionStep } from '@/lib/items/types'
import { cn } from '@/lib/utils'

// Inline chips keep their text height: WCAG 2.5.8 exempts targets inside a sentence, and a 44 px hit area would overlap the neighbouring lines.
const CHIP = 'rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[0.92em] text-text-1'

function Part({ part }: { part: PromptPart }) {
  switch (part.t) {
    case 'text':
      return <>{part.text}</>
    case 'value':
      return <span className={cn(CHIP, 'whitespace-nowrap')}>{partText(part)}</span>
    case 'claim':
      // the chip shows the scaled value and unit the prompt asked for, not the claim's default text
      return <ClaimValue id={part.claim} format={() => partText(part)} className={cn(CHIP, 'whitespace-nowrap text-accent no-underline')} />
    case 'code':
      if (part.lines || part.mark !== undefined) return <NumberedCode code={part.code} mark={part.mark} />
      return part.code.includes('\n') ? (
        <pre className="my-2 max-w-full overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-text-1">
          <code>{part.code}</code>
        </pre>
      ) : (
        <code className={CHIP}>{part.code}</code>
      )
    case 'table':
      return <PromptTable caption={part.caption} columns={part.columns} rows={part.rows} />
  }
}

/** Code with a line-number gutter (the numbers are text, so a screen reader hears them) and one marked line. */
function NumberedCode({ code, mark }: { code: string; mark?: number }) {
  return (
    <pre
      role="region"
      aria-label="Code"
      tabIndex={0}
      className="my-2 max-w-full overflow-x-auto rounded-md border border-line bg-surface-2 py-3 font-mono text-[12px] leading-relaxed text-text-1"
    >
      <code className="block min-w-max">
        {code.split('\n').map((line, i) => {
          const n = i + 1
          const marked = n === mark
          return (
            <span key={i} className={cn('flex px-3', marked && 'border-l-2 border-accent bg-accent/10 pl-[10px]')} data-line={n} data-marked={marked ? '' : undefined}>
              <span className="w-7 shrink-0 select-none pr-3 text-right text-text-3">{n}</span>
              <span className="whitespace-pre">{line === '' ? ' ' : line}</span>
              {marked && <span className="sr-only"> (marked line)</span>}
            </span>
          )
        })}
      </code>
    </pre>
  )
}

/** A real table with a caption. It scrolls inside its own box at phone width, and the box takes focus so a keyboard can scroll it. */
function PromptTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="my-2 max-w-full overflow-x-auto rounded-md border border-line focus-visible:outline-2 focus-visible:outline-accent">
      <table className="w-full border-collapse text-left text-body-sm">
        <caption className="border-b border-line bg-surface-2 px-3 py-1.5 text-left font-mono text-[11px] uppercase text-text-3">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((c, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] font-medium text-text-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-b-0">
              {r.map((cell, j) => (
                <td key={j} className={cn('whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-text-1', typeof cell === 'number' && 'text-right')}>
                  {cellText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Parts({ parts }: { parts: readonly PromptPart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Part key={i} part={p} />
      ))}
    </>
  )
}

interface StepListProps {
  steps: readonly SolutionStep[]
  /** Show a blank step's result. Before the answer, a blank step is a gap the learner fills. */
  reveal: boolean
  label: string
  className?: string
}

/** Worked or solution steps, numbered. A `blank` step hides its result until `reveal`. */
export function StepList({ steps, reveal, label, className }: StepListProps) {
  return (
    <ol aria-label={label} className={cn('space-y-2', className)}>
      {steps.map((s, i) => {
        const gap = s.blank && !reveal
        return (
          <li key={i} className="flex min-w-0 gap-2.5 text-body-sm text-text-2">
            <span className="mt-0.5 shrink-0 font-mono text-[11px] text-text-3">{String(i + 1).padStart(2, '0')}</span>
            <span className="min-w-0 break-words">
              <Parts parts={s.text} />
              {s.result && (
                <>
                  {' = '}
                  {gap ? (
                    <span className="inline-block min-w-12 rounded border border-dashed border-line-bright px-1.5 text-center font-mono text-text-3">
                      ?<span className="sr-only"> blank step: your answer goes in the answer field</span>
                    </span>
                  ) : (
                    <span className={cn(CHIP, 'whitespace-nowrap')}>
                      {formatNumber(s.result.value)}
                      {s.result.unit ? ` ${s.result.unit}` : ''}
                    </span>
                  )}
                </>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

interface PromptViewProps {
  prompt: Prompt
  /** After the answer, blank worked steps show their results. */
  revealed?: boolean
  className?: string
}

export default function PromptView({ prompt, revealed = false, className }: PromptViewProps) {
  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      <div className="min-w-0 break-words text-body-sm leading-relaxed text-text-1">
        <Parts parts={prompt.stem} />
      </div>
      {prompt.givens && prompt.givens.length > 0 && (
        <dl className="space-y-1 rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm">
          {prompt.givens.map((g, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-text-3">{g.label}</dt>
              <dd className="min-w-0 break-words text-text-1">
                <Part part={g.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {prompt.worked && prompt.worked.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase text-text-3">Worked so far</p>
          <StepList steps={prompt.worked} reveal={revealed} label="Worked steps" />
        </div>
      )}
    </div>
  )
}
