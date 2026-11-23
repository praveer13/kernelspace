import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l3-itl-reading-speed',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l3'],
  title: 'Adult silent reading is far slower than 50 ms per token',
  before: 'T5.L3\'s ITL chip said "human reading speed is ~50 ms/token".',
  after:
    'Adult silent reading is far slower than 50 ms per token at T5.L2\'s rule of about 0.75 words per token. The ~200 ms "broken" line is the course\'s rule of thumb, not a reading speed.',
  why: 'The 50 ms figure had no source. At 0.75 words per token it means 900 words a minute, far faster than adults read silently. The course has read no study of reading rate, so it gives no replacement number.',
} satisfies Erratum
