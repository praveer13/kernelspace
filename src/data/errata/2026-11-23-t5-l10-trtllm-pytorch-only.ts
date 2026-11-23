import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t5-l10-trtllm-pytorch-only',
  date: '2026-11-23',
  kind: 'changed',
  lessons: ['t5.l10'],
  title: 'TensorRT-LLM now has only the PyTorch backend, and the comparison table says which cells were checked',
  before:
    'T5.L10 said the PyTorch backend is the default in the 1.x line, named Dynamo v1.5.0 with TRT-LLM 1.3.0rc25, called SGLang the structured-generation specialist on "any CUDA", gave llm-d three founders and left the table undated.',
  after:
    'The TensorRT backend is removed; PyTorch is the sole backend. SGLang is a general engine on NVIDIA, AMD, TPU, Intel, Apple, Ascend and Moore Threads. llm-d is a CNCF sandbox project with five founders. The table names the cells it checked.',
  why: 'The default became the only choice, so "default" now understates the change. An undated engine table goes stale unseen; the table now says which cells were read.',
  supersedes: '2026-10-05-t5-l10-trtllm-pytorch-default',
  source: {
    url: 'https://raw.githubusercontent.com/NVIDIA/TensorRT-LLM/v1.4.0rc4/docs/source/legacy/tensorrt-backend-removal.md',
    title: 'TensorRT LLM v1.4.0rc4 docs: Migration Guide: TensorRT Backend Removed',
  },
} satisfies Erratum
