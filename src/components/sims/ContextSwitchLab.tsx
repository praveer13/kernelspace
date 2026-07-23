import { useMemo, useRef, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import {
  ChipButton,
  ControlGroup,
  LogConsole,
  SliderRow,
  completeSimTask,
  usePlaygroundContext,
  useSimLog,
} from '@/components/sims/PlaygroundShell'

const SIM_ID = 'sim-batching'
const SWITCH_COST_US = 4

interface Result {
  switchesPerSecond: number
  overheadPct: number
  usefulPct: number
  throughput: number
  runnablePerSlot: number
}

function model(runnable: number, slots: number, timesliceUs: number, unitWork: number): Result {
  const runnablePerSlot = runnable / slots
  const contention = Math.max(0, runnablePerSlot - 1)
  const switchesPerSecond = contention === 0 ? 0 : (slots * 1_000_000) / timesliceUs
  const switchTax = contention === 0 ? 0 : SWITCH_COST_US / timesliceUs
  const cacheTax = contention === 0 ? 0 : Math.min(0.32, 0.018 * contention) / unitWork
  const overheadPct = Math.min(95, (switchTax + cacheTax) * 100)
  const usefulPct = 100 - overheadPct
  const throughput = slots * unitWork * (usefulPct / 100)
  return { switchesPerSecond, overheadPct, usefulPct, throughput, runnablePerSlot }
}

export default function ContextSwitchLab() {
  const { embed } = usePlaygroundContext()
  const { lines, log, clear } = useSimLog()
  const runNo = useRef(0)
  const baseline = useRef<Result | null>(null)
  const cliff = useRef<Result | null>(null)
  const shortSlice = useRef<Result | null>(null)
  const [runnable, setRunnable] = useState(8)
  const [slots, setSlots] = useState(8)
  const [timesliceUs, setTimesliceUs] = useState(10_000)
  const [unitWork, setUnitWork] = useState(1)
  const [result, setResult] = useState<Result | null>(null)
  const preview = useMemo(() => model(runnable, slots, timesliceUs, unitWork), [runnable, slots, timesliceUs, unitWork])

  const run = () => {
    const next = model(runnable, slots, timesliceUs, unitWork)
    setResult(next)
    runNo.current += 1
    log(runNo.current, 'CTX', `${runnable} runnable / ${slots} slots · ${timesliceUs / 1000} ms quantum · ${next.overheadPct.toFixed(1)}% overhead`, next.overheadPct > 20 ? 'warn' : 'ok')
    if (runnable === 8 && slots === 8 && unitWork === 1 && next.overheadPct < 1) {
      baseline.current = next
      completeSimTask(SIM_ID, 't-ctx-baseline', 60)
    }
    if (runnable === 64 && slots === 8 && unitWork === 1 && timesliceUs === 10_000 && next.overheadPct >= 10) {
      cliff.current = next
      completeSimTask(SIM_ID, 't-ctx-cliff', 60)
    }
    if (runnable === 64 && slots === 8 && unitWork === 1 && timesliceUs <= 5_000 && cliff.current && next.overheadPct > cliff.current.overheadPct) {
      shortSlice.current = next
      completeSimTask(SIM_ID, 't-ctx-timeslice', 60)
    }
    const comparison = shortSlice.current ?? cliff.current
    if (runnable === 64 && slots === 8 && unitWork === 10 && comparison && next.throughput > comparison.throughput) {
      completeSimTask(SIM_ID, 't-ctx-amortize', 60)
    }
  }

  const shown = result ?? preview
  const reset = () => { setResult(null); clear() }
  const card = (label: string, value: string, accent = false) => (
    <div className="min-w-0 rounded-sm border border-line bg-surface-1 px-3 py-2">
      <p className="truncate font-mono text-[9px] uppercase tracking-[.1em] text-text-3">{label}</p>
      <p className={`font-display text-lg font-semibold ${accent ? 'text-accent' : 'text-text-1'}`}>{value}</p>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-1 overflow-auto bg-ink bg-blueprint p-4">
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {card('useful CPU', `${shown.usefulPct.toFixed(1)}%`, true)}
            {card('switch overhead', `${shown.overheadPct.toFixed(1)}%`)}
            {card('switches / second', shown.switchesPerSecond.toLocaleString(undefined, { maximumFractionDigits: 0 }))}
            {card('throughput index', shown.throughput.toFixed(2))}
          </div>
          <section className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-3 flex items-center justify-between gap-3 font-mono text-[10px] text-text-3">
              <span>RUNQUEUE · {runnable} runnable units</span><span>{shown.runnablePerSlot.toFixed(1)} per slot</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: slots }, (_, slot) => {
                const queued = Math.max(0, Math.ceil((runnable - slot) / slots))
                return <div key={slot} className="min-w-0 rounded-sm border border-line bg-surface-2 p-2">
                  <div className="mb-2 font-mono text-[10px] text-accent">CPU {slot}</div>
                  <div className="flex flex-wrap gap-1">{Array.from({ length: queued }, (_, i) => <span key={i} className="h-3 min-w-3 flex-1 rounded-[2px] bg-info/60" title={`runnable unit ${slot + i * slots + 1}`} />)}</div>
                </div>
              })}
            </div>
            <div className="mt-4 h-5 overflow-hidden rounded-sm border border-line bg-surface-3">
              <div className="h-full bg-accent/75" style={{ width: `${shown.usefulPct}%` }} />
            </div>
            <p className="mt-2 font-mono text-[10px] text-text-3">green = useful work · remainder = save/restore plus cache/TLB refill</p>
          </section>
          {!embed && <p className="mt-3 max-w-2xl font-mono text-[10px] leading-relaxed text-text-3">Extra runnable units do not create cores. They increase switch frequency and displace warm cache state; longer work units amortize that fixed tax.</p>}
        </main>
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[300px] lg:border-l lg:border-t-0">
          <ControlGroup label="machine">
            <SliderRow label="runnable units" value={runnable} display={String(runnable)} min={8} max={64} step={8} onChange={setRunnable} />
            <SliderRow label="worker / CPU slots" value={slots} display={String(slots)} min={1} max={8} step={1} onChange={setSlots} />
            <SliderRow label="timeslice" value={timesliceUs} display={`${timesliceUs / 1000} ms`} min={2500} max={20000} step={2500} onChange={setTimesliceUs} />
          </ControlGroup>
          <ControlGroup label="unit work">
            <div className="flex flex-wrap gap-1.5">{[1, 2, 5, 10].map((n) => <ChipButton key={n} active={unitWork === n} onClick={() => setUnitWork(n)}>{n}×</ChipButton>)}</div>
          </ControlGroup>
          <ControlGroup label="run" className="border-b-0">
            <button type="button" onClick={run} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent font-display text-[15px] font-semibold text-accent-foreground"><Play size={15} /> run model</button>
            <button type="button" onClick={reset} className="flex h-8 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface-2 font-mono text-[11px] text-text-2"><RotateCcw size={13} /> reset</button>
          </ControlGroup>
        </aside>
      </div>
      {!embed && <LogConsole lines={lines} onClear={clear} />}
    </div>
  )
}
