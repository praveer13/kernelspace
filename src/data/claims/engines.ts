import type { Claim } from './schema'

/**
 * Engine scheduler settings for the In-production card (docs/specs/wave-2.md §8.5). Each fact is read from
 * the engine's own source at a release tag (Q10: the releases current when 2a-04 ran), so every claim has
 * `pin {repo, ref}` and a source url under that tag. The card shows these next to the scheduler play's
 * four dials; a row whose fact could not be quoted at the tag is not here (the spec never invents one).
 * `production.vllm.v1-preemption` and `production.vllm.block-size` live in production.ts, pinned to the same tag.
 */
export const VLLM_PIN = { repo: 'vllm-project/vllm', ref: 'v0.31.0' } as const
export const SGLANG_PIN = { repo: 'sgl-project/sglang', ref: 'v0.5.21' } as const

const VLLM_RAW = `https://raw.githubusercontent.com/${VLLM_PIN.repo}/${VLLM_PIN.ref}`
const SGLANG_RAW = `https://raw.githubusercontent.com/${SGLANG_PIN.repo}/${SGLANG_PIN.ref}/python/sglang/srt`

const VLLM_SCHEDULER = { url: `${VLLM_RAW}/vllm/config/scheduler.py`, title: 'vLLM v0.31.0 source: vllm/config/scheduler.py (SchedulerConfig)' }
const VLLM_ARGS = { url: `${VLLM_RAW}/vllm/engine/arg_utils.py`, title: 'vLLM v0.31.0 source: vllm/engine/arg_utils.py (EngineArgs.get_batch_defaults)' }
const SGLANG_SCHEDULE = {
  url: `${SGLANG_RAW}/arg_groups/fields/schedule.py`,
  title: 'SGLang v0.5.21 source: srt/arg_groups/fields/schedule.py (Schedule fields)',
}
const SGLANG_MEMORY = {
  url: `${SGLANG_RAW}/arg_groups/memory_hook.py`,
  title: 'SGLang v0.5.21 source: srt/arg_groups/memory_hook.py (handle_gpu_memory_settings)',
}
const SGLANG_SCHEDULER = { url: `${SGLANG_RAW}/managers/scheduler.py`, title: 'SGLang v0.5.21 source: srt/managers/scheduler.py (Scheduler)' }
const SGLANG_KV = {
  url: `${SGLANG_RAW}/mem_cache/kv_cache_configurator.py`,
  title: 'SGLang v0.5.21 source: srt/mem_cache/kv_cache_configurator.py (resolve_max_num_reqs)',
}

/** Quotes are copied from the files above as opened on 2026-10-05, with runs of whitespace collapsed to one space. */
export const ENGINE_CLAIMS: Claim[] = [
  {
    id: 'production.vllm.scheduling-policy',
    kind: 'status',
    value: 'fcfs',
    label: 'vLLM default scheduling policy',
    source: { ...VLLM_SCHEDULER, quote: 'policy: SchedulerPolicy = "fcfs"', row: 'SchedulerConfig.policy' },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary:
      'SchedulerPolicy is Literal["fcfs", "priority"] at this release: first come first served, or the priority a caller gives each request. Neither orders by prompt length, so shortest-prompt-first is a choice you make.',
  },
  {
    id: 'production.sglang.schedule-policy',
    kind: 'status',
    value: 'fcfs',
    label: 'SGLang default schedule policy',
    source: {
      ...SGLANG_SCHEDULE,
      quote:
        'schedule_policy: A[ str, Arg( help="The scheduling policy of the requests.", choices=[ "lpm", "random", "fcfs", "dfs-weight", "lof", "priority", "routing-key", "hrrn", "shortest-prefill-first", ], ), ] = "fcfs"',
      row: 'Schedule.schedule_policy',
    },
    pin: SGLANG_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary:
      'The default orders by arrival. At this release --schedule-policy also accepts "shortest-prefill-first" (plus lpm, random, priority and others), so SJF by prompt length is one flag away in SGLang and has no flag in vLLM.',
  },
  {
    id: 'production.sglang.schedule-conservativeness',
    kind: 'status',
    value: 1,
    label: 'SGLang default schedule conservativeness',
    source: {
      ...SGLANG_SCHEDULE,
      quote:
        'schedule_conservativeness: A[ float, "How conservative the schedule policy is. A larger value means more conservative scheduling. Use a larger value if you see requests being retracted frequently.", ] = 1.0',
      row: 'Schedule.schedule_conservativeness',
    },
    pin: SGLANG_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary: 'The setting the course ties to decode headroom. The source says a larger value means more conservative scheduling and advises raising it if requests are retracted often; it gives the direction, not a token count.',
  },
  {
    id: 'production.vllm.watermark',
    kind: 'status',
    value: 0,
    unit: 'fraction of KV blocks',
    label: 'vLLM default admission watermark (KV blocks kept free)',
    source: {
      ...VLLM_SCHEDULER,
      quote:
        'watermark: float = Field(default=0.0, ge=0.0, lt=1.0) """Fraction of total KV cache blocks to keep free (the watermark) when admitting waiting or preempted requests into the running queue.',
      row: 'SchedulerConfig.watermark',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary:
      'vLLM at this release has an admission headroom setting, and its default of 0.0 disables it: out of the box, headroom is off. This is the vLLM side of the headroom dial.',
  },
  {
    id: 'production.sglang.retract',
    kind: 'status',
    value: 'retract',
    label: 'SGLang preemption mode when decode runs out of KV memory',
    source: {
      ...SGLANG_SCHEDULER,
      quote: '# Check if decode out of memory if (kv_full_retract_flag := not batch.check_decode_mem()) or (',
      row: 'Scheduler.update_running_batch',
    },
    pin: SGLANG_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary:
      'When a decode step cannot get KV memory the scheduler calls batch.retract_decode() and puts the retracted requests back on the waiting queue (_add_request_to_queue(req, is_retracted=True)). --retraction-policy chooses the victims ("length" by default).',
  },
  {
    id: 'production.vllm.max-num-seqs',
    kind: 'status',
    value: 1024,
    unit: 'sequences',
    label: 'vLLM default max_num_seqs on an H100 or H200 serving the OpenAI API',
    source: {
      ...VLLM_ARGS,
      quote:
        '# For GPUs like H100 and H200, use larger offline defaults. default_max_num_batched_tokens = { UsageContext.LLM_CLASS: 16384, UsageContext.OPENAI_API_SERVER: 8192, } default_max_num_seqs = { UsageContext.LLM_CLASS: 1024, UsageContext.OPENAI_API_SERVER: 1024, }',
      row: 'EngineArgs.get_batch_defaults, the 70 GiB and larger branch that is not an A100',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary:
      'Applies when --max-num-seqs is not given. The default depends on the GPU: 256 below 70 GiB and on A100s, 1024 from 70 GiB, and --performance-mode throughput doubles it. SchedulerConfig.DEFAULT_MAX_NUM_SEQS = 128 is only a fallback for tests.',
  },
  {
    id: 'production.sglang.max-running-requests',
    kind: 'status',
    value: '2,048 to 4,096, sized from KV capacity',
    label: 'SGLang max running requests when --max-running-requests is not given',
    source: {
      ...SGLANG_KV,
      quote: 'estimated = int(token_capacity / self.model_config.context_len * 512) estimated = max(min(estimated, 4096), 2048)',
      row: 'KVCacheConfigurator.resolve_max_num_reqs',
    },
    pin: SGLANG_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary:
      'The flag defaults to None; the server then takes the KV pool\'s token capacity ÷ context length × 512, clamped to 2,048–4,096 and to at most half the token capacity. Hybrid (Mamba) models can cap it lower.',
  },
  {
    id: 'production.vllm.max-num-batched-tokens',
    kind: 'status',
    value: 8192,
    unit: 'tokens/iteration',
    label: 'vLLM default max_num_batched_tokens on an H100 or H200 serving the OpenAI API',
    source: {
      ...VLLM_ARGS,
      quote:
        '# For GPUs like H100 and H200, use larger offline defaults. default_max_num_batched_tokens = { UsageContext.LLM_CLASS: 16384, UsageContext.OPENAI_API_SERVER: 8192, }',
      row: 'EngineArgs.get_batch_defaults, the 70 GiB and larger branch that is not an A100',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary:
      'Applies when --max-num-batched-tokens is not given. It is the per-iteration token budget that chunked prefill (on by default for models that support it) fills: 2,048 on smaller GPUs, 8,192 here, 16,384 from 160 GiB. --performance-mode throughput doubles it.',
  },
  {
    id: 'production.sglang.chunked-prefill-size',
    kind: 'status',
    value: 8192,
    unit: 'tokens/chunk',
    label: 'SGLang default chunked prefill size on an H100',
    source: {
      ...SGLANG_MEMORY,
      quote: '# H100, A100 # (chunked_prefill_size 8k, max_bs 256 if tp < 4 else 512)',
      row: 'handle_gpu_memory_settings, 60 to 90 GiB of GPU memory',
    },
    pin: SGLANG_PIN,
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary:
      'Applies when --chunked-prefill-size is not given (the field is None until the GPU is known). 2,048 below 20 GiB, 4,096 for 20 to 60 GiB, 8,192 for 60 to 160 GiB (H100, A100, H20, H200) and 16,384 above that.',
  },
]
