import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l4-tok-per-mw-vendor-claim',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l4'],
  title: 'A vendor "10x tokens per MW" claim was quizzed as if it were a measured gain',
  before:
    'The tok/MW quiz answer stated "Blackwell-class gains (10× tok/MW MoE)" as the fact that changes what a site is worth.',
  after:
    'The answer now rests on the mechanism: a site\'s power envelope is fixed, so tokens per megawatt converts each hardware generation into what the site can sell. The 10× figure stays in the prose, labelled as NVIDIA\'s pitch.',
  why: 'Vendor multipliers blend precision, software vintage and interactivity point. Teach them as claims to decompose, not as results, and keep the quiz key on what holds whatever the multiplier is.',
  source: { url: 'https://developer.nvidia.com/blog/inside-nvidia-groq-3-lpx-the-low-latency-inference-accelerator-for-the-nvidia-vera-rubin-platform/', title: 'NVIDIA: Inside NVIDIA Groq 3 LPX (vendor tokens-per-megawatt claims at a stated interactivity point; does not itself state the Blackwell 10x figure)' },
} satisfies Erratum
