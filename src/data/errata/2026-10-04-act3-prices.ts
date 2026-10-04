import type { Erratum } from './schema'

export default {
  id: '2026-10-04-act3-prices',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t7.l4'],
  title: 'Fleet Week Act III prices are now dated, and invented constants are labelled synthetic',
  before: 'Act III showed undated $25, $60 and $900 per hour for three hardware options and priced B200 at about $15.43/Mtok.',
  after:
    'B200 is four GPUs at the dated 2026-10 median rental price ($6.25/GPU-hr, $25/hr), giving about $6.43/Mtok in the sim; the $25 (H100) and $900 (NVL72) figures are labelled synthetic.',
  why: 'A number with no date or source reads as market data. The $/Mtok is simulator output under v1 flat-tick physics, not a real-world price.',
  source: { url: 'https://getdeploying.com/reference/cloud-gpu/nvidia-b200', title: 'GetDeploying: NVIDIA B200 cloud GPU pricing' },
} satisfies Erratum
