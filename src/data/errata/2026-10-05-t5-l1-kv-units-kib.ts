import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l1-kv-units-kib',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l1'],
  title: 'T5.L1 KV-cache sizes are binary: 512 KiB per token and 64 GiB at 128k context',
  before:
    'The worked example and quiz wrote "512 KB per token" and "64 GB" for a 128k-token context, next to the decimal "16 GB of weights" and "4× the weights".',
  after:
    '2 × 32 × 4096 × 2 B = 524,288 B = 512 KiB per token, and × 131,072 tokens = 64 GiB (about 69 GB), roughly 4× the 16 GB (about 15 GiB) of FP16 weights.',
  why: 'A KB is 1,000 bytes and a KiB is 1,024, a GB is 10^9 and a GiB is 2^30. Mixing them in one worked example makes the cache and weight figures disagree by about 7%.',
  source: {
    url: 'https://physics.nist.gov/cuu/Units/binary.html',
    title: 'NIST: Prefixes for binary multiples (kibi, mebi, gibi)',
  },
  items: [
    {
      q: 'A model has 32 layers, 32 KV heads of head dimension 128 and an FP16 cache. One 131,072-token context holds 524,288 B per token. How should that total be written?',
      options: [
        'About 64 GB, with a GB at 2^30 bytes and a GiB at 10^9 bytes',
        'About 64 GiB or 69 GB, with a GiB at 2^30 bytes and a GB at 10^9 bytes',
        'About 69 GiB, with a GiB at 10^9 bytes and a GB at 2^30 bytes each',
        'About 2 TiB, with the 524288 bytes counted for each layer rather than each token',
      ],
      correct: [1],
      why: [
        'A GB is 10^9 bytes, not 2^30. The exact total is 68,719,476,736 B, which is 64 GiB but about 68.7 GB, so calling it 64 GB understates it by about 4.7 GB.',
        'Right: 68,719,476,736 B is exactly 64 GiB (2^30 bytes each) and about 68.7 GB (10^9 each). Name the unit and keep one unit within a question.',
        'The byte total is about 6.87 x 10^10, and dividing by 2^30 gives 64 GiB. The figure 69 is the same total in decimal GB, so 69 GiB mixes the units.',
        'The 524,288 B already covers all 32 layers: it is 2 x 32 x 4096 x 2 B per token. Multiplying by 32 again counts layers twice; times 131,072 tokens gives 64 GiB.',
      ],
    },
  ],
} satisfies Erratum
