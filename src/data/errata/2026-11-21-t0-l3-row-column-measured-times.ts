import type { Erratum } from './schema'

export default {
  id: '2026-11-21-t0-l3-row-column-measured-times',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t0.l3'],
  title: 'T0.L3: the row and column walk times were the simulator\'s model, ten times too slow',
  before:
    'T0.L3 said the two walks over an 8192x8192 matrix of doubles take about 0.4 seconds and 8 seconds, twenty times apart. Its Python tab used a per-element loop that hides the gap.',
  after:
    'Compiled C on one desktop (gcc 14.3, -O2) took about 0.04 s and 0.85 s on a performance core, about 21x; efficiency cores gave about 11x. The simulator\'s model prints about 0.4 s and 7 s. The Python tab sums slices.',
  why: 'The lesson quoted model output as if measured. A C loop on a Core i5-13600KF ran 0.040 s by row and 0.85 s by column in five runs, so the ratio held and the times were off.',
  source: {
    url: 'https://akkadia.org/drepper/cpumemory.pdf',
    title: 'Drepper, What Every Programmer Should Know About Memory (cache lines and access order)',
  },
} satisfies Erratum
