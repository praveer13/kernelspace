import type { SimTask } from '@/components/sims/PlaygroundShell'

export const LAYOUT_TASKS: SimTask[] = [
  {
    id: 't-layout-aos',
    text: 'Run the deadline sweep on the AoS layout; note effective bandwidth (~1/8 of peak)',
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
    text: 'Enable 64-byte padding and rerun: same code, 10–50× throughput',
    xp: 60,
  },
]
