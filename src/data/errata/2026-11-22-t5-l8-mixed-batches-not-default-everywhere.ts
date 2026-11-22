import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l8-mixed-batches-not-default-everywhere',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l8'],
  title: 'Only vLLM mixes prefill and decode by default; SGLang chunks but mixes on request',
  before: 'Every modern engine (vLLM, SGLang, TRT-LLM) runs mixed prefill and decode batches by default.',
  after: 'vLLM chunks prefill and batches it with decodes by default. SGLang chunks by default but mixes only with enable_mixed_chunk (False). TensorRT-LLM leaves enable_chunked_prefill False.',
  why: 'The engines\' own argument definitions: SGLang v0.5.23 sets enable_mixed_chunk to False, and TensorRT-LLM v1.4.0rc4 sets enable_chunked_prefill to False. The lesson claimed a default two of three do not have.',
  source: {
    url: 'https://github.com/sgl-project/sglang/blob/v0.5.23/python/sglang/srt/arg_groups/fields/schedule.py',
    title: 'SGLang v0.5.23 schedule.py',
  },
} satisfies Erratum
