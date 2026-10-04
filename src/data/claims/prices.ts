import type { Claim } from './schema'

const H100_PRICES = { url: 'https://getdeploying.com/reference/cloud-gpu/nvidia-h100', title: 'GetDeploying: NVIDIA H100 cloud GPU pricing' }
const B200_PRICES = { url: 'https://getdeploying.com/reference/cloud-gpu/nvidia-b200', title: 'GetDeploying: NVIDIA B200 cloud GPU pricing' }

/**
 * Rental prices (2026-10) and the three constants the course made up. The two medians carry
 * the serving-landscape dossier's verified figures with no quote: the pages read differently
 * when re-opened on 2026-10-04 (see each discrepancy), so a quote would contradict the value.
 */
export const PRICE_CLAIMS: Claim[] = [
  {
    id: 'price.h100.median',
    kind: 'price',
    value: 3.39,
    unit: 'USD/GPU-hr',
    label: 'H100 on-demand median rental price',
    source: { ...H100_PRICES, row: 'Median price (current), on-demand' },
    verifiedAt: '2026-10-04',
    ttlDays: 90,
    boundary: 'Median of priced on-demand configs across providers; flat over 90 days at the time of check.',
    discrepancy:
      'Re-opened on 2026-10-04 the page reads "the median on-demand price is $3.38 per GPU per hour across 40 providers". The dossier recorded $3.39. The median moves daily.',
  },
  {
    id: 'price.h100.cheapest',
    kind: 'price',
    value: 1.3,
    unit: 'USD/GPU-hr',
    label: 'H100 cheapest verified in-stock on-demand price',
    source: {
      ...H100_PRICES,
      quote: 'The cheapest verified in-stock on-demand H100 tracked by GetDeploying is $1.30 per GPU per hour from Lium',
    },
    verifiedAt: '2026-10-04',
    ttlDays: 90,
    boundary: 'One provider, in stock at the time of check.',
  },
  {
    id: 'price.h100.providers',
    kind: 'price',
    value: 57,
    unit: 'providers',
    label: 'Providers tracked for H100',
    source: { ...H100_PRICES, quote: 'GetDeploying currently tracks H100 configs from 57 providers' },
    verifiedAt: '2026-10-04',
    ttlDays: 90,
    boundary: 'Tracked configs, not providers with a priced on-demand config (the median covers 40).',
  },
  {
    id: 'price.h100.yoy',
    kind: 'price',
    value: 12,
    unit: '% vs a year ago',
    label: 'H100 median rental price change, year over year',
    source: { ...H100_PRICES, quote: 'about 12% above where it was a year ago' },
    verifiedAt: '2026-10-04',
    ttlDays: 90,
    boundary: 'Flat over the preceding 90 days.',
  },
  {
    id: 'price.b200.median',
    kind: 'price',
    value: 6.25,
    unit: 'USD/GPU-hr',
    label: 'B200 on-demand median rental price',
    source: { ...B200_PRICES, row: 'Median price (current), on-demand' },
    verifiedAt: '2026-10-03',
    ttlDays: 90,
    boundary: 'Median of priced on-demand configs across providers.',
    discrepancy:
      'Re-opened on 2026-10-04 the page reads $6.79 per GPU-hour (median across 19 providers with a priced on-demand config, flat over 90 days), not the $6.25 in the dossier verification log. Re-verify before relying on either.',
  },
  {
    id: 'price.b200.yoy',
    kind: 'price',
    value: 17,
    unit: '% vs a year ago',
    label: 'B200 median rental price change, year over year',
    source: { ...B200_PRICES, quote: 'about 17% above where it was a year ago' },
    verifiedAt: '2026-10-04',
    ttlDays: 90,
  },
  {
    id: 'price.act3.b200-node-hourly',
    kind: 'derived',
    value: 25,
    unit: 'USD/hr',
    label: 'Act III 4x B200 node, $/hr',
    verifiedAt: '2026-10-04',
    ttlDays: 90,
    derived: { from: ['price.b200.median'], formula: '4 * b200Median' },
    boundary: 'Four GPUs at the B200 median rental price; a dated stand-in for a node quote.',
  },
  {
    id: 'synthetic.act3.h100-node-hourly',
    kind: 'synthetic',
    value: 25,
    unit: 'USD/hr',
    label: 'Act III 8x H100 node, $/hr (course stand-in)',
    verifiedAt: '2026-10-04',
    ttlDays: 365,
    boundary:
      'No source: a round number chosen for the exercise. Eight GPUs at the dated H100 median would be 8 x $3.39 = $27.12/hr.',
  },
  {
    id: 'synthetic.act3.gb200-nvl72-hourly',
    kind: 'synthetic',
    value: 900,
    unit: 'USD/hr',
    label: 'Act III GB200 NVL72 rack, $/hr (course stand-in)',
    verifiedAt: '2026-10-04',
    ttlDays: 365,
    boundary: 'No source: a round number chosen for the exercise. The evidence base has no rack rental price.',
  },
  {
    id: 'synthetic.fleet.worker-hourly',
    kind: 'synthetic',
    value: 7.5,
    unit: 'USD/worker-hr',
    label: 'Fleet dashboard cost per worker-hour (course stand-in)',
    verifiedAt: '2026-10-04',
    ttlDays: 365,
    boundary: 'No source: it only makes the Fleet cost card produce a plausible $/Mtok.',
  },
]
