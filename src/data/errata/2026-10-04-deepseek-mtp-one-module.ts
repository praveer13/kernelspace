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
  items: [
    {
      q: 'DeepSeek-V3 and R1 ship one MTP module. What does MTP-3 mean in production?',
      options: [
        'Three separately trained MTP modules that share the target trunk',
        'One module run for 3 draft steps, with acceptance falling',
        'One module trained to emit three tokens at once in a single forward pass',
        'Three layers of the trunk are reused as drafters at serving time',
      ],
      correct: [1],
      why: [
        'The checkpoint config has num_nextn_predict_layers = 1, so there is a single trained module.',
        'Right: draft length is a serving choice. Each extra step reruns the module on the critical path, further ahead than it was trained for, so alpha drops.',
        'The module predicts one token per application. Longer drafts come from applying it repeatedly, not from a wider output.',
        'The drafter is the MTP module, not borrowed trunk layers.',
      ],
    },
  ],
} satisfies Erratum
