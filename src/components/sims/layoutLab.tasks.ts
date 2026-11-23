import type { SimTask } from '@/components/sims/PlaygroundShell'

export const LAYOUT_TASKS: SimTask[] = [
  {
    id: 't-layout-aos',
    text: 'Run the deadline sweep on the AoS layout; note effective bandwidth (~1/4 of peak)',
    xp: 60,
  },
  {
    id: 't-layout-soa',
    text: 'Switch to SoA and rerun — watch bandwidth approach the DRAM roof',
    xp: 60,
  },
  {
    id: 't-layout-false',
    text: 'Run the 8-thread counter without padding; watch the line ping-pong counter explode',
    xp: 60,
  },
  {
    id: 't-layout-pad',
    text: 'Enable 64-byte padding and rerun: same code, several times the throughput (the simulator is a model and shows about 38×; the run measured for this lesson gave 5–8×)',
    xp: 60,
  },
]
