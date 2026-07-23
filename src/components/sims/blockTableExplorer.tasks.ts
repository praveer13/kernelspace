import type { SimTask } from '@/components/sims/PlaygroundShell'

export const BLOCK_TABLE_EXPLORER_TASKS: SimTask[] = [
  {
    id: 't-blk-share',
    text: 'Run two requests sharing a 48-token prompt: verify prefix blocks show refcount=2 and memory is paid once.',
    xp: 60,
  },
  {
    id: 't-blk-cow',
    text: 'Fork a beam inside a full block: watch the COW allocate one block and copy 16 tokens of KV.',
    xp: 60,
  },
  {
    id: 't-blk-preempt',
    text: 'Drive the free queue to zero: trigger preemption — compare swap-to-CPU vs recompute on TTFT.',
    xp: 60,
  },
  {
    id: 't-blk-sweep',
    text: 'Sweep block size 4 → 64: plot tail waste vs table overhead; locate why 16 is the default.',
    xp: 60,
  },
]
