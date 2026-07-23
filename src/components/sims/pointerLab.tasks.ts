import type { SimTask } from '@/components/sims/PlaygroundShell'

export const POINTER_LAB_TASKS: SimTask[] = [
  {
    id: 't-pointer-offset',
    text: 'Allocate `long vals[4]`; set and read `*(p+2)` exactly 16 bytes from the base.',
    xp: 60,
  },
  {
    id: 't-pointer-double',
    text: 'Build `long **pp` and follow both hops: pp → p → value.',
    xp: 60,
  },
  {
    id: 't-pointer-oob',
    text: 'Read one element past the array and distinguish mapped memory from valid memory.',
    xp: 60,
  },
  {
    id: 't-pointer-null',
    text: 'Dereference NULL and trace MMU → kernel → SIGSEGV → core dumped.',
    xp: 60,
  },
]
