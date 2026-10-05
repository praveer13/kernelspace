import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t6-l4-only-tp-needs-nvlink',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t6.l4', 't6.l5'],
  title: 'Only TP needs the NVLink tier: wide EP and multi-node CP already ran over RDMA, and NVL72 makes them cheaper',
  before:
    'T6.L4 said TP, EP and CP "are only profitable inside an NVLink domain", and T6.L5 called NVL72 "the reason EP144 and CP-over-32-nodes are routine".',
  after:
    'Only TP\'s per-layer all-reduces need the NVLink tier. EP\'s all-to-all and CP\'s ring pass also run every layer, but overlapped with compute they already work over RDMA. NVL72 makes them cheaper, not possible.',
  why: 'DeepSeek\'s wide-EP decode spans 18 to 40 H800 nodes over InfiniBand with overlapped communication, and Meta\'s CP scaled across 16 H100 nodes over RDMA and TCP. Both ran on 8-GPU Hopper nodes, so NVL72 cannot be why they became possible.',
  source: {
    url: 'https://arxiv.org/abs/2412.19437',
    title: 'DeepSeek-V3 Technical Report, section 3.4 (decode EP320 across 40 H800 nodes with all-to-all over InfiniBand; micro-batches overlap dispatch and combine with compute); for CP see arXiv 2411.01783',
  },
  items: [
    {
      q: 'Which parallelism axis has per-layer traffic that must stay on the NVLink tier instead of crossing RDMA?',
      options: [
        'Tensor parallelism, whose reduction stalls the next matmul in every model layer',
        'Expert parallelism, whose dispatch and combine never fit on the network fabric at scale',
        'Context parallelism, whose ring passes need a bandwidth that only NVLink provides',
        'Pipeline parallelism, whose stage boundaries pass the activations in every single layer',
      ],
      correct: [0],
      why: [
        'Right: TP\'s reduction must finish before the next matmul can start, in every layer, so it needs the ~TB/s tier. EP and CP traffic can overlap with compute and already runs over RDMA.',
        'EP\'s all-to-all also runs every layer, but DeepSeek ran EP144 decode over 18 nodes with the communication hidden behind compute. It fits on RDMA.',
        'Meta scaled CP across 16 H100 nodes, and RDMA and TCP showed similar scalability, since at long context each ring pass overlaps attention compute. CP does not need NVLink.',
        'PP sends activations once per stage boundary and micro-batch, not in every layer. It tolerates the RDMA tier, which is where the lesson places it.',
      ],
    },
    {
      q: 'DeepSeek already ran EP144 decode across 18 H800 nodes. What does GB200 NVL72, a 72-GPU NVLink domain, change for wide expert parallelism?',
      options: [
        'It makes wide EP possible, ending a limit that kept the all-to-all inside one 8-GPU node',
        'It shrinks every dispatch and combine message by 2x, compressing activations as they cross NVLink',
        'It keeps groups of up to 72 devices on NVLink, making the all-to-all cheaper than RDMA',
        'It confines EP to a single rack of 72 GPUs, requiring a layer\'s experts to share one NVLink domain',
      ],
      correct: [2],
      why: [
        'DeepSeek ran EP144 decode over 18 H800 nodes of 8 GPUs each. The all-to-all already crossed nodes over RDMA with overlap, so NVL72 is not what made wide EP possible.',
        'NVLink compresses nothing. The messages carry the same token activations, and only the fabric they cross is faster.',
        'Right: NVL72 keeps groups of up to 72 GPUs on NVLink at ~1.8 TB/s per GPU, so the same dispatch and combine move over a faster tier than RDMA. It makes wide EP cheaper, not possible.',
        'EP is not confined to a domain. DeepSeek\'s EP144 unit spans 18 nodes, and a layer\'s experts can sit on RDMA-connected nodes.',
      ],
    },
  ],
} satisfies Erratum
