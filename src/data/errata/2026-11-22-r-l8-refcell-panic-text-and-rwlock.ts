import type { Erratum } from './schema'

export default {
  id: '2026-11-22-r-l8-refcell-panic-text-and-rwlock',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['r.l8'],
  title: 'RefCell panics with "RefCell already borrowed", and RwLock is the cross-thread twin',
  before: 'A conflicting RefCell borrow was said to panic with "BorrowMutError", and Mutex was presented as the cross-thread version of RefCell\'s rule.',
  after: 'The panic reads "RefCell already borrowed". BorrowMutError is the error type try_borrow_mut returns. RwLock (many readers or one writer) is the counterpart of RefCell; Mutex is the exclusive-only case.',
  why: 'Compiling and running the lesson\'s snippet on rustc 1.96.0 prints the panic line shown; RwLock documents the readers-or-writer law.',
  source: {
    url: 'https://doc.rust-lang.org/std/sync/struct.RwLock.html',
    title: 'std::sync::RwLock',
  },
} satisfies Erratum
