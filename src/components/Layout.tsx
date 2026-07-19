import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import StatusBar from '@/components/StatusBar'
import CommandPalette from '@/components/CommandPalette'

/**
 * Shared app shell. Children pattern (react-dev.md routing contract A):
 * App.tsx wraps `<Layout><Routes>…</Routes></Layout>`.
 *
 * - Navbar is `sticky top-0 z-50` (in normal flow) — pages never add nav offsets.
 * - Footer renders on marketing routes only (`/`); app routes keep the StatusBar.
 * - StatusBar is fixed bottom on lg+; content gets matching bottom padding.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const isMarketing = pathname === '/'

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return (
    <div className="min-h-[100dvh] bg-ink lg:pb-10">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-surface-2 focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:text-accent"
      >
        skip to content
      </a>
      <Navbar />
      <main id="main">{children}</main>
      {isMarketing && <Footer />}
      <StatusBar />
      <CommandPalette />
    </div>
  )
}
