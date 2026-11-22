import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t0-l6-bar-below-is-the-caller',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t0.l6'],
  title: 'In a flame graph the bar below called the bar above, not the other way round',
  before: 'Rule 2 of the grammar said "The bar above called the bar below", the reverse of the lesson\'s own worked examples.',
  after:
    'The bar below called the bar above. The root is at the bottom, and the top edge is what was running when the sample was taken.',
  why: 'Reading a stack upside down sends you to the wrong function. The top edge is where time was spent; the frames beneath it are its callers.',
  source: {
    url: 'https://www.brendangregg.com/flamegraphs.html',
    title: 'Brendan Gregg, CPU Flame Graphs: "The top edge shows what is on-CPU, and beneath it is its ancestry."',
  },
} satisfies Erratum
