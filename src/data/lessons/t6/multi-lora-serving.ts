import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l9',
  slug: 'multi-lora-serving',
  trackId: 't6',
  index: 9,
  title: 'Multi-LoRA Serving: One Base, Many Tenants',
  minutes: 30,
  hook: 'A thousand fine-tunes do not need a thousand base-model copies. Page adapter weights beside KV, preserve one heterogeneous base batch, and make the low-rank delta follow each request.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `A LoRA adapter changes a frozen linear layer without replacing it: **W′x = Wx + B(Ax)**, where rank r is tiny beside the model width. The expensive term, **Wx**, is identical across tenants. The small low-rank term belongs to one adapter. That decomposition is the serving opportunity: run one large base-model matmul for the whole batch, then apply the correct adapter delta to each request.

The naive alternatives destroy one of those wins. Merging an adapter into W creates a full weight copy and makes switching expensive. Running one batch per adapter fragments traffic into tiny, bandwidth-bound launches. Swapping one adapter at a time preserves memory but serializes tenants behind PCIe. Multi-LoRA serving keeps the base shared, the batch heterogeneous, and adapter residency dynamic.`,
    },
    {
      type: 'prose',
      md: `## S-LoRA: page weights and KV in one allocator

[S-LoRA](https://arxiv.org/abs/2311.03285) keeps the adapter catalog in CPU memory and brings only the adapters required by the active batch into GPU memory. Its **Unified Paging** insight is familiar because you already built it twice: variable-rank adapter tensors and variable-length KV tensors are both dynamic objects competing for the same scarce HBM. Divide the backing store into pages, give each object a page table, reclaim pages independently, and overlap the next adapter transfer with current compute.

The scheduler now has two residency questions per request:

- Are its KV blocks resident, and how quickly will they grow?
- Are its adapter pages resident, and can prefetch hide the transfer?

Pure adapter affinity can convoy cold requests behind a hot tenant; pure FCFS can churn adapter pages. The useful policy scores residency, queue age, and memory headroom together — the same locality-vs-load balance as prefix-aware routing. Lab 02's optional advanced check makes this one physical pool executable.`,
    },
    {
      type: 'prose',
      md: `## Punica: keep one base batch heterogeneous

[Punica](https://arxiv.org/abs/2310.18547) supplies the kernel half. Its **SGMV** operation groups the batch into contiguous segments by adapter and applies different low-rank matrices without launching one ordinary GEMV per request. The base model still sees one dense batch; the delta kernel sees a segment map: requests 0–7 use adapter A, 8–10 use B, 11 uses C.

This is not “group all same-adapter requests and wait until each group is large.” That would recover kernel density by paying queueing latency. SGMV accepts a heterogeneous live batch and makes the small adapter work efficient inside it. The paper measured up to 12× throughput over its contemporary multi-tenant baselines with about 2 ms/token added latency; treat those as paper-specific results, not a universal production constant.

Current [vLLM LoRA serving](https://docs.vllm.ai/en/stable/features/lora/) exposes the same operational controls: adapters are selected per request, requests for several adapters can run in parallel, and \`max_loras\` bounds how many adapters may be active in one batch. \`max_cpu_loras\` controls the host-side resident catalog; \`max_lora_rank\` must match reality because over-provisioning wastes memory.`,
    },
    {
      type: 'statline',
      stats: [
        {
          value: 'W + BA',
          label: 'shared base + per-request delta',
          hint: 'The full Wx matmul batches across every tenant; only the low-rank path differs.',
        },
        {
          value: '1 pool',
          label: 'adapter pages + KV pages',
          hint: 'S-LoRA Unified Paging manages both variable-sized object classes in scarce HBM.',
        },
        {
          value: '12×',
          label: 'Punica paper peak vs its baselines',
          hint: 'A paper-specific result with roughly 2 ms/token overhead, not a universal deployment promise.',
        },
        {
          value: 'max_loras',
          label: 'active adapters per vLLM batch',
          hint: 'A memory and graph-shape capacity control, separate from the larger CPU adapter catalog.',
        },
      ],
    },
    {
      type: 'isomorphism',
      title: 'The same allocator and dispatch problems, one layer higher',
      pairs: [
        {
          os: 'shared text segment + per-process pages',
          osLine: 'one immutable executable mapping, private data attached per process',
          llm: 'base weights + per-request LoRA',
          llmLine: 'one dense base matmul, a small tenant-specific low-rank delta',
        },
        {
          os: 'virtual-memory paging',
          osLine: 'variable objects map logical pages onto one physical pool',
          llm: 'S-LoRA Unified Paging',
          llmLine: 'adapter tensors and KV block tables compete in one HBM allocator',
        },
        {
          os: 'scatter/gather I/O',
          osLine: 'one operation carries segments with different backing buffers',
          llm: 'Punica SGMV',
          llmLine: 'one heterogeneous delta launch carries segments for different adapters',
        },
      ],
    },
    {
      type: 'code',
      filename: 'unified_pager.rs · optional lab 02 shape',
      lang: 'rust',
      code: `enum ResidentObject {
    KvSequence { seq: u32, token_len: usize },
    LoraAdapter { adapter: u32, rank: usize },
}

// One physical free list; separate logical tables and lifetimes.
fn admit(request: &Request, pool: &mut PagePool) -> Result<Lease, Pressure> {
    let adapter = pool.pin_adapter(request.adapter_id, request.adapter_pages)?;
    let kv = pool.reserve_kv(request.seq_id, request.prompt_tokens)?;
    Ok(Lease { adapter, kv })
}`,
      chips: ['one HBM pool', 'two object classes', 'all-or-nothing'],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Dynamic adapter loading is a code-loading boundary',
      md: `An adapter is not merely a cache entry: it changes model behavior and may come from another tenant. Authenticate its source, pin a content hash, enforce base-model and rank compatibility, namespace cache keys by adapter, and never expose an unauthenticated “load this path” endpoint. vLLM's documentation explicitly warns that runtime LoRA updating should be enabled only in an isolated, fully trusted environment.`,
    },
    {
      type: 'field-note',
      title: 'S-LoRA: Serving Thousands of Concurrent LoRA Adapters',
      source: 'Sheng et al.',
      href: 'https://arxiv.org/abs/2311.03285',
      published: 'MLSys 2024',
      verified: '2026-08',
      md: `Read §§4–6 after completing the optional lab-02 pager. The paper separates three bottlenecks cleanly: Unified Paging controls fragmented adapter/KV residency, heterogeneous batching preserves one base-model batch, and tensor-parallel placement avoids replicating the wrong half of the low-rank work. Write down which mechanism owns memory, compute, and communication; that decomposition is more reusable than any single reported speedup.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Why can requests using different LoRA adapters still share one base-model batch?',
          options: [
            'Adapters are ignored during batching',
            'The expensive Wx term is identical; each request receives only its small B(Ax) delta afterward',
            'Every adapter is merged into W first',
            'LoRA changes only the tokenizer',
          ],
          correct: [1],
          explanation:
            'LoRA decomposes the computation. One shared dense base matmul preserves batching; a heterogeneous low-rank kernel applies the correct delta per request.',
        },
        {
          q: 'S-LoRA Unified Paging puts adapter weights and KV in one pool because…',
          options: [
            'They contain the same values',
            'Both are variable-sized, dynamically resident HBM objects that need page tables and independent reclamation',
            'Adapters are part of attention',
            'CPU memory cannot store adapters',
          ],
          correct: [1],
          explanation:
            'The payload differs; the allocator problem is identical. Paging controls fragmentation and makes capacity accounting honest across both object classes.',
        },
        {
          q: 'Punica SGMV avoids which bad compromise?',
          options: [
            'Using tensor cores',
            'Splitting traffic into one tiny batch or kernel launch per adapter',
            'Keeping adapters in CPU memory',
            'Using low-rank matrices',
          ],
          correct: [1],
          explanation:
            'SGMV carries adapter-indexed segments through one heterogeneous launch, so the base batch stays large without serial per-adapter GEMVs.',
        },
        {
          q: 'A safe multi-LoRA control plane must treat runtime adapter loading as…',
          options: [
            'A harmless cache fill',
            'A trusted code/model-loading boundary with authentication, hashes, compatibility checks, and tenant namespace isolation',
            'A client-side preference',
            'A tokenizer setting',
          ],
          correct: [1],
          explanation:
            'Adapters alter model behavior. A path-loading API without trust boundaries is both a supply-chain and tenant-isolation vulnerability.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Build the memory half, then secure the control plane',
      md: `Return to **Forge lab 02** after the original six checks are green. The optional \`adapter_unified_paging\` check asks your manager to place adapter pages and sequence KV in the same finite pool, fail atomically under pressure, and reclaim each lifetime independently. Then read S-LoRA §5 beside Punica §3: paging fixes *where adapter state lives*; SGMV fixes *how different resident adapters execute in one batch*. Continue to T6.L10 for the trust boundaries around adapter loading, tool execution, confidential inference, and shared prefix caches.`,
    },
  ],
}

export default lesson
