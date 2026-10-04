import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t0l1-t1l6-rust-orchestrates-nixl',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l1', 't1.l6'],
  title: 'Dynamo\'s Rust code orchestrates KV transfers; NIXL (C++) moves the bytes',
  before:
    'Two quizzes and a T1 pair said Rust is the "KV-moving data plane" and that "KV bytes move between nodes at line rate", implying the transfers themselves are Rust.',
  after:
    'The Rust data plane orchestrates KV transfers that NIXL, a C++ library with Rust bindings, performs. The quiz stems, keys, explanations and the T1 isomorphism pair now say so.',
  why: 'Same overclaim as the NIXL erratum, found again in quiz items. Rust wins the orchestration layer; the byte-moving library and the kernels are still C++.',
  source: {
    url: 'https://github.com/ai-dynamo/nixl',
    title: 'ai-dynamo/nixl repository (language breakdown via the GitHub languages API)',
  },
} satisfies Erratum
