import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import BackgroundPick from '@/pages/me/Background'

/**
 * /me, the Mirror's route (wave-3.md §2.2, §12.5). 3b-06 folded Progress into two lazy sections, so this file holds
 * only the head and imports neither framer-motion nor lesson content; its static closure is what verify:bundle gates
 * at 200 KB. App.tsx routes it with plain `lazy`. Each section that uses framer-motion renders inside its own
 * `MotionScope` (src/pages/me/*), so reduced motion is honoured. 3b-06b added the Mirror above the journey, in the order
 * of §12.5: VRK30, cold checks, calibration with the optimism offset, competence statements (all one lazy section,
 * MirrorSummary, which uses no framer-motion), then the forms' mount, then the optional background pick (3c-05, §11.3:
 * a small static card, shared with Boot), then what 3b-06 moved.
 *
 * The Mirror is as tall as the ledger makes it, so no placeholder height fits an empty ledger and a full one. Instead of
 * reserving one (a fixed min-h-[24rem] was too tall for one and too short for the other, and the content below moved when
 * the Mirror resolved), the page shows the Mirror's one-line loading state and holds the rest back until the Mirror has
 * settled; the three sections below load in the meantime (the dynamic imports start at once), so they appear together
 * with it, and nothing already on screen is pushed down. A Mirror that fails to read the ledger settles too, so the rest
 * of the page is never held back for good.
 */
const MirrorSummary = lazy(() => import('@/pages/me/MirrorSummary'))
const FormsCard = lazy(() => import('@/components/me/FormsCard'))
const Journey = lazy(() => import('@/pages/me/Journey'))
const DataOwnership = lazy(() => import('@/pages/me/DataOwnership'))

/** Holds a section's place while its chunk loads, so the page below it does not jump. */
const SectionFallback = ({ tall }: { tall: string }) => <div aria-hidden className={tall} />

export default function Me() {
  const [mirrorSettled, setMirrorSettled] = useState(false)
  const onMirrorSettled = useCallback(() => setMirrorSettled(true), [])
  // fetch the sections below while the Mirror reads the ledger (the lazy() calls above share these imports' results)
  useEffect(() => {
    void import('@/components/me/FormsCard')
    void import('@/pages/me/Journey')
    void import('@/pages/me/DataOwnership')
  }, [])

  return (
    <div className="bg-grad-radial-glow">
      <section className="mx-auto max-w-app px-6 pb-24 pt-24 lg:px-12">
        <header>
          <p className="section-label">0x06 — process stats</p>
          <h1 className="mt-4 font-display text-display-lg text-text-1">Me</h1>
          <p className="mt-4 max-w-[60ch] text-body text-text-2">
            Everything below lives in this browser: an append-only ledger in IndexedDB. Export it, move it, nuke it — it's yours.
          </p>
        </header>

        <div className="mt-8">
          <Suspense fallback={<SectionFallback tall="h-6" />}>
            <MirrorSummary onSettled={onMirrorSettled} />
          </Suspense>
        </div>

        {mirrorSettled && (
          <>
            <Suspense fallback={null}>
              <FormsCard />
            </Suspense>

            <BackgroundPick />

            <div className="mt-14">
              <Suspense fallback={<SectionFallback tall="min-h-[24rem]" />}>
                <Journey />
              </Suspense>
            </div>
            <Suspense fallback={<SectionFallback tall="mt-14 min-h-[16rem]" />}>
              <DataOwnership />
            </Suspense>

            <div className="mt-16 font-mono text-[11px] text-text-3">
              <Link to="/curriculum" className="hover:text-accent">
                ← back to curriculum
              </Link>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
