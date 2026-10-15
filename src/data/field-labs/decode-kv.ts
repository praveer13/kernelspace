/**
 * Field lab 1, after t5.l4 (docs/specs/wave-3.md §16.5): batch-1 decode speed and KV-full concurrency, measured on a
 * real vLLM server against the numbers Boot worked out on paper.
 *
 * Both predictions are Boot's arithmetic (`deriveBoot`'s inputs, the same five claims) pointed at the server the
 * pinned commands start: one user decoding streams every weight once per token, so the speed is bandwidth ÷ weight
 * bytes (Boot step 2); the KV cache gets what the memory fraction leaves after the weights, so the concurrency is that
 * ÷ KV bytes per token ÷ the request length (Boot step 4). The first is a ceiling, the second an estimate; the
 * metrics say which, and the verdict wording follows.
 */

import '@/data/claims/lazy/field'
import { BOOT_CLAIM_IDS, BYTES_PER_WEIGHT, CHAT_TOKENS, MAX_GPU_HOURS, fieldInputs, type DerivedRow, type FieldLab } from './types'

/** `--gpu-memory-utilization` and `--max-model-len` in the pinned serve command (field.decode-kv.serve). */
export const UTILIZATION = 0.9
export const MAX_MODEL_LEN = 4096

const C = BOOT_CLAIM_IDS
/** The 128-token prompt and 256 generated tokens of the pinned bench command (field.decode-kv.bench). */
const PROMPT_TOKENS = 128
const OUTPUT_TOKENS = 256

export function decodeKvRows(): DerivedRow[] {
  const i = fieldInputs()
  const weights = i.params * BYTES_PER_WEIGHT
  const decodeTps = i.bandwidth / weights
  // the average context a token is decoded at: the prompt plus half the output
  const kvRead = (PROMPT_TOKENS + OUTPUT_TOKENS / 2) * i.kvPerToken
  const budget = UTILIZATION * i.capacity - weights
  const kvTokens = budget / i.kvPerToken
  return [
    { id: 'weights', label: 'Weight bytes', value: weights / 1e9, unit: 'GB', formula: 'parameters × 2 B', from: [C.params], scenario: '2 bytes per BF16 weight' },
    {
      id: 'decode-tps',
      label: 'One user, one token at a time',
      value: decodeTps,
      unit: 'tok/s',
      formula: 'HBM bandwidth ÷ weight bytes',
      from: [C.bandwidth, C.params],
      scenario: '2 bytes per BF16 weight',
    },
    {
      id: 'kv-share',
      label: 'KV bytes a step reads beside the weights',
      value: (kvRead / weights) * 100,
      unit: '%',
      formula: '(128 + 256 ÷ 2) tokens × KV bytes per token ÷ weight bytes',
      from: [C.kvPerToken, C.params],
      scenario: '2 bytes per BF16 weight; the pinned bench command, 128 tokens in and 256 out',
    },
    {
      id: 'kv-budget',
      label: 'Memory left for the KV cache',
      value: budget / 1e9,
      unit: 'GB',
      formula: '0.90 × HBM capacity − weight bytes',
      from: [C.capacity, C.params],
      scenario: '2 bytes per BF16 weight; --gpu-memory-utilization 0.90 in the pinned serve command',
    },
    {
      id: 'kv-tokens',
      label: 'Tokens of KV cache that fit',
      value: kvTokens,
      unit: 'tokens',
      formula: 'memory left for KV ÷ KV bytes per token',
      from: [C.capacity, C.params, C.kvPerToken],
      scenario: '2 bytes per BF16 weight; --gpu-memory-utilization 0.90',
    },
    {
      id: 'concurrency',
      label: 'Full-length requests the cache holds',
      value: kvTokens / MAX_MODEL_LEN,
      unit: '×',
      formula: 'KV tokens that fit ÷ 4,096',
      from: [C.capacity, C.params, C.kvPerToken],
      scenario: '2 bytes per BF16 weight; --gpu-memory-utilization 0.90 and --max-model-len 4096',
    },
    {
      id: 'boot-chats',
      label: 'What Boot counted, with all 80 GB',
      value: Math.floor((i.capacity - weights) / i.kvPerToken / CHAT_TOKENS),
      unit: 'chats',
      formula: '(HBM capacity − weight bytes) ÷ KV bytes per token ÷ 4,096, rounded down',
      from: [C.capacity, C.params, C.kvPerToken],
      scenario: `2 bytes per BF16 weight; chats of ${CHAT_TOKENS.toLocaleString('en-US')} tokens`,
    },
  ]
}

const ROWS = decodeKvRows()
const value = (id: string): number => ROWS.find((r) => r.id === id)!.value

const LAB: FieldLab = {
  id: 'decode-kv',
  title: 'Decode speed and KV-full concurrency',
  after: { lesson: 't5.l4', title: 'KV Cache Math' },
  blurb: `Boot worked out that one user decodes at ≈${Math.round(value('decode-tps'))} tok/s and that the cache holds about ${Math.round(value('boot-chats') / 10) * 10} chats of ${CHAT_TOKENS.toLocaleString('en-US')} tokens. This lab asks a real vLLM server both questions.`,
  gpuHours: MAX_GPU_HOURS,
  steps: [
    {
      id: 'serve',
      title: 'Start the server',
      claim: 'field.decode-kv.serve',
      note: 'Leave it running. When it prints that it is ready, find the KV cache line it logged while starting up.',
      reads: 'field.decode-kv.kv-log',
    },
    {
      id: 'bench',
      title: 'Decode as one user',
      claim: 'field.decode-kv.bench',
      note: 'In a second terminal. Sixteen requests, one at a time, each 128 tokens in and 256 out.',
      reads: 'field.decode-kv.tpot',
    },
  ],
  rows: ROWS,
  metrics: [
    {
      id: 'tps',
      label: 'decode speed',
      unit: 'tok/s',
      predicted: 'decode-tps',
      kind: 'ceiling',
      entry: {
        label: 'Mean TPOT',
        unit: 'ms',
        hint: 'the "Mean TPOT (ms)" line of the benchmark result',
        reads: 'field.decode-kv.tpot',
        toValue: (ms) => 1000 / ms,
        conversion: 'tokens per second = 1000 ÷ TPOT in ms',
      },
      below:
        'The prediction counts only the weights streaming from HBM, so it is a ceiling. Reaching half of it is ordinary; under half means something else is on the critical path, such as a launch gap between kernels, sampling or the Python loop, and the TPOT of a second run on the same server shows whether it is steady.',
      near: 'Within the 2× band of the roofline, and under it as a ceiling should be: the gap is what streaming the weights does not account for.',
      above:
        'A ceiling should not be beaten. Check that the card is the H100 SXM the claims describe (nvidia-smi), that the model is the 8B one in BF16, and that the number is the TPOT in milliseconds, not the throughput line.',
    },
    {
      id: 'concurrency',
      label: 'KV-full concurrency',
      unit: '×',
      predicted: 'concurrency',
      kind: 'estimate',
      entry: {
        label: 'Maximum concurrency',
        unit: '×',
        hint: 'the number before the x in "Maximum concurrency for 4,096 tokens per request" in the server log',
        reads: 'field.decode-kv.kv-log',
        toValue: (x) => x,
      },
      below:
        'The estimate keeps back only the 10 % the flag reserves and the weights. vLLM also takes out everything its profiling run measures as not KV cache: the weights, the peak of a forward pass and whatever else the process holds. So a reading a little under is expected; far under means the card had less memory free than 80 GB when the server started.',
      near: 'Close to the estimate: the 10 % reserve, the weights and the KV bytes per token explain the cache size.',
      above:
        'More room than the paper count allows. Compare the card\'s memory.total in nvidia-smi with the 80 GB the claim gives: the server budgets a fraction of what the driver reports, not of 80 × 10⁹ bytes.',
    },
  ],
  limits: [
    'One model (Llama-3-8B, BF16) on one card class (80 GB, 3.35 TB/s). On another card, put its bandwidth and memory into the same formulas.',
    'Batch 1 only. How decode speed falls and total throughput rises as the batch grows is Boot\'s roofline, and the next lab\'s subject.',
    'A reading is one run. Run the benchmark twice and enter the second if the first came right after the model loaded.',
  ],
  ranBy: null,
}

export default LAB
