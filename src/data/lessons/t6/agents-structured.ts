import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l8',
  slug: 'agents-structured',
  trackId: 't6',
  index: 8,
  title: 'Agents, Structured Output, and Cache Locality',
  minutes: 25,
  hook: 'The 2026 traffic shape: agent loops re-sending 90% of the same prefix every turn, JSON that must parse or the product breaks, and fifty LoRA adapters sharing one base model. Three workloads, and each one has a dedicated systems answer.',
  exercise: 'read+quiz',
  blocks: [
    {
      type: 'prose',
      md: `The chat workload that T5 optimized for — independent requests, short shared system prompts — is no longer the frontier traffic. Three shapes define 2026 products, and each rewards a different part of your stack:

**Agentic loops.** An agent turn appends tool output to the *entire prior conversation* and re-sends it. Turn N's prompt contains turn N−1's prompt almost verbatim: 85–95% shared prefix per request, growing contexts (50k–500k tokens), long sessions. The workload is *prefix-locality-bound*: throughput is set by how much of that prefix you never recompute.

**Structured output.** Function calling, JSON-mode, schemas that must validate or downstream code breaks. Constrained decoding (XGrammar, Outlines, GBNF grammars) restricts the sampler to grammar-legal tokens — the constraint engine compiled to an automaton that runs per-step beside the model. Cost used to be brutal CPU–GPU sync per token; the 2025–26 backends (XGrammar-class, compiled masks, GPU-side application) made it a few percent overhead. The product lesson: structure is now cheap enough to be the default, which is why agents emit parseable tool calls at all.`,
    },
    {
      type: 'prose',
      md: `## Cache locality is the agentic throughput multiplier

RadixAttention (T5.L9's SGLang lesson) was built for exactly this traffic: the KV cache as a radix tree over token prefixes, so turn N inherits turn N−1's cached prefix automatically, with LRU eviction on the tree. On agent loops the **cache-hit rate IS the throughput multiplier** — a 90% hit rate is ~10× less prefill work per turn. Design consequences:

- **Deterministic prompt construction is a feature.** If your framework inserts timestamps into the system prompt, the radix tree misses on turn 2 and the whole economy collapses. Agent frameworks now treat "prefix-stable prompts" as a hard requirement.
- **Cache-aware routing pays double.** Route the session to the worker holding its tree (T5.L8's KV-aware routing, T6.L3's llm-d/Dynamo implementations) — locality at engine level AND cluster level.
- **Long agent sessions = the capacity math of T5.L4 with a growing shared prefix.** One session's tree is compact; ten thousand concurrent agents' trees are a real HBM budget. Tree eviction policy is a product decision (evict = recompute cost next turn).

## Multi-LoRA: fifty adapters, one base model

Fine-tuned variants of one base model (per-tenant adapters) serve from one weight copy: vLLM/SGLang batch requests for **different LoRA adapters in the same batch**, applying low-rank deltas per request. The systems content: adapter weights are small (MBs), hot-swappable from CPU memory, and batched by grouping same-adapter requests to keep the delta application dense. The economy: fine-tuning per customer became an *inference-tier* feature instead of a fleet-per-customer cost — the reason every API offers custom-tuned models now.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '85–95%', label: 'shared prefix per agent turn', hint: 'Turn N re-sends nearly all of turn N−1. Cache-hit rate is the throughput multiplier.' },
        { value: '~10×', label: 'less prefill work at 90% hit', hint: 'Radix-tree reuse on agentic loops, SGLang\'s design center.' },
        { value: 'few %', label: 'structured-output overhead (2026)', hint: 'Compiled grammar automata + GPU-side masks; was brutal CPU–GPU sync before.' },
        { value: '1 base × N', label: 'multi-LoRA serving', hint: 'Many adapters batched on one weight copy; per-tenant fine-tunes at inference-tier cost.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Agent traffic is your **ORO (object-relational) N+1 problem discovered a decade late**: naive systems recompute the whole prefix every turn the way naive ORM re-fetches the whole object graph every request, and the fix is the same discipline — identify what's invariant, cache it structurally, route for locality, and make "don't invalidate your own cache" (stable prefixes) a code review item. Multi-LoRA is your **classloader trick**: one shared runtime, per-tenant deltas loaded hot.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Agent-loop throughput is governed primarily by…',
          options: [
            'Decode speed',
            'Prefix cache-hit rate: each turn re-sends 85–95% of the prior context, so reuse of the cached prefix (radix tree) multiplies throughput ~10×',
            'The tokenizer',
            'GPU count',
          ],
          correct: [1],
          explanation:
            'The workload is prefix-locality-bound. A 90% hit rate means ~10× less prefill compute per turn — the cache-hit rate IS the throughput multiplier, which is why RadixAttention exists and why prefix-stable prompts are a hard requirement.',
        },
        {
          q: 'A timestamp in the system prompt of an agent loop…',
          options: [
            'Is harmless',
            'Invalidates the shared prefix from turn 2 on — the radix tree misses and the cache economy collapses. Prefix stability is a hard requirement',
            'Improves freshness',
            'Helps the router',
          ],
          correct: [1],
          explanation:
            'Any byte-level change early in the prompt diverges the prefix tree at that point. Deterministic prompt construction is now a feature teams code-review for.',
        },
        {
          q: 'Structured output got cheap in 2025–26 because…',
          options: [
            'Models got smarter',
            'Constraint engines moved to compiled automata + GPU-side mask application — a few percent overhead instead of per-token CPU–GPU sync',
            'JSON got simpler',
            'Schemas got optional',
          ],
          correct: [1],
          explanation:
            'XGrammar-class backends compile the grammar to an automaton and apply token masks on-GPU per step. Structure at a few percent overhead is why parseable tool calls are the default agent interface now.',
        },
        {
          q: 'Multi-LoRA serving makes per-tenant fine-tunes cheap by…',
          options: [
            'Quantizing them',
            'Batching different adapters\' requests on one base-model copy — low-rank deltas applied per request, adapters hot-swapped from CPU memory',
            'Giving each tenant a GPU',
            'Merging weights nightly',
          ],
          correct: [1],
          explanation:
            'Adapters are MB-scale deltas; one base copy serves many tenants in one batch. Fine-tuning per customer moved from a fleet-cost to an inference-tier feature.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'The capstone of T6',
      md: `You can now read the full 2026 traffic picture: agentic loops (prefix locality, T6.L8) on giant contexts (CP, T6.L4) over MoE models (wide EP, T6.L1–L2) quantized to FP4 (T6.L5) with MTP drafts (T6.L6), generated in RL loops (T6.L7), split across EPD fleets (T6.L3) — measured in goodput, priced in $/Mtok. That last sentence is T7. The vocabulary changed; the physics didn't: bytes, bandwidth, placement, and the 50-year-old scheduler underneath.`,
    },
  ],
}

export default lesson
