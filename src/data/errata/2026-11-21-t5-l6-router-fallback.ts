import type { Erratum } from './schema'

export default {
  id: '2026-11-21-t5-l6-router-fallback',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t5.l6'],
  title: 'The router listing\'s least-loaded fallback could never run',
  before:
    'The listing ended in unwrap_or_else with a join-shortest-queue fallback, taught as running when no worker passes the load guard.',
  after:
    'The least-loaded worker always passes the guard, so the filter is empty only for an empty fleet. The listing now returns Option<usize>, and Reverse(load) picks the least-loaded among equal prefixes.',
  why: 'The guard is the minimum load plus four, so the filtered chain is never empty for a real fleet. The fallback was dead code, and its unwrap would panic on an empty fleet.',
  source: {
    url: 'https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.max_by_key',
    title: 'The Rust standard library, Iterator::max_by_key (returns None if the iterator is empty)',
  },
} satisfies Erratum
