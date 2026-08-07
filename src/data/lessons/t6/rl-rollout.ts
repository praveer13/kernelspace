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

**2. The scheduler inside the scheduler.** Rollouts are the weirdest workload in the course: thousands of samples per prompt group (k samples for variance), enormously long generations (reasoning chains: 10k–100k tokens), extreme length *variance* (early-terminate vs think-forever), and reward-shaping rules like "all k must finish before scoring." Continuous batching still applies; the new levers are **partial rollout** (checkpoint long generations to KV, resume next step instead of restarting), **length-aware placement**, and colocating the verifier with short rollouts. T5.L6's admission valve, with gradient dynamics attached.

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
            'Trainers are fast',
            'Each gradient step needs thousands of long generations (k samples × long reasoning chains) — inference volume dwarfs the update FLOPs',
            'Rewards are expensive',
            'GPUs are slow at inference',
          ],
          correct: [1],
          explanation:
            'RLVR multiplies inference: k samples per prompt for variance, 10k–100k-token reasoning generations, every few minutes per step. 70–90% of time is rollout — hence rollout workers being full vLLM/SGLang engines.',
        },
        {
          q: 'The hard rule of weight sync is…',
          options: [
            'Sync nightly',
            'A half-updated engine must never serve: version skew produces off-policy garbage that poisons the gradient',
            'Use FTP',
            'Rollouts tolerate any version',
          ],
          correct: [1],
          explanation:
            'RL correctness depends on rollouts coming from ONE policy version. Skew isn\'t a 500 — it\'s silent data corruption of the training signal. Hence pause-broadcast-resume or carefully versioned streaming updates.',
        },
        {
          q: 'Partial rollout exists because…',
          options: [
            'GPUs are unreliable',
            'Reasoning generations are long and high-variance — checkpointing long rollouts to KV and resuming next step beats restarting them or stalling the batch on the longest chain',
            'It saves memory',
            'Rewards need it',
          ],
          correct: [1],
          explanation:
            'The batch is done when the LONGEST chain finishes; partial rollout checkpoints stragglers to KV and resumes them next iteration — T2 preemption/swap, one more time, this time for gradient steps.',
        },
        {
          q: 'Colocating trainer and rollout workers on the same GPUs wins…',
          options: [
            'Nothing',
            'Utilization — rollout fills training\'s bubbles (and vice versa), at the cost of isolation; the co-scheduler\'s bin-packing problem',
            'Accuracy',
            'Network bandwidth',
          ],
          correct: [1],
          explanation:
            'Two complementary workloads, one fleet: utilization by overlap vs isolation by splitting. That is why these stacks have a Ray controller doing placement — an OS co-scheduling problem at job level.',
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
