import type { AuthoredItem } from '@/lib/items/types'
import type { Lesson } from '../types'

/**
 * Spiral items (wave-2 spec §6.2): authored questions on earlier KCs of T4-T7, drawn by the t7.l5 checkpoint beside
 * the generated items. Refs are `item:<id>`; each option's `miss` names the slip it encodes.
 */
const SPIRAL: AuthoredItem[] = [
  {
    id: 't7.spiral.decode-ceiling',
    kcs: ['t4.decode-bandwidth'],
    q: {
      q: 'A 70-billion-parameter model is held in BF16 on a GPU with 3.35 TB/s of memory bandwidth. At batch 1, decode runs at roughly…',
      options: [
        'Forty-eight tokens per second: each token reads one byte per parameter, so 70 GB at 3.35 TB/s takes about 21 ms',
        'Twelve tokens per second: every weight is read twice per token, once for attention and again for the feed-forward layer',
        'Twenty-four tokens per second: each token reads all 140 GB of weights, and that takes about 42 ms at 3.35 TB/s',
        'Seven thousand tokens per second: the chip\'s arithmetic rate divided by the 140 GFLOP each token needs sets the speed',
      ],
      correct: [2],
      explanation:
        'Batch-1 decode reads every weight once per token, so the ceiling is bandwidth divided by weight bytes: 3.35 TB/s ÷ 140 GB is about 24 tokens per second. Compute sits idle, which is why batching helps.',
      why: [
        'Misconception: a parameter is one byte. In BF16 each parameter takes two bytes, so 70 billion parameters are 140 GB, and the one-byte count doubles the speed this estimate shows.',
        'Misconception: weights are read twice. Attention and feed-forward layers hold different weights, and each weight is read once per token, so the traffic is the model\'s size and no more.',
        'Right: batch-1 decode is bandwidth-bound. Every token reads all 140 GB of BF16 weights once, so the ceiling is 3.35 TB/s ÷ 140 GB, about 24 tokens per second.',
        'Misconception: decode is compute-bound. The arithmetic limit is real, but at batch 1 each weight read feeds only a couple of FLOPs, so memory traffic caps the speed long before the FLOP rate does.',
      ],
      miss: ['t4.params-are-bytes', 't4.weights-read-twice', '', 't4.decode-is-compute-bound'],
    },
  },
  {
    id: 't7.spiral.kv-per-token',
    kcs: ['t5.kv-bytes-per-token', 't5.gqa-kv-heads'],
    q: {
      q: 'A model has 80 layers, 64 query heads, 8 KV heads of dimension 128, and caches BF16 values. Its KV cache costs, per token…',
      options: [
        '320 KiB: 2 for keys and values × 80 layers × 8 KV heads × 128 dimensions × 2 bytes per BF16 value',
        '160 KiB: the same product without the factor 2, since only one vector per head and layer is cached',
        '640 KiB: each cached value takes 4 bytes, as it would in FP32, on top of the factor 2 for keys and values',
        '2.5 MiB: every one of the 64 query heads keeps its own key and value in every layer of the model',
      ],
      correct: [0],
      explanation:
        'KV bytes per token = 2 × layers × KV heads × head dimension × bytes per value = 2 × 80 × 8 × 128 × 2 = 327,680 bytes, 320 KiB. Only the 8 KV heads are cached, not the 64 query heads.',
      why: [
        'Right: 2 × 80 × 8 × 128 × 2 bytes = 327,680 bytes, which is 320 KiB. Only the KV heads are cached, so the 8 of grouped-query attention, not the 64 query heads, set the size.',
        'Misconception: only one vector is cached. Attention reads both a key and a value for every past token, so both are stored and the factor 2 stays in the product.',
        'Misconception: BF16 is 4 bytes. BF16 is 16 bits, 2 bytes per value; 4 bytes is FP32, which would double the whole cache.',
        'Misconception: every query head keeps its own KV. Grouped-query attention shares each KV head across a group of query heads, so only 8 are cached; counting 64 inflates the cache eightfold.',
      ],
      miss: ['', 't5.cache-keys-only', 't5.bf16-is-four-bytes', 't5.kv-per-query-head'],
    },
  },
  {
    id: 't7.spiral.admission-headroom',
    kcs: ['t5.admission-headroom', 't5.continuous-batching'],
    q: {
      q: 'A continuous-batching scheduler admits a waiting request only if the free KV blocks cover its prompt plus some headroom. The headroom is there because…',
      options: [
        'Prefill writes scratch blocks beyond the prompt itself, and those must be reserved before the first step runs',
        'The batch must stay a fixed size, so blocks are held free to admit a replacement the moment one ends',
        'Blocks come back only when the whole batch finishes, so room for the longest output has to be held back',
        'Admitted sequences grow by a token each step, and without spare blocks the next step forces a preemption',
      ],
      correct: [3],
      explanation:
        'Every running sequence needs a new KV slot each decode step. Checking only the prompt\'s blocks admits a request that runs out of room within a few steps and triggers a preemption, so admission reserves headroom for its decode.',
      why: [
        'Misconception: prefill needs extra blocks. Prefill writes the prompt\'s own KV blocks and nothing more; the extra room is for the tokens decode will add afterwards.',
        'Misconception: continuous batching keeps a constant batch. It does the opposite, admitting and retiring requests every step; headroom protects running sequences, not a batch-size target.',
        'Misconception: blocks return only at batch end. That is static batching. Continuous batching frees a finished sequence\'s blocks at once, which is why admission can be decided every step.',
        'Right: a running sequence takes one more KV slot every step. Without headroom the pool runs dry within a few steps and the engine must preempt a running request, so admission reserves room for the decode.',
      ],
      miss: ['t5.prefill-needs-scratch-blocks', 't5.batch-stays-fixed-size', 't5.blocks-freed-at-batch-end', ''],
    },
  },
  {
    id: 't7.spiral.fp4-bytes',
    kcs: ['t6.fp4-capacity', 't4.quantized-bytes'],
    q: {
      q: 'Moving a model\'s weights from FP8 to NVFP4, which stores 4.5 effective bits per weight once block scales are counted, shrinks them by about…',
      options: [
        'Half: four bits against eight, which is what the format\'s name says about its size per weight',
        'A factor of 1.8: eight bits become 4.5, because every block of weights also stores a scale factor',
        'A factor of 3.6: sixteen bits become 4.5, since the saving is measured against the BF16 baseline',
        'Hardly at all, about 1.1 times, since the scale factors take back almost all of the fewer-bits saving',
      ],
      correct: [1],
      explanation:
        'NVFP4 stores 4 bits per weight plus a shared scale per block, 4.5 bits effective. Against the 8 bits of FP8 that is 8 ÷ 4.5, about 1.8 times fewer bytes, not 2 times.',
      why: [
        'Misconception: the name gives the whole size. Four bits per weight ignores the per-block scale factors, which add half a bit, so the saving is a little under 2×.',
        'Right: with block scales the effective size is 4.5 bits per weight, so FP8 to NVFP4 is 8 ÷ 4.5, about 1.8 times fewer bytes.',
        'Misconception: the baseline is BF16. This question starts from FP8, 8 bits per weight; 16 ÷ 4.5 would be the saving from BF16, not from FP8.',
        'Misconception: scales cancel the saving. A scale is shared by a block of weights and adds only about half a bit per weight, so most of the saving remains.',
      ],
      miss: ['t6.fp4-is-exactly-half', '', 't6.fp4-baseline-is-bf16', 't6.fp4-scales-eat-saving'],
    },
  },
  {
    id: 't7.spiral.prefix-breaks',
    kcs: ['t6.agent-prefix-locality'],
    q: {
      q: 'An agent loop re-sends its growing prompt every turn, yet on an idle server with free memory the prefix cache misses nearly every token from turn 2 on. The likely cause is…',
      options: [
        'The prompt has grown too long for one worker, so the radix tree evicts earlier turns before the next arrives',
        'Tool output is appended after the shared text, and anything added at the end must invalidate the cache',
        'A timestamp near the top of the system prompt changes on each turn, so the token match ends there',
        'The cache is keyed by request id, so each new turn is a new request that starts with an empty cache',
      ],
      correct: [2],
      explanation:
        'A prefix cache matches tokens from the start of the prompt, so one changing value near the top ends the match there and everything after it misses. Prompts for agent loops must be prefix-stable.',
      why: [
        'Misconception: eviction. On an idle server with free memory nothing is evicted; a miss from the first changed token on means the token sequence itself differs between turns.',
        'Misconception: appending breaks the cache. A prefix cache matches from the start, so text added after the shared part leaves the whole shared part cached; that is the loop\'s advantage.',
        'Right: the cache matches tokens from the beginning, so a changing value near the top ends the match there and everything after it misses. Deterministic, prefix-stable prompts are a hard requirement.',
        'Misconception: the cache is keyed by request. Prefix caches key on the token sequence, so a new request that starts with the same tokens hits the same blocks.',
      ],
      miss: ['t6.misses-are-eviction', 't6.appending-breaks-cache', '', 't6.cache-keyed-by-request'],
    },
  },
  {
    id: 't7.spiral.past-the-knee',
    kcs: ['t7.goodput-curve'],
    q: {
      q: 'In a concurrency sweep, load rises past the knee: throughput barely changes while p95 TPOT crosses the SLO. Goodput then…',
      options: [
        'Falls because the added requests finish outside the latency bound, so fewer finished ones count',
        'Keeps rising with throughput, since every request that finishes still counts toward the total served',
        'Stays flat, because goodput is fixed by the hardware and does not depend on how many requests arrive',
        'Drops to zero at once, since one missed bound disqualifies every request that shares the batch',
      ],
      correct: [0],
      explanation:
        'Goodput counts only requests that meet every bound. Past the knee, added load queues and stretches each step, so more requests miss and the count within SLO falls even while throughput holds.',
      why: [
        'Right: goodput counts only requests that meet every bound. Past the knee, added load queues and stretches each step, so more requests miss and the count within SLO falls while throughput holds.',
        'Misconception: goodput is throughput. Completed requests that miss the TPOT bound are excluded, so goodput can fall while throughput stays level.',
        'Misconception: goodput is a hardware constant. It is a property of hardware and load together, and the same hardware gives high goodput below the knee and low goodput past it.',
        'Misconception: one miss voids the batch. Each request is judged on its own bounds, so goodput falls gradually as the share of misses grows, not to zero in one step.',
      ],
      miss: ['', 't7.goodput-is-completed-requests', 't7.goodput-is-hardware-constant', 't7.one-miss-voids-batch'],
    },
  },
]

const lesson: Lesson = {
  id: 't7.l5',
  slug: 'autoscaling-planner',
  trackId: 't7',
  index: 5,
  title: 'Autoscaling & the Planner: Capacity as a Control Loop',
  minutes: 25,
  hook: 'The last lesson of the course: the component that watches queue depth and TTFT, then adds or removes prefill and decode workers before the SLO breaks. Dynamo calls it the Planner. You have met it before — as the thing the whole course was secretly about.',
  exercise: 'read+quiz',
  verifiedAt: '2026-10',
  blocks: [
    {
      type: 'prose',
      md: `You've built every piece the loop controls: the admission valve (lab 06), the block manager (lab 02), the intake queue (lab 04), the disaggregated fleets (T6.L3), the economics of the operating point (T7.L3–L4). The Planner closes the loop: **observe** (queue depth, TTFT/TPOT, KV utilization, GPU load) → **decide** (scale prefill? decode? rebalance the split? reroute?) → **act** (add/drain workers, adjust routing weights, shed load).

Why this is hard and not just "HPA on a custom metric": inference capacity is *discrete and slow* (a new worker takes minutes to load 100s of GB of weights — T7.L2's cold start), the workloads are *two different physics* (prefill compute-bound, decode bandwidth-bound — T5.L3), the signals are *leading* (queue depth rises *before* TTFT breaks, so even a planner that targets TTFT and ITL SLAs, as Dynamo's does, has to act on queue and utilization signals or traffic forecasts rather than wait for the measured latency), and mistakes are *asymmetric* (under-provisioning violates SLOs now; over-provisioning violates the margin report monthly — T7.L4).`,
    },
    {
      type: 'prose',
      md: `## The Planner's playbook (Dynamo's, and yours)

1. **Signal selection.** Queue depth and *oldest-waiting-age* lead TTFT by the queue time; KV-block utilization leads preemption; TPOT drift leads decode saturation. Measured TTFT is a lagging confirmation. Dynamo's Planner can target TTFT and ITL SLAs directly, and its load and throughput modes act on queue-depth and KV-utilization thresholds and traffic forecasts. Alert and scale on leading signals.
2. **Phase-aware scaling.** In disaggregated fleets (T6.L3), scale the phase that's binding: prefill queue → add prefill workers (compute); decode TPOT creeping → add decode workers (bandwidth+KV); and *rebalance the split* when the traffic mix drifts (summarization week vs chat week). The prefill:decode GPU ratio is a continuous variable, not an architecture.
3. **Cold-start economics.** New workers cost minutes of load time. The mitigations are a lesson stack of their own: keep-warm pools for predictable peaks (diurnal traffic is cron-shaped), fast loaders (safetensors + direct-to-GPU streaming, Rust loaders like modelexpress — T3's language again), weight-sharing when the model is already resident elsewhere (NVLink copy over network pull).
4. **Shed honestly.** When capacity can't arrive in time, this course's ladder, in order, is queue (bounded; TTFT dies as it deepens), then shed (some users fail fast — your lab-06/fleet intake, now production), then degrade (shorter max output, smaller batch classes). The ladder is a design recommendation, not a policy Dynamo's docs prescribe. An honest shed with a retryable 429 beats a silent SLO violation every time — the user experience of a timeout is worse than a clean "busy."

5. **Failure drills.** Capacity failures are the norm (spot reclaim, node death, hot expert, KV thrash). The Planner's real test is behavior *during* them: reroute, rebalance, and how fast goodput recovers. Fleet Week's incident drills are this paragraph made executable.`,
    },
    {
      type: 'prose',
      md: `## Sizing for the peak, and for losing a node

Capacity planning is one inequality. Take the peak arrival rate λ in requests per second, the goodput g that one replica sustains at the SLO (read off a sweep like T7.L2's, not off a throughput run), and the headroom h you refuse to plan past, because beyond the knee the tail snaps and a new worker takes minutes to arrive:

**replicas = ⌈ λ ÷ (g × (1 − h)) ⌉**

With a hypothetical λ = 120 req/s, g = 9 req/s and h = 25%, that is ⌈120 ÷ 6.75⌉ = ⌈17.8⌉ = **18 replicas**. Round up, never down: 17 replicas would run each at 105% of its planned load. Then check the failure case on its own. With one replica gone, the survivors must still carry the peak under the knee, (N − 1) × g ≥ λ, and here 17 × 9 = 153 ≥ 120 holds. A fleet of 4 replicas planned at 20% headroom does not survive the same loss: its peak is 3.2 replicas' worth of goodput and the three survivors sustain 3. The smaller the fleet, the larger the share one failure takes, so it needs more headroom.

## Reading an incident before changing anything

When the SLO burns, name the failing component before touching a dial. The USE method asks three things of every resource: **utilization** (how busy it is), **saturation** (how much work is waiting for it) and **errors**. In a serving stack the resources are the admission queue, the KV blocks, the decode step on the GPU and the links between workers. Read saturation first, since a queue, preemptions or a pegged resource mark the bottleneck.

| Resource | Utilization | Saturation | Errors |
|---|---|---|---|
| Admission queue | arrival rate ÷ admit rate | queue depth, oldest waiting age | shed requests (429) |
| KV blocks | blocks used ÷ blocks total | preemptions, waits for blocks | allocation failures |
| Decode step | TPOT against its bound | TPOT drift as the batch grows | timeouts |
| Links and workers | bandwidth used ÷ capacity | stalled transfers | dead workers, retries |

A long waiting list with free KV blocks and a normal TPOT points at the front of the pipeline, prefill or admission, not at decode. The same list with pegged KV use points at memory. Change one dial only after the table has named the saturated row.`,
    },
    {
      type: 'statline',
      stats: [
        { value: 'minutes', label: 'worker cold start', hint: 'Hundreds of GB of weights. Capacity is slow — signals must lead.' },
        { value: 'queue age', label: 'the leading signal', hint: 'Oldest-waiting-age rises before TTFT breaks. Scale on the queue, confirm with the latency.' },
        { value: '2 ratios', label: 'prefill:decode split, keep-warm pool', hint: 'The two continuous variables a Planner owns.' },
        { value: '3 options', label: 'queue, shed, degrade', hint: 'When capacity can\'t arrive: pick on purpose, in advance.' },
      ],
    },
    {
      type: 'isomorphism',
      title: 'the Planner ≡ your autoscaler, finally with real stakes',
      pairs: [
        {
          os: 'HPA on CPU%',
          osLine: 'Add pods when the metric crosses the line; lag kills you at spike.',
          llm: 'Planner on queue age + KV utilization + TPOT',
          llmLine: 'Leading signals chosen per phase; scale the binding fleet, not "the service".',
          breaks: 'HPA scales one homogeneous deployment on one metric; the Planner chooses between two fleets with different physics (compute-bound prefill, bandwidth-bound decode) and the ratio between them, so no single number tells it what to add.',
        },
        {
          os: 'cold JVM pool',
          osLine: 'Keep-warm for the 9am spike because JIT+load is slow.',
          llm: 'keep-warm GPU pool + fast loaders',
          llmLine: 'Minutes of weight-load: capacity arrives late unless pre-warmed.',
          breaks: 'A cold JVM serves slowly while it warms up; a new GPU worker serves nothing until its weights, hundreds of GB, have loaded, which takes minutes, so the pool has to be sized for the spike before it arrives.',
        },
        {
          os: 'graceful degradation ladder',
          osLine: 'Queue → 429 → reduced feature set, by policy, in advance.',
          llm: 'queue → honest shed → degrade output classes',
          llmLine: 'A retryable busy beats a silent SLO breach. Decided before the incident, not during.',
          breaks: 'A web ladder switches optional features off; the rungs here trade the answer itself, since a deeper queue raises everyone\'s TTFT and degrading shortens outputs, so each rung needs an explicit bound chosen in advance.',
        },
      ],
      principle:
        'Capacity is slow and discrete, so act on leading signals and decide the degradation ladder in advance. The autoscaler pattern carries over, but the unit scaled is a phase with its own physics, and a worker takes minutes to arrive.',
      breakItem: {
        q: 'The Planner is mapped onto your web autoscaler. Where does that mapping break?',
        options: [
          'An autoscaler should act on a signal that leads the damage, and the Planner acts on queue age before TTFT breaks',
          'A web tier answers overload with a clear retryable error, and an inference fleet sheds with a retryable 429 instead of timing out',
          'A cold JVM serves slowly while it warms up, and a new GPU worker serves nothing until its hundreds of GB of weights have loaded',
          'Keeping spare capacity warm for a predictable peak costs money all day, and a keep-warm GPU pool costs more for each idle worker',
        ],
        correct: [2],
        why: [
          'This holds on both sides: a metric that leads the failure leaves time to react, in a web tier as in the Planner. The pair claims exactly this, so it is not where the analogy stops.',
          'This holds on both sides: a fast, retryable refusal beats a silent timeout for web and inference users alike. The analogy agrees here, so it is not a break.',
          'Right: a cold JVM still serves, only slowly, while a new GPU worker serves nothing until its weights, hundreds of GB, have loaded, which takes minutes. Capacity has to be ordered before the spike, not at it.',
          'This holds on both sides: warm spare capacity is paid for whether or not it is used, so headroom trades against the bill in a web tier and in a GPU pool alike.',
        ],
      },
      kcs: ['t7.leading-signals', 't7.capacity-planning'],
    },
    {
      type: 'item',
      title: 'Size the replicas for a new peak',
      family: 'goodput',
      variants: ['replicas'],
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Dynamo\'s Planner can target TTFT and ITL SLAs, yet a planner should act on queue depth and KV utilization before measured TTFT breaks because…',
          options: [
            'Queue metrics are cheaper to collect, whereas latency needs per-request tracing that slows the serving path',
            'First-token latency is dominated by prefill compute, which is constant per prompt and carries no load information',
            'Scaling on latency oscillates, with added workers lowering it and then triggering an immediate scale-down',
            'Queue depth and age lead the violation, with first-token latency including queue time and confirming it late',
          ],
          correct: [3],
          explanation:
            'TTFT = queue time + prefill time: the queue deepens before the SLO breaks. Dynamo targets TTFT/ITL SLAs but acts on queue, KV-utilization and traffic signals, since only leading signals arrive before the violation with minutes-slow capacity.',
          why: [
            'Collection cost is not the reason: TTFT is already measured by every serving stack. The choice is about timing, since only the queue gives warning before the breach.',
            'TTFT is queue time plus prefill time, and queue time grows with load. It does carry load information, but only after users have waited.',
            'Oscillation is a real control issue, but cooldown windows handle it. The reason to scale on queues is that capacity arrives minutes late, so the signal must lead.',
            'Right: TTFT is queue time plus prefill, so the queue deepens first. The SLA target is TTFT, but with minutes-slow capacity only a leading signal lets the Planner arrive before the SLO breaks.',
          ],
          kcs: ['t7.leading-signals'],
          miss: ['t7.scale-on-latency-is-cheap-collection', 't7.ttft-has-no-load-signal', 't7.scale-on-latency-oscillates', ''],
        },
        {
          q: 'Phase-aware scaling means…',
          options: [
            'Scaling prefill and decode workers together at a fixed ratio, keeping the fleet\'s architecture balanced',
            'Adding capacity to the binding phase of prefill or decode, and shifting the split as the traffic mix drifts',
            'Adding replicas in stages, with a fraction of the target first and a wait for metrics before each next batch',
            'Swapping decode chips for newer hardware when per-token latency creeps, with decode bandwidth-bound',
          ],
          correct: [1],
          explanation:
            'T5.L3\'s two physics, T6.L3\'s two fleets: the prefill:decode ratio is a continuous variable the Planner owns. Scaling "the service" uniformly is the pre-disaggregation reflex.',
          why: [
            'A fixed ratio over-provisions the phase that is not binding. When the traffic mix drifts, such as summarization week versus chat week, the bottleneck moves and the ratio must too.',
            'Right: prefill is compute-bound and decode is bandwidth-bound, so the Planner adds capacity where the queue binds. The prefill-to-decode ratio is a continuous variable it owns.',
            'That describes a staged rollout or step-scaling policy. Here, phase means prefill versus decode, the two workloads with different physics, not stages of a scale-up.',
            'Hardware refresh is a procurement decision taking weeks, not a control action. The Planner adds or drains workers of the existing types within minutes.',
          ],
          kcs: ['t7.leading-signals'],
          miss: ['t7.phase-aware-is-fixed-ratio', '', 't7.phase-aware-is-staged-rollout', 't7.phase-aware-is-hardware-swap'],
        },
        {
          q: 'Cold start shapes Planner design via…',
          options: [
            'Larger per-worker batches, with each slow-starting worker carrying more requests and fewer workers needed',
            'Treating workers as stateless containers, with a new replica serving as soon as its process is up',
            'Keep-warm pools and fast weight loaders for predictable peaks, with minutes of load time forcing early scaling',
            'Over-provisioning each phase by a fixed multiple, with scale-up not needed during the day',
          ],
          correct: [2],
          explanation:
            'Capacity is discrete and slow. Diurnal traffic is cron-shaped, so the cheapest capacity is pre-warmed; the next cheapest is a fast loader; the fallback is honest shedding.',
          why: [
            'Bigger batches raise per-token latency and push TPOT past its SLO. They do not shorten the minutes a new worker needs before it can serve anything.',
            'A replica is not ready when its process starts. It must load hundreds of GB of weights into GPU memory first, which takes minutes and is the root of the problem.',
            'Right: capacity is discrete and slow. Diurnal traffic is cron-shaped, so pre-warmed capacity is cheapest, fast loaders are next, and honest shedding is the fallback.',
            'Idle GPUs bill the same as busy ones, so a blanket multiple wastes margin every hour. It also fails the first time a spike exceeds the chosen multiple.',
          ],
          kcs: ['t7.leading-signals', 't7.capacity-planning'],
          miss: ['t7.cold-start-is-bigger-batches', 't7.cold-start-is-stateless', '', 't7.cold-start-is-fixed-overprovision'],
        },
        {
          q: 'When capacity cannot arrive in time, the honest approach is…',
          options: [
            'Letting requests queue without bound, with each admitted request eventually served and no request failed',
            'Restarting the saturated workers to clear their queues, with a fresh worker starting without backlog',
            'Walking a ladder fixed beforehand, with a bounded queue then a fast retryable shed then degraded output',
            'Deciding at the moment of overload which requests to drop, with the right choice depending on the incident\'s cause',
          ],
          correct: [2],
          explanation:
            'The course\'s ladder is queue, then shed, then degrade, fixed in advance (a design recommendation, not a Dynamo-documented policy). A bounded queue buys seconds but TTFT dies silently as it deepens; a fast retryable 429 preserves the experience of everyone admitted. The ladder is a design document, not an improvisation.',
          why: [
            'The ladder\'s queue rung must be bounded. An unbounded queue turns overload into a silent SLO breach for everyone: TTFT grows until requests time out, so users fail slowly instead of failing fast.',
            'Restarting discards in-flight work and KV state, and the replacement needs minutes to reload weights. It removes capacity at the moment capacity is short.',
            'Right: queue briefly, then shed with a fast retryable 429, then degrade output classes. A clean rejection protects everyone admitted, and fixing the ladder before the incident avoids improvised, inconsistent calls.',
            'Improvising mid-incident is slow, error-prone and inconsistent across tenants. The ladder of queue, shed and degrade is a design decision made before overload, not an on-the-spot call.',
          ],
          kcs: ['t7.leading-signals', 't7.capacity-planning'],
          miss: ['t7.overload-is-unbounded-queue', 't7.overload-is-restart', '', 't7.overload-is-improvise'],
        },
        {
          q: 'A fleet of 4 equal replicas plans 20% headroom, so its peak is 80% of the goodput the replicas sustain at the SLO. One replica dies at the peak. The fleet…',
          options: [
            'Stays inside the SLO, because the 20% headroom was set aside to absorb exactly one lost replica at the peak',
            'Keeps every survivor at its earlier 80% load, since each replica still handles the same share of the traffic',
            'Pushes the three survivors to about 107% of their goodput and past the knee, so queues keep growing',
            'Misses the SLO only for the last 5% of requests, because a 25% loss of capacity exceeds the headroom by 5 points',
          ],
          correct: [2],
          explanation:
            'The peak is 0.8 × 4 = 3.2 replicas\' worth of goodput and three survivors sustain 3, so each runs at 3.2 ÷ 3, about 107%. Past the knee the tail snaps for everyone, and a new worker takes minutes. Check the failure case, (N − 1) × g ≥ λ, when you size.',
          why: [
            'Headroom is sized for load variation, not for a failure. Three survivors carry 3 replicas\' worth and the peak is 3.2, so the loss uses all of the 20% and then runs past it.',
            'The dead replica\'s requests go to the survivors. Total load is unchanged while capacity falls by a quarter, so each survivor\'s load rises from 80% to about 107% of its goodput.',
            'Right: the peak is 3.2 replicas\' worth of goodput and three survivors sustain 3, so each runs at about 107%. Past the knee everyone slows, and a replacement takes minutes to load.',
            'Past the knee an engine degrades like a cliff, not a slope. Queues deepen and preemption snaps the tail for the whole batch, not for a neat slice of the last requests.',
          ],
          kcs: ['t7.capacity-planning'],
          miss: ['t7.headroom-covers-any-failure', 't7.load-stays-after-failure', '', 't7.overload-is-proportional'],
        },
        {
          q: 'During an incident TTFT p95 has doubled, TPOT is normal, 40% of the KV blocks are in use and the waiting list is long. The saturated component is…',
          options: [
            'The decode step on the GPU, because a long waiting list means each token takes far too long to produce',
            'Prefill or admission at the pipeline front, since requests wait to start while KV and decode have room',
            'KV capacity, because any long queue means the block pool is full and requests are waiting for free blocks',
            'The network between client and server, because TTFT includes the time the first token spends in transit',
          ],
          correct: [1],
          explanation:
            'Read saturation first: the queue is deep while KV use is 40% and TPOT is normal, so the limit is how fast requests start, which is prefill compute or the admission rate. Name that row before changing a dial.',
          why: [
            'TPOT is normal, so tokens are not slow once a request starts. A long waiting list with healthy decode means requests are stuck before they start.',
            'Right: the queue is saturated while KV use is 40% and TPOT is normal, so the bottleneck is how fast requests start, prefill compute or the admission rate. Name that before changing a dial.',
            'With 40% of blocks in use there is no memory pressure, and waiting for blocks would show pegged KV use and preemptions. The queue is long for another reason.',
            'Transit adds milliseconds and cannot double TTFT p95 or build a waiting list inside the engine. The saturation is on the server side, in the queue.',
          ],
          kcs: ['t7.incident-diagnosis'],
          miss: ['t7.queue-means-slow-decode', '', 't7.queue-means-kv-full', 't7.ttft-is-network'],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Where the course ends',
      md: `Look at the Planner's dependencies: the scheduler (T5.L7, lab 06), the block manager (T5.L5, lab 02), the queue (T2.L5, lab 04), the fleets (T6.L3–L4), the frontier (T7.L3), the cost model (T7.L4). The Planner is the course wearing a job title — the loop that turns everything you built into a business. Fleet Week (the plan's capstone 2.0) puts you in its chair: allocate a fleet, pick the split, survive the incident, defend the $/Mtok. You are ready.`,
    },
  ],
  kcs: ['t7.capacity-planning', 't7.incident-diagnosis', 't7.leading-signals'],
  ticket: {
    form: 'spiral',
    cr: [
      {
        prompt: 'Size a fleet for a peak of 120 req/s when one replica sustains 9 req/s at the SLO and you keep 25% headroom, then say what losing one replica does.',
        model:
          'Replicas = ⌈120 ÷ (9 × 0.75)⌉ = ⌈17.8⌉ = 18, rounded up. Check the failure case separately: with one gone the survivors must still carry the peak, and 17 × 9 = 153 is at least 120, so one loss is survivable. A small fleet would not survive it, because one failure takes a larger share.',
        ideas: [
          'Replicas = ⌈peak ÷ (goodput per replica × (1 − headroom))⌉, so 120 ÷ 6.75 rounds up to 18',
          'Check the failure case separately: with one replica gone, (N − 1) × g must still reach the peak',
          'A smaller fleet loses a larger share to one failure, so it needs more headroom',
        ],
        kcs: ['t7.capacity-planning'],
      },
      {
        prompt: 'The SLO is burning. Describe how you would name the failing component before changing anything.',
        model:
          'For each resource, the queue, KV blocks, the decode step and the links, read utilization, saturation and errors. Saturation first: a deep queue, preemptions or a pegged resource marks the bottleneck. Match it to the leading signals, then change one dial: queue age leads TTFT, KV use leads preemption, TPOT drift leads decode saturation.',
        ideas: [
          'For each resource read utilization, saturation and errors: queue, KV blocks, decode step, links',
          'Saturation first: a deep queue, preemptions or a pegged resource marks the bottleneck',
          'Match the leading signal to the component, then change one dial: queue age, KV use, TPOT drift',
        ],
        kcs: ['t7.incident-diagnosis', 't7.leading-signals'],
      },
    ],
    spiral: SPIRAL,
  },
}

export default lesson
