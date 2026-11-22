import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t6-l2-eplb-not-consistent-hashing',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t6.l2'],
  title: 'EPLB is replication plus bin-packing, not consistent hashing',
  before: 'The lesson said EPLB "really is consistent hashing with live rebalancing" and mapped it to consistent hashing plus hot-key replication.',
  after: 'EPLB duplicates heavily loaded experts ("redundant experts") and packs the copies onto GPUs heuristically, with a hierarchical policy for prefill and a global one for decode. No hashing is involved.',
  why: 'A hash fixes placement from the key; EPLB computes placement from measured load. The wrong analogy would send a learner looking for a hash ring that is not there.',
  source: {
    url: 'https://github.com/deepseek-ai/EPLB/blob/d52c72d5b2f2fb4c41afbf8eb21366820239913d/README.md',
    title: 'DeepSeek EPLB README',
  },
} satisfies Erratum
