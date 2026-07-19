/**
 * SIM-01 `sim-memory` — Memory Grid Visualizer (playground.md §4).
 * A 256-byte linear address space (16×16 cells): locked .text, heap, downward
 * stack. Pointer toolkit (&p / *p / write / free) + scripted mistakes
 * (null deref, use-after-free, stack smash) that trigger the segfault sequence.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { motion } from 'framer-motion'
import { Bomb, Dices, MapPin } from 'lucide-react'
import PlaygroundShell, {
  ChipButton,
  ControlGroup,
  LogConsole,
  TransportBar,
  completeSimTask,
  useInitialCfg,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
  useWriteCfg,
} from '@/components/sims/PlaygroundShell'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const SIM_ID = 'sim-memory'

const CODE_END = 0x3f
const HEAP_END = 0xbf
const STACK_START = 0xc0

/* grid geometry (px) — 8px-grid aligned */
const CELL = 24
const GAP = 2
const LABEL_W = 30
const LABEL_T = 22
const GRID_W = LABEL_W + 16 * CELL + 15 * GAP
const GRID_H = LABEL_T + 16 * CELL + 15 * GAP

const hx = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`

type Region = 'code' | 'heap' | 'stack'
const regionOf = (addr: number): Region => {
  if (addr <= CODE_END) return 'code'
  if (addr >= STACK_START) return 'stack'
  return 'heap'
}

type HeapMark = 'used' | 'freed'
type Tool = 'pointer' | 'deref' | 'write' | 'free'
type SegReason = 'null' | 'uaf' | 'stack'

interface MemState {
  bytes: number[]
  heap: Record<number, HeapMark>
  pointers: Record<number, number>
  /** next free stack slot; 0x100 = empty, grows downward */
  stackTop: number
  segfault: { addr: number; reason: SegReason } | null
}

const blankMem = (): MemState => ({
  bytes: new Array<number>(256).fill(0),
  heap: {},
  pointers: {},
  stackTop: 0x100,
  segfault: null,
})

/* -------- shareable config (URL ?cfg=) -------- */
interface MemCfg {
  b: string // bytes as base64
  h: Record<number, HeapMark>
  p: Record<number, number>
  s: number // stackTop
}

function memToCfg(m: MemState): MemCfg {
  let bin = ''
  for (let i = 0; i < 256; i += 1) bin += String.fromCharCode(m.bytes[i])
  return { b: btoa(bin), h: m.heap, p: m.pointers, s: m.stackTop }
}

function cfgToMem(cfg: MemCfg | null): MemState {
  const m = blankMem()
  if (!cfg) return m
  try {
    const bin = atob(cfg.b)
    for (let i = 0; i < 256 && i < bin.length; i += 1) m.bytes[i] = bin.charCodeAt(i)
    m.heap = cfg.h ?? {}
    m.pointers = cfg.p ?? {}
    m.stackTop = typeof cfg.s === 'number' ? cfg.s : 0x100
  } catch {
    /* corrupt cfg → blank process */
  }
  return m
}

/* -------- scripted mistakes -------- */
type ScenarioStep =
  | { op: 'write'; addr: number; value: number }
  | { op: 'pointer'; at: number; to: number }
  | { op: 'deref'; at: number }
  | { op: 'free'; addr: number }
  | { op: 'push' }

const SCENARIOS: Record<string, { label: string; fast?: boolean; steps: ScenarioStep[] }> = {
  null: {
    label: 'null deref',
    steps: [
      { op: 'pointer', at: 0x90, to: 0x00 },
      { op: 'deref', at: 0x90 },
    ],
  },
  uaf: {
    label: 'use-after-free',
    steps: [
      { op: 'write', addr: 0x80, value: 0x2a },
      { op: 'pointer', at: 0x90, to: 0x80 },
      { op: 'free', addr: 0x80 },
      { op: 'deref', at: 0x90 },
    ],
  },
  smash: {
    label: 'stack smash',
    fast: true,
    steps: Array.from({ length: 74 }, () => ({ op: 'push' }) as ScenarioStep),
  },
}

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'pointer', label: '&p point', hint: 'click a cell, then its target' },
  { id: 'deref', label: '*p deref', hint: 'click a pointer cell to read through it' },
  { id: 'write', label: 'write', hint: 'click a cell to store the panel byte' },
  { id: 'free', label: 'free', hint: 'click a used heap cell to release it' },
]

const SEGFAULT_COPY: Record<SegReason, { title: string; body: string }> = {
  null: {
    title: 'Null pointer dereference',
    body: 'The pointer held 0x00 — and the kernel deliberately never maps the page containing address zero. The CPU raised a page fault, the kernel found no mapping, and delivered SIGSEGV. Your process died and dumped core. Java/Python hide this behind NullPointerException/None checks; in C it is a bullet in the foot.',
  },
  uaf: {
    title: 'Use-after-free',
    body: 'You freed the cell, then read through a stale pointer. This time the allocator gave the page back and the kernel said no — SIGSEGV. The scary truth: often the memory is still mapped and you silently read (or corrupt) someone else\'s data. That is why UAF is the #1 source of CVEs in C codebases.',
  },
  stack: {
    title: 'Stack overflow into the heap',
    body: 'The stack grows downward from 0xFF; the heap lives below it. Push enough frames and the two collide — here the kernel\'s guard page fired SIGSEGV before the stack could trample live heap data. This exact collision is what "stack smashing" exploits try to weaponize.',
  },
}

export default function MemoryGridSim() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  /* ------- state (ref-mirrored so event-driven ops stay atomic) ------- */
  const initialCfg = useInitialCfg<MemCfg>()
  const [mem, setMemState] = useState<MemState>(() => cfgToMem(initialCfg))
  const memRef = useRef<MemState>(mem)
  const setMem = useCallback((next: MemState) => {
    memRef.current = next
    setMemState(next)
  }, [])

  const [tool, setTool] = useState<Tool>('write')
  const [writeHex, setWriteHex] = useState('2A')
  const [pendingPointer, setPendingPointer] = useState<number | null>(null)
  const [flashes, setFlashes] = useState<Record<number, number>>({})
  const [script, setScript] = useState<{ name: string; idx: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [faultOpen, setFaultOpen] = useState(false)

  const ticksRef = useRef(0)
  const [ticks, setTicks] = useState(0)
  const bump = useCallback(() => {
    ticksRef.current += 1
    setTicks(ticksRef.current)
    return ticksRef.current
  }, [])

  useWriteCfg(memToCfg(mem))

  const flash = useCallback((addr: number) => {
    const key = Date.now()
    setFlashes((prev) => {
      const next: Record<number, number> = {}
      for (const k of Object.keys(prev)) {
        if (key - prev[Number(k)] < 900) next[Number(k)] = prev[Number(k)]
      }
      next[addr] = key
      return next
    })
  }, [])

  /* ------------------------------ ops ------------------------------ */
  const segfaultAt = useCallback(
    (addr: number, reason: SegReason) => {
      const prev = memRef.current
      setMem({ ...prev, segfault: { addr, reason } })
      setPlaying(false)
      log(ticksRef.current, 'FAULT', `SEGFAULT at ${hx(addr)} — core dumped`, 'err')
      if (reason === 'null') completeSimTask(SIM_ID, 't-null', 60)
      if (reason === 'stack') completeSimTask(SIM_ID, 't-smash', 60)
      setFaultOpen(true)
    },
    [log, setMem],
  )

  const doWrite = useCallback(
    (addr: number, value: number) => {
      const t = bump()
      const prev = memRef.current
      if (prev.segfault) return
      if (regionOf(addr) === 'code') {
        log(t, 'WRITE', `${hx(addr)} ✗ read-only (.text)`, 'warn')
        return
      }
      const bytes = prev.bytes.slice()
      bytes[addr] = value
      const heap = { ...prev.heap }
      if (regionOf(addr) === 'heap') heap[addr] = 'used'
      setMem({ ...prev, bytes, heap })
      flash(addr)
      log(t, 'WRITE', `${hx(addr)} ← ${hx(value)}`)
      if (addr === 0x80 && value === 0x2a) completeSimTask(SIM_ID, 't-byte', 60)
    },
    [bump, flash, log, setMem],
  )

  const doPointer = useCallback(
    (at: number, to: number) => {
      const t = bump()
      const prev = memRef.current
      if (prev.segfault) return
      if (regionOf(at) === 'code') {
        log(t, 'PTR', `${hx(at)} ✗ read-only (.text)`, 'warn')
        return
      }
      const bytes = prev.bytes.slice()
      bytes[at] = to & 0xff
      const heap = { ...prev.heap }
      if (regionOf(at) === 'heap') heap[at] = 'used'
      setMem({ ...prev, bytes, heap, pointers: { ...prev.pointers, [at]: to } })
      flash(at)
      log(t, 'PTR', `&p ${hx(at)} → ${hx(to)}`)
    },
    [bump, flash, log, setMem],
  )

  const doDeref = useCallback(
    (at: number) => {
      const t = bump()
      const prev = memRef.current
      if (prev.segfault) return
      const to = prev.pointers[at]
      if (to === undefined) {
        log(t, 'DEREF', `${hx(at)} ✗ not a pointer`, 'warn')
        return
      }
      if (to === 0x00) {
        log(t, 'DEREF', `${hx(0)} ✗ SEGFAULT`, 'err')
        segfaultAt(0x00, 'null')
        return
      }
      if (regionOf(to) === 'heap' && prev.heap[to] === 'freed') {
        log(t, 'DEREF', `*${hx(at)} → freed ${hx(to)} ✗`, 'err')
        segfaultAt(to, 'uaf')
        return
      }
      const v = prev.bytes[to]
      flash(to)
      log(t, 'READ', `*${hx(at)} → ${hx(v)} ✓`, 'ok')
      if (at === 0x90 && to === 0x80 && v === 0x2a) completeSimTask(SIM_ID, 't-deref', 60)
    },
    [bump, flash, log, segfaultAt],
  )

  const doFree = useCallback(
    (addr: number) => {
      const t = bump()
      const prev = memRef.current
      if (prev.segfault) return
      if (regionOf(addr) !== 'heap') {
        log(t, 'FREE', `${hx(addr)} ✗ not a heap cell`, 'warn')
        return
      }
      if (prev.heap[addr] !== 'used') {
        log(t, 'FREE', `${hx(addr)} ✗ double free / already free`, 'warn')
        return
      }
      setMem({ ...prev, heap: { ...prev.heap, [addr]: 'freed' } })
      flash(addr)
      log(t, 'FREE', `${hx(addr)} released`)
    },
    [bump, flash, log, setMem],
  )

  const doPush = useCallback(() => {
    const t = bump()
    const prev = memRef.current
    if (prev.segfault) return
    const top = prev.stackTop - 1
    const bytes = prev.bytes.slice()
    bytes[top] = 0x42
    setMem({ ...prev, bytes, stackTop: top })
    log(t, 'PUSH', `rsp → ${hx(top)}`)
    if (top === HEAP_END) {
      log(t, 'WARN', 'stack crossed 0xC0 — colliding with the heap', 'warn')
    }
    if (top <= HEAP_END - 8) {
      segfaultAt(top, 'stack')
    }
  }, [bump, log, segfaultAt, setMem])

  /* --------------------------- scenario --------------------------- */
  const applyStep = useCallback(() => {
    setScript((cur) => {
      if (!cur) {
        setPlaying(false)
        return cur
      }
      const def = SCENARIOS[cur.name]
      if (cur.idx >= def.steps.length) {
        setPlaying(false)
        return null
      }
      const step = def.steps[cur.idx]
      switch (step.op) {
        case 'write':
          doWrite(step.addr, step.value)
          break
        case 'pointer':
          doPointer(step.at, step.to)
          break
        case 'deref':
          doDeref(step.at)
          break
        case 'free':
          doFree(step.addr)
          break
        case 'push':
          doPush()
          break
      }
      return { ...cur, idx: cur.idx + 1 }
    })
  }, [doDeref, doFree, doPointer, doPush, doWrite])

  const applyStepRef = useRef(applyStep)
  useEffect(() => {
    applyStepRef.current = applyStep
  }, [applyStep])

  const armScenario = useCallback(
    (name: string) => {
      if (memRef.current.segfault) return
      log(ticksRef.current, 'ARM', `${SCENARIOS[name].label} — scripted mistake running`, 'warn')
      setScript({ name, idx: 0 })
      setPlaying(true)
    },
    [log],
  )

  useEffect(() => {
    if (!playing) return
    const fast = script ? SCENARIOS[script.name]?.fast : false
    const base = fast ? 120 : 650
    const id = window.setInterval(() => applyStepRef.current(), base / speed)
    return () => window.clearInterval(id)
  }, [playing, speed, script])

  const reset = useCallback(() => {
    setMem(blankMem())
    setScript(null)
    setPlaying(false)
    setPendingPointer(null)
    setFlashes({})
    ticksRef.current = 0
    setTicks(0)
    setFaultOpen(false)
    log(0, 'RESET', 'memory zeroed — fresh process spawned')
  }, [log, setMem])

  /* --------------------------- interaction --------------------------- */
  const writeValue = Math.min(255, Math.max(0, parseInt(writeHex || '0', 16) || 0))

  const onCellClick = useCallback(
    (addr: number) => {
      if (memRef.current.segfault) return
      switch (tool) {
        case 'write':
          doWrite(addr, writeValue)
          break
        case 'free':
          doFree(addr)
          break
        case 'deref':
          doDeref(addr)
          break
        case 'pointer':
          if (pendingPointer === null) {
            if (regionOf(addr) === 'code') {
              log(ticksRef.current, 'PTR', `${hx(addr)} ✗ read-only (.text)`, 'warn')
              return
            }
            setPendingPointer(addr)
            log(ticksRef.current, 'PTR', `&p armed at ${hx(addr)} — click a target`)
          } else {
            doPointer(pendingPointer, addr)
            setPendingPointer(null)
          }
          break
      }
    },
    [doDeref, doFree, doPointer, doWrite, log, pendingPointer, tool, writeValue],
  )

  /* reticle — direct DOM updates, no re-render cost */
  const reticleRef = useRef<HTMLDivElement>(null)
  const reticleTextRef = useRef<HTMLSpanElement>(null)
  const onGridMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('[data-addr]') as HTMLElement | null
    const ret = reticleRef.current
    if (!ret) return
    if (!target) {
      ret.style.opacity = '0'
      return
    }
    const addr = Number(target.dataset.addr)
    const col = addr % 16
    const row = Math.floor(addr / 16)
    ret.style.opacity = '1'
    ret.style.transform = `translate(${LABEL_W + col * (CELL + GAP)}px, ${LABEL_T + row * (CELL + GAP)}px)`
    if (reticleTextRef.current) reticleTextRef.current.textContent = hx(addr)
  }, [])

  const cellCenter = (addr: number) => ({
    x: LABEL_W + (addr % 16) * (CELL + GAP) + CELL / 2,
    y: LABEL_T + Math.floor(addr / 16) * (CELL + GAP) + CELL / 2,
  })

  const segfault = mem.segfault

  /* ------------------------------ render ------------------------------ */
  const HATCH_CODE =
    'repeating-linear-gradient(45deg, rgba(93,107,128,0.12) 0 2px, transparent 2px 6px)'
  const HATCH_FREED =
    'repeating-linear-gradient(45deg, rgba(255,178,36,0.18) 0 2px, transparent 2px 6px)'

  const cellView = (addr: number) => {
    const region = regionOf(addr)
    const heapMark = mem.heap[addr]
    const isStackLive = addr >= mem.stackTop
    const isFault = segfault?.addr === addr

    if (isFault)
      return { cls: 'border-danger bg-danger/60 text-[#FFD7DC]', hatch: undefined, cursor: 'cursor-not-allowed' }
    if (isStackLive)
      return {
        cls: 'border-[#A78BFA]/70 bg-[#A78BFA]/30 text-[#D9CCFF] hover:border-[#A78BFA]',
        hatch: undefined,
        cursor: 'cursor-crosshair',
      }
    if (region === 'code')
      return { cls: 'border-line/60 bg-surface-1 text-text-3/40', hatch: HATCH_CODE, cursor: 'cursor-not-allowed' }
    if (region === 'heap') {
      if (heapMark === 'used')
        return { cls: 'border-accent/70 bg-accent/25 text-accent hover:border-accent', hatch: undefined, cursor: 'cursor-crosshair' }
      if (heapMark === 'freed')
        return { cls: 'border-amber/50 bg-surface-2 text-amber/80 hover:border-amber', hatch: HATCH_FREED, cursor: 'cursor-crosshair' }
      return { cls: 'border-line bg-surface-3/40 text-text-3 hover:border-line-bright', hatch: undefined, cursor: 'cursor-crosshair' }
    }
    return {
      cls: 'border-line/70 bg-[#A78BFA]/10 text-[#A78BFA]/40 hover:border-[#A78BFA]/60',
      hatch: undefined,
      cursor: 'cursor-crosshair',
    }
  }

  const describeCell = (addr: number): string => {
    const region = regionOf(addr)
    const v = mem.bytes[addr]
    const ptr = mem.pointers[addr]
    const parts = [`${hx(addr)} · ${region}`]
    if (addr >= mem.stackTop) parts.push('stack live')
    else if (region === 'heap') parts.push(mem.heap[addr] ?? 'free')
    else if (region === 'code') parts.push('locked')
    parts.push(`= ${hx(v)}`)
    if (ptr !== undefined) parts.push(`ptr → ${hx(ptr)}`)
    return parts.join(' · ')
  }

  return (
    <PlaygroundShell
      simId={SIM_ID}
      title="Memory Grid Visualizer"
      subtitle="pointers · segfaults · 256 bytes of truth"
      tasks={[
        { id: 't-byte', text: 'Store 0x2A at address 0x80', xp: 60 },
        { id: 't-deref', text: 'Point 0x90 at 0x80 and dereference it', xp: 60 },
        { id: 't-null', text: 'Dereference null and survive (run null deref)', xp: 60 },
        { id: 't-smash', text: 'Overflow the stack into the heap', xp: 60 },
      ]}
      help={
        <>
          <p>
            One process, 256 bytes of linear memory.{' '}
            <span className="font-mono text-text-1">0x00–0x3F</span> is the locked .text
            segment, <span className="font-mono text-text-1">0x40–0xBF</span> is the heap, and{' '}
            <span className="font-mono text-text-1">0xC0–0xFF</span> is the stack growing
            downward.
          </p>
          <p>
            Pick a tool: <span className="font-mono text-amber">&p</span> stores an address in a
            cell (a pointer), <span className="font-mono text-amber">*p</span> reads through it,{' '}
            <span className="font-mono text-accent">write</span> stores the panel byte, and{' '}
            <span className="font-mono text-danger">free</span> releases a heap cell. The scenario
            buttons arm scripted mistakes — each one kills the process so you can watch exactly
            how.
          </p>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ------- stage ------- */}
          <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
            {/* region strip */}
            <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                .text 0x00–0x3F · locked
              </span>
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                heap 0x40–0xBF
              </span>
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                stack 0xC0–0xFF ↓ grows down
              </span>
              {segfault && (
                <span className="rounded-sm border border-danger/50 bg-danger/10 px-2 py-0.5 text-danger">
                  SIGSEGV — core dumped
                </span>
              )}
              {pendingPointer !== null && (
                <span className="flex items-center gap-1 rounded-sm border border-amber/50 bg-amber/10 px-2 py-0.5 text-amber">
                  <MapPin size={10} strokeWidth={1.75} /> &p armed at {hx(pendingPointer)} — click a
                  target
                </span>
              )}
            </div>

            <motion.div
              key={segfault ? `fault-${segfault.addr}-${segfault.reason}` : 'ok'}
              animate={segfault && !reducedMotion ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
              transition={{ duration: 0.3 }}
              className="w-fit"
            >
              <div
                className="relative cursor-crosshair select-none"
                style={{ width: GRID_W, height: GRID_H }}
                onPointerMove={onGridMove}
                onPointerLeave={() => {
                  if (reticleRef.current) reticleRef.current.style.opacity = '0'
                }}
                role="img"
                aria-label={`256-byte memory grid. ${Object.keys(mem.pointers).length} live pointers, stack top ${hx(mem.stackTop & 0xff)}.`}
              >
                {/* axis labels */}
                {Array.from({ length: 16 }, (_, c) => (
                  <span
                    key={`col-${c}`}
                    className="absolute text-center font-mono text-[8px] leading-none text-text-3"
                    style={{ left: LABEL_W + c * (CELL + GAP), top: 6, width: CELL }}
                  >
                    {c.toString(16).toUpperCase()}
                  </span>
                ))}
                {Array.from({ length: 16 }, (_, r) => (
                  <span
                    key={`row-${r}`}
                    className="absolute text-right font-mono text-[8px] leading-none text-text-3"
                    style={{ left: 0, top: LABEL_T + r * (CELL + GAP) + 8, width: LABEL_W - 5 }}
                  >
                    {hx(r * 16)}
                  </span>
                ))}

                {/* cells */}
                <div
                  className="absolute grid"
                  style={{
                    left: LABEL_W,
                    top: LABEL_T,
                    gridTemplateColumns: `repeat(16, ${CELL}px)`,
                    gap: GAP,
                  }}
                >
                  {Array.from({ length: 256 }, (_, addr) => {
                    const view = cellView(addr)
                    const value = mem.bytes[addr]
                    const isPointer = mem.pointers[addr] !== undefined
                    const flashKey = flashes[addr]
                    return (
                      <button
                        key={addr}
                        type="button"
                        data-addr={addr}
                        onClick={() => onCellClick(addr)}
                        title={describeCell(addr)}
                        aria-label={describeCell(addr)}
                        className={cn(
                          'relative flex items-center justify-center rounded-[2px] border font-mono text-[8px] leading-none transition-colors duration-150',
                          view.cls,
                          view.cursor,
                          pendingPointer === addr && 'ring-2 ring-amber',
                        )}
                        style={{
                          width: CELL,
                          height: CELL,
                          backgroundImage: view.hatch,
                        }}
                      >
                        {value !== 0 || isPointer ? hx(value).slice(2) : ''}
                        {isPointer && (
                          <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-amber" />
                        )}
                        {flashKey && !reducedMotion && (
                          <motion.span
                            key={flashKey}
                            className="pointer-events-none absolute inset-0 rounded-[2px] border-2 border-accent"
                            initial={{ opacity: 0.9 }}
                            animate={{ opacity: 0 }}
                            transition={{ duration: 0.6 }}
                          />
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* pointer arrows */}
                <svg
                  className="pointer-events-none absolute inset-0 z-10"
                  width={GRID_W}
                  height={GRID_H}
                  aria-hidden
                >
                  <defs>
                    <marker
                      id="mem-arrowhead"
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L8,4 L0,8 z" fill="#FFB224" />
                    </marker>
                  </defs>
                  {Object.entries(mem.pointers).map(([fromStr, to]) => {
                    const from = Number(fromStr)
                    const p = cellCenter(from)
                    const t = cellCenter(to)
                    const mx = (p.x + t.x) / 2
                    const my = Math.min(p.y, t.y) - 26
                    const path = `M ${p.x} ${p.y} Q ${mx} ${my} ${t.x} ${t.y}`
                    return reducedMotion ? (
                      <path
                        key={from}
                        d={path}
                        fill="none"
                        stroke="#FFB224"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        markerEnd="url(#mem-arrowhead)"
                        opacity={0.9}
                      />
                    ) : (
                      <motion.path
                        key={from}
                        d={path}
                        fill="none"
                        stroke="#FFB224"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        markerEnd="url(#mem-arrowhead)"
                        opacity={0.9}
                        animate={{ strokeDashoffset: [0, -18] }}
                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                      />
                    )
                  })}
                </svg>

                {/* hover reticle */}
                <div
                  ref={reticleRef}
                  className="pointer-events-none absolute z-20 rounded-[2px] border border-accent opacity-0 transition-opacity duration-100"
                  style={{ width: CELL, height: CELL, left: 0, top: 0 }}
                  aria-hidden
                >
                  <span
                    ref={reticleTextRef}
                    className="absolute -top-5 left-0 rounded-[3px] border border-line bg-surface-2 px-1 py-0.5 font-mono text-[9px] text-accent"
                  />
                </div>
              </div>
            </motion.div>
          </div>

          {/* ------- control panel ------- */}
          <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
            <ControlGroup label="pointer toolkit">
              <div className="grid grid-cols-2 gap-1.5">
                {TOOLS.map((t) => (
                  <ChipButton
                    key={t.id}
                    active={tool === t.id}
                    color="#FFB224"
                    onClick={() => {
                      setTool(t.id)
                      setPendingPointer(null)
                    }}
                    className="text-center"
                  >
                    {t.label}
                  </ChipButton>
                ))}
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                {TOOLS.find((t) => t.id === tool)?.hint}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-text-3">0x</span>
                <input
                  value={writeHex}
                  onChange={(e) =>
                    setWriteHex(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 2).toUpperCase())
                  }
                  className="h-8 w-16 rounded-sm border border-line bg-surface-2 px-2 font-mono text-[12px] text-text-1 outline-none focus:border-accent"
                  aria-label="Byte value to write (hex)"
                />
                <ChipButton
                  onClick={() =>
                    setWriteHex(
                      Math.floor(Math.random() * 256)
                        .toString(16)
                        .toUpperCase()
                        .padStart(2, '0'),
                    )
                  }
                  className="flex items-center gap-1"
                >
                  <Dices size={12} strokeWidth={1.75} /> rand
                </ChipButton>
                <span className="ml-auto font-mono text-[10px] text-text-3">write byte</span>
              </div>
            </ControlGroup>

            <ControlGroup label="scripted mistakes">
              <div className="flex flex-col gap-1.5">
                {Object.entries(SCENARIOS).map(([key, s]) => (
                  <ChipButton
                    key={key}
                    color="#FF5C6C"
                    onClick={() => armScenario(key)}
                    className="text-left"
                  >
                    ▸ {s.label}
                  </ChipButton>
                ))}
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                each arms a classic footgun and runs it — step with → or let it play.
              </p>
            </ControlGroup>

            <ControlGroup label="legend" className="border-b-0">
              {[
                ['.text — locked', 'bg-surface-1 border-line/60'],
                ['heap — free', 'bg-surface-3/40 border-line'],
                ['heap — used', 'bg-accent/25 border-accent/70'],
                ['heap — freed (uaf bait)', 'bg-surface-2 border-amber/50'],
                ['stack — live frame', 'bg-[#A78BFA]/30 border-[#A78BFA]/70'],
                ['pointer cell', 'bg-surface-2 border-amber'],
              ].map(([label, cls]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-[2px] border', cls)} />
                  <span className="font-mono text-[10px] text-text-2">{label}</span>
                </div>
              ))}
            </ControlGroup>
          </aside>
        </div>

        <TransportBar
          playing={playing}
          onTogglePlay={() => setPlaying((v) => !v)}
          onStep={applyStep}
          onReset={reset}
          speed={speed}
          onSpeedChange={setSpeed}
          ticks={ticks}
          idle={!script}
        />
        {!embed && <LogConsole lines={lines} onClear={clear} />}
      </div>

      {/* ------- segfault modal ------- */}
      <Dialog open={faultOpen && !!segfault} onOpenChange={setFaultOpen}>
        <DialogContent className="border-danger/40 bg-surface-1 text-text-2 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-text-1">
              <Bomb size={18} strokeWidth={1.75} className="text-danger" />
              {segfault ? SEGFAULT_COPY[segfault.reason].title : ''}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-danger">
              SEGFAULT at {segfault ? hx(segfault.addr) : '0x??'} — core dumped
            </DialogDescription>
          </DialogHeader>
          <p className="text-body-sm leading-relaxed">
            {segfault ? SEGFAULT_COPY[segfault.reason].body : ''}
          </p>
          <div className="rounded-sm border border-line bg-ink px-3 py-2 font-mono text-[11px] text-text-3">
            rip=0x00400F3A rsp={hx(mem.stackTop & 0xff)} sig=SIGSEGV
          </div>
          <button
            type="button"
            onClick={() => {
              reset()
              setFaultOpen(false)
            }}
            className="mt-1 flex h-9 items-center justify-center rounded-md bg-accent px-4 font-display text-[14px] font-semibold text-accent-foreground transition-transform duration-120 active:scale-[.97]"
          >
            respawn the process
          </button>
        </DialogContent>
      </Dialog>
    </PlaygroundShell>
  )
}
