import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t3-l5-wasi-typed-interfaces-and-wasm-gc',
  date: '2026-11-22',
  kind: 'changed',
  lessons: ['t3.l5'],
  title: 'WASI is typed interfaces with native async in 0.3, and Wasm 3.0 includes garbage collection',
  before: 'The lesson described WASI as a POSIX-ish syscall surface and said GC languages must wait for WasmGC.',
  after: 'WASI began as a POSIX-inspired module API (0.1); since 0.2 it is typed Component Model interfaces, and 0.3 (2026-06-11) adds native async. Wasm GC is part of Wasm 3.0 (2025-09-17).',
  why: 'The lesson described preview 1 as if it were current, and treated GC as a future feature that the Wasm 3.0 standard already contains.',
  source: {
    url: 'https://wasi.dev/roadmap',
    title: 'WASI.dev Roadmap',
  },
} satisfies Erratum
