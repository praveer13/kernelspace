import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * The inputs of the Fleet's physics v2 (spec s5 §4.5, S5-03): the dataset claim, the harness's settings, the HGX B200
 * peaks, the Llama-3.3-70B config the benchmark served, and the model byte claims the step card reads. The measured
 * points are in `ix-points.ts` (generated from the extract). The fitted `phys.<row>.*` claims (S5-07) are at the end: their
 * values are the fit's, reproduced from `docs/physics/report.json` by `verify:claims` (S5-D18); the decision-table findings
 * and the controls are added by S5-08, and `homes.ts` already lists every prefix they use.
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

/** The inputs: the dataset, the harness, the peaks, the zoo and the model byte claims. */
const PHYSICS_INPUT_CLAIMS: Claim[] = [
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

/**
 * The AMD peaks the out-of-sample control reads (S5-08, O13): registered because each quote was fetched with curl from
 * AMD's product page on 2026-10-19 (the spec table's cell, or for the MI325X FP8 figure the page's footnote MI325-002, which
 * gives the dense figure to more digits). Spec claims, per GPU. Adopted by the build on 2026-10-19, unsigned (F1).
 */
const MI325X_PAGE = { url: 'https://www.amd.com/en/products/accelerators/instinct/mi300/mi325x.html', title: 'AMD Instinct™ MI325X Accelerators' }
const MI355X_PAGE = { url: 'https://www.amd.com/en/products/accelerators/instinct/mi350/mi355x.html', title: 'AMD Instinct™ MI355X GPUs' }
const AMD_VERIFIED = '2026-10-19'
const AMD_CONTROL_NOTE = 'Read only by the out-of-sample control (docs/physics/controls.json); no AMD row is calibrated and nothing graded reads it.'

const AMD_PEAK_CLAIMS: Claim[] = [
  {
    id: 'hw.mi325x.hbm-bw',
    kind: 'spec',
    value: 6,
    unit: 'TB/s',
    label: 'MI325X HBM3E peak memory bandwidth',
    source: { ...MI325X_PAGE, quote: '6 TB/s', row: 'Specifications > GPU Memory > Peak Memory Bandwidth' },
    verifiedAt: AMD_VERIFIED,
    ttlDays: 365,
    boundary: `Peak datasheet figure, per GPU (OAM). ${AMD_CONTROL_NOTE}`,
  },
  {
    id: 'hw.mi325x.hbm-capacity',
    kind: 'spec',
    value: 256,
    unit: 'GB',
    label: 'MI325X HBM3E capacity',
    source: { ...MI325X_PAGE, quote: '256 GB', row: 'Specifications > GPU Memory > Dedicated Memory Size' },
    verifiedAt: AMD_VERIFIED,
    ttlDays: 365,
    boundary: `Per GPU (OAM), HBM3E. ${AMD_CONTROL_NOTE}`,
  },
  {
    id: 'hw.mi325x.fp8-dense',
    kind: 'spec',
    value: 2614.9,
    unit: 'TFLOPS',
    label: 'MI325X FP8 peak, dense, per GPU',
    source: { ...MI325X_PAGE, quote: '2614.9 TFLOPS peak theoretical 8-bit precision (FP8)', row: 'Footnote MI325-002 (the specifications table rounds it to 2.61 PFLOPs, 5.22 with structured sparsity)' },
    verifiedAt: AMD_VERIFIED,
    ttlDays: 365,
    boundary: `Without sparsity, at the 2,100 MHz peak engine clock. ${AMD_CONTROL_NOTE} A wrong peak rescales the fitted efficiency only.`,
  },
  {
    id: 'hw.mi355x.hbm-bw',
    kind: 'spec',
    value: 8,
    unit: 'TB/s',
    label: 'MI355X HBM3E peak memory bandwidth',
    source: { ...MI355X_PAGE, quote: '8 TB/s', row: 'Specifications > GPU Memory > Peak Memory Bandwidth' },
    verifiedAt: AMD_VERIFIED,
    ttlDays: 365,
    boundary: `Peak datasheet figure, per GPU (OAM). ${AMD_CONTROL_NOTE}`,
  },
  {
    id: 'hw.mi355x.hbm-capacity',
    kind: 'spec',
    value: 288,
    unit: 'GB',
    label: 'MI355X HBM3E capacity',
    source: { ...MI355X_PAGE, quote: '288 GB', row: 'Specifications > GPU Memory > Dedicated Memory Size' },
    verifiedAt: AMD_VERIFIED,
    ttlDays: 365,
    boundary: `Per GPU (OAM), HBM3E. ${AMD_CONTROL_NOTE}`,
  },
  {
    id: 'hw.mi355x.fp8-dense',
    kind: 'spec',
    value: 5,
    unit: 'PFLOPS',
    label: 'MI355X OCP-FP8 matrix peak, dense, per GPU',
    source: { ...MI355X_PAGE, quote: '5 PFLOPs', row: 'Specifications > Peak Open Compute Project Eight-bit Precision Matrix (OCP-FP8) Performance (E5M2, E4M3)' },
    verifiedAt: AMD_VERIFIED,
    ttlDays: 365,
    boundary: `Without sparsity (10.1 PFLOPs with structured sparsity), at the 2,400 MHz peak engine clock. ${AMD_CONTROL_NOTE} A wrong peak rescales the fitted efficiency only.`,
  },
]

/**
 * The fit's claims (S5-07, spec §4.5): six parameters and six gate statistics for each calibrated row. Their values are the
 * report's `claimValues` at the report's rounding (`CLAIM_ROUNDING` in scripts/fit-physics.ts): `verify:claims` reproduces
 * each from docs/physics/report.json at 1e-9 relative and fails a `phys.*` claim the report does not carry, so a refit that
 * moves a number fails there until these are updated (tests/physics/verify-physics.test.ts also holds the counts in the
 * boundary text to the report). Adopted by the build on 2026-10-18, unsigned: the owner signs the fit (field gate F1).
 */
const SPLIT_CAVEAT = "this fit's split of one snapshot; not a hardware fact; other equally good forms split it differently"
const FIT_STATUS_NOTE = 'Fit status: adopted by the build on 2026-10-18, unsigned.'

type ParamName = 'eta-mem' | 'eta-flop' | 'layer-us' | 'seq-us' | 'link-gbs' | 'harness-ms'
type StatName = 'loo-tpot-mean' | 'loo-tpot-p90' | 'heldout-tpot-mean' | 'heldout-tpot-p90' | 'loo-ttft8k-mean' | 'loo-ttft8k-p90'

interface PhysRow {
  key: string
  /** the chip, engine release and weight precision, as the row's label reads */
  name: string
  /** the protocol row's chip bandwidth, dense peak, capacity and weight-byte claims */
  inputs: { bw: string; peak: string; hbm: string; weightBytes: string }
  /** F points, H points, and F's 8,192-token-prompt points (G3's population) */
  nFit: number
  nHeld: number
  nTtft: number
  /** the weight precision in words, for the boundary */
  precision: string
  /** the registered values: report.json's `claimValues` for this row */
  v: Record<ParamName | StatName, number>
}

const PHYS_ROWS: PhysRow[] = [
  {
    key: 'h100-vllm-0-10-2-fp8',
    name: 'H100 SXM · vLLM 0.10.2 · FP8',
    inputs: { bw: 'hw.h100-sxm.hbm-bw', peak: 'hw.h100-sxm.fp8-dense', hbm: 'hw.h100-sxm.hbm-capacity', weightBytes: 'model.llama3-70b.weight-bytes-fp8' },
    nFit: 25,
    nHeld: 17,
    nTtft: 8,
    precision: 'FP8 weights and FP8 KV',
    v: {
      'eta-mem': 0.89, 'eta-flop': 0.52, 'layer-us': 72.3, 'seq-us': 61.1, 'link-gbs': 213.2, 'harness-ms': 21.5,
      'loo-tpot-mean': 5, 'loo-tpot-p90': 11.3, 'heldout-tpot-mean': 3.8, 'heldout-tpot-p90': 11, 'loo-ttft8k-mean': 11.1, 'loo-ttft8k-p90': 20.7,
    },
  },
  {
    key: 'b200-vllm-0-10-2-fp8',
    name: 'B200 · vLLM 0.10.2 · FP8',
    inputs: { bw: 'hw.b200.hbm-bw', peak: 'hw.b200.fp8-dense', hbm: 'hw.b200.hbm-capacity', weightBytes: 'model.llama3-70b.weight-bytes-fp8' },
    nFit: 34,
    nHeld: 24,
    nTtft: 11,
    precision: 'FP8 weights and FP8 KV',
    v: {
      'eta-mem': 0.84, 'eta-flop': 0.46, 'layer-us': 61.8, 'seq-us': 32.6, 'link-gbs': 291.1, 'harness-ms': 52.3,
      'loo-tpot-mean': 3.6, 'loo-tpot-p90': 7.3, 'heldout-tpot-mean': 3.1, 'heldout-tpot-p90': 6, 'loo-ttft8k-mean': 11.1, 'loo-ttft8k-p90': 19.1,
    },
  },
  {
    key: 'b200-vllm-0-10-2-nvfp4',
    name: 'B200 · vLLM 0.10.2 · NVFP4',
    inputs: { bw: 'hw.b200.hbm-bw', peak: 'hw.b200.fp4-dense', hbm: 'hw.b200.hbm-capacity', weightBytes: 'model.llama3-70b.weight-bytes-nvfp4' },
    nFit: 36,
    nHeld: 24,
    nTtft: 12,
    precision: 'NVFP4 weights and FP8 KV',
    v: {
      'eta-mem': 0.76, 'eta-flop': 0.34, 'layer-us': 70, 'seq-us': 28.9, 'link-gbs': 283.7, 'harness-ms': 41.8,
      'loo-tpot-mean': 4.5, 'loo-tpot-p90': 7.3, 'heldout-tpot-mean': 2.8, 'heldout-tpot-p90': 5.2, 'loo-ttft8k-mean': 13.5, 'loo-ttft8k-p90': 26.1,
    },
  },
]

/** The claims every fitted number of a row is derived from: the dataset, the chip, the model and the harness settings the replay read. */
const physInputs = (r: PhysRow): string[] => [
  'bench.inferencex.llama70b-2025-10-29',
  r.inputs.bw,
  r.inputs.peak,
  r.inputs.hbm,
  r.inputs.weightBytes,
  'model.llama3-70b.params',
  'model.llama3-70b.layers',
  'model.llama3-70b.hidden-size',
  'model.llama3-70b.kv-bytes-per-token-fp8',
  'status.inferencex.harness.batch-tokens',
  'status.vllm-0-10-2.block-size',
]

const PHYS_TTL = 180
const PHYS_SNAPSHOT = 'one InferenceX sweep (Llama-3.3-70B, vLLM 0.10.2, 2025-10-29)'

function physParam(r: PhysRow, name: ParamName, unit: string, label: string, what: string): Claim {
  return {
    id: `phys.${r.key}.${name}`,
    kind: 'derived',
    value: r.v[name],
    unit,
    label: `${r.name}: ${label}`,
    verifiedAt: VERIFIED,
    ttlDays: PHYS_TTL,
    derived: { from: physInputs(r), formula: `fit-physics: ${what}, fitted on the ${r.nFit} fit points; docs/physics/report.json` },
    boundary:
      `${what[0].toUpperCase()}${what.slice(1)}, under the step card's form (docs/specs/s5.md §3.2), fitted on the ${r.nFit} fit points (concurrency 4, 16 and 64) of ${PHYS_SNAPSHOT}, ${r.precision}, ` +
      `Llama-3-70B architecture. This is ${SPLIT_CAVEAT}. Only the card's predictions are validated (the leave-one-out and held-out claims of this row), never its split into terms. ` +
      `Stale from 2027-04-16 with the sweep; a refit is a new physics id. ${FIT_STATUS_NOTE}`,
  }
}

function physStat(r: PhysRow, name: StatName, label: string, population: string): Claim {
  return {
    id: `phys.${r.key}.${name}`,
    kind: 'derived',
    value: r.v[name],
    unit: '%',
    label: `${r.name}: ${label}`,
    verifiedAt: VERIFIED,
    ttlDays: PHYS_TTL,
    derived: { from: physInputs(r), formula: `fit-physics: ${label}, error = |predicted / measured - 1|; docs/physics/report.json` },
    boundary:
      `${population} Error is |predicted ÷ measured − 1| on ${PHYS_SNAPSHOT}; the gates are in docs/physics/protocol.md (pre-registered 2026-10-18). ` +
      `The form was chosen on this same snapshot before the gate was written, so in-sample margins are optimistic (the protocol's selection disclosure). Stale from 2027-04-16. ${FIT_STATUS_NOTE}`,
  }
}

const PHYS_FIT_CLAIMS: Claim[] = PHYS_ROWS.flatMap((r): Claim[] => [
  physParam(r, 'eta-mem', 'ratio', 'η_m, share of datasheet bandwidth reached', 'the share of the datasheet HBM bandwidth the step reaches reading weights and KV'),
  physParam(r, 'eta-flop', 'ratio', 'η_f, share of dense peak reached', 'the share of the dense peak the step reaches in long prefills'),
  physParam(r, 'layer-us', 'µs', 't_layer, fixed cost per layer per step', 'the fixed cost per layer per engine step'),
  physParam(r, 'seq-us', 'µs', 't_seq, host work per running request per step', 'the host work per running request per engine step'),
  physParam(r, 'link-gbs', 'GB/s', 'β, effective all-reduce bandwidth', 'the effective all-reduce bandwidth at TP above 1 (a fitted number, not NVLink)'),
  physParam(r, 'harness-ms', 'ms', 'TTFT residual (fitted, not physics)', "the TTFT residual: what the engine's admission-to-first-token window misses (client overhead, the wait for an in-flight step, any prefill misfit); it lives outside the engine"),
  physStat(r, 'loo-tpot-mean', 'TPOT leave-one-out mean error', `Mean over the ${r.nFit} fit points of the error of mean TPOT, each point predicted by a refit without it (leave-one-out, gate G1: mean at most 10 %, p90 at most 15 %).`),
  physStat(r, 'loo-tpot-p90', 'TPOT leave-one-out p90 error', `The 90th percentile (nearest rank) over the ${r.nFit} fit points of the error of mean TPOT, each point predicted by a refit without it (leave-one-out, gate G1).`),
  physStat(r, 'heldout-tpot-mean', 'TPOT held-out mean error', `Mean over the ${r.nHeld} held-out points (concurrency 8 and 32, never fitted) of the error of mean TPOT, scored by the table fitted on the fit subset (gate G2: mean at most 10 %, p90 at most 15 %).`),
  physStat(r, 'heldout-tpot-p90', 'TPOT held-out p90 error', `The 90th percentile (nearest rank) over the ${r.nHeld} held-out points of the error of mean TPOT, scored by the table fitted on the fit subset (gate G2).`),
  physStat(r, 'loo-ttft8k-mean', 'median TTFT leave-one-out mean error', `Mean over the ${r.nTtft} fit points with 8,192-token prompts of the error of median TTFT (engine plus the fitted TTFT residual), each predicted by a refit without it (gate G3: mean at most 15 %; it decides TTFT eligibility only).`),
  physStat(r, 'loo-ttft8k-p90', 'median TTFT leave-one-out p90 error', `The 90th percentile (nearest rank) over the ${r.nTtft} fit points with 8,192-token prompts of the error of median TTFT (engine plus the fitted TTFT residual), each predicted by a refit without it (printed beside gate G3).`),
])

/**
 * The decision tables' claims (S5-08, spec §4.5, §5.8, §7.0-7.1): `frontier`'s separation margin per FP8 row and the three
 * measured findings, reproduced from docs/physics/decisions.json (`bun scripts/verify-physics.ts --full --write`) by
 * `verify:claims`; and the printed controls (S5-D65), reproduced from docs/physics/controls.json (`bun
 * scripts/physics-controls.ts`, refreshed by the integrator at each s5 integration). The counts in the boundaries are the
 * files'; tests/physics/decisions.test.ts holds them to the files.
 */
const DECISIONS = 'docs/physics/decisions.json'
const CONTROLS = 'docs/physics/controls.json'
const DATASET = 'bench.inferencex.llama70b-2025-10-29'

const sepClaim = (r: PhysRow, value: number, pairs: number): Claim => ({
  id: `phys.${r.key}.frontier-sep-p90`,
  kind: 'derived',
  value,
  unit: '%',
  label: `${r.name}: frontier separation margin (pair-ratio LOO p90)`,
  verifiedAt: VERIFIED,
  ttlDays: PHYS_TTL,
  derived: { from: physInputs(r), formula: `verify-physics --full: p90 (nearest rank) of |LOO ratio / measured ratio - 1| over the row's option pairs; ${DECISIONS}` },
  boundary:
    `δ_sep of decision-level H1 (spec §7.0): over the ${pairs} pairs of this row's frontier options (TP × concurrency 4, 16 and 64, inside the box, one shape at a time) of ${PHYS_SNAPSHOT}, ` +
    `the 90th percentile of the error of the ratio of their tok/s per GPU, each side predicted by a leave-one-out refit. A frontier scene is gradeable only when its winner beats the runner-up by at least 1 ÷ (1 − δ_sep). ` +
    `${FIT_STATUS_NOTE}`,
})

const DECISION_CLAIMS: Claim[] = [
  sepClaim(PHYS_ROWS[0], 12.8, 92),
  sepClaim(PHYS_ROWS[1], 10.9, 176),
  {
    id: 'phys.finding.b200-cheaper-per-token',
    kind: 'derived',
    value: 100,
    unit: '%',
    label: 'Share of measured FP8 frontier scenes where B200 is cheaper per output token than H100',
    verifiedAt: VERIFIED,
    ttlDays: 90,
    derived: { from: [DATASET, 'price.h100.median', 'price.b200.median'], formula: `verify-physics --full: scenes where price.b200.median ÷ B200's best tok/s per GPU < price.h100.median ÷ H100's; ${DECISIONS}` },
    boundary:
      'Measured values only: in each of the 2,715 frontier scenes (a shape and a floor from 15.0 to 120.0 tok/s per user by 0.1) where both rows have a published option meeting the floor, each chip\'s best option (most output tok/s per GPU) is priced at the median on-demand GPU-hour of 2026-10-04 ($3.49 H100, $7.01 B200). ' +
      'B200 is cheaper in all of them, by 1.13× to 12.7× (H100\'s cost ÷ B200\'s). Llama-3.3-70B FP8 on vLLM 0.10.2 (InferenceX 2025-10-29); the prices go stale first, so this claim has their 90-day life.',
  },
  {
    id: 'phys.finding.nvfp4-tpot-gain',
    kind: 'derived',
    value: 1.32,
    unit: '×',
    label: 'Largest measured B200 TPOT gain from FP8 to NVFP4 weights at TP 1-4',
    verifiedAt: VERIFIED,
    ttlDays: PHYS_TTL,
    derived: { from: [DATASET, 'model.llama3-70b.weight-bytes-fp8', 'model.llama3-70b.weight-bytes-nvfp4', 'bench.ix-l70.b200-vllm-0-10-2-fp8.tp1.1024-1024.c4.tpot', 'bench.ix-l70.b200-vllm-0-10-2-nvfp4.tp1.1024-1024.c4.tpot'], formula: `verify-physics --full: max over pairs of TPOT(FP8) ÷ TPOT(NVFP4); ${DECISIONS}` },
    boundary:
      'Measured mean TPOT at FP8 ÷ at NVFP4 on B200, over the 43 configurations both rows kept at TP 1, 2 and 4 (every concurrency and shape): 1.01× to 1.32×, while the weight bytes fall 1.78× (model.llama3-70b.weight-bytes-fp8 ÷ -nvfp4). ' +
      'For example 16.34 → 13.07 ms (1.25×) at TP 1, 4 users, ~1k/~1k (ids 40624 → 40085). Some per-step cost does not scale with weight bytes; how a fit splits it is not a hardware fact. vLLM 0.10.2, InferenceX 2025-10-29.',
  },
  {
    id: 'phys.finding.tp2-to-tp8',
    kind: 'derived',
    value: 1.91,
    unit: '×',
    label: 'Measured H100 TPOT speedup from TP 2 to TP 8 at 4 users, ~1k/~1k',
    verifiedAt: VERIFIED,
    ttlDays: PHYS_TTL,
    derived: { from: [DATASET, 'bench.ix-l70.h100-vllm-0-10-2-fp8.tp2.1024-1024.c4.tpot', 'bench.ix-l70.h100-vllm-0-10-2-fp8.tp8.1024-1024.c4.tpot'], formula: `verify-physics --full: TPOT(TP 2) ÷ TPOT(TP 8); ${DECISIONS}` },
    boundary:
      'Measured mean TPOT 17.41 ms at TP 2 and 9.11 ms at TP 8 (ids 42017 → 41625), Llama-3.3-70B FP8 on H100, 4 users, ~1k prompts and outputs, vLLM 0.10.2 (InferenceX 2025-10-29). ' +
      'The datasheet bound (η = 1, bytes ÷ bandwidth) divides by TP and predicts 4.0×: something per step does not divide by TP; how much of it is fixed cost is a fit\'s split, not a hardware fact.',
  },
]

const H100_PARAMS = (['eta-mem', 'eta-flop', 'layer-us', 'seq-us', 'link-gbs'] as const).map((n) => `phys.${PHYS_ROWS[0].key}.${n}`)
const NIM_70B = ['model.llama3-70b.params', 'model.llama3-70b.layers', 'model.llama3-70b.hidden-size', 'model.llama3-70b.kv-bytes-per-token-fp8', 'model.llama3-70b.weight-bytes-fp8']
const NIM_8B = ['model.llama3-8b.params', 'model.llama3-8b.layers', 'model.llama3-8b.hidden-size', 'model.llama3-8b.kv-bytes-per-token']

const nimClaim = (key: string, label: string, n: number, value: number, models: string, modelClaims: string[]): Claim => ({
  id: `phys.nim.${key}.itl-mean`,
  kind: 'derived',
  value,
  unit: '%',
  label: `NIM cross-harness: ${label}, mean ITL error`,
  verifiedAt: AMD_VERIFIED,
  ttlDays: PHYS_TTL,
  derived: {
    from: [...H100_PARAMS, 'hw.h100-sxm.hbm-bw', 'hw.h100-sxm.fp8-dense', 'hw.h100-sxm.hbm-capacity', ...modelClaims, 'status.inferencex.harness.batch-tokens', 'status.vllm-0-10-2.block-size'],
    formula: `physics-controls: mean |EngineV2 mean TPOT ÷ NIM ITL - 1| over the group; ${CONTROLS}`,
  },
  boundary:
    `Printed, never gated (spec §4.4, R2). ${models} on H100 at FP8 from NVIDIA's NIM 1.8.0 benchmark page (https://docs.nvidia.com/nim/benchmarking/llm/1.0.0/performance.html; vendor numbers, backend unstated): the ${n} rows that pass the protocol's KV and 3 s TTFT filters, ` +
    'each replayed through EngineV2 with the H100 · vLLM 0.10.2 · FP8 table\'s parameters (fitted on InferenceX), fixed lengths, FP8 weights and KV. Another harness and engine, so this is transfer error, not the gate\'s.',
})

const controlClaim = (chip: string, name: 'loo-tpot-mean' | 'loo-tpot-p90', value: number): Claim => ({
  id: `phys.control.${chip}.${name}`,
  kind: 'derived',
  value,
  unit: '%',
  label: `Out-of-sample control, ${chip.toUpperCase()} · vLLM · FP8: TPOT leave-one-out ${name === 'loo-tpot-mean' ? 'mean' : 'p90'} error`,
  verifiedAt: AMD_VERIFIED,
  ttlDays: PHYS_TTL,
  derived: {
    from: [DATASET, `hw.${chip}.hbm-bw`, `hw.${chip}.fp8-dense`, `hw.${chip}.hbm-capacity`, 'model.llama3-70b.params', 'model.llama3-70b.layers', 'model.llama3-70b.hidden-size', 'model.llama3-70b.kv-bytes-per-token-fp8', 'model.llama3-70b.weight-bytes-fp8', 'status.vllm-0-10-2.block-size'],
    formula: `physics-controls: G1's statistic on the ${chip} rows, the card form refitted by the protocol's procedure; ${CONTROLS}`,
  },
  boundary:
    `Printed, never gated (spec §4.4, R2): the step card's form, frozen, refitted on the 36 fit points (concurrency 4, 16 and 64) of the 60 ${chip.toUpperCase()} vLLM FP8 rows of the same InferenceX sweep (2025-10-29), rows no design looked at when the form was chosen, ` +
    `replayed at their own token budget of 131,072, each point predicted by a refit without it (G1's population: gate G1 asks mean at most 10 %, p90 at most 15 %). The prospective test of the form, not a calibration: no AMD row is in the Fleet.`,
})

const CONTROL_CLAIMS: Claim[] = [
  nimClaim('h100-tp2', 'Llama-3.3-70B FP8, TP 2', 27, 4.9, 'Llama-3.3-70B', NIM_70B),
  nimClaim('h100-tp4', 'Llama-3.x-70B FP8, TP 4', 66, 15.4, 'Llama-3.3-70B and Llama-3.1-70B (one architecture)', NIM_70B),
  nimClaim('8b-tp1', 'Llama-3.1-8B FP8, TP 1', 59, 27.1, 'Llama-3.1-8B', NIM_8B),
  controlClaim('mi325x', 'loo-tpot-mean', 8.3),
  controlClaim('mi325x', 'loo-tpot-p90', 17),
  controlClaim('mi355x', 'loo-tpot-mean', 6.1),
  controlClaim('mi355x', 'loo-tpot-p90', 13.7),
]

export const PHYSICS_CLAIMS: Claim[] = [...PHYSICS_INPUT_CLAIMS, ...AMD_PEAK_CLAIMS, ...PHYS_FIT_CLAIMS, ...DECISION_CLAIMS, ...CONTROL_CLAIMS]

registerClaims(PHYSICS_CLAIMS)
