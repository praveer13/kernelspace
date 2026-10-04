import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t0-l2-nvme-200000x',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l2'],
  title: 'An NVMe read is about 200,000x slower than L1, not a million, and one latency set now runs the lesson',
  before:
    'The NVMe stat chip and fig 1 called a ~100 µs read "a million times slower than L1" while a quiz why said 200,000x. A why also said "two hits is roughly L1 to L2".',
  after:
    '100 µs ÷ 0.5 ns is about 200,000x, matching the table and quiz. The L1 to L2 hop is about 10x, so 2x is smaller than one cache-level step. Sources are named under the table.',
  why: 'One lesson quoted two ratios from the same table, and a distractor explanation contradicted the "3 to 10x per level" rule. Estimation drills need numbers that agree and cite a source.',
  source: {
    url: 'https://github.com/sirupsen/napkin-math',
    title: 'Eskildsen, napkin-math (latency table; Dean/Norvig lineage)',
  },
} satisfies Erratum
