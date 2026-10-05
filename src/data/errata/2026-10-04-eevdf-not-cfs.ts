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
  items: [
    {
      q: 'Since Linux 6.6, which runnable thread does the fair scheduling class pick next?',
      options: [
        'The eligible thread with the earliest virtual deadline',
        'The runnable thread with the smallest vruntime as in the old scheduler',
        'The thread with the largest positive lag whether eligible or not',
        'The thread with the shortest requested slice whatever its lag is',
      ],
      correct: [0],
      why: [
        'Right: EEVDF only considers eligible threads (lag of zero or more) and runs the one whose virtual deadline is earliest.',
        'That is the CFS rule. EEVDF replaced it in 6.6 with eligibility plus earliest virtual deadline.',
        'Lag decides eligibility, not the pick. Among eligible threads the choice is by virtual deadline.',
        'A short requested slice gives an earlier deadline, but a thread must be eligible first, so slice alone does not pick.',
      ],
    },
    {
      q: 'Under EEVDF, what can still starve ordinary fair-class threads?',
      options: [
        'A fair-class thread that requests a very long time slice',
        'No thread given the fair class guarantee against starvation',
        'A real-time thread that spins without blocking or yielding',
        'A fair-class thread whose lag stays negative for a long time',
      ],
      correct: [2],
      why: [
        'A long requested slice gives a later virtual deadline, so that thread waits longer; it does not take the CPU from others.',
        'That was the old CFS claim. Real-time and deadline classes sit above the fair class and can starve it.',
        'Right: real-time and deadline classes outrank the fair class, so a real-time thread that never blocks can starve ordinary threads.',
        'Negative lag makes that thread ineligible, which delays it. It does not stop other fair threads from running.',
      ],
    },
  ],
} satisfies Erratum
