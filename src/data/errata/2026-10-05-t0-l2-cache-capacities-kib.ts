import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t0-l2-cache-capacities-kib',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t0.l2', 't4.l2', 't4.l4', 't4.l6'],
  title: 'Cache and on-chip SRAM capacities are binary: L1 32–64 KiB, H100 shared memory 228 KiB per SM',
  before:
    'T0.L2 and T4 wrote cache and SRAM sizes with decimal prefixes beside 4 KiB pages: "L1 32–64 KB", "L2 256 KB–2 MB", "228 KB shared memory per SM", "~50 MB L2".',
  after:
    'Cache and SRAM sizes are powers of two and now use binary prefixes: L1 32–64 KiB, L2 256 KiB–2 MiB, H100 shared memory 228 KiB per SM, L2 about 50 MiB. DRAM, HBM and SSD stay in vendor-quoted GB and TB.',
  why: 'A KB is 1,000 bytes and a KiB is 1,024. Cache sizes are powers of two, so the decimal label was off by 2.4%, and it sat beside a 4 KiB page in the same lesson.',
  source: {
    url: 'https://physics.nist.gov/cuu/Units/binary.html',
    title: 'NIST: Prefixes for binary multiples (kibi, mebi, gibi)',
  },
  items: [
    {
      q: 'An L1 data cache is 32 KiB and a cache line is 64 bytes. How many lines does the cache hold?',
      options: [
        'It holds 512 lines, taking a KiB to be 1024 bytes',
        'It holds 500 lines, taking a KiB to be 1000 bytes, as for a decimal KB',
        'It holds 32 lines, taking each 64-byte line to be one 1024-byte KiB',
        'It holds 4096 lines, taking each line to be eight bytes wide',
      ],
      correct: [0],
      why: [
        'Right: 32 KiB is 32 × 1,024 = 32,768 bytes, and 32,768 ÷ 64 = 512 lines. The binary size makes the division exact.',
        'That treats the KiB as decimal. A KiB is 1,024 bytes, so the cache holds 32,768 bytes and exactly 512 lines; 500 is the answer for a decimal 32 KB.',
        'A cache line is 64 bytes, not a KiB. Dividing 32 KiB by 1 KiB counts the KiB in the cache, not the lines it holds.',
        'A line is 64 bytes, not 8. An 8-byte unit is one double, and 32 KiB ÷ 8 B = 4,096 counts doubles, not cache lines.',
      ],
    },
  ],
} satisfies Erratum
