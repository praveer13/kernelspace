import type { Erratum } from './schema'

export default {
  id: '2026-10-04-act3-price-refresh',
  date: '2026-10-04',
  kind: 'changed',
  lessons: ['t7.l4'],
  title: 'GPU rental medians re-read from the pages: B200 $7.01, H100 $3.49 per GPU-hour',
  before: 'The B200 median was $6.25/GPU-hr and H100 $3.39, so a 4x B200 node cost $25/hr and Act III gave about $6.43/Mtok.',
  after:
    'The pages read $7.01 (B200, 20 providers) and $3.49 (H100, 41 providers) on 2026-10-04, each now quoted. A 4x B200 node is $28.04/hr and the Act III sim gives about $7.21/Mtok.',
  why: 'The earlier values came from a dossier log that the live pages no longer matched. The $/Mtok is simulator output that follows the price, not a real-world price.',
  supersedes: '2026-10-04-act3-prices',
  source: { url: 'https://getdeploying.com/reference/cloud-gpu/nvidia-b200', title: 'GetDeploying: NVIDIA B200 cloud GPU pricing' },
} satisfies Erratum
