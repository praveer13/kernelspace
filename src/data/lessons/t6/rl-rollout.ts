import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l7',
  slug: 'rl-rollout',
  trackId: 't6',
  index: 7,
  title: 'RL Rollout Serving: When Training Calls the Engine',
  minutes: 25,
  hook: 'RLHF/RLVR made inference a sub-step of training: thousands of rollouts per gradient step, weights changing every few minutes, and a new systems problem — keeping the serving engine in sync with the trainer without stopping either.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `Everything so far served a *frozen* model. Reinforcement learning post-training (RLHF, and its reasoning-era descendant RLVR — verifiable rewards) breaks that: the loop is **rollout** (generate thousands of completions with the current policy) → **score** (reward model or verifier) → **update** (gradient step) → repeat, thousands of times. The rollout is 70–90% of wall-clock time, and it is produced by an *inference engine* — one whose weights change every few minutes.

The stack that emerged for this (verl, slime, OpenRLHF, AReaL): a **trainer** (FSDP/Megatron workers), **rollout workers** (vLLM/SGLang engines serving the current policy), a **weight-sync fabric** between them (NCCL broadcast or a parameter-server style push), and a **controller** (usually Ray) placing all of it on one cluster. Your T5 knowledge covers the rollout workers. The new problems are all at the seams.`,
    },
    {
      type: 'prose',
      md: `## The three new problems

**1. Weight sync without stop-the-world.** After each update, rollout engines need the new weights — 100s of GB — mid-flight. Options: pause engines → broadcast via NCCL from trainer → resume (simple, stalls decode); stream weights *through* the engines layer-by-layer while decoding (fast, delicate); or checkpoint to shared storage (3FS-class) and hot-reload (simplest, slowest). This is T2's concurrent-replacement problem — RCU, page-table shootdowns — at datacenter scale, with the added rule that a half-updated engine must never serve (version skew produces garbage rollouts and poisons the gradient).

**2. The scheduler inside the scheduler.** Rollouts are the weirdest workload in the course: thousands of samples per prompt group (k samples for variance), enormously long generations (reasoning chains: 10k–100k tokens), extreme length *variance* (early-terminate vs think-forever), and reward-shaping rules like "all k must finish before scoring." Continuous batching still applies; the new levers are **partial rollout** (checkpoint long generations to KV, resume next step instead of restarting), **length-aware placement**, and colocating the verifier with short rollouts. T5.L7's admission valve, with gradient dynamics attached.

**3. Placement and the GPU-time budget.** Trainer and rollouts share the cluster (colocated — same GPUs, time-sliced or layer-scheduled) or split it. Colocation wins utilization (rollout fills training's bubbles — T6.L2's overlap instinct at job level); splitting wins isolation (a rollout stall can't OOM a training step). The controller's job is bin-packing two very different workloads onto one fleet without letting either starve — an OS co-scheduling problem, and the reason these stacks are Ray-shaped.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '70–90%', label: 'of RL wall-clock is rollout', hint: 'Inference, not backprop, dominates RL post-training time.' },
        { value: 'k = 8–64', label: 'samples per prompt group', hint: 'Variance reduction needs groups; groups multiply rollout volume.' },
        { value: '10k–100k', label: 'tokens per reasoning rollout', hint: 'Long chains + high variance: the scheduling nightmare case.' },
        { value: 'every few min', label: 'weight refresh interval', hint: 'The serving engine\'s model is a moving target.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This is **blue-green deployment as a control loop**: the trainer is CI producing a new artifact every few minutes, the rollout fleet is production that must run the new build without downtime, and "version skew = garbage" is your canary rule taken to its extreme — one mixed-weight batch doesn't 500 a request, it corrupts the gradient. And weight sync is your cache-invalidation problem: broadcast invalidation (pause, push, resume) vs write-through streaming vs TTL (periodic reload). Same tradeoffs, 400 GB payload.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Rollout dominates RL wall-clock because…',
          options: [
            'Reward scoring is the slow step, since a reward model must read every token of every completion and costs more than generating it',
            'Each update needs thousands of long generations (k samples per prompt, 10k–100k-token chains), so decode volume dwarfs it',
            'Weight sync takes most of each iteration, because hundreds of GB must be broadcast to every engine before generation can restart',
            'Rollout engines run with tiny batches to keep policy versions consistent, so they cannot use continuous batching and sit mostly idle',
          ],
          correct: [1],
          explanation:
            'RLVR multiplies inference: k samples per prompt for variance, 10k–100k-token reasoning generations, every few minutes per step. 70–90% of time is rollout — hence rollout workers being full vLLM/SGLang engines.',
          why: [
            'Scoring is a small cost beside generating thousands of long completions. In RLVR the verifier is often a cheap programmatic check rather than a model reading every token.',
            'Right: inference volume dominates. Each update needs k samples per prompt and 10k–100k-token chains, so decode work dwarfs the gradient step and rollout takes 70–90% of wall-clock.',
            'Sync is a real seam, but it is a periodic transfer while generation runs continuously between syncs. The 70–90% rollout share comes from decode volume, not from waiting on broadcasts.',
            'Continuous batching still applies to rollouts. Version consistency is enforced at weight sync, by never serving a half-updated engine, not by shrinking batches.',
          ],
        },
        {
          q: 'The hard rule of weight sync is…',
          options: [
            'Engines should reload from shared storage on a nightly schedule, because RL tolerates a rollout policy that lags the trainer by hours',
            'A half-updated engine must never serve, because mixed-version weights yield off-policy rollouts that silently corrupt the gradient',
            'Weights must be broadcast over NCCL with every engine paused, because streaming layers during decode is never safe',
            'Mixed versions are tolerable, because gradient clipping absorbs any mismatch between rollout and trainer weights',
          ],
          correct: [1],
          explanation:
            'RL correctness depends on rollouts coming from ONE policy version. Skew isn\'t a 500 — it\'s silent data corruption of the training signal. Hence pause-broadcast-resume or carefully versioned streaming updates.',
          why: [
            'Rollouts must come from a policy close to the trainer\'s current one. With updates every few minutes, a nightly sync would leave nearly every rollout stale and off-policy.',
            'Right: rollouts must come from one policy version. A half-updated engine produces garbage that is not a visible error but silent corruption of the training signal.',
            'Pause-broadcast-resume is one of three options. Streaming weights through the engines layer by layer while decoding is faster but delicate; both must still honor the one-version rule.',
            'Clipping bounds the size of an update; it cannot repair a batch generated by weights that never matched any single policy. Skew corrupts the training signal silently.',
          ],
        },
        {
          q: 'Partial rollout exists because…',
          options: [
            'GPUs fail during long generations, so rollouts are checkpointed to disk and replayed from the last saved token after a crash',
            'Reasoning chains are long and uneven, so saving unfinished ones to resume next step beats restarting them or stalling the batch',
            'It cuts KV memory by truncating every rollout at a fixed token budget, so the reward is computed on the shortened text for each prompt group',
            'Reward functions need to score unfinished text, so the verifier runs on partially generated completions at every decoding step of a rollout',
          ],
          correct: [1],
          explanation:
            'The batch is done when the LONGEST chain finishes; partial rollout checkpoints stragglers to KV and resumes them next iteration — T2 preemption/swap, one more time, this time for gradient steps.',
          why: [
            'Partial rollout targets length variance, not hardware faults. The unfinished sequence is saved to continue in the next iteration, not replayed after a crash.',
            'Right: a batch ends when its longest chain does. Saving unfinished sequences and resuming them next iteration avoids both full restarts and a whole batch idling on stragglers.',
            'Truncation discards the rest of the chain and changes what the policy trains on. Partial rollout keeps the full generation and continues it across steps; it is scheduling, not KV shrinking.',
            'Rewards are computed on completed samples, as in the rule that all k must finish before scoring. Partial rollout schedules stragglers and does not change when scoring happens.',
          ],
        },
        {
          q: 'Colocating trainer and rollout workers on the same GPUs wins…',
          options: [
            'Accuracy, because the policy generating rollouts then shares the exact optimizer state and parameter copy used for the update, with no sync gap',
            'Utilization: rollout fills training\'s bubbles and vice versa, at the cost of isolation and a harder bin-packing problem for the controller',
            'Isolation, because a stalled rollout can no longer delay a training step or push it out of memory',
            'Nothing measurable, because time-slicing GPUs between two workloads costs as much in switching as it saves',
          ],
          correct: [1],
          explanation:
            'Two complementary workloads, one fleet: utilization by overlap vs isolation by splitting. That is why these stacks have a Ray controller doing placement — an OS co-scheduling problem at job level.',
          why: [
            'Placement does not change what the model learns. Correctness depends on every rollout coming from one policy version, enforced at weight sync whether workers are colocated or split.',
            'Right: two complementary workloads share one fleet, so each fills the other\'s idle time. The price is weaker isolation and a controller that must bin-pack both without starving either.',
            'That is the advantage of splitting. Colocated workers share GPU memory and time, so a rollout stall or memory spike can delay or OOM a training step.',
            'Colocation exists because it wins: rollout fills training\'s bubbles, so the GPU time reclaimed exceeds switching cost. The price paid is isolation, not lost utilization.',
          ],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'The stacks to read',
      md: `**verl** (ByteDance) — the reference RLHF/RLVR framework: Ray controller, FSDP/Megatron trainer, vLLM/SGLang rollouts, weight sync via NCCL and resharding. **slime** (Zhipu/THUDM) — Megatron + SGLang with strong colocation and partial-rollout work. **OpenRLHF** — Ray + vLLM, the accessible entry point. **AReaL** — async-leaning rollout scheduling. Read verl's architecture doc first; it names every seam from this lesson. Career note: "RL infrastructure" job posts in 2026 list exactly this stack — inference engines, NCCL, Ray — which is why it belongs in a serving course, not a training one.`,
    },
  ],
}

export default lesson
