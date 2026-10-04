import type { Erratum } from './schema'

export default {
  id: '2026-10-04-priority-inversion-analogy',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t2.l4'],
  title: 'Priority inversion is not head-of-line blocking',
  before:
    'Isomorphism pair: "priority inversion" is the OS twin of "head-of-line / preemption", where long sequences hog batch slots.',
  after:
    'Head-of-line blocking maps to static batching. Priority inversion maps to a low-priority request holding KV blocks a high-priority one needs, resolved by preemption rather than inheritance.',
  why: 'Inversion needs a lock holder that a lower-priority task keeps from running. A long job ahead in a queue is a different failure, so the pair was split and each now states where it stops holding.',
} satisfies Erratum
