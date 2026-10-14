import type { SimTask } from '@/components/sims/PlaygroundShell'
import type { TaskHome } from '@/lib/sims/registry'

/** The batching machine only: the scheduler and context-switch machines have their own files. */
export const HOME: TaskHome = { simId: 'sim-batching', machine: 'batching' }

export const BATCHING_TASKS: SimTask[] = [
  { id: 'batch-trace-static', text: 'Run the deterministic 8/12/20/40 trace on static batching and measure idle slots and wait.', xp: 60 },
  { id: 'batch-trace-continuous', text: 'Run the same 8/12/20/40 trace continuously and watch freed slots recycle.', xp: 60 },
  { id: 'batch-overload', text: 'Sweep arrival rate to 2× capacity and trigger preemption under memory pressure.', xp: 60 },
  { id: 'batch-policy', text: 'Compare youngest-first and oldest-first preemption policy.', xp: 60 },
]
