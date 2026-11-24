import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t3-l4-task-state-is-its-live-locals',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t3.l4'],
  title: 'A task holds the locals live across its awaits, so a socket-reading task is about a kilobyte, not 300 bytes',
  before: 'A task is just a resumable function with ~300 B of state.',
  after:
    "A task is just a resumable function whose state is the locals live across its awaits: about 1 KiB for T2.L6's echo task, most of it the read buffer.",
  why: 'The read buffer is live across the read await, so the compiler stores it in the future. The size follows the locals, as T2.L6 and its correction say.',
  source: {
    url: 'https://doc.rust-lang.org/1.96.0/reference/expressions/block-expr.html#r-expr.block.async.layout-unspecified',
    title: 'The Rust Reference, Rust 1.96.0: Block expressions, async blocks',
  },
} satisfies Erratum
