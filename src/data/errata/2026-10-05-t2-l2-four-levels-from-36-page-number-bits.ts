import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t2-l2-four-levels-from-36-page-number-bits',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t2.l2'],
  title: 'Four x86-64 paging levels come from 36 page-number bits at 9 each, not from 48 address bits at 9 each',
  before: 'The T2.L2 quiz feedback said "Four levels follow from 48 address bits at 9 each."',
  after:
    'Four levels follow from the 36 page-number bits (48 address bits minus the 12-bit page offset) at 9 bits per 512-entry level. The 12 offset bits are not translated.',
  why: '48 / 9 is about 5.3, not 4. The low 12 bits are the page offset and pass through untranslated, so only the 36-bit page number is split into four 9-bit indices, each selecting one of 512 entries.',
  source: {
    url: 'https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html',
    title: 'Intel 64 and IA-32 Architectures SDM, Vol. 3A, 4-level paging (bits 47:12 index four 512-entry tables in 9-bit fields; bits 11:0 are the page offset)',
  },
  items: [
    {
      q: 'A processor uses 4 KiB pages and 512-entry page tables, as x86-64 does. How many levels does a 39-bit virtual address need?',
      options: [
        'Four levels, with 36 bits resolved at 9 per level and the last 3 bits as the page offset',
        'Five levels, with all 39 bits resolved at 9 per level and the remainder rounded up',
        'Three levels, with 27 bits left after the offset and 9 bits resolved at each level',
        'Four levels, with the 39 bits resolved at 12 per level to match the page offset width',
      ],
      correct: [2],
      why: [
        'A 4 KiB page needs a 12-bit offset, not 3. Taking 36 bits for the indices would leave only 3, which cannot address a byte within the page.',
        'Dividing all 39 bits by 9 ignores the offset, which is not translated. Only 39 - 12 = 27 bits are split, so rounding up to five levels over-counts.',
        'Right: the 12 offset bits are not translated, so 39 - 12 = 27 page-number bits, and 27 / 9 = 3 levels. The same rule gives four levels for 48 bits, since 36 / 9 = 4.',
        'Each level indexes a 512-entry table, which is 9 bits, not 12. The 12 is the width of the page offset, which is never translated.',
      ],
    },
  ],
} satisfies Erratum
