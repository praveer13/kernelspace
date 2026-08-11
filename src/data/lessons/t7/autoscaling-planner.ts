import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't7.l5',
  slug: 'autoscaling-planner',
  trackId: 't7',
  index: 5,
  title: 'Autoscaling & the Planner: Capacity as a Control Loop',
  minutes: 25,
  hook: 'The last lesson of the course: the component that watches queue depth and TTFT, then adds or removes prefill and decode workers before the SLO breaks. Dynamo calls it the Planner. You have met it before — as the thing the whole course was secretly about.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `You've built every piece the loop controls: the admission valve (lab 06), the block manager (lab 02), the intake queue (lab 04), the disaggregated fleets (T6.L3), the economics of the operating point (T7.L3–L4). The Planner closes the loop: **observe** (queue depth, TTFT/TPOT, KV utilization, GPU load) → **decide** (scale prefill? decode? rebalance the split? reroute?) → **act** (add/drain workers, adjust routing weights, shed load).

Why this is hard and not just "HPA on a custom metric": inference capacity is *discrete and slow* (a new worker takes minutes to load 100s of GB of weights — T7.L2's cold start), the workloads are *two different physics* (prefill compute-bound, decode bandwidth-bound — T5.L3), the signals are *leading* (queue depth rises *before* TTFT breaks — react to the queue, not the latency), and mistakes are *asymmetric* (under-provisioning violates SLOs now; over-provisioning violates the margin report monthly — T7.L4).`,
    },
    {
      type: 'prose',
      md: `## The Planner's playbook (Dynamo's, and yours)

1. **Signal selection.** Queue depth and *oldest-waiting-age* lead TTFT by the queue time; KV-block utilization leads preemption; TPOT drift leads decode saturation. TTFT itself is a lagging confirmation. Alert and scale on leading signals.
2. **Phase-aware scaling.** In disaggregated fleets (T6.L3), scale the phase that's binding: prefill queue → add prefill workers (compute); decode TPOT creeping → add decode workers (bandwidth+KV); and *rebalance the split* when the traffic mix drifts (summarization week vs chat week). The prefill:decode GPU ratio is a continuous variable, not an architecture.
3. **Cold-start economics.** New workers cost minutes of load time. The mitigations are a lesson stack of their own: keep-warm pools for predictable peaks (diurnal traffic is cron-shaped), fast loaders (safetensors + direct-to-GPU streaming, Rust loaders like modelexpress — T3's language again), weight-sharing when the model is already resident elsewhere (NVLink copy over network pull).
4. **Shed honestly.** When capacity can't arrive in time, the options are queue (TTFT dies), shed (some users fail fast — your lab-06/fleet intake, now production), or degrade (shorter max output, smaller batch classes). An honest shed with a retryable 429 beats a silent SLO violation every time — the user experience of a timeout is worse than a clean "busy."

5. **Failure drills.** Capacity failures are the norm (spot reclaim, node death, hot expert, KV thrash). The Planner's real test is behavior *during* them: reroute, rebalance, and how fast goodput recovers. Fleet Week's incident drills are this paragraph made executable.`,
    },
    {
      type: 'statline',
      stats: [
        { value: 'minutes', label: 'worker cold start', hint: 'Hundreds of GB of weights. Capacity is slow — signals must lead.' },
        { value: 'queue age', label: 'the leading signal', hint: 'Oldest-waiting-age rises before TTFT breaks. Scale on the queue, not the latency.' },
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
        },
        {
          os: 'cold JVM pool',
          osLine: 'Keep-warm for the 9am spike because JIT+load is slow.',
          llm: 'keep-warm GPU pool + fast loaders',
          llmLine: 'Minutes of weight-load: capacity arrives late unless pre-warmed.',
        },
        {
          os: 'graceful degradation ladder',
          osLine: 'Queue → 429 → reduced feature set, by policy, in advance.',
          llm: 'queue → honest shed → degrade output classes',
          llmLine: 'A retryable busy beats a silent SLO breach. Decided before the incident, not during.',
        },
      ],
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The Planner scales on queue depth/age rather than TTFT because…',
          options: [
            'Queues are easier to count',
            'Queue metrics LEAD the latency violation — TTFT confirms after users already felt it',
            'TTFT is unmeasurable',
            'It uses less memory',
          ],
          correct: [1],
          explanation:
            'TTFT = queue time + prefill time: the queue deepens before the SLO breaks. Scaling on leading signals is the only way to arrive before the violation — especially with minutes-slow capacity.',
        },
        {
          q: 'Phase-aware scaling means…',
          options: [
            'Scaling all workers together',
            'Adding capacity to the binding phase — prefill workers for compute-bound queues, decode workers for TPOT/ITL creep — and rebalancing the split as traffic mix drifts',
            'Upgrading the GPUs',
            'Restarting the fleet',
          ],
          correct: [1],
          explanation:
            'T5.L3\'s two physics, T6.L3\'s two fleets: the prefill:decode ratio is a continuous variable the Planner owns. Scaling "the service" uniformly is the pre-disaggregation reflex.',
        },
        {
          q: 'Cold start shapes Planner design via…',
          options: [
            'Nothing',
            'Keep-warm pools for predictable peaks, fast loaders (safetensors + direct-GPU streaming), and weight-sharing from resident nodes — because minutes of load time means scaling must be early or pre-positioned',
            'Bigger GPUs',
            'More replicas',
          ],
          correct: [1],
          explanation:
            'Capacity is discrete and slow. Diurnal traffic is cron-shaped, so the cheapest capacity is pre-warmed; the next cheapest is a fast loader; the fallback is honest shedding.',
        },
        {
          q: 'When capacity cannot arrive in time, the honest order is…',
          options: [
            'Crash everything',
            'Queue (TTFT dies silently) → shed with retryable 429 → degrade output classes — chosen by policy before the incident',
            'Deny monitoring',
            'Raise prices',
          ],
          correct: [1],
          explanation:
            'A fast, retryable rejection preserves the experience of everyone admitted; silent queueing ruins everyone. The degradation ladder is a design document, not an improvisation.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Where the course ends',
      md: `Look at the Planner's dependencies: the scheduler (T5.L7, lab 06), the block manager (T5.L5, lab 02), the queue (T2.L5, lab 04), the fleets (T6.L3–L4), the frontier (T7.L3), the cost model (T7.L4). The Planner is the course wearing a job title — the loop that turns everything you built into a business. Fleet Week (the plan's capstone 2.0) puts you in its chair: allocate a fleet, pick the split, survive the incident, defend the $/Mtok. You are ready.`,
    },
  ],
}

export default lesson
