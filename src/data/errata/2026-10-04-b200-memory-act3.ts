import type { Erratum } from './schema'

export default {
  id: '2026-10-04-b200-memory-act3',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t6.l5'],
  title: 'B200 ships with about 180 GB of HBM per GPU, not 192 GB (Fleet Week Act III)',
  before: 'Fleet Week Act III offered "Blackwell · 192 GB HBM3e ×4, 2.4× bandwidth".',
  after:
    'A shipped DGX/HGX B200 carries 1,440 GB across 8 GPUs, about 180 GB each; HBM bandwidth is 8 TB/s per GPU, 2.4× the H100.',
  why: 'Capacity decides which model fits and how much KV cache a batch gets. NVIDIA lists 1,440 GB for 8 GPUs; no spec row backs 192 GB.',
  source: { url: 'https://www.nvidia.com/en-us/data-center/dgx-b200/', title: 'NVIDIA DGX B200' },
} satisfies Erratum
