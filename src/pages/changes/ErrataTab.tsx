import { useMemo } from 'react'
import { Link } from 'react-router'
import { ExternalLink } from 'lucide-react'
import type { Erratum } from '@/data/errata/schema'
import { lessonById, lessonPath } from '@/data/lessons'
import { cn } from '@/lib/utils'

// Date-prefixed modules only, so schema.ts (types, no default export) is never picked up.
const modules = import.meta.glob<Erratum>('/src/data/errata/[0-9]*.ts', {
  eager: true,
  import: 'default',
})

const newestFirst = (a: Erratum, b: Erratum) =>
  b.date.localeCompare(a.date) || b.id.localeCompare(a.id)

/** Newest first, except an erratum always lands before the one it supersedes (same-day fixes would otherwise sort by id). */
function supersedingFirst(sorted: Erratum[]): Erratum[] {
  const out: Erratum[] = []
  const placed = new Set<string>()
  const place = (erratum: Erratum) => {
    if (placed.has(erratum.id)) return
    placed.add(erratum.id)
    for (const other of sorted) if (other.supersedes === erratum.id) place(other)
    out.push(erratum)
  }
  sorted.forEach(place)
  return out
}

const ERRATA = supersedingFirst(Object.values(modules).sort(newestFirst))

/** erratum id -> the erratum that replaces it */
const SUPERSEDED_BY = new Map<string, Erratum>()
for (const erratum of ERRATA) if (erratum.supersedes) SUPERSEDED_BY.set(erratum.supersedes, erratum)

interface LessonGroup {
  lessonId: string
  items: Erratum[]
}

/** One group per lesson, groups ordered by their newest erratum; an erratum shows under every lesson it touches. */
function groupByLesson(errata: Erratum[]): LessonGroup[] {
  const groups = new Map<string, Erratum[]>()
  for (const erratum of errata) {
    for (const lessonId of erratum.lessons) {
      groups.set(lessonId, [...(groups.get(lessonId) ?? []), erratum])
    }
  }
  return [...groups.entries()].map(([lessonId, items]) => ({ lessonId, items }))
}

function KindBadge({ kind }: { kind: Erratum['kind'] }) {
  return (
    <span
      className={cn(
        'rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]',
        kind === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-amber/40 bg-amber/10 text-amber',
      )}
    >
      {kind}
    </span>
  )
}

function ErratumCard({ erratum, groupId }: { erratum: Erratum; groupId: string }) {
  const newer = SUPERSEDED_BY.get(erratum.id)
  return (
    <article id={`${groupId}-${erratum.id}`} className="scroll-mt-24 rounded-xl border border-line bg-surface-1 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <KindBadge kind={erratum.kind} />
        <time dateTime={erratum.date} className="font-mono text-[11px] text-text-3">
          {erratum.date}
        </time>
        {newer && (
          <a
            href={`#${groupId}-${newer.id}`}
            className="rounded-sm border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-3 hover:text-text-1"
          >
            superseded by {newer.date} · {newer.title}
          </a>
        )}
      </div>
      <h3 className="mt-3 text-lg font-semibold leading-snug text-text-1">{erratum.title}</h3>
      <dl className="mt-4 space-y-3 text-body leading-relaxed">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">before</dt>
          <dd className="mt-1 text-text-3 line-through decoration-text-3/60">{erratum.before}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">after</dt>
          <dd className="mt-1 text-text-1">{erratum.after}</dd>
        </div>
        {erratum.why && (
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">why</dt>
            <dd className="mt-1 text-text-2">{erratum.why}</dd>
          </div>
        )}
      </dl>
      {erratum.source && (
        <a
          href={erratum.source.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-start gap-1.5 font-mono text-[11px] text-accent hover:underline"
        >
          <span>source · {erratum.source.title}</span>
          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
        </a>
      )}
    </article>
  )
}

export default function ErrataTab() {
  const groups = useMemo(() => groupByLesson(ERRATA), [])

  return (
    <div>
      <p className="max-w-2xl text-body-lg leading-relaxed text-text-2">
        Every correction to a published lesson, newest first, grouped by the lesson it touches. An{' '}
        <KindBadge kind="error" /> means the course was wrong; a <KindBadge kind="changed" /> means the
        field moved and the course caught up.
      </p>

      {groups.length === 0 ? (
        <div className="mt-8 rounded-lg border border-line bg-surface-1 p-8 font-mono text-body-sm text-text-3">
          no errata published yet
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {groups.map(({ lessonId, items }) => {
            const lesson = lessonById(lessonId)
            return (
              <section key={lessonId} aria-labelledby={`errata-${lessonId}`}>
                <h2 id={`errata-${lessonId}`} className="font-mono text-body-sm text-text-2">
                  {lesson ? (
                    <Link to={lessonPath(lesson)} className="text-accent hover:underline">
                      {lessonId.toUpperCase()} · {lesson.title}
                    </Link>
                  ) : (
                    lessonId.toUpperCase()
                  )}
                </h2>
                <div className="mt-4 grid gap-5 lg:grid-cols-2">
                  {items.map((erratum) => (
                    <ErratumCard key={erratum.id} erratum={erratum} groupId={lessonId} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
