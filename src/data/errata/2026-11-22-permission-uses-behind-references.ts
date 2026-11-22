import type { Erratum } from './schema'

export default {
  id: '2026-11-22-permission-uses-behind-references',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['r.l3', 'r.l4', 'r.l8', 'r.l9'],
  title: 'Permission diagrams put a use through a reference on the reference itself',
  before:
    'In the Error Museum (E0499, E0502, E0505, E0596, E0594 and others) and in the r.l8 and r.l9 tables, a method call or field access through a reference showed its need on the variable, e.g. v needing RW while v held only RO.',
  after: 'Each such use now sits on the place behind the reference (*v, (*b).ids, *a), whose permissions are the ones it reports; the variable keeps its own R and O.',
  why: 'Permissions belong to places, not just variables. Showing a write need on a read-only reference contradicted the row beside it; rustc itself reports the place as *v.',
  source: {
    url: 'https://rust-book.cs.brown.edu/ch04-02-references-and-borrowing.html',
    title: 'The Rust Programming Language (Brown University edition): References and Borrowing',
  },
} satisfies Erratum
