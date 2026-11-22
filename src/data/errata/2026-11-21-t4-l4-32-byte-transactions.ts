import type { Erratum } from './schema'

export default {
  id: '2026-11-21-t4-l4-32-byte-transactions',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t4.l4', 't4.l1'],
  title: 'Coalesced warp loads are 32-byte transactions, and scattered loads keep an eighth of peak, not a thirty-second',
  before:
    'The lesson said 32 adjacent words take one 128-byte transaction and that scattered loads deliver about a thirty-second of peak bandwidth.',
  after:
    'Adjacent words take four 32-byte transactions. Scattered words take 32 transactions, moving 1,024 bytes to use 128, so about an eighth of peak bandwidth.',
  why: 'Since compute capability 6.0 the hardware counts 32-byte transactions, not 128-byte ones. Each scattered 4-byte word costs one 32-byte sector, an eighth useful.',
  source: {
    url: 'https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html',
    title: 'CUDA C++ Best Practices Guide, Coalesced Access to Global Memory',
  },
} satisfies Erratum
