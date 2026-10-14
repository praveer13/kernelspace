import type { SimTask } from '@/components/sims/PlaygroundShell'
import type { TaskHome } from '@/lib/sims/registry'

/** Rendered by MemoryGridSim's `grid` machine (wave-3.md §13). */
export const HOME: TaskHome = { simId: 'sim-memory', machine: 'grid' }

export const GRID_TASKS: SimTask[] = [
  { id: 't-byte', text: 'Store 0x2A at address 0x80', xp: 60 },
  { id: 't-deref', text: 'Point 0x90 at 0x80 and dereference it', xp: 60 },
  { id: 't-null', text: 'Dereference null and survive (run null deref)', xp: 60 },
  { id: 't-smash', text: 'Overflow the stack into the heap', xp: 60 },
]
