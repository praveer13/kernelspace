import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t2-l5-aba-head-is-freed-b',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t2.l5'],
  title: 'In the ABA figure, B is not lost: the stale CAS makes the freed node B the head',
  before: 'The ABA figure\'s last node read "CAS succeeds ✗ — B is lost — corruption".',
  after: 'The node reads "head = B (freed!)". Thread 1\'s CAS(head, A → B) succeeds because head is A again, so it sets head = B, a node thread 2 had already popped and freed.',
  why: 'A compare-and-swap checks only that the value is A again, not that nothing changed in between. The stale CAS installs the next pointer it read, B, which thread 2 had popped, as the head.',
  source: {
    url: 'https://www.cs.rochester.edu/u/scott/papers/1996_PODC_queues.pdf',
    title: 'Michael and Scott, Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms (PODC 1996)',
  },
} satisfies Erratum
