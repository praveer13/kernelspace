import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l6',
  slug: 'prefix-caching',
  trackId: 't5',
  index: 6,
  title: 'Prefix Caching: The Free Lunch',
  minutes: 30,
  hook: 'Stop recomputing the system prompt: APC, radix trees, tiered KV, and the router that turns cache locality into TTFT.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `PagedAttention gave every sequence a block table. Prefix caching asks the obvious production question: **if two requests begin with the same token ids, why prefill those tokens twice?** The K/V tensors are deterministic for a fixed model, adapter, and token prefix. Keep the finished prefix's blocks after one prefill, map them read-only into the next request, and begin compute at the first uncached token.

That removes work rather than making it faster. A 2,048-token system prompt followed by a 128-token user message is 94% reusable input. On a hit, the engine prefills 128 tokens, not 2,176. The saved FLOPs become lower TTFT, more admission headroom, or both. This is the rare serving optimization whose best case improves latency, throughput, and cost at once — the **free lunch** in the title. It is not literally free: cache capacity, lookup, invalidation, routing, and isolation are the bill.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '94%', label: 'prefill skipped', hint: '2,048 shared system tokens out of a 2,176-token prompt.' },
        { value: '0', label: 'quality change', hint: 'The target model computes exactly the same continuation from identical cached K/V.' },
        { value: 'tokens', label: 'cache key', hint: 'Text equality is insufficient; the exact token-id sequence and model configuration are the contract.' },
      ],
    },
    {
      type: 'prose',
      md: `## Automatic Prefix Caching: the block-hash design

vLLM-style **Automatic Prefix Caching (APC)** hashes full token blocks. Each key includes the parent hash and the next block's token ids, plus every value that can change K/V: model, adapter, multimodal inputs, and cache salt where isolation requires it. A request walks its prompt block by block until the first miss. Hits reuse physical KV blocks by refcount; misses prefill normally, then become cache entries when their blocks are complete.

The block boundary matters. With 16-token blocks, 130 identical leading tokens produce eight reusable blocks (128 tokens); the two-token tail cannot be shared safely yet. The payoff is nevertheless exact: **cached tokens do zero model work**. APC helps shared system prompts, repeated document prefixes, retries, parallel samples, and multi-turn chat. It does not help unrelated prompts, and it does not accelerate decode — only the prefill work that already exists in the cache.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — longest-prefix lookup in a radix cache',
      height: 58,
      nodes: [
        { id: 'root', x: 3, y: 23, w: 15, h: 9, label: 'root', sub: 'no KV' },
        { id: 'sys', x: 27, y: 23, w: 20, h: 9, label: '[system…]', sub: '384 tok · blocks 7–30', color: '#22D3EE' },
        { id: 'tools', x: 57, y: 7, w: 19, h: 9, label: '[tools…]', sub: '+160 tok · blocks 42–51', color: '#3EF2A4' },
        { id: 'docs', x: 57, y: 23, w: 19, h: 9, label: '[RAG doc…]', sub: '+256 tok · blocks 61–76', color: '#A78BFA' },
        { id: 'chat', x: 57, y: 39, w: 19, h: 9, label: '[turn 1…]', sub: '+96 tok · blocks 81–86', color: '#FB7185' },
        { id: 'query', x: 82, y: 22, w: 15, h: 11, label: 'new query', sub: 'system + doc + new tail' },
      ],
      edges: [
        { from: 'root', to: 'sys' },
        { from: 'sys', to: 'tools' },
        { from: 'sys', to: 'docs' },
        { from: 'sys', to: 'chat' },
        { from: 'docs', to: 'query' },
      ],
      steps: [
        { caption: 'The root has one shared system-prompt edge. Its KV blocks are immutable and refcounted, so every descendant can reuse them.', active: ['root', 'sys'], edges: ['root->sys'] },
        { caption: 'Requests diverge after the system prompt. A radix tree stores the common path once, then branches at the first differing token.', active: ['sys', 'tools', 'docs', 'chat'], edges: ['sys->tools', 'sys->docs', 'sys->chat'] },
        { caption: 'The new query follows system → RAG document, then misses at its new user tail. match_prefix returns 640 tokens and those block ids — the LONGEST ancestor, not merely any hit.', active: ['sys', 'docs', 'query'], edges: ['root->sys', 'sys->docs', 'docs->query'] },
        { caption: 'After prefill computes the new tail, insertion adds a leaf. If the pool is full, evict the least-recently-used eligible LEAF; shared ancestors stay because descendants still depend on them.', active: ['tools', 'chat'] },
      ],
    },
    {
      type: 'prose',
      md: `## RadixAttention: cache structure becomes scheduling structure

SGLang's **RadixAttention** stores token sequences in a radix tree (a compressed trie). Each edge is a run of token ids; each node owns the corresponding KV blocks. Lookup follows tokens and returns the longest cached ancestor. Insertion splits an edge when two sequences share only part of it. A shared path is immutable: a writer that diverges receives new tail blocks, exactly the copy-on-write rule from T5.L5.

Eviction operates from the leaves. Removing an internal node would invalidate every descendant, so LRU chooses the coldest eligible leaf, releases its block references, then prunes newly empty ancestors. That one constraint connects tries, refcounts, and memory pressure. The [radix-cache Forge lab](/forge/radix-cache) makes the full loop executable: longest-prefix match, insertion, CoW divergence, leaf LRU, and block conservation under churn.`,
    },
    {
      type: 'code',
      filename: 'prefix_router.rs — locality with a load guard',
      lang: 'rust',
      code: `fn choose_worker(req: &[u32], workers: &[Worker]) -> usize {
    let min_load = workers.iter().map(Worker::load).min().unwrap_or(0);
    let guard = min_load + 4; // do not herd onto one hot cache owner

    workers.iter()
        .enumerate()
        .filter(|(_, w)| w.load() <= guard)
        .max_by_key(|(_, w)| (w.cached_prefix_len(req), Reverse(w.load())))
        .map(|(i, _)| i)
        .unwrap_or_else(|| workers.iter().enumerate()
            .min_by_key(|(_, w)| w.load()).unwrap().0)
}`,
      chips: ['longest prefix first', 'bounded imbalance', 'JSQ fallback'],
    },
    {
      type: 'prose',
      md: `## The cluster is part of the cache

An engine-local hit is useless if the router sends the request to another worker. Round-robin scatters related chats; join-shortest-queue protects load but ignores expensive warm state. A **prefix-affinity router** scores each worker by its longest cached prefix, then applies a load guard so one popular system prompt cannot herd the whole fleet onto one GPU. When every cache-owning worker is beyond the guard, it falls back to the least-loaded worker and pays the miss deliberately.

That creates the metric pair a production scoreboard needs: **KV hit rate** (cached prompt tokens ÷ prompt tokens) and **TTFT SLO attainment**. Hit rate without latency can hide an overloaded hot worker; latency without hit rate cannot explain why identical prompts have different cost. Open the Fleet's cluster mode and run the same shared-prefix trace under round-robin, JSQ, and prefix affinity. The traffic is held constant; only the information available to the router changes.`,
    },
    {
      type: 'isomorphism',
      title: 'prefix caching ≡ a storage hierarchy',
      pairs: [
        {
          os: 'page cache key',
          osLine: 'File identity + offset names deterministic bytes.',
          llm: 'token-prefix key',
          llmLine: 'Model configuration + exact token ids name deterministic K/V.',
        },
        {
          os: 'copy-on-write page',
          osLine: 'Readers share; the first writer receives a private page.',
          llm: 'shared prefix block',
          llmLine: 'Requests share immutable KV; divergent tails allocate privately.',
        },
        {
          os: 'NUMA-aware placement',
          osLine: 'Run work near the memory it will read, unless that node is saturated.',
          llm: 'prefix-affinity routing',
          llmLine: 'Route near cached KV, bounded by a worker-load guard.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'HiCache: one cache becomes three tiers',
      md: `HBM is fast and scarce; host DRAM is larger; local or remote storage is larger again. **HiCache-style tiering** treats prefix KV like a database buffer hierarchy: L1 GPU for the hottest branches, L2 host memory for warm prefixes, L3 storage for durable or fleet-wide reuse. A lower-tier hit still avoids model prefill, but it pays transfer latency — so promotion, admission, and eviction use recompute cost as well as recency. Long prefixes are expensive to recompute and deserve different treatment from tiny ones. T6.L3's NIXL/KVBM transfer fabric is what makes this hierarchy a fleet primitive rather than an engine trick.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Cache keys are an isolation boundary',
      md: `A cache hit changes latency. If mutually untrusted tenants share a namespace, an attacker may probe timing to infer whether another tenant recently used a prefix. Salt or partition cache keys by trust domain, avoid caching sensitive prefixes, and make eviction/accounting tenant-aware. Wave 6 returns to this as a full side-channel lesson; for now remember: a performance cache is also shared state, and shared state is observable.`,
    },
    {
      type: 'field-note',
      title: 'SGLang: Efficient Execution of Structured Language Model Programs',
      source: 'Zheng et al.',
      href: 'https://arxiv.org/abs/2312.07104',
      published: 'arXiv 2023',
      verified: '2026-08',
      md: `Read SGLang for the moment a cache becomes a runtime. RadixAttention stores KV along the prefix tree of a multi-call program, so forks, joins, few-shot examples, agent turns, and structured generation share state automatically. Compare its radix-tree policy with lab 07: the paper adds a programming model and scheduler around the same longest-prefix, reference-lifetime, and eviction invariants you implement.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'A request has 2,048 cached system-prompt tokens and a 128-token uncached user tail. What work does APC remove?',
          options: [
            'The 128-token tail and all decode work',
            'Prefill for the 2,048 cached tokens; the engine still prefills the 128-token tail and decodes normally',
            'Only tokenizer work',
            'Nothing until the entire prompt is an exact match',
          ],
          correct: [1],
          explanation: 'Prefix caching resumes at the first miss. It removes deterministic prefill already represented by K/V blocks; it does not remove new-tail prefill or autoregressive decode.',
        },
        {
          q: 'Why does radix-cache eviction choose leaves?',
          options: [
            'Leaves are always the largest entries',
            'An internal node is a shared ancestor; removing it invalidates every descendant, while a leaf can be released and empty ancestors pruned safely',
            'GPU memory can only address leaves',
            'LRU cannot timestamp internal nodes',
          ],
          correct: [1],
          explanation: 'Tree topology is an ownership constraint. Evict an eligible leaf, drop its references, then prune ancestors only once nothing depends on them.',
        },
        {
          q: 'Why is pure longest-prefix routing insufficient?',
          options: [
            'Prefix matching is nondeterministic',
            'It can herd traffic onto one warm worker until queueing erases the cache win; a load guard balances locality against backlog',
            'Round-robin always has a higher hit rate',
            'Cached KV cannot cross requests',
          ],
          correct: [1],
          explanation: 'The objective is TTFT under load, not hit rate alone. Prefix affinity scores locality subject to a bounded imbalance, then falls back to least-loaded placement.',
        },
        {
          q: 'Which value must be part of a safe prefix-cache identity?',
          options: [
            'Only the UTF-8 prompt string',
            'The exact token ids plus every configuration that changes K/V, with a tenant/trust-domain salt where isolation requires it',
            'Only the request id',
            'The expected output length',
          ],
          correct: [1],
          explanation: 'The key must name deterministic K/V, not merely similar text. Model/adapter/multimodal configuration and isolation namespace matter alongside exact token ids.',
        },
      ],
    },
  ],
}

export default lesson
