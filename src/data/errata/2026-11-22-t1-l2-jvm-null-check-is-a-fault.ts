import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t1-l2-jvm-null-check-is-a-fault',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t1.l2'],
  title: 'A NullPointerException is often a caught segfault, and 70% is Chromium\'s figure',
  before: 'A NullPointerException was "segfaulting politely": the runtime checks instead of the MMU. The 70% of serious CVEs was credited to Microsoft and Google\'s C/C++ codebases.',
  after: 'Compiled HotSpot code often omits the null test, takes the page fault, and the JVM catches the SIGSEGV and throws the NPE. 70% is Chromium\'s share of high-severity bugs (912 since 2015).',
  why: 'The JVM and C hit the same unmapped page; only the signal handler differs. The 70% is one codebase\'s count, not all CVEs.',
  source: {
    url: 'https://shipilev.net/jvm/anatomy-quarks/25-implicit-null-checks/',
    title: 'JVM Anatomy Quark #25: Implicit Null Checks',
  },
} satisfies Erratum
