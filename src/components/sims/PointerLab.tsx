import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, RotateCcw } from 'lucide-react'
import {
  ChipButton,
  LogConsole,
  completeSimTask,
  useSimLog,
} from '@/components/sims/PlaygroundShell'
import { cn } from '@/lib/utils'

const SIM_ID = 'sim-memory'
const LONG_BYTES = 8
const ARRAY_BASE = 0x1000
const ARRAY_LENGTH = 4
const POINTER_ADDR = 0x1040
const DOUBLE_POINTER_ADDR = 0x1048
const NULL_ADDR = 0

const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`

type CellKind = 'array' | 'pointer' | 'outside'
type FaultStage = 'idle' | 'mmu' | 'kernel' | 'signal' | 'core'

interface MemoryCell {
  address: number
  label: string
  value: number
  kind: CellKind
  valid: boolean
}

const INITIAL_VALUES = [11, 22, 0, 44] as const

function makeCells(valueAtTwo: number): MemoryCell[] {
  const array = INITIAL_VALUES.map((initialValue, index) => ({
    address: ARRAY_BASE + index * LONG_BYTES,
    label: `vals[${index}]`,
    value: index === 2 ? valueAtTwo : initialValue,
    kind: 'array' as const,
    valid: true,
  }))

  return [
    ...array,
    {
      address: ARRAY_BASE + ARRAY_LENGTH * LONG_BYTES,
      label: 'vals[4]',
      value: 0x5a5a,
      kind: 'outside' as const,
      valid: false,
    },
    {
      address: POINTER_ADDR,
      label: 'p',
      value: ARRAY_BASE,
      kind: 'pointer' as const,
      valid: true,
    },
    {
      address: DOUBLE_POINTER_ADDR,
      label: 'pp',
      value: POINTER_ADDR,
      kind: 'pointer' as const,
      valid: true,
    },
  ]
}

const FAULT_STAGES: { id: Exclude<FaultStage, 'idle'>; label: string; detail: string }[] = [
  { id: 'mmu', label: 'MMU', detail: 'page 0 has no valid mapping' },
  { id: 'kernel', label: 'kernel', detail: 'page fault cannot be resolved' },
  { id: 'signal', label: 'SIGSEGV', detail: 'signal delivered to the process' },
  { id: 'core', label: 'core dumped', detail: 'process terminates with fault context' },
]

export default function PointerLab() {
  const { lines, log, clear } = useSimLog()
  const [valueAtTwo, setValueAtTwo] = useState(0)
  const [allocated, setAllocated] = useState(false)
  const [activeAddresses, setActiveAddresses] = useState<number[]>([])
  const [message, setMessage] = useState('Allocate vals[4] to begin. Each long occupies exactly 8 bytes.')
  const [faultStage, setFaultStage] = useState<FaultStage>('idle')
  const ticksRef = useRef(0)
  const cells = useMemo(() => makeCells(valueAtTwo), [valueAtTwo])

  const record = useCallback(
    (tag: string, text: string, tone: 'op' | 'ok' | 'warn' | 'err' = 'op') => {
      ticksRef.current += 1
      log(ticksRef.current, tag, text, tone)
    },
    [log],
  )

  const allocate = () => {
    setAllocated(true)
    setActiveAddresses([ARRAY_BASE, ARRAY_BASE + 8, ARRAY_BASE + 16, ARRAY_BASE + 24])
    setMessage('Allocated 4 × 8 = 32 contiguous bytes. p stores the base address of vals[0].')
    record('ALLOC', `long vals[4] occupies ${hex(ARRAY_BASE)}–${hex(ARRAY_BASE + 31)}`, 'ok')
  }

  const offsetRead = () => {
    if (!allocated) allocate()
    const target = ARRAY_BASE + 2 * LONG_BYTES
    setValueAtTwo(73)
    setActiveAddresses([ARRAY_BASE, target])
    setMessage(`p + 2 scales by sizeof(long): ${hex(ARRAY_BASE)} + 2 × 8 = ${hex(target)}. The write stores 73 there.`)
    record('DEREF', `*(p + 2) = 73 at ${hex(target)} (+16 bytes)`, 'ok')
    completeSimTask(SIM_ID, 't-pointer-offset', 60)
  }

  const doubleDeref = () => {
    if (!allocated) allocate()
    setActiveAddresses([DOUBLE_POINTER_ADDR, POINTER_ADDR, ARRAY_BASE])
    setMessage(`pp contains ${hex(POINTER_ADDR)}; *pp reads p = ${hex(ARRAY_BASE)}; **pp reads vals[0] = 11.`)
    record('CHASE', `${hex(DOUBLE_POINTER_ADDR)} → ${hex(POINTER_ADDR)} → ${hex(ARRAY_BASE)} → 11`, 'ok')
    completeSimTask(SIM_ID, 't-pointer-double', 60)
  }

  const onePast = () => {
    if (!allocated) allocate()
    const address = ARRAY_BASE + ARRAY_LENGTH * LONG_BYTES
    setActiveAddresses([ARRAY_BASE + 24, address])
    setMessage(`${hex(address)} is mapped, so hardware can return 0x5A5A—but it is outside vals. The C read is invalid even without a page fault.`)
    record('OOB', `*(p + 4) read mapped stale bytes at ${hex(address)}; mapped ≠ valid`, 'warn')
    completeSimTask(SIM_ID, 't-pointer-oob', 60)
  }

  const nullDeref = () => {
    setActiveAddresses([])
    setFaultStage('mmu')
    setMessage('NULL is address 0x0000. The MMU finds page 0 deliberately unmapped and raises a page fault.')
    record('FAULT', `dereference ${hex(NULL_ADDR)}: page not present`, 'err')
  }

  const advanceFault = () => {
    const index = FAULT_STAGES.findIndex((stage) => stage.id === faultStage)
    if (index < 0 || index === FAULT_STAGES.length - 1) return
    const next = FAULT_STAGES[index + 1]
    setFaultStage(next.id)
    setMessage(next.detail)
    record('FAULT', `${next.label}: ${next.detail}`, next.id === 'core' ? 'err' : 'warn')
    if (next.id === 'core') completeSimTask(SIM_ID, 't-pointer-null', 60)
  }

  const reset = () => {
    setValueAtTwo(0)
    setAllocated(false)
    setActiveAddresses([])
    setFaultStage('idle')
    ticksRef.current = 0
    clear()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <ChipButton active={allocated} color="#3EF2A4" onClick={allocate}>allocate vals[4]</ChipButton>
            <ChipButton active={false} color="#FFB224" onClick={offsetRead}>*(p+2) = 73</ChipButton>
            <ChipButton active={false} color="#60A5FA" onClick={doubleDeref}>follow **pp</ChipButton>
            <ChipButton active={false} color="#F97316" onClick={onePast}>read vals[4]</ChipButton>
            <ChipButton active={faultStage !== 'idle'} color="#FF4D6D" onClick={nullDeref}>*NULL</ChipButton>
            <button type="button" onClick={reset} className="ml-auto inline-flex items-center gap-1 rounded-sm border border-line px-2 py-1 font-mono text-[10px] uppercase text-text-3 hover:border-line-bright hover:text-text-1">
              <RotateCcw className="h-3 w-3" /> reset
            </button>
          </div>

          <div className="rounded-sm border border-line bg-surface-1/90 p-3 font-mono text-xs text-text-2">
            {message}
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[88px_1fr_88px] gap-2 px-3 font-mono text-[10px] uppercase tracking-wider text-text-3">
              <span>address</span><span>8-byte word</span><span className="text-right">value</span>
            </div>
            {cells.map((cell) => {
              const active = activeAddresses.includes(cell.address)
              const hidden = cell.kind === 'array' && !allocated
              return (
                <div key={cell.address} className={cn('grid grid-cols-[88px_1fr_88px] items-center gap-2 rounded-sm border px-3 py-2 font-mono text-xs transition-colors', active ? 'border-accent bg-accent/10 text-text-1' : 'border-line bg-surface-2/80 text-text-2', !cell.valid && 'border-dashed border-orange-400/60 bg-orange-400/5')}>
                  <span className="text-text-3">{hex(cell.address)}</span>
                  <div className="flex items-center gap-2">
                    <span>{cell.label}</span>
                    {cell.kind === 'pointer' && <span className="rounded-sm border border-blue-400/30 px-1 text-[9px] uppercase text-blue-300">address</span>}
                    {!cell.valid && <span className="inline-flex items-center gap-1 text-[9px] uppercase text-orange-300"><AlertTriangle className="h-3 w-3" /> one-past · invalid</span>}
                  </div>
                  <span className="text-right text-text-1">{hidden ? '—' : cell.kind === 'pointer' ? hex(cell.value) : cell.value}</span>
                </div>
              )
            })}
          </div>

          {activeAddresses.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface-1 px-3 py-2 font-mono text-xs text-accent">
              {activeAddresses.map((address, index) => (
                <span key={address} className="inline-flex items-center gap-2">
                  {index > 0 && <ArrowRight className="h-3 w-3 text-text-3" />}{hex(address)}
                </span>
              ))}
            </div>
          )}

          {faultStage !== 'idle' && (
            <div className="rounded-sm border border-danger/50 bg-danger/5 p-3">
              <div className="mb-3 flex flex-wrap items-start gap-2">
                {FAULT_STAGES.map((stage, index) => {
                  const current = FAULT_STAGES.findIndex((item) => item.id === faultStage)
                  const reached = index <= current
                  return <span key={stage.id} className={cn('rounded-sm border px-2 py-1 font-mono text-[10px]', reached ? 'border-danger/60 bg-danger/10 text-danger' : 'border-line text-text-3')}>{stage.label}</span>
                })}
              </div>
              {faultStage !== 'core' && <button type="button" onClick={advanceFault} className="rounded-sm border border-danger/60 px-3 py-1.5 font-mono text-xs text-danger hover:bg-danger/10">advance fault path →</button>}
            </div>
          )}
        </div>
      </section>

      <aside className="flex w-full shrink-0 flex-col border-t border-line bg-surface-1 lg:w-[320px] lg:border-l lg:border-t-0">
        <div className="border-b border-line p-4">
          <h3 className="font-display text-sm font-bold text-text-1">Pointer facts</h3>
          <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
            <dt className="text-text-3">sizeof(long)</dt><dd className="text-right text-accent">8 bytes</dd>
            <dt className="text-text-3">array span</dt><dd className="text-right text-accent">32 bytes</dd>
            <dt className="text-text-3">p</dt><dd className="text-right text-text-1">{hex(ARRAY_BASE)}</dd>
            <dt className="text-text-3">p + 2</dt><dd className="text-right text-text-1">{hex(ARRAY_BASE + 16)}</dd>
            <dt className="text-text-3">pp</dt><dd className="text-right text-text-1">{hex(DOUBLE_POINTER_ADDR)}</dd>
          </dl>
        </div>
        <div className="min-h-[180px] flex-1 overflow-auto"><LogConsole lines={lines} onClear={clear} /></div>
      </aside>
    </div>
  )
}
