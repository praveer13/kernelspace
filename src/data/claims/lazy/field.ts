import { registerClaims } from '../registry'
import { VLLM_PIN } from '../engines'
import type { Claim } from '../schema'

/**
 * The two field labs' pinned commands and the lines they tell the learner to read (spec wave-3 §16.5, task 3s-07). The
 * commands are `status` claims pinned to the vLLM release the In-production claims use (engines.ts), with ttlDays 60,
 * so the labs show "stale since" when the engine moves. Each command's flags were looked up at that tag: the serve
 * flags in vllm/config/model.py (`dtype`, `max_model_len`) and vllm/config/cache.py (`gpu_memory_utilization`), the
 * bench flags in vllm/benchmarks/serve.py and vllm/benchmarks/datasets/datasets.py. The quotes were copied from the
 * files at that tag on 2026-10-14 with runs of whitespace collapsed to one space. tests/forge/field-labs.test.ts holds
 * each command to the flags this file names.
 *
 * Nobody has run these commands on a GPU yet. The owner signs them off and runs each once (spec §16.5, owner step); until
 * then the labs say so (`ranBy` in the lab modules is null).
 */
const VLLM_RAW = `https://raw.githubusercontent.com/${VLLM_PIN.repo}/${VLLM_PIN.ref}`
const VLLM_BENCH_DOC = { url: `${VLLM_RAW}/docs/benchmarking/cli.md`, title: 'vLLM v0.31.0 docs: benchmarking/cli.md (vllm bench serve)' }
const VLLM_CLI_DOC = { url: `${VLLM_RAW}/docs/cli/README.md`, title: 'vLLM v0.31.0 docs: cli/README.md (vllm serve)' }
const VLLM_KV_UTILS = {
  url: `${VLLM_RAW}/vllm/v1/core/kv_cache_utils.py`,
  title: 'vLLM v0.31.0 source: vllm/v1/core/kv_cache_utils.py (update_kv_cache_capacity)',
}
const VLLM_BENCH_SERVE = { url: `${VLLM_RAW}/vllm/benchmarks/serve.py`, title: 'vLLM v0.31.0 source: vllm/benchmarks/serve.py (vllm bench serve)' }
const VLLM_DATASETS = {
  url: `${VLLM_RAW}/vllm/benchmarks/datasets/datasets.py`,
  title: 'vLLM v0.31.0 source: vllm/benchmarks/datasets/datasets.py (BurstGPTDataset)',
}

/** BurstGPT's v2.0 release asset: the file the Fleet's `burstgpt-v2-busiest-hour` trace is cut from (public/traces/README.md). */
export const BURSTGPT_PIN = { repo: 'HPMLL/BurstGPT', ref: 'v2.0' } as const
export const BURSTGPT_FILE = 'BurstGPT_without_fails_1.csv'
export const BURSTGPT_SHA256 = 'a4d068a7113ec0290e74063a1b3447dc6001a30e4298eb313581b71006dda1f4'
const BURSTGPT_URL = `https://github.com/${BURSTGPT_PIN.repo}/releases/download/${BURSTGPT_PIN.ref}/${BURSTGPT_FILE}`
const BURSTGPT_ASSET = { url: BURSTGPT_URL, title: `BurstGPT ${BURSTGPT_PIN.ref} release asset: ${BURSTGPT_FILE} (HPMLL/BurstGPT, CC-BY-4.0)` }

/** The model both labs serve: the ungated mirror the Llama-3-8B claims (models.ts) are read from. */
export const FIELD_MODEL = 'NousResearch/Meta-Llama-3-8B'

export const FIELD_COMMANDS = {
  decodeServe: `vllm serve ${FIELD_MODEL} --dtype bfloat16 --max-model-len 4096 --gpu-memory-utilization 0.90`,
  decodeBench: `vllm bench serve --model ${FIELD_MODEL} --dataset-name random --input-len 128 --output-len 256 --num-prompts 16 --max-concurrency 1`,
  burstFetch: `curl -L -o ${BURSTGPT_FILE} ${BURSTGPT_URL} && echo "${BURSTGPT_SHA256}  ${BURSTGPT_FILE}" | sha256sum -c`,
  burstServe: `vllm serve ${FIELD_MODEL} --dtype bfloat16 --max-model-len 8192 --gpu-memory-utilization 0.90`,
  burstBench: `vllm bench serve --model ${FIELD_MODEL} --dataset-name burstgpt --dataset-path ${BURSTGPT_FILE} --num-prompts 480 --request-rate inf --ignore-eos --seed 0`,
} as const

export const FIELD_CLAIMS: Claim[] = [
  {
    id: 'field.decode-kv.serve',
    kind: 'status',
    value: FIELD_COMMANDS.decodeServe,
    label: 'Field lab 1: start vLLM on Llama-3-8B with 4,096-token requests',
    source: { ...VLLM_CLI_DOC, quote: 'Starts the vLLM OpenAI Compatible API server.', row: 'serve' },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'The page documents `vllm serve <model>`. The flags exist at this tag: --dtype and --max-model-len are fields of vllm/config/model.py, --gpu-memory-utilization of vllm/config/cache.py (default 0.92, so 0.90 is given on purpose and Boot-sized arithmetic uses it). 4,096 is Boot\'s chat length, so the log\'s concurrency counts the same chats Boot counted. Needs an 80 GB-class GPU; nobody has run it yet (owner step).',
  },
  {
    id: 'field.decode-kv.bench',
    kind: 'status',
    value: FIELD_COMMANDS.decodeBench,
    label: 'Field lab 1: one user decoding 256 tokens, 16 times',
    source: {
      ...VLLM_BENCH_DOC,
      quote: '`--max-concurrency`: Limits concurrent outstanding requests. If this argument is not provided, concurrency is unlimited.',
      row: 'Parameters: --max-concurrency',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'With --max-concurrency 1 the server holds one request at a time, so every decode step is batch 1. --input-len and --output-len map to the random dataset\'s lengths, and the random dataset sets ignore_eos on the OpenAI-compatible backends, so each request generates exactly 256 tokens. Run it in a second terminal while the server from field.decode-kv.serve is up.',
  },
  {
    id: 'field.decode-kv.kv-log',
    kind: 'status',
    value: 'GPU KV cache size: N tokens, Maximum concurrency for 4,096 tokens per request: Mx',
    label: 'Field lab 1: the server log line that sizes the KV cache',
    source: {
      ...VLLM_KV_UTILS,
      quote: '"%s KV cache size: %s tokens, " "Maximum concurrency for %s tokens per request: %.2fx",',
      row: 'update_kv_cache_capacity (logger.info_once)',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'Printed once while the server starts, before it accepts requests. The first %s is "GPU" on CUDA, the second is the token count with thousands separators, the third is --max-model-len; the concurrency is get_max_concurrency_for_kv_cache_config, so it equals the token count divided by --max-model-len. Enter the number before the x.',
  },
  {
    id: 'field.decode-kv.tpot',
    kind: 'status',
    value: 'Mean TPOT (ms)',
    label: 'Field lab 1: the benchmark line that gives one user\'s decode speed',
    source: {
      ...VLLM_BENCH_SERVE,
      quote: 'process_one_metric("tpot", "TPOT", "Time per Output Token (excl. 1st token)")',
      row: 'the TPOT block of the Serving Benchmark Result',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'TPOT is computed once per request as (end-to-end latency - TTFT) / (output tokens - 1), then averaged, so it leaves out the first token (the prefill). At batch 1, 1000 / TPOT in ms is the tokens per second one user gets.',
  },
  {
    id: 'field.burstgpt.fetch',
    kind: 'status',
    value: FIELD_COMMANDS.burstFetch,
    label: 'Field lab 2: download the pinned BurstGPT file and check its hash',
    source: { ...BURSTGPT_ASSET, row: `release asset ${BURSTGPT_FILE}` },
    pin: BURSTGPT_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary: `A 51,429,517-byte CSV, 1,404,294 rows. Its SHA-256 is the one public/traces/burstgpt-v2-busiest-hour.json records as sourceSha256: the Fleet's recorded hour is cut from this very file. sha256sum -c prints "${BURSTGPT_FILE}: OK" or fails; do not benchmark a file that fails.`,
  },
  {
    id: 'field.burstgpt.serve',
    kind: 'status',
    value: FIELD_COMMANDS.burstServe,
    label: 'Field lab 2: start vLLM on Llama-3-8B with 8,192-token requests',
    source: { ...VLLM_CLI_DOC, quote: 'Starts the vLLM OpenAI Compatible API server.', row: 'serve' },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'As field.decode-kv.serve, with --max-model-len 8192, the longest context the model\'s config.json allows (max_position_embeddings 8192). A request whose prompt plus output exceeds it is refused and counts under "Failed requests".',
  },
  {
    id: 'field.burstgpt.bench',
    kind: 'status',
    value: FIELD_COMMANDS.burstBench,
    label: 'Field lab 2: replay 480 BurstGPT requests all at once',
    source: {
      ...VLLM_BENCH_DOC,
      quote: 'BurstGPT | ✅ | ✅ | `wget https://github.com/HPMLL/BurstGPT/releases/download/v1.1/BurstGPT_without_fails_2.csv`',
      row: 'Supported datasets table: BurstGPT',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      '--request-rate inf sends every request at time 0 (the flag\'s default), so the run measures saturation, not arrival bursts. --ignore-eos makes each request generate exactly the response length its BurstGPT row records. 480 matches the Fleet slice\'s request count. --seed 0 is the default, written out so the draw is the same on every run.',
    discrepancy:
      'vLLM\'s docs point at BurstGPT v1.1\'s BurstGPT_without_fails_2.csv. This lab pins v2.0\'s BurstGPT_without_fails_1.csv, the file the Fleet\'s trace is cut from; the loader needs a Model column and the request and response token counts as the third and fourth columns, which the v2.0 file has (header: Timestamp,Model,Request tokens,Response tokens,Total tokens,Log Type).',
  },
  {
    id: 'field.burstgpt.loader',
    kind: 'status',
    value: 'GPT-4 rows with a positive response; lengths only',
    label: 'vLLM\'s BurstGPT loader: which rows it keeps and what it reads from them',
    source: {
      ...VLLM_DATASETS,
      quote: 'Only rows with Model "GPT-4" and positive response tokens are used.',
      row: 'BurstGPTDataset',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'load_data keeps Model == "GPT-4" and Response tokens > 0, then sample() draws num_requests rows at random (pandas sample, random_state = --seed) and reads only the third and fourth columns of each, the request and response token counts. The Timestamp column is never read: the CLI replays BurstGPT\'s token lengths, not its arrival times. The prompt it sends is made-up token ids of the right length.',
  },
  {
    id: 'field.burstgpt.out-tps',
    kind: 'status',
    value: 'Output token throughput (tok/s)',
    label: 'Field lab 2: the benchmark line that gives the saturated output rate',
    source: {
      ...VLLM_BENCH_SERVE,
      quote: '"Output token throughput (tok/s):", metrics.output_throughput',
      row: 'the Serving Benchmark Result block',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'Generated tokens divided by the benchmark duration, which runs from the first request sent to the last one finished, so it includes the slow tail of the longest responses and the prefill of every prompt. "Failed requests" prints just above it and should read 0.',
  },
  {
    id: 'field.burstgpt.mean-request-tokens',
    kind: 'benchmark',
    value: 660.7,
    unit: 'tokens',
    label: 'BurstGPT v2.0: mean request tokens over the rows vLLM keeps',
    source: { ...BURSTGPT_ASSET, row: 'Request tokens, Model == "GPT-4" and Response tokens > 0' },
    pin: BURSTGPT_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: `Mean of the Request tokens column over the 215,127 of 1,404,294 rows of ${BURSTGPT_FILE} (sha256 ${BURSTGPT_SHA256.slice(0, 12)}...) that vLLM's loader keeps, computed with the standard library's csv module on the file whose hash was checked. The median is 484, the 90th percentile 1,370 and the 99.9th 4,364: the mean sits well above the typical request.`,
  },
  {
    id: 'field.burstgpt.mean-response-tokens',
    kind: 'benchmark',
    value: 218.8,
    unit: 'tokens',
    label: 'BurstGPT v2.0: mean response tokens over the rows vLLM keeps',
    source: { ...BURSTGPT_ASSET, row: 'Response tokens, Model == "GPT-4" and Response tokens > 0' },
    pin: BURSTGPT_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: `Mean of the Response tokens column over the same 215,127 rows. The median is 65, the 90th percentile 650 and the 99.9th 1,489; 0.026 % of the kept rows need more than 8,192 tokens of prompt plus response.`,
  },
]

registerClaims(FIELD_CLAIMS)
