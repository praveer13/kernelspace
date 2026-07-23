import type { SimTask } from '@/components/sims/PlaygroundShell'

export const SCHEDULER_LAB_TASKS: SimTask[] = [
  {
    id: 't-sched-fifo',
    text: 'Run FIFO with one 60× long job and measure the convoy effect on short-job p99.',
    xp: 60,
  },
  {
    id: 't-sched-rr',
    text: 'Enable round-robin (quantum 1×) and watch short-job p99 collapse; note the throughput overhead.',
    xp: 60,
  },
  {
    id: 't-sched-inversion',
    text: "Add priorities and reproduce inversion: high waits on low's resource while medium runs.",
    xp: 60,
  },
  {
    id: 't-sched-pi',
    text: 'Enable priority inheritance and confirm high-priority latency recovers.',
    xp: 60,
  },
  {
    id: 't-sched-admit',
    text: 'Toggle admission control off under 2× overload and watch the runqueue and p99 explode.',
    xp: 60,
  },
]
