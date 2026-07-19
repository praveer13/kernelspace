import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { SIMS, getTrack } from '@/lib/tracks'
import type { SimMeta } from '@/lib/tracks'

const MINT = '#3EF2A4'
const CYAN = '#22D3EE'
const AMBER = '#FFB224'
const DIM = '#5D6B80'
const SURF3 = '#182130'
const LINE = '#1E2937'
const ROSE = '#FB7185'

/* -------- Lightweight idle teasers for each sim (home.md §6) -------- */

function drawPreview(ctx: CanvasRenderingContext2D, id: string, t: number, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.lineWidth = 1
  switch (id) {
    case 'memory-grid': {
      const n = 10
      const cell = Math.min(w / n, h / 6) - 3
      for (let i = 0; i < n * 6; i++) {
        const r = Math.floor(i / n)
        const c = i % n
        const x = 12 + c * (cell + 3)
        const y = 12 + r * (cell + 3)
        const wave = Math.sin(t * 1.4 + (r + c) * 0.5)
        ctx.fillStyle = wave > 0.82 ? MINT : SURF3
        if (r < 2) ctx.fillStyle = wave > 0.82 ? MINT : 'rgba(34,211,238,.25)'
        ctx.fillRect(x, y, cell, cell)
      }
      break
    }
    case 'allocator': {
      let x = 14
      for (let i = 0; i < 5; i++) {
        const bw = 34 + 26 * (0.5 + 0.5 * Math.sin(t * 0.9 + i * 1.7))
        const used = Math.sin(t * 0.6 + i * 2.3) > -0.2
        ctx.fillStyle = used ? 'rgba(62,242,164,.75)' : SURF3
        ctx.strokeStyle = LINE
        ctx.fillRect(x, h / 2 - 16, bw, 32)
        ctx.strokeRect(x, h / 2 - 16, bw, 32)
        x += bw + 6
        if (x > w - 40) break
      }
      ctx.fillStyle = DIM
      ctx.font = '9px "JetBrains Mono", monospace'
      ctx.fillText('malloc → split · free → coalesce', 14, h / 2 + 36)
      break
    }
    case 'paging': {
      const k = Math.floor(t * 1.2) % 4
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = i === k ? CYAN : DIM
        ctx.fillStyle = i === k ? 'rgba(34,211,238,.2)' : 'transparent'
        ctx.fillRect(16 + i * 34, 24, 26, 26)
        ctx.strokeRect(16 + i * 34, 24, 26, 26)
        const phys = [2, 0, 3, 1][i]
        ctx.strokeStyle = phys === k ? CYAN : DIM
        ctx.beginPath()
        ctx.moveTo(29 + i * 34, 50)
        ctx.lineTo(29 + phys * 34, 76)
        ctx.stroke()
      }
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = DIM
        ctx.strokeRect(16 + i * 34, 76, 26, 26)
      }
      ctx.fillStyle = DIM
      ctx.font = '9px "JetBrains Mono", monospace'
      ctx.fillText('vpn → pfn', 16, 122)
      break
    }
    case 'roofline': {
      ctx.strokeStyle = DIM
      ctx.beginPath()
      ctx.moveTo(20, h - 24)
      ctx.lineTo(w - 16, h - 24)
      ctx.moveTo(20, h - 24)
      ctx.lineTo(20, 16)
      ctx.stroke()
      // roofline: rising slope then flat roof
      ctx.strokeStyle = MINT
      ctx.beginPath()
      ctx.moveTo(20, h - 24)
      ctx.lineTo(w * 0.45, 40)
      ctx.lineTo(w - 16, 40)
      ctx.stroke()
      const p = (t * 0.12) % 1
      const x = 20 + p * (w - 36)
      const y = x < w * 0.45 ? h - 24 - ((x - 20) / (w * 0.45 - 20)) * (h - 88) : 40
      ctx.fillStyle = AMBER
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'wgsl': {
      const lines = [
        '@compute @workgroup_size(64)',
        'fn main(@builtin(global_invocation_id)',
        '  id: vec3<u32>) {',
        '  let i = id.x;',
        '  out[i] = in[i] * scale;',
        '}',
      ]
      ctx.font = '10px "JetBrains Mono", monospace'
      const off = (t * 14) % 18
      for (let i = 0; i < 7; i++) {
        const line = lines[(i + Math.floor(t * 14 / 18)) % lines.length]
        ctx.fillStyle = i === 3 ? MINT : DIM
        ctx.fillText(line, 14, 26 + i * 18 - off)
      }
      break
    }
    case 'quantizer': {
      const rows: Array<[string, string, number]> = [
        ['FP16', MINT, 0.95],
        ['INT8', CYAN, 0.62],
        ['INT4', AMBER, 0.34],
      ]
      rows.forEach(([label, color, base], i) => {
        const y = 26 + i * 34
        ctx.fillStyle = DIM
        ctx.font = '9px "JetBrains Mono", monospace'
        ctx.fillText(label, 14, y + 10)
        const wob = 1 + 0.06 * Math.sin(t * 2 + i)
        ctx.fillStyle = color
        ctx.fillRect(56, y, (w - 76) * base * wob, 14)
      })
      break
    }
    case 'kv-calc': {
      const pct = 0.5 + 0.5 * Math.sin(t * 0.5)
      const tokens = Math.floor(120000 + 80000 * pct)
      ctx.fillStyle = MINT
      ctx.font = '700 22px "Space Grotesk", sans-serif'
      ctx.fillText(`${tokens.toLocaleString()} tok`, 16, 42)
      ctx.strokeStyle = LINE
      ctx.strokeRect(16, 58, w - 32, 12)
      ctx.fillStyle = 'rgba(62,242,164,.7)'
      ctx.fillRect(16, 58, (w - 32) * (0.4 + 0.5 * pct), 12)
      ctx.fillStyle = DIM
      ctx.font = '9px "JetBrains Mono", monospace'
      ctx.fillText('0.31 MB/token @ 70B', 16, 92)
      break
    }
    case 'batching': {
      for (let r = 0; r < 4; r++) {
        const y = 18 + r * 26
        ctx.strokeStyle = LINE
        ctx.beginPath()
        ctx.moveTo(14, y + 8)
        ctx.lineTo(w - 14, y + 8)
        ctx.stroke()
        const speed = 0.06 + r * 0.02
        const p = (t * speed + r * 0.3) % 1
        const bw = 30 + 18 * Math.sin(r * 2)
        ctx.fillStyle = r % 2 ? CYAN : MINT
        ctx.globalAlpha = 0.8
        ctx.fillRect(14 + p * (w - 28 - bw), y, bw, 16)
        ctx.globalAlpha = 1
      }
      break
    }
    case 'engine':
    default: {
      const labels = ['tok', 'embed', 'fwd', 'sample']
      labels.forEach((label, i) => {
        const x = 16 + i * ((w - 60) / 3)
        ctx.strokeStyle = ROSE
        ctx.strokeRect(x, h / 2 - 14, 44, 28)
        ctx.fillStyle = ROSE
        ctx.font = '8px "JetBrains Mono", monospace'
        ctx.fillText(label, x + 6, h / 2 + 3)
        if (i < 3) {
          const nx = 16 + (i + 1) * ((w - 60) / 3)
          ctx.strokeStyle = DIM
          ctx.setLineDash([4, 4])
          ctx.lineDashOffset = -t * 20
          ctx.beginPath()
          ctx.moveTo(x + 44, h / 2)
          ctx.lineTo(nx, h / 2)
          ctx.stroke()
          ctx.setLineDash([])
        }
      })
      break
    }
  }
}

/** Mini live preview: ~8fps idle, 30fps while hovered ("wakes up"). */
function PreviewCanvas({ simId }: { simId: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [hot, setHot] = useState(false)
  const hotRef = useRef(false)

  useEffect(() => {
    hotRef.current = hot
  }, [hot])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = 308
    const H = 132
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let last = 0
    const loop = (now: number) => {
      const fps = hotRef.current ? 30 : 8
      if (now - last >= 1000 / fps) {
        last = now
        drawPreview(ctx, simId, now / 1000, W, H)
      }
      raf = requestAnimationFrame(loop)
    }
    if (reduced) drawPreview(ctx, simId, 1.7, W, H)
    else raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [simId])

  return (
    <canvas
      ref={ref}
      style={{ width: '100%', height: 132, display: 'block' }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      role="img"
      aria-label={`Animated preview of the ${simId} simulator`}
    />
  )
}

function SimCard({ sim }: { sim: SimMeta }) {
  const track = getTrack(sim.trackId)
  const Icon = sim.icon
  return (
    <Link
      to={`/lab/${sim.id}`}
      className="group flex w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-line bg-surface-1 transition-all duration-180 hover:-translate-y-1.5 hover:border-line-bright hover:shadow-[0_12px_32px_rgba(0,0,0,.4)] md:w-[340px]"
    >
      <div className="border-b border-line bg-ink/40 px-4 pt-3">
        <PreviewCanvas simId={sim.id} />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-2.5">
          <Icon size={18} strokeWidth={1.75} style={{ color: track?.color }} />
          <h3 className="font-display text-h4 text-text-1">{sim.name}</h3>
        </div>
        <p className="mt-1.5 flex-1 text-body-sm text-text-2">{sim.hook}</p>
        <div className="mt-4 flex items-center gap-2 font-mono text-[10px]">
          <span
            className="rounded-full border px-2 py-0.5"
            style={{ color: track?.color, borderColor: `${track?.color}55` }}
          >
            {track?.code}
          </span>
          <span className="rounded-full border border-line px-2 py-0.5 text-text-3">
            used in {sim.usedIn}
          </span>
          <span className="ml-auto tracking-[0.2em] text-text-3" aria-label={`difficulty ${sim.difficulty} of 3`}>
            {'●'.repeat(sim.difficulty)}
            <span className="text-surface-3">{'●'.repeat(3 - sim.difficulty)}</span>
          </span>
        </div>
      </div>
    </Link>
  )
}

/**
 * The Lab Showcase (home.md §6) — horizontal scroll-snap strip of 9 SimCards
 * with live mini-previews + a terminal capstone gradient card.
 */
export default function SimShowcase() {
  const stripRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = stripRef.current
    if (!el) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      el.scrollBy({ left: 356, behavior: 'smooth' })
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      el.scrollBy({ left: -356, behavior: 'smooth' })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 60 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        ref={stripRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="region"
        aria-label="Simulator showcase, horizontally scrollable"
        className="scrollbar-slim mask-edge-x flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 focus-visible:outline-accent lg:px-12"
      >
        {SIMS.map((sim) => (
          <SimCard key={sim.id} sim={sim} />
        ))}

        {/* + capstone gradient terminal card */}
        <Link
          to="/capstone"
          className="group relative w-[300px] shrink-0 snap-start overflow-hidden rounded-lg p-px md:w-[340px]"
        >
          <span
            aria-hidden
            className="absolute inset-[-120%] animate-spin-slow bg-[conic-gradient(from_0deg,#3EF2A4,#22D3EE,#A78BFA,#3EF2A4)]"
          />
          <span className="relative flex h-full flex-col items-start justify-between gap-8 rounded-lg bg-surface-1 p-6">
            <span className="font-mono text-label uppercase text-text-3">then</span>
            <span>
              <span className="block font-display text-h3 text-grad-brand">+ capstone</span>
              <span className="mt-2 block text-body-sm text-text-2">
                Assemble all nine ideas into a working toy inference engine.
              </span>
            </span>
            <span className="flex items-center gap-2 font-mono text-xs text-accent">
              open <ArrowRight size={14} strokeWidth={1.75} className="transition-transform duration-150 group-hover:translate-x-1" />
            </span>
          </span>
        </Link>
      </div>
    </motion.div>
  )
}
