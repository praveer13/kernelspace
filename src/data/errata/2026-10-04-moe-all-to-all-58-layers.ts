import type { Erratum } from './schema'

export default {
  id: '2026-10-04-moe-all-to-all-58-layers',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t6.l1'],
  title: 'DeepSeek-V3 does 2 × 58 all-to-alls per forward pass, not 2 × 61',
  before: 'DeepSeek-V3 runs a dispatch and a combine all-to-all in every one of its 61 layers: "2 × 61".',
  after: 'DeepSeek-V3 has 61 layers, but the first 3 are dense FFNs with no router. Only the 58 MoE layers all-to-all: 2 × 58 = 116 per forward pass.',
  why: 'Dense layers have no experts to route to, so they pay no dispatch or combine. The count sets the network latency floor, so the 61 overstated it by about 5%.',
  source: { url: 'https://arxiv.org/abs/2412.19437', title: 'DeepSeek-V3 Technical Report (61 layers, first 3 dense)' },
} satisfies Erratum
