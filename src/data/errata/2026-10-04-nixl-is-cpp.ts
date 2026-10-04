import type { Erratum } from './schema'

export default {
  id: '2026-10-04-nixl-is-cpp',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t6.l3', 't3.l7'],
  title: 'NIXL is a C++ library with Rust bindings',
  before:
    'NIXL (NVIDIA Inter-node Xfer Library) was introduced as a Rust transfer library, and listed among the Rust components in Dynamo.',
  after:
    'NIXL is the NVIDIA Inference Xfer Library: primarily C++ (about 3.6 MB) with Rust bindings (about 0.24 MB). Dynamo\'s Rust code orchestrates it.',
  why: 'Rust is winning the CPU half of serving (frontends, routers, caches), but the transfer layer and the kernels are still C++. Overclaiming Rust costs the course credibility.',
  source: {
    url: 'https://github.com/ai-dynamo/nixl',
    title: 'ai-dynamo/nixl repository (language breakdown via the GitHub languages API)',
  },
} satisfies Erratum
