import type { SimTask } from '@/components/sims/PlaygroundShell'

export const MATRIX_BENCH_TASKS: SimTask[] = [
  {
    id: 't-matrix-row',
    text: 'Run the row-major sum on the 8192² matrix and record its GB/s bandwidth',
    xp: 60,
  },
  {
    id: 't-matrix-col',
    text: 'Run the column-major sum on the 8192² matrix and watch the bandwidth collapse',
    xp: 60,
  },
  {
    id: 't-matrix-l2',
    text: 'Shrink to 512² (fits L2) and run both orders — the gap nearly vanishes',
    xp: 60,
  },
  {
    id: 't-matrix-prefetch',
    text: 'Toggle the prefetcher and see it rescue row-major but not the 64 KB column stride',
    xp: 60,
  },
]
