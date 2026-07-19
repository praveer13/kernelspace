import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { motion } from 'framer-motion'
import {
  useProgress,
  selectDoneLessons,
  selectStreak,
  TOTAL_LESSONS,
} from '@/lib/progress'

const TTFT_READOUTS = [
  'TTFT 0.4s',
  'TTFT 0.31s',
  'ITL 28ms',
  'TTFT 0.42s',
  'HBM 71°C',
  'TTFT 0.38s',
  'batch 32/256',
  'KV 84% alloc',
]

const pickReadout = () => TTFT_READOUTS[Math.floor(Math.random() * TTFT_READOUTS.length)]

/** Tiny 40px sparkline of the last 14 days of lesson completions. */
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data)
  const w = 40
  const h = 16
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke="#3EF2A4" strokeWidth="1" opacity="0.8" />
    </svg>
  )
}

/**
 * StatusBar — the "system monitor" (design.md §9.2).
 * Fixed bottom, lg+ only. XP as CPU%, lessons as MEM blocks, streak as uptime,
 * current route + a playful latency readout on the right.
 */
export default function StatusBar() {
  const { pathname } = useLocation()
  const xp = useProgress((s) => s.xp)
  const lessons = useProgress((s) => s.lessons)
  const done = useProgress(selectDoneLessons)
  const streak = useProgress(selectStreak)
  const [visible, setVisible] = useState(false)

  // date → completions map (computed from the stable lessons ref)
  const activity = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of Object.values(lessons)) {
      if (l.completedAt) {
        const day = l.completedAt.slice(0, 10)
        map[day] = (map[day] ?? 0) + 1
      }
    }
    return map
  }, [lessons])

  // Appears with a 300ms slide-up on first scroll.
  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 8) setVisible(true)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const cpuPct = Math.min(100, Math.round((xp / 5000) * 100))

  const spark = useMemo(() => {
    const out: number[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      out.push(activity[d.toISOString().slice(0, 10)] ?? 0)
    }
    return out
  }, [activity])

  const lastDone = useMemo(() => {
    let latest: { id: string; at: string } | null = null
    for (const [id, l] of Object.entries(lessons)) {
      if (l.status === 'done' && l.completedAt && (!latest || l.completedAt > latest.at)) {
        latest = { id, at: l.completedAt }
      }
    }
    return latest?.id ?? null
  }, [lessons])

  // Random playful readout, re-rolled on every route change.
  const [ttft, setTtft] = useState(pickReadout)
  const [ttftPath, setTtftPath] = useState(pathname)
  if (ttftPath !== pathname) {
    setTtftPath(pathname)
    setTtft(pickReadout())
  }

  return (
    <motion.aside
      initial={{ y: 40 }}
      animate={{ y: visible ? 0 : 40 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 bottom-0 z-40 hidden h-10 border-t border-line bg-surface-1/90 backdrop-blur-md lg:block"
      aria-label="Progress status bar"
    >
      <div className="mx-auto flex h-full max-w-app items-center gap-6 px-6 font-mono text-[11px] tracking-wide text-text-3 xl:px-12">
        {/* Zone 1 — CPU = XP utilization */}
        <div className="flex items-center gap-2" title={`${xp} XP`}>
          <span className="text-accent">▣</span>
          <span>
            CPU <span className="text-text-1">{cpuPct}%</span>
          </span>
          <Sparkline data={spark} />
        </div>

        {/* Zone 2 — MEM = lessons as allocated blocks */}
        <div
          className="group relative flex items-center gap-2"
          title={lastDone ? `last completed: ${lastDone}` : 'no lessons completed yet'}
        >
          <span className="text-accent">▤</span>
          <span>
            MEM{' '}
            <span className="text-text-1">
              {done}/{TOTAL_LESSONS}
            </span>{' '}
            blk
          </span>
          <div className="flex items-end gap-[2px]" aria-hidden>
            {Array.from({ length: TOTAL_LESSONS }, (_, i) => (
              <span
                key={i}
                className={
                  i < done
                    ? 'h-2 w-[3px] rounded-[0.5px] bg-accent'
                    : 'h-2 w-[3px] rounded-[0.5px] bg-surface-3'
                }
              />
            ))}
          </div>
        </div>

        {/* Zone 3 — UPTIME = streak */}
        <div className="flex items-center gap-2">
          <span className="text-accent">△</span>
          <span>
            UPTIME <span className="text-text-1">{streak}d</span>
          </span>
        </div>

        {/* Zone 4 — context */}
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden text-text-3 xl:inline">{ttft}</span>
          <span className="text-text-2">~{pathname === '/' ? '' : pathname}</span>
        </div>
      </div>
    </motion.aside>
  )
}
