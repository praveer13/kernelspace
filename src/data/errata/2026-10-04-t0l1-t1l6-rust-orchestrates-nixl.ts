import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t0l1-t1l6-rust-orchestrates-nixl',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l1', 't1.l6', 't5.l10'],
  title: 'Dynamo\'s Rust code orchestrates KV transfers; NIXL (C++) moves the bytes',
  before:
    'Two quizzes, a T1 pair and a T5.L10 explanation said Rust is the "KV-moving data plane", that "KV bytes move between nodes at line rate" or called it "Rust-speed KV movement", implying the transfers are Rust.',
  after:
    'The Rust data plane orchestrates KV transfers that NIXL, a C++ library with Rust bindings, performs. The quiz stems, keys, explanations (T5.L10 included) and the T1 isomorphism pair now say so.',
  why: 'Same overclaim as the NIXL erratum, found again in quiz items. Rust wins the orchestration layer; the byte-moving library and the kernels are still C++.',
  source: {
    url: 'https://github.com/ai-dynamo/nixl',
    title: 'ai-dynamo/nixl repository (language breakdown via the GitHub languages API)',
  },
  items: [
    {
      q: 'In Dynamo, which language orchestrates KV transfers and which one performs them?',
      options: [
        'Python orchestrates the transfers and Rust performs them',
        'Rust does both jobs and no C++ library is involved',
        'Rust orchestrates the transfers and C++ moves them',
        'A C++ router orchestrates the transfers and Rust performs them',
      ],
      correct: [2],
      why: [
        'Dynamo orchestration is Rust, and the transfer library is NIXL. The roles are the other way round here.',
        'The byte-moving layer is NIXL, a C++ library with Rust bindings, so Rust alone does not move them.',
        'Right: the Rust data plane decides and schedules transfers; NIXL, a C++ library with Rust bindings, performs them.',
        'The orchestration layer is Rust, not a C++ router, and the byte-moving library is C++, not Rust kernels.',
      ],
    },
  ],
} satisfies Erratum
