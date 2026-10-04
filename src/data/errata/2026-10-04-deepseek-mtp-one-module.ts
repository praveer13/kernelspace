import type { Erratum } from './schema'

export default {
  id: '2026-10-04-deepseek-mtp-one-module',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t6.l6'],
  title: 'DeepSeek ships one MTP module; MTP-3 runs it for three draft steps',
  before:
    'DeepSeek-R1\'s MTP-3 was "three MTP modules sharing the target trunk"; MTP depth was "built in at training time", each extra module another layer.',
  after:
    'DeepSeek-V3/R1 ship one MTP module (config num_nextn_predict_layers = 1). Production MTP-3 applies that one module for 3 draft steps, and acceptance falls with each step.',
  why: 'Draft length is a serving-time choice, not extra trained layers. Each extra step reruns the module on the critical path and predicts further ahead than it was trained for, so alpha drops.',
  source: {
    url: 'https://huggingface.co/deepseek-ai/DeepSeek-V3/blob/main/config.json',
    title: 'DeepSeek-V3 config.json (num_nextn_predict_layers: 1)',
  },
} satisfies Erratum
