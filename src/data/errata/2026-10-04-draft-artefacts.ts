import type { Erratum } from './schema'

export default {
  id: '2026-10-04-draft-artefacts',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t5.l5', 't2.l7'],
  title: 'Two lesson sentences still carried mid-draft self-corrections',
  before:
    'T5.L5: "128 KB/token… wait, per-block bytes = 16 × 128 KB = 2 MB per block". T2.L7: "…compressed oops… no wait — swapping is literally swapping."',
  after:
    'T5.L5: "128 KB of KV per token, so one block holds 16 × 128 KB = 2 MB". T2.L7: "swapping = the OS paging cold heap out to disk", which is what the paper\'s swap policy does.',
  why: 'Drafting notes had shipped as learner-facing prose. The arithmetic was already right (T5.L4: 128 KB per token × 16 tokens = 2 MB per block); only the wording changed.',
} satisfies Erratum
