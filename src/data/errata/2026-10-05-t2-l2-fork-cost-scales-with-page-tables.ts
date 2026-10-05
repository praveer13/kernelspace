import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t2-l2-fork-cost-scales-with-page-tables',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t2.l2'],
  title: 'fork() copies page tables, so its cost still grows with mapped memory, at about 1/512 of it',
  before:
    'The T2.L2 quiz feedback said modern fork "copies page tables and marks pages read-only, so cost scales with mapped regions, not with data size".',
  after:
    'fork() copies the page tables and marks pages read-only. Its cost scales with the page tables, about 1/512 of the mapped memory with 4 KiB pages, so it still grows with data size, far more slowly than copying the data.',
  why: 'Each 8 B entry maps a 4 KiB page, so the tables are 1/512 of the mapped memory. Redis must copy a 48 MB page table to fork a 24 GB instance, which takes noticeable time.',
  source: {
    url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/',
    title: 'Redis latency docs (a 24 GB instance has a 48 MB page table, 24 GB / 4 kB * 8, which fork must allocate and copy)',
  },
  items: [
    {
      q: 'A process maps 24 GiB with 4 KiB pages and calls fork(). Roughly how much does the kernel copy?',
      options: [
        'All 24 GiB of data, giving the child a private copy of each 4 KiB page at fork time',
        'About 96 MiB of page tables, one complete set each for the parent and for the child',
        'Nothing at all, deferring every copy until either process first writes to a 4 KiB page',
        'About 48 MiB of page tables, one 8-byte entry for every page that the parent maps',
      ],
      correct: [3],
      why: [
        'That is what early Unix did. Modern fork copies only the page tables and marks pages read-only, so the 24 GiB of data stays shared until a write.',
        'Only the child needs a new set. The parent keeps its existing tables, so the copy is one set of about 48 MiB, not two.',
        'Copy-on-write defers copying the data, not the page tables. The child needs its own tables at once, which is the cost that makes forking a large process take time.',
        'Right: 24 GiB is about 6.3 million pages, and at 8 bytes each the tables total 48 MiB, 1/512 of the mapped memory. Redis documents the same 24 GB to 48 MB arithmetic.',
      ],
    },
  ],
} satisfies Erratum
