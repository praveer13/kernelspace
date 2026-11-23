import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t3-l7-io-uring-from-rust',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t3.l7'],
  title: 'A C ABI asks for free C interop, not for C: io_uring is driven from Rust too; the 70% figure is Chromium\'s',
  before:
    'io_uring / eBPF glue: "the kernel\'s ABI is C, so C". The exit ticket graded "the glue is C". "~70% of serious CVEs" were memory-safety issues.',
  after:
    'A C ABI selects for any language with free C interop: Rust drives io_uring through the io-uring crate, and eBPF programs are written in restricted C or in Rust (Aya). The 70% is Chromium\'s count of its high-severity bugs.',
  why: 'The ticket idea keeps its place, so an old tick on it now shows the new wording. The 70% was never a share of all CVEs; it is one C++ codebase\'s count.',
  source: {
    url: 'https://github.com/tokio-rs/io-uring',
    title: 'io-uring crate README: the low-level io_uring userspace interface for Rust',
  },
} satisfies Erratum
