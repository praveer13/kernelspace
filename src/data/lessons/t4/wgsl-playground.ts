import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't4.l5',
  slug: 'wgsl-playground',
  trackId: 't4',
  index: 5,
  title: 'WebGPU Compute Shaders',
  minutes: 35,
  hook: 'Vector add → parallel reduction, editable WGSL in the browser: write a real GPU kernel where you can break it and see why.',
  exercise: 'code',
  simId: 'sim-wgsl',
  blocks: [
    {
      type: 'prose',
      md: `Time to write GPU code. No CUDA install, no driver roulette: **WebGPU** — the modern web GPU API (the shared spirit of Vulkan/Metal/DX12) — runs compute shaders on the actual GPU of the machine reading this page, and its shading language **WGSL** is close enough to CUDA C++ that every skill transfers. In this lesson you'll read two canonical kernels line by line — **vector add** (the "hello world" that teaches the programming model) and **parallel reduction** (the kernel that teaches tree-based cooperation) — then edit and run them in the playground.

Everything from T4 so far becomes concrete: workgroups (CUDA blocks), invocations (threads/lanes), \`workgroupBarrier()\` (\`__syncthreads()\`), and the dispatch arithmetic that decides how many copies of your code run.`,
    },
    {
      type: 'prose',
      md: `## The programming model in one paragraph

You write a **kernel**; the host **dispatches** a grid of **workgroups**; each workgroup is a bundle of **invocations** that share a fast scratchpad (\`var<workgroup>\` = CUDA shared memory) and can synchronize with barriers. Your kernel code runs identically on every invocation; each one discovers *which* copy it is from built-ins like \`global_invocation_id\`, and indexes data accordingly. That's the whole model — T4.L1's SIMT machine with the training wheels off. The host-side story (create device, upload buffers, bind, dispatch, read back) is plumbing you'll see in the playground.`,
    },
    {
      type: 'code',
      filename: 'vec_add.wgsl — one FLOP per element, fully parallel',
      tabs: [
        {
          label: 'WGSL',
          lang: 'rust',
          code: `@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;                    // which element am I?
    if (i < arrayLength(&out)) {      // guard the tail (N % 256 != 0)
        out[i] = a[i] + b[i];         // coalesced: lane i ↔ address i
    }
}
// host: dispatchWorkgroups(ceil(N / 256)) — e.g. 65,536 groups for 16M floats
// NOTE: AI = 2 FLOP / 12 B ≈ 0.17 → memory-bound. The GPU will
// saturate HBM bandwidth, not FLOPs. (T4.L3 called this shot.)`,
        },
        {
          label: 'CUDA (same thing)',
          lang: 'cuda',
          code: `__global__ void vec_add(const float* a, const float* b,
                        float* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;   // ≡ gid.x
    if (i < n) out[i] = a[i] + b[i];
}
// vec_add<<<(n+255)/256, 256>>>(a, b, out, n);`,
        },
      ],
      chips: ['@workgroup_size(256)', 'gid.x = my element', 'memory-bound by design'],
    },
    {
      type: 'prose',
      md: `## Reduction: the kernel that teaches cooperation

Sum 16 million floats. One invocation can't do it (serial = T4.L1's cautionary tale); 65,536 independent invocations can't combine their work without coordination. The GPU answer is the **tree reduction**, in two levels:

1. **Inside the workgroup**: each of 256 invocations sums a strided slice into one partial; then a loop halves the active set each round — 128 add pairs, 64, 32… — with \`workgroupBarrier()\` between rounds so every lane sees the previous round's writes. After \`log2(256) = 8\` rounds, invocation 0 holds the workgroup total and writes ONE value out.
2. **Across workgroups**: 65,536 partials remain — either dispatch a second reduction pass over them (the classic multi-pass approach) or use atomics. The output collapses 16M → 65k → 256 → 1.

This shape — **parallel work, tree combine, multi-pass** — is everywhere: softmax denominators, layer-norm statistics, top-k, histograms. And it's why ` +
        `attention's online-softmax trick (T4.L6 deepdive) exists: reductions over long sequences are the annoying serial-ish part of otherwise-parallel kernels.`,
    },
    {
      type: 'code',
      filename: 'reduce.wgsl — 8 rounds of tree combine',
      tabs: [
        {
          label: 'WGSL',
          lang: 'rust',
          code: `@group(0) @binding(0) var<storage, read> data: array<f32>;
@group(0) @binding(1) var<storage, read_write> partials: array<f32>;

var<workgroup> tile: array<f32, 256>;        // shared SRAM scratchpad

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>,
        @builtin(workgroup_id) wid: vec3<u32>) {
    let g = wid.x * 256u + lid.x;
    tile[lid.x] = data[g];                   // coalesced load → SRAM
    workgroupBarrier();                      // everyone parked? proceed.

    var stride = 128u;
    while (stride > 0u) {                    // log2(256) = 8 rounds
        if (lid.x < stride) {
            tile[lid.x] += tile[lid.x + stride];
        }
        workgroupBarrier();                  // round N visible to round N+1
        stride = stride / 2u;
    }
    if (lid.x == 0u) { partials[wid.x] = tile[0]; }  // one write per group
}`,
        },
      ],
      chips: ['var<workgroup> = shared mem', 'workgroupBarrier', 'log₂(n) rounds'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `A workgroup reduction is a **MapReduce shuffle in miniature**: map (each lane reduces a slice), combine (tree merge with barriers as sync points), multi-pass (partials → final). It is also your **fork/join pool** (\`parallelStream().reduce()\`) with the join made explicit — the barrier *is* the join, and forgetting it is the GPU's race condition. Java note: \`LongAdder\`'s stripe-then-sum is the same tree idea for CPUs; the GPU just makes you climb the tree yourself.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `The three ways this kernel breaks, all reproducible in the playground: **(1)** drop a \`workgroupBarrier()\` → nondeterministic sums (a race you can watch). **(2)** Guard the tail wrong (\`i < N\` vs partial workgroups) → silently dropped elements. **(3)** Replace the tree with "everyone atomicAdd's one output" → correct but serialized on one address: 65k atomics queuing where 8 tree rounds sufficed. GPU bugs are pedagogical — the wrong answers are usually *stable-looking*.`,
    },
    {
      type: 'prose',
      md: `## In the playground

The exercise runs both kernels on your real GPU: edit the workgroup size, delete a barrier, swap the reduction stride order, and watch results and timings change live. The fallback path (no WebGPU) executes the same kernels on a CPU simulator with identical semantics — slower, but every lesson point survives.`,
    },
    {
      type: 'exercise',
      simId: 'sim-wgsl',
      title: 'WGSL playground: add & reduce',
      tasks: [
        'Run vec_add on 16M floats; confirm from GB/s that it saturates HBM bandwidth (memory-bound as predicted).',
        'Sweep @workgroup_size 64 → 1024: measure the dispatch/occupancy effects.',
        'Break the reduction by removing a barrier: capture two different wrong sums across runs.',
        'Finish the multi-pass reduction to a single scalar; verify against the CPU reference.',
      ],
      note: `You now have the core GPU craft: map data to invocations, guard tails, stage via SRAM, barrier between rounds, and multi-pass for global reductions. T4.L6 uses exactly this skeleton for tiled matmul — the kernel under everything.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'In WGSL, @builtin(global_invocation_id) gid.x corresponds to which CUDA expression?',
          options: [
            'threadIdx.x only',
            'blockIdx.x * blockDim.x + threadIdx.x — the invocation\'s global index in the whole grid',
            'warp id',
            'gridDim.x',
          ],
          correct: [1],
          explanation:
            'Both compute "which copy of the kernel am I" across the entire dispatch. Workgroups ≡ blocks, local ids ≡ threadIdx, global ids ≡ the flattened global index.',
        },
        {
          q: 'workgroupBarrier() exists to…',
          options: [
            'Pause the GPU for power saving',
            'Guarantee all invocations in the workgroup have reached the barrier AND their shared-memory writes are visible before anyone proceeds',
            'Synchronize all workgroups in the grid',
            'Flush L2 to HBM',
          ],
          correct: [1],
          explanation:
            'It is __syncthreads(): execution + memory visibility sync for ONE workgroup (grids can\'t sync globally mid-kernel — that\'s what multi-pass is for). Removing it is the canonical GPU race.',
        },
        {
          q: 'The tree reduction\'s advantage over "everyone atomicAdds one output" is…',
          options: [
            'It uses fewer registers',
            'log2(n) combine rounds with disjoint SRAM accesses instead of n-way serialized contention on one address',
            'It avoids the need for barriers',
            'Atomics are unsupported in WGSL',
          ],
          correct: [1],
          explanation:
            'An atomic counter is a single contended address — the T0.L4/T2.L5 hot line. The tree reduces 256 values in 8 rounds of conflict-free pairs; atomics reserve themselves for the tiny cross-workgroup tail.',
        },
        {
          q: 'vec_add (2 FLOPs per 12 bytes) will always be limited by…',
          options: [
            'Compute throughput',
            'Memory bandwidth — its arithmetic intensity (~0.17 F/B) sits far left of any GPU\'s ridge point',
            'Workgroup size',
            'The barrier count',
          ],
          correct: [1],
          explanation:
            'Elementwise ops are pure bandwidth exercises: the roofline puts them on the slope regardless of kernel cleverness. The only wins are fusion (do more per byte) and coalescing.',
        },
      ],
    },
  ],
}

export default lesson
