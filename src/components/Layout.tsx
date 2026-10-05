import { Suspense, lazy, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import StatusBar from '@/components/StatusBar'
import BottomTabs from '@/components/BottomTabs'
import CommandPaletteHost from '@/components/CommandPaletteHost'
import { useProgress } from '@/lib/progress'

// Only fetched when the ledger has something to say (read-only tab, memory backend, cleared storage).
const LedgerNotices = lazy(() => import('@/components/ledger/LedgerNotices'))

const SCROLL_PADDING =
  ':root{scroll-padding-bottom:calc(3.5rem + env(safe-area-inset-bottom))}@media (min-width:1024px){:root{scroll-padding-bottom:2.5rem}}'

/**
 * Shared app shell. Children pattern (react-dev.md routing contract A):
 * App.tsx wraps `<Layout><Routes>…</Routes></Layout>`.
 *
 * - Navbar is `sticky top-0 z-50` (in normal flow) — pages never add nav offsets.
 * - Footer renders on marketing routes only (`/`); app routes keep the StatusBar.
 * - StatusBar is fixed bottom on lg+ and the BottomTabs bar below lg; content gets matching bottom padding and
 *   `scroll-padding-bottom` for both bars, so focus is never scrolled under them (WCAG 2.4.11).
 */
export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const isMarketing = pathname === '/'
  const hasNotice = useProgress(
    (s) => s.ledger.readOnly || s.ledger.backend === 'memory' || s.ledger.cleared !== undefined,
  )

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return (
    <div className="min-h-[100dvh] bg-ink pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-10">
      <style>{SCROLL_PADDING}</style>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-surface-2 focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:text-accent"
      >
        skip to content
      </a>
      <Navbar />
      {hasNotice && (
        <Suspense fallback={null}>
          <LedgerNotices />
        </Suspense>
      )}
      <main id="main">{children}</main>
      {isMarketing && <Footer />}
      <StatusBar />
      <BottomTabs />
      <CommandPaletteHost />
    </div>
  )
}
