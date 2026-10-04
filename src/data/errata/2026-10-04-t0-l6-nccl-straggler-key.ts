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
  items: [
    {
      q: 'In an allreduce profile, ranks 1 to 3 show wide wait bars and rank 4 shows none. Which rank is the straggler?',
      options: [
        'Rank 4: it finishes first, and the others are waiting on it',
        'Ranks 1 to 3: their wide bars show the slowest compute',
        'Rank 4: it arrives last, so it never waits',
        'No rank: a barrier makes every rank wait equally long',
      ],
      correct: [2],
      why: [
        'The rank with no wait bar did not finish early. It arrived last, so there was nobody left to wait for.',
        'A wide wait bar is time spent waiting, which means that rank arrived early.',
        'Right. A barrier makes the slowest participant the one with no wait time; the wide bars show the cost of waiting, not the cause.',
        'Ranks that arrive early wait longer than ranks that arrive late, so the waits differ.',
      ],
    },
  ],
} satisfies Erratum
