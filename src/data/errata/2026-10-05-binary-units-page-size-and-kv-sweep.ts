import type { Erratum } from './schema'

export default {
  id: '2026-10-05-binary-units-page-size-and-kv-sweep',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t0.l3', 't1.l3', 't1.l4', 't2.l2', 't2.l7', 't4.l2', 't5.l4', 't5.l5'],
  title: 'Page sizes and KV-cache sizes are binary: 4 KiB pages, 128 KiB and 320 KiB per token',
  before:
    'T0 to T2 wrote a page as "4 KB" and a 64 KB matrix stride. T4.L2, T5.L4 and T5.L5 wrote KV sizes as "2.6 MB", "320 KB" and "128 KB per token" (a block as 2 MB).',
  after:
    'A page is 4,096 B = 4 KiB, the stride 65,536 B = 64 KiB, a Llama-3-8B token 131,072 B = 128 KiB (a 16-token block 2 MiB), Llama-3-70B 320 KiB, and full MHA at 70B 2.5 MiB.',
  why: 'A KB is 1,000 bytes and a KiB is 1,024; these sizes are products of powers of two. Writing them in decimal units made the same page or token size read differently from lesson to lesson.',
  source: {
    url: 'https://physics.nist.gov/cuu/Units/binary.html',
    title: 'NIST: Prefixes for binary multiples (kibi, mebi, gibi)',
  },
  items: [
    {
      q: 'A virtual-memory page is 4 KiB. One row of the T0.L3 matrix is 8192 doubles of 8 B, so 65,536 B. How many pages does one row span?',
      options: [
        'It spans 16 pages, dividing a 64 KiB row by a 4 KiB page',
        'It spans 17 pages, dividing a 64 KiB row by a 4000 byte page and rounding up',
        'It spans 8 pages, dividing a 64 KiB row by a page of 8192 bytes',
        'It spans 1 page, with one table entry covering the 64 KiB row',
      ],
      correct: [0],
      why: [
        'Right: 8192 x 8 B = 65,536 B = 64 KiB, and a page is 4,096 B = 4 KiB, so the row covers exactly 16 pages.',
        'A KiB is 1,024 bytes, so a page is 4,096 bytes, not 4,000. 65,536 / 4,096 is exactly 16, with no rounding up and no 17th page.',
        'A page is 4,096 bytes, not 8,192, and each double takes 8 bytes rather than one. Dividing 65,536 by 4,096 gives 16 pages per row.',
        'A page-table entry maps one page of 4 KiB, not a row. The column walk touches 8192 rows and therefore 8192 different pages.',
      ],
    },
  ],
} satisfies Erratum
