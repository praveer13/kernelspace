import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * The inputs of the Fleet's physics v2 (spec s5 §4.5, S5-03): the dataset claim, the harness's settings, the HGX B200
 * peaks, the Llama-3.3-70B config the benchmark served, and the model byte claims the step card reads. The measured
 * points are in `ix-points.ts` (generated from the extract); the fitted `phys.*` claims and the controls are added by the
 * tasks that produce them (S5-07, S5-08), and `homes.ts` already lists every prefix they use.
 *
 * Every quote was fetched on 2026-10-18 with curl, from the raw file at its pin (or from the vendor page), and is a
 * single line copied from it. The harness and vLLM claims are `status` claims pinned to the commit or tag the benchmark
 * ran at (`pin.ref` is in `source.url`), so a reader can open the same bytes. Adopted by the build on 2026-10-18,
 * unsigned: the owner checks each quote against its source (field gate F1).
 *
 * Not in the registry: nothing here is eager (wave-3 D19), and nothing in the card or the engine calls `claimNumber`.
 */

/** The harness commit the 2025-10-29 sweep ran at (docs/physics/protocol.md, `snapshot.harness`). */
export const INFERENCEX_PIN = { repo: 'SemiAnalysisAI/InferenceX', ref: '9596d23d74e9e1e4f4bcdb27572c87cafb746a02' } as const
/** The vLLM release the benchmark's server image ran (`vllm/vllm-openai:v0.10.2`). */
export const VLLM_0_10_2_PIN = { repo: 'vllm-project/vllm', ref: 'v0.10.2' } as const
/** The Hugging Face revision of the model the harness served on H100 and B200 FP8 (`nvidia/Llama-3.3-70B-Instruct-FP8`); Meta's own repository is gated. */
export const LLAMA33_70B_PIN = { repo: 'nvidia/Llama-3.3-70B-Instruct-FP8', ref: 'fde04ee76a27704c88f569542ef023b57d4d0362' } as const

const IX_RAW = `https://raw.githubusercontent.com/${INFERENCEX_PIN.repo}/${INFERENCEX_PIN.ref}`
const IX_REF = `InferenceX at ${INFERENCEX_PIN.ref.slice(0, 7)}`
const HARNESS_TEMPLATE = { url: `${IX_RAW}/.github/workflows/70b-tmpl.yml`, title: `${IX_REF}: .github/workflows/70b-tmpl.yml (Llama 70B job template)` }
const HARNESS_SWEEP = { url: `${IX_RAW}/.github/workflows/full-sweep-tmpl.yml`, title: `${IX_REF}: .github/workflows/full-sweep-tmpl.yml (full-sweep template)` }
const HARNESS_H100 = { url: `${IX_RAW}/benchmarks/70b_fp8_h100_docker.sh`, title: `${IX_REF}: benchmarks/70b_fp8_h100_docker.sh (vllm serve, H100 FP8)` }
const HARNESS_B200 = { url: `${IX_RAW}/benchmarks/70b_fp8_b200_docker.sh`, title: `${IX_REF}: benchmarks/70b_fp8_b200_docker.sh (vllm serve, B200 FP8)` }
const HARNESS_CLIENT = { url: `${IX_RAW}/runners/launch_h100-cr.sh`, title: `${IX_REF}: runners/launch_h100-cr.sh (benchmark_serving client)` }
const VLLM_CUDA = {
  url: `https://raw.githubusercontent.com/${VLLM_0_10_2_PIN.repo}/${VLLM_0_10_2_PIN.ref}/vllm/platforms/cuda.py`,
  title: 'vLLM v0.10.2 source: vllm/platforms/cuda.py (CudaPlatformBase.check_and_update_config)',
}
const HGX = { url: 'https://www.nvidia.com/en-us/data-center/hgx/', title: 'NVIDIA HGX Platform' }
const LLAMA33_CONFIG = {
  url: `https://huggingface.co/${LLAMA33_70B_PIN.repo}/raw/${LLAMA33_70B_PIN.ref}/config.json`,
  title: 'nvidia/Llama-3.3-70B-Instruct-FP8 config.json at a pinned revision (the checkpoint the InferenceX harness served; NVIDIA, Hugging Face)',
}
const IX_QUERY = {
  url: 'https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true',
  title: 'InferenceX API: Llama-3.3-70B-Instruct-FP8 benchmarks of 2025-10-29 (exact date)',
}

/** sha256 of src/data/physics/points/inferencex-l70-2025-10-29.json; tests/claims/physics.test.ts recomputes it from the file. */
export const EXTRACT_SHA256 = '541121788a076dab9df631321e6c692bf357523177c0f1425bcb11a018b74843'
/** sha256 of the raw API response the extract was cut from (1,026,817 bytes, fetched 2026-10-18). */
export const RAW_SHA256 = 'd2ce48fdbd84936994d68bb28413f0e842da3b01a2c7a0958e4041699dc19792'

const VERIFIED = '2026-10-18'
const STATUS_TTL = 180

const SNAPSHOT_NOTE = 'vLLM 0.10.2 at InferenceX 9596d23, the sweep of 2025-10-29 (read 2026-10-18); the benchmark, not today\'s engine defaults.'

/** One harness setting: a `status` claim pinned to the InferenceX commit. */
function harness(suffix: string, value: number | string, unit: string | undefined, label: string, source: { url: string; title: string; quote: string; row: string }, boundary: string): Claim {
  return {
    id: `status.inferencex.harness.${suffix}`,
    kind: 'status',
    value,
    ...(unit ? { unit } : {}),
    label,
    source,
    pin: INFERENCEX_PIN,
    verifiedAt: VERIFIED,
    ttlDays: STATUS_TTL,
    boundary,
  }
}

export const PHYSICS_CLAIMS: Claim[] = [
  {
    id: 'bench.inferencex.llama70b-2025-10-29',
    kind: 'benchmark',
    value: 165,
    unit: 'rows',
    label: 'InferenceX Llama-3.3-70B sweep of 2025-10-29: the vLLM H100 and B200 rows the physics v2 fit uses',
    source: {
      ...IX_QUERY,
      quote: '"hardware":"b200","framework":"vllm","model":"llama70b","precision":"fp8","spec_method":"none","disagg":false,"is_multinode":false',
      row: 'id 40518 (the response lists one object per run, with its metrics inside)',
    },
    verifiedAt: VERIFIED,
    ttlDays: 180,
    boundary:
      'The pinned query returned 681 rows, 1,026,817 bytes, sha256 ' +
      `${RAW_SHA256}, on 2026-10-18. Selection (docs/physics/protocol.md): framework vllm, no speculative decoding, not disaggregated, one node; H100 and B200; FP8 and FP4 (NVFP4): 165 rows (H100 FP8 45, B200 FP8 60, B200 NVFP4 60). ` +
      'Filters: a row whose requests do not fit the KV cache at 0.9 of memory, or whose median TTFT is 3 s or more (the server preempted), is dropped: ids 40752, 41507, 42070, 42140 and 44119, which leaves 160 (42, 58, 60). ' +
      `The extract the repository commits (src/data/physics/points/inferencex-l70-2025-10-29.json, 285 rows: these 165 plus 60 MI325X and 60 MI355X rows kept as an out-of-sample control) has sha256 ${EXTRACT_SHA256}. ` +
      'Official InferenceX results as published 2025-10-29 (SemiAnalysisAI/InferenceX, Apache-2.0; InferenceX is a trademark of SemiAnalysis), copied unmodified for the selected fields. The fitted model and its predictions are this course\'s own, not InferenceX results. ' +
      'The sweep is dated 2025-10-29 and was read on 2026-10-18; this claim is stale from 2027-04-16 (180 days). It describes vLLM 0.10.2; a refit on a newer sweep is a new physics version, not an edit of this claim. Quotes of this group: adopted by the build on 2026-10-18, unsigned.',
  },

  harness(
    'vllm-version',
    '0.10.2',
    undefined,
    'InferenceX harness: vLLM release the Llama-70B H100 and B200 jobs run',
    { ...HARNESS_TEMPLATE, quote: "image: 'vllm/vllm-openai:v0.10.2'", row: 'jobs.bmk-b200-fp8.with.image' },
    `The H100 FP8 job (bmk-h100-fp8) and the B200 FP4 job (bmk-b200-fp4) name the same image. ${SNAPSHOT_NOTE} The response rows carry "image":null, so the release is known from the harness commit, not from the data.`,
  ),
  harness(
    'batch-tokens',
    8192,
    'tokens',
    'InferenceX harness: vLLM max-num-batched-tokens (the per-step token budget)',
    { ...HARNESS_B200, quote: 'max-num-batched-tokens: 8192', row: 'config.yaml written by the launch script' },
    `The H100 FP8 script writes the same line, and the B200 FP4 script too. This is the benchmark's budget, not vLLM's default for a 180 GB GPU (the In-production claims quote today's defaults). ${SNAPSHOT_NOTE}`,
  ),
  harness(
    'range-ratio',
    0.8,
    'ratio',
    'InferenceX harness: random-range-ratio of the prompt and output lengths',
    { ...HARNESS_SWEEP, quote: 'random-range-ratio: 0.8', row: 'jobs._70b-1k1k.with.random-range-ratio (_70b-8k1k and _70b-1k8k are the same)' },
    `The client (kimbochen/bench_serving, which the runners clone unpinned; its sample_uniform read on 2026-10-18) draws each request's input and output length uniformly between this ratio and 1 times the nominal length (1,024 or 8,192), so a "1k/1k" row averages about 0.9 of 1,024 tokens each way. The 70b template passes the value on to the benchmark. ${SNAPSHOT_NOTE}`,
  ),
  harness(
    'prompts-per-conc',
    10,
    'prompts per user',
    'InferenceX harness: prompts sent per unit of concurrency',
    { ...HARNESS_CLIENT, quote: '--num-prompts=$(( $CONC * 10 )) --max-concurrency=$CONC', row: 'benchmark_serving.py arguments' },
    `The B200 launchers that run the Llama jobs (launch_b200-tg.sh, launch_b200-nvd.sh) pass the same product for Llama (launch_b200-nvd.sh uses 20 and 50 for DeepSeek-R1 only). The client sends --request-rate=inf with --ignore-eos, so every request runs to its sampled output length. ${SNAPSHOT_NOTE}`,
  ),
  harness(
    'gpu-mem-util',
    0.9,
    'fraction',
    'InferenceX harness: vLLM gpu-memory-utilization',
    { ...HARNESS_H100, quote: '--gpu-memory-utilization=0.9', row: 'vllm serve arguments' },
    `The B200 FP8 script writes the same value. It sets the KV room: 0.9 of the GPU's memory times the TP, minus the weights. ${SNAPSHOT_NOTE}`,
  ),
  harness(
    'prefix-caching',
    'off',
    undefined,
    'InferenceX harness: automatic prefix caching',
    { ...HARNESS_H100, quote: 'no-enable-prefix-caching: true', row: 'config.yaml written by the launch script' },
    `The B200 scripts write the same line, so no request reuses another's KV. ${SNAPSHOT_NOTE}`,
  ),
  harness(
    'kv-dtype',
    'fp8',
    undefined,
    'InferenceX harness: KV cache dtype',
    { ...HARNESS_H100, quote: 'kv-cache-dtype: fp8', row: 'config.yaml written by the launch script' },
    `One byte per K or V element, whatever the weight precision (H100 and B200 FP8, B200 FP4 all write it). ${SNAPSHOT_NOTE}`,
  ),
  harness(
    'max-num-seqs',
    '= concurrency (H100); 512 (B200)',
    undefined,
    'InferenceX harness: vLLM max-num-seqs',
    { ...HARNESS_H100, quote: '--max-num-seqs=$CONC', row: 'vllm serve arguments' },
    `The H100 script sets it to the run's concurrency; the B200 FP8 script passes 512 (--max-num-seqs=512) and the B200 FP4 script the same (--max-num-seqs 512, with a space). With the client holding at most the run's concurrency (64 or fewer in the fit) requests in flight, the server never holds more than that many either way, so 512 never binds there. ${SNAPSHOT_NOTE}`,
  ),

  {
    id: 'status.vllm-0-10-2.block-size',
    kind: 'status',
    value: 16,
    unit: 'tokens per block',
    label: 'vLLM v0.10.2: KV cache block size when none is given',
    source: { ...VLLM_CUDA, quote: 'cache_config.block_size = 16', row: 'CudaPlatformBase.check_and_update_config (if cache_config.block_size is None)' },
    pin: VLLM_0_10_2_PIN,
    verifiedAt: VERIFIED,
    ttlDays: STATUS_TTL,
    boundary:
      'The default the CUDA platform sets in v0.10.2 when --block-size is not passed; the InferenceX scripts do not pass it. Some attention backends then override it (MLA backends use 64 or 128, which Llama does not use). vLLM v0.31.0, the release the In-production rows quote, also defaults to 16 (production.vllm.block-size); this claim is the 0.10.2 benchmark\'s.',
  },

  {
    id: 'hw.hgx-b200.fp8-sparse-system',
    kind: 'spec',
    value: 72,
    unit: 'PFLOPS',
    label: 'HGX B200 FP8/FP6, with sparsity, 8 GPUs',
    source: { ...HGX, quote: '72 PFLOPS', row: 'HGX B200 > FP8/FP6 Tensor Core' },
    verifiedAt: VERIFIED,
    ttlDays: 365,
    boundary: 'Per 8-GPU baseboard and with sparsity. The page\'s footnote: "Specification in Sparse. Dense is ½ sparse spec shown." The HGX B300 column lists the same figure.',
  },
  {
    id: 'hw.hgx-b200.fp4-sparse-system',
    kind: 'spec',
    value: 144,
    unit: 'PFLOPS',
    label: 'HGX B200 FP4, with sparsity, 8 GPUs',
    source: { ...HGX, quote: '144 PFLOPS | 72 PFLOPS', row: 'HGX B200 > FP4 Tensor Core (sparse | dense)' },
    verifiedAt: VERIFIED,
    ttlDays: 365,
    boundary:
      'Per 8-GPU baseboard. The page\'s footnote for this row: "Specification in Sparse | Dense", so 144 PFLOPS is with sparsity and the same cell\'s 72 PFLOPS is dense (72 / 8 = 9 PFLOPS per GPU, what hw.b200.fp4-dense derives).',
  },
  {
    id: 'hw.b200.fp8-dense',
    kind: 'derived',
    value: 4500,
    unit: 'TFLOPS',
    label: 'B200 FP8 Tensor Core, dense, per GPU',
    verifiedAt: VERIFIED,
    ttlDays: 365,
    derived: { from: ['hw.hgx-b200.fp8-sparse-system'], formula: 'sparsePflops * 1000 / 8 / 2' },
    boundary: 'Sparse system figure divided across 8 GPUs, then halved for dense, as hw.b200.bf16-dense is. Twice hw.b200.bf16-dense (2,250), the ratio FP8 has to BF16 on this chip family. A wrong peak rescales the fitted efficiency only.',
  },
  {
    id: 'hw.b200.fp4-dense',
    kind: 'derived',
    value: 9000,
    unit: 'TFLOPS',
    label: 'B200 FP4 Tensor Core, dense, per GPU',
    verifiedAt: VERIFIED,
    ttlDays: 365,
    derived: { from: ['hw.hgx-b200.fp4-sparse-system'], formula: 'sparsePflops * 1000 / 8 / 2' },
    boundary: 'Sparse system figure divided across 8 GPUs, then halved for dense; the page\'s own dense figure for the same row (72 PFLOPS per 8 GPUs) gives the same 9,000. Four times hw.b200.bf16-dense. A wrong peak rescales the fitted efficiency only.',
  },

  ...(
    [
      ['layers', 80, 'layers', 'Llama-3.3-70B transformer layers', 'num_hidden_layers', '"num_hidden_layers": 80,'],
      ['hidden', 8192, 'dims', 'Llama-3.3-70B hidden size', 'hidden_size', '"hidden_size": 8192,'],
      ['kv-heads', 8, 'KV heads', 'Llama-3.3-70B key/value heads (GQA)', 'num_key_value_heads', '"num_key_value_heads": 8,'],
      ['head-dim', 128, 'dims', 'Llama-3.3-70B head dimension', 'head_dim', '"head_dim": 128,'],
      ['heads', 64, 'heads', 'Llama-3.3-70B attention (query) heads', 'num_attention_heads', '"num_attention_heads": 64,'],
      ['intermediate', 28672, 'dims', 'Llama-3.3-70B FFN intermediate size', 'intermediate_size', '"intermediate_size": 28672,'],
      ['vocab', 128256, 'tokens', 'Llama-3.3-70B vocabulary size', 'vocab_size', '"vocab_size": 128256'],
    ] as const
  ).map(
    ([suffix, value, unit, label, row, quote]): Claim => ({
      id: `zoo.llama-3-3-70b.${suffix}`,
      kind: 'spec',
      value,
      unit,
      label,
      source: { ...LLAMA33_CONFIG, quote, row },
      pin: LLAMA33_70B_PIN,
      verifiedAt: VERIFIED,
      ttlDays: 365,
      boundary:
        'Read from NVIDIA\'s FP8 checkpoint of Llama-3.3-70B-Instruct, the model the InferenceX harness served on H100 and B200 FP8 (Meta\'s own config.json is gated, HTTP 401). Its architecture fields equal the Llama-3-70B claims (model.llama3-70b.*) the step card reads; tests/claims/physics.test.ts holds them equal.',
    }),
  ),

  {
    id: 'model.llama3-70b.kv-bytes-per-token-fp8',
    kind: 'derived',
    value: 163840,
    unit: 'bytes/token',
    label: 'Llama-3-70B KV cache per token (FP8)',
    verifiedAt: VERIFIED,
    ttlDays: 365,
    derived: {
      from: ['model.llama3-70b.layers', 'model.llama3-70b.kv-heads', 'model.llama3-70b.head-dim'],
      formula: '2 * layers * kvHeads * headDim * 1',
    },
    boundary: 'FP8 K and V (the harness runs kv-cache-dtype fp8), one byte per element, no scales and no paging overhead: 2 (K and V) x 80 x 8 x 128 x 1 B = 160 KiB per token, half the BF16 figure.',
  },
  {
    id: 'model.llama3-70b.weight-bytes-fp8',
    kind: 'derived',
    value: 70550000000,
    unit: 'B',
    label: 'Llama-3-70B weight bytes at FP8',
    verifiedAt: VERIFIED,
    ttlDays: 365,
    derived: { from: ['model.llama3-70b.params'], formula: 'paramsB * 1e9 * 1' },
    boundary:
      'Every parameter at one byte, scales and any higher-precision tensors ignored: a checkpoint that keeps lm_head in BF16 would add 1.05e9 B (128,256 x 8,192 x 1 extra byte), which the fitted efficiency absorbs. Weights streamed per step at TP 1; a TP group streams a TP-th of it per GPU.',
  },
  {
    id: 'model.llama3-70b.weight-bytes-nvfp4',
    kind: 'derived',
    value: 39684375000,
    unit: 'B',
    label: 'Llama-3-70B weight bytes at NVFP4',
    verifiedAt: VERIFIED,
    ttlDays: 365,
    derived: { from: ['model.llama3-70b.params', 'serving.nvfp4.bits-per-weight'], formula: 'paramsB * 1e9 * bitsPerWeight / 8' },
    boundary:
      'Every parameter at NVFP4\'s 4.5 bits (4-bit value plus an FP8 scale per 16 values), the per-tensor FP32 scale and any tensors a checkpoint keeps at higher precision ignored; the fitted efficiency absorbs the difference.',
  },
]

registerClaims(PHYSICS_CLAIMS)
