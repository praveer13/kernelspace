import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l10-trtllm-pytorch-default',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l10'],
  title: 'TensorRT-LLM 1.x runs a PyTorch-based runtime by default, not pre-built compiled engines',
  before:
    'T5.L10 taught TensorRT-LLM as a build-time compiler: models become compiled engine artifacts with a pre-planned C++ graph, and compile friction is its defining trade.',
  after:
    'Since 1.0 the PyTorch backend is the default: a Python LLM API over PyExecutor. Speed comes from NVIDIA\'s custom kernels, CUDA graphs and overlap scheduling; the price is NVIDIA-only depth, not compile friction.',
  why: 'The 1.0 release (2025-09-24) had already made PyTorch the default backend when T5.L10 was written, so "compiled engine" described the legacy path. Teaching the old trade sent readers to weigh TRT-LLM against friction it no longer had.',
  source: {
    url: 'https://github.com/NVIDIA/TensorRT-LLM/releases/tag/v1.0.0',
    title: 'TensorRT-LLM v1.0.0 release notes ("the PyTorch-based architecture is now stable and the default experience")',
  },
  items: [
    {
      q: 'TensorRT-LLM 1.0 made its PyTorch backend the default. Which description of its defining trade fits that default path?',
      options: [
        'Pre-built engines compiled ahead of time for each GPU model, at the cost of a build step',
        'NVIDIA-tuned kernels with CUDA graphs and an overlap scheduler on PyTorch trading breadth for depth',
        'A Python runtime with no custom kernels that matches vLLM on coverage but lacks CUDA graphs',
        'A fleet routing layer above the engines that orchestrates KV transfer and needs a second system to run',
      ],
      correct: [1],
      why: [
        'That describes the legacy build-time engine path. In 1.x the default runs on PyTorch, with no compile step required to serve a model.',
        'Right: the default 1.x path is a PyTorch-based runtime with NVIDIA\'s custom kernels, CUDA graphs and overlap scheduling. The price is NVIDIA-only depth, not a build step.',
        'TRT-LLM ships custom attention, GEMM and MoE kernels and uses CUDA graphs. Its edge over vLLM is peak per-GPU speed on NVIDIA, not equal coverage.',
        'That is Dynamo\'s role. TRT-LLM is an engine serving a model on its GPUs; fleet routing and KV transfer sit in a layer around engines.',
      ],
    },
  ],
} satisfies Erratum
