import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t2-l2-walk-cost-and-zgc',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t2.l2'],
  title: 'A 4-level walk costs one fifth of the bandwidth, not a quarter; ZGC keeps GC state in pointer bits',
  before:
    'A 4-level walk "would quarter your effective bandwidth". ZGC\'s colored pointers "store GC metadata in address bits the MMU ignores".',
  after:
    'Four extra walk reads plus the data read is five reads per access: one fifth of the bandwidth. ZGC keeps GC state in spare pointer bits; the old ZGC mapped the heap three times, and generational ZGC uses explicit barrier code.',
  why: 'Four extra reads and one data read make five, so one fifth. The old ZGC mapped the heap at three virtual addresses; generational ZGC uses load and store barriers. The non-generational mode was removed in JDK 24.',
  source: {
    url: 'https://openjdk.org/jeps/439',
    title: 'JEP 439: Generational ZGC',
  },
} satisfies Erratum
