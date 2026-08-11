import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l8',
  slug: 'agents-structured',
  trackId: 't6',
  index: 8,
  title: 'Agents, Structured Output, and Cache Locality',
  minutes: 25,
  hook: 'Agent loops re-send most of the same growing prefix every turn, while tool calls must parse on the first attempt. Prefix locality and tokenizer-aware grammar masks are now serving primitives.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `The chat workload that T5 optimized for — independent requests, short shared system prompts — is no longer the frontier traffic. Three shapes define 2026 products, and each rewards a different part of your stack:

**Agentic loops.** An agent turn appends tool output to the *entire prior conversation* and re-sends it. Turn N's prompt contains turn N−1's prompt almost verbatim: 85–95% shared prefix per request, growing contexts (50k–500k tokens), long sessions. The workload is *prefix-locality-bound*: throughput is set by how much of that prefix you never recompute.

**Structured output.** Function calling, JSON-mode, schemas that must validate or downstream code breaks. Constrained decoding restricts the sampler to grammar-legal **model tokens** — not characters — through a compiled parser state and a vocabulary mask. XGrammar prechecks context-independent tokens, keeps a persistent pushdown stack for the remainder, and overlaps mask work with GPU execution. XGrammar 2 adds dynamic tag dispatch, JIT compilation, and cross-grammar reuse for agent tool protocols. The product lesson: enforce structure during decoding rather than retrying malformed output afterward.`,
    },
    {
      type: 'prose',
      md: `## Cache locality is the agentic throughput multiplier

RadixAttention (T5.L10's SGLang lesson) was built for exactly this traffic: the KV cache as a radix tree over token prefixes, so turn N inherits turn N−1's cached prefix automatically, with LRU eviction on the tree. On agent loops the **cache-hit rate IS the throughput multiplier** — a 90% hit rate is ~10× less prefill work per turn. Design consequences:

- **Deterministic prompt construction is a feature.** If your framework inserts timestamps into the system prompt, the radix tree misses on turn 2 and the whole economy collapses. Agent frameworks now treat "prefix-stable prompts" as a hard requirement.
- **Cache-aware routing pays double.** Route the session to the worker holding its tree (T5.L9's KV-aware routing, T6.L3's llm-d/Dynamo implementations) — locality at engine level AND cluster level.
- **Long agent sessions = the capacity math of T5.L4 with a growing shared prefix.** One session's tree is compact; ten thousand concurrent agents' trees are a real HBM budget. Tree eviction policy is a product decision (evict = recompute cost next turn).

## The token mask is not a string mask

A BPE token can contain \`"tool","arguments":{\` — several grammar terminals and transitions in one model step. A mask that checks only the first character admits tokens whose suffix is impossible and rejects legal tokens that cross state boundaries. The constraint engine must speculatively consume the **whole token byte string** from the current parser stack. That is Forge lab 08: schema → pushdown state → whole-token mask → cached compilation.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '85–95%', label: 'shared prefix per agent turn', hint: 'Turn N re-sends nearly all of turn N−1. Cache-hit rate is the throughput multiplier.' },
        { value: '~10×', label: 'less prefill work at 90% hit', hint: 'Radix-tree reuse on agentic loops, SGLang\'s design center.' },
        { value: '1 token', label: 'may cross many grammar states', hint: 'BPE vocabulary entries are byte strings, never single parser characters.' },
        { value: '6×+', label: 'XGrammar 2 compile speedup', hint: 'Reported against prior structured-generation engines for dynamic agentic tasks.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Agent traffic is your **ORM N+1 problem discovered a decade late**: naive systems recompute the whole prefix every turn the way naive code re-fetches the whole object graph every request. Identify what is invariant, cache it structurally, route for locality, and make “do not invalidate your own cache” a code-review item. Grammar compilation is the same split again: compile invariant schema structure once; carry only a tiny dynamic parser stack per sequence.`,
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
          q: 'Why is checking only the first character of each vocabulary token incorrect?',
          options: [
            'Characters are too slow',
            'A single BPE token can cross several grammar states or begin legally and end illegally; the whole token byte string must be simulated',
            'JSON uses UTF-16',
            'Token ids are always random',
          ],
          correct: [1],
          explanation:
            'The sampler chooses model tokens. Grammar terminals are bytes/characters. Correct masking bridges those two alphabets by consuming every byte of each candidate token.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Make the parser executable',
      md: `Forge lab 08, **xgrammar-lite**, turns this lesson into a machine: compile a canonical JSON Schema subset, reject invalid output at the first impossible byte, and construct a mask over lab-03-style BPE tokens. Then continue to T6.L9: the next agent-era workload is not a new grammar but many tenant-specific LoRA adapters sharing one base-model batch.`,
    },
  ],
}

export default lesson
