import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, BookOpenText, CalendarCheck2, ExternalLink, RefreshCw } from 'lucide-react'
import { lessonById, lessonPath } from '@/data/lessons'
import { loadFieldNotes, type FieldNotesDocument } from '@/lib/field-notes'

export default function FieldNotes() {
  const [document, setDocument] = useState<FieldNotesDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadFieldNotes()
      .then((value) => {
        if (!cancelled) setDocument(value)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const lessonCount = useMemo(
    () => new Set(document?.entries.flatMap((entry) => entry.lessons) ?? []).size,
    [document],
  )

  return (
    <div className="mx-auto max-w-app px-6 pb-24 pt-16 lg:px-12">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            field notes · quarterly review
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-text-1 sm:text-5xl">
            What changed, and which lesson it changes
          </h1>
          <p className="mt-5 max-w-2xl text-body-lg leading-relaxed text-text-2">
            A static, source-linked maintenance log for the fast-moving half of the course. Each
            note records the primary source, affected lessons, and the month a human rechecked the
            claim.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface-1 p-5">
          <div className="flex items-center gap-2 text-accent">
            <CalendarCheck2 className="h-4 w-4" />
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
              {document?.quarter ?? 'loading quarter'}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="font-mono text-2xl text-text-1">{document?.entries.length ?? '—'}</p>
              <p className="mt-1 text-body-sm text-text-3">source notes</p>
            </div>
            <div>
              <p className="font-mono text-2xl text-text-1">{document ? lessonCount : '—'}</p>
              <p className="mt-1 text-body-sm text-text-3">lessons touched</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-y border-line py-4">
        <p className="flex items-center gap-2 font-mono text-[11px] text-text-3">
          <RefreshCw className="h-3.5 w-3.5" /> next scheduled review · 2026-Q4
        </p>
        <p className="font-mono text-[11px] text-text-3">
          feed · <a className="text-accent hover:underline" href="/field-notes.json">/field-notes.json</a>
        </p>
      </div>

      {error && (
        <div className="mt-8 rounded-lg border border-red/40 bg-red/10 p-5 font-mono text-body-sm text-red">
          {error}
        </div>
      )}

      {!document && !error && (
        <div className="mt-8 rounded-lg border border-line bg-surface-1 p-8 font-mono text-body-sm text-text-3">
          loading the static feed…
        </div>
      )}

      {document && (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {document.entries.map((entry, index) => (
            <motion.article
              key={entry.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.04, 0.24) }}
              className="flex flex-col rounded-xl border border-line bg-surface-1 p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                  <BookOpenText className="h-3.5 w-3.5" /> primary source
                </span>
                <span className="font-mono text-[10px] text-text-3">verified {entry.verified}</span>
              </div>
              <h2 className="mt-4 text-xl font-semibold leading-snug text-text-1">{entry.title}</h2>
              <p className="mt-3 grow text-body leading-relaxed text-text-2">{entry.summary}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {entry.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-[10px] text-text-3">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <a
                  href={entry.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent hover:underline"
                >
                  {entry.source} · {entry.published} <ExternalLink className="h-3 w-3" />
                </a>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {entry.lessons.map((id) => {
                    const lesson = lessonById(id)
                    return lesson ? (
                      <Link
                        key={id}
                        to={lessonPath(lesson)}
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-text-2 transition-colors hover:text-text-1"
                      >
                        {id.toUpperCase()} <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : null
                  })}
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </div>
  )
}
