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
// NOTE: AI = 1 FLOP / 12 B ≈ 0.08 → memory-bound. The GPU will
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

Sum 16 million floats. One invocation can't do it (serial = T4.L1's cautionary tale); workgroups must combine their values with coordination. The GPU answer is the **tree reduction**, in two levels:

1. **Inside the workgroup**: each of 256 invocations loads one value into shared memory; then a loop halves the active set each round — 128 add pairs, 64, 32… — with \`workgroupBarrier()\` between rounds so every lane sees the previous round's writes. After \`log2(256) = 8\` rounds, invocation 0 holds the workgroup total and writes ONE value out.
2. **Across workgroups**: 65,536 partials remain. Redispatch the same reduction over those partials: 16,777,216 → 65,536 → 256 → 1. The playground reports that exact logical topology and returns one scalar while bounding physical storage to a representative 65,536-float sample. Available WebGPU executes the bounded passes; the explicitly labeled CPU/model fallback preserves the same logical topology.

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

The playground keeps every WGSL preset editable. The 16M vector-add option executes a bounded representative sample, then honestly models exactly 65,536 logical workgroups and 192 MiB of memory traffic so the UI never allocates hundreds of MiB. Reduction runs a shared-memory tree; delete either executable barrier and its result check exposes the race. The multi-pass option models the logical 16,777,216 → 65,536 → 256 → 1 topology while bounded WebGPU or CPU passes reduce the representative sample to exactly one scalar.`,
    },
    {
      type: 'exercise',
      simId: 'sim-wgsl',
      machine: 'wgsl',
      title: 'WGSL playground: add & reduce',
      tasks: [
        'Select “vector add (16M modeled)” and run it successfully; inspect the reported 192 MiB traffic and effective GB/s.',
        'On a vector-add preset, run exactly @workgroup_size(64), then exactly @workgroup_size(1024).',
        'Select “parallel reduction (sum)”, remove either workgroupBarrier(), run, and observe a mismatched sum.',
        'Select “reduction (multi-pass → scalar)” with both barriers intact, run, and verify the final output count is one and the scalar matches the CPU reference.',
      ],
      note: `You now have the core GPU craft: map data to invocations, guard tails, stage via SRAM, barrier between rounds, and multi-pass for global reductions. T4.L6 uses exactly this skeleton for tiled matmul — the kernel under everything.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'In WGSL, @builtin(global_invocation_id) gid.x corresponds to which CUDA expression?',
          options: [
            'threadIdx.x, because global_invocation_id numbers each invocation within its own workgroup from zero',
            'blockIdx.x * blockDim.x + threadIdx.x, the index of the invocation across the whole dispatch',
            'blockIdx.x * gridDim.x + threadIdx.x, the workgroup index scaled by the number of workgroups in the grid',
            'The id of the warp running the invocation, which WGSL exposes so kernels can pick a lane within it',
          ],
          correct: [1],
          explanation:
            'Both compute "which copy of the kernel am I" across the entire dispatch. Workgroups ≡ blocks, local ids ≡ threadIdx, global ids ≡ the flattened global index.',
          why: [
            'That is local_invocation_id. global_invocation_id adds the workgroup offset, so it is unique across the whole dispatch.',
            'Right: workgroup index times workgroup size plus the local index gives each invocation a unique position across the dispatch.',
            'The workgroup index is scaled by workgroup size (blockDim), not by the number of workgroups. Scaling by gridDim would collide and skip elements.',
            'It indexes invocations, not warps. Warp-scoped ids come from a separate, optional subgroup feature, not from this built-in.',
          ],
        },
        {
          q: 'workgroupBarrier() exists to…',
          options: [
            'Make every workgroup in the grid wait for the others, so a later pass can safely read earlier results',
            'Make every invocation in the workgroup arrive, and their workgroup-memory writes visible, before any one proceeds',
            'Flush the workgroup\'s writes out to L2 and HBM so other workgroups can read the partial sums right away',
            'Pause the invocations of the workgroup for a fixed delay, which gives slower lanes time to finish their loads',
          ],
          correct: [1],
          explanation:
            'It is __syncthreads(): execution + memory visibility sync for ONE workgroup (grids can\'t sync globally mid-kernel — that\'s what multi-pass is for). Removing it is the canonical GPU race.',
          why: [
            'It synchronizes one workgroup only. A kernel cannot wait on other workgroups mid-dispatch; global results need a second pass, as in the multi-pass reduction.',
            'Right: it is __syncthreads() for one workgroup. All invocations must arrive and their workgroup-memory writes become visible before any continues.',
            'It orders memory within the workgroup only and does not make writes visible to other workgroups. Cross-group results wait for another dispatch.',
            'A barrier waits for arrival, not for elapsed time. Slower lanes simply hold the others until they reach it.',
          ],
        },
        {
          q: 'The tree reduction\'s advantage over "everyone atomicAdds one output" is…',
          options: [
            'The tree needs fewer registers, since each invocation holds one partial while atomics need a private accumulator per lane',
            'log2(n) rounds of conflict-free pair sums, instead of n updates queueing on one hot address',
            'Atomic adds on a shared address can lose updates under contention, so the final sum would come out wrong',
            'The tree removes the need for barriers, since each round reads only values earlier rounds have already finished',
          ],
          correct: [1],
          explanation:
            'An atomic counter is a single contended address — the T0.L4/T2.L5 hot line. The tree reduces 256 values in 8 rounds of conflict-free pairs; atomics reserve themselves for the tiny cross-workgroup tail.',
          why: [
            'Register use is similar either way. The difference is serialization: atomics on one address queue, while tree rounds touch disjoint SRAM slots in parallel.',
            'Right: each round halves the active set with disjoint pairs, so n values take log2(n) rounds. Atomics on one address serialize all n updates.',
            'Atomics are exact; contention only serializes them. The sum is correct, so the cost is throughput rather than correctness.',
            'The tree needs a barrier after every round so each round sees the previous round\'s writes. Dropping one is the canonical race.',
          ],
        },
        {
          q: 'vec_add does one add per element and moves 12 bytes (two 4-byte reads, one 4-byte write). It will always be limited by…',
          options: [
            'Compute throughput, because adding 16 million floats saturates the ALUs once the workgroups fill every SM of the GPU',
            'Memory bandwidth: its arithmetic intensity of about 0.08 FLOP/byte sits far left of any GPU\'s ridge point',
            'Workgroup size, because 256 invocations per group leaves too few warps to hide the latency of each load',
            'Barrier count, because every group synchronizes before it writes its output elements back to memory',
          ],
          correct: [1],
          explanation:
            'One add per 12 bytes is about 0.08 FLOP/byte. Elementwise ops are pure bandwidth exercises: the roofline puts them on the slope regardless of kernel cleverness. The only wins are fusion (do more per byte) and coalescing.',
          why: [
            'The ALUs finish a single add far faster than the loads arrive. At one FLOP per 12 bytes the kernel sits on the bandwidth slope.',
            'Right: one FLOP over 12 bytes is about 0.08 FLOP/byte, far left of any ridge. Delivered bandwidth caps the kernel however it is launched.',
            'Workgroup size can change occupancy but not the ceiling. Even with perfect occupancy the kernel is held to AI × bandwidth, far below the compute roof.',
            'vec_add has no barriers at all; each invocation is independent. Barriers matter in the reduction kernel, not here.',
          ],
        },
      ],
    },
  ],
}

export default lesson
