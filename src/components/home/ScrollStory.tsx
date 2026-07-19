import { useRef, useState } from 'react'
import type { ComponentType } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { motion } from 'framer-motion'

gsap.registerPlugin(ScrollTrigger, useGSAP)

const CYAN = '#22D3EE'
const ROSE = '#FB7185'
const DIM = '#5D6B80'

/* ------------------------- SVG building blocks ------------------------- */

function Box({
  x,
  y,
  w,
  h,
  label,
  color,
  fill = false,
}: {
  x: number
  y: number
  w: number
  h: number
  label?: string
  color: string
  fill?: boolean
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        fill={fill ? color : 'none'}
        fillOpacity={fill ? 0.25 : 0}
        stroke={color}
        strokeWidth={1.25}
      />
      {label && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 3}
          textAnchor="middle"
          fontSize={8}
          fontFamily="'JetBrains Mono', monospace"
          fill={color}
        >
          {label}
        </text>
      )}
    </g>
  )
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  color,
  dashed = false,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  dashed?: boolean
}) {
  const mx = (x1 + x2) / 2
  return (
    <g>
      <path
        d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeDasharray={dashed ? 4 : 100}
        pathLength={dashed ? undefined : 100}
        className={dashed ? undefined : 'arr'}
        strokeDashoffset={dashed ? 0 : 100}
        opacity={0.9}
      />
      <polygon
        points={`${x2},${y2} ${x2 - 5},${y2 - 3} ${x2 - 5},${y2 + 3}`}
        fill={color}
        className="arrhead"
        opacity={0}
      />
    </g>
  )
}

/* ------------------------------ Beat SVGs ------------------------------ */

function Beat1Left() {
  // Page table: 4 virtual pages → scattered physical frames
  const frames = [2, 5, 1, 4]
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full">
      <text x={40} y={18} fontSize={9} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        virtual pages
      </text>
      <text x={230} y={18} fontSize={9} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        physical frames
      </text>
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} x={40} y={30 + i * 42} w={70} h={30} label={`VPN ${i}`} color={CYAN} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((f) => (
        <Box
          key={f}
          x={230 + (f % 2) * 80}
          y={30 + Math.floor(f / 2) * 56}
          w={70}
          h={30}
          label={`PFN ${f}`}
          color={CYAN}
          fill={frames.includes(f)}
        />
      ))}
      {frames.map((f, i) => (
        <Arrow
          key={i}
          x1={110}
          y1={45 + i * 42}
          x2={230 + (f % 2) * 80}
          y2={45 + Math.floor(f / 2) * 56}
          color={CYAN}
        />
      ))}
    </svg>
  )
}

function Beat1Right() {
  // KV block table: sequence blocks → non-contiguous KV blocks
  const blocks = [1, 4, 0, 5]
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full">
      <text x={40} y={18} fontSize={9} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        sequence blocks
      </text>
      <text x={230} y={18} fontSize={9} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        kv blocks (hbm)
      </text>
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} x={40} y={30 + i * 42} w={70} h={30} label={`SEQ ${i}`} color={ROSE} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((f) => (
        <Box
          key={f}
          x={230 + (f % 2) * 80}
          y={30 + Math.floor(f / 2) * 56}
          w={70}
          h={30}
          label={`KV ${f}`}
          color={ROSE}
          fill={blocks.includes(f)}
        />
      ))}
      {blocks.map((f, i) => (
        <Arrow
          key={i}
          x1={110}
          y1={45 + i * 42}
          x2={230 + (f % 2) * 80}
          y2={45 + Math.floor(f / 2) * 56}
          color={ROSE}
        />
      ))}
    </svg>
  )
}

function Beat2Left() {
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full">
      <Box x={60} y={30} w={240} h={44} label="DRAM — fast, small" color={CYAN} fill />
      <Box x={60} y={126} w={240} h={44} label="DISK — slow, vast" color={CYAN} />
      <Arrow x1={150} y1={74} x2={150} y2={126} color={CYAN} />
      <Arrow x1={210} y1={126} x2={210} y2={74} color={CYAN} dashed />
      <text x={230} y={104} fontSize={8} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        swap out / in
      </text>
    </svg>
  )
}

function Beat2Right() {
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full">
      <Box x={60} y={30} w={240} h={44} label="HBM — 3.35 TB/s, 80 GB" color={ROSE} fill />
      <Box x={60} y={126} w={240} h={44} label="DRAM — host memory" color={ROSE} />
      <Arrow x1={150} y1={74} x2={150} y2={126} color={ROSE} />
      <Arrow x1={210} y1={126} x2={210} y2={74} color={ROSE} dashed />
      <text x={230} y={104} fontSize={8} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        kv offload / recompute
      </text>
    </svg>
  )
}

function Beat3Left() {
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full">
      <text x={36} y={24} fontSize={9} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        runqueue
      </text>
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} x={36 + i * 62} y={36} w={50} h={30} label={`thr ${i}`} color={CYAN} fill={i === 1} />
      ))}
      <Box x={290} y={30} w={52} h={44} label="CPU" color={CYAN} fill />
      <Arrow x1={236} y1={51} x2={290} y2={51} color={CYAN} />
      {/* preempt: running thread gets switched out */}
      <path
        d="M 120 66 C 120 110, 250 110, 310 76"
        fill="none"
        stroke={CYAN}
        strokeWidth={1.25}
        strokeDasharray={100}
        pathLength={100}
        strokeDashoffset={100}
        className="arr"
      />
      <text x={150} y={124} fontSize={8} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        preempt → context switch
      </text>
      <Box x={36} y={140} w={240} h={30} label="wait queue (i/o)" color={DIM} />
    </svg>
  )
}

function Beat3Right() {
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full">
      <text x={36} y={24} fontSize={9} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        iteration batch
      </text>
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} x={36 + i * 62} y={36} w={50} h={30} label={`req ${i}`} color={ROSE} fill={i < 3} />
      ))}
      <Box x={290} y={30} w={52} h={44} label="GPU" color={ROSE} fill />
      <Arrow x1={236} y1={51} x2={290} y2={51} color={ROSE} />
      {/* request joins mid-flight */}
      <path
        d="M 267 6 C 267 20, 250 28, 236 40"
        fill="none"
        stroke={ROSE}
        strokeWidth={1.25}
        strokeDasharray={100}
        pathLength={100}
        strokeDashoffset={100}
        className="arr"
      />
      <text x={120} y={124} fontSize={8} fontFamily="'JetBrains Mono', monospace" fill={DIM}>
        join / leave every iteration
      </text>
      <Box x={36} y={140} w={240} h={30} label="waiting requests" color={DIM} />
    </svg>
  )
}

/* ------------------------------ Beat data ------------------------------ */

interface Beat {
  caption: string
  leftLabel: string
  rightLabel: string
  left: ComponentType
  right: ComponentType
  lines: string[]
}

const BEATS: Beat[] = [
  {
    caption: 'Virtual memory ≡ PagedAttention',
    leftLabel: 'OS · 1970s',
    rightLabel: 'LLM serving · 2020s',
    left: Beat1Left,
    right: Beat1Right,
    lines: ['page table ≡ block table', '4 KB pages ≡ 16-token blocks', 'near-zero fragmentation'],
  },
  {
    caption: 'Swap ≡ KV offload',
    leftLabel: 'OS · 1970s',
    rightLabel: 'LLM serving · 2020s',
    left: Beat2Left,
    right: Beat2Right,
    lines: ['evict under pressure ≡ preempt & recompute', 'disk ≡ host dram', 'demand paging ≡ on-demand kv fetch'],
  },
  {
    caption: 'Scheduler ≡ Continuous batcher',
    leftLabel: 'OS · 1970s',
    rightLabel: 'LLM serving · 2020s',
    left: Beat3Left,
    right: Beat3Right,
    lines: ['context switch ≡ iteration-level scheduling', 'timeslice ≡ one decode step', 'runqueue ≡ waiting requests'],
  },
]

/* ------------------------------- Panels -------------------------------- */

function Translation({ beat, static_ }: { beat: Beat; static_?: boolean }) {
  const L = beat.left
  const R = beat.right
  return (
    <div>
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-lg border border-t2/30 bg-surface-1 p-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.10em] text-t2">
            {beat.leftLabel}
          </p>
          <L />
        </div>
        <div className="beam px-1 text-center font-mono text-2xl text-text-3 md:rotate-0 rotate-90">
          ≡
        </div>
        <div className="rounded-lg border border-t5/30 bg-surface-1 p-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.10em] text-t5">
            {beat.rightLabel}
          </p>
          <R />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        {beat.lines.map((line) => (
          <span
            key={line}
            className={static_ ? 'font-mono text-[11px] text-text-2' : 'cap font-mono text-[11px] text-text-2 opacity-0'}
          >
            {line}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------ The story ------------------------------ */

/**
 * THE SCROLL STORY — "Same idea. New machine." (home.md §4).
 * GSAP-pinned full-viewport stage (~260vh); scroll drives a morph between OS
 * diagrams and their LLM-serving analogs across three beats. Reduced motion
 * and mobile (<lg) get three stacked static panels, no pin.
 */
export default function ScrollStory() {
  const sectionRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [beatIdx, setBeatIdx] = useState(0)
  const [isStatic, setIsStatic] = useState<boolean | null>(() =>
    typeof window !== 'undefined'
      ? !window.matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)')
          .matches
      : null,
  )

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        setIsStatic(false)
        const stage = stageRef.current
        if (!stage) return
        const q = gsap.utils.selector(stage)

        gsap.set(q('.beat-1, .beat-2'), { autoAlpha: 0, scale: 0.98 })
        gsap.set(q('.bcap-1, .bcap-2'), { autoAlpha: 0, filter: 'blur(4px)' })

        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top top',
            end: '+=260%',
            pin: stage,
            scrub: 0.6,
            onUpdate: (self) => {
              const idx = Math.min(2, Math.floor(self.progress * 3))
              setBeatIdx((prev) => (prev === idx ? prev : idx))
            },
          },
        })

        const beatIn = (i: number, at: number) => {
          tl.to(q(`.beat-${i}`), { autoAlpha: 1, scale: 1, duration: 0.3 }, at)
          tl.to(q(`.bcap-${i}`), { autoAlpha: 1, filter: 'blur(0px)', duration: 0.2 }, at)
          tl.to(q(`.beat-${i} .arr`), { strokeDashoffset: 0, duration: 0.5, stagger: 0.12 }, at + 0.1)
          tl.to(q(`.beat-${i} .arrhead`), { opacity: 1, duration: 0.1, stagger: 0.12 }, at + 0.45)
          tl.to(q(`.beat-${i} .cap`), { opacity: 1, duration: 0.25, stagger: 0.1 }, at + 0.3)
        }
        const beatOut = (i: number, at: number) => {
          tl.to(q(`.beat-${i}`), { autoAlpha: 0, scale: 0.98, duration: 0.3 }, at)
          tl.to(q(`.bcap-${i}`), { autoAlpha: 0, filter: 'blur(4px)', duration: 0.2 }, at)
        }
        const beamPulse = (at: number) => {
          tl.to(q('.beam'), { opacity: 1, duration: 0.1 }, at)
          tl.to(q('.beam'), { opacity: 0.4, duration: 0.2 }, at + 0.15)
        }

        gsap.set(q('.beam'), { opacity: 0.4 })
        beatIn(0, 0)
        beamPulse(0.9)
        beatOut(0, 0.95)
        beatIn(1, 1.15)
        beamPulse(1.95)
        beatOut(1, 2.0)
        beatIn(2, 2.2)
        tl.to({}, { duration: 0.2 }, 2.8) // tail room
      })

      mm.add('(max-width: 1023px), (prefers-reduced-motion: reduce)', () => {
        setIsStatic(true)
      })
      return () => mm.revert()
    },
    { scope: sectionRef },
  )

  return (
    <section ref={sectionRef} aria-label="Same idea, new machine">
      {/* Pinned stage (desktop, motion-safe) */}
      <div
        ref={stageRef}
        className={
          isStatic === false
            ? 'flex min-h-[100dvh] items-center overflow-hidden'
            : isStatic === true
              ? 'hidden'
              : 'flex min-h-[100dvh] items-center overflow-hidden'
        }
      >
        <div className="mx-auto w-full max-w-[960px] px-6">
          <p className="section-label mb-3 text-center">0x — isomorphism</p>
          <div className="relative mb-8 h-9">
            {BEATS.map((b, i) => (
              <h3
                key={b.caption}
                className={`bcap-${i} absolute inset-0 text-center font-display text-h2 text-text-1`}
              >
                {b.caption}
              </h3>
            ))}
          </div>

          <div className="relative">
            {BEATS.map((b, i) => (
              <div key={b.caption} className={`beat-${i} ${i > 0 ? 'absolute inset-0' : ''}`}>
                <Translation beat={b} />
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-center gap-4 font-mono text-[11px] text-text-3">
            <span>beat {beatIdx + 1}/3</span>
            <span className="flex gap-1.5">
              {BEATS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                    i <= beatIdx ? 'bg-accent' : 'bg-surface-3'
                  }`}
                />
              ))}
            </span>
          </div>
        </div>
      </div>

      {/* Static stacked fallback (mobile / reduced motion) */}
      {isStatic && (
        <div className="static-story mx-auto max-w-[960px] space-y-16 px-6 py-24">
          {BEATS.map((b) => (
            <div key={b.caption}>
              <h3 className="mb-6 text-center font-display text-h3 text-text-1">{b.caption}</h3>
              <StaticTranslation beat={b} />
            </div>
          ))}
        </div>
      )}

      {/* Exit kicker */}
      <motion.p
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-xl px-6 pb-8 pt-4 text-center font-mono text-body-sm text-text-3"
      >
        "You'll never look at an operating system the same way again."
      </motion.p>
    </section>
  )
}

function StaticTranslation({ beat }: { beat: Beat }) {
  return <Translation beat={beat} static_ />
}
