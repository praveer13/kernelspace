import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l4-cost-per-useful-token',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l4'],
  title: 'Cost per useful token divides by tokens delivered within SLO (goodput × time), not by all tokens produced',
  before:
    'T7.L4 divided cost by "tokens produced" and said "Tokens produced = goodput × time"; its quiz explanation said "tokens produced IS goodput".',
  after:
    'Cost per useful token = (GPU-hours × rate) ÷ tokens delivered within SLO, which is goodput × time. Tokens from requests that miss their latency targets still bill GPU-hours but do not count.',
  why: 'DistServe defines goodput as the rate served within the SLO and notes that higher per-GPU goodput directly lowers cost per query. Tokens produced also include SLO misses, so dividing by them understates cost per useful token.',
  source: {
    url: 'https://arxiv.org/abs/2401.09670',
    title: 'DistServe: disaggregating prefill and decoding (goodput is the rate served within the SLO; higher per-GPU goodput lowers cost per query)',
  },
  items: [
    {
      q: 'A fleet bills $2,000 for a day and produces 2 billion tokens, but only 1.5 billion come from requests that met their latency targets. What is its cost per useful token?',
      options: [
        '$1.00 per million tokens, the bill divided by all 2 billion tokens the fleet produced',
        '$0.75 per million tokens, the bill scaled down to the 75 percent share that met the targets',
        '$4.00 per million tokens, the bill divided by the 0.5 billion tokens that missed the targets',
        '$1.33 per million tokens, the bill divided by the 1.5 billion delivered within their targets',
      ],
      correct: [3],
      why: [
        'That divides by tokens produced, the old wording. It counts the 0.5 billion tokens from requests that missed their targets, so it understates cost per useful token.',
        'The bill does not shrink with the miss rate. The GPUs were billed for the full day, so the whole $2,000 is spread over the useful tokens only.',
        'Late tokens are the waste, not the divisor. Dividing by them measures the misses and ignores the 1.5 billion tokens delivered on time.',
        'Right: cost per useful token divides the bill by tokens delivered within the SLO, goodput × time. $2,000 / 1.5 billion is about $1.33 per million; the late tokens still cost GPU-hours.',
      ],
    },
  ],
} satisfies Erratum
