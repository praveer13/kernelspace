import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t6-l5-fp4-activations-vary-by-recipe',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t6.l5'],
  title: 'FP4 recipes are not all weight-only: NVIDIA\'s DeepSeek-R1-FP4 quantizes activations too',
  before:
    'T6.L5 taught that weight-only FP4 with BF16/FP8 activations is the production recipe, and that "activations stay wider in the shipped recipes".',
  after:
    'Recipes differ: NVIDIA\'s DeepSeek-R1-FP4 quantizes weights and activations of the linear operators; Kimi K3 pairs MXFP4 weights with MXFP8 activations; vLLM v0.30 serves NVFP4 W4A16 checkpoints on SM100 via FlashInfer\'s CuTe DSL.',
  why: 'The lesson\'s own flagship example contradicts "weights only". Activations stay the riskier tensor, but whether they drop to 4 bits is a per-recipe choice, not a rule.',
  source: {
    url: 'https://huggingface.co/nvidia/DeepSeek-R1-FP4',
    title: 'NVIDIA DeepSeek-R1-FP4 model card ("only the weights and activations of the linear operators within transformers blocks are quantized")',
  },
  items: [
    {
      q: 'NVIDIA\'s DeepSeek-R1-FP4 checkpoint is the FP4 lesson\'s flagship example. According to its model card, what is quantized to FP4?',
      options: [
        'The weights alone with activations kept in BF16 or FP8 in the shipped recipes',
        'The weights and activations of the linear operators in the transformer at FP4',
        'Each tensor in the model from embeddings to the KV cache and output layer at FP4',
        'The expert weights of the MoE layers with dense layers and activations left in BF16',
      ],
      correct: [1],
      why: [
        'The card quantizes weights and activations of the linear operators. Weight-only W4A16 is one recipe among several, not a rule for every shipped model.',
        'Right: the card says only the weights and activations of the linear operators within the transformer blocks are quantized to FP4, so activations are included.',
        'The card limits quantization to linear operators in the transformer blocks, so other tensors keep their original precision. Quantizing everything is not what ships.',
        'The card does not restrict FP4 to expert weights. It covers linear operators across the transformer blocks, and their activations as well.',
      ],
    },
  ],
} satisfies Erratum
