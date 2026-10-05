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
  items: [
    {
      q: 'In the PagedAttention paper, a swapped-out sequence has its KV blocks copied where, and what is PCIe in that picture?',
      options: [
        'To disk, with PCIe as the storage device itself',
        'To another GPU, with PCIe as the memory the blocks occupy',
        'To host DRAM, with PCIe as the memory the blocks occupy',
        'To host DRAM, with PCIe as the link the blocks cross',
      ],
      correct: [3],
      why: [
        'PCIe is an interconnect, not storage. The swap target in the paper is host memory.',
        'The swap target is host memory, and PCIe holds no data: it only carries it.',
        'The location is right but PCIe is not memory. It is the link between GPU and host.',
        'Right. The blocks live in host DRAM and cross PCIe in both directions, so swap costs bandwidth where recomputation costs compute.',
      ],
    },
  ],
} satisfies Erratum
