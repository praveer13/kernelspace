import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l3-itl-reading-speed',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l3'],
  title: 'Human reading is well above 50 ms per token, by one 2019 study',
  before: 'T5.L3\'s ITL chip said "human reading speed is ~50 ms/token".',
  after:
    'One 2019 meta-analysis of silent reading (Brysbaert) puts reading well above 50 ms per token at about 0.75 words per token. The ~200 ms "broken" line is the course\'s rule of thumb, not a reading speed.',
  why: 'The 50 ms figure had no source and would mean reading far faster than any study of adults finds. The study is known to us only through its title and citation, so the lesson gives no replacement number.',
  source: {
    url: 'https://doi.org/10.1016/j.jml.2019.104047',
    title: 'Brysbaert (2019), How many words do we read per minute? A review and meta-analysis of reading rate, Journal of Memory and Language 109',
  },
} satisfies Erratum
