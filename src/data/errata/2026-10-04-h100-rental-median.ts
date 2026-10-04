import type { Erratum } from './schema'

export default {
  id: '2026-10-04-h100-rental-median',
  date: '2026-10-04',
  kind: 'changed',
  lessons: ['t7.l4'],
  title: 'H100 rents for a median $3.49 per GPU-hour, not "$2–3"',
  before: 'The cost stack said "a H100-class GPU is $2–3/hr rented", with no date and no source.',
  after:
    'An H100 rents on demand at a median $3.49 per GPU-hour across 41 providers on 2026-10-04 (cheapest verified in stock: $1.30). The lesson now states it dated and linked to its source.',
  why: 'An undated range reads as a fact, and rental prices move: the H100 median sits about 12% above a year ago. The dated figure matches the claims registry (price.h100.median), so it can be re-checked.',
  source: { url: 'https://getdeploying.com/reference/cloud-gpu/nvidia-h100', title: 'GetDeploying: NVIDIA H100 cloud GPU pricing' },
} satisfies Erratum
