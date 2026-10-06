/**
 * Markdown-lite prose renderer for lesson blocks, callouts, deep-dives and exercise notes.
 * Split out of blocks.tsx (Wave 1 scaffold B1) so exercise.tsx can import it without a cycle.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { renderInline, slugify } from './markdown'

/* ------------------------------------------------------------------ */
/* markdown-lite block renderer (prose)                                */
/* ------------------------------------------------------------------ */

interface ProseViewProps {
  md: string
  trackColor: string
  /** running H2 count before this block — for the mono index prefix */
  h2Start?: number
  /** compact mode for callouts/deepdives (no H2 treatment) */
  compact?: boolean
}

export function ProseView({ md, trackColor, h2Start = 0, compact = false }: ProseViewProps) {
  const lines = md.replace(/\r/g, '').split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  let key = 0
  let h2 = h2Start

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    // H2 / H3
    if (!compact && (line.startsWith('## ') || line.startsWith('### '))) {
      const isH2 = line.startsWith('## ')
      const text = line.slice(isH2 ? 3 : 4)
      const id = slugify(text)
      if (isH2) {
        h2++
        nodes.push(
          <h2
            key={key++}
            id={id}
            className="group relative mt-12 scroll-mt-24 font-display text-h2 text-text-1 first:mt-0"
          >
            <span className="mr-3 font-mono text-body font-normal" style={{ color: trackColor }}>
              {String(h2).padStart(2, '0')} —
            </span>
            {renderInline(text)}
            <a
              href={`#${id}`}
              aria-label={`Link to ${text}`}
              className="absolute -left-6 top-1/2 hidden -translate-y-1/2 font-mono text-body text-text-3 opacity-0 transition-opacity duration-120 hover:text-accent group-hover:opacity-100 xl:block"
            >
              #
            </a>
          </h2>,
        )
      } else {
        nodes.push(
          <h3 key={key++} id={id} className="mt-8 scroll-mt-24 font-display text-h3 text-text-1">
            {renderInline(text)}
          </h3>,
        )
      }
      i++
      continue
    }

    // tables: consecutive lines starting with |
    if (line.trimStart().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        const raw = lines[i].trim().replace(/^\||\|$/g, '')
        rows.push(raw.split('|').map((c) => c.trim()))
        i++
      }
      const sepIdx = rows.findIndex((r) => r.every((c) => /^:?-{2,}:?$/.test(c)))
      const header = sepIdx > 0 ? rows.slice(0, sepIdx) : [rows[0]]
      const body = sepIdx > 0 ? rows.slice(sepIdx + 1) : rows.slice(1)
      nodes.push(
        <div key={key++} tabIndex={0} role="region" aria-label="table, scrolls sideways" className="my-6 overflow-x-auto rounded-md border border-line scrollbar-slim">
          <table className="w-full border-collapse bg-surface-1 text-body-sm">
            <thead>
              {header.map((r, ri) => (
                <tr key={ri} className="border-b border-line">
                  {r.map((c, ci) => (
                    <th
                      key={ci}
                      className="whitespace-nowrap px-4 py-2.5 text-left font-mono text-label uppercase text-text-3"
                    >
                      {renderInline(c)}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className={cn('border-b border-line/60 last:border-0', ri % 2 === 1 && 'bg-surface-2/40')}>
                  {r.map((c, ci) => (
                    <td key={ci} className="px-4 py-2.5 align-top text-text-2">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // unordered list
    if (/^\s*- /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*- /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*- /, ''))
        i++
      }
      nodes.push(
        <ul key={key++} className="my-5 space-y-2.5">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-3 text-body-lg leading-[1.65] text-text-2">
              <span className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-[1px]" style={{ backgroundColor: trackColor }} />
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // ordered list
    if (/^\s*\d+\. /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\. /, ''))
        i++
      }
      nodes.push(
        <ol key={key++} className="my-5 space-y-2.5">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-3 text-body-lg leading-[1.65] text-text-2">
              <span className="shrink-0 font-mono text-body-sm" style={{ color: trackColor }}>
                {String(ii + 1).padStart(2, '0')}
              </span>
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ol>,
      )
      continue
    }

    // paragraph: consume until blank line / structural start
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('## ') &&
      !lines[i].startsWith('### ') &&
      !lines[i].trimStart().startsWith('|') &&
      !/^\s*- /.test(lines[i]) &&
      !/^\s*\d+\. /.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    nodes.push(
      <p key={key++} className="my-5 max-w-measure text-body-lg leading-[1.65] text-text-2 first:mt-0 last:mb-0">
        {renderInline(para.join(' '))}
      </p>,
    )
  }

  return <>{nodes}</>
}
