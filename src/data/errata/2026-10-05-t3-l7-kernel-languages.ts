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
    'GPU kernels follow the vendor ecosystem: CUDA C++ and increasingly Python DSLs (CuTe DSL, Triton/Gluon, TileLang). Rust GPU (CubeCL, rust-cuda) is marginal; cudarc only wraps the host-side CUDA API.',
  why: 'The lesson point stands: kernel language follows the vendor ecosystem, not Rust, Zig or Go. But the ecosystem now includes CuTe DSL (FA4, vLLM v0.30 NVFP4 default on SM100), so the two-language list was wrong.',
  source: {
    url: 'https://github.com/Dao-AILab/flash-attention',
    title: 'FlashAttention-4 (CuTe DSL), Dao-AILab/flash-attention README',
  },
  items: [
    {
      q: 'Which description of how production GPU kernels are written fits the corrected T3.L7 lesson?',
      options: [
        'CUDA C and Triton only, because ecosystem gravity leaves the kernel layer with exactly two languages and no exceptions',
        'Mostly Rust, because memory safety on untrusted tensors has pushed the major engines off CUDA C++ for their kernels',
        'CUDA C++ plus Python DSLs like CuTe DSL (FlashAttention-4), Triton/Gluon and TileLang, following the vendor ecosystem',
        'Mostly Zig, because comptime specialization per architecture beats the vendor toolchains for kernels in serving stacks',
      ],
      correct: [2],
      why: [
        'This is the retracted two-language list. FlashAttention-4 is written in CuTe DSL, which is neither CUDA C nor Triton, so the set of kernel languages was wider than two.',
        'Rust owns host code such as routers and schedulers. Rust GPU projects like CubeCL and rust-cuda exist but remain marginal in production kernels, so safety has not moved kernel authoring.',
        'Right: kernel language follows the GPU vendor ecosystem, now including CuTe DSL (FlashAttention-4), Triton/Gluon and TileLang next to CUDA C++. Rust and Zig serve the host side.',
        'Zig has no vote on kernels. They reach the device through toolchains from the GPU vendor ecosystem, where the libraries and profilers live, so comptime does not change that.',
      ],
    },
    {
      q: 'A teammate lists cudarc as a Rust GPU kernel project. What does cudarc actually do?',
      options: [
        'It is a Rust kernel language, so kernels are written in Rust instead of CUDA C++ and compiled for the GPU device',
        'It is a safe-Rust attention library whose kernels match hand-written CUDA C++ speed in production serving stacks',
        'It reimplements the CUDA runtime in pure Rust, so programs run on any GPU vendor without the CUDA toolkit installed',
        'It wraps the host-side CUDA API for Rust, so Rust code manages devices and launches kernels made elsewhere',
      ],
      correct: [3],
      why: [
        'Kernel languages such as CubeCL or rust-cuda are a different category. cudarc binds to the existing CUDA API from the host and does not define a language that kernels are written in.',
        'It is a binding layer, not a kernel library. The kernels it launches come from CUDA C++ or Python DSLs, and nothing in it claims parity with FlashAttention-class kernels.',
        'It binds to NVIDIA\'s CUDA libraries rather than replacing them, so the toolkit and an NVIDIA GPU are still required. Vendor portability is not what it offers.',
        'Right: cudarc is a host-side wrapper over the CUDA API. Rust code uses it to manage devices and memory and to launch kernels, while kernel authoring stays in CUDA C++ or a DSL.',
      ],
    },
  ],
} satisfies Erratum
