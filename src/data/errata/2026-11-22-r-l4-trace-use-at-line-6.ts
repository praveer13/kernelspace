import type { Erratum } from './schema'

export default {
  id: '2026-11-22-r-l4-trace-use-at-line-6',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['r.l4'],
  title: 'The r.l4 permission table put a write need on the read-only reference',
  before: 'In the shared-then-exclusive table, the use at line 6 (all.push) needed RW on the path all, which holds only RO there.',
  after: 'The use at line 6 now sits on *all, the path that holds RW and is written through; all itself stays RO.',
  why: 'A table that asks a read-only reference for a write contradicts the rule it teaches: only the path behind an exclusive reference carries the write.',
  source: {
    url: 'https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html',
    title: 'The Rust Programming Language: References and Borrowing',
  },
} satisfies Erratum
