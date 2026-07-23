import type { SimTask } from '@/components/sims/PlaygroundShell'

export const FRAME_TASKS: SimTask[] = [
  {
    id: 't-frame-trace',
    text: 'Step through `main → add → add` and watch rsp slide; note each frame\'s exact byte layout.',
    xp: 60,
  },
  {
    id: 't-frame-dangle',
    text: 'Return a pointer to a local, then make another call — watch the "dangling" bytes get overwritten.',
    xp: 60,
  },
  {
    id: 't-frame-guard',
    text: 'Recursion depth 1,000,000: find the guard page and read the SIGSEGV the kernel sends.',
    xp: 60,
  },
  {
    id: 't-frame-malloc',
    text: 'Compare the same call in the heap view: what would malloc have cost for the same 8 bytes?',
    xp: 60,
  },
]
