import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l1-goodput-not-cost-normalised',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l1'],
  title: 'Goodput is SLO-compliant throughput; "per unit of cost" is a separate step',
  before:
    'T7.L1 defined goodput as "requests that meet their latency contract, per unit of cost", while T5.L3 defined it as throughput within the latency targets.',
  after:
    'Goodput is throughput counted only for requests that meet their first-token and per-token latency targets, in T5.L3 and T7.L1 alike. Divide it by cost, such as per GPU-hour, to compare fleets.',
  why: 'DistServe defines goodput as the rate served within both the TTFT and TPOT constraints, reported per GPU. Folding cost into the definition made T5 and T7 disagree and blurred goodput with cost per token.',
  source: {
    url: 'https://arxiv.org/abs/2401.09670',
    title: 'DistServe: disaggregating prefill and decoding (goodput under TTFT and TPOT constraints)',
  },
  items: [
    {
      q: 'A fleet serves 1,000 requests per second and 700 of them meet the first-token and per-token latency targets. What is its goodput?',
      options: [
        '700 requests per second, the throughput that meets the targets',
        '1,000 requests per second, the total throughput at saturation',
        '700 requests per second per dollar, since goodput is divided by cost',
        '70 percent, the share of requests that succeed with a status code',
      ],
      correct: [0],
      why: [
        'Right: goodput counts only the throughput delivered within the latency targets. Dividing 700 by the fleet cost gives goodput per dollar, a derived figure.',
        'That is raw throughput. It counts the 300 requests that missed their latency targets, so it overstates what the fleet can promise.',
        'Cost is a separate normalisation, not part of the definition. Per dollar or per GPU-hour is how fleets are compared, after goodput itself is measured.',
        'A success status says nothing about timing, and a share is not a rate. Goodput is a count of requests per second that stayed inside the targets.',
      ],
    },
  ],
} satisfies Erratum
