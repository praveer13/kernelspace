import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t4-l7-group-scale-metadata',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t4.l7'],
  title: 'Group-128 scales cost 0.125 bits per weight, not 4',
  before: 'The quantize.py comment and a quiz key said per-group scales (group size 128) cost "+4 bits/weight of scale metadata at INT4".',
  after: 'One 16-bit scale shared by 128 weights is 16 / 128 = 0.125 bits per weight, well under one bit. That small overhead is why group 128 is the usual sweet spot.',
  why: 'Four bits per weight of metadata would double an INT4 model, which contradicts the lesson\'s own "negligible metadata overhead" and its 4× capacity claim. Scale bits are divided by the group size.',
  source: {
    url: 'https://arxiv.org/abs/2306.00978',
    title: 'Lin et al., AWQ: Activation-aware Weight Quantization for LLM Compression and Acceleration (group size 128 used throughout)',
  },
  items: [
    {
      q: 'INT4 weights share one 16-bit scale per group of 128 weights. How much scale metadata is that per weight?',
      options: [
        '4 bits, the same as each weight',
        '0.125 bits',
        '0.5 bits',
        '16 bits',
      ],
      correct: [1],
      why: [
        'That would make the metadata as big as the weight itself, so INT4 would save nothing. The scale is shared by 128 weights.',
        'Right. 16 bits divided across 128 weights is 0.125 bits per weight, so a 4-bit weight costs about 4.1 bits in total.',
        'That divides by 32, not 128. With a group of 128 the share is a quarter of that.',
        'That is the size of one scale. Per weight it is divided by the group size.',
      ],
    },
  ],
} satisfies Erratum
