/**
 * Lesson registry — the content source of truth for /curriculum, /tracks/:id
 * and the lesson engine. Enumerates all 40 lessons exactly as specified in
 * curriculum.md §3 (T0:5 · T1:6 · T2:7 · T3:6 · T4:7 · T5:9).
 *
 * Lookup accepts both canonical ids (`t1.l3`, used by the progress store and
 * pre-existing links) and human slugs (`toy-allocator`, used in /lesson/:lessonId).
 */

import type { LucideIcon } from 'lucide-react'
import {
  Grid,
  Ungroup,
  ArrowRightLeft,
  TrendingUp,
  Code2,
  SlidersHorizontal,
  Calculator,
  Rows3,
  Cog,
} from 'lucide-react'
import type { Lesson, SimId, TrackId } from './types'

// T0 — Foundations
import t0l1 from './t0/why-systems'
import t0l2 from './t0/memory-hierarchy'
import t0l3 from './t0/row-vs-column'
import t0l4 from './t0/aos-vs-soa'
import t0l5 from './t0/your-runtime'

// T1 — C-Level Mental Model
import t1l1 from './t1/stack-vs-heap'
import t1l2 from './t1/pointers'
import t1l3 from './t1/toy-allocator'
import t1l4 from './t1/fragmentation'
import t1l5 from './t1/compile-link-abi'
import t1l6 from './t1/rust-ownership-intro'

// T2 — OS & Concurrency
import t2l1 from './t2/processes-threads'
import t2l2 from './t2/virtual-memory'
import t2l3 from './t2/swapping-eviction'
import t2l4 from './t2/scheduling'
import t2l5 from './t2/concurrency-primitives'
import t2l6 from './t2/async-io'
import t2l7 from './t2/exam-pagedattention'

// T3 — Rust for Systems
import t3l1 from './t3/ownership'
import t3l2 from './t3/zero-copy'
import t3l3 from './t3/rust-concurrency'
import t3l4 from './t3/toy-executor'
import t3l5 from './t3/rust-wasm'
import t3l6 from './t3/dynamo-case-study'

// T4 — GPU Architecture
import t4l1 from './t4/cpu-vs-gpu'
import t4l2 from './t4/gpu-memory'
import t4l3 from './t4/roofline'
import t4l4 from './t4/occupancy-coalescing'
import t4l5 from './t4/wgsl-playground'
import t4l6 from './t4/matmul-tiling'
import t4l7 from './t4/quantization'

// T5 — LLM Serving Systems
import t5l1 from './t5/transformer-internals'
import t5l2 from './t5/tokenization'
import t5l3 from './t5/prefill-vs-decode'
import t5l4 from './t5/kv-cache-math'
import t5l5 from './t5/pagedattention-deep-dive'
import t5l6 from './t5/continuous-batching'
import t5l7 from './t5/speculative-chunked'
import t5l8 from './t5/distributed-serving'
import t5l9 from './t5/production-stack'

export const LESSONS_BY_TRACK: Record<TrackId, Lesson[]> = {
  t0: [t0l1, t0l2, t0l3, t0l4, t0l5],
  t1: [t1l1, t1l2, t1l3, t1l4, t1l5, t1l6],
  t2: [t2l1, t2l2, t2l3, t2l4, t2l5, t2l6, t2l7],
  t3: [t3l1, t3l2, t3l3, t3l4, t3l5, t3l6],
  t4: [t4l1, t4l2, t4l3, t4l4, t4l5, t4l6, t4l7],
  t5: [t5l1, t5l2, t5l3, t5l4, t5l5, t5l6, t5l7, t5l8, t5l9],
}

export const TRACK_IDS: TrackId[] = ['t0', 't1', 't2', 't3', 't4', 't5']

/** All 40 lessons in curriculum order. */
export const ALL_LESSONS: Lesson[] = TRACK_IDS.flatMap((id) => LESSONS_BY_TRACK[id])

export const TOTAL_LESSON_COUNT = ALL_LESSONS.length // 40

/** Canonical ids in curriculum order — for next-recommended selectors. */
export const ORDERED_LESSON_IDS: string[] = ALL_LESSONS.map((l) => l.id)

const byIdMap = new Map<string, Lesson>()
for (const l of ALL_LESSONS) {
  byIdMap.set(l.id, l)
  byIdMap.set(l.slug, l)
}

/** Resolve a lesson by canonical id (`t1.l3`) or slug (`toy-allocator`). */
export function lessonById(idOrSlug: string | undefined): Lesson | undefined {
  if (!idOrSlug) return undefined
  return byIdMap.get(idOrSlug) ?? byIdMap.get(idOrSlug.toLowerCase())
}

export function lessonsForTrack(trackId: string): Lesson[] {
  return LESSONS_BY_TRACK[trackId as TrackId] ?? []
}

/** Next lesson in curriculum order — crosses track boundaries. */
export function nextLesson(lesson: Lesson): Lesson | undefined {
  const i = ALL_LESSONS.findIndex((l) => l.id === lesson.id)
  return i >= 0 ? ALL_LESSONS[i + 1] : undefined
}

/** Previous lesson in curriculum order — crosses track boundaries. */
export function prevLesson(lesson: Lesson): Lesson | undefined {
  const i = ALL_LESSONS.findIndex((l) => l.id === lesson.id)
  return i > 0 ? ALL_LESSONS[i - 1] : undefined
}

/** Route helper — canonical lesson URL. */
export const lessonPath = (l: Lesson) => `/lesson/${l.id}`

/* ---------------------- track extras (track.md) ---------------------- */

export interface TrackExtras {
  /** Hero pitch line (track.md content notes). */
  pitch: string
  /** "After this track you can…" outcome rows (track.md §2). */
  outcomes: string[]
  /** Curriculum stack connector note shown *above* this track (`requires …`). */
  requires: string
  /** Faint mono side-note on xl lesson list (track.md §3). */
  sideNote: string
}

export const TRACK_EXTRAS: Record<TrackId, TrackExtras> = {
  t0: {
    pitch:
      'The five numbers and mental models behind every performance bug you have ever had. Latency, bandwidth, cache lines, and why your runtime has been hiding the machine from you.',
    outcomes: [
      'Recite the latency hierarchy — L1 to DRAM to NVMe — and estimate any access pattern in nanoseconds.',
      'Predict a 10–100× benchmark gap from memory layout alone, before running anything.',
      'Explain cache lines, false sharing, and why 64 bytes is the atom of performance.',
      'Read your JVM/Python runtime as a set of systems trade-offs, not magic.',
    ],
    requires: 'base of the stack · no prerequisites',
    sideNote: '// lesson 2 has the numbers that matter',
  },
  t1: {
    pitch:
      'What a function call really is, what a segfault really means, and why allocators run the world. The C-level mental model every systems engineer carries in their head.',
    outcomes: [
      'Draw a stack frame from memory: return address, saved registers, locals, and the red zone.',
      'Implement malloc and free with an explicit free list — split, coalesce, repeat.',
      'Diagnose internal vs external fragmentation and argue when fixed-size blocks win.',
      'Trace source → object file → linker → loader → running process, including the ABI.',
      'Read Rust ownership as the compile-time answer to every bug in this track.',
    ],
    requires: 'requires T0 · cache lines & latency',
    sideNote: '// lesson 3 is the highest-ROI exercise in the course',
  },
  t2: {
    pitch:
      'The operating system ideas LLM serving re-invented — page tables, eviction, scheduling. Once you see PagedAttention as 1979 virtual memory wearing a GPU, the papers read themselves.',
    outcomes: [
      'Walk a page table by hand and explain exactly what a TLB miss costs.',
      'Compare LRU/LFU/Clock eviction and predict thrashing before it happens.',
      'Reason about preemptive scheduling, admission control, and priority inversion.',
      'Choose between mutex, atomic, and lock-free queue — and defend the choice.',
      'Map every line of the PagedAttention paper to an OS primitive you now own.',
    ],
    requires: 'requires T1 · pointers & allocators',
    sideNote: '// lesson 7 is the exam — the actual vLLM paper',
  },
  t3: {
    pitch:
      'Just enough Rust to read Dynamo’s data plane without flinching. Ownership as a compile-time memory protocol, zero-copy as a discipline, async as a state machine you could build yourself.',
    outcomes: [
      'Predict borrow-checker errors before compiling — and fix them by redesign, not by clone().',
      'Use slices, &str, and unsafe blocks deliberately, with documented invariants.',
      'Pick the right concurrency tool: channel, Mutex, atomic, or lock-free structure.',
      'Build a toy async executor — waker, poll loop, and all — in an afternoon.',
      'Explain why NVIDIA wrote Dynamo’s data plane in Rust, in their own vocabulary.',
    ],
    requires: 'requires T2 · scheduling & races',
    sideNote: '// lesson 4 demystifies async forever',
  },
  t4: {
    pitch:
      'The machine your models actually run on — warps, HBM, rooflines. After this track, "GPU poor" stops being a meme and becomes an arithmetic claim you can verify.',
    outcomes: [
      'Contrast latency machines (CPU) with throughput machines (GPU) quantitatively.',
      'Place HBM, L2, shared memory, and registers on one bandwidth/latency map.',
      'Run a roofline analysis: arithmetic intensity in, bound classification out.',
      'Write and debug a WebGPU compute kernel — vector add to parallel reduction.',
      'See FlashAttention as cache blocking, and quantization as a bandwidth multiplier.',
    ],
    requires: 'requires T0 · memory hierarchy',
    sideNote: '// lesson 3 is why decode is bandwidth-bound',
  },
  t5: {
    pitch:
      'Everything converges: attention math to vLLM to NVIDIA Dynamo. The production stack, end to end — tokens in, TTFT/ITL out, and the fifty years of systems ideas holding it up.',
    outcomes: [
      'Compute KV-cache bytes for any model: 2 × layers × hidden × bytes — from first principles.',
      'Explain block tables, copy-on-write prefix sharing, and near-zero fragmentation in vLLM.',
      'Show why continuous batching dominates static batching on real traffic.',
      'Argue tensor vs pipeline parallelism and when prefill/decode disaggregation pays.',
      'Read the architectures of vLLM, SGLang, TensorRT-LLM, and Dynamo — and compare them.',
    ],
    requires: 'requires T4 · roofline & HBM',
    sideNote: '// lesson 4 is the one everyone quotes',
  },
}

/* ---------------------- sim metadata (track.md §4) ---------------------- */

export interface SimInfo {
  id: SimId
  name: string
  hook: string
  icon: LucideIcon
  trackId: TrackId
}

export const SIM_INFO: Record<SimId, SimInfo> = {
  'sim-memory': {
    id: 'sim-memory',
    name: 'Memory Grid',
    hook: 'Touch bytes. Walk the latency ladder yourself.',
    icon: Grid,
    trackId: 't0',
  },
  'sim-allocator': {
    id: 'sim-allocator',
    name: 'Toy Allocator',
    hook: 'Split, coalesce, and fragment a heap of your own.',
    icon: Ungroup,
    trackId: 't1',
  },
  'sim-vm': {
    id: 'sim-vm',
    name: 'VM Paging',
    hook: 'Page tables, TLB misses, and the swap dance.',
    icon: ArrowRightLeft,
    trackId: 't2',
  },
  'sim-roofline': {
    id: 'sim-roofline',
    name: 'Roofline Model',
    hook: 'Compute-bound or bandwidth-bound? Plot it.',
    icon: TrendingUp,
    trackId: 't4',
  },
  'sim-wgsl': {
    id: 'sim-wgsl',
    name: 'WGSL Playground',
    hook: 'Write a GPU kernel in your browser tab.',
    icon: Code2,
    trackId: 't4',
  },
  'sim-quant': {
    id: 'sim-quant',
    name: 'Quantizer',
    hook: 'FP16 → FP8 → INT4. Watch the bits bend.',
    icon: SlidersHorizontal,
    trackId: 't4',
  },
  'sim-kv': {
    id: 'sim-kv',
    name: 'KV-Cache Calc',
    hook: 'How many tokens fit in 80 GB of HBM?',
    icon: Calculator,
    trackId: 't5',
  },
  'sim-batching': {
    id: 'sim-batching',
    name: 'Batching Sim',
    hook: 'Continuous batching vs the 1962 scheduler.',
    icon: Rows3,
    trackId: 't5',
  },
  'sim-engine': {
    id: 'sim-engine',
    name: 'Toy Engine',
    hook: 'The whole serving loop, ticking live.',
    icon: Cog,
    trackId: 't5',
  },
}

/** Sims exercised by a given track's lessons (deduped, curriculum order). */
export function simsForTrack(trackId: string): { sim: SimInfo; lesson: Lesson }[] {
  const out: { sim: SimInfo; lesson: Lesson }[] = []
  const seen = new Set<SimId>()
  for (const l of lessonsForTrack(trackId)) {
    if (l.simId && !seen.has(l.simId)) {
      seen.add(l.simId)
      out.push({ sim: SIM_INFO[l.simId], lesson: l })
    }
  }
  return out
}

export type { Lesson, ContentBlock } from './types'
