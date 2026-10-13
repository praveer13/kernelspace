import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import ErrorEntry from '@/components/rust/ErrorEntry'
import { museumEntries } from '@/lib/rust/museum'
import type { Gen, Instance } from '@/lib/items/types'
import type { Unit } from '@/lib/items/families/compile'

/**
 * /errors (docs/specs/wave-2.md §15.6): the Error Museum, a view of the compile bank. One entry per error
 * code the bank holds: the smallest case, its permission diagram, the real fix, the `.clone()` that
 * tempts, the R lessons that teach it and compile items to practise on. The bank loads on demand with the
 * compile family, so no other page downloads it. `/errors#E0502` opens at that entry.
 */

interface Museum {
  units: readonly Unit[]
  practice: (code: string, seed: number) => Instance | undefined
  gen: Gen
}

async function loadMuseum(): Promise<Museum> {
  const m = await import('@/lib/items/families/compile')
  return { units: m.UNITS, practice: m.practiceInstance, gen: m.default }
}

export default function Errors() {
  const [museum, setMuseum] = useState<Museum | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { hash } = useLocation()

  useEffect(() => {
    let live = true
    loadMuseum().then(
      (m) => {
        if (live) {
          setMuseum(m)
          setFailed(false)
        }
      },
      () => {
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [attempt])

  const entries = useMemo(() => (museum ? museumEntries(museum.units) : []), [museum])

  // The entries mount after the bank loads, so a deep link scrolls to its entry then.
  const ready = entries.length > 0
  useEffect(() => {
    if (!ready || !hash) return
    const el = document.getElementById(decodeURIComponent(hash.slice(1)))
    if (!el) return
    el.scrollIntoView({ behavior: 'instant' }) // a fragment link jumps, as the browser's own would
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
  }, [ready, hash])

  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-page="errors">
      <p className="section-label">0x00 — errors</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">Error Museum</h1>
      <p className="mt-3 text-body-sm text-text-2">
        Each exhibit is an error the Rust compiler reports on serving code, checked by rustc 1.96.0 rather than written from memory. Read every one as a missing permission:
        Read, Write or Own, lost because a move or a borrow took it. The diagram shows which line takes it and which line needed it back. Under each is the fix that keeps
        the program&apos;s behaviour and the <code className="font-mono">.clone()</code> that silences the compiler and changes it.
      </p>

      {failed && (
        <p role="alert" className="mt-8 text-body-sm text-text-2">
          The museum could not load.{' '}
          <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {!museum && !failed && (
        <p role="status" className="mt-8 font-mono text-body-sm text-text-3">
          loading the museum…
        </p>
      )}

      {ready && (
        <>
          <nav aria-label="Error codes" className="mt-6">
            <ul className="flex flex-wrap gap-2">
              {entries.map((e) => (
                <li key={e.code}>
                  <a href={`#${e.code}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 font-mono text-[13px] text-text-1 hover:bg-surface-2">
                    {e.code}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-8 space-y-8">
            {museum && entries.map((e) => <ErrorEntry key={e.code} entry={e} practice={museum.practice} gen={museum.gen} />)}
          </div>
        </>
      )}

      <p className="mt-10">
        <Link to="/curriculum" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
          Back to the curriculum
        </Link>
      </p>
    </section>
  )
}
