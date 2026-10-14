import { useEffect, useRef, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import ErrorEntry, { type PracticeItem } from '@/components/rust/ErrorEntry'
import exhibits from '@/data/rust-items/museum.json'
import { settle } from '@/lib/items/on-demand'
import type { MuseumEntry } from '@/lib/rust/museum'
import { scrollBehavior } from '@/lib/lesson-scroll'
import { isPlainClick, jumpToEntry } from '@/lib/museum-jump'

/**
 * /errors (docs/specs/wave-2.md §15.6): the Error Museum, a view of the compile bank. One entry per error
 * code the bank holds: the smallest case, its permission diagram, the real fix, the `.clone()` that
 * tempts, the R lessons that teach it and compile items to practise on. `/errors#E0502` opens at that entry.
 *
 * The exhibits are their own payload (src/data/rust-items/museum.json, written from the banks by
 * scripts/build-rust-items.ts), so the page loads no group of the bank. "Try an item on <code>" loads the
 * compile family and the one group the drawn item lives in, on the click.
 */

const ENTRIES = exhibits as readonly MuseumEntry[]

/** One practice item on `code`: the family and the group its unit lives in load here, once each. */
async function practiceItem(code: string, seed: number): Promise<PracticeItem | undefined> {
  const family = await import('@/lib/items/families/compile')
  const inst = await settle(() => family.practiceInstance(code, seed))
  return inst ? { inst, gen: family.default } : undefined
}

export default function Errors() {
  const { hash } = useLocation()
  const navigate = useNavigate()
  // The last hash already scrolled to and focused (by a chip click or a deep link), so the effect below does not repeat it.
  const handled = useRef('')

  // A deep link scrolls to its entry once the page has mounted and focuses its heading.
  useEffect(() => {
    if (!hash) handled.current = ''
    if (!hash || handled.current === hash) return
    handled.current = hash
    jumpToEntry(document, decodeURIComponent(hash.slice(1)), 'instant') // a fragment link jumps, as the browser's own would
  }, [hash])

  // A chip is a plain #anchor, which scrolls and leaves focus on body. A click does what a deep link does: it moves focus
  // to the entry's heading, and scrolls smoothly only if the learner has not asked for reduced motion.
  const goTo = (e: MouseEvent<HTMLAnchorElement>, code: string) => {
    if (!isPlainClick(e.nativeEvent)) return
    e.preventDefault()
    handled.current = `#${code}`
    if (hash !== `#${code}`) navigate({ hash: `#${code}` })
    jumpToEntry(document, code, scrollBehavior())
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-page="errors">
      <p className="section-label">0x00 — errors</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">Error Museum</h1>
      <p className="mt-3 text-body-sm text-text-2">
        Each exhibit is an error the Rust compiler reports on serving code, checked by rustc 1.96.0 rather than written from memory. Read every one as a missing permission:
        Read, Write or Own, lost because a move or a borrow took it. The diagram shows which line takes it and which line needed it back. Under each is the fix that keeps
        the program&apos;s behaviour and the <code className="font-mono">.clone()</code> that silences the compiler and changes it.
      </p>

      <nav aria-label="Error codes" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {ENTRIES.map((e) => (
            <li key={e.code}>
              <a href={`#${e.code}`} onClick={(ev) => goTo(ev, e.code)} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 font-mono text-[13px] text-text-1 hover:bg-surface-2">
                {e.code}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-8 space-y-8">
        {ENTRIES.map((e) => (
          <ErrorEntry key={e.code} entry={e} practice={practiceItem} />
        ))}
      </div>

      <p className="mt-10">
        <Link to="/curriculum" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
          Back to the curriculum
        </Link>
      </p>
    </section>
  )
}
