import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t0-l2-page-size-kib',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t0.l2'],
  title: 'T0.L2: a virtual-memory page is 4 KiB (4,096 bytes), not 4 KB',
  before:
    'A T0.L2 quiz option said a miss pulls in "a full 4 KB page" after quoting 4,096 bytes, and its explanation said "4 KB is the virtual-memory page size".',
  after:
    'A virtual-memory page is 2^12 = 4,096 bytes = 4 KiB. A decimal 4 KB would be 4,000 bytes. The option and its explanation now write 4 KiB.',
  why: 'A KB is 1,000 bytes and a KiB is 1,024. Page sizes are powers of two, so the decimal label was 96 bytes short and disagreed with the 4,096 in the same option.',
  source: {
    url: 'https://physics.nist.gov/cuu/Units/binary.html',
    title: 'NIST: Prefixes for binary multiples (kibi, mebi, gibi)',
  },
  items: [
    {
      q: 'The page-table entry says a virtual-memory page is 4 KiB. How many bytes does one page hold?',
      options: [
        'It holds 4,096 bytes, because a KiB is 2^10 = 1,024 bytes and the page is four of them',
        'It holds 4,000 bytes, because a KiB is 10^3 bytes and the page is four of them exactly',
        'It holds 4,096 bytes, because a KiB is 1,000 bytes and 96 more are reserved for the entry',
        'It holds 64 bytes, because a page is one cache line and a KiB counts those lines as units',
      ],
      correct: [0],
      why: [
        'Right: a KiB is 2^10 = 1,024 bytes, so four of them are 4,096 bytes, the same as 2^12. A decimal 4 KB would be 4,000 bytes.',
        'That treats KiB as decimal. A KiB is 1,024 bytes, so four are 4,096; 4,000 is the decimal 4 KB, and page sizes are powers of two.',
        'The right number for the wrong reason: a KiB is 1,024 bytes, so four are exactly 4,096 with nothing reserved. Page-table entries are stored separately, not inside the page.',
        'A 64-byte unit is a cache line, not a page. A page is 4,096 bytes, which is 64 cache lines, and the cache fills one line at a time.',
      ],
    },
  ],
} satisfies Erratum
