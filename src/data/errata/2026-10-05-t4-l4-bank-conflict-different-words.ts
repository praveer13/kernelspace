import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t4-l4-bank-conflict-different-words',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t4.l4'],
  title: 'A bank conflict needs different words in one bank; lanes reading the same word get a broadcast',
  before:
    'The T4.L4 quiz key said a 32-way bank conflict occurs when "all 32 lanes address words in the SAME SRAM bank", which also describes 32 lanes reading one word.',
  after:
    'A conflict occurs when lanes of a warp access different 32-bit words in the same bank, and the access serializes. Lanes reading the same word are served by one broadcast with no conflict.',
  why: 'The old wording would call a broadcast a conflict. The distinction decides whether a layout needs padding: column access to a 32-wide tile conflicts, while all lanes reading one value does not.',
  source: {
    url: 'https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#shared-memory-and-memory-banks',
    title: 'CUDA C++ Best Practices Guide: Shared Memory and Memory Banks',
  },
  items: [
    {
      q: 'In shared memory, which warp access pattern causes a bank conflict that serializes the request?',
      options: [
        'All 32 lanes reading the same 32-bit word, since every lane then lands in a single shared bank',
        'Several lanes reading different 32-bit words that map to one bank, such as a column of a 2D tile',
        'Each lane reading its own consecutive 32-bit word, since neighbouring lanes share a memory port',
        'Two warps reading the same tile in the same cycle, since a bank can serve only one warp at a time',
      ],
      correct: [1],
      why: [
        'Lanes reading one word are served by a single broadcast, so there is no conflict. Conflicts need different words in the same bank.',
        'Right: different words in one bank must be served one after another. Reading a column of a 32-wide tile does this, and padding each row by one word fixes it.',
        'Consecutive words fall in consecutive banks, one per lane, so the warp is served in a single pass. This is the conflict-free layout.',
        'A bank conflict is between lanes of one warp request. Separate warps issue their own requests and do not form a conflict by sharing a tile.',
      ],
    },
  ],
} satisfies Erratum
