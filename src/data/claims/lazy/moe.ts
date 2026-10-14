import { registerClaims } from '../registry'
import { SGLANG_PIN, VLLM_PIN } from '../engines'
import { DEEPSEEK_V3_PIN } from '../zoo'
import type { Claim } from '../schema'

/**
 * DeepSeek-V3's expert counts and the EPLB In-production card (spec wave-3 §4.4, 3a-08). The two expert counts are
 * read from the same `config.json` revision as the Attention Zoo's `zoo.deepseek-v3.*` claims (zoo.ts), so the
 * course reads one DeepSeek-V3: the pin is the one zoo.ts declares, imported here, and tests/claims/wave3.test.ts holds the claims' pins and urls equal to the zoo's. The EPLB claims are pinned:
 * DeepSeek's repository has no release, so its pin is the commit that was current on 2026-10-14, and the engines
 * use the releases the other In-production claims use (engines.ts). Quotes were copied from the files at those refs
 * on 2026-10-14, with runs of whitespace collapsed to one space.
 */
const DEEPSEEK_EPLB_PIN = { repo: 'deepseek-ai/EPLB', ref: 'd52c72d5b2f2fb4c41afbf8eb21366820239913d' } as const

const DEEPSEEK_V3_CONFIG = {
  url: `https://huggingface.co/${DEEPSEEK_V3_PIN.repo}/raw/${DEEPSEEK_V3_PIN.ref}/config.json`,
  title: 'DeepSeek-V3 config.json at a pinned revision (DeepSeek, Hugging Face)',
}
const EPLB_SOURCE = {
  url: `https://raw.githubusercontent.com/${DEEPSEEK_EPLB_PIN.repo}/${DEEPSEEK_EPLB_PIN.ref}/eplb.py`,
  title: 'DeepSeek EPLB source at a pinned commit: eplb.py (replicate_experts)',
}
const VLLM_EP_DOCS = {
  url: `https://docs.vllm.ai/en/${VLLM_PIN.ref}/serving/expert_parallel_deployment/`,
  title: 'vLLM v0.31.0 docs: Expert Parallel Deployment (EPLB)',
}
const SGLANG_EXEC = {
  url: `https://raw.githubusercontent.com/${SGLANG_PIN.repo}/${SGLANG_PIN.ref}/python/sglang/srt/arg_groups/fields/exec_.py`,
  title: 'SGLang v0.5.21 source: srt/arg_groups/fields/exec_.py (Exec fields)',
}

export const MOE_CLAIMS: Claim[] = [
  {
    id: 'model.deepseek-v3.routed-experts',
    kind: 'spec',
    value: 256,
    unit: 'experts',
    label: 'DeepSeek-V3 routed experts per MoE layer',
    source: { ...DEEPSEEK_V3_CONFIG, quote: '"n_routed_experts": 256,', row: 'n_routed_experts' },
    pin: DEEPSEEK_V3_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: 'Routed experts only: the config also lists 1 shared expert (n_shared_experts) that every token uses.',
  },
  {
    id: 'model.deepseek-v3.experts-per-token',
    kind: 'spec',
    value: 8,
    unit: 'experts',
    label: 'DeepSeek-V3 routed experts per token',
    source: { ...DEEPSEEK_V3_CONFIG, quote: '"num_experts_per_tok": 8,', row: 'num_experts_per_tok' },
    pin: DEEPSEEK_V3_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: 'The router picks 8 of the 256 routed experts for each token; routing is group-limited (the config lists n_group and topk_group).',
  },
  {
    id: 'production.eplb.rebalance',
    kind: 'status',
    value: 'copy the expert with the most load per copy',
    label: 'DeepSeek EPLB replication rule',
    source: { ...EPLB_SOURCE, quote: 'redundant_indices = (weight / logcnt).max(dim=-1).indices', row: 'replicate_experts' },
    pin: DEEPSEEK_EPLB_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'rebalance_experts adds one replica at a time to the logical expert whose load divided by its replica count is highest. It then packs the replicas onto GPUs heaviest first, each onto the lightest GPU that still has a free slot (balanced_packing), within nodes when the expert-group count divides the node count. The repository publishes no release; the pin is a commit.',
  },
  {
    id: 'production.vllm.eplb',
    kind: 'status',
    value: '--enable-eplb, num_redundant_experts 0',
    label: 'vLLM EPLB flag and redundant experts',
    source: {
      ...VLLM_EP_DOCS,
      quote: `--enable-eplb \\ --eplb-config '{"window_size":1000,"step_interval":3000,"num_redundant_experts":2,"log_balancedness":true}'`,
      row: 'EPLB Parameters > example',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'Off by default. --eplb-config takes a JSON string; the docs table gives num_redundant_experts as "Additional global experts per EP rank beyond equal distribution", default 0, and the example sets 2. EPLB needs expert parallelism (--enable-expert-parallel).',
  },
  {
    id: 'production.sglang.eplb',
    kind: 'status',
    value: '--enable-eplb, --ep-num-redundant-experts 0',
    label: 'SGLang EPLB flag and redundant experts',
    source: {
      ...SGLANG_EXEC,
      quote:
        'ep_num_redundant_experts: A[ int, "Allocate this number of redundant experts in expert parallel." ] = 0 ep_dispatch_algorithm: A[ Optional[Literal["static", "dynamic", "fake", "lp"]], "The algorithm to choose ranks for redundant experts in expert parallel.", ] = None init_expert_location: A[str, "Initial location of EP experts."] = "trivial" enable_eplb: A[bool, "Enable EPLB algorithm"] = False',
      row: 'Exec.ep_num_redundant_experts, Exec.enable_eplb',
    },
    pin: SGLANG_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary: 'Both default off (0 redundant experts, EPLB disabled). The field names are the flags with underscores for hyphens.',
  },
]

registerClaims(MOE_CLAIMS)
