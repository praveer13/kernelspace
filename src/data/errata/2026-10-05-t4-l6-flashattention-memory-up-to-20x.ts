import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t4-l6-flashattention-memory-up-to-20x',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t4.l6'],
  title: 'FlashAttention\'s memory saving is "up to 20×" and its speedup comes from fewer HBM accesses',
  before:
    'The T4.L6 prose said "bytes dropped 10–20×" and its lab note said "10–20× fewer HBM bytes", conflating the up-to-20× memory saving with HBM traffic.',
  after:
    'The paper reports up to 20× better memory efficiency, growing with sequence length N. The speedup comes from fewer HBM accesses: about 9× fewer in Fig. 2 (40.3 GB vs 4.4 GB).',
  why: 'Memory footprint and HBM traffic are separate quantities. The footprint saving grows with N, while the speedup on a bandwidth-bound kernel follows the bytes moved.',
  source: {
    url: 'https://arxiv.org/abs/2205.14135',
    title: 'Dao et al., FlashAttention (Fig. 2: 40.3 GB vs 4.4 GB HBM traffic; "up to 20× more memory efficient")',
  },
  items: [
    {
      q: 'In Dao et al.\'s Fig. 2 (GPT-2 medium attention), standard attention runs slower than FlashAttention. What explains the speedup?',
      options: [
        'Fewer GPU FLOPs from online softmax skipping the rescaling work standard attention repeats',
        'Far less HBM traffic from tiled kernels despite performing slightly more FLOPs overall',
        'A narrower score format that makes each score cheaper to move through HBM',
        'A memory saving that shrinks the score matrix and cuts HBM traffic by the same factor',
      ],
      correct: [1],
      why: [
        'FlashAttention does slightly more FLOPs (75.2 vs 66.6 GFLOPs, forward plus backward, in Fig. 2) because it recomputes attention in the backward pass instead of storing the N×N matrix. The win is in bytes, not arithmetic.',
        'Right: Fig. 2 reports 40.3 GB of HBM reads and writes for standard attention against 4.4 GB for FlashAttention, so a bandwidth-bound kernel runs faster.',
        'FlashAttention is exact and computes in the usual precision. It avoids writing the N×N matrix to HBM; it does not narrow the format.',
        'Footprint and traffic differ. The memory saving is up to 20× and grows with N, while the measured HBM traffic fell about 9× in Fig. 2.',
      ],
    },
  ],
} satisfies Erratum
