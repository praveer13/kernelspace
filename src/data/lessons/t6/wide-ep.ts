import type { Lesson } from '../types'
import { claimCite, claimNumber } from '../claims'

const lesson: Lesson = {
  id: 't6.l2',
  slug: 'wide-ep',
  trackId: 't6',
  index: 2,
  title: 'Wide Expert Parallelism in Production',
  minutes: 30,
  hook: 'EP144 means your batch is spread across 144 GPUs and every layer is a distributed transaction. DeepEP, EPLB, and communication-computation overlap are the machinery that keeps it profitable — and SGLang reproduced the whole thing on 96 H100s for you to read.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `[[l:t6.l1]] gave you the problem: hot experts straggle the combine barrier, and MoE wants huge batches. **Wide EP** is the production answer: spread the experts across *many* GPUs (EP32 for prefill, EP144 for decode in the layout DeepSeek published for its V3/R1 service), run enormous batches so expert utilization is uniform, and hide the all-to-all behind compute. This lesson is the three mechanisms that make it work — and the one public reproduction you can study line by line.

Why EP32 for prefill but EP144 for decode? The phases have opposite physics again ([[l:t5.l3]]): prefill is compute-bound — moderate EP, big per-GPU chunks, dense tensor-core work. Decode is bandwidth-bound and latency-critical — spread experts maximally (EP144), because each GPU then holds *fewer* experts and reads *less* weight per step... and because only a giant batch keeps 256 experts uniformly fed.`,
    },
    {
      type: 'prose',
      md: `## Mechanism 1: DeepEP — the dispatch/combine library

The all-to-all is so central that DeepSeek open-sourced a dedicated library for it, in ${claimCite('status.deepep.first-release')}. This section describes the library's first interface, V1, because the trade it teaches is the lasting part. V1 had two kernel sets, since the two phases want different things:

- **Normal kernels** (prefill/training): maximize bandwidth. Aggregate tokens by destination, forward over NVLink and RDMA with big transfers, tolerate microseconds of latency.
- **Low-latency kernels** (decode): minimize latency at smaller transfer sizes. DeepEP's V1 README calls them "a set of low-latency kernels with pure RDMA to minimize delays", for latency-sensitive decoding.

**The API has moved since** (${claimCite('status.deepep.api')}). DeepEP's current README says its V2 unified "High-throughput and low-latency APIs ... into a single \`EPBuffer\` interface", and that its V2.5 release "Fully remove[d] V1". Training, prefill and decode now call the same dispatch and combine. The bandwidth-versus-latency trade did not go away; it moved inside the library, which estimates the SM and QP counts itself. Read the repository's README for the interface you would install today.

This is a recurring systems lesson: *one fabric, phase-specific paths*. Your batch-vs-streaming instinct, your bulk-vs-interactive RPC instinct — same shape. The transport is shared; what you optimize depends on the phase.`,
    },
    {
      type: 'prose',
      md: `## Mechanism 2: EPLB — load balance as a packing problem

The **Expert Parallel Load Balancer** treats hot experts as a bin-packing problem. Estimate per-expert load (the repository leaves the predictor out of scope; "A common method is to use moving average of historical statistics"); **replicate** the hottest experts as "redundant experts" onto other GPUs (replication, not migration — the weights are small compared to the KV); then **pack** the copies onto GPUs heuristically, so the combine barrier costs about the mean load, not the max.

Notice what EPLB really is: **replication plus bin-packing, with no hashing in it**. Placement is computed from measured load, not from a hash of the expert id: that is the difference from your cache tier ([[l:t3.l6]], [[l:t5.l9]]), where a hash fixes which node owns a key and load follows. Here load comes first and placement follows. DeepSeek's repository ships two policies: a *hierarchical* one for prefill, at a smaller expert-parallel size, that packs expert groups onto nodes first, and a *global* one for decode, at a larger size, that replicates across all experts and packs the copies onto GPUs.`,
    },
    {
      type: 'play',
      playId: 'eplb',
      title: 'Replicate and place the experts, then meet the reference',
    },
    {
      type: 'prose',
      md: `## Mechanism 3: overlap — hide the network under compute

Even with DeepEP, the all-to-all costs real microseconds. The fix is the oldest trick in the latency book ([[l:t2.l6]]): never wait. DeepSeek's **dual-batch overlap** splits a batch of requests into two micro-batches, in both phases. In *prefill* the two run alternately: while micro-batch A computes, micro-batch B does its dispatch/combine transfer, and the cost of one hides behind the compute of the other.

*Decode* keeps the two micro-batches and schedules them differently. DeepSeek writes that "the execution durations of different stages are unbalanced", so it subdivides the attention layer into two steps and runs "a 5-stage pipeline" for the overlap. Its profiling notes add that decode's all-to-all "does not occupy GPU SMs": after the RDMA messages are issued "all GPU SMs are freed", and the system waits for the transfer only after the computation has finished. In both phases the all-to-all leaves the critical path — not removed, hidden.

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
      type: 'item',
      title: 'Price a node-day with new numbers',
      family: 'cost',
      variants: ['node-day'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Wide EP is **your sharded cache fleet with a fan-out router**, and the three mechanisms map one-to-one: DeepEP ≈ the RPC layer with separate bulk and latency paths (gRPC streaming vs unary), EPLB ≈ hot-key replication plus bin-packing (your memcached tier's hot-key problem, with GPUs; the placement is computed from load, not from a hash), overlap ≈ every event-loop lesson from [[l:t2.l6]] — never block, interleave. The genuinely new thing is only the payload: tokens instead of requests, experts instead of shards.`,
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
            'Decode needs more FLOPs per token than prefill, demanding many more GPUs to finish each step within its latency budget',
            'Decode is bandwidth-bound and wants huge uniform batches, while prefill is compute-bound and wants big dense chunks',
            'Prefill cannot use the dispatch path efficiently, confining it to a narrow group of GPUs in one NVLink domain',
            'The width matches the number of experts per layer in the model, with prefill simply using fewer of them',
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
          kcs: ['t6.expert-load-balance', 't6.all-to-all'],
        },
        {
          q: 'EPLB keeps the combine barrier cheap by…',
          options: [
            'Capping each expert\'s capacity and dropping tokens past the cap, leaving no GPU above the average load',
            'Replicating hot experts onto second GPUs and reassigning placement, leaving each GPU near the mean load',
            'Shrinking the batch at each step to send fewer tokens to any expert, flattening load at some cost in utilization',
            'Detecting slow GPUs at runtime and rerouting their tokens to next-best experts, leaving the barrier waiting on healthy devices',
          ],
          correct: [1],
          explanation:
            'The barrier costs the MAX load unless balanced. EPLB takes estimated per-expert load, duplicates the heavy experts and packs the copies onto GPUs heuristically to flatten it — a packing problem, not a hashing one.',
          why: [
            'Token dropping is a capacity-factor trick that harms quality. EPLB leaves routing untouched and changes where experts live and how many copies exist.',
            'Right: EPLB works from estimated per-expert load, replicates the hottest experts and packs the copies onto GPUs, so the barrier costs about the mean load instead of the max.',
            'Smaller batches make expert load noisier, not flatter, because uniformity comes from large-batch statistics. EPLB balances through placement and replication instead.',
            'Barrier delay comes from load skew, not faulty hardware, and rerouting tokens changes which expert answers them, which hurts quality. EPLB balances load without changing routing.',
          ],
          kcs: ['t6.expert-load-balance'],
        },
        {
          q: 'Dual-batch overlap exists to…',
          options: [
            'Run two model copies on one GPU, letting a new version be tested against the old without a restart',
            'Pipeline two micro-batches, letting one compute while the other communicates and hiding network time behind compute',
            'Double the batch per step, flattening expert load statistically at the cost of extra latency per generated token',
            'Replicate each expert on two GPUs, letting a token use whichever copy is idle and skipping the dispatch wait entirely',
          ],
          correct: [1],
          explanation:
            'Compute and communication alternate every layer; overlapping keeps both resources busy. DeepSeek splits the batch into two micro-batches in both phases: prefill alternates them, and decode splits attention into two steps and runs them through a 5-stage pipeline. It is T2.L6\'s never-block principle applied to a distributed forward pass.',
          why: [
            'Model co-location is a different concern. Dual-batch overlap splits one batch into two micro-batches of the same model; both halves run the same weights.',
            'Right: while micro-batch A computes, micro-batch B runs its dispatch or combine, so SMs and network stay busy and the transfer leaves the critical path. Prefill alternates the two; decode runs them through a 5-stage pipeline.',
            'That is large-batch load balancing (T6.L1). Dual-batch overlap keeps the same total tokens and splits them in two to overlap phases, not to enlarge the batch.',
            'Replication is EPLB\'s tool, and replicated experts still need dispatch and combine. Dual-batch overlap leaves placement alone and overlaps communication with compute.',
          ],
          kcs: ['t6.comm-overlap'],
        },
        {
          q: 'DeepEP\'s first release shipped separate high-throughput and low-latency kernel sets because…',
          options: [
            'Prefill wants bandwidth from large batched transfers, while decode wants the least delay from small per-step transfers',
            'One mode moves tokens within a node over the fast local links, while the other moves them across nodes over the slower network fabric',
            'The low-latency mode replaced a buggy original, while the older mode stays for compatibility with earlier deployments',
            'Training and inference use different expert layouts, while each needs a routine matched to its weight format',
          ],
          correct: [0],
          explanation:
            'Phase-specific paths on a shared fabric — the same reason you use different RPC shapes for bulk vs interactive traffic. DeepEP\'s current API has since unified the two behind one interface; the bandwidth-versus-latency trade is what stayed.',
          why: [
            'Right: the same fabric serves two workloads. Prefill saturates links with big batched transfers; decode runs small transfers where each layer\'s delay matters most.',
            'The split is by phase, not by fabric tier. The modes differ in whether they optimize prefill bandwidth or decode latency, and one deployment uses both over the same cluster.',
            'Both kernel sets were first-class paths. The split reflects physics: large transfers amortize overheads, while decode needs the least delay per layer.',
            'The split is by phase, not by train versus serve. The same model dispatches differently in prefill and decode because the bandwidth and latency tradeoff differs.',
          ],
          kcs: ['t6.comm-overlap', 't6.all-to-all'],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Read the reproduction',
      md: `The two documents worth a weekend each: **DeepSeek's open-infra week** (github.com/deepseek-ai/open-infra-index) — the production numbers, including the day's "cost profit margin of ${claimNumber('bench.deepseek-day6.cost-profit-margin')}%" (profit over cost, at R1 list prices) and the ${claimNumber('bench.deepseek-day6.cache-hit-rate')}% KV-cache hit rate; and **SGLang's "large-scale EP" writeup** (lmsys.org, May 2025) — 96×H100, P/D disaggregation + wide EP with DeepEP/DeepGEMM/EPLB, ${claimNumber('serving.sglang-deepseek.input-tps-per-node') / 1e3}k input / ${claimNumber('serving.sglang-deepseek.output-tps-per-node') / 1e3}k output tok/s/node, ~$${claimNumber('serving.sglang-deepseek.cost-per-mtok').toFixed(2)}/M output tokens. A vLLM-team follow-up (Dec 2025) reached 2.2k output tok/s per H200 in production-like multi-node configs. These are the reference points for every T6/T7 calculation.`,
    },
  ],
  kcs: ['t6.ep-economics', 't6.expert-load-balance', 't6.comm-overlap'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt:
          'Why does EPLB replicate hot experts rather than move them, and what does that buy at the combine barrier?',
        model:
          'Expert weights are small next to the KV cache, so a second copy on another GPU is cheap, and replicas split the hot expert\'s tokens. Placement is reassigned periodically from measured per-expert load. The combine barrier then costs about the mean load across GPUs instead of the maximum.',
        ideas: [
          'Expert weights are small next to the KV cache, so a second copy on another GPU is cheap',
          'Replicas split the hot expert\'s tokens, and placement is reassigned from measured per-expert load',
          'The combine barrier then costs about the mean load instead of the max',
        ],
        kcs: ['t6.expert-load-balance'],
      },
      {
        prompt:
          'How does dual-batch overlap hide the all-to-all, and what does it not remove?',
        model:
          'The batch splits into two micro-batches: while one computes, the other runs its dispatch or combine, so the GPUs and the network are both busy. Prefill alternates them; decode, whose stages are unequal, splits attention in two and runs them through a 5-stage pipeline. The transfer leaves the critical path but still happens: if it takes longer than the compute it hides under, the stall returns.',
        ideas: [
          'Two micro-batches: one computes while the other dispatches or combines (alternating in prefill, a 5-stage pipeline in decode)',
          'The transfer is hidden behind compute, so it leaves the critical path',
          'It is hidden, not removed: a transfer longer than the compute it hides under still stalls',
        ],
        kcs: ['t6.comm-overlap'],
      },
    ],
  },
}

export default lesson
