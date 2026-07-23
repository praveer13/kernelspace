import type { SimTask } from '@/components/sims/PlaygroundShell'

export const CONTENTION_TASKS: SimTask[] = [
  {
    id: 't-lock-base',
    text: 'Run the counter benchmark with 1 thread on all three implementations — note they\'re equally fast',
    xp: 60,
  },
  {
    id: 't-lock-pingpong',
    text: 'Scale to 16 threads on the atomic counter: watch cache-line ping-pong cap throughput',
    xp: 60,
  },
  {
    id: 't-lock-striped',
    text: 'Switch to per-thread striped counters (the LongAdder move): watch throughput scale with cores',
    xp: 60,
  },
  {
    id: 't-lock-aba',
    text: 'Replay the ABA trace in the queue inspector; then enable tagged pointers and re-run',
    xp: 60,
  },
]
