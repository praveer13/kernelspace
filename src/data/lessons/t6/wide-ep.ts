import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l2',
  slug: 'wide-ep',
  trackId: 't6',
  index: 2,
  title: 'Wide Expert Parallelism in Production',
  minutes: 30,
  hook: 'EP144 means your batch is spread across 144 GPUs and every layer is a distributed transaction. DeepEP, EPLB, and dual-batch overlap are the machinery that keeps it profitable — and SGLang reproduced the whole thing on 96 H100s for you to read.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T6.L1 gave you the problem: hot experts straggle the combine barrier, and MoE wants huge batches. **Wide EP** is the production answer: spread the experts across *many* GPUs (EP32 for prefill, EP144 for decode in DeepSeek's build), run enormous batches so expert utilization is uniform, and hide the all-to-all behind compute. This lesson is the three mechanisms that make it work — and the one public reproduction you can study line by line.

Why EP32 for prefill but EP144 for decode? The phases have opposite physics again (T5.L3): prefill is compute-bound — moderate EP, big per-GPU chunks, dense tensor-core work. Decode is bandwidth-bound and latency-critical — spread experts maximally (EP144), because each GPU then holds *fewer* experts and reads *less* weight per step... and because only a giant batch keeps 256 experts uniformly fed.`,
    },
    {
      type: 'prose',
      md: `## Mechanism 1: DeepEP — the dispatch/combine library

The all-to-all is so central that DeepSeek open-sourced a dedicated library for it. Two modes, because the two phases want different things:

- **Normal dispatch** (prefill/training): maximize bandwidth. Aggregate tokens by destination, saturate NVLink/RDMA with big transfers, tolerate microseconds of latency.
- **Low-latency dispatch** (decode): minimize latency at smaller transfer sizes. RDMA write-with-immediate delivery, pre-registered buffers, no negotiation on the hot path — decode cannot wait for a handshake per layer.

This is a recurring systems lesson: *one fabric, two protocols*. Your TCP vs QUIC instinct, your batch-vs-streaming instinct — same shape. The transport is shared; the protocol is phase-specific.`,
    },
    {
      type: 'prose',
      md: `## Mechanism 2: EPLB — load balance as a packing problem

The **Expert Parallel Load Balancer** treats hot experts as a bin-packing problem. Count per-expert load over a window; **replicate** the hottest experts onto a second GPU (replication, not migration — the weights are small compared to the KV); **reassign** expert→GPU placement periodically to even out. Result: no GPU is more than a few percent off the mean load, so the combine barrier costs ~the mean, not the max.

Notice what EPLB really is: **consistent hashing with live rebalancing** — your cache-tier instinct again (T3.L6, T5.L9). The differences are instructive: the "keys" are expert ids, the "nodes" are GPUs, and the rebalancing signal is token counts rather than cache misses.`,
    },
    {
      type: 'prose',
      md: `## Mechanism 3: dual-batch overlap — hide the network under compute

Even with DeepEP, the all-to-all costs real microseconds. The fix is the oldest trick in the latency book (T2.L6): never wait. **Dual-batch overlap** splits the batch into two micro-batches and pipelines them: while micro-batch A does attention/FFN compute, micro-batch B does its dispatch/combine transfer. GPU SMs and the network are both busy, always. Latency of the all-to-all disappears *from the critical path* — not removed, hidden.

The same pattern appears as DualPipe in training and as "PDL" (programmatic dependent launch) in NVIDIA's decode optimizations. When you see compute and communication alternating, overlap them. When you see a barrier, ask what could have been running during it.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '96×H100', label: 'SGLang reproduction fleet', hint: 'Open-source reproduction of DeepSeek\'s wide-EP serving (May 2025).' },
        { value: '52.3k / 22.3k', label: 'input / output tok/s per node', hint: 'SGLang on 96×H100, 2k-token prompts — ~5× output throughput vs TP16 baseline.' },
        { value: '$0.20', label: 'per M output tokens (est.)', hint: 'The wide-EP economics, computed end-to-end in the reproduction.' },
        { value: '2.2k tok/s', label: 'vLLM wide-EP per H200', hint: 'Production-like multi-node DeepSeek serving with vLLM (Dec 2025).' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Wide EP is **your sharded cache fleet with a fan-out router**, and the three mechanisms map one-to-one: DeepEP ≈ the RPC layer with separate bulk and latency paths (gRPC streaming vs unary), EPLB ≈ consistent hashing + hot-key replication (your memcached tier's hot-key problem, with GPUs), dual-batch overlap ≈ every event-loop lesson from T2.L6 — never block, interleave. The genuinely new thing is only the payload: tokens instead of requests, experts instead of shards.`,
    },
    {
      type: 'field-note',
      title: 'DeepSeek Open Infra Index',
      source: 'DeepSeek AI',
      href: 'https://github.com/deepseek-ai/open-infra-index',
      published: 'Open Source Week 2025',
      verified: '2026-08',
      md: `Treat this index as the exploded parts diagram for the lesson: DeepEP owns high-throughput and low-latency all-to-all paths, EPLB turns measured expert demand into replication and placement, DeepGEMM supplies the expert kernels, and the inference overview shows how overlap ties them together. Pick one request token and follow it across repositories; the useful reading skill is locating the contract between components, not memorizing a benchmark headline.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Decode runs at EP144 while prefill runs at EP32 primarily because…',
          options: [
            'Decode does more FLOPs per token than prefill, so it needs many more GPUs to finish each step inside the latency budget and stay under its SLO',
            'Decode is bandwidth-bound and wants giant uniform batches with little weight per GPU; prefill is compute-bound and wants big dense chunks',
            'Prefill cannot use the all-to-all path efficiently, so it is confined to a narrower group of GPUs on one NVLink domain',
            'EP144 matches the number of experts per layer, so the width is fixed by the model and prefill simply uses fewer of them',
          ],
          correct: [1],
          explanation:
            'The T5.L3 phase split applied to experts: decode profits from maximal expert spread (less weight per GPU per step, giant uniform batches) while prefill profits from dense compute chunks. Same model, two optimal topologies — a preview of T6.L4.',
          why: [
            'FLOPs per token are the same in both phases. Decode is memory-bound, with low arithmetic intensity; the wide spread cuts weight bytes read per GPU per step.',
            'Right: decode is bandwidth-bound and profits from spreading experts widely, with giant batches keeping them uniformly fed. Prefill is compute-bound and wants big dense chunks per GPU.',
            'Prefill uses the same dispatch and combine; DeepEP has a bandwidth-oriented mode for it. EP32 already spans several nodes, so it is not confined to one NVLink domain.',
            'DeepSeek-V3 has 256 routed experts plus one shared, not 144. EP width is a deployment choice made per phase, not a number fixed by the model.',
          ],
        },
        {
          q: 'EPLB keeps the combine barrier cheap by…',
          options: [
            'Capping each expert\'s capacity and dropping tokens beyond the cap, so no GPU ever sees more than the average load',
            'Replicating hot experts onto second GPUs and reassigning placement so every GPU carries about the mean load',
            'Shrinking the batch each step so fewer tokens reach any single expert, which flattens load at some cost in utilization',
            'Detecting slow GPUs at runtime and rerouting their tokens to the next-best experts so the barrier waits only for healthy devices',
          ],
          correct: [1],
          explanation:
            'The barrier costs the MAX load unless balanced. EPLB measures per-expert load and uses replication + reassignment to flatten it — consistent hashing with live rebalancing, for experts.',
          why: [
            'Token dropping is a capacity-factor trick that harms quality. EPLB leaves routing untouched and changes where experts live and how many copies exist.',
            'Right: EPLB measures per-expert load, replicates the hottest experts and reassigns placement, so the barrier costs about the mean load instead of the max.',
            'Smaller batches make expert load noisier, not flatter, because uniformity comes from large-batch statistics. EPLB balances through placement and replication instead.',
            'Barrier delay comes from load skew, not faulty hardware, and rerouting tokens changes which expert answers them, which hurts quality. EPLB balances load without changing routing.',
          ],
        },
        {
          q: 'Dual-batch overlap exists to…',
          options: [
            'Run two copies of the model on one GPU so a new version can be tested against the old without a restart',
            'Pipeline two micro-batches so one computes while the other runs its all-to-all, hiding network behind compute',
            'Double the batch per step so expert load flattens statistically, at the cost of extra latency for each token generated',
            'Replicate every expert on two GPUs so a token can use whichever copy is idle and skip the all-to-all wait entirely',
          ],
          correct: [1],
          explanation:
            'Compute and communication alternate every layer; overlapping two micro-batches keeps both resources busy. It is T2.L6\'s never-block principle applied to a distributed forward pass.',
          why: [
            'Model co-location is a different concern. Dual-batch overlap splits one batch into two micro-batches of the same model; both halves run the same weights.',
            'Right: while micro-batch A computes attention and FFN, micro-batch B runs its dispatch or combine, so SMs and network stay busy and the transfer leaves the critical path.',
            'That is large-batch load balancing (T6.L1). Dual-batch overlap keeps the same total tokens and splits them in two to overlap phases, not to enlarge the batch.',
            'Replication is EPLB\'s tool, and replicated experts still need dispatch and combine. Dual-batch overlap leaves placement alone and overlaps communication with compute.',
          ],
        },
        {
          q: 'DeepEP ships two dispatch protocols because…',
          options: [
            'One fabric, two workloads: prefill wants bandwidth through large transfers; decode wants low latency through pre-registered buffers and no per-layer handshake',
            'One mode moves tokens inside a node over NVLink and the other moves them between nodes over RDMA, since the two fabrics need different protocols',
            'The low-latency mode replaced a buggy original, and the older mode stays only for compatibility with earlier deployments',
            'Training and inference use different expert layouts, so each needs a dispatch routine matched to its model\'s weight format',
          ],
          correct: [0],
          explanation:
            'Phase-specific protocols on a shared fabric — the same reason you use different RPC shapes for bulk vs interactive traffic. Latency-critical decode cannot afford per-layer negotiation.',
          why: [
            'Right: the same fabric serves two workloads. Prefill saturates links with big batched transfers; decode uses pre-registered buffers and no handshake so each layer\'s latency stays small.',
            'The split is by phase, not by fabric tier. The modes differ in whether they optimize prefill bandwidth or decode latency, and one deployment uses both over the same cluster.',
            'Both modes are first-class paths. The split reflects physics: large transfers amortize overheads, while decode needs registered buffers and no handshake on every layer.',
            'The split is by phase, not by train versus serve. The same model dispatches differently in prefill and decode because the bandwidth and latency tradeoff differs.',
          ],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Read the reproduction',
      md: `The two documents worth a weekend each: **DeepSeek's open-infra week** (github.com/deepseek-ai/open-infra-index) — the production numbers including the 545% margin day and the 56.3% KV-cache hit rate; and **SGLang's "large-scale EP" writeup** (lmsys.org, May 2025) — 96×H100, P/D disaggregation + wide EP with DeepEP/DeepGEMM/EPLB, 52.3k input / 22.3k output tok/s/node, ~$0.20/M output tokens. A vLLM-team follow-up (Dec 2025) reached 2.2k output tok/s per H200 in production-like multi-node configs. These are the reference points for every T6/T7 calculation.`,
    },
  ],
}

export default lesson
