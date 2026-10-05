import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l5-paged-kernel-overhead-20-26-percent',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l5'],
  title: 'PagedAttention costs 20-26% kernel latency, not "a few percent"',
  before:
    'The T5.L5 quiz key said the block-table indirection is affordable because its "few-percent attention overhead" is dwarfed by the batch-size gain, and that attention is a minority of decode time.',
  after:
    'The paper measured 20-26% higher attention-kernel latency than FasterTransformer (table lookups, extra branches). Paging still wins end to end: attention is one part of a step, and freed memory allows batches that give 2-4x throughput.',
  why: 'Understating the kernel cost teaches that paging is free. The real lesson is that a sizeable kernel slowdown is repaid many times over by the memory it reclaims.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023)',
  },
  items: [
    {
      q: 'Against FasterTransformer, what does PagedAttention\'s block-table indirection cost the attention kernel itself?',
      options: [
        'Nothing measurable, because the GPU resolves the table lookup in hardware like a TLB, so the kernel matches a contiguous cache',
        'About 20-26% higher latency, which the larger batches enabled by freed memory more than repay',
        'A few percent, which is why paging is usually described as nearly free at the kernel level and costly only in memory',
        'About 2-4x higher latency, which only prefix caching can then offset in production',
      ],
      correct: [1],
      why: [
        'The lookup is done in software inside the kernel, with extra branches, and it shows up in measured latency.',
        'Right. The paper reports 20-26% higher attention latency, yet 2-4x higher end-to-end throughput because memory reclaimed from waste grows the batch.',
        'The measured figure is several times larger than a few percent. The cost is real and is justified by the throughput gain, not absent.',
        '2-4x is the throughput gain over FasterTransformer and Orca, not the kernel penalty. Prefix caching is a separate feature.',
      ],
    },
  ],
} satisfies Erratum
