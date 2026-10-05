import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l4-kv-quiz-units-and-d2-why',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l4'],
  title: 'T5.L4 quiz: the 128k-context cache is 40 GiB (about 43 GB), and one distractor was mis-explained',
  before:
    'The context-cost quiz keyed "about 40 GB" next to decimal-GB figures, and a distractor explanation said putting context length in the per-token formula "counts length twice".',
  after:
    'The 128k-context options now use one binary unit (20, 40 and 320 GiB; weights about 130 GiB). That distractor is a per-sequence total built from hidden size, which overcounts under GQA; it does not count length twice.',
  why: 'A GiB is 2^30 bytes and a GB is 10^9, about 7% apart. Mixing them in one question made the figures disagree, and the old explanation named the wrong flaw.',
  source: {
    url: 'https://huggingface.co/meta-llama/Meta-Llama-3-70B/blob/main/config.json',
    title: 'Llama-3-70B config.json (80 layers, hidden 8192, 64 attention heads, num_key_value_heads: 8)',
  },
  items: [
    {
      q: 'The KV cache for one 131,072-token context is 327,680 B per token x 131,072 tokens = 42,949,672,960 B. How should that total be written?',
      options: [
        'About 43 GiB, since a GiB is 10^9 bytes and the division gives 42.9',
        'About 40 GiB, or about 43 GB, because a GiB is 2^30 bytes and a GB is 10^9 bytes',
        'About 40 GB, because gibibytes and gigabytes name the same unit and rounding down is conventional',
        'About 400 GiB, because a GiB is 2^30 bytes and the byte total is 4.3 x 10^11',
      ],
      correct: [1],
      why: [
        'A GiB is 2^30 = 1,073,741,824 bytes, not 10^9, so the byte total is exactly 40 GiB. The figure 42.9 is the same total in decimal GB.',
        'Right: 42,949,672,960 B is exactly 40 GiB (2^30 bytes each) and about 43 GB (10^9 bytes each). Name the unit and keep one unit within a question.',
        'GiB and GB differ by about 7%, so calling the total 40 GB understates it by about 3 GB. Mixing units in one question also shifts which option looks nearest.',
        'The byte total is about 4.3 x 10^10, not 4.3 x 10^11. With 2^30 bytes per GiB the result is 40 GiB, not 400.',
      ],
    },
  ],
} satisfies Erratum
