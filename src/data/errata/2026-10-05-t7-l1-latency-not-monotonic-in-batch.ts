import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l1-latency-not-monotonic-in-batch',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l1'],
  title: 'Latency also rises with batch size, and goes vertical past the knee',
  before:
    'The vendor "10,000 tok/s" quiz explanation said "Throughput is monotonic in batch size; latency is not."',
  after:
    'Throughput rises and flattens as batch size grows, while latency keeps rising and goes vertical past the knee. A bare tok/s figure is likely taken at that knee.',
  why: 'Latency is not non-monotonic in batch size. It rises with it, so the contrast was wrong. The real point is that throughput saturates while latency blows up, which is why peak tok/s misleads.',
  source: { url: 'https://github.com/SemiAnalysisAI/InferenceX', title: 'SemiAnalysis InferenceX: public throughput versus interactivity benchmark runs' },
  items: [
    {
      q: 'A vendor page reports peak tok/s with no latency figures. As batch size grows, what do throughput and latency do, and why does that peak figure mislead?',
      options: [
        'Throughput climbs without limit while latency stays flat, so the peak is the best case at any load',
        'Throughput climbs then collapses while latency stays flat, so the peak is a brief spike that load erases',
        'Throughput flattens while latency keeps rising past the knee, so the peak sits where users had left',
        'Both stay flat until the cache fills, so the peak is trustworthy until requests start failing',
      ],
      correct: [2],
      why: [
        'Throughput saturates against the compute and bandwidth roofs, and latency does not stay flat: bigger batches lengthen every step and deepen the queue. A peak taken at the limit hides that cost.',
        'Throughput flattens rather than collapsing, and latency keeps rising with batch size and blows up past the knee. It does not stay flat. The old lesson called latency non-monotonic.',
        'Right: past the knee more batch adds almost no tokens, but queueing and longer steps push p99 vertical. A bare peak number is usually taken in that region, so ask for the latency.',
        'Latency climbs well before any memory limit is hit, because queueing and per-step time grow with batch. A figure with no TTFT or TPOT hides that long before requests fail.',
      ],
    },
  ],
} satisfies Erratum
