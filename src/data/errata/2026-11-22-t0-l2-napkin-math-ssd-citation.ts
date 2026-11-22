import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t0-l2-napkin-math-ssd-citation',
  date: '2026-11-22',
  kind: 'changed',
  lessons: ['t0.l2'],
  title: 'The ~100 µs NVMe figure is a rounded modern read; napkin-math now lists 200 µs',
  before:
    'The NVMe row was credited to Eskildsen\'s napkin-math as "~100 µs random SSD read" (Dean\'s 2012 table lists 150 µs).',
  after:
    'The ~100 µs NVMe figure is a typical modern random read, rounded. Dean\'s 2012 table lists 150 µs; Eskildsen\'s napkin-math lists 200 µs for an 8 KiB random read.',
  why: 'The napkin-math README now lists 200 µs for an 8 KiB SSD random read, so crediting it with 100 µs was wrong. The lesson keeps 100 µs as its rounded NVMe figure, so the 200,000x ratio stands.',
  source: {
    url: 'https://github.com/sirupsen/napkin-math/blob/44e8f8ab477d91138d15edbac4bfe4614019cc2c/README.md',
    title: 'Eskildsen, napkin-math README at commit 44e8f8a (SSD Random Read (8 KiB), 1 thread: 200 μs)',
  },
} satisfies Erratum
