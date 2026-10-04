import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t0-l6-nccl-straggler-key',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l6'],
  title: 'In the allreduce profile, the rank with no wait bar is the straggler, not the fastest',
  before:
    'Quiz Q4 keyed: "Rank 4 is the fastest — the others are waiting on it", contradicting its own explanation that rank 4 is the straggler.',
  after:
    'Rank 4 is the straggler: it arrives at the collective last, so it never waits, while ranks 1 to 3 sit in the barrier. Their wide bars show the cost of waiting, not the cause.',
  why: 'A barrier makes the slowest participant the one with no wait time. Calling it the fastest reads the flame graph backwards, which is the skill the question tests.',
} satisfies Erratum
