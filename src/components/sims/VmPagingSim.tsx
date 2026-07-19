/**
 * SIM-03 `sim-vm` — Virtual Memory Paging Simulator (playground.md §6).
 * 16 virtual pages · 8 physical frames · 4-entry TLB. Steppable translation
 * walks (bit-split → TLB → page table → frame), page faults with disk load,
 * FIFO/LRU/Clock eviction, workload presets, and the ≡ PagedAttention aha-toggle
 * (block tables, two sequences, copy-on-write prefix sharing).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Cpu, GitFork, Shuffle } from 'lucide-react'
import PlaygroundShell, {
  ChipButton,
  ControlGroup,
  LogConsole,
  SliderRow,
  TransportBar,
  completeSimTask,
  useInitialCfg,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
  useWriteCfg,
} from '@/components/sims/PlaygroundShell'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const SIM_ID = 'sim-vm'
const VPAGES = 16
const FRAMES = 8
const PAGE_BITS = 8 // 256B pages → 12-bit addresses

const hx = (n: number) => `0x${n.toString(16).toUpperCase()}`
const hx3 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(3, '0')}`

type Policy = 'fifo' | 'lru' | 'clock'
type Workload = 'sequential' | 'random' | 'locality' | 'mmap'

interface PTE {
  pfn: number | null
  resident: boolean
  loadedAt: number
  lastUsed: number
  ref: boolean
}

interface TLBEntry {
  vpn: number
  pfn: number
  lastUsed: number
}

interface VMState {
  pt: PTE[]
  frames: (number | null)[] // frame → vpn
  tlb: TLBEntry[]
  clockHand: number
  accesses: number
  hits: number
  faults: number
  cycles: number
}

const blankVM = (): VMState => ({
  pt: Array.from({ length: VPAGES }, (_, i) => ({
    pfn: i < 4 ? i : null,
    resident: i < 4,
    loadedAt: 0,
    lastUsed: 0,
    ref: i < 4,
  })),
  frames: [0, 1, 2, 3, null, null, null, null],
  tlb: [],
  clockHand: 0,
  accesses: 0,
  hits: 0,
  faults: 0,
  cycles: 0,
})

/* ----------------------------- walk stages ----------------------------- */

type WalkStage =
  | { kind: 'emit'; addr: number; vpn: number; offset: number }
  | { kind: 'tlb'; hit: boolean }
  | { kind: 'ptwalk'; vpn: number; resident: boolean; pfn: number | null }
  | { kind: 'fault'; vpn: number }
  | { kind: 'evict'; vpn: number; frame: number; policy: string; age: number }
  | { kind: 'load'; vpn: number; frame: number }
  | { kind: 'tlbfill'; vpn: number; pfn: number }
  | { kind: 'touch'; addr: number; pa: number; frame: number }

interface Walk {
  addr: number
  vpn: number
  stages: WalkStage[]
  idx: number // -1 = not started
}

function tlbInsert(tlb: TLBEntry[], vpn: number, pfn: number, tlbSize: number, at: number): TLBEntry[] {
  const without = tlb.filter((e) => e.vpn !== vpn)
  const next = [...without, { vpn, pfn, lastUsed: at }]
  while (next.length > tlbSize) {
    let lru = 0
    for (let i = 1; i < next.length; i += 1) if (next[i].lastUsed < next[lru].lastUsed) lru = i
    next.splice(lru, 1)
  }
  return next
}

function pickVictim(vm: VMState, policy: Policy): { frame: number; hand: number } {
  if (policy === 'fifo') {
    let best = 0
    let bestAge = Infinity
    for (let f = 0; f < FRAMES; f += 1) {
      const vpn = vm.frames[f]
      if (vpn === null) return { frame: f, hand: vm.clockHand }
      if (vm.pt[vpn].loadedAt < bestAge) {
        bestAge = vm.pt[vpn].loadedAt
        best = f
      }
    }
    return { frame: best, hand: vm.clockHand }
  }
  if (policy === 'lru') {
    let best = 0
    let bestUsed = Infinity
    for (let f = 0; f < FRAMES; f += 1) {
      const vpn = vm.frames[f]
      if (vpn === null) return { frame: f, hand: vm.clockHand }
      if (vm.pt[vpn].lastUsed < bestUsed) {
        bestUsed = vm.pt[vpn].lastUsed
        best = f
      }
    }
    return { frame: best, hand: vm.clockHand }
  }
  // clock (second chance): clear ref as the hand sweeps, evict first ref==0
  let hand = vm.clockHand
  for (let scanned = 0; scanned < FRAMES * 2; scanned += 1) {
    const f = hand % FRAMES
    const vpn = vm.frames[f]
    if (vpn === null) return { frame: f, hand }
    if (!vm.pt[vpn].ref) return { frame: f, hand: (f + 1) % FRAMES }
    vm.pt[vpn].ref = false
    hand = (hand + 1) % FRAMES
  }
  return { frame: hand % FRAMES, hand: (hand + 1) % FRAMES }
}

/** Precompute a full translation: stages for the walk + the committed next state. */
function planAccess(
  prev: VMState,
  addr: number,
  policy: Policy,
  tlbSize: number,
): { walk: Walk; next: VMState; evictedVpn: number | null } {
  const vpn = addr >> PAGE_BITS
  const offset = addr & ((1 << PAGE_BITS) - 1)
  const at = prev.accesses + 1
  const vm: VMState = {
    ...prev,
    pt: prev.pt.map((p) => ({ ...p })),
    frames: [...prev.frames],
    tlb: prev.tlb.map((e) => ({ ...e })),
    accesses: at,
  }
  const stages: WalkStage[] = [{ kind: 'emit', addr, vpn, offset }]
  let evictedVpn: number | null = null

  const tlbHit = vm.tlb.find((e) => e.vpn === vpn)
  const touch = (pfn: number) => {
    void pfn
    vm.pt[vpn].lastUsed = at
    vm.pt[vpn].ref = true
  }

  if (tlbHit) {
    tlbHit.lastUsed = at
    touch(tlbHit.pfn)
    vm.hits += 1
    vm.cycles += 1
    stages.push(
      { kind: 'tlb', hit: true },
      { kind: 'touch', addr, pa: (tlbHit.pfn << PAGE_BITS) | offset, frame: tlbHit.pfn },
    )
    return { walk: { addr, vpn, stages, idx: -1 }, next: vm, evictedVpn }
  }

  stages.push({ kind: 'tlb', hit: false })
  const pte = vm.pt[vpn]

  if (pte.resident && pte.pfn !== null) {
    stages.push({ kind: 'ptwalk', vpn, resident: true, pfn: pte.pfn })
    touch(pte.pfn)
    vm.tlb = tlbInsert(vm.tlb, vpn, pte.pfn, tlbSize, at)
    vm.cycles += 20
    stages.push(
      { kind: 'tlbfill', vpn, pfn: pte.pfn },
      { kind: 'touch', addr, pa: (pte.pfn << PAGE_BITS) | offset, frame: pte.pfn },
    )
    return { walk: { addr, vpn, stages, idx: -1 }, next: vm, evictedVpn }
  }

  /* page fault */
  stages.push({ kind: 'ptwalk', vpn, resident: false, pfn: null }, { kind: 'fault', vpn })
  vm.faults += 1
  vm.cycles += 200

  let frame = vm.frames.indexOf(null)
  if (frame === -1) {
    const victim = pickVictim(vm, policy)
    frame = victim.frame
    vm.clockHand = victim.hand
    const vv = vm.frames[frame]
    if (vv !== null) {
      evictedVpn = vv
      const age = at - vm.pt[vv].lastUsed
      stages.push({ kind: 'evict', vpn: vv, frame, policy: policy.toUpperCase(), age })
      vm.pt[vv].resident = false
      vm.pt[vv].pfn = null
      vm.tlb = vm.tlb.filter((e) => e.vpn !== vv)
    }
  }

  stages.push({ kind: 'load', vpn, frame })
  vm.frames[frame] = vpn
  vm.pt[vpn] = { pfn: frame, resident: true, loadedAt: at, lastUsed: at, ref: true }
  vm.tlb = tlbInsert(vm.tlb, vpn, frame, tlbSize, at)
  stages.push(
    { kind: 'tlbfill', vpn, pfn: frame },
    { kind: 'touch', addr, pa: (frame << PAGE_BITS) | offset, frame },
  )
  return { walk: { addr, vpn, stages, idx: -1 }, next: vm, evictedVpn }
}

/* ------------------------------ workloads ------------------------------ */

function workloadAddr(workload: Workload, counter: number, rng: () => number): number {
  switch (workload) {
    case 'sequential':
      return (counter * 64) % 4096
    case 'random':
      return Math.floor(rng() * 4096)
    case 'locality':
      // 80% hot pages 0–3, 20% cold pages 4–7
      if (rng() < 0.8) return Math.floor(rng() * 4) * 256 + Math.floor(rng() * 256)
      return (4 + Math.floor(rng() * 4)) * 256 + Math.floor(rng() * 256)
    case 'mmap':
      // file-backed region pages 8–15, striding like a buffered reader
      return 8 * 256 + ((counter * 384) % 2048)
  }
}

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

/* --------------------------- PagedAttention mode --------------------------- */

interface PAState {
  seqA: (number | null)[] // 8 token blocks → KV frame
  seqB: (number | null)[] | null
  frames: ({ owner: 'A' | 'B'; shared: boolean } | null)[]
  refcount: number[]
}

const blankPA = (): PAState => ({
  seqA: [0, 1, 2, 3, 4, 5, null, null],
  seqB: null,
  frames: [
    { owner: 'A', shared: false },
    { owner: 'A', shared: false },
    { owner: 'A', shared: false },
    { owner: 'A', shared: false },
    { owner: 'A', shared: false },
    { owner: 'A', shared: false },
    null,
    null,
  ],
  refcount: [1, 1, 1, 1, 1, 1, 0, 0],
})

/* ------------------------------ URL config ------------------------------ */

interface VMCfg {
  p: Policy
  w: Workload
  t: number
}

export default function VmPagingSim() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  const initialCfg = useInitialCfg<VMCfg>()
  const [vm, setVmState] = useState<VMState>(blankVM)
  const vmRef = useRef<VMState>(vm)
  const setVm = useCallback((next: VMState) => {
    vmRef.current = next
    setVmState(next)
  }, [])

  const [policy, setPolicy] = useState<Policy>(initialCfg?.p ?? 'lru')
  const [workload, setWorkload] = useState<Workload>(initialCfg?.w ?? 'locality')
  const [tlbSize, setTlbSize] = useState<number>(initialCfg?.t ?? 4)
  const [walk, setWalk] = useState<Walk | null>(null)
  const walkRef = useRef<Walk | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [paMode, setPaMode] = useState(false)
  const [pa, setPa] = useState<PAState>(blankPA())
  const [addrInput, setAddrInput] = useState('C2A')

  const ticksRef = useRef(0)
  const [ticks, setTicks] = useState(0)
  const bump = useCallback(() => {
    ticksRef.current += 1
    setTicks(ticksRef.current)
    return ticksRef.current
  }, [])
  const rngRef = useRef(mulberry32(0xC0FFEE))
  const counterRef = useRef(0)
  const signalsRef = useRef({ hit: false, miss: false, fault: false })
  const evictWatchRef = useRef<{ vpn: number; until: number } | null>(null)

  useWriteCfg({ p: policy, w: workload, t: tlbSize } satisfies VMCfg)

  /* ----------------------------- issue access ----------------------------- */
  const issueAccess = useCallback(
    (addr: number) => {
      if (walkRef.current) return // one walk at a time
      const { walk: w, next, evictedVpn } = planAccess(vmRef.current, addr, policy, tlbSize)
      setVm(next)

      /* task signals */
      const hasFault = w.stages.some((s) => s.kind === 'fault')
      const tlbStage = w.stages.find((s) => s.kind === 'tlb') as { hit: boolean } | undefined
      if (tlbStage?.hit) signalsRef.current.hit = true
      else signalsRef.current.miss = true
      if (hasFault) signalsRef.current.fault = true
      const sig = signalsRef.current
      if (sig.hit && sig.miss && sig.fault) completeSimTask(SIM_ID, 't-signals', 60)

      /* thrash watch: evicted page re-faulted within 10 accesses */
      const watch = evictWatchRef.current
      if (watch && hasFault && w.vpn === watch.vpn && next.accesses <= watch.until) {
        completeSimTask(SIM_ID, 't-thrash', 60)
        log(
          ticksRef.current,
          'THRASH',
          `page ${hx(w.vpn)} was just evicted — and is needed again. this is thrashing.`,
          'err',
        )
        evictWatchRef.current = null
      }
      if (evictedVpn !== null) {
        evictWatchRef.current = { vpn: evictedVpn, until: next.accesses + 10 }
      }

      setWalk(w)
      walkRef.current = w
    },
    [log, policy, setVm, tlbSize],
  )

  const issueNext = useCallback(() => {
    const addr = workloadAddr(workload, counterRef.current, rngRef.current)
    counterRef.current += 1
    issueAccess(addr)
  }, [issueAccess, workload])

  /* ----------------------------- stage logging ----------------------------- */
  const logStage = useCallback(
    (stage: WalkStage) => {
      const t = ticksRef.current
      switch (stage.kind) {
        case 'emit':
          log(t, 'CPU', `VA ${hx3(stage.addr)} → VPN=${hx(stage.vpn)} · offset=${hx(stage.offset)}`)
          break
        case 'tlb':
          if (stage.hit) log(t, 'TLB', 'HIT — 1 cycle', 'ok')
          else log(t, 'TLB', 'MISS — walk the page table', 'warn')
          break
        case 'ptwalk':
          if (stage.resident) log(t, 'WALK', `PTE[${hx(stage.vpn)}] → PFN ${stage.pfn} · valid`)
          else log(t, 'WALK', `PTE[${hx(stage.vpn)}] ✗ not resident`, 'warn')
          break
        case 'fault':
          log(t, 'FAULT', `page ${hx(stage.vpn)} on disk — trap to OS`, 'err')
          break
        case 'evict':
          log(t, 'EVICT', `p${stage.vpn} from frame ${stage.frame} (${stage.policy}, age ${stage.age})`, 'warn')
          break
        case 'load':
          log(t, 'LOAD', `disk → frame ${stage.frame} (~200 cycles)`)
          break
        case 'tlbfill':
          log(t, 'TLB', `fill ${hx(stage.vpn)}→${stage.pfn}`)
          break
        case 'touch':
          log(t, 'READ', `${hx3(stage.addr)} → PA ${hx3(stage.pa)} ✓`, 'ok')
          break
      }
    },
    [log],
  )

  /* ----------------------------- advance step ----------------------------- */
  const advance = useCallback(() => {
    if (paMode) return
    const w = walkRef.current
    if (!w) {
      issueNext()
      return
    }
    if (w.idx >= w.stages.length - 1) {
      setWalk(null)
      walkRef.current = null
      return
    }
    bump()
    const nextIdx = w.idx + 1
    logStage(w.stages[nextIdx])
    const nw = { ...w, idx: nextIdx }
    setWalk(nw)
    walkRef.current = nw
  }, [bump, issueNext, logStage, paMode])

  const advanceRef = useRef(advance)
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => advanceRef.current(), 600 / speed)
    return () => window.clearInterval(id)
  }, [playing, speed])

  /* ----------------------------- task: locality ----------------------------- */
  const hitRate = vm.accesses > 0 ? vm.hits / vm.accesses : 0
  useEffect(() => {
    if (workload === 'locality' && vm.accesses >= 24 && hitRate > 0.9) {
      completeSimTask(SIM_ID, 't-locality', 60)
    }
  }, [workload, vm.accesses, hitRate])

  /* ----------------------------- reset ----------------------------- */
  const reset = useCallback(() => {
    setVm(blankVM())
    setWalk(null)
    walkRef.current = null
    setPlaying(false)
    setPa(blankPA())
    counterRef.current = 0
    signalsRef.current = { hit: false, miss: false, fault: false }
    evictWatchRef.current = null
    ticksRef.current = 0
    setTicks(0)
    log(0, 'RESET', 'machine rebooted — pages 0–3 preloaded, TLB cold')
  }, [log, setVm])

  /* ----------------------------- PagedAttention ops ----------------------------- */
  const forkSequence = useCallback(() => {
    const t = bump()
    setPa((prev) => {
      if (prev.seqB) return prev
      const seqB = prev.seqA.map((f, i) => (i <= 2 ? f : null))
      const frames = prev.frames.map((f, i) =>
        i <= 2 && f ? { ...f, shared: true } : f,
      )
      const refcount = prev.refcount.map((r, i) => (i <= 2 ? r + 1 : r))
      return { ...prev, seqB, frames, refcount }
    })
    log(t, 'FORK', 'seq B created — prefix blocks 0–2 shared with seq A (refcount 2)', 'ok')
    completeSimTask(SIM_ID, 't-pafork', 60)
  }, [bump, log])

  const paTouch = useCallback(
    (seq: 'A' | 'B', block: number) => {
      const t = bump()
      setPa((prev) => {
        const table = seq === 'A' ? prev.seqA : prev.seqB
        if (!table) return prev
        const frame = table[block]
        if (frame === null) {
          /* load from disk into a free frame */
          const freeFrame = prev.frames.findIndex((f) => f === null)
          if (freeFrame === -1) {
            log(t, 'FAULT', `seq ${seq} block ${block} — HBM full, vLLM would preempt/swap`, 'err')
            return prev
          }
          const frames = prev.frames.map((f, i) =>
            i === freeFrame ? { owner: seq, shared: false } : f,
          )
          const refcount = prev.refcount.map((r, i) => (i === freeFrame ? 1 : r))
          const nextTable = table.map((f, i) => (i === block ? freeFrame : f))
          log(t, 'LOAD', `seq ${seq} block ${block} → KV frame ${freeFrame} (from disk)`)
          return {
            ...prev,
            frames,
            refcount,
            [seq === 'A' ? 'seqA' : 'seqB']: nextTable,
          } as PAState
        }
        const shared = prev.refcount[frame] > 1
        if (seq === 'B' && shared) {
          /* copy-on-write */
          const freeFrame = prev.frames.findIndex((f) => f === null)
          if (freeFrame === -1) {
            log(t, 'COW', '✗ no free KV block for copy-on-write', 'err')
            return prev
          }
          const frames = prev.frames.map((f, i) => {
            if (i === freeFrame) return { owner: 'B' as const, shared: false }
            if (i === frame && prev.refcount[i] === 2) return { owner: 'A' as const, shared: false }
            return f
          })
          const refcount = prev.refcount.map((r, i) => {
            if (i === freeFrame) return 1
            if (i === frame) return r - 1
            return r
          })
          const seqB = prev.seqB!.map((f, i) => (i === block ? freeFrame : f))
          log(
            t,
            'COW',
            `write to shared block ${block} — copied to KV frame ${freeFrame} for seq B`,
            'warn',
          )
          return { ...prev, frames, refcount, seqB }
        }
        log(
          t,
          'READ',
          `seq ${seq} block ${block} → KV frame ${frame} ✓${shared ? ' (shared prefix)' : ''}`,
          'ok',
        )
        return prev
      })
    },
    [bump, log],
  )

  /* ----------------------------- arrow overlay ----------------------------- */
  const stageRef = useRef<HTMLDivElement>(null)
  const [arrow, setArrow] = useState<{ d: string; color: string } | null>(null)

  /* eslint-disable react-hooks/set-state-in-effect --
     legitimate measure-then-render: arrow geometry needs DOM rects, which only
     exist in a layout effect (the React-endorsed useLayoutEffect use case). */
  useLayoutEffect(() => {
    const container = stageRef.current
    if (!container || !walk || walk.idx < 0) {
      setArrow(null)
      return
    }
    const stage = walk.stages[walk.idx]
    const rect = container.getBoundingClientRect()
    const center = (el: HTMLElement, edge: 'left' | 'right' | 'center') => {
      const r = el.getBoundingClientRect()
      const x = edge === 'left' ? r.left : edge === 'right' ? r.right : r.left + r.width / 2
      return { x: x - rect.left, y: r.top + r.height / 2 - rect.top }
    }
    let from: { x: number; y: number } | null = null
    let to: { x: number; y: number } | null = null
    let color = '#3EF2A4'

    const q = <T extends HTMLElement>(sel: string): T | null => container.querySelector<T>(sel)
    const vpnEl = q(`[data-vpn="${walk.vpn}"]`)
    const rowEl = q(`[data-row="${walk.vpn}"]`)
    const diskEl = q('[data-disk]')

    switch (stage.kind) {
      case 'tlb': {
        if (stage.hit) {
          const idx = vm.tlb.findIndex((e) => e.vpn === walk.vpn)
          const tlbEl = idx >= 0 ? q(`[data-tlb="${idx}"]`) : null
          if (vpnEl && tlbEl) {
            from = center(vpnEl, 'right')
            to = center(tlbEl, 'left')
            color = '#3EF2A4'
          }
        } else if (vpnEl && rowEl) {
          from = center(vpnEl, 'right')
          to = center(rowEl, 'left')
          color = '#FFB224'
        }
        break
      }
      case 'ptwalk':
      case 'tlbfill':
        if (vpnEl && rowEl) {
          from = center(vpnEl, 'right')
          to = center(rowEl, 'left')
          color = stage.kind === 'tlbfill' ? '#5CA8FF' : '#FFB224'
        }
        break
      case 'fault':
        if (rowEl && diskEl) {
          from = center(rowEl, 'right')
          to = center(diskEl, 'left')
          color = '#FF5C6C'
        }
        break
      case 'evict':
      case 'load': {
        const frameEl = q(`[data-frame="${stage.frame}"]`)
        const srcEl = stage.kind === 'load' ? diskEl : rowEl
        if (srcEl && frameEl) {
          from = center(srcEl, 'right')
          to = center(frameEl, 'left')
          color = stage.kind === 'load' ? '#FB7185' : '#FFB224'
        }
        break
      }
      case 'touch': {
        const frameEl = q(`[data-frame="${stage.frame}"]`)
        if (rowEl && frameEl) {
          from = center(rowEl, 'right')
          to = center(frameEl, 'left')
          color = '#3EF2A4'
        }
        break
      }
      default:
        break
    }

    if (!from || !to) {
      setArrow(null)
      return
    }
    const bend = Math.max(30, Math.abs(to.x - from.x) / 2)
    setArrow({
      d: `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`,
      color,
    })
  }, [walk, vm.tlb])
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ------------------------------ render ------------------------------ */
  const activeStage = walk && walk.idx >= 0 ? walk.stages[walk.idx] : null
  const faultVpn = activeStage?.kind === 'fault' ? activeStage.vpn : null
  const evictFrame = activeStage?.kind === 'evict' ? activeStage.frame : null
  const touchFrame =
    activeStage?.kind === 'touch' || activeStage?.kind === 'load' ? activeStage.frame : null
  const hitRatePct = Math.round(hitRate * 100)

  const emitAddr = walk ? walk.addr : null
  const vpnBits = emitAddr !== null ? (emitAddr >> PAGE_BITS).toString(2).padStart(4, '0') : '····'
  const offBits =
    emitAddr !== null ? (emitAddr & ((1 << PAGE_BITS) - 1)).toString(2).padStart(8, '0') : '···· ····'

  return (
    <PlaygroundShell
      simId={SIM_ID}
      title="VM Paging Simulator"
      subtitle="page tables · TLB · faults · ≡ PagedAttention"
      tasks={[
        { id: 't-signals', text: 'Cause a TLB hit, a miss, and a fault — name each in the log', xp: 60 },
        { id: 't-locality', text: 'With the 80/20 workload, get TLB hit-rate above 90%', xp: 60 },
        { id: 't-thrash', text: 'Fill memory and watch an evicted page get needed again (thrashing)', xp: 60 },
        { id: 't-pafork', text: 'In PagedAttention mode, fork a sequence and share prefix blocks', xp: 60 },
      ]}
      help={
        <>
          <p>
            The CPU emits 12-bit virtual addresses: top 4 bits pick a{' '}
            <span className="font-mono text-text-1">page</span> (16 total), low 8 bits are the
            offset. The <span className="font-mono text-text-1">TLB</span> caches recent
            translations (1 cycle); a miss walks the page table (20); a non-resident page traps to
            the OS and loads from disk (~200). Only <span className="font-mono text-text-1">8
            frames</span> exist — when full, your eviction policy picks a victim.
          </p>
          <p>
            Then flip <span className="font-mono text-text-1">≡ PagedAttention</span>: virtual
            pages become token blocks, the page table becomes a block table, frames become KV
            blocks in HBM. Fork a sequence and the prefix is shared copy-on-write — the exact
            trick from the vLLM paper.
          </p>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ------- stage ------- */}
          <div
            ref={stageRef}
            className="relative min-h-[440px] flex-1 overflow-auto bg-ink bg-blueprint p-4"
          >
            {/* top strip: CPU + stats */}
            <div className="mb-4 flex flex-wrap items-stretch gap-3">
              <div className="flex items-center gap-3 rounded-md border border-line bg-surface-1 px-3 py-2">
                <Cpu size={18} strokeWidth={1.75} className="text-text-2" />
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                    {paMode ? 'gpu sampler' : 'cpu'} · virtual address
                  </p>
                  <p className="font-mono text-[13px] text-text-1">
                    {emitAddr !== null ? hx3(emitAddr) : '0x···'}
                    <span className="ml-2 text-[11px]">
                      <span className="text-[#22D3EE]">{vpnBits}</span>
                      <span className="text-text-3"> </span>
                      <span className="text-amber">{offBits}</span>
                    </span>
                  </p>
                  <p className="font-mono text-[9px] text-text-3">
                    <span className="text-[#22D3EE]">VPN {emitAddr !== null ? hx(emitAddr >> PAGE_BITS) : '·'}</span>
                    {' · '}
                    <span className="text-amber">offset {emitAddr !== null ? hx(emitAddr & 0xff) : '·'}</span>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { label: 'TLB hit-rate', value: `${hitRatePct}%`, color: hitRatePct >= 90 ? '#3EF2A4' : hitRatePct >= 60 ? '#5CA8FF' : '#FFB224' },
                  { label: 'faults', value: String(vm.faults), color: vm.faults > 0 ? '#FFB224' : '#5D6B80' },
                  { label: 'walk cycles', value: String(vm.cycles), color: '#A3B0C2' },
                  { label: 'accesses', value: String(vm.accesses), color: '#A3B0C2' },
                ].map((s) => (
                  <div key={s.label} className="rounded-sm border border-line bg-surface-1 px-2.5 py-1.5">
                    <p className="font-mono text-[8px] uppercase tracking-[0.10em] text-text-3">{s.label}</p>
                    <p className="font-mono text-[13px]" style={{ color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {!paMode && (
              <>
                {/* TLB strip */}
                <div className="mb-4 flex items-center gap-2">
                  <span className="w-24 shrink-0 font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                    TLB · {tlbSize} slots
                  </span>
                  <div className="flex gap-1.5">
                    {Array.from({ length: tlbSize }, (_, i) => {
                      const e = vm.tlb[i]
                      const active = walk && activeStage?.kind === 'tlb' && e?.vpn === walk.vpn
                      return (
                        <div
                          key={i}
                          data-tlb={i}
                          className={cn(
                            'flex h-8 min-w-14 items-center justify-center rounded-sm border px-1.5 font-mono text-[10px] transition-colors duration-200',
                            e
                              ? 'border-[#5CA8FF]/50 bg-[#5CA8FF]/10 text-[#5CA8FF]'
                              : 'border-dashed border-line text-text-3/50',
                            active && 'ring-2 ring-[#5CA8FF]',
                          )}
                        >
                          {e ? `${hx(e.vpn)}→${e.pfn}` : '—'}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 3-panel translation scene */}
                <div className="grid grid-cols-[auto_1fr_auto] items-start gap-4">
                  {/* virtual address space */}
                  <div>
                    <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.10em] text-[#22D3EE]">
                      virtual pages (16)
                    </p>
                    <div className="grid w-fit grid-cols-4 gap-1.5">
                      {Array.from({ length: VPAGES }, (_, vpn) => {
                        const activeVpn = walk?.vpn === vpn
                        const resident = vm.pt[vpn].resident
                        return (
                          <button
                            key={vpn}
                            data-vpn={vpn}
                            type="button"
                            onClick={() => issueAccess((vpn << PAGE_BITS) | 0x2a)}
                            title={`Translate into page ${hx(vpn)}`}
                            className={cn(
                              'flex h-10 w-10 items-center justify-center rounded-sm border font-mono text-[10px] transition-all duration-200 hover:border-[#22D3EE]',
                              resident
                                ? 'border-[#22D3EE]/40 bg-[#22D3EE]/10 text-[#22D3EE]'
                                : 'border-line bg-surface-1 text-text-3',
                              activeVpn && 'ring-2 ring-[#22D3EE]',
                            )}
                          >
                            {hx(vpn)}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* page table */}
                  <div className="min-w-[190px]">
                    <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                      page table · VPN → PFN · V
                    </p>
                    <div className="w-fit rounded-sm border border-line bg-surface-1 p-1">
                      {vm.pt.map((pte, vpn) => {
                        const activeVpn = walk?.vpn === vpn && activeStage?.kind === 'ptwalk'
                        return (
                          <div
                            key={vpn}
                            data-row={vpn}
                            className={cn(
                              'flex h-[21px] items-center gap-3 rounded-[2px] px-2 font-mono text-[10px] transition-colors duration-200',
                              activeVpn && 'bg-accent-dim/60',
                              faultVpn === vpn && 'bg-danger/20',
                            )}
                          >
                            <span className="w-6 text-[#22D3EE]">{hx(vpn)}</span>
                            <span className={cn('w-5 text-right', pte.resident ? 'text-accent' : 'text-text-3/50')}>
                              {pte.resident && pte.pfn !== null ? pte.pfn : '—'}
                            </span>
                            <span className={pte.resident ? 'text-accent' : 'text-danger/70'}>
                              {pte.resident ? '1' : '0'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* physical memory */}
                  <div>
                    <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.10em] text-accent">
                      physical frames (8)
                    </p>
                    <div className="flex w-fit flex-col gap-1.5">
                      {vm.frames.map((vpn, f) => (
                        <div
                          key={f}
                          data-frame={f}
                          className={cn(
                            'flex h-9 w-24 items-center justify-between rounded-sm border px-2 font-mono text-[10px] transition-all duration-200',
                            vpn !== null
                              ? 'border-accent/50 bg-accent/15 text-accent'
                              : 'border-line bg-surface-1 text-text-3/50',
                            touchFrame === f && 'ring-2 ring-accent',
                            evictFrame === f && 'ring-2 ring-amber',
                          )}
                        >
                          <span className="text-text-3">f{f}</span>
                          <span>{vpn !== null ? `p${hx(vpn)}` : 'free'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* disk strip */}
                <div className="mt-4 flex items-center gap-2">
                  <span className="w-24 shrink-0 font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                    disk · swap
                  </span>
                  <div data-disk className="flex gap-1 rounded-sm border border-line bg-surface-1 p-1.5">
                    {Array.from({ length: VPAGES }, (_, vpn) => (
                      <span
                        key={vpn}
                        className={cn(
                          'flex h-5 w-6 items-center justify-center rounded-[2px] font-mono text-[8px]',
                          vm.pt[vpn].resident
                            ? 'text-text-3/30'
                            : 'bg-[#FB7185]/15 text-[#FB7185]',
                        )}
                      >
                        {hx(vpn)}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ---------------- PagedAttention mode ---------------- */}
            {paMode && (
              <div className="grid grid-cols-[1fr_auto] items-start gap-6">
                <div>
                  <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                    sequences · token blocks → KV frame (click to read/write)
                  </p>
                  {(['A', 'B'] as const).map((seq) => {
                    const table = seq === 'A' ? pa.seqA : pa.seqB
                    const color = seq === 'A' ? '#22D3EE' : '#FB7185'
                    if (seq === 'B' && !table) {
                      return (
                        <button
                          key="fork"
                          type="button"
                          onClick={forkSequence}
                          className="mb-2 flex items-center gap-2 rounded-sm border border-dashed border-[#FB7185]/50 px-3 py-2 font-mono text-[11px] text-[#FB7185] transition-colors hover:bg-[#FB7185]/10"
                        >
                          <GitFork size={13} strokeWidth={1.75} /> fork sequence — share the prefix
                        </button>
                      )
                    }
                    if (!table) return null
                    return (
                      <div key={seq} className="mb-2 flex items-center gap-2">
                        <span
                          className="w-14 shrink-0 font-mono text-[10px]"
                          style={{ color }}
                        >
                          seq {seq}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {table.map((frame, i) => {
                            const shared = frame !== null && pa.refcount[frame] > 1
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => paTouch(seq, i)}
                                title={
                                  frame !== null
                                    ? `block ${i} → KV frame ${frame}${shared ? ' (shared — click to write: copy-on-write)' : ''}`
                                    : `block ${i} — not materialized (click to load)`
                                }
                                className={cn(
                                  'flex h-9 min-w-12 items-center justify-center rounded-sm border px-1 font-mono text-[9px] transition-all duration-200 hover:brightness-125',
                                  frame !== null ? 'text-text-1' : 'border-dashed border-line text-text-3/50',
                                )}
                                style={
                                  frame !== null
                                    ? {
                                        borderColor: shared ? '#A78BFA66' : `${color}55`,
                                        backgroundColor: shared
                                          ? 'rgba(167,139,250,0.15)'
                                          : `${color}18`,
                                      }
                                    : undefined
                                }
                              >
                                b{i}→{frame !== null ? frame : '·'}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  <p className="mt-2 max-w-md font-mono text-[10px] leading-relaxed text-text-3">
                    block table ≡ page table. writing a shared (violet) block as seq B triggers
                    copy-on-write — beam search / parallel sampling get the prefix nearly free.
                  </p>
                </div>

                <div>
                  <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.10em] text-accent">
                    KV blocks in HBM (8)
                  </p>
                  <div className="flex w-fit flex-col gap-1.5">
                    {pa.frames.map((f, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex h-9 w-28 items-center justify-between rounded-sm border px-2 font-mono text-[10px]',
                          f ? 'text-text-1' : 'border-line bg-surface-1 text-text-3/50',
                        )}
                        style={
                          f
                            ? f.shared
                              ? {
                                  borderColor: '#A78BFA66',
                                  backgroundImage:
                                    'linear-gradient(90deg, rgba(34,211,238,0.25) 50%, rgba(251,113,133,0.25) 50%)',
                                }
                              : {
                                  borderColor: f.owner === 'A' ? '#22D3EE55' : '#FB718555',
                                  backgroundColor:
                                    f.owner === 'A' ? 'rgba(34,211,238,0.15)' : 'rgba(251,113,133,0.15)',
                                }
                            : undefined
                        }
                      >
                        <span className="text-text-3">kv{i}</span>
                        <span>
                          {f ? (f.shared ? `A+B rc${pa.refcount[i]}` : `seq ${f.owner}`) : 'free'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* translation arrow overlay */}
            <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full" aria-hidden>
              {arrow &&
                (reducedMotion ? (
                  <path d={arrow.d} fill="none" stroke={arrow.color} strokeWidth={2} strokeDasharray="6 4" opacity={0.9} />
                ) : (
                  <motion.path
                    key={arrow.d}
                    d={arrow.d}
                    fill="none"
                    stroke={arrow.color}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    opacity={0.9}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.9, strokeDashoffset: [0, -20] }}
                    transition={{
                      opacity: { duration: 0.2 },
                      strokeDashoffset: { repeat: Infinity, duration: 1, ease: 'linear' },
                    }}
                  />
                ))}
            </svg>
          </div>

          {/* ------- control panel ------- */}
          <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
            <ControlGroup label="translate an address">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-text-3">0x</span>
                <input
                  value={addrInput}
                  onChange={(e) =>
                    setAddrInput(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 3).toUpperCase())
                  }
                  className="h-8 w-16 rounded-sm border border-line bg-surface-2 px-2 font-mono text-[12px] text-text-1 outline-none focus:border-accent"
                  aria-label="Virtual address (hex, 12-bit)"
                />
                <ChipButton
                  disabled={paMode}
                  onClick={() => issueAccess((parseInt(addrInput || '0', 16) || 0) & 0xfff)}
                >
                  translate
                </ChipButton>
                <ChipButton
                  disabled={paMode}
                  onClick={() => issueAccess(Math.floor(rngRef.current() * 4096))}
                  className="flex items-center gap-1"
                >
                  <Shuffle size={11} strokeWidth={1.75} /> random
                </ChipButton>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                or click any virtual page on stage. each translation is steppable with →.
              </p>
            </ControlGroup>

            <ControlGroup label="workload (auto run)">
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['sequential', 'seq scan'],
                    ['random', 'random'],
                    ['locality', '80/20'],
                    ['mmap', 'mmap file'],
                  ] as [Workload, string][]
                ).map(([w, label]) => (
                  <ChipButton
                    key={w}
                    active={workload === w}
                    color="#22D3EE"
                    onClick={() => setWorkload(w)}
                    className="text-center"
                  >
                    {label}
                  </ChipButton>
                ))}
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                press play — the engine issues one access per step from this workload.
              </p>
            </ControlGroup>

            <ControlGroup label="hardware knobs">
              <SliderRow
                label="TLB entries"
                value={tlbSize}
                display={String(tlbSize)}
                min={1}
                max={8}
                step={1}
                onChange={setTlbSize}
              />
              <div>
                <p className="mb-1.5 font-mono text-[11px] text-text-2">eviction policy</p>
                <Select value={policy} onValueChange={(v) => setPolicy(v as Policy)}>
                  <SelectTrigger className="h-8 border-line bg-surface-2 font-mono text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-line bg-surface-1">
                    <SelectItem value="fifo" className="font-mono text-[12px]">FIFO</SelectItem>
                    <SelectItem value="lru" className="font-mono text-[12px]">LRU</SelectItem>
                    <SelectItem value="clock" className="font-mono text-[12px]">Clock (second chance)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </ControlGroup>

            <ControlGroup label="≡ pagedattention" className="border-b-0">
              <label className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
                relabel as vLLM
                <Switch
                  checked={paMode}
                  onCheckedChange={(on) => {
                    setPaMode(on)
                    setPlaying(false)
                    setWalk(null)
                    walkRef.current = null
                    log(
                      ticksRef.current,
                      'MODE',
                      on
                        ? '≡ PagedAttention — pages are token blocks, frames are KV blocks in HBM'
                        : 'back to the 1970s — plain virtual memory',
                      'warn',
                    )
                  }}
                />
              </label>
              {paMode && !pa.seqB && (
                <ChipButton onClick={forkSequence} color="#FB7185" className="flex items-center gap-1.5">
                  <GitFork size={12} strokeWidth={1.75} /> fork sequence
                </ChipButton>
              )}
            </ControlGroup>
          </aside>
        </div>

        <TransportBar
          playing={playing}
          onTogglePlay={() => setPlaying((v) => !v)}
          onStep={advance}
          onReset={reset}
          speed={speed}
          onSpeedChange={setSpeed}
          ticks={ticks}
          idle={paMode}
        />
        {!embed && <LogConsole lines={lines} onClear={clear} />}
      </div>
    </PlaygroundShell>
  )
}
