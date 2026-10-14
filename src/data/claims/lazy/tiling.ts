import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * The Tiling Cube's hardware figures and its Triton card row (spec wave-3 §4.4, 3a-08). The cube's levels read
 * these instead of lesson literals (`gpu-memory.ts`). The figures come from the vendor's own pages, opened on
 * 2026-10-14; the H100 page is the one `hardware.ts` already quotes. NVIDIA writes KB for what the course writes
 * KiB (a shared-memory carve-out of 228 KB is 233,472 bytes), and the lessons say KiB.
 */
const H100_PAGE = { url: 'https://www.nvidia.com/en-us/data-center/h100/', title: 'NVIDIA H100 Tensor Core GPU' }
const HOPPER_BLOG = {
  url: 'https://developer.nvidia.com/blog/nvidia-hopper-architecture-in-depth/',
  title: 'NVIDIA Hopper Architecture In-Depth (NVIDIA Technical Blog)',
}
const HOPPER_TUNING = {
  url: 'https://docs.nvidia.com/cuda/hopper-tuning-guide/index.html',
  title: 'Hopper Tuning Guide (NVIDIA CUDA Toolkit documentation)',
}

/** The release the Triton claim was read at; the tutorial file moves between releases. */
const TRITON_PIN = { repo: 'triton-lang/triton', ref: 'v3.8.0' } as const

export const TILING_CLAIMS: Claim[] = [
  {
    id: 'hw.h100-sxm.sm-count',
    kind: 'spec',
    value: 132,
    unit: 'SMs',
    label: 'H100 SXM5 SM count',
    source: { ...HOPPER_BLOG, quote: 'The H100 SXM5 GPU has 132 SMs, and the PCIe version has 114 SMs.', row: 'H100 SM count' },
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: 'The SXM5 module. The full GH100 die has 144 SMs; the PCIe card has 114.',
  },
  {
    id: 'hw.h100-sxm.l2',
    kind: 'spec',
    value: 50,
    unit: 'MB',
    label: 'H100 L2 cache',
    source: { ...HOPPER_BLOG, quote: 'A 50 MB L2 cache in H100 is 1.25x larger than the A100 40 MB L2.', row: 'L2 cache' },
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: 'One figure for the whole chip, shared by all SMs; the cube uses it as the window a grouped raster has to fit in.',
  },
  {
    id: 'hw.h100-sxm.smem-per-sm',
    kind: 'spec',
    value: 228,
    unit: 'KiB',
    label: 'H100 shared memory per SM',
    source: {
      ...HOPPER_TUNING,
      quote: 'For devices of compute capability 9.0 (H100 GPUs), shared memory capacity per SM is 228 KB',
      row: 'Hopper tuning guide > Shared memory',
    },
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: 'The largest carve-out an SM offers. The source writes KB for 1,024-byte units.',
  },
  {
    id: 'hw.h100-sxm.smem-per-block',
    kind: 'spec',
    value: 227,
    unit: 'KiB',
    label: 'H100 shared memory per thread block',
    source: {
      ...HOPPER_TUNING,
      quote: 'CUDA reserves 1 KB of shared memory per thread block. Hence, the H100 GPU enables a single thread block to address up to 227 KB of shared memory.',
      row: 'Hopper tuning guide > Unified Shared Memory/L1/Texture Cache',
    },
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: 'One KiB less than the SM total: CUDA reserves 1 KB of shared memory per thread block, and the source writes KB for 1,024-byte units. A tile whose slabs exceed this cannot launch.',
  },
  {
    id: 'hw.h100-sxm.registers-per-sm',
    kind: 'spec',
    value: 65536,
    unit: '32-bit registers',
    label: 'H100 registers per SM',
    source: { ...HOPPER_TUNING, quote: 'The register file size is 64K 32-bit registers per SM.', row: 'Hopper tuning guide > Occupancy' },
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: '64K registers of 4 bytes is 256 KiB. The tuning guide caps one thread at 255 registers.',
  },
  {
    id: 'hw.h100-sxm.fp8-sparse',
    kind: 'spec',
    value: 3958,
    unit: 'TFLOPS',
    label: 'H100 SXM FP8 Tensor Core, with sparsity',
    source: { ...H100_PAGE, quote: '3,958 teraFLOPS', row: 'H100 SXM > FP8 Tensor Core (* With sparsity)' },
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    boundary: 'The datasheet footnote says "With sparsity" (2:4 structured). Dense work gets half.',
  },
  {
    id: 'hw.h100-sxm.fp8-dense',
    kind: 'derived',
    value: 1979,
    unit: 'TFLOPS',
    label: 'H100 SXM FP8 Tensor Core, dense',
    verifiedAt: '2026-10-14',
    ttlDays: 365,
    derived: { from: ['hw.h100-sxm.fp8-sparse'], formula: 'floor(fp8Sparse / 2)' },
    boundary:
      'Dense is half the sparse figure, as bf16-dense is. It is within 1 TFLOPS of 2 x 989, the FP8 rule (twice BF16 dense) that RooflineSim and the roofline family use, so the cube shares their FP8 ridge.',
  },
  {
    id: 'production.triton.group-size-m',
    kind: 'status',
    value: 8,
    unit: 'tile rows',
    label: 'Triton matmul tutorial grouped-raster group size',
    source: {
      url: `https://raw.githubusercontent.com/${TRITON_PIN.repo}/${TRITON_PIN.ref}/python/tutorials/03-matrix-multiplication.py`,
      title: 'Triton v3.8.0 tutorial: python/tutorials/03-matrix-multiplication.py (get_cuda_autotune_config)',
      quote: "{'BLOCK_SIZE_M': 128, 'BLOCK_SIZE_N': 256, 'BLOCK_SIZE_K': 64, 'GROUP_SIZE_M': 8}",
      row: 'get_cuda_autotune_config > GROUP_SIZE_M',
    },
    pin: TRITON_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'Every config the tutorial lists for CUDA sets GROUP_SIZE_M to 8; the HIP list sets 4 or 6. The tutorial launches blocks in groups of GROUP_SIZE_M rows before moving to the next column, which is the cube\'s grouped raster.',
  },
]

registerClaims(TILING_CLAIMS)
