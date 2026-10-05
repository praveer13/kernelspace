import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l3-inferencemax-deepseek-attribution',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l3'],
  title: 'T7.L3 InferenceX figures are now tied to the InferenceMAX launch article',
  before:
    'T7.L3 credited "GB200 NVL72 leads" and "a single B200 node wins at high interactivity" on DeepSeek-R1 to InferenceX, and quoted gpt-oss "60k tok/s/GPU" and Llama-3.3-70B figures.',
  after:
    'On DeepSeek-R1 FP4, SemiAnalysis\'s InferenceMAX launch (2025-10-09) has a B200 on TRT-LLM beating the GB200 NVL72 above 90 tok/s/user. The gpt-oss and Llama figures were not in it, so they are dropped.',
  why: 'A benchmark claim needs a run or article behind it. The DeepSeek-R1 split is stated in the launch article; the gpt-oss and Llama numbers could not be found in it or in the repository README.',
  source: {
    url: 'https://newsletter.semianalysis.com/p/inferencemax-open-source-inference',
    title: 'SemiAnalysis: InferenceMAX, Open Source Inference Benchmarking (2025-10-09; DeepSeek R1 FP4, B200 versus GB200 NVL72)',
  },
  items: [
    {
      q: 'On DeepSeek-R1 FP4, InferenceMAX shows a GB200 NVL72 leading at 30 tok/s/user and a single B200 node beating it above 90. How do both hold?',
      options: [
        'They sit in different regions of one frontier: the rack leads at the throughput end, the node at the interactivity end',
        'They used different models, so the frontier for DeepSeek-R1 differs from the frontier of the smaller model tested',
        'One result is a harness artifact, and a rerun at identical settings would put the rack ahead at every interactivity level',
        'They differ in cost basis, because the node wins only when its GPUs are priced below the rack-scale provisioned rate',
      ],
      correct: [0],
      why: [
        'Right: the ends of a frontier exclude each other. The rack amortizes weights across giant batches at low interactivity, while above 90 tok/s/user a single node with small batches does better.',
        'Both results are DeepSeek-R1 FP4, so model choice does not explain them. The split comes from the operating point on one frontier, not from a different workload.',
        'The runs are public and the article reports the crossover as a result, not a flaw. A frontier has a different winner per region, so a rerun would not make the rack win everywhere.',
        'Cost basis is not what flips the order. The comparison is across interactivity levels on one frontier, so the node beating the rack above 90 tok/s/user is a region effect.',
      ],
    },
  ],
} satisfies Erratum
