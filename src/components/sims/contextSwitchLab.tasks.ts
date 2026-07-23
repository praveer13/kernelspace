import type { SimTask } from '@/components/sims/PlaygroundShell'

export const CONTEXT_SWITCH_LAB_TASKS: SimTask[] = [
  { id: 't-ctx-baseline', text: 'Run 8 runnable units on 8 slots and measure the near-zero-overhead baseline.', xp: 60 },
  { id: 't-ctx-cliff', text: 'Scale to 64 runnable units on 8 slots and expose the context-switch throughput cliff.', xp: 60 },
  { id: 't-ctx-timeslice', text: 'Halve the timeslice at 64 runnable units and confirm switch overhead grows.', xp: 60 },
  { id: 't-ctx-amortize', text: 'Increase unit work to 10× at the same load and recover throughput by amortization.', xp: 60 },
]
