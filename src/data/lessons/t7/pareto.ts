import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't7.l3',
  slug: 'pareto',
  trackId: 't7',
  index: 3,
  title: 'The Pareto Frontier: tok/s/GPU vs tok/s/user',
  minutes: 25,
  hook: 'There is no fastest engine — there is a frontier of engines, each optimal at one tradeoff between margin and experience. Reading that curve is the senior skill: it decides hardware, batch policy, and which benchmark claims to ignore.',
  exercise: 'read+quiz',
  verifiedAt: '2026-10',
  blocks: [
    {
      type: 'prose',
      md: `Plot two axes: **throughput per GPU** (the provider's margin) against **tokens per second per user** (the user's experience). Every engine configuration is a point; the best achievable points form a **Pareto frontier**, and everything real sits below it. The frontier is concave: low concurrency gives you blazing interactivity at pitiful utilization; high concurrency gives you fleet-leading tok/s/GPU at "is it frozen?" latencies. You cannot have both ends. Nobody can. The game is choosing *where* on the curve to live.

This is why contradictory benchmark claims can both be true: they are *different points on the same frontier*. In SemiAnalysis's InferenceMAX launch (now InferenceX, 2025-10-09), DeepSeek-R1 FP4 shows a GB200 NVL72 well ahead at 30 tok/s/user, yet above 90 tok/s/user a single-node B200 on TRT-LLM beats it. The usual explanation: the NVL72 fabric amortizes MoE weights across giant batches, while the high-interactivity region needs small batches, where MTP gives 2–3× interactivity at a given cost. Same hardware family, opposite ends of the curve.`,
    },
    {
      type: 'prose',
      md: `## The dial that moves you along the curve (and the ones that move the curve)

**Along the frontier** (efficiency unchanged, tradeoff chosen):
- **Batch size / concurrency** — the master dial (T7.L1's seesaw).

**Changing the workload** is not a move along one curve: InferenceX publishes a separate frontier for each input/output length, so long prompts versus chat streams means reading a different curve, not sliding further along this one.

**Moving the frontier itself** (genuine progress — more of both):
- **Quantization** (T6.L5): FP8→NVFP4 moves ~1.8× fewer bytes (4.5 bits per weight with block scales), not 2× — the whole curve shifts out.
- **Speculative decoding** (T6.L6): shifts the *interactivity end* (up to 2–3× on DeepSeek-R1 in SemiAnalysis's InferenceX runs), barely touches the throughput end.
- **Disaggregation** (T6.L3): shifts the middle — better ITL at given throughput via phase isolation.
- **Better kernels and hardware** (T4, T6.L5): the boring, reliable shifter.

When a vendor shows you a point, ask: which dial did they turn? If the answer is batch size, the frontier didn't move. If it's MTP/FP4/disaggregation, it did — for that region. Frontier literacy is how you read InferenceX (T7.L2) in ten seconds: their dashboard plots exactly these two axes, per engine, per GPU.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — the frontier and its regions',
      height: 52,
      nodes: [
        { id: 'y', x: 6, y: 4, w: 10, h: 40, label: 'tok/s/GPU ↑', sub: 'margin' },
        { id: 'x', x: 18, y: 40, w: 60, h: 8, label: 'tok/s/user →', sub: 'experience' },
        { id: 'curve', x: 22, y: 8, w: 52, h: 24, label: 'Pareto frontier', sub: 'best achievable tradeoffs', color: '#3EF2A4' },
        { id: 'hi', x: 60, y: 14, w: 26, h: 8, label: 'B200 node + MTP', sub: 'high interactivity', color: '#5CA8FF' },
        { id: 'lo', x: 24, y: 14, w: 26, h: 8, label: 'GB200 NVL72', sub: 'max throughput', color: '#A78BFA' },
        { id: 'slo', x: 66, y: 28, w: 22, h: 8, label: 'SLO floor', sub: 'operate right of it', color: '#FB7185' },
      ],
      edges: [
        { from: 'curve', to: 'hi', label: '' },
        { from: 'curve', to: 'lo', label: '' },
      ],
      steps: [
        { caption: 'The frontier: every configuration is a point below it; best tradeoffs on it. Concave — the ends exclude each other.', active: ['curve', 'y', 'x'], edges: [] },
        { caption: 'Regions: NVL72 dominates the throughput end (fabric amortizes weights across giant batches); a single node + MTP dominates interactivity. Contradictory claims, both true.', active: ['hi', 'lo'], edges: ['curve->hi', 'curve->lo'] },
        { caption: 'The SLO floor: only the region right of it is sellable. Your product\'s latency contract picks your operating point — and therefore your hardware and your margin.', active: ['slo', 'curve'], edges: ['curve->slo'] },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This is your **thread-pool sizing chart drawn honestly for once**: throughput vs latency, one curve, pick a point. The difference from your web service: the curve's *shape* is physics (bandwidth vs compute, T4.L3), so it shifts only when bytes or bandwidth change — which is why the "move the frontier" list is exactly four items long and every T6 lesson is on it.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'In SemiAnalysis\'s InferenceMAX launch (Oct 2025, now InferenceX), DeepSeek-R1 FP4 has a GB200 NVL72 leading at 30 tok/s/user while a B200 on TRT-LLM beats it above 90 tok/s/user. These results are…',
          options: [
            'In conflict, since one model on one hardware family cannot have two winners and one harness must be flawed',
            'Both true, since they sit at the throughput end and the interactivity end of one frontier',
            'About different models, since a large model favors the rack and a small model favors the node',
            'Both marketing, since vendor-chosen configurations and workloads make neither claim informative',
          ],
          correct: [1],
          explanation:
            'The frontier\'s ends exclude each other; different configs are optimal in different regions. This is the single most common source of "contradictory" benchmark claims — check which end of the curve the number came from.',
          why: [
            'A frontier has one winner per region, not per model. Throughput and interactivity are separate axes, so different configs lead at each end without any flaw.',
            'Right: the ends of the frontier exclude each other. NVL72\'s fabric amortizes weights across giant batches, while a single node with MTP gives the highest per-user rate.',
            'Both claims are about the same model, DeepSeek-R1. The split is by operating point on one frontier, not by model, so a different model cannot explain it.',
            'InferenceX publishes public runs with Apache-2.0 code and data, so the points can be checked, not just asserted. Each claim is true for its own region.',
          ],
        },
        {
          q: 'Which of these moves the FRONTIER, rather than sliding along it?',
          options: [
            'Raising batch size or concurrency, which lifts tokens per second per chip at the cost of per-user speed',
            'Quantized weights, speculative decoding or disaggregated phases that change the bytes moved or overlap',
            'Loosening the latency target the product promises, which makes more operating points sellable',
            'Adding replicas behind the load balancer, which multiplies fleet tokens per second at the same per-user speed',
          ],
          correct: [1],
          explanation:
            'Batch size and the SLO pick a point on the curve (same efficiency, different tradeoff), and replicas only scale the total. The frontier shifts only when the physics change: fewer bytes, more bandwidth, or better overlap of compute and communication.',
          why: [
            'Batch size is the master dial along the frontier. It trades per-user speed for per-GPU throughput at unchanged efficiency, so the curve itself stays put.',
            'Right: the frontier shifts only when physics changes, with fewer bytes, more bandwidth or better overlap. Batch size and the SLO only choose a point on the existing curve.',
            'A looser SLO changes which region is sellable, not what is achievable. The operable zone widens while the curve is exactly where it was.',
            'Replicas scale the fleet total but each GPU stays on the same per-GPU curve. Tokens per second per GPU and per-user speed are unchanged, so the frontier does not move.',
          ],
        },
        {
          q: 'MTP speculative decoding shifts…',
          options: [
            'The whole frontier uniformly, with fewer forward passes per token helping at each batch size',
            'Only the first-token latency, with extra draft tokens produced during prefill to shorten the wait',
            'The interactivity end most, spending idle decode compute while barely moving the throughput end',
            'The throughput end most, with several tokens verified per step lifting tokens per second at large batch',
          ],
          correct: [2],
          explanation:
            'T6.L6\'s mechanism converts spare per-user compute into speed. Region-specific frontier shifts are why you must read claims regionally — "2–3×" is true at one end and nearly false at the other.',
          why: [
            'At large batch there are no idle FLOPs to spend, so speculation helps little. The gain is regional, concentrated at the interactivity end, not uniform.',
            'Speculation acts on the decode loop, not prefill. It raises the per-user token rate after the first token and leaves TTFT largely unchanged.',
            'Right: at small batch, decode leaves compute idle, and MTP converts it into speed. At large batch the compute is already used, so the throughput end barely moves.',
            'Reversed. Large batches already saturate compute, so verifying rejected draft tokens wastes real FLOPs there. The benefit is largest where batches are small.',
          ],
        },
        {
          q: 'Your product\'s SLO determines…',
          options: [
            'The frontend\'s timeout and retry settings, while the engine\'s operating point comes from a batch-size flag',
            'Which region of the frontier is sellable, with the latency contract setting the operating point',
            'The frontier itself, with a stricter target forcing the vendor to find faster kernels and newer hardware',
            'Nothing about hardware, with chip choice following model size and replicas added to meet the target',
          ],
          correct: [1],
          explanation:
            'The SLO floor cuts the frontier: points right of it are sellable. A tight interactivity SLO forces small batches and per-user tech (MTP); a loose one unlocks giant-batch economics. The contract is the first engineering input.',
          why: [
            'The batch-size setting that gives your operating point is itself chosen to satisfy the SLO. Treating the contract as a client-side detail skips the first engineering input.',
            'Right: points right of the SLO floor are sellable. A tight interactivity SLO forces small batches and per-user techniques like MTP, while a loose one unlocks giant-batch economics.',
            'Contracts do not change physics. The frontier moves only when bytes, bandwidth or overlap change; the SLO decides where on it you must operate.',
            'Replicas multiply throughput at one operating point but cannot raise per-user token rate. A tight interactivity SLO can require different hardware or techniques, not more copies.',
          ],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Numbers to recite',
      md: `The InferenceMAX launch article (SemiAnalysis, 2025-10-09; the project is now InferenceX), DeepSeek-R1 FP4: above **90 tok/s/user** a B200 on TRT-LLM beats the GB200 NVL72, and a single-node B200 server can give better TCO per performance for high-interactivity use; at **30 tok/s/user** a GB200 NVL72 FP4 (no MTP) delivers ~**8×** the tokens per all-in provisioned MW of a single-node H200 FP8; MTP is worth **2–3×** interactivity at a given cost. Keep these as your sanity anchors for any vendor claim: if a number beats these regions decisively, ask which dial was turned and on which traffic.`,
    },
  ],
}

export default lesson
