import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t1-l3-toy-allocator-listing',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t1.l3'],
  title: 'toymalloc.c now matches its labels: 16-byte header, aligned payloads, coalescing',
  before:
    'toymalloc.c: a 24-byte header labelled 16, payloads not 16-byte aligned, no coalescing despite its label, and a double free that loses the free list rather than handing memory out twice.',
  after:
    'The listing has a 16-byte header, 16-byte-aligned payloads from mmap, an address-ordered free list that coalesces on free, and a flag check that ignores a second free. Without a flag, freeing a, c, a hands a out twice.',
  why: 'A learner who traced the old listing found the label wrong and the quiz marking the traced outcome wrong. The new listing was compiled and run with gcc at -O0 and -O2 to confirm each claim.',
  source: {
    url: 'https://github.com/praveer13/kernelspace/blob/master/labs/rust-allocator/src/allocator.rs',
    title: 'kernelspace lab 01 allocator.rs: address-ordered free list, always coalesced',
  },
  items: [
    {
      q: 'An allocator with no status flag sees free(a), free(c), free(a). What happens to later mallocs?',
      options: [
        'A later malloc hands out a, and a malloc after it hands out a again',
        'Every later malloc returns a null pointer after the second free of a',
        'The second free of a crashes at once, so the bug cannot go unnoticed',
        'The second free of a is ignored, so c is the only block that stays free',
      ],
      correct: [0],
      why: [
        'Right: a is on the list twice, so two mallocs return one address and two owners share it.',
        'The list stays populated; the harm is aliased ownership, not an emptied list.',
        'Nothing checks, so the second free just relinks the block and the damage shows up later.',
        'Ignoring it needs a flag check, which this allocator does not have.',
      ],
    },
  ],
} satisfies Erratum
