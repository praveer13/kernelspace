import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t0-l6-cpu-profiles-miss-parked-threads',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t0.l6'],
  title: 'A CPU flame graph does not show threads parked on a lock; a wall-clock profile does',
  before:
    'The lesson taught that a wide futex or mutex-wait bar in a flame graph made with the listed CPU profilers is genuine wait time.',
  after:
    'CPU profilers sample on-CPU stacks, so a parked thread takes no samples. Waiting shows in a wall-clock profile (async-profiler -e wall, py-spy --idle) or an off-CPU flame graph.',
  why: 'A learner who profiles a contended program with the commands taught would see no wide wait bar and could conclude there is no contention.',
  source: {
    url: 'https://www.brendangregg.com/offcpuanalysis.html',
    title: 'Brendan Gregg, Off-CPU Analysis: CPU sampling "doesn\'t gather data when the application has blocked and is waiting off-CPU."',
  },
} satisfies Erratum
