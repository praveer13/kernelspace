import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t3-l7-kernel-languages',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t3.l7'],
  title: 'GPU kernels are CUDA C++ and increasingly Python DSLs, not "CUDA C or Triton, no exceptions"',
  before:
    'GPU kernels are "CUDA C and Triton — no Rust, no Zig, no exceptions", and the quiz key said "CUDA C or Triton: ecosystem gravity is absolute, and this is the one component with no vote".',
  after:
    'GPU kernels follow the vendor ecosystem: CUDA C++, and increasingly Python DSLs (CuTe DSL, Triton/Gluon, TileLang). FlashAttention-4 is written in CuTe DSL. Rust GPU exists but is marginal.',
  why: 'The lesson point stands: kernel language follows the vendor ecosystem, not Rust, Zig or Go. But the ecosystem now includes CuTe DSL (FA4, vLLM v0.30 NVFP4 default on SM100), so the two-language list was wrong.',
  source: {
    url: 'https://github.com/Dao-AILab/flash-attention',
    title: 'FlashAttention-4 (CuTe DSL), Dao-AILab/flash-attention README',
  },
} satisfies Erratum
