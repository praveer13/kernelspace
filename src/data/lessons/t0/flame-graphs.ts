import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't0.l6',
  slug: 'flame-graphs',
  trackId: 't0',
  index: 6,
  title: 'Reading a Flame Graph (and Making One)',
  minutes: 15,
  hook: 'T0.L1 assumed you can read a flame graph. Here it is, properly: what the width means, what the shapes are called, and how to make one from your own Rust code in two commands.',
  exercise: 'read+quiz',
  blocks: [
    {
      type: 'prose',
      md: `It is 3 AM and p99 doubled. Nobody asks "what could be slow?" — that question has a thousand answers. You open a profile and *look*. Of all the tools in this course, the flame graph has the highest information-per-pixel ratio ever invented, and it is the one every senior engineer reaches for first. T0.L1 assumed you could read one. Let's make that true.

A flame graph is **sampled stack traces, merged and drawn to scale**. A profiler (perf, async-profiler, py-spy) interrupts your process ~99 times per second and records the full stack each time. Thousands of stacks are then merged: identical frames line up into bars. The result answers the only question that matters: **where does the time actually go?**`,
    },
    {
      type: 'prose',
      md: `## The grammar: four rules

1. **The x-axis is time share, not time order.** A bar's width = the fraction of samples that stack appeared in. Nothing about sequence — that's a flame *chart*, a different tool. Bars are merged and (usually) sorted alphabetically; chronological order is destroyed on purpose.
2. **The y-axis is depth.** The bar above called the bar below. Root at the bottom (or top, in icicle mode — same data).
3. **A wide bar anywhere = a suspect.** A wide *plateau* on top means the code itself is spending (self time); a wide *base* with tall towers means the cost is in the callees.
4. **Color is (mostly) decoration.** Width is the signal. If your tool colors by module or temperature, fine — but never read meaning into hue before width.

That's the whole grammar. The skill is recognizing *shapes*: the allocator plateau (wide \`free\`/\`malloc\` bars — fragmentation or churn), the lock convoy (a wide \`futex\`/\`pthread_mutex_lock\` bar sitting on your worker threads — T2.L5 in the flesh), the serde tax (wide \`serialize\`/\`parse\` bars between your business logic — T3.L2's zero-copy lesson demanding to be written), the syscall storm (thin logic towers on a fat \`read\`/\`write\` base — batching opportunity, T2.L6).`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — from samples to flame: merge identical stacks, width = sample count',
      height: 56,
      nodes: [
        { id: 's1', x: 2, y: 4, w: 28, h: 9, label: 'sample 1', sub: 'main → serve → tokenize', color: '#5CA8FF' },
        { id: 's2', x: 2, y: 16, w: 28, h: 9, label: 'sample 2', sub: 'main → serve → tokenize', color: '#5CA8FF' },
        { id: 's3', x: 2, y: 28, w: 28, h: 9, label: 'main → serve → decode', color: '#A78BFA' },
        { id: 's4', x: 2, y: 40, w: 28, h: 9, label: 'main → gc_pause', color: '#FF5C6C' },
        { id: 'merged', x: 40, y: 16, w: 56, h: 24, label: 'merged stacks: tokenize bar 2× decode bar', sub: 'width ∝ samples', color: '#3EF2A4' },
      ],
      edges: [
        { from: 's1', to: 'merged', label: '' },
        { from: 's2', to: 'merged', label: '' },
        { from: 's3', to: 'merged', label: '' },
        { from: 's4', to: 'merged', label: '' },
      ],
      steps: [
        { caption: 'Four stack samples from a profiler — the raw material. Note sample 1 and 2 are identical.', active: ['s1', 's2', 's3', 's4'], edges: [] },
        { caption: 'Merge: identical prefixes collapse into shared bars. tokenize appears in 2 of 4 samples → its bar is half the graph width.', active: ['merged'], edges: ['s1->merged', 's2->merged', 's3->merged', 's4->merged'] },
        { caption: 'Read it: tokenize ≈ 50% of time, decode ≈ 25%, gc_pause ≈ 25%. You now know where to optimize — and, just as valuable, where NOT to.', active: ['merged'], edges: [] },
      ],
    },
    {
      type: 'prose',
      md: `## Making one: two commands, no ceremony

On your Forge lab code (any of labs 01–06 — they all have hot loops worth looking at):

\`\`\`sh
# Linux + Rust, the inferno way (Rust-native, no perl):
cargo install flamegraph
cargo flamegraph --test allocator_tests     # or --example calibrate
# → flamegraph.svg, open in a browser, click to zoom
\`\`\`

Same reflex elsewhere: **Java** → async-profiler (\`-e cpu\`, \`-f profile.html\`), **Python** → \`py-spy record -f speedscope\`, **Go** → \`pprof\` is built in. The tool changes; the reading doesn't. Sampling beats instrumentation because it needs no code changes and adds ~1% overhead — safe against production traffic, unlike the "add a timer around everything" instinct.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You already trust this shape: a flame graph is **EXPLAIN ANALYZE for the whole process** — the plan tells you which node ate the time, the flame tells you which *frame* did. And it's your JVM's JFR/Flight Recorder view minus the GUI. Same epistemology as every good dashboard: don't guess, measure; don't average, look at the distribution (of stacks, here).`,
    },
    {
      type: 'prose',
      md: `## What you'll hunt in this field specifically

LLM serving profiles have a recurring cast. The **Python scheduler tax** — vLLM's V0 loop spent visible milliseconds per iteration in Python bookkeeping; the V1 rewrite exists because of flame graphs showing exactly that plateau. The **detokenizer drip** — per-token detokenization on the hot path instead of incremental/streaming. The **NCCL stall** — wide \`ncclAllReduce\`/cuda-sync bars on every rank except the slow one: the profile can't see the network, but it shows you who's *waiting* and, by absence, who's *late*. And the **KV-copy surprise** — memcpy bars that mean your KV transfer path took a detour through pageable memory instead of RDMA.

Homework, honor system: profile your lab 06 scheduler's fleet scenario (\`cargo flamegraph --example calibrate\`) and find the widest bar. Then ask the senior-engineer question: is that bar *supposed* to be wide?`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'A bar in a flame graph is twice as wide as its neighbor. That means…',
          options: [
            'It ran twice as many times in a row',
            'Its stack appeared in twice as many samples — it accounts for twice the time share',
            'It called twice as many functions',
            'It has twice the latency per call',
          ],
          correct: [1],
          explanation:
            'Width is sample frequency = share of total time. The x-axis is not chronological (that\'s a flame chart) and says nothing about per-call latency — a bar can be wide because it\'s called often, or because each call is slow. Width alone doesn\'t distinguish; the tree shape around it usually does.',
        },
        {
          q: 'You see a wide futex/mutex-wait bar across all your worker threads. The most likely story is…',
          options: [
            'The CPU is slow',
            'Lock contention — threads are parked on a shared lock instead of working (the T2 convoy, measured)',
            'Too many samples were taken',
            'The profiler itself is the bottleneck',
          ],
          correct: [1],
          explanation:
            'Mutex-wait frames at the top of many towers = threads paying for a contended critical section. This is the profile-signature of the lock convoy from T2.L5 — and the argument for the lock-free structures you built in lab 04.',
        },
        {
          q: 'Why sample instead of instrumenting the code with timers?',
          options: [
            'Samplers produce prettier SVGs',
            'Timers are impossible in Rust',
            'Sampling needs no code changes, adds ~1% overhead, and is safe on production — instrumentation changes the thing you\'re measuring and misses what you didn\'t think to wrap',
            'Sampling captures memory allocation too',
          ],
          correct: [2],
          explanation:
            'Observability without distortion is the whole game: no code changes, negligible overhead, and it sees everything — including the frames you would never have thought to instrument.',
        },
        {
          q: 'Three of four ranks show a wide ncclAllReduce sync bar; the fourth doesn\'t. The correct conclusion is…',
          options: [
            'Rank 4 is the fastest — the others are waiting on it; the collective forces lockstep, so the profile shows waiting, not the cause',
            'Rank 4 is broken',
            'NCCL is always slow',
            'The GPU is overheating',
          ],
          correct: [0],
          explanation:
            'A collective is a barrier: everyone waits for the last arrival. Three wide wait bars + one absent = rank 4 is the straggler; the others\' profiles show the *cost*, not the *cause*. Reading absence is a real flame-graph skill.',
        },
      ],
    },
    {
      type: 'callout',
      variant: 'info',
      md: `This is the last lesson of T0 — and the first tool of the rest of your career here. From now on, when a lab or a Fleet scenario misbehaves, the workflow is: reproduce → profile → read the shape → fix the widest honest bar. Everything after T0 is, in a sense, learning what the bars mean.`,
    },
  ],
}

export default lesson
