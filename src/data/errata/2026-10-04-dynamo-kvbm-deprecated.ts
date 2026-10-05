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
  items: [
    {
      q: 'Dynamo v1.5.0 deprecated KVBM. Where do host-memory and disk tiers for KV blocks live now?',
      options: [
        'In KVBM, which stays the supported tiering path beyond v1.6.0',
        'In the inference engine, through its native KV offloading',
        'In NIXL, which now decides which tier each block sits in',
        'In the router, which now moves blocks between GPU, CPU and SSD',
      ],
      correct: [1],
      why: [
        'KVBM is deprecated as of v1.5.0 and removal is targeted for v1.6.0, so it is not a path to build on.',
        'Right: v1.5.0 points host and disk tiering at the engine native KV offloading: tiering moved to whoever owns the cache.',
        'NIXL is the transfer layer. It moves bytes between memories and nodes, but it does not own block placement or eviction.',
        'The router picks which worker serves a request. It does not move blocks between memory tiers.',
      ],
    },
    {
      q: 'Which part of the KVBM idea still holds after the deprecation?',
      options: [
        'KV blocks should stay on the GPU, because every lower tier is slower than recompute',
        'Block transfers between tiers are now performed by KVBM running inside NIXL',
        'Tiered KV block management still matters, now inside the engine that owns the cache',
        'A prefix hit no longer applies once a block has been moved out of GPU memory',
      ],
      correct: [2],
      why: [
        'Offloading cold blocks to host memory or disk can beat recompute for long prefixes, which is why engines now ship it themselves.',
        'KVBM is deprecated, and NIXL is a separate transport library. KVBM never ran inside NIXL.',
        'Right: tiering GPU to CPU to SSD stays; the deprecation moved who implements it. Transport (NIXL, Mooncake) and routing remain separate layers.',
        'A cached block that sits in a lower tier can still be reused on a prefix hit, after it is brought back to the GPU.',
      ],
    },
  ],
} satisfies Erratum
