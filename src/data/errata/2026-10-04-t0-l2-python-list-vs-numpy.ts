import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t0-l2-python-list-vs-numpy',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l2'],
  title: 'A Python list loop is slow mostly from interpreter overhead, not cache misses',
  before:
    'Quiz Q3 keyed the Python-list-vs-numpy gap to cache misses: "the killer is memory: a Python list of ints is an array of pointers to scattered PyLong objects", and dispatch and SIMD were distractors.',
  after:
    'Per-element bytecode dispatch, reference counting and boxed int objects, with no SIMD loop, dominate. numpy runs one compiled loop over raw values. Cache misses are secondary: ints made in sequence sit close together.',
  why: 'Small ints are cached and sequentially allocated PyLongs stay near each other, so misses rarely dominate a simple sum. The course\'s signature claim should not rest on a contestable cause.',
  source: {
    url: 'https://numpy.org/doc/stable/user/whatisnumpy.html',
    title: 'NumPy documentation: What is NumPy? (vectorization runs in pre-compiled C code)',
  },
} satisfies Erratum
