import type { Erratum } from './schema'

export default {
  id: '2026-10-04-eevdf-not-cfs',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t2.l1', 't2.l4', 't3.l4'],
  title: 'Linux schedules with EEVDF, not CFS',
  before:
    '"Linux CFS (what actually schedules your processes)" always runs the smallest vruntime, with "no starvation, ever".',
  after:
    'Since Linux 6.6 EEVDF runs the eligible thread (lag >= 0) with the earliest virtual deadline; real-time and deadline classes can still starve ordinary threads.',
  why: 'EEVDF replaced CFS as the fair-class scheduler in 6.6. The pick rule, the latency knob (requested slice) and the starvation claim all changed, so the lesson, its quiz and the preemption-slice figure were rewritten.',
  source: {
    url: 'https://docs.kernel.org/scheduler/sched-eevdf.html',
    title: 'Linux kernel documentation: EEVDF Scheduler',
  },
} satisfies Erratum
