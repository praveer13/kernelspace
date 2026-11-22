import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t2-l3-postgres-clock-sweep',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t2.l3'],
  title: 'PostgreSQL uses a clock sweep, not ARC, and Redis allkeys-lru samples keys instead of running Clock',
  before: 'The lesson said Postgres uses scan-resistant variants such as ARC, and that Redis allkeys-lru is roughly Clock over keys.',
  after: 'PostgreSQL runs a clock sweep with a usage count and gives big scans a small ring of buffers. Redis allkeys-lru samples a few random keys and evicts the idlest, an LRU approximation.',
  why: 'The PostgreSQL buffer README describes a clock sweep with usage counts and a buffer ring for large scans. Redis documents its LRU as sampled keys, not a clock hand.',
  source: {
    url: 'https://github.com/postgres/postgres/blob/REL_17_5/src/backend/storage/buffer/README',
    title: 'PostgreSQL buffer manager README (REL_17_5)',
  },
} satisfies Erratum
