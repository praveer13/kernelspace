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
            'Decode speed per token, with each turn dominated by generating the reply rather than handling the prior context',
            'Prefix cache-hit rate, with each turn re-sending most of the prior context and a high hit rate cutting prefill',
            'Tokenizer speed, with each turn re-tokenizing the whole history before the accelerator can start',
            'Replica count, with extra devices scaling agent throughput linearly however cache-aware the routing is',
          ],
          correct: [1],
          explanation:
            'The workload is prefix-locality-bound. A 90% hit rate means ~10× less prefill compute per turn — the cache-hit rate IS the throughput multiplier, which is why RadixAttention exists and why prefix-stable prompts are a hard requirement.',
          why: [
            'Decode matters for each reply, but 85–95% of every prompt is re-sent history. How much of it hits the cache sets the prefill work, which is what limits throughput.',
            'Right: turn N re-sends nearly all of turn N−1, so reusing the cached prefix removes most prefill. At a 90% hit rate only a tenth is recomputed, about 10× less.',
            'Tokenizing text on the CPU is cheap beside prefilling the same tokens on the GPU. Hit rate decides how many of those tokens ever reach prefill.',
            'Scaling is not linear when routing ignores locality: spreading one session across replicas leaves each with a cold cache. Cache-aware routing is what makes added GPUs pay off.',
          ],
        },
        {
          q: 'A timestamp in the system prompt of an agent loop…',
          options: [
            'Is harmless, with the model reading it as ordinary text and the cached state for the rest of the prompt staying valid',
            'Changes bytes near the start of the prompt, with the shared prefix diverging and the radix tree missing from turn two',
            'Costs just the tokens of the timestamp itself, with the radix tree re-matching the unchanged text that follows it later',
            'Matters on the first turn alone, with later turns keyed on the previous reply instead of the system prompt',
          ],
          correct: [1],
          explanation:
            'Any byte-level change early in the prompt diverges the prefix tree at that point. Deterministic prompt construction is now a feature teams code-review for.',
          why: [
            'KV entries depend on every earlier token, so changing an early token invalidates the cache for everything after it. Valid KV for the remainder is not reusable.',
            'Right: the tree matches token prefixes from the start. A changed timestamp early in the prompt diverges there, so nothing after it hits the cache and the economics collapse.',
            'Later tokens\' KV was computed attending to the old timestamp, so it cannot be reused for new text. The prefix tree matches only an unbroken run from the first token.',
            'Prefix caching keys on the token sequence from the beginning, system prompt included. Every turn re-sends the system prompt, so a changing timestamp breaks every turn.',
          ],
        },
        {
          q: 'Structured output got cheap in 2025–26 because…',
          options: [
            'Models became reliable enough that constraints are rarely needed, with retrying malformed output costing almost nothing',
            'Engines compile the grammar once and apply token masks cheaply, overlapping mask work with accelerator execution',
            'The engine validates the finished output and resamples invalid tokens, with no check running during decoding',
            'Production schemas shrank to flat objects, with the mask a fixed table precomputed per parser state and applied unchanged',
          ],
          correct: [1],
          explanation:
            'XGrammar-class backends compile the grammar once, keep a small parser stack per sequence, and overlap mask construction with GPU execution. That low overhead is why parseable tool calls are the default agent interface now.',
          why: [
            'Reliability is not a guarantee, and retries cost a full extra generation each. Constraint engines enforce structure during decoding, so malformed output is not produced at all.',
            'Right: compiling the grammar once and carrying only a small per-sequence parser stack, with mask work overlapped with GPU execution, makes enforcement cheap enough to leave on.',
            'Validating afterwards is the retry approach, not constrained decoding. Resampling after the fact cannot keep the sequence valid as it grows, and the constraint must act at each step.',
            'Real schemas are nested and recursive, so legality depends on the parser stack and cannot be a static table. Engines precompute only the context-independent part and check the rest at runtime.',
          ],
        },
        {
          q: 'Why is checking only the first character of each vocabulary token incorrect?',
          options: [
            'It is too slow, with a character-level check needing a separate processor round trip for each token in the vocabulary',
            'A token can span several grammar states or start legally and end illegally, requiring the byte string to be simulated',
            'Text is carried in a wide encoding, with a token\'s first character failing to identify the byte the parser reads first',
            'Token ids carry no text, with a mask buildable just after sampling once the chosen token is decoded to a string',
          ],
          correct: [1],
          explanation:
            'The sampler chooses model tokens. Grammar terminals are bytes/characters. Correct masking bridges those two alphabets by consuming every byte of each candidate token.',
          why: [
            'Cost is not the defect; correctness is. A first-character check can admit tokens with impossible suffixes and reject legal tokens that cross state boundaries, however fast it runs.',
            'Right: tokens are byte strings, so one token may span several grammar transitions or start validly and end invalidly. The engine must consume every byte from the current parser state.',
            'JSON text is UTF-8 by default (RFC 8259). The flaw is multi-byte tokens crossing grammar states, which would break the check under any encoding.',
            'Each id maps to a known byte string in the vocabulary, so legality can be computed before sampling. That is the whole point of a mask: it restricts the choices in advance.',
          ],
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
