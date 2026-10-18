/**
 * Field lab 2, after t5.l7 (docs/specs/wave-3.md §16.5): vLLM's own benchmark CLI driving a real server with BurstGPT's
 * request shapes, against a roofline ceiling worked from the means of the pinned file.
 *
 * What the CLI replays is narrower than the Fleet's recorded hour, and the lab says so (`limits`, and the
 * field.burstgpt.loader claim): vLLM's loader keeps GPT-4 rows, draws 480 at random and reads only the two token
 * counts, never the timestamps, and `--request-rate inf` sends them all at once. So the run measures how fast the
 * engine drains BurstGPT-shaped work when it is saturated, which is a throughput ceiling question, not an arrival-burst one.
 *
 * The prediction is a ceiling from two walls, each in tokens per second of output. Compute: every output token carries
 * the FLOPs of its own decode step and its share of the prompt (the prompt is ~3× the response in the mean), so the
 * math sets FLOPS ÷ (2 · params · (1 + prompt ÷ response)). Memory: each decode step streams the weights once for the
 * whole batch and reads each running request's KV, so bytes per output token are weights ÷ batch + the average context
 * × KV bytes per token (+ the prompt's KV written once per request). The run cannot beat the lower of the two.
 */

import '@/data/claims/lazy/field'
import { claimNumber } from '@/data/claims'
import { BOOT_CLAIM_IDS, BYTES_PER_WEIGHT, MAX_GPU_HOURS, fieldInputs, type DerivedRow, type FieldLab } from './types'

/** `--num-prompts` in the pinned bench command (field.burstgpt.bench); also the Fleet slice's request count. */
export const NUM_PROMPTS = 480

const C = BOOT_CLAIM_IDS
const MEAN_IN = 'field.burstgpt.mean-request-tokens'
const MEAN_OUT = 'field.burstgpt.mean-response-tokens'
const MAX_SEQS = 'production.vllm.max-num-seqs'

export function burstgptRows(): DerivedRow[] {
  const i = fieldInputs()
  const meanIn = claimNumber(MEAN_IN)
  const meanOut = claimNumber(MEAN_OUT)
  const weights = i.params * BYTES_PER_WEIGHT
  const flopPerOut = 2 * i.params * (1 + meanIn / meanOut)
  const compute = i.flops / flopPerOut
  // all 480 requests are in flight at the start; the engine admits up to max_num_seqs of them
  const batch = Math.min(NUM_PROMPTS, claimNumber(MAX_SEQS))
  const decodeContext = meanIn + meanOut / 2
  const bytesPerOut = weights / batch + (decodeContext + meanIn / meanOut) * i.kvPerToken
  const memory = i.bandwidth / bytesPerOut
  return [
    {
      id: 'flop-per-token',
      label: 'FLOPs behind one output token',
      value: flopPerOut / 1e9,
      unit: 'GFLOP',
      formula: '2 · parameters · (1 + mean request tokens ÷ mean response tokens)',
      from: [C.params, MEAN_IN, MEAN_OUT],
    },
    {
      id: 'compute-ceiling',
      label: 'Output rate if only the math limits',
      value: compute,
      unit: 'tok/s',
      formula: 'BF16 FLOPS ÷ FLOPs behind one output token',
      from: [C.flops, C.params, MEAN_IN, MEAN_OUT],
    },
    {
      id: 'batch',
      label: 'Requests in flight at the start',
      value: batch,
      unit: 'requests',
      formula: 'the smaller of 480 prompts and vLLM\'s max_num_seqs',
      from: [MAX_SEQS],
      scenario: '480 prompts, all sent at time 0 (--request-rate inf)',
    },
    {
      id: 'bytes-per-token',
      label: 'HBM bytes behind one output token',
      value: bytesPerOut / 1e6,
      unit: 'MB',
      formula: 'weight bytes ÷ batch + (mean request + mean response ÷ 2 + mean request ÷ mean response) × KV bytes per token',
      from: [C.params, C.kvPerToken, MEAN_IN, MEAN_OUT, MAX_SEQS],
      scenario: '2 bytes per BF16 weight; 480 prompts at time 0',
    },
    {
      id: 'memory-ceiling',
      label: 'Output rate if only HBM limits',
      value: memory,
      unit: 'tok/s',
      formula: 'HBM bandwidth ÷ HBM bytes behind one output token',
      from: [C.bandwidth, C.params, C.kvPerToken, MEAN_IN, MEAN_OUT, MAX_SEQS],
      scenario: '2 bytes per BF16 weight; 480 prompts at time 0',
    },
    {
      id: 'ceiling',
      label: 'Saturated output rate, ceiling',
      value: Math.min(compute, memory),
      unit: 'tok/s',
      formula: 'the lower of the two rates above',
      from: [C.flops, C.bandwidth, C.params, C.kvPerToken, MEAN_IN, MEAN_OUT, MAX_SEQS],
      scenario: '2 bytes per BF16 weight; 480 prompts at time 0',
    },
  ]
}

const LAB: FieldLab = {
  id: 'burstgpt-replay',
  title: 'The BurstGPT replay',
  after: { lesson: 't5.l7', title: 'Continuous Batching' },
  blurb:
    'Continuous batching keeps the GPU full by refilling the batch every iteration. This lab hands vLLM 480 BurstGPT requests at once, the Fleet\'s count, and compares how fast it drains them with what the roofline allows.',
  gpuHours: MAX_GPU_HOURS,
  steps: [
    {
      id: 'fetch',
      title: 'Get the pinned file',
      claim: 'field.burstgpt.fetch',
      note: 'The hash check is part of the command. If it does not print OK, stop and fetch again.',
    },
    {
      id: 'serve',
      title: 'Start the server',
      claim: 'field.burstgpt.serve',
      note: 'Leave it running until the benchmark finishes.',
    },
    {
      id: 'bench',
      title: 'Replay the 480 requests',
      claim: 'field.burstgpt.bench',
      note: 'In a second terminal. It finishes in a minute or two; read "Failed requests" first, then the output throughput.',
      reads: 'field.burstgpt.out-tps',
    },
  ],
  rows: burstgptRows(),
  metrics: [
    {
      id: 'out-tps',
      label: 'saturated output rate',
      unit: 'tok/s',
      predicted: 'ceiling',
      kind: 'ceiling',
      entry: {
        label: 'Output token throughput',
        unit: 'tok/s',
        hint: 'the "Output token throughput (tok/s)" line of the benchmark result',
        reads: 'field.burstgpt.out-tps',
        toValue: (x) => x,
      },
      below:
        'The ceiling treats the batch as full from the first token to the last. The run does not: the longest responses keep decoding after most requests have finished, at a batch far below 480, where the weights are streamed for a few tokens at a time. Add the scheduler, attention kernels that do not reach peak FLOPS and sampling, and a run under half the ceiling is a real finding, not a mistake. "Benchmark duration" and "Total generated tokens" in the output give you the tail: divide the tokens by the duration and compare it with the ceiling again.',
      near: 'Within 2× of the ceiling, and under it, as a ceiling should be. The gap is the tail and the overhead the roofline does not count.',
      above:
        'A ceiling should not be beaten. Check that the card is the H100 SXM the claims describe (nvidia-smi), that "Failed requests" reads 0, and that the number is the output line, not the total token throughput, which counts the prompts too.',
    },
  ],
  limits: [
    'Token lengths, not arrival times. vLLM\'s loader keeps the GPT-4 rows with a positive response, draws 480 at random and never reads the Timestamp column; the Fleet\'s recorded busiest hour keeps the timing.',
    'All requests at time 0. That is saturation. Bursts need a finite --request-rate, and the CLI\'s --burstiness shapes a made-up Poisson or gamma process, not BurstGPT\'s own.',
    'The prediction uses the means of every kept row. Your 480 are a draw, and the "Total input tokens" and "Total generated tokens" lines tell you how far this draw sits from those means.',
    'About 1 request in 3,800 of the kept rows needs more than 8,192 tokens of prompt plus response; if a draw includes one, the server refuses it and "Failed requests" reads 1.',
  ],
  ranBy: null,
}

export default LAB
