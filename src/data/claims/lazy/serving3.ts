import { registerClaims } from '../index'
import { SGLANG_PIN, VLLM_PIN } from '../engines'
import type { Claim } from '../schema'

/**
 * Wave 3's serving claims (spec wave-3 §4.4, 3a-08): the prefill/decode disaggregation flags of the two engines
 * (the P:D split rows of the Fleet exercises, §5.3) and one benchmark line for a comparison in `sync-seconds`'
 * solution. The engine claims are pinned to the releases the other In-production claims use (engines.ts). Quotes
 * were copied from the files and pages at those refs on 2026-10-14, with whitespace collapsed to one space.
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
      'A prefill instance runs as kv_producer and a decode instance as kv_consumer, each with a kv_connector, through --kv-transfer-config (a JSON string); the config rejects a connector with no kv_role. There is no single "disaggregated" switch.',
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
]

registerClaims(SERVING3_CLAIMS)
