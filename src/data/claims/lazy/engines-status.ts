import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the engine status claims (t5 lane: TensorRT-LLM, SGLang hardware, llm-d and vLLM speculative decoding). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const ENGINES_STATUS_CLAIMS: Claim[] = [
  {
    id: 'status.vllm.speculative-methods',
    kind: 'status',
    value: 'EAGLE, MTP, draft, n-gram, suffix',
    label: 'vLLM spec-decode methods',
    source: {
      url: 'https://raw.githubusercontent.com/vllm-project/vllm/v0.34.0/docs/features/speculative_decoding/README.md',
      title: 'vLLM v0.34.0 docs: Speculative Decoding',
      quote:
        'Model-based methods such as EAGLE, MTP and draft models provide the best latency reduction, while simpler methods such as n-gram and suffix decoding provide modest speedups without increasing workload during peak traffic.',
      row: 'docs/features/speculative_decoding/README.md, line 9',
    },
    pin: { repo: 'vllm-project/vllm', ref: 'v0.34.0' },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary:
      'The page also lists LiLiCorr, hidden-state extraction, custom speculators and the dflash and dspark drafters (its `method` row names draft_model, ngram, suffix, mtp, eagle3 and dflash as common values); the claim names the methods the lesson teaches. Medusa and the MLP speculator were removed in the v0.33.0 series (release notes of v0.33.0rc3, published 2026-11-02: "Medusa and the MLP speculator were removed (#61701)"). The same page says the standard rejection sampler is "theoretically lossless up to the precision limits of hardware numerics" and that FLy "deliberately relaxes verification and is not distribution preserving".',
  },
  {
    id: 'status.trtllm.enable-chunked-prefill-default',
    kind: 'status',
    value: 'False',
    label: 'TensorRT-LLM chunked prefill default',
    source: {
      url: 'https://raw.githubusercontent.com/NVIDIA/TensorRT-LLM/v1.4.0rc4/tensorrt_llm/llmapi/llm_args.py',
      title: 'TensorRT-LLM v1.4.0rc4 LLM API arguments',
      quote: 'enable_chunked_prefill: bool = Field(default=False, description="Enable chunked prefill.")',
      row: 'tensorrt_llm/llmapi/llm_args.py, lines 7021-7022 (the call is wrapped over two lines)',
    },
    pin: { repo: 'NVIDIA/TensorRT-LLM', ref: 'v1.4.0rc4' },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary:
      'This is the default of the LLM API argument, not a statement about the executor: the file says nothing about whether the executor co-schedules an unchunked prefill with running decodes, so the lesson does not claim it either way. v1.4.0rc4 is a release candidate; v1.3.0rc29 carries the same default.',
  },
  {
    id: 'status.trtllm.pytorch-sole-backend',
    kind: 'status',
    value: 'PyTorch only; TensorRT backend removed',
    label: 'TensorRT-LLM backends',
    source: {
      url: 'https://raw.githubusercontent.com/NVIDIA/TensorRT-LLM/v1.4.0rc4/docs/source/legacy/tensorrt-backend-removal.md',
      title: 'TensorRT LLM v1.4.0rc4 docs: Migration Guide: TensorRT Backend Removed',
      quote: 'The TensorRT engine backend has been removed. PyTorch is now the sole execution backend for TensorRT LLM.',
      row: 'docs/source/legacy/tensorrt-backend-removal.md, lines 4-5 (the sentence wraps)',
    },
    pin: { repo: 'NVIDIA/TensorRT-LLM', ref: 'v1.4.0rc4' },
    verifiedAt: '2026-11-23',
    ttlDays: 60,
    boundary:
      'The guide does not name the release that removed the backend. tensorrt_llm/llmapi/llm_args.py at v1.4.0rc4 declares `backend: Literal["pytorch"]` (marked deprecated, with a TODO to remove the field) in TorchLlmArgs, and the guide lists `LLM(backend="tensorrt")` as raising ValueError, `trtllm-build` as gone and the `tensorrt` pip dependency as dropped. v1.4.0rc4 is a release candidate. The release notes of v1.3.0rc28 list "Remove deprecated TensorRT serve, evaluation, benchmark, and stress paths (BREAKING)" (https://github.com/NVIDIA/TensorRT-LLM/releases/tag/v1.3.0rc28), which is how far back the lesson dates the removal; the notes do not say "the TensorRT backend is removed" in those words.',
  },
  {
    id: 'status.trtllm.dynamo-pin',
    kind: 'status',
    value: 'TRT-LLM v1.3.0rc29',
    label: 'TRT-LLM in Dynamo',
    source: {
      url: 'https://github.com/ai-dynamo/dynamo/releases/tag/v1.6.0',
      title: 'NVIDIA Dynamo v1.6.0 release notes',
      quote: 'the engines move to SGLang v0.5.21, TensorRT-LLM v1.3.0rc29, and vLLM v0.31.0',
      row: 'release notes, opening summary',
    },
    pin: { repo: 'ai-dynamo/dynamo', ref: 'v1.6.0' },
    verifiedAt: '2026-11-23',
    ttlDays: 60,
    boundary:
      'This is the version the v1.6.0 notes name for Dynamo\'s TensorRT-LLM engine; it is a release candidate by its tag. Dynamo v1.6.2 is newer and its README was read for other facts, but the pins above are what v1.6.0 says; v1.6.1 and v1.6.2 notes were not read for engine pins.',
  },
  {
    id: 'status.sglang.hardware',
    kind: 'status',
    value: 'NVIDIA, AMD, TPU, Intel, Apple, Ascend, Moore Threads',
    label: 'SGLang hardware',
    source: {
      url: 'https://raw.githubusercontent.com/sgl-project/sglang/v0.5.23/README.md',
      title: 'SGLang v0.5.23 README: Supported Hardware',
      quote: 'SGLang supports a wide range of GPUs, TPUs, NPUs, CPUs, and Apple Silicon platforms.',
      row: 'README.md, line 51; the table at lines 53-61 lists NVIDIA, AMD (Instinct MI300X to MI355X), Google TPU (v6e, v7), Intel (Arc / Arc Pro B-Series GPUs, Xeon CPUs), Apple Silicon, Huawei Ascend and Moore Threads',
    },
    pin: { repo: 'sgl-project/sglang', ref: 'v0.5.23' },
    verifiedAt: '2026-11-23',
    ttlDays: 60,
    boundary:
      'The README opens "SGLang is an open-source inference framework for large language, vision-language, and diffusion models, optimized for agentic workloads, large-scale serving, and RL rollouts." (line 21) and does not use the words "frontend language" or "structured". The radix-tree core is Rust by default: the v0.5.21 release notes say "The prefix cache now runs on a Rust core by default (#39627)" and python/sglang/srt/environ.py at v0.5.23 line 741 reads `SGLANG_UNIFIED_RADIX_TREE_CORE_BACKEND = EnvStr("rust")`. The README does not say the scheduler is Rust. Which of these platforms a given model runs on is per-model; the README table is a platform list, not a model matrix.',
  },
  {
    id: 'status.llm-d.founders',
    kind: 'status',
    value: 'CNCF sandbox; founded by Red Hat, Google Cloud, IBM Research, CoreWeave, NVIDIA',
    label: 'llm-d founders',
    source: {
      url: 'https://raw.githubusercontent.com/llm-d/llm-d/v1.0.0/README.md',
      title: 'llm-d v1.0.0 README',
      quote:
        'llm-d is a [Cloud Native Computing Foundation (CNCF)](https://www.cncf.io/) sandbox project, founded by Red Hat, Google Cloud, IBM Research, CoreWeave, and NVIDIA.',
      row: 'README.md, line 20; line 57 (news list, "[2026-03]") links the CNCF post dated 2026/03/24',
    },
    pin: { repo: 'llm-d/llm-d', ref: 'v1.0.0' },
    verifiedAt: '2026-11-23',
    ttlDays: 60,
    boundary:
      'The README says nothing about a founder having left or joined later. llm-d v1.0.0 was published 2026-10-20 (its releases page, marked Latest the day it was read) and its notes name DisaggregatedSet ("manages prefill/decode replicas as one logical unit") and a v1 router configuration API. The CNCF acceptance date is only as the README\'s news link gives it (a blog post dated 2026-03-24); the CNCF page itself was not read.',
  },
]

registerClaims(ENGINES_STATUS_CLAIMS)
