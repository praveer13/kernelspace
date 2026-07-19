import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Lightweight tokenizer (design.md §6: "sim editors use lightweight    */
/* tokenizer") — comments, strings, numbers, keywords.                  */
/* ------------------------------------------------------------------ */

const KEYWORDS: Record<string, string[]> = {
  python: ['def', 'return', 'for', 'in', 'import', 'from', 'as', 'if', 'else', 'elif', 'while', 'class', 'None', 'True', 'False', 'with', 'lambda', 'pass', 'range', 'len', 'print', 'assert', 'not', 'and', 'or'],
  java: ['public', 'private', 'static', 'final', 'class', 'void', 'int', 'long', 'double', 'float', 'boolean', 'new', 'return', 'for', 'while', 'if', 'else', 'import', 'package', 'extends', 'implements', 'this', 'var', 'true', 'false', 'null'],
  c: ['int', 'long', 'char', 'void', 'float', 'double', 'size_t', 'uint32_t', 'uint64_t', 'int32_t', 'int64_t', 'struct', 'typedef', 'return', 'for', 'while', 'if', 'else', 'const', 'static', 'unsigned', 'signed', 'include', 'define', 'sizeof', 'NULL', 'malloc', 'free', 'restrict', 'register', 'volatile'],
  rust: ['fn', 'let', 'mut', 'pub', 'impl', 'struct', 'enum', 'match', 'for', 'in', 'while', 'loop', 'if', 'else', 'return', 'use', 'mod', 'crate', 'self', 'Self', 'where', 'trait', 'const', 'static', 'ref', 'move', 'unsafe', 'async', 'await', 'true', 'false', 'Some', 'None', 'Ok', 'Err', 'Vec', 'i32', 'i64', 'u32', 'u64', 'usize', 'f32', 'f64'],
  cuda: ['__global__', '__device__', '__shared__', 'int', 'float', 'double', 'void', 'const', 'if', 'else', 'for', 'while', 'return', 'blockIdx', 'threadIdx', 'blockDim', 'gridDim', 'size_t'],
}

type TokenType = 'comment' | 'string' | 'number' | 'keyword' | 'plain'

const TOKEN_COLORS: Record<TokenType, string> = {
  comment: 'text-text-3 italic',
  string: 'text-amber',
  number: 'text-accent',
  keyword: 'text-info',
  plain: 'text-text-2',
}

function tokenizeLine(line: string, lang: string): ReactNode[] {
  const kws = KEYWORDS[lang] ?? KEYWORDS.c ?? []
  const kwSet = new Set(kws)
  const re =
    /(\/\/.*$|#.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b0x[0-9a-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      out.push(
        <span key={key++} className={TOKEN_COLORS.plain}>
          {line.slice(last, m.index)}
        </span>,
      )
    }
    const [tok, comment, str, num, word] = m
    let type: TokenType = 'plain'
    if (comment) type = 'comment'
    else if (str) type = 'string'
    else if (num) type = 'number'
    else if (word && kwSet.has(word)) type = 'keyword'
    out.push(
      <span key={key++} className={TOKEN_COLORS[type]}>
        {tok}
      </span>,
    )
    last = m.index + tok.length
  }
  if (last < line.length) {
    out.push(
      <span key={key++} className={TOKEN_COLORS.plain}>
        {line.slice(last)}
      </span>,
    )
  }
  return out
}

/* ------------------------------------------------------------------ */

export interface CodeTab {
  label: string
  code: string
  lang: string
  /** Annotation chip shown next to the tab label, e.g. `no GC · pointer arithmetic` */
  chip?: string
}

interface CodeBlockProps {
  filename?: string
  /** Compare tabs (design.md §9.8) — when omitted, `code` + `lang` render directly. */
  tabs?: CodeTab[]
  code?: string
  lang?: string
  highlightLines?: number[]
  className?: string
  /** Self-demo mode: auto-advance tabs on an interval (pauses on hover/focus). */
  autoAdvanceMs?: number
}

/**
 * CodeBlock with Language Compare Tabs (design.md §9.8) — signature component.
 * Header: mono filename left, copy button + line count right. Tab switches
 * cross-fade 150ms with a layoutId underline. Highlighted lines get an
 * accent-dim wash + 2px accent left bar. Max height 480px, internal scroll.
 */
export default function CodeBlock({
  filename,
  tabs,
  code,
  lang = 'c',
  highlightLines = [],
  className,
  autoAdvanceMs,
}: CodeBlockProps) {
  const resolvedTabs: CodeTab[] = useMemo(
    () => tabs ?? [{ label: lang, code: code ?? '', lang }],
    [tabs, code, lang],
  )
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef<number | null>(null)

  const tab = resolvedTabs[Math.min(active, resolvedTabs.length - 1)]
  const lines = useMemo(() => tab.code.replace(/\n$/, '').split('\n'), [tab.code])
  const highlight = useMemo(() => new Set(highlightLines), [highlightLines])

  // Self-demo auto-advance (home.md §8) — pauses on hover/focus.
  useEffect(() => {
    if (!autoAdvanceMs || resolvedTabs.length < 2 || paused) return
    timerRef.current = window.setInterval(
      () => setActive((a) => (a + 1) % resolvedTabs.length),
      autoAdvanceMs,
    )
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [autoAdvanceMs, paused, resolvedTabs.length])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tab.code)
    } catch {
      // clipboard unavailable (permissions) — still show feedback
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div
      className={cn('overflow-hidden rounded-md border border-line bg-surface-2', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="truncate font-mono text-xs text-text-3">{filename ?? 'snippet'}</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-text-3">{lines.length} lines</span>
          <button
            type="button"
            onClick={copy}
            className="relative flex items-center gap-1.5 font-mono text-[11px] text-text-3 transition-colors duration-150 hover:text-text-1"
            aria-label="Copy code"
          >
            {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
            <AnimatePresence>
              {copied && (
                <motion.span
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute -bottom-6 right-0 rounded border border-line bg-surface-1 px-1.5 py-0.5 text-[10px] text-accent"
                >
                  copied
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* Compare tabs */}
      {resolvedTabs.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 pt-1">
          {resolvedTabs.map((t, i) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                'relative whitespace-nowrap rounded-t px-3 py-2 font-mono text-xs transition-colors duration-150',
                i === active ? 'text-text-1' : 'text-text-3 hover:text-text-2',
              )}
            >
              {t.label}
              {t.chip && i === active && (
                <span className="ml-2 rounded-full border border-line-bright bg-surface-1 px-2 py-0.5 text-[10px] text-text-3">
                  {t.chip}
                </span>
              )}
              {i === active && (
                <motion.span
                  layoutId={`codeblock-tab-${filename ?? 'default'}`}
                  className="absolute inset-x-2 bottom-0 h-[2px] bg-accent"
                  transition={{ duration: 0.15 }}
                />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Code */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab.label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="max-h-[480px] overflow-auto scrollbar-slim"
        >
          <pre className="min-w-max px-0 py-3 font-mono text-code">
            {lines.map((line, i) => {
              const n = i + 1
              const hl = highlight.has(n)
              return (
                <div
                  key={n}
                  className={cn(
                    'flex border-l-2',
                    hl ? 'border-accent bg-accent-dim/60' : 'border-transparent',
                  )}
                >
                  <span className="w-10 shrink-0 select-none pr-3 text-right text-xs leading-[1.65] text-text-3">
                    {n}
                  </span>
                  <code className="pr-4">{line ? tokenizeLine(line, tab.lang) : '\u00A0'}</code>
                </div>
              )
            })}
          </pre>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
