/**
 * markdown-lite helpers (lesson.md §2) — slug + heading extraction for the
 * ON THIS PAGE rail, and the inline renderer shared by the block components.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ContentBlock, LessonHeading } from '@/data/lessons/types'

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Collect H2/H3 headings from top-level prose blocks for scroll-spy. */
export function extractHeadings(blocks: ContentBlock[]): LessonHeading[] {
  const out: LessonHeading[] = []
  for (const b of blocks) {
    if (b.type !== 'prose') continue
    for (const line of b.md.split('\n')) {
      if (line.startsWith('## ')) out.push({ id: slugify(line.slice(3)), text: line.slice(3), level: 2 })
      else if (line.startsWith('### ')) out.push({ id: slugify(line.slice(4)), text: line.slice(4), level: 3 })
    }
  }
  return out
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const [tok, code, bold, em, link] = m
    if (code) {
      out.push(
        <code
          key={key++}
          className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[0.9em] text-text-1"
        >
          {code.slice(1, -1)}
        </code>,
      )
    } else if (bold) {
      out.push(
        <strong key={key++} className="font-semibold text-text-1">
          {bold.slice(2, -2)}
        </strong>,
      )
    } else if (em) {
      out.push(
        <em key={key++} className="text-text-1">
          {em.slice(1, -1)}
        </em>,
      )
    } else if (link) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(link)
      if (lm) {
        const [, label, href] = lm
        const internal = href.startsWith('/')
        out.push(
          internal ? (
            <Link
              key={key++}
              to={href}
              className="text-info underline decoration-info/40 underline-offset-2 transition-colors duration-150 hover:decoration-info"
            >
              {label}
            </Link>
          ) : (
            <a
              key={key++}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-info underline decoration-info/40 underline-offset-2 transition-colors duration-150 hover:decoration-info"
            >
              {label}
            </a>
          ),
        )
      }
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Count H2 headings inside one prose md string (for index numbering). */
export function countH2(md: string): number {
  return md.split('\n').filter((l) => l.startsWith('## ')).length
}
