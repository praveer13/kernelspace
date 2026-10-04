import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t0-l2-fig1-cache-chain',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l2'],
  title: 'Fig 1 now walks L1 → L2 → L3 → DRAM → NVMe in a chain',
  before:
    'Fig 1 drew edges from the CPU straight to L1, L2 and L3, and hung NVMe off L3, which implied the core can address each cache level directly and that disk sits beside DRAM.',
  after:
    'A load goes CPU → L1, and each miss falls to the next level: L1 → L2 → L3 → DRAM → NVMe. The step captions and highlighted edges follow the same chain.',
  why: 'The diagram contradicted its own caption ("L1 miss → L2. L2 miss → L3"). A learner\'s mental model of a miss walk should be a chain, not a fan-out.',
  source: {
    url: 'https://akkadia.org/drepper/cpumemory.pdf',
    title: 'Drepper, What Every Programmer Should Know About Memory (cache hierarchy, section 3)',
  },
} satisfies Erratum
