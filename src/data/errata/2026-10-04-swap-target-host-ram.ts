import type { Erratum } from './schema'

export default {
  id: '2026-10-04-swap-target-host-ram',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t2.l7'],
  title: 'PagedAttention swaps to host RAM over PCIe; PCIe is not the disk',
  before:
    'Swapping copies the victim\'s blocks to CPU RAM, "the OS\'s swap-to-disk, with PCIe as the disk".',
  after:
    'Swapping copies the victim\'s blocks to CPU RAM, "the OS\'s swap-to-disk, with host RAM, over PCIe, as the disk". PCIe is the link; host DRAM is the swap target.',
  why: 'PCIe is the interconnect, not storage. Swapped KV blocks live in host DRAM and cross PCIe in both directions, which is why swap costs bandwidth where recomputation costs compute.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023)',
  },
} satisfies Erratum
