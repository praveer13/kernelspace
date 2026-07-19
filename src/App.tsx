import { Routes, Route } from 'react-router'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import Curriculum from '@/pages/Curriculum'
import Track from '@/pages/Track'
import Lesson from '@/pages/Lesson'
import Lab from '@/pages/Lab'
import Playground from '@/pages/Playground'
import Glossary from '@/pages/Glossary'
import Progress from '@/pages/Progress'
import Capstone from '@/pages/Capstone'
import NotFound from '@/pages/NotFound'

/**
 * Routing contract: Layout renders `{children}` (pattern A), so App wraps
 * `<Layout><Routes>…</Routes></Layout>` — never mix with <Outlet/>.
 */
export default function App() {
  return (
    <Layout>
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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
