import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t0l4-cache-line-fraction',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l4'],
  title: 'An AoS deadline sweep uses 1/4 of each cache line, not 1/8',
  before:
    'The loop reads 8 bytes of deadline_ns per 64-byte line: one eighth of every fetch is useful. You have divided your effective memory bandwidth by eight. (The quiz key marked 1/8 correct.)',
  after:
    'A 64-byte line holds two 32-byte structs and the sweep reads 8 bytes of each: 16 useful bytes of 64, so one quarter of every fetch is useful and bandwidth is divided by four. The quiz key is now 1/4.',
  why: 'Two 32-byte structs share a line, so the sweep touches 8 B in each, 16 B per line. The quiz marked the right answer wrong. The Layout lab now fetches 32 B per AoS record to match.',
  items: [
    {
      q: 'A loop sweeps 32-byte structs and reads only an 8-byte deadline from each. A 64-byte line holds two structs. What fraction of each fetched line is useful?',
      options: [
        'One half',
        'One quarter',
        'One eighth',
        'One sixteenth',
      ],
      correct: [1],
      why: [
        'One half would mean 32 of 64 bytes are read, which is a whole struct. The loop reads 8 bytes of each.',
        'Right. 8 B from each of two structs is 16 useful bytes of 64, so bandwidth is divided by four.',
        'That counts one deadline per line and forgets the second struct that sits in the same line.',
        'That would be 4 useful bytes of 64. The loop reads 8 bytes from each of two structs.',
      ],
    },
  ],
} satisfies Erratum
