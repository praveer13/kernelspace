import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t4-l3-prefill-ai-and-5ms-floor',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t4.l3'],
  title: 'Prefill arithmetic intensity is seq_len at FP16, and the 5 ms is a per-step floor that only more tokens per weight read or fewer bytes lower',
  before: 'T4.L3 said prefill AI ≈ seq_len × (params/bytes), and that ~5 ms per token on an H100 is physics, not engineering.',
  after: 'Prefill AI ≈ seq_len FLOP/byte at FP16: 2 × seq_len FLOPs per 2-byte weight. On one H100 each decode step of an 8B FP16 model (16 GB of weights) takes at least about 5 ms; only more tokens per weight read or fewer bytes lower it.',
  why: 'Arithmetic intensity is FLOPs per byte, and the parameter count cancels. The 5 ms is one weight read at peak bandwidth, a floor per decode step. Extends 2026-10-04-decode-ai-is-one, which fixed the decode figure.',
  source: {
    url: 'https://www.nvidia.com/en-us/data-center/h100/',
    title: 'NVIDIA H100 GPU product page: H100 SXM GPU memory bandwidth',
  },
} satisfies Erratum
