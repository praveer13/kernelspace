import type { SimTask } from '@/components/sims/PlaygroundShell'

export const RUST_LAB_TASKS: SimTask[] = [
  {
    id: 't-rust-move',
    text: 'Step a move (`let b = a`) and verify: one owner, one drop; using `a` flags an error.',
    xp: 60,
  },
  {
    id: 't-rust-borrow',
    text: 'Create two shared borrows, then attempt `push` on the owner — watch the rejection point.',
    xp: 60,
  },
  {
    id: 't-rust-lifetime',
    text: 'Return a reference to a stack local; locate the lifetime proof failure.',
    xp: 60,
  },
  {
    id: 't-rust-arena',
    text: 'Refactor the rejected graph case to arena indices; confirm it compiles and runs cache-friendlier.',
    xp: 60,
  },
  {
    id: 't-rust-pipeline',
    text: 'Run the channel pipeline at 1→4 stages and observe near-linear handoff scaling.',
    xp: 60,
  },
  {
    id: 't-rust-mutex',
    text: 'Grow the mutex critical section from 50 ns to 50 µs; find where channels overtake shared state.',
    xp: 60,
  },
  {
    id: 't-rust-atomic',
    text: 'Hot atomic counter, 16 threads: confirm the single-line plateau; shard it and re-measure.',
    xp: 60,
  },
  {
    id: 't-rust-send',
    text: 'Attempt to send an Rc across threads in the inspector — read the exact compile error (Send violation).',
    xp: 60,
  },
]
