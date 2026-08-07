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
  blocks: [
    {
      type: 'prose',
      md: `Plot two axes: **throughput per GPU** (the provider's margin) against **tokens per second per user** (the user's experience). Every engine configuration is a point; the best achievable points form a **Pareto frontier**, and everything real sits below it. The frontier is concave: low concurrency gives you blazing interactivity at pitiful utilization; high concurrency gives you fleet-leading tok/s/GPU at "is it frozen?" latencies. You cannot have both ends. Nobody can. The game is choosing *where* on the curve to live.

This is why contradictory benchmark claims are both true: NVIDIA's "60k tok/s/GPU on gpt-oss" and "1k tok/s/user on GB200 NVL72" are *different points on the same frontier* (InferenceMAX, Oct 2025). GB200 wins the low-interactivity/high-throughput region (its NVL72 fabric amortizes MoE weights across giant batches); a single B200 node can win the *high-interactivity* region, where MTP gives 2–3× per-user rate and giant batches are impossible anyway. Same hardware family, opposite ends of the curve.`,
    },
    {
      type: 'prose',
      md: `## The three dials that move you along (and the two that move the curve)

**Along the frontier** (efficiency unchanged, tradeoff chosen):
- **Batch size / concurrency** — the master dial (T7.L1's seesaw).
- **Traffic mix** — long prompts drag you toward the throughput end; chat streams toward interactivity.

**Moving the frontier itself** (genuine progress — more of both):
- **Quantization** (T6.L5): FP8→FP4 halves bytes — the whole curve shifts out.
- **Speculative decoding** (T6.L6): shifts the *interactivity end* 2–3×, barely touches the throughput end.
- **Disaggregation** (T6.L3): shifts the middle — better ITL at given throughput via phase isolation.
- **Better kernels and hardware** (T4, T6.L5): the boring, reliable shifter.

When a vendor shows you a point, ask: which dial did they turn? If the answer is batch size, the frontier didn't move. If it's MTP/FP4/disaggregation, it did — for that region. Frontier literacy is how you read InferenceMAX (T7.L2) in ten seconds: their dashboard plots exactly these two axes, per engine, per GPU.`,
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
          q: '"GB200 NVL72 leads DeepSeek-R1" and "B200 single node wins at high interactivity" are…',
          options: [
            'Contradictory — one is wrong',
            'Both true — different regions of the same Pareto frontier: fabric wins giant batches (throughput end), a node + MTP wins per-user rate (interactivity end)',
            'About different models',
            'Marketing, both',
          ],
          correct: [1],
          explanation:
            'The frontier\'s ends exclude each other; different configs are optimal in different regions. This is the single most common source of "contradictory" benchmark claims — check which end of the curve the number came from.',
        },
        {
          q: 'Which moves the FRONTIER (vs sliding along it)?',
          options: [
            'Raising batch size',
            'FP4 quantization, MTP speculative decoding, disaggregation, better hardware/kernels — things that change bytes, bandwidth, or overlap',
            'Longer prompts',
            'More concurrent users',
          ],
          correct: [1],
          explanation:
            'Batch and traffic move you along the curve (same efficiency, different tradeoff). The frontier shifts only when the physics change: fewer bytes, more bandwidth, or better overlap of compute and communication.',
        },
        {
          q: 'MTP speculative decoding shifts…',
          options: [
            'The whole frontier uniformly',
            'The interactivity end 2–3× (it spends idle decode FLOPs) while barely touching the throughput end (no idle FLOPs there)',
            'Nothing',
            'Only TTFT',
          ],
          correct: [1],
          explanation:
            'T6.L6\'s mechanism converts spare per-user compute into speed. Region-specific frontier shifts are why you must read claims regionally — "2–3×" is true at one end and nearly false at the other.',
        },
        {
          q: 'Your product\'s SLO determines…',
          options: [
            'Nothing',
            'Which region of the frontier is operable — the latency contract picks the operating point, which picks hardware class and achievable margin',
            'Only the frontend',
            'The tokenizer',
          ],
          correct: [1],
          explanation:
            'The SLO floor cuts the frontier: points right of it are sellable. A tight interactivity SLO forces small batches and per-user tech (MTP); a loose one unlocks giant-batch economics. The contract is the first engineering input.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Numbers to recite',
      md: `InferenceMAX v1 (Oct 2025), the frontier in figures: gpt-oss on B200 — **60k tok/s/GPU** and **1k tok/s/user** as the two ends; DeepSeek-R1 — GB200 NVL72 leads on TCO/token at low interactivity, B200 node wins high-interactivity configs, MTP worth 2–3× interactivity; Llama-3.3-70B — >10k tok/s/GPU at 50 tok/s/user on Blackwell, ~4× H200. Keep these as your sanity anchors for any vendor claim: if a number beats these regions decisively, ask which dial was turned and on which traffic.`,
    },
  ],
}

export default lesson
