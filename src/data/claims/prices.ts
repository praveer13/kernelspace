import type { Claim } from './schema'

const H100_PRICES = { url: 'https://getdeploying.com/reference/cloud-gpu/nvidia-h100', title: 'GetDeploying: NVIDIA H100 cloud GPU pricing' }
const B200_PRICES = { url: 'https://getdeploying.com/reference/cloud-gpu/nvidia-b200', title: 'GetDeploying: NVIDIA B200 cloud GPU pricing' }

/**
 * Rental prices (2026-10) and the three constants the course made up. Every GetDeploying
 * figure was re-read from the live page on 2026-10-04 (WebFetch extraction, so re-check wording
 * before treating a quote as exact). The medians move daily: the dossier's earlier readings
 * ($3.39 H100, $6.25 B200) are history, not a discrepancy, so they are not kept as notes.
 */
export const PRICE_CLAIMS: Claim[] = [
  {
    id: 'price.h100.median',
    kind: 'price',
    value: 3.49,
    unit: 'USD/GPU-hr',
    label: 'H100 on-demand median rental price',
    source: {
      ...H100_PRICES,
      quote: 'the median on-demand price is $3.49 per GPU per hour across 41 providers with a priced on-demand config',
    },
    verifiedAt: '2026-10-04',
    ttlDays: 90,
    boundary: 'Median of priced on-demand configs across 41 providers; flat over 90 days at the time of check. It moves daily.',
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
    boundary: 'Tracked configs, not providers with a priced on-demand config (the median covers 41).',
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
    value: 7.01,
    unit: 'USD/GPU-hr',
    label: 'B200 on-demand median rental price',
    source: {
      ...B200_PRICES,
      quote: 'the median on-demand price is $7.01 per GPU per hour across 20 providers with a priced on-demand config',
    },
    verifiedAt: '2026-10-04',
    ttlDays: 90,
    boundary: 'Median of priced on-demand configs across 20 providers; flat over 90 days at the time of check. It moves daily.',
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
    value: 28.04,
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
      'No source: a round number chosen for the exercise. Eight GPUs at the dated H100 median would be 8 x $3.49 = $27.92/hr.',
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
