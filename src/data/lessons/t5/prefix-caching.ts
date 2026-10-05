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
      md: `HBM is fast and scarce; host DRAM is larger; local or remote storage is larger again. **HiCache-style tiering** treats prefix KV like a database buffer hierarchy: L1 GPU for the hottest branches, L2 host memory for warm prefixes, L3 storage for durable or fleet-wide reuse. A lower-tier hit still avoids model prefill, but it pays transfer latency — so promotion, admission, and eviction use recompute cost as well as recency. Long prefixes are expensive to recompute and deserve different treatment from tiny ones. T6.L3's transfer layer (NIXL, Mooncake's transfer engine) is what makes this hierarchy a fleet primitive rather than an engine trick. Dynamo's KVBM tier manager was deprecated in v1.5.0 in favor of engine-native offload: tiering belongs to the cache owner, transport stays a separate layer.`,
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
            'The tail prefill and every decode step, because a hit lets the engine replay the response it produced last time',
            'Prefill for the 2,048 cached tokens; the tail is still prefilled and decoding proceeds as usual',
            'Tokenization and embedding lookup for the whole prompt, since the cache stores token ids rather than K/V tensors',
            'Nothing, because K/V can be reused only when the entire prompt, tail included, matches a cached entry exactly',
          ],
          correct: [1],
          explanation: 'Prefix caching resumes at the first miss. It removes deterministic prefill already represented by K/V blocks; it does not remove new-tail prefill or autoregressive decode.',
          why: [
            'Treats the cache as a response cache. APC stores K/V for prompt tokens only; the tail still needs prefill and every output token still needs its own decode step.',
            'Right: reuse starts at the first miss. Cached K/V replaces prefill for the shared prefix, while new-tail prefill and autoregressive decode still run.',
            'Confuses what is cached. The cache holds K/V tensors, not token ids, and the engine still tokenizes to compute block hashes. The saving is prefill FLOPs.',
            'Assumes all-or-nothing matching. Block-hash lookup walks the prompt until the first miss, so a shared prefix is reused even when the tail differs.',
          ],
        },
        {
          q: 'Why does radix-cache eviction choose leaves?',
          options: [
            'Leaves hold the longest token runs, so freeing one returns the most blocks to the pool for each eviction step',
            'An internal node is a shared ancestor, so removing it strands every descendant; a leaf can be released and empty ancestors pruned',
            'Internal nodes carry no KV blocks of their own, only child pointers, so there is nothing to evict until a leaf goes',
            'Only leaves carry an LRU timestamp, because interior nodes are never touched again once an edge has been split',
          ],
          correct: [1],
          explanation: 'Tree topology is an ownership constraint. Evict an eligible leaf, drop its references, then prune ancestors only once nothing depends on them.',
          why: [
            'Size is not the criterion. A leaf can be small; the rule exists because of dependency, not capacity, and eviction still takes the least-recently-used eligible leaf.',
            'Right: tree topology is an ownership constraint. Evict a cold leaf, release its block references, and prune ancestors only when nothing below them remains.',
            'Each node owns the KV blocks for its edge\'s tokens, so interior nodes hold real memory. Descendants depend on that memory, so it cannot be freed first.',
            'Interior nodes are touched whenever a lookup walks through them, so they do have recency metadata. The leaf-only rule comes from dependency, not missing timestamps.',
          ],
        },
        {
          q: 'Why is pure longest-prefix routing insufficient?',
          options: [
            'A cache hit only skips the attention work, so the MLP still recomputes every cached token and the saving is too small to route for',
            'It herds traffic onto one warm worker until queueing outweighs the saved prefill; a load guard bounds that skew',
            'Cached K/V is bound to the request that created it, so no router can reuse it for a later request',
            'A longer match means more K/V to move to the chosen worker, so the router should prefer short matches over long ones',
          ],
          correct: [1],
          explanation: 'The objective is TTFT under load, not hit rate alone. Prefix affinity scores locality subject to a bounded imbalance, then falls back to least-loaded placement.',
          why: [
            'A hit reuses K/V for every layer, so the engine skips all forward work for the cached tokens, MLP included. The lesson\'s 2,048-of-2,176-token example is 94% reusable input.',
            'Right: the goal is TTFT under load, not hit rate alone. Affinity scores locality within a bounded load imbalance, then falls back to the least-loaded worker.',
            'Cached K/V is immutable and refcounted, so any later request with the same prefix can map it read-only. Cross-request reuse is exactly what APC provides.',
            'Affinity routing sends the request to the worker that already holds the prefix, so no K/V moves. Preferring longer matches is the point; the risk is overload.',
          ],
        },
        {
          q: 'Which value must be part of a safe prefix-cache identity?',
          options: [
            'The normalized prompt text after whitespace and Unicode cleanup, since identical text always tokenizes identically',
            'Exact token ids plus every setting that changes K/V (model, adapter, multimodal), with a trust-domain salt for isolation',
            'The token ids plus the sampling parameters, since temperature and top-p change which tokens the cached K/V should hold',
            'The token ids plus the client session id, so that one user\'s cached prefix can never be reused by any other user\'s requests',
          ],
          correct: [1],
          explanation: 'The key must name deterministic K/V, not merely similar text. Model/adapter/multimodal configuration and isolation namespace matter alongside exact token ids.',
          why: [
            'Equal text does not guarantee equal token ids across tokenizer versions or special-token handling, and text ignores model and adapter. K/V is a function of token ids and weights.',
            'Right: the key must name deterministic K/V. Token ids, model, adapter and multimodal inputs fix the tensors; a salt partitions tenants against timing side channels.',
            'Sampling happens after the forward pass over the prompt. Prefill K/V is identical for any temperature or top-p, so including them would only fragment the cache.',
            'A per-session key never lets two users share a system prompt, which removes most of the cache\'s value. Isolation needs a trust-domain salt, not one entry per session.',
          ],
        },
      ],
    },
  ],
}

export default lesson
