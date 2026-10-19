import type { Erratum } from './schema'

export default {
  id: '2026-10-19-t5-l3-itl-kit',
  date: '2026-10-19',
  kind: 'error',
  lessons: ['t5.l3'],
  title: 'ITL is the whole decode step, at least bytes ÷ bandwidth, not that divided by batch',
  before:
    'T5.L3\'s estimation kit said "ITL ≈ (weight_bytes + KV_bytes_per_token × batch) / bandwidth / batch … i.e., per-token time stays ~flat while throughput × batch".',
  after:
    'Every user waits the whole step: at least (weights + KV per token × Σ context) ÷ the GPUs\' bandwidth (the datasheet bound), not that ÷ batch. H100 TP 4, 1k/1k: 11.78 ms at 4 users, 19.51 ms at 64 (ids 41187, 41821), 2.2× and 3.1× the bound',
  why: 'Each step gives every user one token, so dividing by batch gives the GPUs\' cost per token, not a user\'s pace. The KV term counts all context, and the datasheet rate only bounds the step from below.',
  source: {
    url: 'https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true',
    title: 'InferenceX API: Llama-3.3-70B-Instruct-FP8 benchmarks of 2025-10-29 (mean_tpot of ids 41187 and 41821)',
  },
  items: [
    {
      q: 'One decode step on 4 GPUs streams the weights and the KV cache of 16 users, and each user gets one token from it. What is one user\'s ITL?',
      options: [
        'The step time divided by 16, the share of one step that each token costs',
        'The full step time, as each of the 16 users waits for the step to finish',
        'The step time divided by 4, one quarter for each GPU that serves the users',
        'The step time times 16, with the users taking turns through the batch',
      ],
      correct: [1],
      why: [
        'That is what the GPUs spend per token, a throughput figure. No user gets a token every sixteenth of a step: each user\'s next token comes out of the next step.',
        'Right: one step makes one token for every user in the batch, so each user\'s tokens arrive one step apart. Batching raises the tokens per step, not the pace each user sees.',
        'Tensor parallelism splits every layer across the 4 GPUs, and all of them work on every user in the same step. More GPUs shorten the step; they do not share it out among users.',
        'Continuous batching advances every running user in the same step, not in turns, so each user gets a token every step rather than every 16th one.',
      ],
    },
    {
      q: 'In the bound on one decode step, the bytes read are the weights plus the KV bytes per token times a count. At 16 users, what is that count?',
      options: [
        'The batch size, 16, one cached token for each user in the step',
        'The context tokens of the 16 users, summed across the whole batch',
        'The longest context among the 16, the user whose cache is biggest',
        'The 16 new tokens of the step, since older entries stay on chip',
      ],
      correct: [1],
      why: [
        'Attention for each new token reads that user\'s whole cache, not one entry, so the KV bytes grow with every token each user has seen.',
        'Right: each user\'s new token attends to all of that user\'s cached tokens, so the step reads KV bytes per token times the context summed over the batch.',
        'Every user\'s cache is read in the same step, not just the biggest one, so the counts add up across the batch.',
        'Older entries do not stay on chip: each user\'s KV cache lives in HBM and is re-read every step, so the count grows with the context, not with the new tokens.',
      ],
    },
  ],
} satisfies Erratum
