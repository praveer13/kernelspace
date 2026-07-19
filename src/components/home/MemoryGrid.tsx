import { useEffect, useRef, useState } from 'react'

const N = 16 // 16×16 grid
const CELL = 28
const GAP = 2
const GRID = N * CELL + (N - 1) * GAP // 478
const PAD = (520 - GRID) / 2 // 21
const KV_ROWS = 4 // top rows: cyan "KV blocks"
const FRAG_ROWS = 2 // bottom rows: amber "frag"

const INK = '#07090D'
const IDLE = '#182130'
const MINT = '#3EF2A4'
const CYAN = '#22D3EE'
const AMBER = '#FFB224'

function hex(n: number, w: number) {
  return `0x${n.toString(16).toUpperCase().padStart(w, '0')}`
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`
}

interface Wave {
  cells: number[]
  start: number
  phase: 'fill' | 'hold' | 'free'
}

/**
 * The Interactive Memory Grid (home.md §1) — 16×16 canvas of "bytes".
 * Hover touches a cell (mint flash + hex address + READ log), an allocation
 * wave ripples every 2.4s, top rows are tinted cyan (KV blocks) and the
 * bottom rows amber (fragmentation). Boot-sequence fill on mount.
 */
export default function MemoryGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const reticleRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({
    flash: new Float32Array(N * N),
    waveAlpha: new Float32Array(N * N),
    hover: -1,
    wave: null as Wave | null,
    nextWaveAt: 0,
    boot: 0,
    reads: 0,
    writes: 0,
    reduced: false,
    raf: 0,
    lastT: 0,
  })
  const [log, setLog] = useState('IDLE — hover the grid')
  const [rw, setRw] = useState({ r: 0, w: 0 })

  useEffect(() => {
    const s = stateRef.current
    s.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = 520 * dpr
    canvas.height = 520 * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const bootStart = performance.now()
    s.nextWaveAt = bootStart + (s.reduced ? Infinity : 2400)

    const cellRect = (i: number) => {
      const r = Math.floor(i / N)
      const c = i % N
      return { x: PAD + c * (CELL + GAP), y: PAD + r * (CELL + GAP), r, c }
    }

    const baseFor = (r: number): string => {
      if (r < KV_ROWS) return lerpColor(IDLE, CYAN, 0.22)
      if (r >= N - FRAG_ROWS) return lerpColor(IDLE, AMBER, 0.2)
      return IDLE
    }

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - s.lastT) / 1000 || 0.016)
      s.lastT = now

      // boot progress: 16 rows × 40ms
      if (s.reduced) s.boot = 1
      else s.boot = Math.min(1, (now - bootStart) / (N * 40 + 200))

      // wave lifecycle
      if (!s.reduced) {
        if (!s.wave && now >= s.nextWaveAt) {
          const isRow = Math.random() < 0.5
          const cells: number[] = []
          if (isRow) {
            const row = Math.floor(Math.random() * N)
            for (let c = 0; c < N; c++) cells.push(row * N + c)
          } else {
            const bw = 4
            const r0 = Math.floor(Math.random() * (N - 3))
            const c0 = Math.floor(Math.random() * (N - bw))
            for (let r = r0; r < r0 + 3; r++) for (let c = c0; c < c0 + bw; c++) cells.push(r * N + c)
          }
          s.wave = { cells, start: now, phase: 'fill' }
          s.writes += 1
          setRw({ r: s.reads, w: s.writes })
        }
        if (s.wave) {
          const w = s.wave
          const el = now - w.start
          if (w.phase === 'fill') {
            let allFull = true
            w.cells.forEach((cell, k) => {
              const p = Math.min(1, Math.max(0, (el - k * (300 / w.cells.length)) / 300))
              s.waveAlpha[cell] = p
              if (p < 1) allFull = false
            })
            if (allFull) {
              w.phase = 'hold'
              w.start = now
            }
          } else if (w.phase === 'hold' && el > 1200) {
            w.phase = 'free'
            w.start = now
          } else if (w.phase === 'free') {
            let allZero = true
            w.cells.forEach((cell, k) => {
              const p = 1 - Math.min(1, Math.max(0, (el - k * (300 / w.cells.length)) / 300))
              s.waveAlpha[cell] = p
              if (p > 0) allZero = false
            })
            if (allZero) {
              s.wave = null
              s.nextWaveAt = now + 2400
            }
          }
        }
      } else {
        // static mid-allocation frame
        for (let c = 4; c < 9; c++) s.waveAlpha[6 * N + c] = 1
        for (let c = 2; c < 6; c++) s.waveAlpha[9 * N + c] = 1
      }

      // decay hover flashes
      for (let i = 0; i < N * N; i++) {
        if (s.flash[i] > 0) s.flash[i] = Math.max(0, s.flash[i] - dt * 2.2)
      }

      ctx.clearRect(0, 0, 520, 520)
      const bootedRows = Math.floor(s.boot * N)
      for (let i = 0; i < N * N; i++) {
        const { x, y, r } = cellRect(i)
        if (r > bootedRows) continue
        const rowBoot = s.boot * N - r // 0..1 within the booting row
        let fill = baseFor(r)
        const wa = s.waveAlpha[i]
        const fl = s.flash[i] + (s.hover === i ? 0.85 : 0)
        if (wa > 0) fill = lerpColor(fill, MINT, wa * 0.9)
        if (fl > 0) fill = lerpColor(fill, MINT, Math.min(1, fl))
        ctx.globalAlpha = Math.min(1, rowBoot + 0.15)
        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.roundRect(x, y, CELL, CELL, 3)
        ctx.fill()
        ctx.globalAlpha = 1
        // hex address on the hovered cell
        if (s.hover === i) {
          ctx.fillStyle = INK
          ctx.font = '500 8px "JetBrains Mono", monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(hex(i, 2), x + CELL / 2, y + CELL / 2 + 0.5)
        }
      }
    }

    // The loop always runs — reduced motion only skips waves/boot animation,
    // so hover flashes still paint (home.md §1 fallback: "no interactivity loss").
    const loop = (now: number) => {
      draw(now)
      s.raf = requestAnimationFrame(loop)
    }
    s.raf = requestAnimationFrame(loop)

    return () => cancelAnimationFrame(s.raf)
  }, [])

  // Hover handling: flash cell, update log + reticle (pure CSS transform).
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = stateRef.current
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const reticle = reticleRef.current
    if (!canvas || !wrap || !reticle) return
    const rect = canvas.getBoundingClientRect()
    const scale = 520 / rect.width
    const x = (e.clientX - rect.left) * scale
    const y = (e.clientY - rect.top) * scale
    const c = Math.floor((x - PAD) / (CELL + GAP))
    const r = Math.floor((y - PAD) / (CELL + GAP))
    const inX = (x - PAD) % (CELL + GAP) <= CELL
    const inY = (y - PAD) % (CELL + GAP) <= CELL
    const idx = r >= 0 && r < N && c >= 0 && c < N && inX && inY ? r * N + c : -1

    if (idx !== s.hover) {
      s.hover = idx
      if (idx >= 0) {
        s.flash[idx] = 1
        s.reads += 1
        setRw({ r: s.reads, w: s.writes })
        setLog(`READ  ${hex(idx, 4)} → ${hex(Math.floor(Math.random() * 256), 2)}`)
      } else {
        setLog('IDLE — hover the grid')
      }
    }

    // reticle snapped to the cell (8px grid snap), mono coordinate readout
    const wrapRect = wrap.getBoundingClientRect()
    const px = ((PAD + c * (CELL + GAP)) / 520) * rect.width + (rect.left - wrapRect.left)
    const py = ((PAD + r * (CELL + GAP)) / 520) * rect.width + (rect.top - wrapRect.top)
    reticle.style.opacity = idx >= 0 ? '1' : '0'
    reticle.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px) scale(${rect.width / 520})`
    reticle.textContent = idx >= 0 ? hex(idx, 2) : ''
  }

  const onLeave = () => {
    stateRef.current.hover = -1
    if (reticleRef.current) reticleRef.current.style.opacity = '0'
    setLog('IDLE — hover the grid')
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
      {/* memory-map header strip */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-[11px] tracking-wide text-text-3">
        <span>0x0000 — REGION: HBM</span>
        <span>
          <span className="text-accent">r {rw.r}</span>
          <span className="mx-1.5 text-text-3">·</span>
          <span className="text-info">w {rw.w}</span>
        </span>
      </div>

      <div ref={wrapRef} className="relative">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', aspectRatio: '1 / 1', display: 'block', cursor: 'crosshair' }}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          role="img"
          aria-label="Interactive 16 by 16 memory grid. Hovering a cell reads its hex address. Top rows are KV cache blocks, bottom rows are fragmented."
        />
        {/* pointer reticle: 12px crosshair + mono coordinate, CSS transform only */}
        <div
          ref={reticleRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 flex h-7 w-7 origin-top-left items-center justify-center border border-accent/70 font-mono text-[8px] text-accent opacity-0 transition-opacity duration-100"
          style={{ willChange: 'transform' }}
        />
      </div>

      {/* readout + legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <span className="font-mono text-[11px] text-accent">{log}</span>
        <div className="flex items-center gap-3 font-mono text-[10px] text-text-3">
          <span>
            <span className="text-accent">■</span> allocated
          </span>
          <span>
            <span className="text-t2">■</span> kv-cache
          </span>
          <span>
            <span className="text-amber">■</span> fragmented
          </span>
        </div>
      </div>
    </div>
  )
}
