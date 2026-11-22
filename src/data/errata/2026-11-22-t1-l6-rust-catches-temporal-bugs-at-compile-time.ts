import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t1-l6-rust-catches-temporal-bugs-at-compile-time',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t1.l6'],
  title: 'Rust rejects temporal bugs and data races at compile time; bounds are checked at run time',
  before: 'The lesson said Rust catches all of the above at compile time with zero runtime cost, and called 70% a Microsoft and Google figure.',
  after: 'Use after free, double free, dangling references and data races fail to compile. Out-of-bounds indexing panics at run time and Rc cycles can leak. The 70% is Chromium\'s share of high-severity bugs.',
  why: 'Bounds checks run at run time, as in Java, and safe Rust can leak. The lesson\'s own quiz said so. Chromium\'s page gives the 70%; Microsoft was not re-read.',
  source: {
    url: 'https://www.chromium.org/Home/chromium-security/memory-safety/',
    title: 'Chromium Security: Memory safety',
  },
} satisfies Erratum
