import type { SimTask } from '@/components/sims/PlaygroundShell'
import type { TaskHome } from '@/lib/sims/registry'

/** Rendered by MemoryGridSim's `latency` machine (wave-3.md §13). */
export const HOME: TaskHome = { simId: 'sim-memory', machine: 'latency' }

export const LATENCY_TASKS: SimTask[] = [
  {
    id: 't-lat-l1',
    text: 'Pointer-chase a ≤32 KiB working set — find which cache level answers',
    xp: 60,
  },
  {
    id: 't-lat-dram',
    text: 'Grow the working set to 64 MiB — watch latency step L1 → L2 → L3 → DRAM',
    xp: 60,
  },
  {
    id: 't-lat-stride',
    text: 'Same ≥1 MiB buffer, stride ≤64 B vs stride 4096 B — explain the gap',
    xp: 60,
  },
  {
    id: 't-lat-hbm',
    text: 'Reveal HBM on the ladder — note its bandwidth vs DRAM',
    xp: 60,
  },
]
