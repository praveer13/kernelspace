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
          q: 'The Planner scales on queue depth and age rather than TTFT because…',
          options: [
            'Queue metrics are cheaper to collect, whereas TTFT needs per-request tracing that slows down the serving path',
            'TTFT is dominated by prefill compute, which is constant per prompt, so it carries no information about load',
            'Scaling on latency oscillates, since added workers lower TTFT and then trigger an immediate scale-down',
            'Queue depth and age lead the violation: TTFT includes queue time, so it only confirms a breach users felt',
          ],
          correct: [3],
          explanation:
            'TTFT = queue time + prefill time: the queue deepens before the SLO breaks. Scaling on leading signals is the only way to arrive before the violation — especially with minutes-slow capacity.',
          why: [
            'Collection cost is not the reason: TTFT is already measured by every serving stack. The choice is about timing, since only the queue gives warning before the breach.',
            'TTFT is queue time plus prefill time, and queue time grows with load. It does carry load information, but only after users have waited.',
            'Oscillation is a real control issue, but cooldown windows handle it. The reason to scale on queues is that capacity arrives minutes late, so the signal must lead.',
            'Right: TTFT is queue time plus prefill, so the queue deepens first. With minutes-slow capacity, scaling on the leading signal is the only way to arrive before the SLO breaks.',
          ],
        },
        {
          q: 'Phase-aware scaling means…',
          options: [
            'Scaling prefill and decode workers together at a fixed ratio so that the fleet\'s architecture stays balanced',
            'Adding capacity to the binding phase, prefill or decode, and shifting the split as the traffic mix drifts',
            'Adding replicas in stages: a fraction of the target, then a wait for metrics to settle, then the next batch',
            'Swapping decode GPUs for newer hardware when TPOT creeps, since decode is bandwidth-bound and benefits from upgrades',
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
        },
        {
          q: 'Cold start shapes Planner design via…',
          options: [
            'Larger per-worker batches, so each slow-starting worker carries more requests and fewer workers are needed overall',
            'Treating workers as stateless containers, since a new replica starts serving as soon as its process is up',
            'Keep-warm pools for predictable peaks, fast weight loaders and weight sharing, since minutes of load time force early scaling',
            'Over-provisioning every phase by a fixed multiple, so that a scale-up is never needed during the day',
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
        },
        {
          q: 'When capacity cannot arrive in time, the honest approach is…',
          options: [
            'Let requests queue without bound, so every admitted request is eventually served and none are failed',
            'Restart the saturated workers to clear their queues, since a fresh worker starts with no backlog',
            'Decide the policy beforehand: shed excess with a fast retryable 429 or degrade output classes, not queue silently',
            'Decide at the moment of overload which requests to drop, since the right choice depends on that incident\'s cause',
          ],
          correct: [2],
          explanation:
            'A fast, retryable rejection preserves the experience of everyone admitted; silent queueing ruins everyone. The degradation ladder is a design document, not an improvisation.',
          why: [
            'Unbounded queues turn overload into a silent SLO breach for everyone. TTFT grows until requests time out anyway, so users fail slowly instead of failing fast and retrying.',
            'Restarting discards in-flight work and KV state, and the replacement needs minutes to reload weights. It removes capacity at the moment capacity is short.',
            'Right: a fast, retryable rejection preserves the experience of everyone admitted, while silent queueing ruins it for all. The degradation ladder is a design document written in advance.',
            'Improvising mid-incident is slow, error-prone and inconsistent across tenants. The ladder of queue limits, shedding and degrade classes is a design decision made before overload.',
          ],
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
