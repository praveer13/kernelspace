import type { Erratum } from './schema'

export default {
  id: '2026-10-04-dynamo-kvbm-deprecated',
  date: '2026-10-04',
  kind: 'changed',
  lessons: ['t3.l7', 't5.l6', 't5.l9', 't5.l10', 't6.l3'],
  title: 'Dynamo deprecated KVBM; tiering moved into the engines',
  before:
    'Dynamo v1.3 shipped the Rust KV Block Manager (KVBM) as generally-available plumbing for GPU-to-CPU-to-SSD-to-remote KV tiering.',
  after:
    'Dynamo v1.5.0 (2026-09-21) deprecated KVBM, removal targeted for v1.6.0. Migrate to the engine\'s native KV offloading for host and disk tiering.',
  why: 'The lasting lesson is tiered KV block management, now a feature of whoever owns the cache. Transport (NIXL, Mooncake) and routing stay separate layers.',
  source: {
    url: 'https://github.com/ai-dynamo/dynamo/releases/tag/v1.5.0',
    title: 'NVIDIA Dynamo v1.5.0 release notes',
  },
} satisfies Erratum
