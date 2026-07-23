/**
 * SIM-03 `sim-vm` — Virtual Memory Paging Simulator (playground.md §6).
 * 16 virtual pages · dynamic frame count · 4-entry TLB. Steppable translation
 * walks (flat table or x86-64 4-level), minor/major fault fidelity, eviction
 * policies, scan workload + policy comparison, multi-process admission control,
 * and the ≡ PagedAttention aha-toggle.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import { Cpu, GitFork, Shuffle, Users } from 'lucide-react'
import ContentionLab from '@/components/sims/ContentionLab'
import { CONTENTION_TASKS } from '@/components/sims/contentionLab.tasks'
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
const DEFAULT_FRAMES = 8
const PAGE_BITS = 8 // 256B pages → 12-bit addresses
const WALK4_ADDR = 0x7f3ab2c41000
const MP_WSS = 2 // pages per process in multi-process workload
const SCAN_ACCESSES = VPAGES + 4 // one-shot scan, then revisit the four-page hot set

const hx = (n: number) => `0x${n.toString(16).toUpperCase()}`
const hx3 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(3, '0')}`
const hx16 = (n: number) => `0x${n.toString(16).toLowerCase().padStart(12, '0')}`

type Policy = 'fifo' | 'lru' | 'clock'
type Workload = 'sequential' | 'random' | 'locality' | 'mmap' | 'scan' | 'mp'
type SimMode = 'flat' | 'walk4' | 'pa'
type HostMode = 'paging' | 'contention'

interface PTE {
  pfn: number | null
  resident: boolean
  loadedAt: number
  lastUsed: number
  ref: boolean
  swap: boolean // evicted to disk → major fault on re-access
}

interface TLBEntry {
  vpn: number
  pfn: number
  lastUsed: number
}

interface VMState {
  pt: PTE[]
  frames: (number | null)[]
  tlb: TLBEntry[]
  clockHand: number
  accesses: number
  hits: number
  minorFaults: number
  majorFaults: number
  cycles: number
}

const blankVM = (frameCount = DEFAULT_FRAMES): VMState => {
  const preloaded = Math.min(4, frameCount)
  return {
    pt: Array.from({ length: VPAGES }, (_, i) => ({
      pfn: i < preloaded ? i : null,
      resident: i < preloaded,
      loadedAt: 0,
      lastUsed: 0,
      ref: i < preloaded,
      swap: false,
    })),
    frames: Array.from({ length: frameCount }, (_, i) => (i < preloaded ? i : null)),
    tlb: [],
    clockHand: 0,
    accesses: 0,
    hits: 0,
    minorFaults: 0,
    majorFaults: 0,
    cycles: 0,
  }
}

/* ----------------------------- walk stages ----------------------------- */

type WalkStage =
  | { kind: 'emit'; addr: number; vpn: number; offset: number }
  | { kind: 'tlb'; hit: boolean }
  | { kind: 'ptwalk'; vpn: number; resident: boolean; pfn: number | null }
  | { kind: 'fault'; vpn: number; major: boolean }
  | { kind: 'evict'; vpn: number; frame: number; policy: string; age: number }
  | { kind: 'load'; vpn: number; frame: number; major: boolean }
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
  const frameCount = vm.frames.length
  if (policy === 'fifo') {
    let best = 0
    let bestAge = Infinity
    for (let f = 0; f < frameCount; f += 1) {
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
    for (let f = 0; f < frameCount; f += 1) {
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
  for (let scanned = 0; scanned < frameCount * 2; scanned += 1) {
    const f = hand % frameCount
    const vpn = vm.frames[f]
    if (vpn === null) return { frame: f, hand }
    if (!vm.pt[vpn].ref) return { frame: f, hand: (f + 1) % frameCount }
    vm.pt[vpn].ref = false
    hand = (hand + 1) % frameCount
  }
  return { frame: hand % frameCount, hand: (hand + 1) % frameCount }
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
  const major = pte.swap
  stages.push({ kind: 'ptwalk', vpn, resident: false, pfn: null }, { kind: 'fault', vpn, major })
  if (major) {
    vm.majorFaults += 1
    vm.cycles += 200
  } else {
    vm.minorFaults += 1
    vm.cycles += 10
  }

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
      vm.pt[vv].swap = true
      vm.tlb = vm.tlb.filter((e) => e.vpn !== vv)
    }
  }

  stages.push({ kind: 'load', vpn, frame, major })
  vm.frames[frame] = vpn
  vm.pt[vpn] = { pfn: frame, resident: true, loadedAt: at, lastUsed: at, ref: true, swap: false }
  vm.tlb = tlbInsert(vm.tlb, vpn, frame, tlbSize, at)
  stages.push(
    { kind: 'tlbfill', vpn, pfn: frame },
    { kind: 'touch', addr, pa: (frame << PAGE_BITS) | offset, frame },
  )
  return { walk: { addr, vpn, stages, idx: -1 }, next: vm, evictedVpn }
}

/* ------------------------------ workloads ------------------------------ */

function workloadAddr(
  workload: Workload,
  counter: number,
  rng: () => number,
  _procCount: number,
  admitted: number,
): number {
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
    case 'scan':
      // one-shot sequential sweep of all virtual pages
      return ((counter % VPAGES) << PAGE_BITS) | 0x2a
    case 'mp': {
      // interleave admitted processes, then pages within each working set
      const proc = counter % Math.max(1, admitted)
      const pageInWs = Math.floor(counter / Math.max(1, admitted)) % MP_WSS
      const vpn = proc * MP_WSS + pageInWs
      return (vpn << PAGE_BITS) | 0x2a
    }
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

/* --------------------------- x86-64 4-level walk --------------------------- */

interface Walk4 {
  addr: number
  pml4: number
  pdpt: number
  pd: number
  pt: number
  offset: number
  frame: number
  pa: number
  stages: Walk4Stage[]
  idx: number
}

type Walk4Stage =
  | { kind: 'emit'; addr: number; pml4: number; pdpt: number; pd: number; pt: number; offset: number }
  | { kind: 'tlb'; hit: boolean }
  | { kind: 'read'; level: 'PML4' | 'PDPT' | 'PD' | 'PT'; idx: number; cycles: number }
  | { kind: 'resolve'; frame: number; pa: number }
  | { kind: 'touch'; addr: number; pa: number; frame: number }

function decomposeAddr(addr: number) {
  // JavaScript bitwise operators truncate to 32 bits. Division keeps every bit
  // of a 48-bit canonical address (which is still exactly representable).
  return {
    pml4: Math.floor(addr / 2 ** 39) % 0x200,
    pdpt: Math.floor(addr / 2 ** 30) % 0x200,
    pd: Math.floor(addr / 2 ** 21) % 0x200,
    pt: Math.floor(addr / 2 ** 12) % 0x200,
    offset: addr % 0x1000,
  }
}

function planWalk4(addr: number, tlbHit: boolean): Walk4 {
  const d = decomposeAddr(addr)
  const frame = ((d.pml4 ^ d.pdpt ^ d.pd ^ d.pt) % 8 + 8) % 8
  const pa = (frame << 12) | d.offset
  const stages: Walk4Stage[] = [
    { kind: 'emit', addr, ...d },
    { kind: 'tlb', hit: tlbHit },
    ...(tlbHit
      ? []
      : [
          { kind: 'read' as const, level: 'PML4' as const, idx: d.pml4, cycles: 20 },
          { kind: 'read' as const, level: 'PDPT' as const, idx: d.pdpt, cycles: 20 },
          { kind: 'read' as const, level: 'PD' as const, idx: d.pd, cycles: 20 },
          { kind: 'read' as const, level: 'PT' as const, idx: d.pt, cycles: 20 },
        ]),
    { kind: 'resolve', frame, pa },
    { kind: 'touch', addr, pa, frame },
  ]
  return { addr, ...d, frame, pa, stages, idx: -1 }
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
  f: number
  m: SimMode
  c: number
  a: boolean
}

/* ---------------------------- policy comparison --------------------------- */

function simulateRun(
  workload: Workload,
  frameCount: number,
  tlbSize: number,
  policy: Policy,
  accesses: number,
  procCount: number,
  admitControl: boolean,
): VMState {
  const admitted = workload === 'mp'
    ? (admitControl ? Math.min(procCount, Math.floor(frameCount / MP_WSS)) : procCount)
    : procCount
  let vm = blankVM(frameCount)
  const rng = mulberry32(0xC0FFEE)
  for (let i = 0; i < accesses; i += 1) {
    const addr = workloadAddr(workload, i, rng, procCount, admitted)
    const { next } = planAccess(vm, addr, policy, tlbSize)
    vm = next
  }
  return vm
}

export default function VmPagingSim() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()
  const [searchParams, setSearchParams] = useSearchParams()
  const machine = searchParams.get('machine')
  const from = searchParams.get('from')
  const desiredHostMode: HostMode =
    machine === 'contention'
      ? 'contention'
      : machine === 'paging' || machine === 'walk4'
        ? 'paging'
        : from === 't2.l5'
          ? 'contention'
          : 'paging'
  const hostMode = desiredHostMode
  const selectHostMode = (nextMode: HostMode) => {
    setPlaying(false)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('machine', nextMode)
      return next
    }, { replace: true })
  }

  const initialCfg = useInitialCfg<VMCfg>()
  const [frameCount, setFrameCount] = useState<number>(initialCfg?.f ?? DEFAULT_FRAMES)
  const [policy, setPolicy] = useState<Policy>(initialCfg?.p ?? 'lru')
  const [workload, setWorkload] = useState<Workload>(initialCfg?.w ?? 'locality')
  const [tlbSize, setTlbSize] = useState<number>(initialCfg?.t ?? 4)
  const [configuredMode, setConfiguredMode] = useState<SimMode>(initialCfg?.m ?? 'flat')
  const mode: SimMode = machine === 'walk4' ? 'walk4' : configuredMode
  const [procCount, setProcCount] = useState<number>(initialCfg?.c ?? 5)
  const [admitControl, setAdmitControl] = useState<boolean>(initialCfg?.a ?? false)

  const [vm, setVmState] = useState<VMState>(() => blankVM(initialCfg?.f ?? DEFAULT_FRAMES))
  const vmRef = useRef<VMState>(vm)
  const setVm = useCallback((next: VMState) => {
    vmRef.current = next
    setVmState(next)
  }, [])

  const [walk, setWalk] = useState<Walk | null>(null)
  const walkRef = useRef<Walk | null>(null)
  const [walk4, setWalk4] = useState<Walk4 | null>(null)
  const walk4Ref = useRef<Walk4 | null>(null)
  const walk4TlbRef = useRef<Map<number, number>>(new Map())
  const [walk4Tlb, setWalk4Tlb] = useState<Map<number, number>>(() => new Map())
  const [osForked, setOsForked] = useState(false)
  const [osCowCopied, setOsCowCopied] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [pa, setPa] = useState<PAState>(blankPA())
  const [addrInput, setAddrInput] = useState('C2A')
  const [walk4Input, setWalk4Input] = useState('7F3AB2C41000')

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

  useWriteCfg({ p: policy, w: workload, t: tlbSize, f: frameCount, m: configuredMode, c: procCount, a: admitControl } satisfies VMCfg)

  const resetForConfiguration = useCallback((nextFrameCount: number) => {
    setVm(blankVM(nextFrameCount))
    setWalk(null)
    walkRef.current = null
    setWalk4(null)
    walk4Ref.current = null
    walk4TlbRef.current = new Map()
    setWalk4Tlb(new Map())
    setOsForked(false)
    setOsCowCopied(false)
    setPa(blankPA())
    counterRef.current = 0
    setPlaying(false)
    signalsRef.current = { hit: false, miss: false, fault: false }
    evictWatchRef.current = null
  }, [setOsCowCopied, setOsForked, setPa, setPlaying, setVm, setWalk, setWalk4, setWalk4Tlb])

  const changeFrameCount = useCallback((nextFrameCount: number) => {
    setFrameCount(nextFrameCount)
    resetForConfiguration(nextFrameCount)
  }, [resetForConfiguration, setFrameCount])

  const changeMode = useCallback((nextMode: SimMode) => {
    setConfiguredMode(nextMode)
    if (machine === 'walk4') {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('machine', 'paging')
        return next
      }, { replace: true })
    }
    resetForConfiguration(frameCount)
  }, [frameCount, machine, resetForConfiguration, setConfiguredMode, setSearchParams])

  /* reset counter when workload changes */
  useEffect(() => {
    counterRef.current = 0
  }, [workload])

  const admitted = useMemo(() => {
    if (workload !== 'mp') return procCount
    return admitControl ? Math.min(procCount, Math.floor(frameCount / MP_WSS)) : procCount
  }, [workload, procCount, admitControl, frameCount])

  const refused = procCount - admitted

  /* ----------------------------- issue access ----------------------------- */
  const issueAccess = useCallback(
    (addr: number) => {
      if (mode !== 'flat' || walkRef.current) return
      const { walk: w, next, evictedVpn } = planAccess(vmRef.current, addr, policy, tlbSize)
      setVm(next)

      /* task signals */
      const tlbStage = w.stages.find((s) => s.kind === 'tlb') as { hit: boolean } | undefined
      if (tlbStage?.hit) signalsRef.current.hit = true
      else signalsRef.current.miss = true
      const faultStage = w.stages.find((s) => s.kind === 'fault') as { major: boolean } | undefined
      if (faultStage) {
        signalsRef.current.fault = true
        if (faultStage.major) completeSimTask(SIM_ID, 't-vm-major', 60)
        else completeSimTask(SIM_ID, 't-vm-minor', 60)
      }
      const sig = signalsRef.current
      if (sig.hit && sig.miss && sig.fault) completeSimTask(SIM_ID, 't-signals', 60)

      /* thrash watch: evicted page re-faulted within 10 accesses */
      const watch = evictWatchRef.current
      if (watch && faultStage && w.vpn === watch.vpn && next.accesses <= watch.until) {
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
    [log, mode, policy, setVm, setWalk, tlbSize],
  )

  const issueWalk4 = useCallback(
    (addr: number) => {
      if (mode !== 'walk4' || walk4Ref.current) return
      const normalized = addr % 2 ** 48
      const vpn = Math.floor(normalized / 0x1000)
      const tlbHit = walk4TlbRef.current.has(vpn)
      const w4 = planWalk4(normalized, tlbHit)
      if (!tlbHit) {
        const nextTlb = new Map(walk4TlbRef.current)
        nextTlb.set(vpn, w4.frame)
        walk4TlbRef.current = nextTlb
        setWalk4Tlb(nextTlb)
      }
      const nw = { ...w4, idx: 0 }
      const t = bump()
      log(
        t,
        'CPU',
        `VA ${hx16(nw.addr)} → PML4=${nw.pml4} PDPT=${nw.pdpt} PD=${nw.pd} PT=${nw.pt} off=${nw.offset}`,
      )
      setWalk4(nw)
      walk4Ref.current = nw
    },
    [bump, log, mode, setWalk4, setWalk4Tlb],
  )

  const issueNext = useCallback(() => {
    if (mode !== 'flat') return
    if (workload === 'scan' && counterRef.current >= SCAN_ACCESSES) {
      completeSimTask(SIM_ID, 't-vm-scan', 60)
      setPlaying(false)
      return
    }
    const addr = workloadAddr(workload, counterRef.current, rngRef.current, procCount, admitted)
    counterRef.current += 1
    issueAccess(addr)
  }, [admitted, issueAccess, mode, procCount, setPlaying, workload])

  /* ----------------------------- stage logging ----------------------------- */
  const logStage = useCallback(
    (stage: WalkStage | Walk4Stage) => {
      const t = ticksRef.current
      if (stage.kind === 'emit') {
        if ('vpn' in stage) {
          const s = stage as Extract<WalkStage, { kind: 'emit' }>
          log(t, 'CPU', `VA ${hx3(s.addr)} → VPN=${hx(s.vpn)} · offset=${hx(s.offset)}`)
        } else {
          const s = stage as Extract<Walk4Stage, { kind: 'emit' }>
          log(
            t,
            'CPU',
            `VA ${hx16(s.addr)} → PML4=${s.pml4} PDPT=${s.pdpt} PD=${s.pd} PT=${s.pt} off=${s.offset}`,
          )
        }
        return
      }
      if (stage.kind === 'tlb') {
        if (stage.hit) log(t, 'TLB', 'HIT — 0 page-table reads', 'ok')
        else log(t, 'TLB', 'MISS — walk the page table', 'warn')
        return
      }
      if (stage.kind === 'ptwalk') {
        if (stage.resident) log(t, 'WALK', `PTE[${hx(stage.vpn)}] → PFN ${stage.pfn} · valid`)
        else log(t, 'WALK', `PTE[${hx(stage.vpn)}] ✗ not resident`, 'warn')
        return
      }
      if (stage.kind === 'fault') {
        if (stage.major) log(t, 'MAJOR', `page ${hx(stage.vpn)} on swap — disk I/O (~200 cycles)`, 'err')
        else log(t, 'MINOR', `page ${hx(stage.vpn)} lazily allocated — zero fill (~10 cycles)`, 'warn')
        return
      }
      if (stage.kind === 'evict') {
        log(t, 'EVICT', `p${stage.vpn} from frame ${stage.frame} (${stage.policy}, age ${stage.age})`, 'warn')
        return
      }
      if (stage.kind === 'load') {
        if (stage.major) log(t, 'LOAD', `swap → frame ${stage.frame} (major, ~200 cycles)`)
        else log(t, 'LOAD', `zero/heap → frame ${stage.frame} (minor, ~10 cycles)`)
        return
      }
      if (stage.kind === 'tlbfill') {
        log(t, 'TLB', `fill ${hx(stage.vpn)}→${stage.pfn}`)
        return
      }
      if (stage.kind === 'touch') {
        const s = stage as Extract<WalkStage, { kind: 'touch' }> | Extract<Walk4Stage, { kind: 'touch' }>
        if (s.addr < (1 << 16)) {
          log(t, 'READ', `${hx3(s.addr)} → PA ${hx3(s.pa)} ✓`, 'ok')
        } else {
          log(t, 'READ', `${hx16(s.addr)} → PA ${hx16(s.pa)} ✓`, 'ok')
        }
        return
      }
      if (stage.kind === 'read') {
        log(t, stage.level, `read level ${stage.level}[${stage.idx}] — ${stage.cycles} cycles`)
        return
      }
      if (stage.kind === 'resolve') {
        log(t, 'FRAME', `resolved → frame ${stage.frame} · PA ${hx16(stage.pa)}`, 'ok')
      }
    },
    [log],
  )

  /* ----------------------------- advance step ----------------------------- */
  const advance = useCallback(() => {
    if (mode === 'pa') return

    if (mode === 'walk4') {
      const w4 = walk4Ref.current
      if (!w4) {
        issueWalk4(parseInt(walk4Input || '0', 16) || WALK4_ADDR)
        return
      }
      if (w4.idx >= w4.stages.length - 1) {
        setWalk4(null)
        walk4Ref.current = null
        setPlaying(false)
        return
      }
      bump()
      const nextIdx = w4.idx + 1
      logStage(w4.stages[nextIdx])
      const nw = { ...w4, idx: nextIdx }
      setWalk4(nw)
      walk4Ref.current = nw
      if (nextIdx >= nw.stages.length - 1) completeSimTask(SIM_ID, 't-vm-walk4', 60)
      return
    }

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
  }, [bump, issueNext, issueWalk4, logStage, mode, setPlaying, setWalk, setWalk4, walk4Input])

  const advanceRef = useRef(advance)
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  useEffect(() => {
    if (!playing || hostMode !== 'paging') return
    const id = window.setInterval(() => {
      if (hostMode === 'paging') advanceRef.current()
    }, 600 / speed)
    return () => window.clearInterval(id)
  }, [hostMode, playing, speed])

  /* ----------------------------- task: locality ----------------------------- */
  const hitRate = vm.accesses > 0 ? vm.hits / vm.accesses : 0
  useEffect(() => {
    if (workload === 'locality' && vm.accesses >= 24 && hitRate > 0.9) {
      completeSimTask(SIM_ID, 't-locality', 60)
    }
  }, [workload, vm.accesses, hitRate])

  /* ----------------------------- task: frames / admit ----------------------------- */
  useEffect(() => {
    if (frameCount < 4 && vm.majorFaults > 0) {
      completeSimTask(SIM_ID, 't-vm-frames', 60)
    }
  }, [frameCount, vm.majorFaults])

  useEffect(() => {
    if (workload === 'mp' && admitControl && refused > 0 && vm.accesses > 0) {
      completeSimTask(SIM_ID, 't-vm-admit', 60)
    }
  }, [workload, admitControl, refused, vm.accesses])

  /* ----------------------------- reset ----------------------------- */
  const reset = useCallback(() => {
    setVm(blankVM(frameCount))
    setWalk(null)
    walkRef.current = null
    setWalk4(null)
    walk4Ref.current = null
    setPlaying(false)
    walk4TlbRef.current = new Map()
    setWalk4Tlb(new Map())
    setOsForked(false)
    setOsCowCopied(false)
    setPa(blankPA())
    counterRef.current = 0
    signalsRef.current = { hit: false, miss: false, fault: false }
    evictWatchRef.current = null
    ticksRef.current = 0
    setTicks(0)
    log(0, 'RESET', 'machine rebooted — pages 0–3 preloaded, TLB cold')
  }, [frameCount, log, setOsCowCopied, setOsForked, setPa, setPlaying, setTicks, setVm, setWalk, setWalk4, setWalk4Tlb])

  const forkProcess = useCallback(() => {
    if (osForked) return
    const t = bump()
    setOsForked(true)
    setOsCowCopied(false)
    log(t, 'FORK', 'child process created — resident pages shared read-only', 'ok')
  }, [bump, log, osForked, setOsCowCopied, setOsForked])

  const writeCowPage = useCallback(() => {
    if (!osForked || osCowCopied) return
    const t = bump()
    setOsCowCopied(true)
    log(t, 'COW', 'child wrote page 0 — minor fault copied exactly one private page', 'warn')
    completeSimTask(SIM_ID, 't-vm-cow', 60)
  }, [bump, log, osCowCopied, osForked, setOsCowCopied])
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

  /* ----------------------------- policy comparison ----------------------------- */
  const comparison = useMemo(() => {
    const accesses = workload === 'scan' ? SCAN_ACCESSES : workload === 'mp' ? 40 : 48
    const lru = simulateRun(workload, frameCount, tlbSize, 'lru', accesses, procCount, admitControl)
    const clock = simulateRun(workload, frameCount, tlbSize, 'clock', accesses, procCount, admitControl)
    return { lru, clock, accesses }
  }, [workload, frameCount, tlbSize, procCount, admitControl])

  /* ----------------------------- arrow overlay ----------------------------- */
  const stageRef = useRef<HTMLDivElement>(null)
  const [arrow, setArrow] = useState<{ d: string; color: string } | null>(null)

  /* eslint-disable react-hooks/set-state-in-effect --
     legitimate measure-then-render: arrow geometry needs DOM rects, which only
     exist in a layout effect (the React-endorsed useLayoutEffect use case). */
  useLayoutEffect(() => {
    const container = stageRef.current
    if (!container || mode !== 'flat' || !walk || walk.idx < 0) {
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
  }, [walk, vm.tlb, mode])
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

  const activeWalk4Stage = walk4 && walk4.idx >= 0 ? walk4.stages[walk4.idx] : null

  return (
    <PlaygroundShell
      simId={SIM_ID}
      title={hostMode === 'paging' ? 'VM Paging Simulator' : 'Contention Lab'}
      subtitle={
        hostMode === 'paging'
          ? 'page tables · TLB · faults · ≡ PagedAttention'
          : 'mutexes · atomics · cache coherence · ABA'
      }
      tasks={
        hostMode === 'paging'
          ? [
              { id: 't-vm-walk4', text: 'Translate 0x7f3a_b2c4_1000 through all four x86-64 page-table levels', xp: 60 },
              { id: 't-vm-minor', text: 'Touch a lazily-allocated page and watch a minor fault install it with no disk I/O', xp: 60 },
              { id: 't-vm-major', text: 'Evict a page to swap, then re-access it and watch a major fault pay disk I/O', xp: 60 },
              { id: 't-vm-frames', text: 'Shrink frames below the working set to find the thrashing cliff', xp: 60 },
              { id: 't-vm-scan', text: 'Run the one-shot scan preset and compare LRU vs Clock fault counts', xp: 60 },
              { id: 't-vm-admit', text: 'Enable admission control and watch the 5th process refused when frames are exhausted', xp: 60 },
              { id: 't-signals', text: 'Cause a TLB hit, a miss, and a fault — name each in the log', xp: 60 },
              { id: 't-locality', text: 'With the 80/20 workload, get TLB hit-rate above 90%', xp: 60 },
              { id: 't-thrash', text: 'Fill memory and watch an evicted page get needed again (thrashing)', xp: 60 },
              { id: 't-pafork', text: 'In PagedAttention mode, fork a sequence and share prefix blocks', xp: 60 },
              { id: 't-vm-cow', text: 'Fork an OS process, then write one page and watch COW copy only that page', xp: 60 },
            ]
          : CONTENTION_TASKS
      }
      help={
        hostMode === 'paging' ? (
          <>
            <p>
              The CPU emits 12-bit virtual addresses in flat-table mode: top 4 bits pick a{' '}
              <span className="font-mono text-text-1">page</span> (16 total), low 8 bits are the
              offset. Switch to <span className="font-mono text-text-1">x86-64 4-level</span> to walk
              a canonical 48-bit address through PML4/PDPT/PD/PT. The <span className="font-mono text-text-1">TLB</span>{' '}
              caches recent translations (1 cycle); a miss walks the page table (20); a{' '}
              <span className="font-mono text-text-1">minor</span> fault lazily allocates a frame
              (~10) while a <span className="font-mono text-text-1">major</span> fault reads swap
              (~200). Use the frame-count slider to find the thrashing cliff, the scan preset to
              contrast LRU and Clock, and multi-process admission control to make the cliff vanish.
            </p>
            <p>
              Then flip <span className="font-mono text-text-1">≡ PagedAttention</span>: virtual
              pages become token blocks, the page table becomes a block table, frames become KV
              blocks in HBM. Fork a sequence and the prefix is shared copy-on-write — the exact
              trick from the vLLM paper.
            </p>
          </>
        ) : (
          <>
            <p>
              Compare mutex, atomic CAS, and striped counters as thread count rises. A single
              atomic cache line bounces between cores, while striped counters keep independent
              cache lines and combine them only when read.
            </p>
            <p>
              In the ABA inspector, replay the interleaving that makes a stale compare-and-swap
              appear valid. Enable tagged pointers to attach a version to the address and reject
              the stale operation.
            </p>
          </>
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface-1 px-4 py-2">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">
            machine
          </span>
          <ChipButton active={hostMode === 'paging'} onClick={() => selectHostMode('paging')}>
            paging
          </ChipButton>
          <ChipButton active={hostMode === 'contention'} onClick={() => selectHostMode('contention')}>
            contention
          </ChipButton>
        </div>
        {hostMode === 'contention' ? (
          <div className="min-h-0 flex-1">
            <ContentionLab />
          </div>
        ) : (
      <div className="flex min-h-0 flex-1 flex-col">
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
                    {mode === 'pa' ? 'gpu sampler' : mode === 'walk4' ? 'x86-64 mmu' : 'cpu'} · virtual address
                  </p>
                  <p className="font-mono text-[13px] text-text-1">
                    {mode === 'walk4'
                      ? hx16(walk4?.addr ?? WALK4_ADDR)
                      : emitAddr !== null
                        ? hx3(emitAddr)
                        : '0x···'}
                    {mode !== 'walk4' && (
                      <span className="ml-2 text-[11px]">
                        <span className="text-[#22D3EE]">{vpnBits}</span>
                        <span className="text-text-3"> </span>
                        <span className="text-amber">{offBits}</span>
                      </span>
                    )}
                  </p>
                  {mode !== 'walk4' && (
                    <p className="font-mono text-[9px] text-text-3">
                      <span className="text-[#22D3EE]">VPN {emitAddr !== null ? hx(emitAddr >> PAGE_BITS) : '·'}</span>
                      {' · '}
                      <span className="text-amber">offset {emitAddr !== null ? hx(emitAddr & 0xff) : '·'}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { label: 'TLB hit-rate', value: `${hitRatePct}%`, color: hitRatePct >= 90 ? '#3EF2A4' : hitRatePct >= 60 ? '#5CA8FF' : '#FFB224' },
                  { label: 'minor', value: String(vm.minorFaults), color: vm.minorFaults > 0 ? '#5CA8FF' : '#5D6B80' },
                  { label: 'major', value: String(vm.majorFaults), color: vm.majorFaults > 0 ? '#FF5C6C' : '#5D6B80' },
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

            {mode === 'flat' && (
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
                      virtual pages ({VPAGES})
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
                      physical frames ({frameCount})
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
                          vm.pt[vpn].swap
                            ? 'bg-[#FB7185]/15 text-[#FB7185]'
                            : vm.pt[vpn].resident
                              ? 'text-text-3/30'
                              : 'text-text-3/50',
                        )}
                      >
                        {hx(vpn)}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}

            {mode === 'walk4' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
                <div>
                  <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                    48-bit canonical address decomposition
                  </p>
                  <div className="mb-4 flex items-center gap-2 rounded-sm border border-line bg-surface-1 p-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">4-level TLB</span>
                    <span className="font-mono text-[10px] text-[#5CA8FF]">
                      {walk4Tlb.size === 0 ? 'cold' : `${walk4Tlb.size} translation${walk4Tlb.size === 1 ? '' : 's'} cached`}
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-text-3">
                      {activeWalk4Stage?.kind === 'tlb'
                        ? activeWalk4Stage.hit ? 'HIT · 0 reads' : 'MISS · 4 reads'
                        : 'translate twice to compare'}
                    </span>
                  </div>
                  {walk4 ? (
                    <>
                      <div className="mb-4 rounded-sm border border-line bg-surface-1 p-3 font-mono text-[12px]">
                        <div className="flex flex-wrap gap-x-1 gap-y-1">
                          {(() => {
                            const a = walk4.addr
                            const bits = a.toString(2).padStart(48, '0')
                            const groups = [
                              { label: 'PML4', bits: bits.slice(0, 9), color: '#22D3EE' },
                              { label: 'PDPT', bits: bits.slice(9, 18), color: '#A78BFA' },
                              { label: 'PD', bits: bits.slice(18, 27), color: '#FBBF24' },
                              { label: 'PT', bits: bits.slice(27, 36), color: '#3EF2A4' },
                              { label: 'offset', bits: bits.slice(36), color: '#FB7185' },
                            ]
                            return groups.map((g) => (
                              <div key={g.label} className="flex items-center gap-1">
                                <span className="text-[9px] uppercase text-text-3">{g.label}</span>
                                <span style={{ color: g.color }}>{g.bits}</span>
                              </div>
                            ))
                          })()}
                        </div>
                      </div>

                      <div className="grid gap-2">
                        {([
                          ['PML4', walk4.pml4, '#22D3EE'],
                          ['PDPT', walk4.pdpt, '#A78BFA'],
                          ['PD', walk4.pd, '#FBBF24'],
                          ['PT', walk4.pt, '#3EF2A4'],
                        ] as const).map(([level, idx, color]) => {
                          const active = activeWalk4Stage?.kind === 'read' && activeWalk4Stage.level === level
                          const stageIndex = walk4.stages.findIndex(
                            (stage) => stage.kind === 'read' && stage.level === level,
                          )
                          const done = stageIndex >= 0 && walk4.idx > stageIndex
                          return (
                            <div
                              key={level}
                              className={cn(
                                'flex items-center gap-3 rounded-sm border border-line bg-surface-1 px-3 py-2 transition-all duration-200',
                                active && 'ring-2',
                                done && 'opacity-70',
                              )}
                              style={active ? { borderColor: color, boxShadow: `0 0 0 2px ${color}` } : undefined}
                            >
                              <span className="w-12 font-mono text-[10px] uppercase" style={{ color }}>
                                {level}
                              </span>
                              <span className="font-mono text-[12px] text-text-1">
                                [{idx}] → next level
                              </span>
                              <span className="ml-auto font-mono text-[9px] text-text-3">
                                {done || active ? '20 cycles' : 'pending'}
                              </span>
                            </div>
                          )
                        })}
                        <div
                          className={cn(
                            'flex items-center gap-3 rounded-sm border border-line bg-surface-1 px-3 py-2',
                            activeWalk4Stage?.kind === 'resolve' && 'ring-2 ring-accent',
                          )}
                        >
                          <span className="w-12 font-mono text-[10px] uppercase text-accent">frame</span>
                          <span className="font-mono text-[12px] text-text-1">
                            {walk4.frame} · PA {hx16(walk4.pa)}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-sm border border-dashed border-line bg-surface-1 p-4 text-center font-mono text-[11px] text-text-3">
                      press translate or step to walk the 4-level page table
                    </div>
                  )}
                </div>
              </div>
            )}

            {mode === 'pa' && (
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
            <ControlGroup label="mode">
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['flat', 'flat table'],
                    ['walk4', 'x86-64 4-level'],
                    ['pa', '≡ PagedAttention'],
                  ] as [SimMode, string][]
                ).map(([m, label]) => (
                  <ChipButton
                    key={m}
                    active={mode === m}
                    color="#A78BFA"
                    onClick={() => changeMode(m)}
                    className="text-center"
                  >
                    {label}
                  </ChipButton>
                ))}
              </div>
            </ControlGroup>

            {mode !== 'pa' && (
              <>
                <ControlGroup label="OS process copy-on-write">
                  <div className="grid grid-cols-2 gap-1.5">
                    <ChipButton active={osForked} onClick={forkProcess} disabled={osForked}>
                      fork process
                    </ChipButton>
                    <ChipButton active={osCowCopied} onClick={writeCowPage} disabled={!osForked || osCowCopied}>
                      write page 0
                    </ChipButton>
                  </div>
                  <p className="font-mono text-[10px] leading-relaxed text-text-3">
                    {!osForked
                      ? 'fork shares the process pages read-only.'
                      : osCowCopied
                        ? 'child owns one copied page; all other pages remain shared.'
                        : 'pages are shared; write one page to trigger a COW minor fault.'}
                  </p>
                </ControlGroup>

                <ControlGroup label="translate an address">
                  {mode === 'walk4' ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-text-3">0x</span>
                        <input
                          value={walk4Input}
                          onChange={(e) =>
                            setWalk4Input(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 12).toUpperCase())
                          }
                          className="h-8 w-32 rounded-sm border border-line bg-surface-2 px-2 font-mono text-[12px] text-text-1 outline-none focus:border-accent"
                          aria-label="x86-64 virtual address (hex, 48-bit)"
                        />
                        <ChipButton onClick={() => issueWalk4(parseInt(walk4Input || '0', 16) || WALK4_ADDR)}>
                          translate
                        </ChipButton>
                      </div>
                      <ChipButton
                        onClick={() => {
                          setWalk4Input('7F3AB2C41000')
                          issueWalk4(WALK4_ADDR)
                        }}
                        className="text-center"
                      >
                        preset 0x7f3a_b2c4_1000
                      </ChipButton>
                    </div>
                  ) : (
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
                      <ChipButton onClick={() => issueAccess((parseInt(addrInput || '0', 16) || 0) & 0xfff)}>
                        translate
                      </ChipButton>
                      <ChipButton
                        onClick={() => issueAccess(Math.floor(rngRef.current() * 4096))}
                        className="flex items-center gap-1"
                      >
                        <Shuffle size={11} strokeWidth={1.75} /> random
                      </ChipButton>
                    </div>
                  )}
                  <p className="font-mono text-[10px] leading-relaxed text-text-3">
                    {mode === 'walk4'
                      ? 'step through PML4 → PDPT → PD → PT → frame.'
                      : 'or click any virtual page on stage. each translation is steppable with →.'}
                  </p>
                </ControlGroup>
              </>
            )}

            {mode === 'flat' && (
              <>
            <ControlGroup label="workload (auto run)">
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['sequential', 'seq scan'],
                    ['random', 'random'],
                    ['locality', '80/20'],
                    ['mmap', 'mmap file'],
                    ['scan', 'one-shot scan'],
                    ['mp', 'multi-process'],
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
                label="frames"
                value={frameCount}
                display={String(frameCount)}
                min={1}
                max={16}
                step={1}
                onChange={changeFrameCount}
              />
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

            <ControlGroup label="policy comparison">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-sm border border-line bg-surface-2 p-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">LRU</p>
                  <p className="font-mono text-[13px] text-text-1">
                    {comparison.lru.minorFaults + comparison.lru.majorFaults}{' '}
                    <span className="text-[9px] text-text-3">faults</span>
                  </p>
                  <p className="font-mono text-[9px] text-text-3">
                    mjr {comparison.lru.majorFaults} · min {comparison.lru.minorFaults}
                  </p>
                </div>
                <div className="rounded-sm border border-line bg-surface-2 p-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">Clock</p>
                  <p className="font-mono text-[13px] text-text-1">
                    {comparison.clock.minorFaults + comparison.clock.majorFaults}{' '}
                    <span className="text-[9px] text-text-3">faults</span>
                  </p>
                  <p className="font-mono text-[9px] text-text-3">
                    mjr {comparison.clock.majorFaults} · min {comparison.clock.minorFaults}
                  </p>
                </div>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                {workload === 'scan'
                  ? `simulated ${comparison.accesses} accesses: 16-page scan, then hot pages 0–3 again.`
                  : `simulated ${comparison.accesses} accesses under each policy from a cold start.`}
              </p>
            </ControlGroup>

            <ControlGroup label="multi-process admission" className="border-b-0">
              <div className="mb-2 flex items-center gap-2">
                <Users size={14} strokeWidth={1.75} className="text-text-3" />
                <SliderRow
                  label="processes"
                  value={procCount}
                  display={String(procCount)}
                  min={1}
                  max={5}
                  step={1}
                  onChange={setProcCount}
                />
              </div>
              <label className="mb-2 flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
                admission control
                <Switch checked={admitControl} onCheckedChange={setAdmitControl} />
              </label>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: procCount }, (_, i) => {
                  const isAdmitted = i < admitted
                  return (
                    <span
                      key={i}
                      className={cn(
                        'rounded-sm px-1.5 py-0.5 font-mono text-[9px]',
                        isAdmitted
                          ? 'bg-[#3EF2A4]/15 text-[#3EF2A4]'
                          : 'bg-[#FF5C6C]/15 text-[#FF5C6C]',
                      )}
                    >
                      P{i + 1} {isAdmitted ? 'admitted' : 'refused'}
                    </span>
                  )
                })}
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                {workload === 'mp'
                  ? `each needs ${MP_WSS} frames; ${admitted} admitted, ${refused} refused.`
                  : 'select the multi-process workload to exercise admission control.'}
              </p>
            </ControlGroup>
              </>
            )}
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
          idle={mode === 'pa'}
        />
        {!embed && <LogConsole lines={lines} onClear={clear} />}
      </div>
        )}
      </div>
    </PlaygroundShell>
  )
}
