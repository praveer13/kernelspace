import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t2-l5-biased-locking',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t2.l5'],
  title: 'Biased locking is off by default since JDK 15, so the Java comment is out of date',
  before: 'The Java snippet comment read "synchronized: monitor lock, JVM may bias/thin-lock it".',
  after: 'The comment reads "monitor lock (thin lock, inflating to a heavyweight monitor under contention)". Biased locking is disabled by default since JDK 15 and its options were obsoleted in JDK 18.',
  why: 'JEP 374 disabled biased locking by default in JDK 15. The JDK 18 release notes say its VM options are obsoleted and ignored. Thin locking is what synchronized uses by default.',
  source: {
    url: 'https://openjdk.org/jeps/374',
    title: 'JEP 374: Deprecate and Disable Biased Locking',
  },
} satisfies Erratum
