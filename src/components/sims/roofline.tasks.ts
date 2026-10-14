/**
 * sim-roofline tasks in the registry (P2, docs/specs/wave-1.md §10.2; wave-3.md §13, task 3a-18).
 *
 * `ROOFLINE_TASKS`: the eighteen outcome tasks, predict → run → explain. Each is graded on the first value
 * the sim reports for its `observe` key after the prediction is locked (`observationsFor` in
 * src/lib/sims/models/roofline.ts), and shown in phone mode from the same model's canonical outcome.
 * They replace the click-through tasks named in each `legacyId`: the six that read the chart came first, and
 * the twelve that followed them (the CPU/GPU demo, the occupancy, access-pattern and tier probes, and the
 * B200 Fleet worksheet) are the last of Wave 1's legacy roofline tasks. The old ids (`t-cpu-serial` …
 * `t-roof-fleet-prefill`) are no longer registered or detected; an earlier completion still shows through
 * `legacyId`.
 *
 * Hardware numbers in the prompts are formatted from the atlas, never typed. The scenario numbers (batch 1,
 * a 128 × 128 tile, a 32k context, head dimension 128, the CPU and GPU timings, the tier bandwidths and the
 * Fleet worksheet's FLOPs and bytes) are synthetic and declared so.
 */

import { KC } from '@/data/kc/ids'
import {
  ATTENTION,
  CPU_GPU,
  FLEET_KERNELS,
  MACHINES,
  PCIE_BW_GBS,
  REG_FILE_REGS,
  SETUP,
  SHARED_BW_GBS,
  WARP_THREADS,
  batchToRidge,
  fmtAI,
  fmtPeak,
  fmtTBs,
  gpuMapMs,
  hbmOverPcie,
  mapSpeedup,
  maxRegistersFor,
  paddingGain,
  ridgeAI,
  serialSpeedup,
  sharedOverHbm,
  stagedPercent,
} from '@/lib/sims/models/roofline'
import type { FleetKernel } from '@/lib/sims/models/roofline'
import type { SimTaskDef } from '@/lib/sims/types'

const { h100, b200 } = MACHINES
const h100Ridge = ridgeAI(h100)
const b200Ridge = ridgeAI(b200)
const h100Fp8Ridge = ridgeAI(h100, SETUP.fp8.dtype)
const batchFirst = batchToRidge(h100, SETUP.decode.dtype)

const CHART_TASKS: SimTaskDef[] = [
  {
    id: 'roof.ridge',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the B200 ridge point',
    setup: 'Choose B200 in the hardware menu and keep the precision ceiling on FP16. The sim reports that machine\'s ridge.',
    kcs: [KC.ridgePoint],
    predict: {
      kind: 'numeric',
      prompt: `A B200 delivers ${fmtPeak(b200.peak)} of dense FP16 and ${fmtTBs(b200.bw)} of HBM bandwidth. At what arithmetic intensity do the bandwidth slope and the compute ceiling meet?`,
      unit: 'FLOP/B',
      tolerance: { rel: 0.05 },
    },
    observe: 'roof.ridge',
    explain: {
      prompt: 'In one line: why does the ridge sit there, and what changes for a kernel on either side of it?',
      model: `The ridge is peak FLOP/s divided by peak bandwidth, ${fmtPeak(b200.peak)} over ${fmtTBs(b200.bw)}, about ${fmtAI(b200Ridge)} FLOP/B. A kernel left of it is capped by the bandwidth slope, one right of it by the flat compute ceiling.`,
      ideas: ['The ridge is peak FLOP/s divided by peak bandwidth', 'Left of it, bandwidth caps the kernel', 'Right of it, the compute ceiling caps it'],
    },
    note: 'The ridge is a property of the **machine**, one division of two datasheet numbers. A kernel\'s intensity is a property of the **kernel**. Comparing the two is the whole classification.',
    phone: { canonical: 'roofline.b200-ridge' },
    lessons: ['t4.l3'],
    legacyId: 't-roof-b200-ridge',
  },
  {
    id: 'roof.decode-bound',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Classify decode at batch 1 on the H100',
    setup: 'Pick H100 with the FP16 ceiling, leave the batch at ×1, then click "decode @ 70B" in the kernel library to plot it.',
    kcs: [KC.boundClassification],
    predict: {
      kind: 'choice',
      prompt: 'Decoding one token at a time (batch 1) reads every weight once for about one FLOP per byte. On an H100 at FP16, which limit does it hit first?',
      options: [
        { id: 'bandwidth', text: 'The bandwidth slope: it waits on HBM while the compute units idle' },
        { id: 'compute', text: 'The compute ceiling: it runs out of FLOP/s before HBM is saturated' },
      ],
    },
    observe: 'roof.decode-bound',
    explain: {
      prompt: 'Say why in one line, using intensity and the ridge.',
      model: `Decode at batch ${SETUP.decode.batch} does about one FLOP per byte of weights, far left of the H100's ridge at ${fmtAI(h100Ridge)} FLOP/B. Attainable speed is bandwidth times intensity there, so extra FLOP/s would not help.`,
      ideas: ['Decode intensity is about 1 FLOP/B', 'That sits far left of the ridge', 'Speed is set by bandwidth, so more FLOP/s will not help'],
    },
    note: 'Decode sits on the **sloped wall**. Its dot rides the bandwidth line, hundreds of times below the compute ceiling. That is why batching, quantization and speculative decoding, all levers on bytes per FLOP, matter more than a faster chip.',
    phone: { canonical: 'roofline.decode-bound' },
    lessons: ['t4.l3'],
    legacyId: 't-decode',
  },
  {
    id: 'roof.batch-to-ridge',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Batch decode until it reaches the ridge',
    setup: 'On the H100 at FP16, plot decode, then raise the batch slider until its dot reaches the flat compute roof.',
    kcs: [KC.decodeBandwidth],
    predict: {
      kind: 'numeric',
      prompt: `Every request in a decode batch shares the same weight reads, so a batch of N has N times the intensity of batch 1. On an H100 at FP16 (ridge about ${fmtAI(h100Ridge)} FLOP/B), which slider step is the first to reach the ridge?`,
      unit: 'requests',
      tolerance: { rel: 0.45 },
    },
    observe: 'roof.batch-to-ridge',
    explain: {
      prompt: 'Why does batching move decode right, and why does it stop helping?',
      model: `All requests in the batch reuse one read of the weights, so FLOPs grow with the batch while bytes stay fixed and intensity rises in proportion. At batch ${batchFirst ?? '?'} it passes the ridge, the compute ceiling takes over, and a bigger batch no longer speeds each step up.`,
      ideas: ['The batch shares one read of the weights', 'Intensity grows in proportion to batch', 'Past the ridge the compute ceiling takes over'],
    },
    note: 'Batching is a **ride along the slope**: throughput climbs with the batch until the dot meets the roof. Past that point the batch adds latency without adding speed.',
    phone: { canonical: 'roofline.batch-to-ridge' },
    lessons: ['t4.l3'],
    legacyId: 't-batch',
  },
  {
    id: 'roof.tile-ai',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the intensity of a 128 × 128 tile',
    setup: 'In "tiling & attention", drag the matmul tile T up from 16 to 128. The sim reports the intensity at T = 128.',
    kcs: [KC.tilingIntensity],
    predict: {
      kind: 'numeric',
      prompt: `A matmul kernel computes one ${SETUP.tile} × ${SETUP.tile} output tile at a time and loads its operand slabs from HBM once per tile, with 2-byte FP16 elements. What arithmetic intensity does the tile reach?`,
      unit: 'FLOP/B',
      tolerance: { rel: 0.1 },
    },
    observe: 'roof.tile-ai',
    explain: {
      prompt: 'Where does the extra intensity come from?',
      model: 'Each A and B element staged in shared memory is reused T times. A T × T tile does 2·T²·K FLOPs on 2·T·K·2 bytes, so FP16 intensity is T/2, and it grows linearly with T.',
      ideas: ['Each staged element is reused T times', 'FLOPs grow as T² while bytes grow only as T', 'At FP16 the intensity is T/2'],
    },
    note: 'Tiling does not change the FLOPs. It changes **which tier feeds them**: each byte from HBM now serves T multiplies, so the dot moves right along the roofline.',
    phone: { canonical: 'roofline.tile-ai' },
    lessons: ['t4.l6'],
    legacyId: 't-roof-tile',
  },
  {
    id: 'roof.flash-ai',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict FlashAttention\'s intensity at 32k context',
    setup: 'Under "attention view", switch from naive to flash. The sim reports the intensity of the flash view.',
    kcs: [KC.tilingIntensity],
    predict: {
      kind: 'numeric',
      prompt: `At a ${ATTENTION.context.toLocaleString('en-US')}-token context with head dimension ${ATTENTION.headDim}, naive attention writes the N × N FP16 score matrix to HBM and sits near ${ATTENTION.naiveAI} FLOP/B. FlashAttention does the same FLOPs but keeps the scores in SRAM and moves only Q, K and V (3 · N · ${ATTENTION.headDim} FP16 values). What intensity does the sim report for it?`,
      unit: 'FLOP/B',
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'roof.flash-ai',
    explain: {
      prompt: 'What did FlashAttention change, and what did it leave alone?',
      model: 'It leaves the FLOPs alone and removes the N × N score traffic by keeping partial scores in SRAM with an online softmax. The same math moves far fewer bytes, so intensity rises by roughly the byte ratio and attention moves toward the compute roof.',
      ideas: ['The FLOPs are unchanged', 'The N × N scores never go to HBM', 'Fewer bytes for the same FLOPs raise the intensity'],
    },
    note: 'FlashAttention is **cache blocking applied to attention**. The sim\'s flash figure is a round number of the right order (the byte ratio is about N / 3d); real kernels land lower once rescaling work and tile shapes are counted.',
    phone: { canonical: 'roofline.flash-ai' },
    lessons: ['t4.l6'],
    legacyId: 't-roof-flash',
  },
  {
    id: 'roof.fp8-ridge',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the H100 ridge at the FP8 ceiling',
    setup: 'Pick H100 with the FP16 ceiling, then switch the precision ceiling to FP8. The sim reports the new ridge.',
    kcs: [KC.ridgePoint],
    predict: {
      kind: 'numeric',
      prompt: `An H100 delivers ${fmtPeak(h100.peak)} of dense FP16 against ${fmtTBs(h100.bw)} of HBM bandwidth, and FP8 doubles the peak. Where is its ridge at the FP8 ceiling?`,
      unit: 'FLOP/B',
      tolerance: { rel: 0.05 },
    },
    observe: 'roof.fp8-ridge',
    explain: {
      prompt: 'Why does the ridge move when only the precision changes?',
      model: `The ridge is peak FLOP/s over bandwidth. FP8 doubles the peak and leaves the bandwidth alone, so the ridge doubles from ${fmtAI(h100Ridge)} to ${fmtAI(h100Fp8Ridge)} FLOP/B: a kernel now needs twice the intensity to be compute-bound.`,
      ideas: ['The ridge is peak FLOP/s over bandwidth', 'FP8 doubles the peak FLOP/s', 'Bandwidth is unchanged, so the ridge doubles'],
    },
    note: 'Lower precision raises the **ceiling**, not the slope. The bandwidth wall stays where it was, so more of the chart now lies under it.',
    phone: { canonical: 'roofline.fp8-ridge' },
    lessons: ['t4.l3'],
    legacyId: 't-roof-dtype',
  },
]

/** The four rows of the B200 Fleet worksheet: place the kernel, and the sim reports its intensity. */
function fleetTask(k: FleetKernel): SimTaskDef {
  const copy = FLEET_COPY[k.id]
  const ridge = fmtAI(b200Ridge)
  const bound = k.ai < b200Ridge ? 'bandwidth' : 'compute'
  return {
    id: `roof.${k.id}`,
    simId: 'sim-roofline',
    kind: 'outcome',
    title: `Predict the intensity of ${k.label} and place it on the B200`,
    setup: `In the B200 fleet table, press "place on B200" for ${k.label}. The sim reports its intensity.`,
    kcs: [KC.boundClassification],
    predict: {
      kind: 'numeric',
      prompt: `The Fleet serving loop's ${k.label} does ${k.flopsG.toLocaleString('en-US')} GFLOP of arithmetic over ${k.bytesG.toLocaleString('en-US')} GB of memory traffic. What arithmetic intensity does it have?`,
      unit: 'FLOP/B',
      tolerance: { rel: 0.05 },
    },
    observe: `roof.${k.id}`,
    explain: {
      prompt: `In one line: which side of the B200's ridge (${ridge} FLOP/B) does it land on, and what limits it?`,
      model: `${fmtAI(k.ai)} FLOP/B is ${k.ai < b200Ridge ? 'left' : 'right'} of the B200's ridge at ${ridge} FLOP/B, so it is ${bound}-bound: ${copy.limit}`,
      ideas: copy.ideas(ridge),
    },
    note: copy.note,
    phone: { canonical: `roofline.${k.id}` },
    lessons: ['t4.l3'],
    legacyId: `t-roof-${k.id}`,
  }
}

const FLEET_COPY: Record<FleetKernel['id'], { limit: string; note: string; ideas: (ridge: string) => [string, string, string] }> = {
  'fleet-router': {
    limit: 'it does a little arithmetic per byte it reads, so extra FLOP/s would not speed it up.',
    note: 'Router scoring is **bandwidth-bound by a wide margin**: it touches a lot of state for very little math. It matters for latency, not for FLOP/s.',
    ideas: (ridge) => ['Intensity is FLOPs divided by bytes moved', `About one and a half FLOP per byte is far left of the ridge at ${ridge}`, 'So it is bandwidth-bound: more FLOP/s would not speed it up'],
  },
  'fleet-decode': {
    limit: 'batching 32 requests shares one read of the weights, but that is still far too little reuse to reach the ridge.',
    note: 'Batching moves decode **right** along the slope, and a batch of 32 is still on the bandwidth side. Only a very large batch, or fewer bytes per weight, reaches the ridge.',
    ideas: (ridge) => ['A batch of 32 shares one read of the weights, so intensity is 32 FLOP/B', `That is still well left of the ridge at ${ridge}`, 'So decode stays bandwidth-bound even at batch 32'],
  },
  'fleet-paged-attn': {
    limit: 'it sits just under the ridge, so a little more reuse per byte would tip it over.',
    note: 'Paged attention lands **just left of the ridge**: close enough that block layout and batch size decide which side it is on in practice.',
    ideas: (ridge) => ['Intensity is FLOPs divided by bytes moved: 256 FLOP/B', `That is just left of the ridge at ${ridge}`, 'So it is bandwidth-bound, narrowly: a little more reuse would make it compute-bound'],
  },
  'fleet-prefill': {
    limit: 'the 512 tokens of the prompt reuse every weight they read, so the compute ceiling is what limits it.',
    note: 'Prefill is the **opposite of decode**: a long prompt amortises the weight reads, so it lives on the flat roof and is limited by FLOP/s.',
    ideas: (ridge) => ['512 tokens share one read of the weights, so intensity is 512 FLOP/B', `That is right of the ridge at ${ridge}`, 'So prefill is compute-bound: the compute ceiling limits it'],
  },
}

/** The twelve tasks that replace the click-throughs of the CPU/GPU demo, the probes and the B200 worksheet. */
const PROBE_TASKS: SimTaskDef[] = [
  {
    id: 'roof.cpu-serial',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict how much faster the CPU is on a serial chain',
    setup: 'Under "CPU vs GPU", press "run serial comparison". The sim reports how many times faster the CPU is.',
    kcs: ['t4.throughput-design'],
    predict: {
      kind: 'numeric',
      prompt:
        'A chain of dependent operations runs on one CPU core and on the GPU. Each step needs the previous result, so the GPU\'s thousands of lanes have nothing to share, and every step also pays launch and synchronisation overhead. By what factor is the CPU faster?',
      unit: '×',
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'roof.cpu-serial',
    explain: {
      prompt: 'In one line: why does the CPU win this one?',
      model: `Every step waits on the one before it, so the GPU's lanes cannot work in parallel. A CPU core is built for single-thread latency (${CPU_GPU.cpuSerialMs} ms here), and the GPU also pays launch and synchronisation cost on each step (${CPU_GPU.gpuSerialMs} ms), so the CPU is ${fmtAI(serialSpeedup())}× faster.`,
      ideas: ['Each step depends on the previous result, so nothing runs in parallel', 'A CPU core is built for single-thread latency', 'The GPU adds launch and synchronisation overhead to each step'],
    },
    note: 'A serial chain is a **latency** problem, and the CPU is the latency machine. The GPU\'s advantage is throughput over many independent elements, which the next task measures. The timings are synthetic but have the right shape.',
    phone: { canonical: 'roofline.cpu-serial' },
    lessons: ['t4.l1'],
    legacyId: 't-cpu-serial',
  },
  {
    id: 'roof.gpu-map',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the GPU\'s speedup on a 64M-element map',
    setup: 'Under "CPU vs GPU", keep the access pattern on coalesced and the occupancy at its default, then press "run map comparison".',
    kcs: ['t4.throughput-design'],
    predict: {
      kind: 'numeric',
      prompt:
        'Now an elementwise map over 64 million independent floats, with coalesced loads and enough resident warps to hide memory latency. The same work runs on one CPU core and on the GPU. By what factor is the GPU faster?',
      unit: '×',
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'roof.gpu-map',
    explain: {
      prompt: 'In one line: why does the GPU win this one?',
      model: `The elements are independent, so thousands of lanes work at once, and neighbouring lanes read neighbouring addresses, so the loads coalesce. The GPU needs ${CPU_GPU.gpuMapMs} ms against the CPU's ${CPU_GPU.cpuMapMs} ms: ${fmtAI(mapSpeedup(1, 1))}× faster.`,
      ideas: ['The elements are independent, so thousands of lanes work at once', 'Neighbouring lanes read neighbouring addresses, so the loads coalesce', 'Throughput over many elements, not single-thread latency, sets the time'],
    },
    note: 'Two wins, one rule: match the machine to the problem shape. A map over independent elements fills the warps; a dependent chain cannot. The next task shows what happens when the lanes of a warp stop agreeing.',
    phone: { canonical: 'roofline.gpu-map' },
    lessons: ['t4.l1'],
    legacyId: 't-gpu-map',
  },
  {
    id: 'roof.gpu-divergence',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the GPU\'s lead when its warps diverge',
    setup: 'Under "memory access pattern" choose "divergent", then under "CPU vs GPU" press "run map comparison".',
    kcs: ['t4.simt-warps'],
    predict: {
      kind: 'numeric',
      prompt: `The same map, but the lanes of each warp now take different branches, so a warp runs its paths one after the other and keeps one eighth of its throughput (a synthetic figure). The clean GPU run took ${CPU_GPU.gpuMapMs} ms against the CPU's ${CPU_GPU.cpuMapMs} ms. By what factor does the GPU still beat the CPU?`,
      unit: '×',
      tolerance: { rel: 0.1 },
    },
    observe: 'roof.gpu-divergence',
    explain: {
      prompt: 'In one line: what does a divergent branch cost a warp?',
      model: `A warp issues one instruction for all 32 lanes, so lanes that disagree cannot run together. The hardware runs each path in turn with the others masked off, which here leaves an eighth of the throughput: ${fmtAI(gpuMapMs(1 / 8, 1))} ms, so the GPU's lead falls from ${fmtAI(mapSpeedup(1, 1))}× to ${fmtAI(mapSpeedup(1 / 8, 1))}×.`,
      ideas: ['A warp shares one instruction stream across its 32 lanes', 'Lanes that disagree run their paths one after another, with the rest masked off', 'Throughput falls with the number of paths, so the lead shrinks'],
    },
    note: 'The GPU still wins, but by a fraction of what uniform work earns. **Divergence** is the price of one instruction stream per warp, and it is why branchy code belongs on the CPU or must be restructured.',
    phone: { canonical: 'roofline.gpu-divergence' },
    lessons: ['t4.l1'],
    legacyId: 't-gpu-divergence',
  },
  {
    id: 'roof.occupancy',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the register limit of 16 warps per SM',
    setup: 'Keep warps per SM at 16 and raise registers per thread until occupancy falls below 25%. The sim reports the limit it crossed.',
    kcs: ['t4.occupancy'],
    predict: {
      kind: 'numeric',
      prompt: `A kernel keeps ${SETUP.occupancy.warps} warps of ${WARP_THREADS} threads resident on each SM, and the SM's register file holds ${REG_FILE_REGS.toLocaleString('en-US')} 32-bit registers. What is the largest register count per thread at which all ${SETUP.occupancy.warps} warps still fit?`,
      unit: 'registers',
      tolerance: { rel: 0.05 },
    },
    observe: 'roof.occupancy',
    explain: {
      prompt: 'In one line: why does occupancy fall when a kernel uses more registers?',
      model: `Every resident thread keeps its registers for its whole life, so warps × ${WARP_THREADS} × registers per thread must fit the register file. At ${SETUP.occupancy.warps} warps that is ${maxRegistersFor(SETUP.occupancy.warps)} registers per thread. Past it fewer warps fit, and with fewer warps a stalled load leaves nothing else to run.`,
      ideas: ['Resident threads hold their registers for their whole life', 'Warps × 32 × registers per thread must fit in the register file', 'Fewer resident warps leave a memory stall with nothing to hide behind'],
    },
    note: 'Registers are one of the three budgets that cap occupancy, beside shared memory and warp slots. A kernel that uses many registers per thread buys fast arithmetic and pays for it in fewer warps to hide latency.',
    phone: { canonical: 'roofline.occupancy' },
    lessons: ['t4.l1', 't4.l4'],
    legacyId: 't-roof-occupancy',
  },
  {
    id: 'roof.coalesce',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict what shared-memory staging recovers',
    setup: 'On the H100, switch the access pattern to "shared transpose" with the bank-conflict switch off. The sim reports the end-to-end bandwidth.',
    kcs: ['t4.coalescing'],
    predict: {
      kind: 'numeric',
      prompt: `Strided loads deliver a thirty-second of the H100's ${fmtTBs(h100.bw)}. Staging the tile through shared memory instead makes the global load coalesced, at full HBM speed, and every 128 useful bytes also costs 256 bytes of conflict-free shared traffic (a write and a transposed read) at ${fmtTBs(SHARED_BW_GBS)}. What percent of the HBM bandwidth does the kernel deliver end to end?`,
      unit: '%',
      tolerance: { abs: 5 },
    },
    observe: 'roof.coalesce',
    explain: {
      prompt: 'In one line: what does staging fix, and what does it cost?',
      model: `Staging coalesces the global load, so HBM moves only useful bytes again. The price is shared-memory traffic: each 128 B costs one HBM pass and two shared passes, and the times add, so the kernel reaches about ${fmtAI(stagedPercent(h100.bw))}% of HBM speed, far above the strided 3%.`,
      ideas: ['Staging makes the global load coalesced, so no HBM bytes are wasted', 'The cost is extra shared-memory traffic, a write and a transposed read', 'The times add, so it lands below full HBM speed but far above the strided case'],
    },
    note: 'Shared memory turns a bad **global** access pattern into a good one by letting the kernel reorder inside the SM. It is not free, which is why the result sits below a plain coalesced read.',
    phone: { canonical: 'roofline.coalesce' },
    lessons: ['t4.l4'],
    legacyId: 't-roof-coalesce',
  },
  {
    id: 'roof.bank',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict what padding gives back from a bank conflict',
    setup: 'On the H100, with "shared transpose" selected, turn on the 32-way bank conflict, then the +1 padding fix. The sim reports the gain.',
    kcs: ['t4.coalescing'],
    predict: {
      kind: 'numeric',
      prompt:
        'The shared-memory transpose now hits a 32-way bank conflict: its shared-memory half runs 32 times slower. Padding each row by one element removes the conflict. By what factor does the padding raise the kernel\'s end-to-end bandwidth on the H100?',
      unit: '×',
      tolerance: { rel: 0.1 },
    },
    observe: 'roof.bank',
    explain: {
      prompt: 'In one line: why is the gain not 32×?',
      model: `Thirty-two lanes hit one bank and are served one at a time, so the shared half runs 32× slower. The global half is untouched and the two times add, so the whole kernel is ${fmtAI(paddingGain(h100.bw))}× slower, not 32×. One element of padding moves each row to a new bank and gives that back.`,
      ideas: ['Lanes that hit one bank are served one at a time', 'Only the shared-memory half slows 32×, because the global load is unchanged', 'Padding by one element spreads a column across the banks'],
    },
    note: 'A bank conflict is a **shared-memory** slowdown, so it is diluted by whatever the kernel spends elsewhere. The fix is cheap: pad the row stride so that consecutive rows start in different banks.',
    phone: { canonical: 'roofline.bank' },
    lessons: ['t4.l4'],
    legacyId: 't-roof-bank',
  },
  {
    id: 'roof.tiers',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict how much faster shared memory is than HBM',
    setup: 'On the H100, drag the working set from 4 KiB up past 50 MiB so the tier label reads shared, then L2, then HBM.',
    kcs: ['t4.gpu-memory-ladder'],
    predict: {
      kind: 'numeric',
      prompt: `Sweep a working set from a few KiB to many GiB on an H100. Shared memory serves the smallest sets at ${fmtTBs(SHARED_BW_GBS)} (a synthetic figure) and HBM the largest at ${fmtTBs(h100.bw)}, with L2 between them. How many times faster is the shared-memory tier than HBM?`,
      unit: '×',
      tolerance: { rel: 0.05 },
    },
    observe: 'roof.tiers',
    explain: {
      prompt: 'In one line: why does each step of the sweep slow the reads down?',
      model: `Which tier holds the data depends on the working-set size. The smaller tiers sit nearer the SM and are faster: shared memory is on-chip, L2 is shared by the whole GPU, and HBM is off the die. Crossing a capacity is a cliff, and shared memory to HBM is about ${fmtAI(sharedOverHbm(h100.bw))}×.`,
      ideas: ['The working-set size decides which tier holds the data', 'Smaller tiers sit nearer the SM and are faster', 'Crossing a capacity is a cliff in bandwidth, not a slope'],
    },
    note: 'The cliffs are the design constraint behind every kernel: fast tiers are small and local, the big tier is shared and far. Tiling exists to keep the working set in the upper tiers.',
    phone: { canonical: 'roofline.tiers' },
    lessons: ['t4.l2'],
    legacyId: 't-roof-tiers',
  },
  {
    id: 'roof.pcie',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the PCIe offload cliff against HBM',
    setup: 'On the H100, switch "CPU→GPU over PCIe" on in the memory tier probe. The sim reports the ratio to HBM.',
    kcs: ['t4.gpu-memory-ladder'],
    predict: {
      kind: 'numeric',
      prompt: `The sim's CPU→GPU path is a PCIe 4.0 x16 link at ${PCIE_BW_GBS} GB/s (the H100 SXM's own PCIe 5.0 link is twice as fast). Against streaming HBM at ${fmtTBs(h100.bw)}, how many times slower is a transfer over PCIe?`,
      unit: '×',
      tolerance: { rel: 0.05 },
    },
    observe: 'roof.pcie',
    explain: {
      prompt: 'In one line: what does that ratio mean for offloading to host memory?',
      model: `PCIe is a narrow link between the host and the GPU, while HBM sits beside the die on a very wide bus. A byte over PCIe costs about ${fmtAI(hbmOverPcie(h100.bw))} HBM reads here (about half that on a Gen5 link), so offload is a last resort and not a free extra tier.`,
      ideas: ['PCIe is a narrow link between the host and the GPU', 'HBM sits beside the die on a far wider bus', 'A byte over PCIe costs tens to a hundred HBM reads, so offload is a last resort'],
    },
    note: 'Below HBM is the PCIe abyss. KV offload and weight streaming live there, and only when the bytes cannot stay on the GPU. A Gen5 link halves the gap, which is still tens of times.',
    phone: { canonical: 'roofline.pcie' },
    lessons: ['t4.l2'],
    legacyId: 't-roof-pcie',
  },
  ...FLEET_KERNELS.map(fleetTask),
]

export const ROOFLINE_TASKS: SimTaskDef[] = [...CHART_TASKS, ...PROBE_TASKS]
