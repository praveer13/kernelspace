/**
 * LAB — `/lab` (lab.md). The simulator gallery: nine live-preview cards running
 * canned demo loops of their real engines (8fps idle → 30fps on hover), track /
 * difficulty filters, live search, and lab-stats chips from the progress store.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, ChevronDown, RotateCcw, Search } from 'lucide-react'
import { useProgress } from '@/lib/progress'
import { SIMS } from '@/lib/tracks'
import { usePrefersReducedMotion } from '@/components/sims/PlaygroundShell'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Card metadata (lab.md §2, ids match /lab/:simId routes)             */
/* ------------------------------------------------------------------ */

type PreviewKind =
  | 'memory'
  | 'allocator'
  | 'vm'
  | 'roofline'
  | 'wgsl'
  | 'quant'
  | 'kv'
  | 'batching'
  | 'engine'

interface SimCardDef {
  id: string
  num: string
  title: string
  hook: string
  track: string
  trackColor: string
  difficulty: 1 | 2 | 3
  metaId: string
  preview: PreviewKind
  concepts: string
}

const SIM_CARDS: SimCardDef[] = [
  {
    id: 'sim-memory', num: 'SIM-01', title: 'Memory Grid Visualizer',
    hook: 'Point at a byte. Own a segfault.',
    track: 'T1', trackColor: '#FBBF24', difficulty: 1,
    metaId: 'memory-grid', preview: 'memory',
    concepts: 'pointers segfault stack heap addresses deref null',
  },
  {
    id: 'sim-allocator', num: 'SIM-02', title: 'Toy Allocator',
    hook: 'malloc, free, split, coalesce — your hands on the heap.',
    track: 'T1', trackColor: '#FBBF24', difficulty: 2,
    metaId: 'allocator', preview: 'allocator',
    concepts: 'malloc free split coalesce fragmentation pagedattention kv block',
  },
  {
    id: 'sim-vm', num: 'SIM-03', title: 'VM Paging Simulator',
    hook: 'Walk a page table. Miss the TLB. Fault. Repeat.',
    track: 'T2', trackColor: '#22D3EE', difficulty: 2,
    metaId: 'paging', preview: 'vm',
    concepts: 'page table tlb hit miss fault eviction lru fifo pagedattention',
  },
  {
    id: 'sim-roofline', num: 'SIM-04', title: 'Roofline Model',
    hook: 'One chart that explains every GPU benchmark.',
    track: 'T4', trackColor: '#A78BFA', difficulty: 1,
    metaId: 'roofline', preview: 'roofline',
    concepts: 'bandwidth compute flops hbm ridge prefill decode intensity',
  },
  {
    id: 'sim-wgsl', num: 'SIM-05', title: 'WGSL Playground',
    hook: 'Write a compute shader. Feed it 65,536 floats.',
    track: 'T4', trackColor: '#A78BFA', difficulty: 3,
    metaId: 'wgsl', preview: 'wgsl',
    concepts: 'webgpu compute shader workgroup threads dispatch gpu',
  },
  {
    id: 'sim-quant', num: 'SIM-06', title: 'The Quantizer',
    hook: 'Type 3.14159. Watch it become 4 bits.',
    track: 'T4', trackColor: '#A78BFA', difficulty: 1,
    metaId: 'quantizer', preview: 'quant',
    concepts: 'fp32 fp16 bf16 fp8 int8 int4 bits quantization error',
  },
  {
    id: 'sim-kv', num: 'SIM-07', title: 'KV-Cache Calculator',
    hook: 'Where did 40 GB of GPU memory go? Do the math.',
    track: 'T5', trackColor: '#FB7185', difficulty: 1,
    metaId: 'kv-calc', preview: 'kv',
    concepts: 'kv cache hbm memory context length batch gqa oom',
  },
  {
    id: 'sim-batching', num: 'SIM-08', title: 'Continuous Batching Sim',
    hook: 'Schedule tokens like an OS schedules threads.',
    track: 'T5', trackColor: '#FB7185', difficulty: 2,
    metaId: 'batching', preview: 'batching',
    concepts: 'continuous batching scheduler throughput utilization ttft itl prefill decode',
  },
  {
    id: 'sim-engine', num: 'SIM-09', title: 'Toy Inference Engine',
    hook: 'The whole stack, running at 1 token per second — gloriously visible.',
    track: 'T*', trackColor: '#3EF2A4', difficulty: 3,
    metaId: 'engine', preview: 'engine',
    concepts: 'inference engine pipeline tokens tokenizer capstone serving',
  },
]

const TRACK_FILTERS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T*'] as const
const TRACK_COLORS: Record<string, string> = {
  T0: '#34D399', T1: '#FBBF24', T2: '#22D3EE', T3: '#F97316',
  T4: '#A78BFA', T5: '#FB7185', 'T*': '#3EF2A4',
}

const SIM_META_BY_ID = new Map(SIMS.map((sim) => [sim.id, sim]))

/* ------------------------------------------------------------------ */
/* Live miniature previews — canned demo loops of the real engines     */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawPreview(ctx: CanvasRenderingContext2D, kind: PreviewKind, color: string, w: number, h: number, t: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.lineWidth = 1

  switch (kind) {
    case 'memory': {
      const cols = 16
      const rows = 8
      const cw = (w - 16) / cols
      const chh = (h - 16) / rows
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const addr = r * cols + c
          const x = 8 + c * cw
          const y = 8 + r * chh
          let fill = '#182130'
          let alpha = 0.55
          if (addr < 32) {
            fill = '#5D6B80'
            alpha = 0.18
          } else if (addr >= 96) {
            const stackDepth = 10 + Math.floor(6 * Math.sin(t * 0.7))
            if (addr >= 128 - stackDepth) {
              fill = '#A78BFA'
              alpha = 0.4
            } else {
              fill = '#A78BFA'
              alpha = 0.1
            }
          } else {
            const pulse = (addr * 37 + Math.floor(t * 5) * 13) % 64
            if (pulse < 6) {
              fill = '#3EF2A4'
              alpha = 0.75 - pulse * 0.11
            }
          }
          ctx.globalAlpha = alpha
          ctx.fillStyle = fill
          ctx.fillRect(x + 1, y + 1, cw - 2, chh - 2)
        }
      }
      ctx.globalAlpha = 1
      break
    }
    case 'allocator': {
      const barH = (h - 40) / 4
      for (let row = 0; row < 4; row += 1) {
        const y = 8 + row * (barH + 8)
        const rng = mulberry32(7 + row * 31 + Math.floor(t / 2.4))
        let x = 8
        const xEnd = w - 8
        let i = 0
        while (x < xEnd - 4) {
          let len = 12 + rng() * 54
          if (x + len > xEnd) len = xEnd - x
          const used = rng() > 0.42
          const amber = used && rng() > 0.9
          ctx.fillStyle = amber ? '#FFB224' : used ? color : '#182130'
          ctx.globalAlpha = amber ? 0.75 : used ? 0.55 : 0.8
          ctx.fillRect(x, y, len - 1, barH)
          ctx.globalAlpha = 0.35
          ctx.fillStyle = '#07090D'
          ctx.fillRect(x, y, 3, barH)
          ctx.globalAlpha = 1
          x += len
          i += 1
          if (i > 24) break
        }
      }
      break
    }
    case 'vm': {
      const colY = 12
      /* virtual pages */
      for (let i = 0; i < 12; i += 1) {
        const active = i === Math.floor(t * 1.4) % 12
        ctx.fillStyle = '#22D3EE'
        ctx.globalAlpha = active ? 0.85 : 0.18
        ctx.fillRect(10, colY + i * ((h - 24) / 12), 26, (h - 24) / 12 - 3)
      }
      /* page table rows */
      for (let i = 0; i < 12; i += 1) {
        ctx.fillStyle = '#5D6B80'
        ctx.globalAlpha = i % 3 === 0 ? 0.5 : 0.2
        ctx.fillRect(52, colY + i * ((h - 24) / 12) + 2, 40, 3)
      }
      /* frames */
      for (let i = 0; i < 8; i += 1) {
        const filled = (i + Math.floor(t * 0.5)) % 8 < 5
        ctx.fillStyle = '#3EF2A4'
        ctx.globalAlpha = filled ? 0.5 : 0.1
        ctx.fillRect(w - 46, colY + i * ((h - 24) / 8), 36, (h - 24) / 8 - 4)
      }
      /* translation arrow */
      const phase = (t % 1.4) / 1.4
      const ay = colY + (Math.floor(t * 1.4) % 12) * ((h - 24) / 12) + 6
      const by = colY + ((Math.floor(t * 1.4) * 5) % 8) * ((h - 24) / 8) + 8
      ctx.strokeStyle = '#FFB224'
      ctx.globalAlpha = 0.8
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(40, ay)
      ctx.bezierCurveTo(w * 0.45, ay, w * 0.6, by, w - 50, by)
      ctx.stroke()
      ctx.setLineDash([])
      const dx = 40 + (w - 90) * phase
      const dy = ay + (by - ay) * phase
      ctx.fillStyle = '#FFB224'
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.arc(dx, dy, 2.5, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'roofline': {
      const L = 14
      const B = h - 14
      const ridgeX = w * 0.52
      const ridgeY = h * 0.3
      /* bandwidth region shading */
      ctx.fillStyle = 'rgba(255,178,36,0.08)'
      ctx.beginPath()
      ctx.moveTo(L, B)
      ctx.lineTo(L, B - (B - ridgeY) * 0.28)
      ctx.lineTo(ridgeX, ridgeY)
      ctx.lineTo(ridgeX, B)
      ctx.closePath()
      ctx.fill()
      /* roofs */
      ctx.strokeStyle = '#E8EEF6'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(L, B - (B - ridgeY) * 0.28)
      ctx.lineTo(ridgeX, ridgeY)
      ctx.lineTo(w - 10, ridgeY)
      ctx.stroke()
      /* decode (rose) + prefill (violet) */
      const pulse = 1 + 0.25 * Math.sin(t * 4)
      ctx.fillStyle = '#FB7185'
      ctx.beginPath()
      ctx.arc(w * 0.2, B - (B - ridgeY) * 0.34, 4 * pulse, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#A78BFA'
      ctx.beginPath()
      ctx.arc(w * 0.78, ridgeY + 6, 4 * pulse, 0, Math.PI * 2)
      ctx.fill()
      /* scrub guide */
      const gx = L + ((t * 0.15) % 1) * (w - L - 14)
      ctx.strokeStyle = '#A3B0C2'
      ctx.globalAlpha = 0.5
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(gx, 8)
      ctx.lineTo(gx, B)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      break
    }
    case 'wgsl': {
      /* code lines */
      const hl = Math.floor(t * 1.5) % 6
      for (let i = 0; i < 6; i += 1) {
        ctx.fillStyle = i === hl ? color : '#5D6B80'
        ctx.globalAlpha = i === hl ? 0.9 : 0.3
        const len = [0.62, 0.4, 0.72, 0.5, 0.3, 0.58][i]
        ctx.fillRect(10, 12 + i * ((h - 24) / 6), len * w * 0.4, 4)
      }
      /* workgroup grid */
      const sweep = Math.floor(t * 3) % 4
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 4; c += 1) {
          const x = w * 0.52 + c * ((w * 0.44) / 4)
          const y = 12 + r * ((h - 24) / 3)
          ctx.strokeStyle = '#5CA8FF'
          ctx.globalAlpha = c === sweep ? 0.95 : 0.25
          ctx.strokeRect(x + 2, y + 2, (w * 0.44) / 4 - 6, (h - 24) / 3 - 6)
          ctx.fillStyle = '#5CA8FF'
          ctx.globalAlpha = c === sweep ? 0.5 : 0.12
          ctx.fillRect(x + 5, y + 5, 3, 3)
          ctx.fillRect(x + 10, y + 5, 3, 3)
          ctx.fillRect(x + 7.5, y + 10, 3, 3)
        }
      }
      ctx.globalAlpha = 1
      break
    }
    case 'quant': {
      const rows: [number, number][] = [
        [32, 0.5], [16, 0.62], [16, 0.72], [8, 0.82], [8, 0.9], [4, 1],
      ]
      const focus = Math.floor(t / 1.6) % rows.length
      rows.forEach(([bits, scale], r) => {
        const y = 10 + r * ((h - 20) / rows.length)
        const cw2 = Math.min(7, (w - 20) / 32)
        for (let b = 0; b < bits; b += 1) {
          const x = 10 + b * cw2 * scale
          ctx.fillStyle = b === 0 ? '#FB7185' : b < bits * 0.3 ? '#FFB224' : '#3EF2A4'
          ctx.globalAlpha = r === focus ? 0.95 : 0.3
          ctx.fillRect(x, y, cw2 * scale - 1.5, (h - 20) / rows.length - 5)
        }
      })
      ctx.globalAlpha = 1
      break
    }
    case 'kv': {
      const x = 10
      const bw2 = w - 20
      const y = h * 0.34
      const bh = h * 0.3
      const kvFrac = 0.3 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.9))
      ctx.fillStyle = '#A78BFA'
      ctx.globalAlpha = 0.6
      ctx.fillRect(x, y, bw2 * 0.38, bh)
      ctx.fillStyle = '#FB7185'
      ctx.globalAlpha = 0.75
      ctx.fillRect(x + bw2 * 0.38, y, bw2 * kvFrac, bh)
      ctx.fillStyle = '#5D6B80'
      ctx.globalAlpha = 0.35
      ctx.fillRect(x + bw2 * (0.38 + kvFrac), y, bw2 * (1 - 0.38 - kvFrac), bh)
      /* capacity line */
      ctx.strokeStyle = '#FFB224'
      ctx.globalAlpha = 0.9
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x + bw2 * 0.86, y - 8)
      ctx.lineTo(x + bw2 * 0.86, y + bh + 8)
      ctx.stroke()
      ctx.setLineDash([])
      /* token counter bars */
      for (let i = 0; i < 18; i += 1) {
        ctx.fillStyle = '#3EF2A4'
        ctx.globalAlpha = ((i + Math.floor(t * 6)) % 18) < 9 ? 0.6 : 0.15
        ctx.fillRect(x + i * (bw2 / 18), y + bh + 14, bw2 / 18 - 3, 5)
      }
      ctx.globalAlpha = 1
      break
    }
    case 'batching': {
      const rng = mulberry32(99)
      const speeds = [1.1, 0.7, 1.5, 0.9, 1.3]
      const offsets = [0.1, 0.5, 0.0, 0.7, 0.3]
      for (let i = 0; i < 5; i += 1) {
        const y = 10 + i * ((h - 20) / 5)
        const bh = (h - 20) / 5 - 7
        const cycle = ((t * speeds[i] * 0.25 + offsets[i]) % 1.25)
        const len = Math.min(1, cycle) * (w - 28)
        const pre = Math.min(len, (w - 28) * 0.22)
        ctx.fillStyle = '#A78BFA'
        ctx.globalAlpha = 0.8
        ctx.fillRect(10, y, pre, bh)
        ctx.fillStyle = '#3EF2A4'
        ctx.globalAlpha = 0.65
        ctx.fillRect(10 + pre, y, Math.max(0, len - pre), bh)
        if (cycle >= 1) {
          ctx.fillStyle = '#5D6B80'
          ctx.globalAlpha = 0.5
          ctx.fillRect(10 + len + 4, y + bh / 2 - 2, 14, 4)
        }
        void rng
      }
      ctx.globalAlpha = 1
      break
    }
    case 'engine': {
      const stages = 4
      const bw3 = (w - 20) / stages - 10
      const y = h / 2 - 14
      ctx.strokeStyle = '#5D6B80'
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(10, h / 2)
      ctx.lineTo(w - 10, h / 2)
      ctx.stroke()
      for (let i = 0; i < stages; i += 1) {
        const x = 10 + i * ((w - 20) / stages)
        const hot = Math.floor(t * 2) % stages === i
        ctx.strokeStyle = hot ? color : '#5D6B80'
        ctx.globalAlpha = hot ? 0.95 : 0.4
        ctx.strokeRect(x + 4, y, bw3, 28)
      }
      for (let d = 0; d < 3; d += 1) {
        const p = ((t * 0.5 + d / 3) % 1)
        ctx.fillStyle = '#3EF2A4'
        ctx.globalAlpha = 0.9
        ctx.beginPath()
        ctx.arc(12 + p * (w - 24), h / 2, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      break
    }
  }
}

function SimPreview({ kind, color, active }: { kind: PreviewKind; color: string; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let running = true
    let raf = 0
    let last = 0
    const start = performance.now()

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting
    })
    io.observe(wrap)

    const frame = (now: number) => {
      const t = (now - start) / 1000
      if (reducedMotion) {
        /* static first frame only */
        const rect = wrap.getBoundingClientRect()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawPreview(ctx, kind, color, rect.width, rect.height, 0.4)
        return
      }
      raf = requestAnimationFrame(frame)
      if (!running || document.hidden) return
      const fps = activeRef.current ? 30 : 8
      if (now - last < 1000 / fps) return
      last = now
      const rect = wrap.getBoundingClientRect()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawPreview(ctx, kind, color, rect.width, rect.height, t)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
    }
  }, [kind, color, reducedMotion])

  return (
    <div ref={wrapRef} className="absolute inset-0" aria-hidden>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* SimCard                                                             */
/* ------------------------------------------------------------------ */

function DifficultyDots({ level, color }: { level: number; color: string }) {
  return (
    <span className="flex items-center gap-1" title={`difficulty ${level}/3`} aria-label={`difficulty ${level} of 3`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: i <= level ? color : '#2C3A4F' }}
        />
      ))}
    </span>
  )
}

function SimCard({ def, index }: { def: SimCardDef; index: number }) {
  const [hover, setHover] = useState(false)
  const [tapped, setTapped] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  const visits = useProgress((s) => s.sims[def.id]?.visits ?? 0)
  const isEngine = def.id === 'sim-engine'
  const active = hover || tapped
  const usedIn = SIM_META_BY_ID.get(def.metaId)?.usedIn ?? 'curriculum'
  const usedInHref = usedIn === 'capstone' ? '/capstone' : `/lesson/${usedIn.toLowerCase()}`

  const body = (
    <>
      {/* preview viewport */}
      <div
        className={cn(
          'relative aspect-video overflow-hidden border-b border-line bg-ink transition-opacity duration-200',
          active ? 'opacity-100' : 'opacity-80',
        )}
      >
        <SimPreview kind={def.preview} color={def.trackColor} active={active} />
        <span className="absolute left-3 top-2.5 font-mono text-[10px] tracking-[0.10em] text-text-3">
          {def.num}
        </span>
        <span className="absolute right-3 top-2.5 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.10em] text-accent">
          {reducedMotion ? (
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          ) : (
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-accent"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            />
          )}
          LIVE
        </span>
      </div>

      {/* body */}
      <div className="p-5">
        <h2 className="font-display text-h4 text-text-1 transition-colors duration-150 group-hover:text-accent">
          {def.title}
        </h2>
        <p className="mt-1 text-body-sm text-text-2">{def.hook}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.10em]"
            style={{
              color: def.trackColor,
              borderColor: `${def.trackColor}55`,
              backgroundColor: `${def.trackColor}14`,
            }}
          >
            {def.track}
          </span>
          <DifficultyDots level={def.difficulty} color={def.trackColor} />
          <Link
            to={usedInHref}
            onClick={(e) => e.stopPropagation()}
            className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-text-3 transition-colors hover:border-line-bright hover:text-accent"
          >
            used in {usedIn} ↗
          </Link>
        </div>
      </div>
    </>
  )

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.2 } }}
      transition={{
        duration: 0.55,
        delay: Math.min(index, 8) * 0.06,
        ease: [0.16, 1, 0.3, 1],
        layout: { duration: 0.3 },
      }}
      whileHover={reducedMotion ? undefined : { y: -6 }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={() => setTapped((v) => !v)}
      className="group overflow-hidden rounded-lg border border-line bg-surface-1 transition-colors duration-180 hover:border-line-bright"
    >
      {isEngine ? (
        <>
          <Link to={`/lab/${def.id}`} className="block" aria-label={`boot ${def.title}`}>
            {body}
          </Link>
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="font-mono text-[10px] text-text-3">{visits} runs</span>
            <Link
              to="/capstone"
              className="flex items-center gap-1 font-mono text-[11px] text-text-2 transition-all duration-150 hover:gap-2 hover:text-accent"
            >
              part of the capstone <ArrowRight size={12} strokeWidth={1.75} />
            </Link>
          </div>
        </>
      ) : (
        <>
          <Link to={`/lab/${def.id}`} className="block" aria-label={`boot ${def.title}`}>
            {body}
          </Link>
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="font-mono text-[10px] text-text-3">{visits} runs</span>
            <Link
              to={`/lab/${def.id}`}
              className="flex items-center gap-1 font-mono text-[11px] transition-all duration-150 hover:gap-2"
              style={{ color: def.trackColor }}
            >
              boot <ArrowRight size={12} strokeWidth={1.75} />
            </Link>
          </div>
        </>
      )}
    </motion.article>
  )
}

/* ------------------------------------------------------------------ */
/* Filter controls (shared between desktop bar + mobile disclosure)    */
/* ------------------------------------------------------------------ */

function FilterControls({
  tracks,
  toggleTrack,
  difficulties,
  toggleDifficulty,
  search,
  setSearch,
}: {
  tracks: Set<string>
  toggleTrack: (t: string) => void
  difficulties: Set<number>
  toggleDifficulty: (d: number) => void
  search: string
  setSearch: (s: string) => void
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={tracks.size === 0} onClick={() => tracks.forEach((t) => toggleTrack(t))} label="all" color="#E8EEF6" />
        {TRACK_FILTERS.map((t) => (
          <FilterChip
            key={t}
            active={tracks.has(t)}
            onClick={() => toggleTrack(t)}
            label={t}
            color={TRACK_COLORS[t]}
          />
        ))}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
        {[1, 2, 3].map((d) => (
          <FilterChip
            key={d}
            active={difficulties.has(d)}
            onClick={() => toggleDifficulty(d)}
            label={'●'.repeat(d) + '○'.repeat(3 - d)}
            color="#FFB224"
          />
        ))}
      </div>
      <label className="flex h-8 w-full items-center gap-2 rounded-sm border border-line bg-surface-2 px-2.5 transition-colors focus-within:border-line-bright sm:w-[220px]">
        <Search size={13} strokeWidth={1.75} className="shrink-0 text-text-3" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter machines…"
          className="w-full bg-transparent font-mono text-[12px] text-text-1 outline-none placeholder:text-text-3"
          aria-label="Filter simulators by title or concept"
        />
      </label>
    </>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean
  onClick: () => void
  label: string
  color: string
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      animate={{ scale: active ? 1 : 0.98 }}
      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      style={
        active
          ? { color, borderColor: `${color}66`, backgroundColor: `${color}14` }
          : undefined
      }
      className={cn(
        'rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide transition-colors duration-120',
        active
          ? ''
          : 'border-line bg-surface-2 text-text-3 hover:border-line-bright hover:text-text-2',
      )}
      aria-pressed={active}
    >
      {label}
    </motion.button>
  )
}

/* ------------------------------------------------------------------ */
/* The Lab page                                                        */
/* ------------------------------------------------------------------ */

export default function Lab() {
  const [tracks, setTracks] = useState<Set<string>>(new Set())
  const [difficulties, setDifficulties] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const simsState = useProgress((s) => s.sims)
  const visitedCount = SIM_CARDS.filter((c) => (simsState[c.id]?.visits ?? 0) > 0).length
  const tasksDone = SIM_CARDS.reduce((n, c) => n + (simsState[c.id]?.tasksDone.length ?? 0), 0)

  const toggleTrack = (t: string) =>
    setTracks((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  const toggleDifficulty = (d: number) =>
    setDifficulties((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return SIM_CARDS.filter((c) => {
      if (tracks.size > 0 && !tracks.has(c.track)) return false
      if (difficulties.size > 0 && !difficulties.has(c.difficulty)) return false
      if (q && !`${c.title} ${c.concepts}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [tracks, difficulties, search])

  const resetFilters = () => {
    setTracks(new Set())
    setDifficulties(new Set())
    setSearch('')
  }

  return (
    <section className="mx-auto max-w-app px-6 pb-24 lg:px-12">
      {/* ---- header ---- */}
      <motion.header
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="pt-24"
      >
        <p className="section-label">0x03 — the lab</p>
        <h1 className="mt-4 font-display text-display-lg text-text-1">The Lab</h1>
        <p className="mt-4 max-w-[60ch] text-body text-text-2">
          Nine simulators, zero installs, one browser. Each one is embedded in a lesson — but here
          they&apos;re yours to break freely. State is scratch; nothing is graded.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 font-mono text-[11px]">
          <span className="rounded-sm border border-line bg-surface-1 px-2.5 py-1 text-text-2">
            9 simulators
          </span>
          <span className="rounded-sm border border-line bg-surface-1 px-2.5 py-1 text-text-2">
            <span className="text-accent">{visitedCount}</span> visited
          </span>
          <span className="rounded-sm border border-line bg-surface-1 px-2.5 py-1 text-text-2">
            <span className="text-accent">{tasksDone}</span> lab tasks done
          </span>
        </div>
      </motion.header>

      {/* ---- filter bar (sticky under navbar) ---- */}
      <div className="sticky top-16 z-30 -mx-6 mt-10 border-y border-line bg-surface-1/90 backdrop-blur-md lg:-mx-12">
        <div className="flex items-center justify-between px-6 py-2.5 lg:px-12">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[11px] text-text-2 md:hidden"
            aria-expanded={filtersOpen}
          >
            filters
            <ChevronDown
              size={13}
              strokeWidth={1.75}
              className={cn('transition-transform duration-250', filtersOpen && 'rotate-180')}
            />
          </button>
          <span className="font-mono text-[10px] text-text-3 md:hidden">
            {filtered.length}/9 machines
          </span>
          <div className="hidden flex-wrap items-center gap-3 md:flex">
            <FilterControls
              tracks={tracks}
              toggleTrack={toggleTrack}
              difficulties={difficulties}
              toggleDifficulty={toggleDifficulty}
              search={search}
              setSearch={setSearch}
            />
          </div>
        </div>
        {filtersOpen && (
          <div className="flex flex-col gap-2.5 border-t border-line px-6 py-3 md:hidden">
            <FilterControls
              tracks={tracks}
              toggleTrack={toggleTrack}
              difficulties={difficulties}
              toggleDifficulty={toggleDifficulty}
              search={search}
              setSearch={setSearch}
            />
          </div>
        )}
      </div>

      {/* ---- simulator grid ---- */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <img src="/empty-state.svg" alt="" width={240} height={160} className="opacity-80" />
          <p className="mt-6 font-mono text-xs text-text-3">no machines match</p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 flex items-center gap-1.5 rounded-sm border border-line bg-transparent px-3 py-1.5 font-mono text-[11px] text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-accent"
          >
            <RotateCcw size={12} strokeWidth={1.75} /> reset filters
          </button>
        </div>
      ) : (
        <motion.div layout className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((def, i) => (
              <SimCard key={def.id} def={def} index={i} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ---- lab etiquette ---- */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-16 grid gap-6 rounded-lg border border-line bg-surface-1 p-6 sm:grid-cols-3"
      >
        {[
          ['▸ BREAK THINGS', 'Every sim has a reset button. Use the others first.'],
          ['▸ STATE IS SCRATCH', 'Configs live in the URL. Share a broken heap with a friend.'],
          ['▸ TASKS EARN XP', 'Each sim hides 3–5 guided tasks. +60 XP each, tracked in /progress.'],
        ].map(([label, body], i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-mono text-[11px] tracking-[0.10em] text-accent">{label}</p>
            <p className="mt-2 text-body-sm text-text-2">{body}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
