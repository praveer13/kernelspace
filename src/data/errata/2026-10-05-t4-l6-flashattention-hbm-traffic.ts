import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t4-l6-flashattention-hbm-traffic',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t4.l6'],
  title: 'FlashAttention cuts HBM traffic by about M/d², not down to O(N)',
  before: 'A quiz explanation and the lesson prose said FlashAttention reduces HBM traffic from O(N²) to "O(N)-ish", and a quiz key said tiling makes matmul compute-bound.',
  after: 'HBM accesses fall from Θ(Nd + N²) to Θ(N²d²/M) (Dao et al., Theorem 2). The extra memory is O(N), not O(N²). Tiling raises intensity toward the roof; T = 128 is still left of the ridge.',
  why: 'Traffic stays quadratic in N; it shrinks by a factor of about M/d². What becomes linear is the extra memory, since the N×N matrix is never stored. The two are different claims.',
  source: {
    url: 'https://arxiv.org/abs/2205.14135',
    title: 'Dao et al., FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness (Theorem 2)',
  },
  items: [
    {
      q: 'FlashAttention never writes the N×N score matrix to HBM. Which statement about its cost is correct?',
      options: [
        'HBM traffic becomes linear in N, so doubling the context only doubles the bytes moved between HBM and the SMs',
        'Extra memory is O(N), while HBM traffic stays quadratic in N but is smaller by about M/d²',
        'HBM traffic is unchanged, and only the extra memory shrinks, to O(N)',
        'It is an approximation: low-scoring entries are dropped, so the O(N²) matrix is replaced by a sparse O(N) one',
      ],
      correct: [1],
      why: [
        'Theorem 2 gives Θ(N²d²/M), still quadratic in N. The factor M/d² is the saving, not a change of order in N.',
        'Right: the score matrix is never stored, so extra memory is O(N). Traffic is Θ(N²d²/M) against Θ(Nd + N²), smaller by about M/d².',
        'Traffic does fall: the N×N matrix no longer round-trips through HBM. Both traffic and extra memory improve, by different amounts.',
        'FlashAttention is exact. It does not sparsify or drop scores; it only changes where they are computed.',
      ],
    },
  ],
} satisfies Erratum
