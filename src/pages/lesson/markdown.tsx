/**
 * markdown-lite helpers (lesson.md §2) — slug + heading extraction for the
 * ON THIS PAGE rail, and the inline renderer shared by the block components.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ContentBlock, LessonHeading } from '@/data/lessons/types'
import { LESSON_TOKEN_SOURCE, lessonCodeIn, type LabelledLesson } from '@/lib/lesson-label'
import { ClaimToken } from '@/components/ClaimToken'
import { CLAIM_TOKEN_SOURCE } from '@/lib/claim-token-syntax'

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
    let fenced = false
    for (const line of b.md.split('\n')) {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced
        continue
      }
      if (fenced) continue
      if (line.startsWith('## ')) out.push({ id: slugify(line.slice(3)), text: line.slice(3), level: 2 })
      else if (line.startsWith('### ')) out.push({ id: slugify(line.slice(4)), text: line.slice(4), level: 3 })
    }
  }
  return out
}

const INLINE_RE = new RegExp(
  [
    `(${LESSON_TOKEN_SOURCE})`,
    `(${CLAIM_TOKEN_SOURCE})`,
    '(`[^`]+`)',
    '(\\*\\*[^*]+\\*\\*)',
    '(\\*[^*\\n]+\\*)',
    '(\\[[^\\]]+\\]\\([^)\\s]+\\))',
  ].join('|'),
  'g',
)

/** Bold or emphasis text: recurse only when it holds a token, so today's plain runs render exactly as before. */
const HAS_INLINE_TOKEN = /\[\[(?:l|c):/
const inlineInner = (text: string, order?: readonly Pick<LabelledLesson, 'id' | 'trackId'>[]): ReactNode =>
  HAS_INLINE_TOKEN.test(text) ? renderInline(text, order) : text

export function renderInline(text: string, order?: readonly Pick<LabelledLesson, 'id' | 'trackId'>[]): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  // a local copy, so a bold or emphasis run can renderInline its own text without clobbering this loop
  const re = new RegExp(INLINE_RE.source, 'g')
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const [tok, token, claimTok, code, bold, em, link] = m
    if (token) {
      const id = token.slice('[[l:'.length, -']]'.length)
      out.push(
        <Link
          key={key++}
          to={`/lesson/${id}`}
          className="text-info underline decoration-info/40 underline-offset-2 transition-colors duration-150 hover:decoration-info"
        >
          {lessonCodeIn(id, order)}
        </Link>,
      )
    } else if (claimTok) {
      const body = claimTok.slice('[[c:'.length, -']]'.length)
      const [id, mode] = body.split('|')
      out.push(<ClaimToken key={key++} id={id} pin={mode === 'pin'} />)
    } else if (code) {
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
          {inlineInner(bold.slice(2, -2), order)}
        </strong>,
      )
    } else if (em) {
      out.push(
        <em key={key++} className="text-text-1">
          {inlineInner(em.slice(1, -1), order)}
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
