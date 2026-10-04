import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from '@/components/Layout'
import RouteFallback from '@/components/RouteFallback'

// Every page is its own chunk so the entry chunk holds only the shell (PLAN-100X §7.3).
const Home = lazy(() => import('@/pages/Home'))
const Curriculum = lazy(() => import('@/pages/Curriculum'))
const Track = lazy(() => import('@/pages/Track'))
const Lesson = lazy(() => import('@/pages/Lesson'))
const Lab = lazy(() => import('@/pages/Lab'))
const Playground = lazy(() => import('@/pages/Playground'))
const Glossary = lazy(() => import('@/pages/Glossary'))
const Progress = lazy(() => import('@/pages/Progress'))
const Capstone = lazy(() => import('@/pages/Capstone'))
const Forge = lazy(() => import('@/pages/Forge'))
const ForgeLab = lazy(() => import('@/pages/ForgeLab'))
const Fleet = lazy(() => import('@/pages/Fleet'))
const FleetWeek = lazy(() => import('@/pages/FleetWeek'))
const Leaderboard = lazy(() => import('@/pages/Leaderboard'))
const Changes = lazy(() => import('@/pages/Changes'))
const NotFound = lazy(() => import('@/pages/NotFound'))

/**
 * Routing contract: Layout renders `{children}` (pattern A), so App wraps
 * `<Layout><Routes>…</Routes></Layout>` — never mix with <Outlet/>.
 * The Suspense boundary sits inside Layout so the shell never unmounts while a
 * page chunk loads.
 */
export default function App() {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/curriculum" element={<Curriculum />} />
          <Route path="/tracks/:trackId" element={<Track />} />
          <Route path="/lesson/:lessonId" element={<Lesson />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/lab/:simId" element={<Playground />} />
          <Route path="/glossary" element={<Glossary />} />
          <Route path="/progress" element={<Progress />} />
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
    </Layout>
  )
}
