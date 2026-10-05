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
    'The answer rests on the mechanism: a site\'s power envelope is fixed, so tokens per megawatt converts each hardware generation into what the site sells. The prose quotes only NVIDIA\'s stated figure: up to 35x TPS per MW at 400 TPS per user.',
  why: 'Vendor multipliers blend precision, software vintage and interactivity point. Teach them as claims to decompose, not as results, and keep the quiz key on what holds whatever the multiplier is.',
  source: { url: 'https://developer.nvidia.com/blog/inside-nvidia-groq-3-lpx-the-low-latency-inference-accelerator-for-the-nvidia-vera-rubin-platform/', title: 'NVIDIA: Inside NVIDIA Groq 3 LPX (up to 35x TPS per megawatt for Vera Rubin NVL72 plus LPX versus GB200 NVL72 at 400 TPS per user; a vendor claim)' },
  items: [
    {
      q: 'NVIDIA quotes a headline tokens-per-megawatt multiplier for a new platform. How should a learner treat that number?',
      options: [
        'As a claim at one stated interactivity point, to decompose into precision, software vintage and operating point first',
        'As a measured result that transfers to any site, since a megawatt is the same unit for every operator, model and workload',
        'As meaningless, because power is a small cost line and tokens per megawatt never changes what a site can sell',
        'As a guarantee for every workload, because each hardware generation scales tokens per megawatt in a fixed ratio',
      ],
      correct: [0],
      why: [
        'Right: the 35x NVIDIA states is for one platform pair at 400 TPS per user. Splitting it into precision, software and operating-point effects shows how much hardware alone contributes.',
        'Vendor multipliers are quoted at a chosen interactivity point and blend precision and software choices. Another workload or operating point can give a very different gain, so it does not transfer.',
        'Power is a hard capacity limit even when it is not the biggest invoice. A fixed site envelope means tokens per megawatt decides how much the site can sell, so the metric matters.',
        'Gains vary with precision, batch and interactivity, so there is no fixed per-generation ratio. The same pair of platforms can differ many-fold between regions of the frontier.',
      ],
    },
  ],
} satisfies Erratum
