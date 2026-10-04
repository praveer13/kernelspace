# LLM-serving landscape through 2026-10: content-upgrade deltas for kernelspace

Research dossier · compiled 2026-10-03 · scope: what changed in LLM serving (emphasis 2026-06 → 2026-10, plus important 2025–2026 items the course is missing), mapped to kernelspace lesson ids, sims, labs and Fleet.

Method: mapped the course (68 lesson files, `public/field-notes.json`, sim hardware presets in `src/components/sims/KvCacheSim.tsx` / `RooflineSim.tsx` / `LatencyWalk.tsx`, `scripts/verify-field-notes.ts`). Prior plans (PLAN.md §2, PLAN-WORLDCLASS.md §6) were read so this does not re-propose shipped work. Then I verified the landscape against primary sources: GitHub release notes pulled with `gh api` (vLLM, SGLang, Dynamo, llm-d, TRT-LLM, DeepEP/DeepGEMM, InferenceX and others), arXiv abstracts, vendor docs and spec tables, and engine docs. Secondary press is used only where no primary source could be fetched, and it is marked as such. **[unverified]** marks claims I could not confirm.

---

## 1. Executive summary

The course's spine (memory hierarchy → paging → batching → disaggregation → economics) is still right. Its *examples* are pinned to 2024–25 artifacts, and five things changed in ways that alter the serving math:

1. **The attention layer split into a zoo.** MLA, sliding-window plus sinks, learned sparse selection (DSA), and compressed sparse attention (DeepSeek-V4 CSA/HCA: about 10% of V3.2's KV at 1M tokens) now coexist with linear-recurrent hybrids (Qwen3.5 and Kimi Linear/K3 at about 3:1 linear:full). "KV = 2·L·H·d·bytes" is now one row in a table. KvCacheSim models only GQA.
2. **Disaggregation went one level deeper.** Attention–FFN disaggregation (MegaScale-Infer, Step-3) became a vendor product: Vera Rubin attention plus Groq 3 LPX FFN/MoE decode. The course does not cover AFD.
3. **Determinism became a serving feature.** Batch-invariant kernels are in vLLM, SGLang and DeepSeek-V4's production decode.
4. **Consolidation.** TGI is archived, Dynamo deprecated KVBM (v1.5.0), and llm-d moved code upstream. Five lessons present KVBM as current.
5. **Rust moved into the engines' CPU path.** vLLM has a Rust frontend RFC (3.3× lower P50 TTFT), and SGLang's radix cache core now defaults to Rust.

The best return on build effort: an attention-zoo KV calculator, a determinism lab, an AFD Fleet mode, and a claims registry with a GitHub Actions watcher.

---

## 2. Findings

### 2.0 Dated "what changed" list (2025 → 2026-10)

| Date | Change | Source |
|---|---|---|
| 2025-05-27 | Hazy Research Llama-1B megakernel fuses about 100 kernels into 1: <1 ms per forward pass on H100 (≈2.5× vLLM), <680 µs on B200, 78% of HBM bandwidth | hazyresearch.stanford.edu/blog/2025-05-27-no-bubbles |
| 2025-07-25 | Step-3 AFD: up to 4,039 tok/s/GPU decode at a 50 ms TPOT SLA on Hopper (DeepSeek-V3: 2,324 in the same setup); conditions are FP8, 4K context, no MTP, so this is not a long-context result [fixed] | arXiv 2507.19427 |
| 2025-07 (v4) [fixed] | MegaScale-Infer: disaggregated expert parallelism, ping-pong pipeline, M2N comms, up to 1.90× per-GPU throughput | arXiv 2504.02263 |
| 2025-08 | gpt-oss-120b: 117B/5.1B active, MXFP4 MoE weights, alternating banded-window/dense attention with sinks, fits one 80 GB GPU | huggingface.co/openai/gpt-oss-120b |
| 2025-08-27 | Cloudflare Infire (Rust engine): 17,224 tok/s at 25% CPU vs vLLM 0.10.0 at 16,164 tok/s and 140% CPU (H100 NVL) | blog.cloudflare.com/cloudflares-most-efficient-ai-inference-engine |
| 2025-09-10 | Thinking Machines shows nondeterminism comes from batch-size variance. Batch-invariant RMSNorm, matmul and attention take 1000 completions from 80 unique outputs to 1 | thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference |
| 2025-09-22 | SGLang deterministic mode: 34.35% average slowdown; 100% reproducible GRPO runs with slime | lmsys.org/blog/2025-09-22-sglang-deterministic |
| 2025-09 | DeepSeek-V3.2-Exp introduces DSA (lightning indexer, top-k). API price cut 50%: cache hit $0.028, miss $0.28, output $0.42 /Mtok | VentureBeat (secondary) |
| 2025-09 | MoonshotAI checkpoint-engine updates a 1T-parameter model across thousands of GPUs in about 20 s | github.com/MoonshotAI/checkpoint-engine |
| 2025-10-29 | MiniMax M2 stays with full attention: at larger scale the hybrid "had clear deficits in complex, multi-hop reasoning tasks" [fixed: exact wording], plus immature infrastructure (prefix caching, spec decode, low precision) | minimax.io/news/why-did-m2-end-up-as-a-full-attention-model |
| 2025-10-30 | Kimi Linear (KDA, 3:1 with MLA): up to 75% less KV and up to 6× decode throughput at 1M | arXiv 2510.26692 |
| 2025-10 | InferenceMAX v1 launches. Renamed InferenceX; v2 in 2026-02 | github.com/SemiAnalysisAI/InferenceX |
| 2025-11-04 | Continuum: KV-cache TTL across agent tool calls, more than 8× better job completion time on SWE-Bench/BFCL | arXiv 2511.02230 |
| 2025-12-24 | NVIDIA licenses Groq LPU technology non-exclusively (about $20B reported); Groq leadership joins NVIDIA | Tom's Hardware / ComSoc (secondary) |
| 2026-01-15 | OpenAI–Cerebras: 750 MW of wafer-scale systems from 2026 to 2028, reported as >$10B | The Register (secondary) |
| 2026-01-26 | Microsoft Maia 200: 216 GB HBM3e at 7 TB/s, 272 MB SRAM, >10 PF FP4, 750 W, "30% better perf/$" | blogs.microsoft.com |
| 2026-02-05 | DFlash: block-diffusion drafter, >6× lossless speedup, up to 2.5× over EAGLE-3 (ICML 2026) | arXiv 2602.06036 |
| 2026-02-20 | GB300 NVL72 joins InferenceX. SGLang reports up to 25× vs H200 on DeepSeek-R1 (NVFP4, overlap, Dynamo PD) | lmsys.org/blog/2026-02-20-gb300-inferencex |
| 2026-02/03 | Qwen3.5 family: Gated DeltaNet + gated attention at 3:1 (`6×(3×GDN→FFN, 1×Attn→FFN)` in 0.8B) | HF model cards |
| 2026-03-16 | GTC 2026: Dynamo 1.0 GA (GitHub v1.0.0 tagged 2026-03-13) [fixed]. Groq 3 LPX: 256 LPUs, 500 MB SRAM and 150 TB/s per LPU, 128 GB SRAM per rack, runs FFN/MoE plus drafts beside Vera Rubin. Rubin CPX was absent from the keynote roadmap slides; Tom's Hardware reads this as CPX being displaced by LPX but says it "remains to be seen" whether CPX ships. NVIDIA has not announced a cancellation [fixed] | developer.nvidia.com (LPX blog); Tom's Hardware (CPX) |
| 2026-04-16 | DeepGEMM "Mega MoE" fuses EP dispatch, both expert GEMMs (FP8×FP4), SwiGLU and EP combine into one kernel | github.com/deepseek-ai/DeepGEMM |
| 2026-04-22 | TPU7x Ironwood GA [date from secondary]: 192 GiB at 7.38 TB/s, 2,307 BF16 / 4,614 FP8 TFLOPs, 9,216-chip pods | docs.cloud.google.com/tpu/docs/tpu7x |
| 2026-04-24 | vLLM Rust frontend RFC. A single Rust frontend matches or beats 32 Python API servers; 3.3× lower P50 TTFT in the decode-heavy test | github.com/vllm-project/vllm/issues/40846 |
| 2026-04-26 | DeepSeek-V4 (Pro 1.6T/49B; Flash 284B/13B): CSA+HCA attention; at 1M tokens, 27% of FLOPs and 10% of KV vs V3.2; FP4 routed experts; FP8 KV (BF16 RoPE dims); on-disk KV cache; batch-invariant decode; wave-based EP overlap 1.50–1.73× | arXiv 2606.19348 |
| 2026-03-21 | TGI archived and in maintenance mode; HF recommends vLLM/SGLang | github.com/huggingface/text-generation-inference |
| 2026-07/08 | OSDI '26 serving papers: Strata (hierarchical context caching), ECHO (KV offload for NSA models), zero-copy KV offload, Weave (disaggregated RL co-scheduling), StriaTrace | usenix.org/conference/osdi26/technical-sessions |
| 2026-07-30 | GitHub Copilot production traces (3.2M users, 761M LLM calls): KV hit rate 90% within a turn, 55% across turn boundaries | arXiv 2608.00101 |
| 2026-08 | InferenceX "AgentX": open benchmark with 1M+ context and multi-turn traffic | InferenceX README |
| 2026-08-24 | Vera Rubin + LPX modes: PD split, attention–FFN split, and LPX-drafted spec decode; 3,431 tok/s/user on Gemma 4 31B at 100K context | developer.nvidia.com blog |
| 2026-09-02 | Kimi K3: 2.8T/104B active, 16 of 896 experts, KDA + gated MLA, MXFP4 QAT, 1M context | huggingface.co/moonshotai/Kimi-K3 |
| 2026-09-09 | vLLM v0.29.0: Model Runner V2 default; RL weight-sync `sharded_rdt` over NIXL; Mamba prefix caching | vLLM releases |
| 2026-09-16 | MLPerf Inference v6.1 adds E2E RAG, edge agentic workloads and speculative decoding; DeepSeek-R1 5.7× vs v5.1 | mlcommons.org |
| 2026-09-18 | SGLang v0.5.20 ships a CPU-only simulator (real scheduler and radix cache plus a latency predictor, TTFT within about 6%) and a unified radix tree for SWA (hit rate 43.8% → 60.8%) | SGLang releases |
| 2026-09-21 | Dynamo v1.5.0: KVBM deprecated (removal v1.6); Rust EPP is default; AIConfigurator becomes AISimulate | Dynamo releases |
| 2026-09-22 | vLLM v0.30.0: HiSparse host tier for sparse-MLA KV; persistent GPU weight-cache daemon ("Fast Start"); Gumbel watermarking | vLLM releases |
| 2026-09-29 | SGLang radix cache "Rust TreeCore" becomes the default; llm-d v0.10.0 deprecates its fs-connector in favor of vLLM's `OffloadingConnector` | sglang PR #39627; llm-d releases |

### 2.1 Hardware

**F1. HBM bandwidth roughly doubles per generation, and FP16 ridges are flat or falling. The FP4 ridge is where the action is.**
- Evidence: HGX B200 FP16/BF16 is 36 PF sparse per 8 GPUs, about 2.25 PF dense per GPU, with 1.4 TB total memory, i.e. about **180 GB per GPU as shipped**, not 192. HGX B300 has 2.1 TB and 108 PF dense FP4 per 8. **HGX Rubin NVL8 has 2 TB HBM4, 130 TB/s total, 32 PF dense FP16, 130 PF dense FP8, 400 PF sparse FP4, and 3.6 TB/s NVLink per GPU** (nvidia.com/en-us/data-center/hgx). GB300 NVL72 has 20 TB HBM at 576 TB/s (8 TB/s per GPU) and 1,440 PF sparse / 1,080 PF dense FP4 [fixed]. The same official HGX page also has an "Individual GPU" table listing the Rubin GPU at **288 GB HBM4, 22 TB/s, 50 PF NVFP4 (sparse), 4 PF dense FP16 and 3.6 TB/s NVLink**. That matches the CES press figures. The NVL8 system rows (2 TB, 130 TB/s) work out to only about 250 GB and 16.25 TB/s per GPU, so **NVIDIA's own page is internally inconsistent**. The 22 TB/s figure is not just a press number [fixed]. Cite the row you use, and treat this as an open discrepancy. The 180 GB B200 figure is better sourced to DGX B200 (1,440 GB total, 64 TB/s; nvidia.com/en-us/data-center/dgx-b200) than to the HGX page's rounded "1.4 TB" [fixed]. InferenceX already lists Vera Rubin NVL72 as "officially supported", which is evidence of shipping by 2026-10.
- Derived: the Rubin FP16 ridge is ≈4 PF ÷ 22 TB/s ≈ 182 FLOP/B using the per-GPU row, or ≈246 FLOP/B using the NVL8 system totals. Either way it is *lower* than the H100's 295 [fixed]. Decode at low batch is more bandwidth-bound per FLOP than ever, and only low precision moves the ridge.
- Boundary: vendor "50× AI-factory output" and "10× lower cost per token" claims mix in software, precision and interactivity choices. Teach them as claims to decompose.
- Implication: the t4.l3 roofline sim and the t6.l5 lesson should add B300 and Rubin presets from the official HGX table, plus a worksheet asking "why did the FP16 ridge drop?" Fix the 192 → 180 GB nuance in t6.l5.

**F2. SRAM-centric decode accelerators became mainstream, and decode itself is being split across chip types.**
- Evidence: Groq 3 LPX has 256 LPUs, each with **500 MB SRAM at 150 TB/s**; the rack has 128 GB SRAM, 40 PB/s, and 315 PF FP8. It runs "FFN and MoE expert execution" plus draft tokens while Rubin GPUs run attention and hold KV, with Dynamo orchestrating per-token activation exchange (NVIDIA dev blog, 2026-03-16). Rubin CPX (128 GB GDDR7, prefill-specialized, announced 2025-09) was missing from the GTC 2026 keynote roadmap slides. Tom's Hardware (2026-03-17) infers that LPX displaced it but calls the outcome open, and says some customers may still deploy CPX. There is no NVIDIA cancellation statement [fixed]. Cerebras WSE-3 has 44 GB SRAM; OpenAI signed for 750 MW (The Register, 2026-01-15). Maia 200 has 272 MB SRAM beside 216 GB HBM.
- Boundary: the 3,382–3,431 tok/s/user figures (Gemma 4 31B, 10K/100K context) are attributed to Artificial Analysis measurements; the 4,767/5,520 SPEED-Bench figures are NVIDIA's own. All are on a single model at specific contexts, published in an NVIDIA blog [fixed]. SRAM capacity forces huge chip counts (128 GB across 256 chips).
- Implication: this is the memory-hierarchy lesson (t0.l2) taken to its extreme, and the best "same idea at 4 scales" isomorphism the course has: register file → SM shared memory → LPU SRAM → wafer SRAM. Add an SRAM-chip rung to LatencyWalk. The CPX reversal works as a field note on roadmap risk.

**F3. Non-NVIDIA silicon is real but heterogeneous.**
- Evidence: TPU7x has 192 GiB at 7.38 TB/s, 4,614 FP8 TFLOPs, and 9,216-chip pods (Google docs). Trainium3 has 144 GB at 4.9 TB/s and 144-chip UltraServers (aws.amazon.com/ai/machine-learning/trainium). MI355X runs GLM-5.3 FP8/MXFP4 with MTP in SGLang v0.5.21. Helios/MI455X (432 GB HBM4, 72 per rack, 2H 2026; secondary sources [unverified on amd.com, page timed out]).
- Implication: the hardware presets should become a sourced data file (§3, idea 8). Keep the course NVIDIA-centred but cross-vendor in its *ratios* (bytes/FLOP, GB/chip, scale-up domain size).

### 2.2 Model architectures

**F4. "KV bytes per token" is now a per-layer-type function.** This is the single most important content delta.
- Evidence:
  - DeepSeek-V4: CSA compresses every *m* tokens into one entry and selects top-k entries with a lightning indexer. HCA compresses at m′ ≫ m with no sparsity. Sliding-window uncompressed entries are added on top. KV is stored as FP8 with BF16 RoPE dims, about half of BF16. At 1M tokens, KV is **10% of V3.2's** and ≈2% of a BF16 GQA8 baseline (arXiv 2606.19348).
  - Kimi Linear: −75% KV, 6× decode at 1M (arXiv 2510.26692).
  - Qwen3.5: 3:1 Gated DeltaNet:attention, with *constant-size* recurrent state on 3 of every 4 layers.
  - gpt-oss: alternating sliding-window/dense attention plus sinks.
  - Kimi K3: KDA + gated MLA.
  - vLLM's hybrid KV cache manager groups layers by type and equalizes page size across full-attention, SWA and Mamba groups. Prefix hits first take the longest full-attention hit, scanning left→right. They then take the longest SWA hit *within that length*, scanning right→left. This is a constrained two-step search, not a set intersection [fixed] (docs.vllm.ai/en/latest/design/hybrid_kv_cache_manager).
- Boundary: MiniMax M2 found hybrids weaker on multi-hop reasoning at scale (minimax.io, 2025-10-29), so linear attention is not settled. Recurrent state breaks naive prefix caching, because the state at token *t* cannot be sliced from a longer state. vLLM only got Mamba prefix caching via internal checkpoints in v0.29 (9–25% TTFT gain).
- Implication: rebuild t5.l4 and KvCacheSim as an **attention zoo** (§3, idea 1). Extend t5.l5 and lab 02 with multi-group paging. Add a new isomorphism: **recurrent state ≡ a checkpointed stream processor / snapshot** (you can resume from a checkpoint, not from an arbitrary offset), vs **KV ≡ a log** (random-access, append-only).

**F5. Trillion-parameter fine-grained MoE with FP4 weights is the frontier default.**
- Evidence: Kimi K3 is 2.8T/104B active with 16 of 896 experts and MXFP4 QAT. DeepSeek-V4-Pro is 1.6T/49B with FP4 routed experts. gpt-oss uses MXFP4 MoE weights.
- Implication: t6.l1 should keep DeepSeek-V3 as the worked example but add a "2026 frontier" table. t4.l7 needs a microscaling section (block scale per 32 elements for MX, per 16 for NVFP4) and the claim "the frontier ships FP4 *from training* (QAT), not post-hoc."

**F6. Diffusion LMs reached serving engines, but only at the margin.**
- Evidence: SGLang v0.5.21 lists DiffusionGemma as a supported model, and DFlash uses a *diffusion drafter* inside autoregressive spec decoding (arXiv 2602.06036).
- Implication: one deepdive card in t5.l8 ("parallel drafting trades FLOPs for steps"). Not a lesson yet. Low durability.

### 2.3 Engines and systems

**F7. Consolidation: data-plane features are being absorbed into the engines.**
- Evidence: Dynamo v1.5.0 deprecated KVBM ("Use the engine's native KV offloading for host and disk tiering"). llm-d v0.10 deprecated its fs-connector in favor of vLLM's in-tree `OffloadingConnector` and its CUDA image in favor of `vllm/vllm-openai`. TGI is archived. vLLM v0.28 added disk offload tiers and pluggable secondary-tier managers.
- Boundary: cross-node KV sharing still sits outside engines (Mooncake, LMCache, Dynamo's early-stage "KVCR").
- Implication: t6.l3, t5.l10, t3.l7, t5.l6 and t5.l9 describe KVBM as current GA plumbing. Fix them. The durable lesson to teach is **"tiering is a feature of the cache owner; transport (NIXL, Mooncake TE) and routing (EPP) stay separate layers."** It is also a good case study on reading deprecation notices.

**F8. The routing/control plane standardized on Kubernetes APIs, and the gateway is increasingly Rust.**
- Evidence: Gateway API Inference Extension `InferencePool` is v1 (stable). The Endpoint Picker scores pods on KV utilization, queue length and loaded LoRA adapters (gateway-api-inference-extension.sigs.k8s.io). Dynamo v1.5 removed its Go EPP; **the Rust EPP is the default**. The Rust gateways are `vllm-project/router`, SGLang's `sgl-model-gateway`, and the engine-agnostic Shepherd Model Gateway (`lightseekorg/smg`, Rust, v1.11.0 2026-09-24).
- Implication: the Fleet's cache-aware router mode should name the EPP contract (score → filter → pick). The t3.l7 "who writes what" map gets a new row.

**F9. The engine CPU path is the new bottleneck, and Rust is the fix.**
- Evidence: in the vLLM RFC #40846 (2026-04-24) on 4×GB200 with Qwen3-0.6B, a single Rust frontend served **837 req/s vs 162 for default Python (asc=4)**, with P50 TTFT 597 ms vs 6,076 ms. In the decode-heavy test, P50 TTFT was 50.5 vs 166 ms. SGLang made its Rust radix "TreeCore" the default (PR #39627, merged 2026-09-29), porting SLRU and T-LRU eviction plus SWA and Mamba write-back. Infire showed vLLM-class throughput at 25% vs 140% CPU.
- Boundary: the RFC benchmark deliberately used a tiny model at very high concurrency to expose the ceiling. The Rust frontend repo is archived as a staging repo; integration lives in-tree.
- Implication: this is the strongest evidence yet for kernelspace's Rust-native thesis. **lab 07 radix-cache is the same data structure SGLang just rewrote in Rust.** Put that in the lab intro and the t5.l6 field note. Add a "frontend CPU wall" exercise to t5.l7 (tokenization and detokenization per request at high QPS).

**F10. Simulation-first capacity planning is now industry practice.**
- Evidence: SGLang's CPU-only simulator runs the real scheduler and radix/hierarchical cache with a latency predictor. It predicts TTFT within about 6% (up to 10% on 32K–128K traces) and prefix reuse within 0.05 pp (v0.5.20). Dynamo ships AISimulate (formerly AIConfigurator) with offline replay.
- Implication: this independently validates the Fleet's design (deterministic simulator plus real traces). t7.l2/t7.l5 should cite it, and the Fleet calibration doc could report error vs these simulators on a shared trace.

### 2.4 Techniques

**F11. Attention–FFN disaggregation (AFD) is the third disaggregation axis**, after P/D and E/P/D.
- Evidence: MegaScale-Infer reports up to 1.90× per-GPU throughput. Step-3 reports 4,039 vs 2,324 tok/s/GPU under a 50 ms TPOT SLA. NVIDIA productized the split with Rubin and LPX.
- Boundary: per-layer, per-token activation exchange needs very low-latency fabric. It pays off for MoE decode at scale, not for small dense models.
- Implication: add a new T6 lesson and a Fleet mode (§3, idea 3). Isomorphism: **compute/storage separation in databases (Aurora, Snowflake) and the ping-pong double buffer from t2.l6**.

**F12. Determinism is a product feature with a known price.**
- Evidence: Thinking Machines (2025-09-10) went from 80 unique completions in 1000 to 1. Throughput dropped 26 s → 55 s, recovered to 42 s with an improved attention kernel. SGLang's overhead is 34.35% on average. vLLM has `VLLM_BATCH_INVARIANT=1`. The DeepSeek-V4 report describes end-to-end bitwise batch-invariant, deterministic kernels; whether they run in production serving is not stated [unverified]. An active research stream followed: CoRun (2608.14376, padding instead of invariant kernels, "15–324%" faster), LLM-42 (2601.17768), TP-size invariance (2511.17826), and cross-precision divergence (2609.26621).
- Boundary: invariance across *batch size* is not invariance across *TP size, precision or hardware*.
- Implication: this is ideal kernelspace material, durable (floating-point non-associativity is permanent) and cheap to simulate. Add a new lesson and Forge lab (§3, idea 4). It connects t6.l7 (on-policy RL), t6.l10 (audit), t7.l2 (benchmark reproducibility) and t1/t4 (floats).

**F13. Kernel boundaries are a tax: megakernels, fused MoE, and Python kernel DSLs.**
- Evidence: Hazy's megakernel (above). DeepGEMM Mega MoE fuses dispatch, GEMMs and combine into one kernel. DeepEP V2 ships an NCCL "Gin" backend and hybrid NVLink/RDMA domains. FlashAttention-4 is written in CuTe DSL (`flash-attn-4`, beta33 on 2026-09-30). vLLM v0.30 defaults to FlashInfer CuTe DSL NVFP4 W4A16 on SM100.
- Implication: t4.l6 should name FA4/CuTe DSL. t3.l7's "GPU kernels are CUDA C and Triton — no exceptions" should become "CUDA C++, and increasingly Python DSLs (CuTe DSL, Triton/Gluon, TileLang). Rust GPU (CubeCL, the revived rust-cuda, cudarc v0.19.10) exists but is marginal in production." Teach the megakernel idea in the WGSL playground as a persistent-workgroup vs many-dispatch experiment.

**F14. Speculative decoding diversified: model-free, diffusion and adaptive drafters.**
- Evidence: EAGLE-3 reaches up to 6.5× and 1.38× in SGLang at batch 64 (2503.01840). SuffixDecoding reaches up to 5.3× on agentic workloads and 2.8× over EAGLE-2/3 (2411.04975, NeurIPS'25 spotlight). DFlash (above). vLLM added DSpark confidence-scheduled verification, adaptive verification and **per-request acceptance metrics in the API** (v0.28/v0.29). MLPerf v6.1 allows spec decode.
- Implication: t5.l8/t6.l6 should add "draft source taxonomy: separate model / own head (MTP) / suffix tree over history / diffusion block." SuffixDecoding is a natural Forge lab (§3, idea 5).

**F15. Agentic serving means KV retention across tool calls, priced by TTL.**
- Evidence: Copilot traces show a 90% → 55% hit rate across turn boundaries, with minutes-long idle periods (2608.00101). Continuum's TTL policy gives >8× JCT. "Stateful inference" reports 2.1×–4.2× per turn (2605.26289). API pricing mirrors this: Anthropic charges 1.25× base for 5-minute cache writes, 2× for 1-hour writes and 0.1× for reads as the *standard* rate. Some newer models read cheaper: 0.05× on Opus 5.5 and 0.025× on Fable/Mythos 5.1 [fixed] (platform.claude.com prompt-caching). DeepSeek V4-Pro charges $0.044 per Mtok for a cache hit vs $1.32 for a miss at peak, a 30× ratio (50× for flash), with **off-peak at half price**.
- Implication: this is the economic and systems core of t6.l8 and t7.l4 (§3, idea 6).

**F16. RL rollout: weight sync became P2P and sliced, and rollouts became replayable.**
- Evidence: checkpoint-engine (1T in about 20 s, broadcast plus P2P via Mooncake TE). vLLM `sharded_rdt`: each worker pulls only its TP/EP slice over NIXL or Ray Direct Transport (v0.29). SGLang `return_sampling_mask` lets the trainer replay the exact sampling support (v0.5.20). OSDI'26 has Weave and RLinf.
- Implication: update t6.l7 from "NCCL broadcast" to "sliced P2P pull." Determinism (F12) explains why on-policy RL needs it.

### 2.5 Benchmarks and economics

**F17. The open benchmark moved from "nightly throughput" to "agentic, 1M-context, multi-turn."**
- Evidence: InferenceMAX was renamed InferenceX (v2 in 2026-02). It covers Vera Rubin NVL72, GB300, B300, MI355X and TPU7x, and added AgentX in 2026-08. It runs as public GitHub Actions with Apache-2.0 code and data. MLPerf v6.1 (2026-09-16) added RAG and edge-agentic workloads.
- Implication: t7.l2/t7.l3 should rename it and re-anchor. InferenceX's "results produced by public GitHub Actions" model mirrors kernelspace's CI-verified leaderboard; cite it as precedent.

**F18. Prices no longer only fall.**
- Evidence: H100 on-demand median is **$3.39/GPU-hr** (cheapest $1.30, 57 providers). B200 median is $6.25, **≈17% higher than a year ago**, and the H100 median is also ≈12% above a year ago, though flat over 90 days (getdeploying.com, 2026-10-04) [fixed: H100 also rose]. DeepSeek's list price for V4-Pro cache misses ($1.32 peak) is above V3.2-Exp's $0.28. Pricing is now tiered by cache state *and* time of day.
- Boundary: aggregator data is a snapshot that mixes availability tiers.
- Implication: rewrite t7.l4's "API prices fell ~80%" and "$2–3/hr" claims as dated ranges with a source. The durable teaching is **price = f(cost, load shape, cache state)**, with peak/off-peak as load shaping (isomorphism: electricity tariffs and surge pricing).

### 2.6 Rust in serving (2026-10 map)

| Component | Rust status | Evidence |
|---|---|---|
| vLLM frontend | Rust drop-in (RFC, in-tree integration, `VLLM_USE_RUST_FRONTEND`) | issue #40846, PR #40848 merged 2026-05-21 |
| SGLang radix cache | Rust TreeCore default | PR #39627 (2026-09-29) |
| Gateways/EPP | vllm-router, sgl-model-gateway, SMG, Dynamo Rust EPP | repos, Dynamo v1.5.0 |
| Dynamo | Rust 27.6 MB vs Python 17.9 MB (GitHub languages) | `gh api repos/ai-dynamo/dynamo/languages` |
| NIXL | **C++ (3.6 MB) with Rust bindings (0.24 MB)**, so it is not a "Rust library" | `gh api repos/ai-dynamo/nixl/languages` |
| Engines | Infire (Cloudflare), mistral.rs v0.9.4, candle (active), Burn/CubeCL v0.22-pre | releases |
| TGI (Rust router) | Archived 2026-03 | repo |
| Kernels | Not Rust in production. CUDA C++/CuTe DSL/Triton dominate; rust-cuda repo active again; cudarc v0.19.10 | repos |

---

### 2.7 Per-lesson upgrade deltas (keyed by lesson id)

| Lesson | Delta (what to add or change) | Block / asset touched |
|---|---|---|
| t0.l1 | Update the through-line: "decode is bandwidth-bound" now drives purpose-built SRAM decode chips (LPX) and AFD | prose, isomorphism |
| t0.l2 | Add an SRAM-chip rung (LPU 500 MB @150 TB/s; WSE-3 44 GB SRAM) and HBM4 (Rubin) to the ladder | `LatencyWalk.tsx` |
| t1.l3 / t1.l4 | Field note: vLLM equalizes page size across layer types, so fixed-size blocks win again | field-note |
| t2.l3 | SLRU and T-LRU eviction (SGLang Rust core) and KV TTL (Continuum) as named policies; add to the eviction lab | eviction sim preset |
| t2.l4 | PD role switching without restart (SGLang v0.5.21); OSDI'26 "Multiplication may be all you need for LLM request scheduling" | deepdive |
| t2.l7 | Footnote: TGI archived 2026-03 (the paper lineage now lives in vLLM/SGLang) | prose |
| t3.l6 | Dynamo v1.5: Rust EPP default, KVBM deprecated. Teach "reading a deprecation as an architecture signal" | field-note, quiz |
| t3.l7 | Rewrite the "where Rust won" evidence: vLLM Rust frontend numbers, SGLang Rust TreeCore, SMG, Rust EPP; correct NIXL to C++; TGI archived; kernel-DSL nuance | prose, quiz options |
| t4.l3 | Add B300/Rubin from the HGX table; "why the FP16 ridge fell"; NVFP4 ridge | `RooflineSim.tsx` presets, quiz |
| t4.l5 | Persistent-kernel vs many-dispatch WGSL experiment (megakernel intuition) | `WgslSim.tsx` new preset |
| t4.l6 | FA4 (CuTe DSL), FlashInfer; megakernels; Mega MoE fusion | field-note |
| t4.l7 | MXFP4/NVFP4 microscaling; QAT-shipped FP4 (gpt-oss, K3, V4); FP8/MXFP8 KV | `QuantizerSim` block-scale mode |
| t5.l1 | Attention variants overview (MHA→GQA→MLA→SWA+sinks→DSA→CSA/HCA→linear state) | step-through diagram |
| t5.l4 | **Attention zoo** calculator; contrast 320 KB/token with MLA ~70 KB, V4 ≈2% at 1M, and linear O(1) state | `KvCacheSim.tsx` rewrite |
| t5.l5 | Hybrid KV groups and unified page size; Mamba-state checkpoints for prefix caching | Block-table explorer |
| t5.l6 | Rust radix core; SWA branch-point caching (43.8→60.8% hit); prompt-caching price tiers | field-note, statline |
| t5.l7 | The frontend CPU wall (Rust frontend RFC numbers); async scheduling | exercise |
| t5.l8 | Draft-source taxonomy; DFlash and SuffixDecoding | prose, quiz |
| t5.l9 | KVBM → engine-native offload; Mooncake/LMCache for cross-node | prose |
| t5.l10 | Rewrite as a "2026-Q4 stack": MRV2, Rust frontends, TGI archived, InferencePool v1/EPP, consolidation; SGLang runs on ROCm | table, quiz |
| t6.l1 | 2026 frontier MoE table (K3 896 experts/16 active; V4-Pro; FP4 experts) | statline |
| t6.l2 | DeepEP V2 (NCCL Gin, hybrid domains); Mega MoE; V4 wave overlap 1.50–1.73× | prose |
| t6.l3 | Fix hook ("Rust transfer library" → NIXL is C++); KVBM deprecated; add AFD teaser | hook, prose |
| t6.l4 | Decode/prefill context parallel (DCP/PCP) as shipped features (vLLM v0.28/0.30) | prose |
| t6.l5 | 180 vs 192 GB; B300/GB300; Rubin (official SKU table, noting the per-GPU vs NVL8 discrepancy); NVLink 6 at 3.6 TB/s; CPX dropped from the GTC 2026 roadmap slides, not officially cancelled (roadmap risk) [fixed] | statline, field-note |
| t6.l6 | Adaptive verification, per-request acceptance API metrics; MLPerf allows spec decode | prose |
| t6.l7 | Sliced P2P weight sync; sampling masks; determinism → on-policy | prose, diagram |
| t6.l8 | KV TTL across tool calls; Copilot 90→55% hit; API cache price tiers | Fleet agent mode |
| t6.l9 | LoRA on DeepSeek V4 and GDN models in vLLM (partial LoRA on GatedDeltaNet) | field-note |
| t6.l10 | Dynamo opt-in mTLS; cache-hit timing side channels now also reflected in prices (hit vs miss is observable) | prose |
| t7.l1 | Agentic goodput (session JCT, not request TTFT) | prose |
| t7.l2 | InferenceX/AgentX; MLPerf v6.1; simulators (SGLang sim, AISimulate) as calibration | statline, prose |
| t7.l3 | Re-anchor Oct-2025 numbers as a dated "v1 snapshot" and link the live dashboard | prose |
| t7.l4 | $/hr ranges; price ≠ cost; peak/off-peak; hit/miss ratios | statline, worksheet |
| t7.l5 | llm-d autoscaling rename; Dynamo planner with AISimulate replay | prose |

### 2.8 Stale or imprecise numbers currently in the course

| File:line | Current value | Current reality | Source |
|---|---|---|---|
| t7/unit-economics.ts:20 | "H100-class $2–3/hr rented" | On-demand median $3.39, cheapest $1.30 (57 providers, 2026-10-04) | getdeploying.com/reference/cloud-gpu/nvidia-h100 |
| t7/unit-economics.ts:32, :44 | "API prices fell ~80% in a year" | Not monotone: frontier list prices rose (DeepSeek V4-Pro miss $1.32 peak vs V3.2 $0.28); B200 rental +17% YoY | api-docs.deepseek.com/quick_start/pricing; getdeploying B200 |
| t6/fp4-blackwell.ts:16, :34 | "B200: 192 GB HBM3e" | HGX/DGX B200 ships 1.4 TB per 8 GPUs, about 180 GB usable per GPU (DGX B200: 1,440 GB total) [fixed source]. The claim that 192 GB is raw stack capacity is [unverified] | nvidia.com/en-us/data-center/hgx |
| t6/epd-disaggregation.ts:10 (hook) | "a Rust transfer library" | NIXL is predominantly C++ with Rust bindings | gh languages API |
| t6/epd-disaggregation.ts:26 | "NVIDIA Inter-node Xfer Library" | Repo name: "NVIDIA Inference Xfer Library" | github.com/ai-dynamo/nixl |
| t6/epd-disaggregation.ts:16, :22–28; t5/production-stack.ts:47; t3/rust-zig-c-decision.ts:27, :112; t5/prefix-caching.ts:123; t5/distributed-serving.ts:16 | "Dynamo v1.3 … KVBM GA plumbing" | Dynamo v1.5.0 (2026-09-21); KVBM **deprecated**, removal targeted for v1.6 | Dynamo v1.5.0 release notes |
| t7/benchmarking.ts:16, :22, :34, :40; t7/pareto.ts:18, :119; t6/fp4-blackwell.ts:101; t7/unit-economics.ts:108 | "InferenceMAX … nightly … H100/H200/B200/GB200 and AMD" | Renamed InferenceX; covers GB300/B300/Vera Rubin NVL72/TPU7x; AgentX added | github.com/SemiAnalysisAI/InferenceX |
| t5/production-stack.ts:62 | "SGLang runs on: any CUDA" | Also ROCm (MI355X), NPU, MUSA ports | SGLang v0.5.20/21 notes |
| t5/production-stack.ts (vLLM para) | V1 engine as latest | Model Runner V2 default since v0.29.0; MRV1 removal targeted for v0.32 | vLLM v0.29.0 notes |
| t3/rust-zig-c-decision.ts:19 | "GPU kernels are CUDA C and Triton — no exceptions" | CuTe DSL (FA4, FlashInfer NVFP4 default), Gluon/TileLang; still not Rust | flash-attention README; vLLM v0.30 notes |
| `KvCacheSim.tsx`:171–190 | Presets Llama-3-8B/70B, Mixtral; GPUs H100/A100/4090/T4; GQA-only formula (:268) | Needs MLA/SWA/sparse/linear and B200/B300/MI355X/TPU7x | §2.2 |
| `RooflineSim.tsx`:62–66 | Tops out at B200 | Add B300, Rubin (HGX), TPU7x | HGX table; TPU docs |
| `LatencyWalk.tsx`:156, :429 | "HBM3 ~80 GB · 3.35 TB/s" unlabeled | Label as "H100 (2022)"; add HBM4 and SRAM-chip rungs | §2.1 |
| t6/wide-ep.ts | DeepEP as of 2025 | DeepEP V2/V2.5; Mega MoE fused kernel | DeepEP and DeepGEMM READMEs |
| t2/exam-pagedattention.ts:100 | "some TGI/TRT-LLM modes" | Fine historically; add "TGI archived 2026-03" | TGI README |

The H100 numbers in t4.* (3.35 TB/s, ~295 F/B ridge, 228 KB smem) are **correct and should stay**, because H100 is a stable teaching baseline. Label them by year rather than replacing them.

---

## 3. Concrete ideas ranked by expected learning impact ÷ build effort

Scored as impact (1–5) × durability (1–3) ÷ effort (S=1, M=2, L=3).

| # | Idea | Impact | Durability | Effort | Score | Zero-server |
|---|---|---|---|---|---|---|
| 1 | **Attention Zoo KV calculator** (rewrite KvCacheSim and t5.l4) | 5 | 3 | M | 7.5 | yes |
| 2 | **Determinism lab + lesson** ("same prompt, different answer") | 5 | 3 | M | 7.5 | yes |
| 3 | **Claims registry + landscape watcher** (freshness pipeline) | 4 | 3 | M | 6.0 | yes (LLM triage with-caveat) |
| 4 | **Hardware atlas data file** driving all sims | 3 | 2 | S | 6.0 | yes |
| 5 | **Agent-session Fleet mode** (KV TTL, cache-price economics) | 5 | 3 | L | 5.0 | yes |
| 6 | **AFD lesson + Fleet "split decode" mode** | 4 | 3 | L | 4.0 | yes |
| 7 | **Forge lab 09: suffix-tree drafter** | 4 | 3 | L | 4.0 | yes |
| 8 | **Real-engine "state vs cache" experiment** (Qwen3 vs Qwen3.5 in-browser) | 4 | 2 | M | 4.0 | with-caveat (WebGPU, ~0.5 GB download, perf [unverified]) |
| 9 | **Lab 02 extension: hybrid KV groups** | 3 | 3 | M | 4.5 | yes |
| 10 | **Production-stack 2026-Q4 rewrite** (t5.l10, t3.l7, t6.l3) | 3 | 1 | S | 3.0 | yes |
| 11 | **Megakernel WGSL experiment** | 3 | 2 | M | 3.0 | yes |
| 12 | **3D topology explorer** (NVL72 vs LPX vs TPU pod) | 2 | 2 | L | 1.3 | yes |

**1. Attention Zoo (top pick).** Replace the single GQA formula with per-layer-type rows:
- full MHA/GQA: `2·kv_heads·d·bytes` per token
- MLA: latent `(d_c + d_rope)·bytes`
- SWA: `min(t, W)`, plus sink tokens
- DSA: KV is still stored in full, but *reads* are limited to the top-k (separates capacity from bandwidth, a key insight)
- CSA/HCA: `t/m` and `t/m′` entries plus a window
- linear/GDN/KDA: a constant `heads·d_k·d_v·bytes` state

Model presets: Llama-3-70B (keep the 320 KB baseline), DeepSeek-V3 (MLA), gpt-oss-120b (SWA + sinks), Qwen3.5 (3:1 GDN), Kimi Linear (3:1 KDA/MLA), DeepSeek-V4 (CSA/HCA). Two curves: **capacity bytes vs context** and **bytes read per decode step vs context**. Tasks: "find the context length where V4 beats Llama-3-70B by 50×", "explain why DSA cuts reads but not capacity", "why can't a GDN layer reuse a prefix from the middle of a cached sequence?" Isomorphism panel: KV ≡ append-only log with random reads, linear state ≡ stream-processor checkpoint. Every coefficient comes from model configs (HF `config.json`), so it stays honest. The principle outlives every model name.

**2. Determinism lab.** A new lesson (T6 or T4 bridge) plus a Forge lab: `batch-invariant-reduce`. The student writes a Rust f32 reduction (sum, RMSNorm, dot-product "matmul row") whose result is bitwise-identical for any batch split. The lab checks run the same kernel at batch sizes 1…64 with different chunkings and compare `to_bits()`. A sim shows the Thinking Machines experiment in miniature: N "requests" decoding greedily under random batch composition, with outputs diverging at the first near-tie logit. Ground truth: 80 → 1 unique completions; 26 → 55 → 42 s; SGLang 34% overhead. Connects t6.l7 (RL on-policy), t7.l2 (reproducible benchmarks) and t1/t4 floats. It is cheap (pure CPU f32), fits the existing wasm ABI, and is permanently true.

**3. Claims registry + landscape watcher.** This is the lower-toil freshness pipeline.
- `src/data/claims.json`: `{id, value, unit, kind: durable|vendor|price|version, source, verifiedAt, ttlDays, lessons[]}`. Lessons reference claim ids (a `{{claim:b200.hbm}}` token or a `claimRefs` field on blocks), and `verify-field-notes.ts` grows a check: price and version claims older than their TTL fail with a warning, and lessons whose claims expired get an amber badge in the UI.
- `.github/workflows/landscape-watch.yml` runs weekly on cron (GitHub Actions only). It:
  - (a) polls the GitHub releases API for a watchlist: vllm, sglang, dynamo, llm-d, TensorRT-LLM, flashinfer, flash-attention, DeepEP, DeepGEMM, Mooncake, LMCache, verl, slime, AReaL, mistral.rs, candle, burn, cudarc, InferenceX, gateway-api-inference-extension;
  - (b) pulls arXiv listings for a fixed query set, paced to respect the export API rate limit (I hit "Rate exceeded" during this research);
  - (c) runs a link check (lychee) over every source URL in claims and field notes;
  - (d) writes `landscape/snapshot.json` and diffs it against the previous snapshot.
- A keyword matcher maps release-note lines containing `deprecated|removed|default|renamed|GA` and tags (`KVBM`, `InferenceMAX`, `NIXL`) to lesson ids. **This alone would have auto-flagged the KVBM deprecation against five lessons.**
- The action opens or updates one "Landscape digest YYYY-WW" issue.
- LLM triage, two options: (i) **zero-secret default**: the maintainer runs Claude Code locally against the issue with a checked-in `TRIAGE.md` prompt that drafts `field-notes.json` entries and per-lesson deltas, each with a URL; (ii) **with-caveat**: an Actions job calling an LLM API with a repo secret (cost, key custody). Either way, nothing auto-merges; `verify-field-notes.ts` plus a human review gate the PR.
- Quarterly cadence stays the same, but the work becomes reviewing a diff instead of researching from scratch.

**4. Hardware atlas.** `src/data/hardware.json` holds per-SKU HBM GB, TB/s, dense FP16/FP8/FP4, SRAM, scale-up domain and link bandwidth, with source URL and verifiedAt per field. Consumers: RooflineSim, KvCacheSim, LatencyWalk, Fleet. Include H100, H200, B200 (180 GB as shipped), B300, Rubin NVL8 (official HGX), MI355X, TPU7x, Trainium3, Maia 200, Groq LPU, WSE-3. Prerequisite for 1 and 3. One-file updates replace scattered literals.

**5. Agent-session Fleet mode.** Traffic as sessions: turn → tool pause (heavy-tailed, minutes) → turn with a growing prefix. Calibrate to the Copilot trace (90% within-turn vs 55% cross-turn hit). The student's lab-07 radix cache gains a `ttl_ms` policy hook. Scoreboard: session JCT, HBM-seconds held, and **$ under an API price sheet** (writes 1.25×/2×, reads 0.1× standard, 0.05×/0.025× on some newer models [fixed]; DeepSeek hit/miss 30–50×; peak/off-peak 2×). Act 3 of Fleet Week gains an agentic business case. Isomorphism: HTTP keep-alive / connection-pool idle timeout ≡ KV TTL.

**6. AFD lesson + Fleet "split decode" mode.** A new T6 lesson, "Disaggregating inside a layer": why MoE FFN is weight-bandwidth-bound, attention is KV-bound, and the two scale differently. Covers the ping-pong micro-batch pipeline (MegaScale-Infer) and Step-3's 4,039 vs 2,324 tok/s/GPU. Rubin + LPX serves as the hardware realization, and CPX's disappearance from the roadmap slides as a field note on roadmap risk [fixed]. Fleet mode: an attention pool and an FFN pool with a per-token activation hop latency slider. Students find the crossover where the hop latency kills the gain. Step-through diagram block: the ping-pong timeline.

**7. Forge lab 09 `suffix-drafter`.** The student builds a suffix tree (or trie) over recent token history, proposes the longest continuation with adaptive speculation length, and is checked on acceptance length and µs per proposal against a recorded agentic token trace. It reuses lab 03's tokenizer outputs and connects to lab 07 (tries). Ground truth: up to 5.3× on agentic workloads (2411.04975). Pure data-structure work, ideal for Rust and wasm.

**8. Real-engine "state vs cache".** `onnx-community/Qwen3.5-0.8B-ONNX` is documented for transformers.js on WebGPU, with a layout of `6×(3×GDN, 1×attention)`. Let the real-engine page load it beside Qwen3-0.6B and plot memory and ITL vs generated length. Caveats: download size and WebGPU availability; GDN kernel performance in transformers.js is **[unverified]**, and the measured effect may be dominated by runtime overheads at 0.8B. Frame it as an experiment with a hypothesis, not a guaranteed demo.

**9. Lab 02 extension: hybrid groups.** An optional advanced check: the block manager supports two KV groups (full and SWA window *W*) on a shared physical page size, frees out-of-window SWA blocks, and answers prefix-hit queries by taking the full-attention hit and then the longest SWA hit within it (vLLM design) [fixed].

**10. Production-stack rewrite.** Small edits, high credibility payoff. Use §2.8's list.

**11. Megakernel WGSL experiment.** Compare N small dispatches against one persistent workgroup loop with an atomic work queue, measuring wall time in-browser. Teaches launch-bubble intuition. WebGPU dispatch overhead differs from CUDA, so present it as an analogy with honest labeling.

**12. 3D topology explorer.** Three.js is already a dependency. Rendering NVL72, LPX and pod topologies in 3D *only* earns its cost if it encodes hop counts and bandwidth per link (an all-to-all visual for EP). Otherwise a 2D SVG step-through teaches the same thing. Low priority.

---

## 4. Anti-patterns and risks

- **Chasing model names.** In five months vLLM added DeepSeek-V4/V4.1, Kimi K3, Qwen3.5/3.6/3.8, GLM-5.2/5.3 and MiniMax M3. Teach *families* (MLA, SWA+sinks, sparse indexer, linear state, FP4 QAT) and keep names in data presets and field notes, never in quiz answers.
- **Building on unshipped roadmaps.** Rubin CPX went from announcement (2025-09) to absence from the GTC roadmap slides (2026-03) in six months, with no official cancellation [fixed]. Rule: no lesson or quiz built around hardware without a public spec sheet *and* independent benchmark presence (for example, InferenceX listing).
- **Vendor multipliers as facts.** "50× AI-factory output", "35× higher tokens/s per MW at 400 TPS/user vs GB200 NVL72" (the LPX blog's wording) [fixed] and "25× vs H200" (DeepSeek-R1 at 50 tok/s/user; H200 reaches similar throughput without that latency constraint) blend precision, software vintage and interactivity point. Always pair them with the Pareto lesson (t7.l3) and label them as vendor claims.
- **SKU conflation.** NVIDIA's own HGX page lists the Rubin GPU at 22 TB/s, while its NVL8 system total implies about 16 TB/s per GPU [fixed]. B200 is 192 GB raw vs 180 GB as shipped. Always cite the SKU table.
- **Overclaiming Rust.** NIXL is C++. Kernels are CUDA C++/Python DSLs. The honest 2026 claim is stronger anyway: *Rust is winning the CPU half of serving* (frontends, routers, caches, EPPs). The course's credibility depends on this nuance.
- **Presenting linear attention as solved.** MiniMax's reversal and immature prefix caching and spec decode for hybrids are part of the lesson.
- **Determinism oversell.** Batch invariance ≠ TP-size, precision or hardware invariance (2511.17826, 2609.26621).
- **Hallucinated freshness.** LLM triage must emit a source URL per claim, and CI must link-check every URL. Never auto-merge. My own search budget ran out mid-research and arXiv rate-limited me; the pipeline must cope with partial fetches by marking items [unverified] rather than guessing.
- **Price snapshots as truth.** Aggregator prices mix tiers. Store them as dated ranges with TTL ≤ 90 days.
- **Trace licensing.** The Copilot trace paper does not state a public dataset release. Use its published *statistics* for calibration, not raw data, unless a license appears.

---

## 5. Sources

| URL | Title | Date |
|---|---|---|
| https://github.com/vllm-project/vllm/releases/tag/v0.30.0 | vLLM v0.30.0 release notes | 2026-09-22 |
| https://github.com/vllm-project/vllm/releases/tag/v0.29.0 | vLLM v0.29.0 (MRV2 default, sharded_rdt, Mamba prefix caching) | 2026-09-09 |
| https://github.com/vllm-project/vllm/releases/tag/v0.28.0 | vLLM v0.28.0 (tiered offload, Rust frontend/gRPC, E/P/D in MRV2) | 2026-08-26 |
| https://github.com/vllm-project/vllm/issues/40846 | [RFC]: Rust front-end | 2026-04-24 |
| https://github.com/vllm-project/vllm/pull/40848 | Rust front-end integration | merged 2026-05-21 |
| https://docs.vllm.ai/en/latest/design/hybrid_kv_cache_manager/ | Hybrid KV Cache Manager | living doc |
| https://docs.vllm.ai/en/latest/features/batch_invariance/ | vLLM Batch Invariance | living doc |
| https://github.com/sgl-project/sglang/releases/tag/v0.5.21 | SGLang v0.5.21 | 2026-10-02 |
| https://github.com/sgl-project/sglang/releases/tag/v0.5.20 | SGLang v0.5.20 (simulator, unified radix tree, sampling masks) | 2026-09-18 |
| https://github.com/sgl-project/sglang/pull/39627 | [Radix Cache] Rust TreeCore default | 2026-09-29 |
| https://lmsys.org/blog/2025-09-22-sglang-deterministic/ | Towards Deterministic Inference in SGLang | 2025-09-22 |
| https://www.lmsys.org/blog/2026-02-20-gb300-inferencex/ | SGLang on GB300 NVL72 / InferenceX | 2026-02-20 |
| https://github.com/ai-dynamo/dynamo/releases/tag/v1.5.0 | Dynamo v1.5.0 release notes (KVBM deprecated, Rust EPP) | 2026-09-21 |
| https://github.com/ai-dynamo/nixl | NIXL repository (language breakdown via GitHub API) | accessed 2026-10-03 |
| https://github.com/llm-d/llm-d/releases/tag/v0.10.0 | llm-d v0.10.0 | 2026-09-29 |
| https://gateway-api-inference-extension.sigs.k8s.io/api-types/inferencepool/ | InferencePool API (v1) | living doc |
| https://github.com/huggingface/text-generation-inference | TGI (archived, maintenance mode) | archived 2026 |
| https://github.com/lightseekorg/smg | Shepherd Model Gateway (Rust) | v1.11.0 2026-09-24 |
| https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/ | Defeating Nondeterminism in LLM Inference | 2025-09-10 |
| https://arxiv.org/abs/2606.19348 | DeepSeek-V4: Towards Highly Efficient Million-Token Context Intelligence | 2026-04-26 |
| https://arxiv.org/abs/2510.26692 | Kimi Linear: An Expressive, Efficient Attention Architecture | 2025-10-30 |
| https://huggingface.co/moonshotai/Kimi-K3 | Kimi K3 model card | 2026-09 |
| https://huggingface.co/openai/gpt-oss-120b | gpt-oss-120b model card | 2025-08 |
| https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX | Qwen3.5-0.8B ONNX (transformers.js/WebGPU) | 2026 |
| https://www.minimax.io/news/why-did-m2-end-up-as-a-full-attention-model | Why Did M2 End Up as a Full Attention Model? | 2025-10-29 |
| https://arxiv.org/abs/2504.02263 | MegaScale-Infer | 2025-04-03 (v4 2025-07-26) [fixed] |
| https://arxiv.org/abs/2507.19427 | Step-3 is Large yet Affordable (AFD) | 2025-07-25 |
| https://developer.nvidia.com/blog/inside-nvidia-groq-3-lpx-the-low-latency-inference-accelerator-for-the-nvidia-vera-rubin-platform/ | Inside NVIDIA Groq 3 LPX | 2026-03-16 |
| https://developer.nvidia.com/blog/how-nvidia-groq-3-lpx-unlocks-ultrafast-interactivity-at-long-context-on-nvidia-vera-rubin/ | Groq 3 LPX on Vera Rubin (PD/AFD/spec modes) | 2026-08-24 |
| https://tomshardware.com/pc-components/gpus/nvidia-removes-rubin-cpx-accelerators-from-its-roadmap-groq-3-lpus-take-center-stage-as-cpx-is-removed | Nvidia removes Rubin CPX from roadmap (secondary) | 2026-03 |
| https://www.nvidia.com/en-us/data-center/hgx/ | HGX spec table (B200, B300, Rubin NVL8) | accessed 2026-10-03 |
| https://www.nvidia.com/en-us/data-center/gb300-nvl72/ | GB300 NVL72 specs | accessed 2026-10-03 |
| https://www.tomshardware.com/pc-components/gpus/nvidia-launches-vera-rubin-nvl72-ai-supercomputer-at-ces-promises-up-to-5x-greater-inference-performance-and-10x-lower-cost-per-token-than-blackwell-coming-2h-2026 | Vera Rubin NVL72 at CES (secondary) | 2026-01 |
| https://docs.cloud.google.com/tpu/docs/tpu7x | TPU7x (Ironwood) | living doc |
| https://aws.amazon.com/ai/machine-learning/trainium/ | AWS Trainium (Trainium3 specs) | accessed 2026-10-03 |
| https://blogs.microsoft.com/blog/2026/01/26/maia-200-the-ai-accelerator-built-for-inference/ | Maia 200 | 2026-01-26 |
| https://www.theregister.com/2026/01/15/openai_cerebras_ai/ | OpenAI–Cerebras deal (secondary) | 2026-01-15 |
| https://www.techloy.com/everything-amd-announced-at-ces-2026-helios-racks-mi455x-gpus-and-ryzen-ai-400-chips/ | AMD Helios / MI455X at CES (secondary) | 2026-01 |
| https://hazyresearch.stanford.edu/blog/2025-05-27-no-bubbles | Look Ma, No Bubbles! (megakernel) | 2025-05-27 |
| https://github.com/deepseek-ai/DeepGEMM | DeepGEMM (Mega MoE news) | 2026-04-16 / 2026-09-30 |
| https://github.com/deepseek-ai/DeepEP | DeepEP V2/V2.5 | accessed 2026-10-03 |
| https://github.com/Dao-AILab/flash-attention | FlashAttention-4 (CuTe DSL) | fa4 beta33 2026-09-30 |
| https://arxiv.org/abs/2503.01840 | EAGLE-3 | 2025-03-03 |
| https://arxiv.org/abs/2411.04975 | SuffixDecoding | 2024-11 (v3 2025-10) |
| https://arxiv.org/abs/2602.06036 | DFlash: Block Diffusion for Flash Speculative Decoding | 2026-02-05 |
| https://arxiv.org/abs/2511.02230 | Continuum: KV Cache Time-to-Live for agents | 2025-11-04 |
| https://arxiv.org/abs/2608.00101 | Agentic Coding in the Wild: GitHub Copilot traces | 2026-07-30 |
| https://arxiv.org/abs/2608.14376 | CoRun: deterministic inference via padding | 2026-08 |
| https://arxiv.org/abs/2511.17826 | Deterministic inference across TP sizes | 2025-11 |
| https://github.com/MoonshotAI/checkpoint-engine | checkpoint-engine (1T weight update ~20 s) | 2025-09 |
| https://www.usenix.org/conference/osdi26/technical-sessions | OSDI '26 program | 2026-07 |
| https://mlcommons.org/2026/09/mlperf-inference-v6-1-results/ | MLPerf Inference v6.1 | 2026-09-16 |
| https://github.com/SemiAnalysisAI/InferenceX | InferenceX (formerly InferenceMAX), AgentX | accessed 2026-10-03 |
| https://blog.cloudflare.com/cloudflares-most-efficient-ai-inference-engine/ | Infire (Rust) | 2025-08-27 |
| https://platform.claude.com/docs/en/build-with-claude/prompt-caching | Prompt caching pricing multipliers | living doc |
| https://api-docs.deepseek.com/quick_start/pricing | DeepSeek API pricing (hit/miss, peak/off-peak) | accessed 2026-10-03 |
| https://venturebeat.com/ai/deepseeks-new-v3-2-exp-model-cuts-api-pricing-in-half-to-less-than-3-cents | DeepSeek V3.2-Exp price cut (secondary) | 2025-09 |
| https://getdeploying.com/reference/cloud-gpu/nvidia-h100 | H100 cloud price comparison | updated 2026-10-04 |
| https://getdeploying.com/reference/cloud-gpu/nvidia-b200 | B200 cloud price comparison | accessed 2026-10-03 |

---

## Verification log

Adversarial fact-check, 2026-10-03. Primary sources were pulled with `gh api` (release notes, PRs, issues, repo languages), arXiv abstract and HTML pages, and vendor spec pages read as raw HTML, footnotes included. Verdicts: confirmed / corrected / unverified / refuted.

| Claim | Verdict | Evidence URL |
|---|---|---|
| Dynamo v1.5.0 (2026-09-21): KVBM deprecated, removal targeted for v1.6.0, migrate to engine-native offload; Go EPP removed and Rust EPP default; AIConfigurator becomes AISimulate | confirmed | https://github.com/ai-dynamo/dynamo/releases/tag/v1.5.0 |
| DeepSeek-V4: CSA+HCA; 27% of FLOPs and 10% of KV vs V3.2 at 1M; FP4 routed experts; FP8 KV with BF16 RoPE; batch-invariant kernels; Pro 1.6T/49B, Flash 284B/13B; EP overlap 1.50–1.73×; ≈2% of BF16 GQA8 KV | confirmed ("in production" is unverified) | https://arxiv.org/abs/2606.19348 |
| vLLM Rust frontend RFC: 837 vs 162 req/s (preprocess-hot, asc=4); P50 TTFT 50.51 vs 165.95 ms (decode); Qwen3-0.6B, DP=4, 4×GB200, vLLM 0.19.0, concurrency 1024 | confirmed | https://github.com/vllm-project/vllm/issues/40846 |
| Rust frontend staging repo archived; integration PR #40848 merged 2026-05-21 | confirmed | https://github.com/Inferact/vllm-frontend-rs ; https://github.com/vllm-project/vllm/pull/40848 |
| SGLang Rust TreeCore default, merged 2026-09-29, with SLRU/T-LRU and SWA/Mamba write-back ported | confirmed | https://github.com/sgl-project/sglang/pull/39627 |
| Groq 3 LPX: 256 LPUs, 500 MB SRAM and 150 TB/s each, 128 GB and 40 PB/s per rack, 315 PF FP8; LPX runs FFN/MoE and drafts while Rubin runs attention and KV; Dynamo orchestrates AFD | confirmed | https://developer.nvidia.com/blog/inside-nvidia-groq-3-lpx-the-low-latency-inference-accelerator-for-the-nvidia-vera-rubin-platform/ |
| NVIDIA removed Rubin CPX from its roadmap | corrected (absent from GTC slides; Tom's Hardware infers, says "remains to be seen"; no NVIDIA statement) | https://www.tomshardware.com/pc-components/gpus/nvidia-removes-rubin-cpx-accelerators-from-its-roadmap-groq-3-lpus-take-center-stage-as-cpx-is-removed |
| Step-3 4,039 vs 2,324 tok/s/GPU at a 50 ms TPOT SLA | confirmed, boundary added (FP8, 4K context, no MTP, "up to") | https://arxiv.org/abs/2507.19427 |
| MegaScale-Infer up to 1.90× per-GPU throughput; "v2 2025-07" | confirmed number; version corrected (the July revision is v4, 2025-07-26) | https://arxiv.org/abs/2504.02263 |
| Thinking Machines: 80 → 1 unique in 1000 completions (Qwen3-235B-A22B); 26 → 55 → 42 s (Qwen3-8B) | confirmed | https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/ |
| SGLang deterministic mode 34.35% average slowdown (Qwen3-8B, H200, radix cache off) | confirmed | https://lmsys.org/blog/2025-09-22-sglang-deterministic/ |
| HGX B200 1.4 TB total, ≈180 GB/GPU | confirmed (DGX B200 lists 1,440 GB and 64 TB/s); "192 GB is raw stack" unverified | https://www.nvidia.com/en-us/data-center/dgx-b200/ |
| HGX Rubin NVL8: 2 TB HBM4, 130 TB/s, 32 PF dense FP16, 130 PF FP8 dense, 400 PF sparse NVFP4, 3.6 TB/s NVLink/GPU | confirmed, but the same page lists the Rubin GPU at 288 GB / 22 TB/s, so "official implies 16 TB/s vs press 22" is corrected | https://www.nvidia.com/en-us/data-center/hgx/ |
| GB300 NVL72 "1,080 PF sparse FP4" | corrected (1,440 sparse / 1,080 dense) | https://www.nvidia.com/en-us/data-center/gb300-nvl72/ |
| Kimi Linear: up to 75% less KV, up to 6× decode at 1M | confirmed | https://arxiv.org/abs/2510.26692 |
| Copilot traces: 3.2M users, 761M calls, 90% within-turn vs 55% cross-turn hit (arXiv preprint, Microsoft authors, no dataset release stated) | confirmed | https://arxiv.org/abs/2608.00101 |
| NIXL C++ 3.63 MB vs Rust 0.24 MB; name is "NVIDIA Inference Xfer Library" | confirmed | https://api.github.com/repos/ai-dynamo/nixl/languages |
| Dynamo Rust 27.6 MB vs Python 17.9 MB | confirmed | https://api.github.com/repos/ai-dynamo/dynamo/languages |
| InferenceX (formerly InferenceMAX): v1 2025-10, v2 2026-02, AgentX 2026-08; covers Vera Rubin NVL72, GB300, B300, MI355X, TPU7x; Apache-2.0; public Actions runs | confirmed (Rubin NVL8 and MI455 listed as "coming soon") | https://github.com/SemiAnalysisAI/InferenceX |
| H100 median $3.39 (cheapest $1.30, 57 providers); B200 median $6.25, +17% YoY | confirmed (H100 also +12% YoY; added) | https://getdeploying.com/reference/cloud-gpu/nvidia-h100 ; https://getdeploying.com/reference/cloud-gpu/nvidia-b200 |
| DeepSeek V4-Pro: hit $0.044, miss $1.32, output $3.96 at peak; off-peak half; flash ratio 50× | confirmed (model is V4-Pro-0813; peak 01–04 and 06–10 UTC on weekdays) | https://api-docs.deepseek.com/quick_start/pricing |
| Anthropic cache: writes 1.25× (5 min) / 2× (1 h), reads 0.1× | corrected (0.1× is standard; Opus 5.5 0.05×, Fable/Mythos 5.1 0.025×) | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| vLLM v0.29: MRV2 default, MRV1 removal targeted for v0.32, `sharded_rdt`, Mamba prefix caching 9–25% TTFT, per-request spec-decode metrics | confirmed | https://github.com/vllm-project/vllm/releases/tag/v0.29.0 |
| vLLM v0.30: HiSparse, Fast Start, Gumbel watermarking, CuTeDSL NVFP4 W4A16 default on SM100/103 | confirmed | https://github.com/vllm-project/vllm/releases/tag/v0.30.0 |
| vLLM v0.28: disk offload, out-of-tree tier managers, DSpark confidence-scheduled verification, MRV2 E/P/D | confirmed | https://github.com/vllm-project/vllm/releases/tag/v0.28.0 |
| SGLang v0.5.20: simulator (TTFT ~6%, up to 10%; reuse 0.05 pp), SWA hit 43.8 → 60.8% on DSV4-Flash, `return_sampling_mask` | confirmed | https://github.com/sgl-project/sglang/releases/tag/v0.5.20 |
| SGLang v0.5.21: PD runtime role switching, GLM-5.3-Flash on MI355X, DiffusionGemma | confirmed | https://github.com/sgl-project/sglang/releases/tag/v0.5.21 |
| llm-d v0.10.0: fs-connector deprecated for vLLM OffloadingConnector; CUDA image deprecated for vllm/vllm-openai; WVA renamed llm-d-autoscaling | confirmed | https://github.com/llm-d/llm-d/releases/tag/v0.10.0 |
| TGI archived, maintenance mode, recommends vLLM/SGLang | confirmed (last push 2026-03-21) | https://github.com/huggingface/text-generation-inference |
| vLLM hybrid KV: equal page size; prefix hits "intersect" | corrected (constrained two-step search: full-attention hit, then SWA hit within it) | https://docs.vllm.ai/en/latest/design/hybrid_kv_cache_manager/ |
| MiniMax M2 quote | corrected (exact wording); substance confirmed | https://www.minimax.io/news/why-did-m2-end-up-as-a-full-attention-model |
| Kimi K3: 2.8T/104B, 16 of 896 experts, KDA + gated MLA, MXFP4 QAT, 1M | confirmed (69 KDA + 24 gated MLA ≈ 2.9:1; also AttnRes and MXFP8 activations) | https://huggingface.co/moonshotai/Kimi-K3 |
| gpt-oss-120b: 117B/5.1B active, MXFP4 MoE, single 80 GB GPU | confirmed | https://huggingface.co/openai/gpt-oss-120b |
| Qwen3.5-0.8B layout 6×(3×GDN→FFN, 1×Attn→FFN); transformers.js WebGPU | confirmed | https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX |
| Hazy megakernel: ~100 kernels → 1; <1 ms H100 (≈2.5× vLLM); <680 µs B200; 78% bandwidth | confirmed (Llama-3.2-1B, batch 1) | https://hazyresearch.stanford.edu/blog/2025-05-27-no-bubbles |
| Infire 17,224 tok/s at 25% CPU vs vLLM 0.10.0 at 16,164 and 140% (H100 NVL) | confirmed | https://blog.cloudflare.com/cloudflares-most-efficient-ai-inference-engine/ |
| DFlash >6×, up to 2.5× over EAGLE-3, ICML 2026 | confirmed | https://arxiv.org/abs/2602.06036 |
| EAGLE-3 up to 6.5×, 1.38× in SGLang at batch 64 | confirmed | https://arxiv.org/abs/2503.01840 |
| SuffixDecoding up to 5.3×, 2.8× over EAGLE-2/3, NeurIPS'25 spotlight | confirmed | https://arxiv.org/abs/2411.04975 |
| Continuum >8× average JCT | confirmed | https://arxiv.org/abs/2511.02230 |
| CoRun 15–324% throughput over batch-invariant approaches | confirmed | https://arxiv.org/abs/2608.14376 |
| Stateful inference 2.1×–4.2× per turn | confirmed | https://arxiv.org/abs/2605.26289 |
| LLM-42 / TP-size invariance / cross-precision divergence papers exist | confirmed (2609.26621 is TMLR-accepted) | https://arxiv.org/abs/2601.17768 ; https://arxiv.org/abs/2511.17826 ; https://arxiv.org/abs/2609.26621 |
| Vera Rubin + LPX modes (PD, AFD, external drafter); 3,431 tok/s/user, Gemma 4 31B at 100K | confirmed (attributed to Artificial Analysis) | https://developer.nvidia.com/blog/how-nvidia-groq-3-lpx-unlocks-ultrafast-interactivity-at-long-context-on-nvidia-vera-rubin/ |
| Dynamo 1.0 GA at GTC 2026-03-16 | corrected (GitHub v1.0.0 tagged 2026-03-13) | https://github.com/ai-dynamo/dynamo/releases/tag/v1.0.0 |
| TPU7x 192 GiB, 7.38 TB/s, 2,307 BF16 / 4,614 FP8 TFLOPs, 9,216-chip pods | confirmed (GA date still from secondary source) | https://docs.cloud.google.com/tpu/docs/tpu7x |
| Maia 200: 216 GB HBM3e at 7 TB/s, 272 MB SRAM, >10 PF FP4, 750 W, 30% perf/$ | confirmed | https://blogs.microsoft.com/blog/2026/01/26/maia-200-the-ai-accelerator-built-for-inference/ |
| Trainium3 144 GB at 4.9 TB/s, 144-chip UltraServer | confirmed | https://aws.amazon.com/ai/machine-learning/trainium/ |
| OpenAI–Cerebras 750 MW through 2028, >$10B | confirmed as reported (The Register, anonymous sources) | https://www.theregister.com/2026/01/15/openai_cerebras_ai/ |
| NVIDIA–Groq non-exclusive license 2025-12-24; Groq leadership joins NVIDIA | confirmed ($20B figure not in the primary source; secondary only) | https://groq.com/newsroom/groq-and-nvidia-enter-non-exclusive-inference-technology-licensing-agreement-to-accelerate-ai-inference-at-global-scale |
| MLPerf v6.1: E2E RAG, edge agentic, spec decode; DeepSeek-R1 5.7× vs v5.1 | confirmed (spec decode only in the interactive scenario for two benchmarks plus GPT-OSS) | https://mlcommons.org/2026/09/mlperf-inference-v6-1-results/ |
| SGLang GB300 "up to 25× vs H200" | confirmed (DeepSeek-R1 at 50 tok/s/user) | https://www.lmsys.org/blog/2026-02-20-gb300-inferencex/ |
| OSDI '26 papers (Strata, ECHO, zero-copy offload, Weave, StriaTrace, RLinf, Multiplication scheduling) | confirmed (conference 2026-07-13 to 07-15) | https://www.usenix.org/conference/osdi26/technical-sessions |
| InferencePool v1 stable; EPP scores KV utilization, queue length, LoRA | confirmed | https://gateway-api-inference-extension.sigs.k8s.io/api-types/inferencepool/ |
| DeepGEMM Mega MoE (2026-04-16); DeepEP V2 NCCL Gin, V2.5 | confirmed | https://github.com/deepseek-ai/DeepGEMM ; https://github.com/deepseek-ai/DeepEP |
| FA4 beta33 2026-09-30; SMG v1.11.0 2026-09-24 (Rust); mistral.rs v0.9.4; cudarc v0.19.10 | confirmed | https://github.com/Dao-AILab/flash-attention/releases ; https://github.com/lightseekorg/smg ; https://github.com/EricLBuehler/mistral.rs ; https://github.com/chelsea0x3b/cudarc |
| checkpoint-engine: 1T model update in ~20 s | confirmed | https://github.com/MoonshotAI/checkpoint-engine |
| Repo citations in §2.8 (unit-economics.ts:20, fp4-blackwell.ts:16/:34, epd-disaggregation.ts:10/:26, rust-zig-c-decision.ts:19, KVBM in five lesson files) | confirmed (also `src/lib/fleet-week.ts:270` has "192 GB HBM3e"; the dossier missed it) | local repo grep |
| Helios/MI455X 432 GB HBM4 | unverified (secondary only, as the author noted) | https://www.techloy.com/everything-amd-announced-at-ces-2026-helios-racks-mi455x-gpus-and-ryzen-ai-400-chips/ |

## Gaps the author missed

1. **NVIDIA's own Rubin numbers disagree with each other.** The HGX page's per-GPU table lists 288 GB HBM4 and 22 TB/s, but the NVL8 system rows imply about 250 GB and 16 TB/s per GPU. The hardware atlas (idea 4) needs a per-row `source_row` field and a "discrepancy" flag, not just one URL per SKU. This is also a good worked example for the roofline lesson. Source: https://www.nvidia.com/en-us/data-center/hgx/
2. **Rental prices rose for older GPUs too, not only B200.** The H100 median is about 12% above a year ago (flat over 90 days). That strengthens F18 and the t7.l4 rewrite: "prices only fall" is false for both generations. Source: https://getdeploying.com/reference/cloud-gpu/nvidia-h100
3. **The MiniMax story continued: M3 moved to a sparse indexer, not linear attention.** vLLM v0.30 and SGLang v0.5.20 ship MiniMax-M3 indexer and top-k work, with top-k shared across layers. The "attention zoo" should show the path full → sparse-indexed (DSA-like) as the alternative to linear hybrids. Sources: https://github.com/vllm-project/vllm/releases/tag/v0.30.0 ; https://github.com/sgl-project/sglang/releases/tag/v0.5.20
4. **Kimi K3's architecture goes beyond "KDA + MLA".** It is 69 KDA + 24 gated MLA layers (≈2.9:1), Attention Residuals (AttnRes), Stable LatentMoE, and MXFP4 weights with MXFP8 activations under QAT. vLLM v0.30 already defaults to native CUDA AttnRes on SM100. AttnRes is a new residual-path change with serving-kernel consequences that the zoo calculator and t6.l1 table should note. Source: https://huggingface.co/moonshotai/Kimi-K3
5. **The price of determinism is falling, and the papers disagree on its size.** vLLM v0.29 added per-arch tuned batch-invariant matmuls (about 3× decode kernels on 4090D/H20), Blackwell autotuning (−33.6% E2E latency), deterministic MoE combine under DP+EP, and `trace_decode_token_ids` decode replay. CoRun reports batch-invariant kernels costing more than 2× latency and up to 74% throughput. The determinism lab should present the overhead as a moving, contested number (34% / 61.5% / 2× / 74%), not as one figure. Sources: https://github.com/vllm-project/vllm/releases/tag/v0.29.0 ; https://arxiv.org/abs/2608.14376
6. **Cross-precision divergence is large and peer-reviewed.** 49–100% of prompts diverge between BF16 and FP16 greedy decoding on the same hardware, driven by the top-2 logit margin (TMLR 2026). This is a stronger, cheaper lab hook than batch invariance alone, and it supports the "Determinism oversell" anti-pattern with numbers. Source: https://arxiv.org/abs/2609.26621
7. **Version skew between orchestration and engines.** Dynamo v1.5.0 (2026-09-21) pins vLLM v0.28.0, SGLang v0.5.18 and TRT-LLM 1.3.0rc25, while upstream is at vLLM v0.30.0 and SGLang v0.5.21. The same release also adds TLS/mTLS on TCP and NATS and KV indexing for Mooncake and disk tiers. Lessons that say "Dynamo supports feature X of vLLM" must name both versions. Source: https://github.com/ai-dynamo/dynamo/releases/tag/v1.5.0
8. **Benchmark boundary conditions matter for the "shipping" inference.** InferenceX lists Vera Rubin NVL72 as supported, but Rubin NVL8 and MI455 UALoE72 as "coming soon". MLPerf v6.1 allows spec decode only in the interactive scenario of two benchmarks plus GPT-OSS. The course should not generalize "Rubin is shipping" to every SKU, or "MLPerf allows spec decode" to every scenario. Sources: https://github.com/SemiAnalysisAI/InferenceX ; https://mlcommons.org/2026/09/mlperf-inference-v6-1-results/
