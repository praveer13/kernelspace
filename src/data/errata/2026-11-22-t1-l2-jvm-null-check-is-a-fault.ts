import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t1-l2-jvm-null-check-is-a-fault',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t1.l2'],
  title: 'A NullPointerException is often a caught segfault; the 70% is now cited to Chromium\'s page',
  before: 'A NullPointerException was "segfaulting politely": the runtime checks instead of the MMU. The 70% of serious CVEs was credited to Microsoft and Google\'s C/C++ codebases.',
  after: 'Compiled HotSpot code often omits the null test, lets the load fault, and the JVM catches the SIGSEGV and throws the NPE. 70% is Chromium\'s share of its high-severity security bugs.',
  why: 'Compiled HotSpot code often lets a null access fault and catches the SIGSEGV; the JIT switches to an explicit test where nulls turn out common. Microsoft\'s figure for the 70% was not re-read, so the course no longer cites it.',
  source: {
    url: 'https://shipilev.net/jvm/anatomy-quarks/25-implicit-null-checks/',
    title: 'JVM Anatomy Quark #25: Implicit Null Checks',
  },
} satisfies Erratum
