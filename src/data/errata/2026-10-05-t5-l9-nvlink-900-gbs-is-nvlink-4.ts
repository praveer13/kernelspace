import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l9-nvlink-900-gbs-is-nvlink-4',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l9'],
  title: '900 GB/s is H100/H200 NVLink inside an 8-GPU node; NVL72 runs NVLink 5 at 1.8 TB/s per GPU',
  before:
    'T5.L9 put tensor parallelism on NVLink "(900 GB/s GPU-to-GPU on NVL72-class fabric)", and its bandwidth chip tagged 900 GB/s "NVL72-class".',
  after:
    'Fourth-generation NVLink in an H100 or H200 node gives 900 GB/s per GPU, with up to 8 GPUs per node. GB200 NVL72 uses fifth-generation NVLink at 1.8 TB/s per GPU across 72 GPUs, twice as fast.',
  why: 'Putting the Hopper figure under the NVL72 name hides two changes: per-GPU bandwidth doubles, and the NVLink domain grows from 8 GPUs to 72. Both matter when sizing tensor-parallel groups.',
  source: {
    url: 'https://www.nvidia.com/en-us/data-center/nvlink/',
    title: 'NVIDIA NVLink: fourth generation (Hopper) 900 GB/s per GPU, fifth generation (Blackwell) 1,800 GB/s per GPU, domains of 8 or 72 GPUs (checked 2026-10)',
  },
  items: [
    {
      q: 'NVIDIA quotes 900 GB/s of NVLink bandwidth per GPU. Which generation and system is that figure for?',
      options: [
        'Fifth-generation NVLink, as in a 72-GPU GB200 NVL72 rack',
        'Fourth-generation NVLink, as in a 72-GPU GB200 NVL72 rack',
        'Fourth-generation NVLink, as in an 8-GPU H100 node',
        'Fifth-generation NVLink, as in an 8-GPU H100 node',
      ],
      correct: [2],
      why: [
        'That platform exists, but its figure is 1.8 TB/s per GPU, double the 900 GB/s asked about. Fifth-generation NVLink pairs with Blackwell systems such as NVL72.',
        'This is the old mistake. NVL72 racks use fifth-generation NVLink at 1.8 TB/s per GPU, so 900 GB/s is not an NVL72 figure.',
        'Right: NVIDIA lists 900 GB/s per GPU for fourth-generation NVLink, on Hopper GPUs such as H100 and H200 in nodes of up to 8 GPUs. NVL72 uses fifth-generation NVLink at 1.8 TB/s per GPU across 72 GPUs.',
        'H100 is a Hopper GPU, which has fourth-generation NVLink. Fifth generation arrived with Blackwell, in systems such as GB200 NVL72.',
      ],
    },
  ],
} satisfies Erratum
