import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l4',
  slug: 'parallelism-zoo',
  trackId: 't6',
  index: 4,
  title: 'The Parallelism Zoo, Composed: TP×PP×DP×EP×CP',
  minutes: 35,
  hook: 'Five parallelism axes, and every production deployment is a point in that five-dimensional space. The decision matrix is priced by one thing: interconnect bandwidth per hop. Plus context parallelism — the axis that 1M-token prompts made mandatory.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T5.L9 gave you three axes (TP, PP, DP) and T6.L1–L2 added the fourth (EP). The complete 2026 zoo has five, and real deployments compose all of them: DeepSeek decode is EP144 × DP144, Meta's long-context work is CP over 16–32 nodes, and every one of those GPUs is also inside a TP group. The compose-or-die rule: **each axis exists to trade communication cost against a different scarcity** — memory capacity, memory bandwidth, compute utilization, or network latency. Choose by which scarcity is binding, priced by the interconnect that axis forces onto the hot path.`,
    },
    {
      type: 'prose',
      md: `## The five axes, one line each

- **TP (tensor)** — split each matmul across GPUs. Cost: all-reduce *every layer*. Needs the fattest pipe: NVLink domain only (NVL72 rack, ~1.8 TB/s bidirectional). Never over RDMA.
- **PP (pipeline)** — split layers into stages. Cost: boundary activations per micro-batch + pipeline bubbles. Tolerates slow links; pays with latency and bubble overhead.
- **DP (data)** — replicate the model, split the batch. Cost: nothing per token (independent replicas). The default axis whenever capacity allows.
- **EP (expert)** — split experts across GPUs. Cost: dispatch/combine all-to-all twice per layer (T6.L1). Runs over RDMA between nodes when DeepEP-class software overlaps it with compute (T6.L2); NVLink makes it cheaper.
- **CP (context)** — split the SEQUENCE across GPUs for one request. Cost: ring-attention passes of K/V chunks around the group, each layer. The axis that makes 1M-token prompts feasible without 1M-token KV on one GPU.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — the interconnect ladder prices the axes (bandwidth per hop, 2026)',
      height: 52,
      nodes: [
        { id: 'nvlink', x: 2, y: 6, w: 44, h: 9, label: 'NVLink 5 / NVL72 rack', sub: '~1.8 TB/s bidirectional — TP needs it', color: '#3EF2A4' },
        { id: 'pcie', x: 2, y: 20, w: 44, h: 9, label: 'PCIe gen5 x16', sub: '~64 GB/s — CPU attach, offload tier', color: '#FBBF24' },
        { id: 'rdma', x: 2, y: 34, w: 44, h: 9, label: 'RDMA (RoCE / InfiniBand)', sub: '25–100 GB/s — PP, DP, KV, cross-rack', color: '#5CA8FF' },
        { id: 'tp', x: 54, y: 6, w: 20, h: 9, label: 'TP', sub: 'all-reduce', color: '#3EF2A4' },
        { id: 'epcp', x: 54, y: 20, w: 20, h: 9, label: 'EP / CP', sub: 'all-to-all/ring', color: '#A78BFA' },
        { id: 'kv', x: 54, y: 34, w: 20, h: 9, label: 'PP / DP / KV xfer', sub: 'acts, replicas, blocks', color: '#5CA8FF' },
      ],
      edges: [
        { from: 'nvlink', to: 'tp' },
        { from: 'nvlink', to: 'epcp', label: 'cheaper' },
        { from: 'rdma', to: 'epcp', label: 'overlapped' },
        { from: 'rdma', to: 'kv' },
      ],
      steps: [
        { caption: 'TP does an all-reduce in every layer, on the critical path — it is only profitable inside an NVLink domain.', active: ['nvlink', 'tp'], edges: ['nvlink->tp'] },
        { caption: 'EP\'s all-to-all and CP\'s ring pass also run every layer, but they overlap with compute and already work over RDMA (DeepEP, ring attention). NVLink makes them cheaper; it did not make them possible.', active: ['nvlink', 'rdma', 'epcp'], edges: ['nvlink->epcp', 'rdma->epcp'] },
        { caption: 'PP and DP pay per micro-batch or not at all — they tolerate the RDMA tier. KV transfer (disaggregation) also lives here: it is scheduled, overlapped, and amortized.', active: ['rdma', 'kv'], edges: ['rdma->kv'] },
        { caption: 'Rule of thumb: if an axis\'s traffic sits exposed on the per-layer critical path (TP), it needs NVLink; if it can be overlapped with compute (EP, CP) or rides the per-request path, RDMA is fine and NVLink only makes it cheaper.', active: ['nvlink', 'rdma', 'tp', 'epcp', 'kv'], edges: ['nvlink->tp', 'nvlink->epcp', 'rdma->epcp', 'rdma->kv'] },
      ],
    },
    {
      type: 'prose',
      md: `## CP and the 1M-token prompt

Context parallelism is the newest axis and the least intuitive. A 1M-token prompt's KV (Llama-class: ~320 GB; MLA-class: ~70 GB) and its prefill FLOPs exceed one GPU — but attention is embarrassingly shardable by *chunk*: each GPU holds a slice of the sequence's KV and computes partial attention over the full Q; **ring attention** passes K/V chunks around the group so every query eventually sees every key, with softmax accumulators merged at the end. Meta's published numbers (Oct 2025): 1M-token prefill in <1 minute on a single H100 host via CP, 10M tokens across 32 hosts; Llama-3-405B 128K prefill in 3.8 s over 16 nodes. Long context stopped being a memory problem and became a ring-latency problem, so each K/V pass is overlapped with attention compute. Unlike TP, CP does not need the NVLink tier: [Meta's paper](https://arxiv.org/abs/2411.01783) scaled it near-linearly across 16 H100 nodes, with RDMA and TCP interconnects showing similar scalability. NVLink only makes the ring cheaper.`,
    },
    {
      type: 'prose',
      md: `## The composition discipline

Production configs read like (DP × EP × CP × TP per phase), and the design process is mechanical:

1. **Fit the model** — weights (+ per-GPU expert share for MoE) must fit: pick minimum TP/EP width for capacity. DeepSeek decode: 37B active params spread trivially; the constraint was experts-per-GPU.
2. **Price the hot path** — per-layer traffic (TP all-reduce, EP all-to-all, CP ring) must fit the latency budget. TP's all-reduce must stay inside the NVLink domain; EP's and CP's can cross RDMA when overlapped with compute. If it doesn't fit, drop the axis or move phases apart (EPD, T6.L3).
3. **Fill with DP** — whatever capacity remains replicates the unit; DP is free.
4. **Route long context to CP groups** — CP is per-request, so route by prompt length: short requests to dense/DP workers, long ones to CP-capable groups. Your length-based routing instinct from sharding by tenant size — same move.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `The zoo is your **database topology decision tree** wearing different names. TP ≈ partitioning a single index (needs the fat local bus), PP ≈ staging an ETL pipeline (tolerates slow links, pays in bubbles/latency), DP ≈ read replicas (free until you run out of memory), EP ≈ sharding by key range with a router (hot-key problems included), CP ≈ partitioning one giant tenant's data across the cluster because no single node holds it. The scarcity you are out of picks the axis; the interconnect prices it.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'TP belongs inside an NVLink domain because…',
          options: [
            'NVLink is the only fabric that supports collective reductions, with network cards implementing only point-to-point sends',
            'Its reduction sits on the per-layer critical path, leaving slower inter-node links to starve the compute',
            'It shards the cache by sequence, forcing each attention step to fetch key and value chunks from its peers',
            'It replicates the weights on each device, needing the fastest links available to keep the replicas in sync',
          ],
          correct: [1],
          explanation:
            'TP\'s all-reduce fires in every layer, so across dozens of layers communication dominates on slow links and TP needs the ~TB/s tier. EP\'s all-to-all and CP\'s ring pass also run per layer, but they overlap with compute and already work over RDMA. PP/DP pay per micro-batch or never, so they tolerate RDMA too.',
          why: [
            'Collectives run over InfiniBand and RoCE too, through libraries such as NCCL. The problem with TP over RDMA is bandwidth and latency per layer, not missing support.',
            'Right: TP does an all-reduce in every layer, on the critical path. Over RDMA\'s lower bandwidth the many small collectives starve the compute, so TP stays inside an NVLink domain.',
            'That describes context parallelism. TP shards each matmul and its heads, and its traffic is activation all-reduce; the issue is how often it fires, not ring attention.',
            'TP shards the weights, it does not replicate them. Replicas are DP, and inference replicas need no per-token synchronization.',
          ],
        },
        {
          q: 'Context parallelism exists because…',
          options: [
            'Models outgrew one device\'s weight memory, making a chain of layer stages the sole way to hold them',
            'A single million-token request exceeds one device in cache and prefill compute, forcing its sequence to be sharded',
            'It replaces expert parallelism for sparse models by sharding tokens across experts, avoiding the dispatch and combine',
            'Ring attention approximates full attention with a sparse pattern, costing less than dense attention on long prompts',
          ],
          correct: [1],
          explanation:
            'CP shards the sequence dimension of one request across GPUs with ring attention. Long context became a ring-latency problem, not a capacity problem.',
          why: [
            'That motivates PP, TP and EP, which split weights. CP targets one long request\'s KV and prefill FLOPs and splits the sequence rather than the weights.',
            'Right: CP shards one request\'s sequence across GPUs. Ring attention passes K/V chunks so every query sees every key, and softmax accumulators are merged at the end.',
            'CP splits the sequence for attention; EP splits experts for the FFN. MoE models can use both, and EP still needs its all-to-all.',
            'Ring attention is exact, not sparse: every query attends to every key, with online-softmax accumulators merged. It divides the work across GPUs rather than approximating attention.',
          ],
        },
        {
          q: 'EP144 × DP144 (DeepSeek decode) means…',
          options: [
            'Experts are spread out across 144 devices, with a giant batch data-parallel over those same devices',
            'Two separate fleets of 144 devices exist, with one holding expert shards and a second holding model replicas',
            'A 144-stage pipeline is formed, with each device owning one layer group and a data-parallel copy behind it',
            'Each of 144 devices holds a complete copy of the experts, serving any token locally with no dispatch step',
          ],
          correct: [0],
          explanation:
            'EP and DP compose on the SAME devices: the fleet holds the 256 experts spread EP-wide and processes a DP-sized batch. Composition is per-phase: prefill chose EP32×DP32 for dense compute chunks.',
          why: [
            'Right: the axes multiply onto the same devices. The 144 GPUs hold the experts spread EP-wide and also process the data-parallel batch.',
            'The axes do not imply separate fleets. The same 144 GPUs both hold the experts and process the data-parallel batch; nothing needs a second 144.',
            'A 61-layer model cannot form a 144-stage pipeline, and EP and DP name expert and batch axes, not stages.',
            'Then there would be no expert parallelism: 671B parameters do not fit on one GPU, and the all-to-all exists because experts are split across devices.',
          ],
        },
        {
          q: 'In the composition discipline, DP is filled in last because…',
          options: [
            'DP is the slowest axis, getting applied last to avoid delaying the faster axes chosen first',
            'Replicas are independent and cost nothing per token, leaving spare capacity for copies after other axes are set',
            'It needs a global batch size fixed in advance, which is known after the other axes set per-device memory limits',
            'Replicas must stay in sync on each token, getting added after the faster axes claim the whole NVLink domain',
          ],
          correct: [1],
          explanation:
            'DP replicates the whole unit with zero per-token communication. It is the filler axis: fit the model (TP/EP), price the hot path (TP inside NVLink, EP/CP on NVLink or on RDMA with overlap), then replicate what remains.',
          why: [
            'Axis order follows scarcity and cost, not speed. DP adds no per-token communication, so it is not slow; it goes last because it only multiplies what already fits.',
            'Right: replicas are independent, so DP adds no per-token communication. After capacity and hot-path axes are chosen, whatever capacity remains is replicated for free.',
            'Serving batches form dynamically per replica, so no global batch size has to be fixed in advance. The ordering follows capacity first, then hot-path cost.',
            'Inference replicas share no per-token state. Synchronization is a training concern (gradient all-reduce); DP is last because it is the free filler axis.',
          ],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'The reference card',
      md: `Three production configs to recite: **DeepSeek decode** — EP144×DP144, dual-batch overlap, FP8 dispatch (DeepSeek open-infra, Feb 2025). **Meta long context** — CP over 16–32 H100 hosts, 1M prefill <1 min, moving to N-D parallelism + P/D disaggregation (engineering.fb.com, Oct 2025). **Kimi K2** — 128×H200, P/D disaggregation + large-scale EP, 224k/288k tok/s prefill/decode (lmsys.org, Jul 2025). Each is a point in the five-axis space chosen by a different scarcity: expert balance, sequence length, and fleet-scale goodput respectively.`,
    },
  ],
}

export default lesson
