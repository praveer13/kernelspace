import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t0-l3-row-column-penalty-traffic-and-tlb',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t0.l3'],
  title: 'T0.L3: the column-walk penalty is DRAM traffic plus TLB thrash, not just DRAM latency',
  before:
    'The T0.L3 quiz key said that once data is cache-resident, access order barely matters because "the penalty is a DRAM-latency effect", while Q1 blamed about 8× DRAM traffic and TLB thrash.',
  after:
    'The penalty is about 8× the DRAM traffic (one 8-byte double per 64-byte line), no prefetch rescue and TLB thrash across 8192 pages. A matrix that fits in cache removes all three, so access order matters little.',
  why: 'Naming latency alone contradicted Q1 and hid two causes. Each column access pulls a 64-byte line for 8 bytes, the 64 KiB stride defeats the prefetcher, and every step lands on a new page.',
  source: {
    url: 'https://akkadia.org/drepper/cpumemory.pdf',
    title: 'Drepper, What Every Programmer Should Know About Memory (cache lines, prefetching, TLB costs)',
  },
  items: [
    {
      q: 'When the matrix shrinks to fit in L2, the row/column gap nearly vanishes. Which statement about the original penalty is accurate?',
      options: [
        'It came from wasted DRAM traffic plus TLB misses, which cache residency removes',
        'It came from DRAM latency alone, with the traffic and the TLB playing no part in it',
        'It came from index arithmetic, which a smaller matrix computes with fewer multiplies',
        'It came from branch mispredictions at each column end, which a smaller matrix avoids',
      ],
      correct: [0],
      why: [
        'Right: each column access pulls a 64-byte line for 8 bytes, about 8x the traffic, and the 64 KiB stride thrashes the TLB. In L2 neither happens, so both orders run at cache speed.',
        'Latency is how each miss shows up, but the gap also comes from 8x the traffic and TLB thrash. Calling it latency alone is the wording this correction retired.',
        'Both orders compute the same index arithmetic, which compilers reduce to an add. It costs a few cycles against about 100 ns per DRAM miss.',
        'A mispredict at each column end costs about 20 cycles per 8192 accesses, far too small to explain a gap of about 20x.',
      ],
    },
  ],
} satisfies Erratum
