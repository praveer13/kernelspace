import { Suspense, lazy } from 'react'
import type { ComponentType } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router'
import ErrorBoundary from '@/components/ErrorBoundary'
import Layout from '@/components/Layout'
import RouteFallback from '@/components/RouteFallback'

/**
 * A lazy page that (transitively) imports framer-motion. It loads `MotionScope` beside the page
 * and renders inside it, so reduced motion is honoured (PLAN-100X §7.3) without the entry chunk
 * ever importing framer-motion. Boot, Today, Daily, Errors, Play, NotFound and Me stay on plain `lazy`.
 */
function lazyMotion(load: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    const [{ default: Page }, { MotionScope }] = await Promise.all([load(), import('@/lib/motion')])
    return {
      default: () => (
        <MotionScope>
          <Page />
        </MotionScope>
      ),
    }
  })
}

// Every page is its own chunk so the entry chunk holds only the shell (PLAN-100X §7.3).
const Home = lazyMotion(() => import('@/pages/Home'))
const Curriculum = lazyMotion(() => import('@/pages/Curriculum'))
const Track = lazyMotion(() => import('@/pages/Track'))
const Lesson = lazyMotion(() => import('@/pages/Lesson'))
const Lab = lazyMotion(() => import('@/pages/Lab'))
const Playground = lazyMotion(() => import('@/pages/Playground'))
const Glossary = lazyMotion(() => import('@/pages/Glossary'))
const Capstone = lazyMotion(() => import('@/pages/Capstone'))
const Forge = lazyMotion(() => import('@/pages/Forge'))
const ForgeLab = lazyMotion(() => import('@/pages/ForgeLab'))
const Fleet = lazyMotion(() => import('@/pages/Fleet'))
const FleetWeek = lazyMotion(() => import('@/pages/FleetWeek'))
const Leaderboard = lazyMotion(() => import('@/pages/Leaderboard'))
const Changes = lazyMotion(() => import('@/pages/Changes'))
// Me is plain `lazy`: lazyMotion would load src/lib/motion.tsx (framer-motion) beside the page, where verify:bundle's
// closure never sees it. Its sections that use framer-motion scope themselves (src/pages/me/*; wave-3.md §12.5).
const Me = lazy(() => import('@/pages/Me'))
const Boot = lazy(() => import('@/pages/Boot'))
const Today = lazy(() => import('@/pages/Today'))
const Daily = lazy(() => import('@/pages/Daily'))
const Errors = lazy(() => import('@/pages/Errors'))
const Play = lazy(() => import('@/pages/Play'))
const NotFound = lazy(() => import('@/pages/NotFound'))

/**
 * Routing contract: Layout renders `{children}` (pattern A), so App wraps
 * `<Layout><Routes>…</Routes></Layout>` — never mix with <Outlet/>.
 * The Suspense boundary sits inside Layout so the shell never unmounts while a
 * page chunk loads.
 */
export default function App() {
  const { pathname } = useLocation()
  return (
    <Layout>
      <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/boot" element={<Boot />} />
            <Route path="/today" element={<Today />} />
            <Route path="/daily" element={<Daily />} />
            <Route path="/errors" element={<Errors />} />
            <Route path="/play/:playId" element={<Play />} />
            <Route path="/curriculum" element={<Curriculum />} />
            <Route path="/tracks/:trackId" element={<Track />} />
            <Route path="/lesson/:lessonId" element={<Lesson />} />
            <Route path="/lab" element={<Lab />} />
            <Route path="/lab/:simId" element={<Playground />} />
            <Route path="/glossary" element={<Glossary />} />
            <Route path="/me" element={<Me />} />
            <Route path="/progress" element={<Navigate to="/me" replace />} />
            <Route path="/capstone" element={<Capstone />} />
            <Route path="/forge" element={<Forge />} />
            <Route path="/forge/:labId" element={<ForgeLab />} />
            <Route path="/fleet" element={<Fleet />} />
            <Route path="/week" element={<FleetWeek />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/freshness" element={<Changes />} />
            <Route path="/field-notes" element={<Navigate to="/freshness?tab=field-notes" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  )
}
