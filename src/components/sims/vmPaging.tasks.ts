import type { SimTask } from '@/components/sims/PlaygroundShell'
import type { TaskHome } from '@/lib/sims/registry'

/** Rendered by VmPagingSim's `paging` machine (wave-3.md §13); the contention machine lists contentionLab.tasks.ts. */
export const HOME: TaskHome = { simId: 'sim-vm', machine: 'paging' }

export const PAGING_TASKS: SimTask[] = [
  { id: 't-vm-walk4', text: 'Translate 0x7f3a_b2c4_1000 through all four x86-64 page-table levels', xp: 60 },
  { id: 't-vm-minor', text: 'Touch a lazily-allocated page and watch a minor fault install it with no disk I/O', xp: 60 },
  { id: 't-vm-major', text: 'Evict a page to swap, then re-access it and watch a major fault pay disk I/O', xp: 60 },
  { id: 't-vm-frames', text: 'Shrink frames below the working set to find the thrashing cliff', xp: 60 },
  { id: 't-vm-scan', text: 'Run the one-shot scan preset and compare LRU vs Clock fault counts', xp: 60 },
  { id: 't-vm-admit', text: 'Enable admission control and watch the 5th process refused when frames are exhausted', xp: 60 },
  { id: 't-signals', text: 'Cause a TLB hit, a miss, and a fault — name each in the log', xp: 60 },
  { id: 't-locality', text: 'With the 80/20 workload, get TLB hit-rate above 90%', xp: 60 },
  { id: 't-thrash', text: 'Fill memory and watch an evicted page get needed again (thrashing)', xp: 60 },
  { id: 't-pafork', text: 'In PagedAttention mode, fork a sequence and share prefix blocks', xp: 60 },
  { id: 't-vm-cow', text: 'Fork an OS process, then write one page and watch COW copy only that page', xp: 60 },
]
