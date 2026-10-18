import { registerClaims } from '../registry'
import { SGLANG_PIN, VLLM_PIN } from '../engines'
import type { Claim } from '../schema'

/**
 * Wave 3's serving claims (spec wave-3 §4.4, 3a-08): the prefill/decode disaggregation flags of the two engines
 * (the P:D split rows of the Fleet exercises, §5.3) and one benchmark line for a comparison in `sync-seconds`'
 * solution. The engine claims are pinned to the releases the other In-production claims use (engines.ts). Quotes
 * were copied from the files and pages at those refs on 2026-10-14, with whitespace collapsed to one space.
 * t6.l12's statline (spec §16.2, 3s-03) adds three benchmark lines from the two attention-FFN disaggregation papers.
 * Each url names the arXiv version it was read at (Step-3 v1, MegaScale-Infer v4), so the quote stays re-readable at
 * the same bytes; a paper is no repository, so they carry no `pin`. The quotes are the abstracts' own sentences.
 */
const VLLM_KV_TRANSFER = {
  url: `https://raw.githubusercontent.com/${VLLM_PIN.repo}/${VLLM_PIN.ref}/vllm/config/kv_transfer.py`,
  title: 'vLLM v0.31.0 source: vllm/config/kv_transfer.py (KVTransferConfig)',
}
const SGLANG_DISAGG = {
  url: `https://raw.githubusercontent.com/${SGLANG_PIN.repo}/${SGLANG_PIN.ref}/python/sglang/srt/arg_groups/fields/disagg.py`,
  title: 'SGLang v0.5.21 source: srt/arg_groups/fields/disagg.py (Disagg fields)',
}
/** checkpoint-engine's README at its v0.4.2 tag, the latest release on 2026-10-14 (the README line is older than the tag). */
const CHECKPOINT_ENGINE = {
  url: 'https://raw.githubusercontent.com/MoonshotAI/checkpoint-engine/v0.4.2/README.md',
  title: 'MoonshotAI/checkpoint-engine v0.4.2 README',
}

/** Step-3 (arXiv 2507.19427v1, 2025-07-25, the only version on 2026-10-14). */
const STEP3_PAPER = {
  url: 'https://arxiv.org/abs/2507.19427v1',
  title: 'Step-3 is Large yet Affordable: Model-system Co-design for Cost-effective Decoding (arXiv 2507.19427v1)',
}
/** MegaScale-Infer (arXiv 2504.02263v4, 2025-07-26, the latest version on 2026-10-14). */
const MEGASCALE_INFER_PAPER = {
  url: 'https://arxiv.org/abs/2504.02263v4',
  title: 'MegaScale-Infer: Serving Mixture-of-Experts at Scale with Disaggregated Expert Parallelism (arXiv 2504.02263v4)',
}
const STEP3_QUOTE =
  "Our implementation on Hopper GPUs achieves a decoding throughput of up to 4,039 tokens per second per GPU under 50ms TPOT SLA (4K context, FP8, no MTP). It is higher than DeepSeek-V3's 2,324 in the same setup"

export const SERVING3_CLAIMS: Claim[] = [
  {
    id: 'production.vllm.disagg',
    kind: 'status',
    value: '--kv-transfer-config, kv_role',
    label: 'vLLM prefill/decode disaggregation setting',
    source: {
      ...VLLM_KV_TRANSFER,
      quote:
        "kv_role: KVRole | None = None \"\"\"Whether this vLLM instance produces, consumes KV cache, or both. Choices are 'kv_producer', 'kv_consumer', and 'kv_both'.\"\"\"",
      row: 'KVTransferConfig.kv_role',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      "kv_role says whether an instance produces KV cache, consumes it, or both: kv_producer, kv_consumer or kv_both. The docstring lists the three choices and does not say which role a prefill or a decode instance takes.",
  },
  {
    id: 'production.sglang.disagg',
    kind: 'status',
    value: '--disaggregation-mode prefill|decode',
    label: 'SGLang prefill/decode disaggregation flag',
    source: {
      ...SGLANG_DISAGG,
      quote:
        'disaggregation_mode: A[ Literal["null", "prefill", "decode"], \'Only used for PD disaggregation. "prefill" for prefill-only server, and "decode" for decode-only server. If not specified, it is not PD disaggregated\', ] = "null"',
      row: 'Disagg.disaggregation_mode',
    },
    pin: SGLANG_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary: 'Off by default ("null"). The transfer backend is a second flag (disaggregation_transfer_backend, default mooncake).',
  },
  {
    id: 'bench.checkpoint-engine.sync',
    kind: 'benchmark',
    value: 20,
    unit: 's',
    label: 'checkpoint-engine: update a 1T-parameter model',
    source: {
      ...CHECKPOINT_ENGINE,
      quote: '(1 Trillion parameters) across thousands of GPUs takes about 20s.',
      row: 'README, first paragraph (Kimi-K2)',
    },
    verifiedAt: '2026-10-14',
    ttlDays: 180,
    boundary:
      "MoonshotAI's own figure for in-place weight update of Kimi-K2. The README gives no byte count, shard count or link bandwidth for it, so it is a cited comparison line and never an input to a calculation.",
  },
  {
    id: 'bench.step3.afd-decode',
    kind: 'benchmark',
    value: 4039,
    unit: 'tok/s per GPU',
    label: 'Step-3 with attention-FFN disaggregation: decode throughput per GPU at a 50 ms TPOT SLA',
    source: { ...STEP3_PAPER, quote: STEP3_QUOTE, row: 'Abstract; Table 8 (2A2F, 32 GPUs)' },
    verifiedAt: '2026-10-14',
    ttlDays: 180,
    boundary:
      "StepFun's own measurement: Hopper GPUs, FP8 GEMMs and FP8 attention, 4,096-token average context, no MTP, 2 attention and 2 FFN instances (32 GPUs). It is the peak minute; the long-term average is 3,910 (§7.3). Not a long-context result: at 8K the paper uses 48 GPUs and reports 2,643.",
  },
  {
    id: 'bench.step3.dsv3-decode',
    kind: 'benchmark',
    value: 2324,
    unit: 'tok/s per GPU',
    label: 'DeepSeek-V3 with expert parallelism, as Step-3 compares it: decode throughput per GPU',
    source: { ...STEP3_PAPER, quote: STEP3_QUOTE, row: 'Abstract; Table 8 (DSv3-profile, 128 GPUs)' },
    verifiedAt: '2026-10-14',
    ttlDays: 180,
    boundary:
      "DeepSeek's published profile (4,096-token context, 128 H800s, 20 tokens/s per user) as the Step-3 paper cites it, not a run StepFun made; DeepSeek's blog reports 1,850 sustained at 4,989 tokens of average context. A comparison line, never an input to a calculation.",
  },
  {
    id: 'bench.megascale-infer.per-gpu',
    kind: 'benchmark',
    value: 1.9,
    unit: '×',
    label: 'MegaScale-Infer: per-GPU decode throughput over the best baseline it measured',
    source: {
      ...MEGASCALE_INFER_PAPER,
      quote: 'Experimental results indicate that MegaScale-Infer achieves up to 1.90x higher per-GPU throughput than state-of-the-art solutions.',
      row: 'Abstract; §7.2 (Scaled-MoE against TensorRT-LLM)',
    },
    verifiedAt: '2026-10-14',
    ttlDays: 180,
    boundary:
      'ByteDance\'s own measurement: the 317B Scaled-MoE on 80 GB Ampere GPUs in BF16, decode only, at a 150 ms time-between-tokens target, against TensorRT-LLM (7.11× against vLLM). Mixtral 8x22B gains 1.28× over TensorRT-LLM. "Up to" is the best of its models.',
  },
]

registerClaims(SERVING3_CLAIMS)
