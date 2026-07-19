/**
 * Shared curriculum metadata (design.md §2, §3.2, §8, §9.5).
 * Canonical track/sim descriptors consumed by the landing page, navbar,
 * and (later) the curriculum/track/lab page agents.
 */

import type { LucideIcon } from 'lucide-react'
import {
  Layers,
  Braces,
  Cpu,
  ShieldCheck,
  Grid3X3,
  Server,
  Terminal,
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

export interface TrackMeta {
  /** Memory-segment style code: T0–T5, capstone = T* */
  code: string
  /** Route id used in /tracks/:trackId and lesson id prefixes */
  id: string
  name: string
  /** Track color hex (design.md §3.2) */
  color: string
  glyph: LucideIcon
  /** One-line promise shown on cards */
  promise: string
  lessons: number
  exercises: number
  hours: number
}

export const TRACKS: TrackMeta[] = [
  {
    code: 'T0',
    id: 't0',
    name: 'Foundations',
    color: '#34D399',
    glyph: Layers,
    promise: 'The machine under the abstraction: transistors to pointers.',
    lessons: 5,
    exercises: 4,
    hours: 3.5,
  },
  {
    code: 'T1',
    id: 't1',
    name: 'C-Level Mental Model',
    color: '#FBBF24',
    glyph: Braces,
    promise: 'Memory, pointers, and allocators — no GC to save you.',
    lessons: 7,
    exercises: 6,
    hours: 5,
  },
  {
    code: 'T2',
    id: 't2',
    name: 'OS & Concurrency',
    color: '#22D3EE',
    glyph: Cpu,
    promise: 'Virtual memory, scheduling, and races — the 1970s toolkit.',
    lessons: 8,
    exercises: 7,
    hours: 6,
  },
  {
    code: 'T3',
    id: 't3',
    name: 'Rust for Systems',
    color: '#F97316',
    glyph: ShieldCheck,
    promise: 'Ownership as a compile-time memory protocol.',
    lessons: 7,
    exercises: 6,
    hours: 5.5,
  },
  {
    code: 'T4',
    id: 't4',
    name: 'GPU Architecture',
    color: '#A78BFA',
    glyph: Grid3X3,
    promise: 'SMs, HBM, rooflines — why bandwidth is the whole game.',
    lessons: 6,
    exercises: 5,
    hours: 4.5,
  },
  {
    code: 'T5',
    id: 't5',
    name: 'LLM Serving Systems',
    color: '#FB7185',
    glyph: Server,
    promise: 'PagedAttention, continuous batching, the vLLM paper end-to-end.',
    lessons: 7,
    exercises: 8,
    hours: 6,
  },
]

export const CAPSTONE: TrackMeta = {
  code: 'T*',
  id: 'capstone',
  name: 'Capstone: Build a Toy Inference Engine',
  color: '#3EF2A4',
  glyph: Terminal,
  promise: '7 guided steps · tokenize → batch → measure.',
  lessons: 7,
  exercises: 7,
  hours: 8,
}

export const TOTAL_TRACK_LESSONS = TRACKS.reduce((n, t) => n + t.lessons, 0) // 40

export function getTrack(id: string): TrackMeta | undefined {
  if (id === 'capstone' || id === 't*') return CAPSTONE
  return TRACKS.find((t) => t.id === id || t.code.toLowerCase() === id.toLowerCase())
}

export interface SimMeta {
  id: string
  name: string
  hook: string
  icon: LucideIcon
  /** Owning track id for the colored tag */
  trackId: string
  usedIn: string
  /** Difficulty dots 1–3 */
  difficulty: 1 | 2 | 3
}

/** The nine simulators, in showcase order (home.md §6). */
export const SIMS: SimMeta[] = [
  {
    id: 'memory-grid',
    name: 'Memory Grid',
    hook: 'Touch bytes. Watch allocations ripple.',
    icon: Grid,
    trackId: 't0',
    usedIn: 'T0.L2',
    difficulty: 1,
  },
  {
    id: 'allocator',
    name: 'Toy Allocator',
    hook: 'Split, coalesce, fragment a heap of your own.',
    icon: Ungroup,
    trackId: 't1',
    usedIn: 'T1.L3',
    difficulty: 2,
  },
  {
    id: 'paging',
    name: 'VM Paging',
    hook: 'Page tables, TLB misses, and the swap dance.',
    icon: ArrowRightLeft,
    trackId: 't2',
    usedIn: 'T2.L2',
    difficulty: 2,
  },
  {
    id: 'roofline',
    name: 'Roofline Model',
    hook: 'Is your kernel compute- or bandwidth-bound?',
    icon: TrendingUp,
    trackId: 't4',
    usedIn: 'T4.L2',
    difficulty: 2,
  },
  {
    id: 'wgsl',
    name: 'WGSL Playground',
    hook: 'Write a GPU kernel in your browser tab.',
    icon: Code2,
    trackId: 't4',
    usedIn: 'T4.L4',
    difficulty: 3,
  },
  {
    id: 'quantizer',
    name: 'Quantizer',
    hook: 'FP16 → INT8 → INT4. Watch quality bend.',
    icon: SlidersHorizontal,
    trackId: 't4',
    usedIn: 'T4.L5',
    difficulty: 2,
  },
  {
    id: 'kv-calc',
    name: 'KV-Cache Calc',
    hook: 'How many tokens fit in 80 GB of HBM?',
    icon: Calculator,
    trackId: 't5',
    usedIn: 'T5.L2',
    difficulty: 1,
  },
  {
    id: 'batching',
    name: 'Batching Sim',
    hook: 'Continuous batching vs the 1962 scheduler.',
    icon: Rows3,
    trackId: 't5',
    usedIn: 'T5.L4',
    difficulty: 2,
  },
  {
    id: 'engine',
    name: 'Toy Engine',
    hook: 'The whole serving loop, ticking live.',
    icon: Cog,
    trackId: 't5',
    usedIn: 'T5.L6',
    difficulty: 3,
  },
]

/** Ordered lesson ids across tracks (T0.L1 … T5.L7) for next-lesson selectors. */
export const ORDERED_LESSON_IDS: string[] = TRACKS.flatMap((t) =>
  Array.from({ length: t.lessons }, (_, i) => `${t.id}.l${i + 1}`),
)
