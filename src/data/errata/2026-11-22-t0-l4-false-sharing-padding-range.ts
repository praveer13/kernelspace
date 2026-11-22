import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t0-l4-false-sharing-padding-range',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t0.l4'],
  title: 'False sharing and padding: two different comparisons, neither "10-50x"',
  before: 'False sharing made the counter update "10-50x slower" than one thread, and padding the counters gave "10-50x" throughput.',
  after:
    'One 20-thread Core i5, 8 threads, rustc 1.96.0 -O: unpadded atomic counters ran 1.3-1.6x slower than one thread; padding made them 5-8x faster than unpadded. Core count and topology move both figures.',
  why: 'The slowdown against one thread and the speed-up from padding are different ratios, and neither was measured at 10-50x. Quote the comparison, the machine and the compiler, not a range.',
  source: {
    url: 'https://akkadia.org/drepper/cpumemory.pdf',
    title: 'Drepper, What Every Programmer Should Know About Memory, section 6.4.1 (false sharing, Figures 6.10 and 6.11)',
  },
} satisfies Erratum
