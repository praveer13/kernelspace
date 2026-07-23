/**
 * SIM-01c `sim-memory` (frame mode) — Frame visualizer (T1.L1 "Stack vs Heap").
 * A steppable x86-64 call-frame diagram: watch frames slide down the stack,
 * see exact byte offsets, trigger a dangling-pointer overwrite, blow the guard
 * page with recursion, and compare stack allocation cost to malloc.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Bomb, Play, RotateCcw, StepForward } from 'lucide-react'
import {
  ChipButton,
  ControlGroup,
  LogConsole,
  SliderRow,
  completeSimTask,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
} from '@/components/sims/PlaygroundShell'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const SIM_ID = 'sim-memory'

const WORD = 8
const BASE_ADDR = 0x7fff_0200
const GUARD_ADDR = 0x7fff_0000
const ROW_H = 26
const STACK_W = 220
const LEFT_MARGIN = 90
const TOP_MARGIN = 24
const GUARD_ROW = (BASE_ADDR - GUARD_ADDR) / WORD - 1

const fmtAddr = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`
const addrForRow = (row: number) => BASE_ADDR - (row + 1) * WORD

const COLORS = {
  main: '#3EF2A4',
  add: '#22D3EE',
  inner: '#A78BFA',
  bad: '#FBBF24',
  use: '#FF5C6C',
  recurse: '#22D3EE',
  guard: '#FF5C6C',
}

type SlotType = 'ret' | 'savedRbp' | 'local' | 'pad' | 'pointer'

interface Slot {
  row: number
  type: SlotType
  label?: string
  value?: string
}

interface CallFrame {
  id: string
  name: string
  depth: number
  slots: Slot[]
  rdi?: number
  rsi?: number
  color: string
}

interface ScenarioState {
  caption: string
  asm: string
  frames: CallFrame[]
  rspRow: number
  rbpRow: number
  pointer?: { addr: number; value: string; corrupted: boolean } | null
}

interface GuardFrame {
  id: number
  rowRet: number
  rowSavedRbp: number
  rowLocal: number
}

type Mode = 'trace' | 'dangle' | 'guard' | 'malloc'

function mainFrame(localValue?: string): CallFrame {
  return {
    id: 'main',
    name: 'main',
    depth: 0,
    color: COLORS.main,
    slots: [
      { row: 0, type: 'savedRbp', label: 'saved rbp', value: fmtAddr(BASE_ADDR + 0x10) },
      { row: 1, type: 'local', label: 'x', value: localValue ?? '?' },
    ],
  }
}

function addFrame(
  id: string,
  name: string,
  depth: number,
  retRow: number,
  savedRbpRow: number,
  localRow: number,
  retLabel: string,
  savedRbpValue: string,
  localValue: string,
  rdi: number,
  rsi: number,
  color: string,
): CallFrame {
  return {
    id,
    name,
    depth,
    color,
    rdi,
    rsi,
    slots: [
      { row: retRow, type: 'ret', label: 'ret addr', value: retLabel },
      { row: savedRbpRow, type: 'savedRbp', label: 'saved rbp', value: savedRbpValue },
      { row: localRow, type: 'local', label: 'c', value: localValue },
      { row: localRow + 1, type: 'pad', label: 'pad', value: '—' },
    ],
  }
}

function buildTraceScenario(): ScenarioState[] {
  const main = mainFrame()
  const s0: ScenarioState = {
    caption: 'main is running. rdi=40 and rsi=2 are loaded for the upcoming call.',
    asm: 'mov rdi, 40\nmov rsi, 2',
    frames: [main],
    rspRow: 2,
    rbpRow: 0,
  }
  const s1: ScenarioState = {
    caption: 'call add: push the return address, then jump.',
    asm: 'call add',
    frames: [
      main,
      addFrame('add1', 'add', 1, 2, 3, 4, 'main+0x12', fmtAddr(addrForRow(0)), '?', 40, 2, COLORS.add),
    ],
    rspRow: 3,
    rbpRow: 0,
  }
  // remove local/pad until prologue finishes in s2/s3, so keep ret only
  s1.frames[1].slots = s1.frames[1].slots.filter((s) => s.row === 2)
  const s2: ScenarioState = {
    caption: 'add prologue: push the old frame pointer.',
    asm: 'push rbp',
    frames: [
      main,
      {
        ...s1.frames[1],
        slots: [
          { row: 2, type: 'ret', label: 'ret addr', value: 'main+0x12' },
          { row: 3, type: 'savedRbp', label: 'saved rbp', value: fmtAddr(addrForRow(0)) },
        ],
      },
    ],
    rspRow: 4,
    rbpRow: 0,
  }
  const s3: ScenarioState = {
    caption: 'mov rbp, rsp; sub rsp, 16. Local c is reserved at [rbp-8].',
    asm: 'mov rbp, rsp\nsub rsp, 16',
    frames: [
      main,
      addFrame(
        'add1',
        'add',
        1,
        2,
        3,
        4,
        'main+0x12',
        fmtAddr(addrForRow(0)),
        '42',
        40,
        2,
        COLORS.add,
      ),
    ],
    rspRow: 6,
    rbpRow: 3,
  }
  const s4: ScenarioState = {
    caption: 'add calls add again: push another return address.',
    asm: 'call add',
    frames: [
      main,
      s3.frames[1],
      addFrame('add2', 'add', 2, 6, 7, 8, 'add+0x1e', fmtAddr(addrForRow(3)), '?', 2, 0, COLORS.inner),
    ],
    rspRow: 7,
    rbpRow: 3,
  }
  s4.frames[2].slots = s4.frames[2].slots.filter((s) => s.row === 6)
  const s5: ScenarioState = {
    caption: 'inner add prologue: push the outer add frame pointer.',
    asm: 'push rbp',
    frames: [
      main,
      s3.frames[1],
      {
        ...s4.frames[2],
        slots: [
          { row: 6, type: 'ret', label: 'ret addr', value: 'add+0x1e' },
          { row: 7, type: 'savedRbp', label: 'saved rbp', value: fmtAddr(addrForRow(3)) },
        ],
      },
    ],
    rspRow: 8,
    rbpRow: 3,
  }
  const s6: ScenarioState = {
    caption: 'inner frame established; c = 2 at [rbp-8].',
    asm: 'mov rbp, rsp\nsub rsp, 16',
    frames: [
      main,
      s3.frames[1],
      addFrame(
        'add2',
        'add',
        2,
        6,
        7,
        8,
        'add+0x1e',
        fmtAddr(addrForRow(3)),
        '2',
        2,
        0,
        COLORS.inner,
      ),
    ],
    rspRow: 10,
    rbpRow: 7,
  }
  const s7: ScenarioState = {
    caption: 'inner ret: leave + ret. rsp/rbp pop back to the outer add frame.',
    asm: 'leave\nret',
    frames: [main, s3.frames[1]],
    rspRow: 6,
    rbpRow: 3,
  }
  const s8: ScenarioState = {
    caption: 'outer ret: main receives rax=42 and stores it in x.',
    asm: 'leave\nret\nmov [x], rax',
    frames: [mainFrame('42')],
    rspRow: 2,
    rbpRow: 0,
  }
  return [s0, s1, s2, s3, s4, s5, s6, s7, s8]
}

function buildDangleScenario(): ScenarioState[] {
  const main0 = mainFrame()
  main0.slots[1] = { row: 1, type: 'pointer', label: 'p', value: '?' }
  const targetRow = 4
  const targetAddr = addrForRow(targetRow)
  const s0: ScenarioState = {
    caption: 'main holds pointer p. We are about to call bad().',
    asm: 'long *p;',
    frames: [main0],
    rspRow: 2,
    rbpRow: 0,
  }
  const bad = addFrame(
    'bad',
    'bad',
    1,
    2,
    3,
    targetRow,
    'main+0x22',
    fmtAddr(addrForRow(0)),
    '42',
    0,
    0,
    COLORS.bad,
  )
  bad.slots[2].label = 'x'
  bad.slots[2].value = '42'
  const s1: ScenarioState = {
    caption: 'bad() sets x = 42 at [rbp-8], then returns &x.',
    asm: 'mov [rbp-8], 42\nlea rax, [rbp-8]\nleave\nret',
    frames: [main0, bad],
    rspRow: targetRow + 2,
    rbpRow: 3,
    pointer: { addr: targetAddr, value: '42', corrupted: false },
  }
  const main1 = mainFrame()
  main1.slots[1] = { row: 1, type: 'pointer', label: 'p', value: fmtAddr(targetAddr) }
  const s2: ScenarioState = {
    caption: 'p now points to abandoned stack bytes — still showing 42, for now.',
    asm: 'p = bad();',
    frames: [main1],
    rspRow: 2,
    rbpRow: 0,
    pointer: { addr: targetAddr, value: '42', corrupted: false },
  }
  const use = addFrame(
    'use',
    'use',
    1,
    2,
    3,
    targetRow,
    'main+0x2a',
    fmtAddr(addrForRow(0)),
    '0xDEAD',
    0,
    0,
    COLORS.use,
  )
  use.slots[2].label = 'y'
  use.slots[2].value = '0xDEAD'
  const s3: ScenarioState = {
    caption: 'use() reuses the same bytes for its local y.',
    asm: 'void use() { long y = 0xDEAD; }',
    frames: [main1, use],
    rspRow: targetRow + 2,
    rbpRow: 3,
    pointer: { addr: targetAddr, value: '0xDEAD', corrupted: true },
  }
  const s4: ScenarioState = {
    caption: 'Reading *p now yields 0xDEAD — the dangling pointer aliases an unrelated frame.',
    asm: 'printf("%lx", *p);',
    frames: [main1],
    rspRow: 2,
    rbpRow: 0,
    pointer: { addr: targetAddr, value: '0xDEAD', corrupted: true },
  }
  return [s0, s1, s2, s3, s4]
}

const FAULT_COPY = {
  title: 'Guard-page SIGSEGV',
  body: 'The stack grew downward until it touched the kernel guard page. That page is deliberately unmapped: the CPU raised a page fault, the kernel found no valid mapping, and delivered SIGSEGV. Without the guard page, the stack would have silently overwritten adjacent memory — exactly what a stack-smashing exploit abuses.',
}

export default function FrameSim() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  const traceScenario = useMemo(() => buildTraceScenario(), [])
  const dangleScenario = useMemo(() => buildDangleScenario(), [])

  const [mode, setMode] = useState<Mode>('trace')
  const [traceStep, setTraceStep] = useState(0)
  const [dangleStep, setDangleStep] = useState(0)

  const [guardTarget, setGuardTarget] = useState(1_000_000)
  const [guardFrames, setGuardFrames] = useState<GuardFrame[]>([])
  const [guardPlaying, setGuardPlaying] = useState(false)
  const [guardFault, setGuardFault] = useState(false)

  const [mallocFrag, setMallocFrag] = useState(30)
  const [mallocCost, setMallocCost] = useState<{ stack: number; heap: number } | null>(null)

  const tickRef = useRef(0)
  const bump = useCallback(() => {
    tickRef.current += 1
    return tickRef.current
  }, [])

  const resetTrace = useCallback(() => {
    setTraceStep(0)
    setMode('trace')
  }, [])

  const resetDangle = useCallback(() => {
    setDangleStep(0)
    setMode('dangle')
  }, [])

  const resetGuard = useCallback(() => {
    setGuardFrames([])
    setGuardFault(false)
    setGuardPlaying(false)
    setMode('guard')
  }, [])

  const currentState: ScenarioState = useMemo(() => {
    if (mode === 'trace') return traceScenario[traceStep]
    if (mode === 'dangle') return dangleScenario[dangleStep]
    if (mode === 'guard') {
      const main = mainFrame()
      const frames: CallFrame[] = [main]
      let row = 2
      let rbpRow = 0
      guardFrames.forEach((gf, i) => {
        const color = i % 2 === 0 ? COLORS.add : COLORS.inner
        frames.push({
          id: `rec-${gf.id}`,
          name: 'recurse',
          depth: i + 1,
          color,
          slots: [
            { row: gf.rowRet, type: 'ret', label: 'ret addr', value: 'recurse+0x8' },
            { row: gf.rowSavedRbp, type: 'savedRbp', label: 'saved rbp', value: fmtAddr(addrForRow(rbpRow)) },
            { row: gf.rowLocal, type: 'local', label: 'n', value: String(guardTarget - i) },
          ],
        })
        rbpRow = gf.rowSavedRbp
        row = gf.rowLocal + 2
      })
      return {
        caption: guardFault
          ? 'SIGSEGV: the guard page stopped the stack.'
          : guardFrames.length > 0
            ? `recurse depth ${guardFrames.length} — rsp moving toward the guard page.`
            : 'Set a huge recursion depth and press Recurse to blow the guard page.',
        asm: guardFault ? 'SIGSEGV' : 'call recurse',
        frames,
        rspRow: row,
        rbpRow,
      }
    }
    // malloc mode just shows main frame
    return {
      caption: 'Stack allocation is one instruction; malloc walks metadata for the same 8 bytes.',
      asm: 'sub rsp, 8   vs   malloc(8)',
      frames: [mainFrame()],
      rspRow: 2,
      rbpRow: 0,
    }
  }, [mode, traceStep, dangleStep, traceScenario, dangleScenario, guardFrames, guardFault, guardTarget])

  useEffect(() => {
    if (mode !== 'guard' || !guardPlaying || guardFault) return
    const delay = reducedMotion ? 16 : 120
    const id = window.setInterval(() => {
      setGuardFrames((prev) => {
        if (prev.length >= guardTarget) {
          setGuardPlaying(false)
          return prev
        }
        const nextId = prev.length + 1
        const startRow = 2 + prev.length * 3
        if (startRow + 2 >= GUARD_ROW) {
          setGuardFault(true)
          setGuardPlaying(false)
          const t = bump()
          log(
            t,
            'FAULT',
            `page fault at ${fmtAddr(addrForRow(GUARD_ROW))} — guard page is unmapped; kernel delivers SIGSEGV`,
            'err',
          )
          completeSimTask(SIM_ID, 't-frame-guard', 60)
          return prev
        }
        return [
          ...prev,
          { id: nextId, rowRet: startRow, rowSavedRbp: startRow + 1, rowLocal: startRow + 2 },
        ]
      })
    }, delay)
    return () => window.clearInterval(id)
  }, [mode, guardPlaying, guardFault, guardTarget, reducedMotion, log, bump])

  const stepTrace = useCallback(() => {
    setTraceStep((step) => {
      const next = Math.min(step + 1, traceScenario.length - 1)
      if (next !== step) {
        const state = traceScenario[next]
        log(bump(), 'TRACE', `${state.asm.replaceAll('\n', ' · ')} — ${state.caption}`, 'op')
      }
      if (next === traceScenario.length - 1) {
        completeSimTask(SIM_ID, 't-frame-trace', 60)
      }
      return next
    })
  }, [traceScenario, log, bump])

  const stepDangle = useCallback(() => {
    setDangleStep((step) => {
      const next = Math.min(step + 1, dangleScenario.length - 1)
      if (next !== step) {
        const state = dangleScenario[next]
        log(
          bump(),
          state.pointer?.corrupted ? 'UAR' : 'STACK',
          `${state.asm.replaceAll('\n', ' · ')} — ${state.caption}`,
          state.pointer?.corrupted ? 'warn' : 'op',
        )
      }
      if (next === dangleScenario.length - 1) {
        completeSimTask(SIM_ID, 't-frame-dangle', 60)
      }
      return next
    })
  }, [dangleScenario, log, bump])

  const runMalloc = useCallback(() => {
    const stack = 1
    const heap = 80 + mallocFrag * 2
    setMallocCost({ stack, heap })
    completeSimTask(SIM_ID, 't-frame-malloc', 60)
    const t = bump()
    log(t, 'COST', `stack: ${stack} cycle · malloc: ${heap} cycles (frag=${mallocFrag}%)`, 'ok')
  }, [mallocFrag, log, bump])

  const maxRow = useMemo(() => {
    let max = currentState.rspRow + 2
    currentState.frames.forEach((f) => {
      f.slots.forEach((s) => {
        max = Math.max(max, s.row + 2)
      })
    })
    return mode === 'guard' ? Math.max(max, GUARD_ROW + 4) : max
  }, [currentState, mode])

  const svgHeight = TOP_MARGIN + maxRow * ROW_H + 16

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------- stage ------- */}
        <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
            <span
              className="rounded-sm border px-2 py-0.5"
              style={{ borderColor: '#3EF2A455', backgroundColor: '#3EF2A414' }}
            >
              mode {mode}
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              rbp {fmtAddr(addrForRow(currentState.rbpRow))}
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              rsp {fmtAddr(addrForRow(currentState.rspRow - 1) + WORD)}
            </span>
            {mode === 'guard' && (
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                depth {guardFrames.length} / target {guardTarget.toLocaleString()}
              </span>
            )}
          </div>

          <svg width="100%" height={svgHeight} viewBox={`0 0 ${LEFT_MARGIN + STACK_W + 120} ${svgHeight}`}>
            {/* guard page zone */}
            {mode === 'guard' && (
              <>
                <rect
                  x={LEFT_MARGIN}
                  y={TOP_MARGIN + GUARD_ROW * ROW_H}
                  width={STACK_W}
                  height={(maxRow - GUARD_ROW + 2) * ROW_H}
                  fill="#FF5C6C"
                  fillOpacity={0.10}
                />
                <line
                  x1={LEFT_MARGIN - 8}
                  y1={TOP_MARGIN + GUARD_ROW * ROW_H}
                  x2={LEFT_MARGIN + STACK_W + 8}
                  y2={TOP_MARGIN + GUARD_ROW * ROW_H}
                  stroke="#FF5C6C"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
                <text
                  x={LEFT_MARGIN + STACK_W + 12}
                  y={TOP_MARGIN + GUARD_ROW * ROW_H + 4}
                  fill="#FF5C6C"
                  className="font-mono text-[9px]"
                >
                  guard page · unmapped
                </text>
              </>
            )}

            {/* high address label */}
            <text
              x={LEFT_MARGIN + STACK_W / 2}
              y={TOP_MARGIN - 8}
              textAnchor="middle"
              fill="#94a3b8"
              className="font-mono text-[9px]"
            >
              {fmtAddr(BASE_ADDR)} — high addresses
            </text>

            {/* rows */}
            {Array.from({ length: maxRow + 1 }, (_, row) => {
              const y = TOP_MARGIN + row * ROW_H
              const addr = addrForRow(row)
              return (
                <g key={row}>
                  <rect
                    x={LEFT_MARGIN}
                    y={y}
                    width={STACK_W}
                    height={ROW_H - 2}
                    fill="#0f172a"
                    stroke="#334155"
                    strokeWidth={0.5}
                  />
                  <text x={LEFT_MARGIN + 6} y={y + 14} fill="#64748b" className="font-mono text-[9px]">
                    {fmtAddr(addr)}
                  </text>
                </g>
              )
            })}

            {/* frame slots */}
            {currentState.frames.map((frame) =>
              frame.slots.map((slot) => {
                const y = TOP_MARGIN + slot.row * ROW_H
                const label = slot.label ?? slot.type
                return (
                  <motion.g
                    key={`${frame.id}-${slot.row}`}
                    initial={reducedMotion ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reducedMotion ? 0 : 0.18 }}
                  >
                    <rect
                      x={LEFT_MARGIN + 2}
                      y={y + 2}
                      width={STACK_W - 4}
                      height={ROW_H - 6}
                      fill={frame.color}
                      fillOpacity={0.18}
                      stroke={frame.color}
                      strokeWidth={1}
                      rx={2}
                    />
                    <text
                      x={LEFT_MARGIN + 10}
                      y={y + 15}
                      fill={frame.color}
                      className="font-mono text-[10px]"
                    >
                      {frame.name}·{label}
                    </text>
                    {slot.value && (
                      <text
                        x={LEFT_MARGIN + STACK_W - 10}
                        y={y + 15}
                        textAnchor="end"
                        fill="#e2e8f0"
                        className="font-mono text-[10px]"
                      >
                        {slot.value}
                      </text>
                    )}
                  </motion.g>
                )
              }),
            )}

            <RegisterArrow
              label="rbp"
              row={currentState.rbpRow}
              color="#FBBF24"
              side="left"
              reducedMotion={reducedMotion}
            />
            <RegisterArrow
              label="rsp"
              row={currentState.rspRow - 1}
              color="#3EF2A4"
              side="right"
              reducedMotion={reducedMotion}
            />

            {/* args register callout */}
            {currentState.frames.map((frame) => {
              if (frame.rdi === undefined) return null
              const firstSlot = frame.slots[0]
              const y = TOP_MARGIN + firstSlot.row * ROW_H
              return (
                <g key={`args-${frame.id}`}>
                  <text
                    x={LEFT_MARGIN + STACK_W + 8}
                    y={y + 12}
                    fill="#94a3b8"
                    className="font-mono text-[9px]"
                  >
                    rdi={frame.rdi}, rsi={frame.rsi}
                  </text>
                </g>
              )
            })}
          </svg>

          {currentState.pointer && (
            <div className="mt-3 flex items-center gap-3 font-mono text-[10px]">
              <span className="text-text-3">pointer p</span>
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5 text-text-2">
                {fmtAddr(currentState.pointer.addr)}
              </span>
              <span className="text-text-3">→</span>
              <span
                className={`rounded-sm border px-2 py-0.5 ${
                  currentState.pointer.corrupted ? 'border-danger/50 text-danger' : 'border-line text-text-2'
                }`}
              >
                {currentState.pointer.value}
              </span>
              {currentState.pointer.corrupted && (
                <span className="flex items-center gap-1 text-danger">
                  <AlertTriangle size={12} /> corrupted
                </span>
              )}
            </div>
          )}

          {!embed && (
            <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
              {currentState.caption}
            </p>
          )}
        </div>

        {/* ------- control panel ------- */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
          <ControlGroup label="scripted call trace">
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={mode === 'trace'} onClick={() => setMode('trace')}>
                trace
              </ChipButton>
              <ChipButton onClick={stepTrace} disabled={mode !== 'trace'}>
                <StepForward size={12} className="mr-1" /> step
              </ChipButton>
              <ChipButton onClick={resetTrace}>
                <RotateCcw size={12} className="mr-1" /> reset
              </ChipButton>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              main → add → add. Each step pushes or pops a frame slot; offsets are relative to rbp.
            </p>
          </ControlGroup>

          <ControlGroup label="dangling local">
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={mode === 'dangle'} onClick={() => setMode('dangle')}>
                dangle
              </ChipButton>
              <ChipButton onClick={stepDangle} disabled={mode !== 'dangle'}>
                <StepForward size={12} className="mr-1" /> step
              </ChipButton>
              <ChipButton onClick={resetDangle}>
                <RotateCcw size={12} className="mr-1" /> reset
              </ChipButton>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              bad() returns &x; use() later overwrites the same bytes.
            </p>
          </ControlGroup>

          <ControlGroup label="recursion / guard page">
            <SliderRow
              label="requested depth"
              value={guardTarget}
              display={guardTarget.toLocaleString()}
              min={10}
              max={1_000_000}
              step={10}
              onChange={setGuardTarget}
            />
            <div className="flex flex-wrap gap-1.5">
              <ChipButton
                active={mode === 'guard'}
                onClick={() => {
                  resetGuard()
                  setMode('guard')
                }}
              >
                guard
              </ChipButton>
              <ChipButton
                onClick={() => setGuardPlaying((p) => !p)}
                disabled={mode !== 'guard' || guardFault}
                color="#FF5C6C"
              >
                <Play size={12} className="mr-1" />
                {guardPlaying ? 'pause' : 'recurse'}
              </ChipButton>
              <ChipButton onClick={resetGuard}>
                <RotateCcw size={12} className="mr-1" /> reset
              </ChipButton>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              Frames push fast until rsp crosses the guard page; the kernel answers with SIGSEGV.
            </p>
          </ControlGroup>

          <ControlGroup label="heap comparison">
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={mode === 'malloc'} onClick={() => setMode('malloc')}>
                malloc view
              </ChipButton>
              <ChipButton onClick={runMalloc} disabled={mode !== 'malloc'} color="#FBBF24">
                malloc 8 B
              </ChipButton>
            </div>
            <SliderRow
              label="heap fragmentation"
              value={mallocFrag}
              display={`${mallocFrag}%`}
              min={0}
              max={100}
              step={5}
              onChange={setMallocFrag}
            />
            {mallocCost && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-sm border border-line bg-ink p-2 text-center">
                  <p className="font-mono text-[9px] uppercase text-text-3">stack</p>
                  <p className="font-mono text-lg text-accent">{mallocCost.stack}</p>
                  <p className="font-mono text-[9px] text-text-3">cycle</p>
                </div>
                <div className="rounded-sm border border-line bg-ink p-2 text-center">
                  <p className="font-mono text-[9px] uppercase text-text-3">malloc</p>
                  <p className="font-mono text-lg text-amber-400">{mallocCost.heap}</p>
                  <p className="font-mono text-[9px] text-text-3">cycles</p>
                </div>
              </div>
            )}
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              same 8-byte payload: the stack moves a pointer; the heap pays free-list search plus bookkeeping.
            </p>
          </ControlGroup>

          <ControlGroup label="legend" className="border-b-0">
            {[
              ['return address', COLORS.add],
              ['saved rbp', '#FBBF24'],
              ['local / arg slot', COLORS.main],
              ['guard page', COLORS.guard],
            ].map(([label, color]) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-[2px] border"
                  style={{ borderColor: color, backgroundColor: `${color}30` }}
                />
                <span className="font-mono text-[10px] text-text-2">{label}</span>
              </div>
            ))}
          </ControlGroup>
        </aside>
      </div>

      {!embed && <LogConsole lines={lines} onClear={clear} />}

      {/* ------- guard page fault modal ------- */}
      <Dialog open={guardFault} onOpenChange={setGuardFault}>
        <DialogContent className="border-danger/40 bg-surface-1 text-text-2 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-text-1">
              <Bomb size={18} strokeWidth={1.75} className="text-danger" />
              {FAULT_COPY.title}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-danger">
              SEGFAULT at {fmtAddr(addrForRow(GUARD_ROW))} — core dumped
            </DialogDescription>
          </DialogHeader>
          <p className="text-body-sm leading-relaxed">{FAULT_COPY.body}</p>
          <div className="rounded-sm border border-line bg-ink px-3 py-2 font-mono text-[11px] text-text-3">
            rip=0x0040119A rsp={fmtAddr(addrForRow(currentState.rspRow - 1) + WORD)} sig=SIGSEGV
          </div>
          <button
            type="button"
            onClick={() => {
              resetGuard()
              setMode('guard')
            }}
            className="mt-1 flex h-9 items-center justify-center rounded-md bg-accent px-4 font-display text-[14px] font-semibold text-accent-foreground transition-transform duration-120 active:scale-[.97]"
          >
            respawn the process
          </button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RegisterArrow({
  label,
  row,
  color,
  side,
  reducedMotion,
}: {
  label: string
  row: number
  color: string
  side: 'left' | 'right'
  reducedMotion: boolean
}) {
  const cy = TOP_MARGIN + row * ROW_H + ROW_H / 2
  const shaftLen = 32
  const headSize = 5
  const isLeft = side === 'left'
  const tipX = isLeft ? LEFT_MARGIN - 8 : LEFT_MARGIN + STACK_W + 8
  const tailX = isLeft ? tipX - shaftLen : tipX + shaftLen
  const textX = isLeft ? tailX - 6 : tailX + 6
  const anchor = isLeft ? 'end' : 'start'
  const headPoints = isLeft
    ? `${tipX},0 ${tipX - headSize},${-headSize} ${tipX - headSize},${headSize}`
    : `${tipX},0 ${tipX + headSize},${-headSize} ${tipX + headSize},${headSize}`
  return (
    <motion.g
      initial={false}
      animate={{ y: cy }}
      transition={{ duration: reducedMotion ? 0 : 0.25, ease: 'easeOut' }}
    >
      <line x1={tailX} y1={0} x2={tipX} y2={0} stroke={color} strokeWidth={1.5} />
      <polygon points={headPoints} fill={color} />
      <text
        x={textX}
        y={4}
        textAnchor={anchor}
        fill={color}
        className="font-mono text-[10px]"
      >
        {label}
      </text>
    </motion.g>
  )
}
