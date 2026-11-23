import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t5-l10-trtllm-pytorch-only',
  date: '2026-11-23',
  kind: 'changed',
  lessons: ['t5.l10'],
  title: 'TensorRT-LLM now has only the PyTorch backend, and the comparison table is dated',
  before:
    'T5.L10 said that in the 1.x line the PyTorch backend is the default, named Dynamo v1.5.0 with TRT-LLM 1.3.0rc25, called SGLang the structured-generation specialist on "any CUDA", and gave the table no date.',
  after:
    'The TensorRT engine backend is removed: PyTorch is the sole backend. SGLang is a general engine listing NVIDIA, AMD, TPU, Intel, Apple, Ascend and Moore Threads platforms. llm-d is a CNCF sandbox project. The table is dated.',
  why: 'The default became the only choice, so "default" now understates the change. An undated engine table goes stale unseen; each cell now names the release it was read at.',
  supersedes: '2026-10-05-t5-l10-trtllm-pytorch-default',
  source: {
    url: 'https://raw.githubusercontent.com/NVIDIA/TensorRT-LLM/v1.4.0rc4/docs/source/legacy/tensorrt-backend-removal.md',
    title: 'TensorRT LLM v1.4.0rc4 docs: Migration Guide: TensorRT Backend Removed',
  },
} satisfies Erratum
