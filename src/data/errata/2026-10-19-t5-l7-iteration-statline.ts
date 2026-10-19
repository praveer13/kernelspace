import type { Erratum } from './schema'

export default {
  id: '2026-10-19-t5-l7-iteration-statline',
  date: '2026-10-19',
  kind: 'error',
  lessons: ['t5.l7'],
  title: 'InferenceX measured 11.8 ms per output token, not "~50 ms"; the Fleet\'s 50 ms tick is a teaching unit',
  before:
    'T5.L7\'s statline gave "~50 ms · one iteration" for a decode step of a mid-size model and batch, with no source.',
  after:
    'InferenceX measured a mean 11.8 ms per output token for Llama-3.3-70B FP8 on 4 H100s with 4 users (id 41187), over the steps after a user\'s first token, other requests\' prefills included. The Fleet\'s flat 50 ms tick is a teaching unit.',
  why: 'The 50 ms figure had no source and was about four times the measured mean. Steps vary with model, GPUs and batch, so the lesson cites one measurement, says what it averages, and names the tick.',
  source: {
    url: 'https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true',
    title: 'InferenceX API: Llama-3.3-70B-Instruct-FP8 benchmarks of 2025-10-29 (mean_tpot of id 41187)',
  },
  items: [
    {
      q: 'The Fleet moves its batch forward on a flat 50 ms tick. What is that tick?',
      options: [
        'A teaching unit, and a measured mean was 11.8 ms per token at 4 users',
        'A measured figure, the mean decode step of a 70B model on 4 H100s at 4 users',
        'A floor, the least time any decode step can take at the datasheet bandwidth',
        'A vLLM default, the scheduling quantum the engine waits for between steps',
      ],
      correct: [0],
      why: [
        'Right: InferenceX measured a mean TPOT of 11.78 ms for that setup (id 41187). The Fleet keeps a flat tick as a unit of play, labelled physics v1, not as a step time.',
        'The measured mean for that setup was 11.78 ms (InferenceX id 41187), about a quarter of the tick. The tick was never sourced.',
        'A floor would sit below every measurement, and the datasheet bound for that setup is 5.33 ms. The tick is a round unit of play, not a bound.',
        'vLLM does not wait on a clock between steps: it schedules the next step when the last one ends, so a step lasts as long as its work.',
      ],
    },
  ],
} satisfies Erratum
