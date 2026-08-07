# KERNELSPACE 10x — The Upgrade Plan

**Mission (unchanged):** take a Java/Python backend engineer to world-class systems
engineer for LLM serving at mega scale — Rust-native, Zig/C-literate, zero C++.

**Audit date:** 2026-08-03. Landscape verified against 2025–2026 sources (§2).

---

## 0. Diagnosis — what exists today

| Asset | State | Verdict |
|---|---|---|
| 40 lessons, T0–T5 | Foundations → C model → OS → Rust → GPU → serving | **Excellent spine. Keep.** |
| Pedagogy (OS≡LLM isomorphisms, JVM/Python analogies, hooks) | Distinctive voice, correct audience calibration | **The moat. Keep.** |
| 9 browser sims (memory, allocator, VM, roofline, WGSL, quant, KV, batching, engine) | Interactive, honest | **Good but siloed — each sim is an island.** |
| Capstone | Toy engine in JS, 7 steps, in-browser checks | **Teaches the loop, not the job.** |
| Glossary | 24 OS≡LLM pairs | **Strong. Extend.** |
| Code in lessons | Read-only snippets (Rust, C, WGSL, Python) | **The student never compiles, runs, profiles, or ships anything.** |

### The ceiling (why today is 2x, not 10x)

1. **Zero reps.** World-class systems engineers are made by building, measuring,
   and breaking real systems. The app is read → quiz → sim. The student never
   writes a line of Rust that compiles, never sees a flame graph from their own
   code, never ships an artifact. Knowledge without scars.
2. **The landscape moved.** Content is current to ~early-2025. Missing the
   2025–2026 canon (§2): wide expert parallelism for MoE, MLA, FP4/Blackwell,
   EPD disaggregation, NIXL/KVBM, RL rollout serving, 1M-context parallelism,
   inference economics (tok/MW, $/Mtok Pareto), InferenceMAX-style benchmarking.
3. **The language tenet is under-delivered.** The mission says *Rust with
   judgment about Zig/C*. Today: Rust is taught conceptually (T3 is good),
   Zig appears in one sentence, C is props for T1. No decision framework,
   no interop lab, no case studies (TigerBeetle/Bun/ZML).
4. **No performance-engineering practice.** T0.L1 *assumes* the student can
   read a flame graph. Nothing teaches profiling, benchmarking methodology,
   or tail-latency hunting.
5. **No career conversion layer.** No portfolio artifacts, no interview drills,
   no open-source contribution runway. A finished student has XP points;
   a world-class hire has evidence.

---

## 1. The 10x thesis

> **From "a course you read" to "a flight simulator + a forge."**

Three shifts, everything else follows:

1. **Read → Build.** Every concept gets a graded, compile-and-run artifact.
   Rust code executes in-browser (WASM) or against real traces. The sims stop
   being demos and start being *harnesses for the student's own code*.
2. **Islands → One persistent world.** All sims merge into a single
   "GPU cluster in your browser" (working name: **The Fleet**). Components the
   student builds — allocator, block manager, scheduler, router, planner —
   plug into it cumulatively. By T7 they are running *their own* disaggregated
   serving stack, not watching ours.
3. **Finish line → Portfolio.** Every lab emits a public artifact: a benchmark
   report, a flame graph, a kernel speedrun score, a design doc. The transcript
   becomes a hire-me page. Capstone is judged on **goodput under SLO per dollar**,
   the industry's actual objective function.

---

## 2. Landscape delta — what the 2025–2026 world requires (verified)

Content gaps are measured against the current canon:

**Engines & orchestration**
- vLLM V1 is the default engine (rewritten scheduler/KV manager; ~2.8×
  throughput over V0). SGLang ships **EPD disaggregation** (Dec 2025) with
  Mooncake as a transfer backend. TRT-LLM v1.0 continues as NVIDIA's compiled path.
- **NVIDIA Dynamo** (GTC 2025, now v1.3): Rust data plane — NIXL (KV transfer
  over RDMA/UCX/NVLink/SSD), **KVBM** (Rust KV block manager: GPU→CPU→SSD→remote
  tiering), KV-aware router, SLA Planner, Grove K8s operator.
- **Mooncake**: FAST'25 best paper; PyTorch ecosystem project (Jan 2026); the
  KV-cache-as-distributed-store design is now the reference architecture.
- **llm-d** (Red Hat/Google/CoreWeave) — Kubernetes-native disaggregated serving.
- Rust production footprint grew: **Cloudflare Infire** (Rust edge inference
  engine), ai-dynamo/**modelexpress** (Rust model loading), HF **tokenizers** as
  the universal Rust core. Rust now appears in inference job posts as
  required/preferred *alongside* C++/CUDA — for routers, schedulers, KV managers.

**Techniques that are table-stakes now**
- **Wide expert parallelism** for MoE: DeepSeek-V3/R1 runs EP32 prefill /
  EP144 decode with dual-batch overlap, DeepEP, DeepGEMM, EPLB. SGLang reproduced
  on 96×H100: 52.3k input / 22.3k output tok/s/node (~5× vs TP16 baseline).
- **MLA** (DeepSeek): ~70 KB/token KV vs Llama-3-70B's 320 KB — changes every
  KV-cache calculation in the course.
- **FP4/NVFP4** on Blackwell; B200 (192 GB HBM3e, ~8 TB/s), GB200 NVL72.
  TRT-LLM hit 368 tok/s/user on DeepSeek-R1 (8×B200, NVFP4 + MTP3).
- **Speculative decoding** is production: EAGLE/Medusa/MTP integrated in
  vLLM/SGLang; MTP gives 2–3× interactivity.
- **1M+ context**: context parallelism / ring attention (Meta: 1M-token prefill
  <1 min on one H100 host; 10M across 32).
- **RL rollout serving** (verl, slime, OpenRLHF, AReaL): training↔inference
  colocation is a first-class systems problem now.
- **Economics**: goodput under SLO, tok/s/GPU vs tok/s/user Pareto, tok/MW,
  $/Mtok (DeepSeek published a 545% cost-profit margin day; API prices fell
  ~80% in 2025). SemiAnalysis **InferenceMAX** is the open nightly benchmark.

**Benchmark curricula to steal from**
- UW **CSE599K** (LLM Serving Systems) — the only dedicated course; use its
  paper list as a checksum for ours.
- **GPU MODE** — 92+ lectures, public kernel speedruns with leaderboards.
- CMU 15-445 (buffer pool ≡ KV block manager), 15-418/CS149 (parallel labs),
  CS336 (build-the-whole-LM arc), 10-414 (build-your-own framework).
- Build-your-own engines for the Rust/Zig lane: candle, mistral.rs, **ZML**
  (Zig production inference stack), zinc, llm.c (C reference).

---

## 3. The eight big ideas

### 3.1 The Forge — real Rust, compile-and-run, in the browser ⭐ (the core 10x)

The single highest-leverage change: students write Rust that compiles and runs.

- **Rust→WASM lab runner.** A new content block (`rust-lab`) beside `code`,
  `quiz`, `sim`: an editor + compile pipeline + WASM sandbox, with visible-test
  + hidden-test grading, the pattern the JS capstone already proves
  (`runHarness` in `Capstone.tsx`). CPU-only labs need no GPU: allocators,
  block tables, tokenizers, lock-free queues, schedulers — the exact
  T1/T2/T3/T5 material.
- **Architecture (verified 2026-08): compile server-side, run in-browser.**
  rustc itself does NOT run in the browser (LLVM toolchain; no wasm target;
  minutes-per-compile — nobody ships this, not even play.rust-lang.org). The
  proven split: a Playground-style compile sandbox (container pool, warm
  shared cargo cache + prebuilt deps → ~1–3 s turnaround; gVisor/Firecracker
  isolation) compiles student crates to `wasm32-unknown-unknown`; the browser
  downloads the module and runs it *inside the Fleet* via wasm-bindgen/
  Extism-style ABI — deterministic, offline after first compile, zero marginal
  server cost per run. Hidden-test grading runs server-side in the same
  sandbox (browser is adversarial), which also returns clippy/rustc JSON
  diagnostics for the editor. Zig labs ride the identical pipeline
  (`zig build -Dtarget=wasm32-wasi`, tiny binaries) — so the Rust↔Zig
  allocator duel runs in one harness. Every lab also ships as a cargo template
  + devcontainer for local work; the sandbox is convenience, not a dependency.
- **Lab-by-lab constraints (all solvable):** pure-logic labs (allocator, block
  manager, tokenizer, scheduler, quant kernels) → single-threaded wasm,
  deterministic — perfect fit. Lock-free/MPMC lab → wasm threads via
  SharedArrayBuffer + COOP/COEP headers (wasm-bindgen-rayon proves the
  pattern; Netlify `_headers` config) or native server-side race-fuzzer
  grading. tokio/socket labs → server-side native or local only (no sockets
  on wasm32-unknown); the toy executor is pure Rust → runs in-browser fine.
- **Labs that matter** (each replaces or deepens an existing exercise):
  1. `bump + free-list allocator` in Rust (T1) — graded on fragmentation vs trace.
  2. `paged KV block manager` in Rust (T2→T5): block table, CoW prefix sharing,
     eviction — the vLLM `BlockManager`, for real, with a stress trace.
  3. `BPE tokenizer` in Rust, byte-level, then load **HF tokenizers** and
     diff outputs (T5.L2 goes from 15 lines of Python to the production library).
  4. `lock-free MPMC queue` with atomics (T2/T3) — graded under a race fuzzer.
  5. `toy async executor` — promoted from read-only to runnable (T3.L5).
  6. `continuous-batching scheduler` (T5.L6) against recorded traffic traces;
     scored on **goodput under SLO**, not correctness alone.
- **RustLab sim already exists** (`RustLab.tsx`) — generalize it into the runner
  instead of building a second system.
- **GPU lane without C++:** keep WGSL-in-browser for kernel concepts (it is
  genuinely CUDA-isomorphic), add a **CUDA-C reading pane** (survival literacy:
  read a FlashAttention/Triton kernel signature, never write one), and a
  companion path via **candle/cudarc** for students with a real GPU (optional,
  CLI/devcontainer, not browser-blocking).

### 3.2 The Fleet — one persistent simulated cluster ⭐

Merge the 9 island sims into a single stateful world that persists across
tracks: a rack of GPUs with HBM, a network fabric, an arrival stream.

- Student-built components plug in at defined interfaces: their allocator (T1)
  → their block manager (T5.L5) → their scheduler (T5.L6) → their router and
  planner (T6). Reference implementations keep the world running until the
  student's version passes conformance.
- The Fleet grows with the curriculum: 1 GPU (T4) → 8 GPUs/1 node (T5) →
  multi-node with RDMA links + prefill/decode pools (T6) → tiered storage
  (HBM→DRAM→SSD) + SLA planner (T7).
- Every existing sim becomes a **viewport** into the Fleet (memory grid =
  HBM view, batching sim = scheduler view, KV calc = capacity view), not a
  separate page. `engine-core.ts` becomes the kernel of it.
- **Personal-best scoring** on shared traces: goodput under TTFT/TPOT SLO,
  $/Mtok, worst-p99 — recorded in localStorage, exportable with the
  portfolio. (Decision 2026-08: no public leaderboards — they are the only
  feature that forces a server; the competition is against the reference
  implementation, not other students.)

### 3.3 T6 — Mega-Scale Track (the 2026 content gap)

New track, 8 lessons, after T5. All material the research verified as current
canon:

1. **MoE anatomy**: expert routing, all-to-all, why EP exists; DeepSeek-V3 as
   the reference; MLA and the new KV arithmetic (70 KB vs 320 KB/token).
2. **Wide EP in production**: DeepEP normal vs low-latency dispatch, EPLB hot
   experts, dual-batch overlap; SGLang's 96×H100 reproduction as the case.
3. **EPD disaggregation, 2026 edition**: Dynamo (NIXL, KVBM in Rust), Mooncake
   as PyTorch-ecosystem infra, llm-d on K8s. Upgrade the existing
   `distributed-serving` lesson — it predates EPD and KVBM.
4. **The parallelism zoo, composed**: TP×PP×DP×EP×CP decision matrix priced by
   interconnect (NVLink 5 vs RDMA vs PCIe); 1M-context ring attention.
5. **FP4/Blackwell**: NVFP4, per-block scaling, when FP4 wins and where it
   bites; B200/GB200 rooflines replacing the H100 numbers in T4.
6. **Speculative decoding, production**: EAGLE/Medusa/MTP, acceptance-rate
   math, why MTP gives 2–3× interactivity on MoE.
7. **RL rollout serving**: verl/slime architecture — training↔inference
   weight sync, rollout workers, why this is a scheduling problem.
8. **Structured output & agents**: XGrammar-class constrained decoding, cache
   locality for agentic loops (RadixAttention payoff), multi-LoRA batching.

### 3.4 T7 — Economics & SLO Engineering (the "world-class" differentiator)

Nobody teaches this; every senior role requires it. 5 lessons:

1. **The objective function**: goodput under SLO; TTFT/TPOT/e2e p50/p99;
   why raw tok/s is marketing.
2. **Benchmarking methodology**: LLMPerf/GenAI-Perf/InferenceMAX; trace
   design, warmup, statistical rigor; the student benchmarks their own Fleet
   stack and writes the report.
3. **The Pareto frontier**: tok/s/GPU vs tok/s/user; batch size as the dial;
   where providers actually operate.
4. **Unit economics**: $/Mtok, tok/MW, utilization, capacity planning;
   reproduce DeepSeek's published cost day (545% margin arithmetic).
5. **Autoscaling & the Planner**: queue-depth signals, SLA-driven
   prefill/decode scaling (Dynamo Planner), spot/capacity failure drills.

### 3.5 The Language Judgment Track — Rust deep, Zig/C literate (the tenet, honored)

The mission's exact words, turned into a track woven through T3:

- **Rust depth additions (T3'):** thread-per-core + io_uring (glommio/monoio —
  and *when tokio is the wrong choice*: busy-poll, NUMA, affinity); zero-copy
  serialization (rkyv/flatbuffers); shared memory + memmap2; profiling Rust
  (perf + flamegraph, criterion); cudarc/candle/tokio→NIXL as the serving
  stack. Case studies: Dynamo KVBM, Cloudflare Infire, HF tokenizers.
- **Zig module (new, 3 lessons):** explicit allocators & comptime; why
  TigerBeetle chose it (deterministic, no hidden allocation); Bun/Ghostty;
  **ZML/zinc — Zig LLM inference**; `zig cc` as the cross-compile superpower.
  Lab: rewrite the T1 allocator in Zig, compare against the Rust one on the
  same trace. The lesson is *taste*, not syntax.
- **C module (upgrade existing T1):** reading proficiency for the world as it
  is — CUDA host API, io_uring headers, `/proc`, eBPF maps; lab: call a C
  library from Rust **and** from Zig (one process, three languages, C ABI as
  the lingua franca — the existing `compile-link-abi` lesson made flesh).
- **The decision framework** (1 lesson, capstone of the track): a four-question
  rubric — (1) hot path & failure-mode cost, (2) ecosystem gravity (CUDA,
  kernels, drivers), (3) team/hiring, (4) interop surface — applied to five
  real scenarios (router, KV manager, kernel, embedded agent, CLI tool).
  Explicit rule: no C++ authoring anywhere in the course; optional 2-hour
  "survival reading" appendix for C++ kernel sources, clearly marked optional.

### 3.6 Speedrun Arena — time-pressure as pedagogy

Steal GPU MODE's format, not its infrastructure:

- **Kernel speedruns** (WGSL in-browser): matmul, softmax, flash-attention-lite,
  quantize/dequantize — scored against roofline % of peak on a reference trace.
- **Scheduler speedruns**: fixed traces, scored on goodput-under-SLO against
  the reference scheduler.
- **Arithmetic drills**: spaced-repetition flashcards for the numbers that must
  be reflexive — KV bytes/token (MHA/GQA/MLA), roofline ridge points, HBM/NVLink/
  RDMA bandwidths, DeepSeek-style $/day math. The glossary (24 pairs) becomes
  the deck skeleton.
- Personal bests are the portfolio's front page — local, exportable, no
  leaderboard server (decision 2026-08).

### 3.7 Capstone 2.0 — "Fleet Week"

Replace/extend the JS toy-engine capstone with a 4-act production:

1. **The Engine (Rust→WASM):** tokenizer → paged KV (their T5 lab) →
   continuous batching (their scheduler) → speculative decoding — running live
   in the browser on the Fleet, judged on goodput vs reference vLLM-style
   baseline.
2. **The Fleet (T6):** split into prefill/decode pools, add their KV-aware
   router, survive a hot-expert event and a node failure.
3. **The Business (T7):** given hardware menu + traffic trace, pick
   parallelism/hardware/batching to hit SLO at minimum $/Mtok; defend the
   choice in a one-page design doc (graded by rubric).
4. **The Incident (live drill):** injected failures — KV thrashing, NCCL-style
   collective stall, memory fragmentation creep, p99 blowout — diagnosed with
   the observability tools from 3.8. Pass = find root cause in N minutes.

The existing 7-step JS capstone stays as "Capstone Zero" — it's a good
on-ramp; Fleet Week is the world-class one.

### 3.8 The Observability & Field-Notes layer

- **Perf practice woven in, not appended:** T0.L1 stops assuming flame-graph
  literacy — a new micro-lesson teaches it (their own Rust lab code as the
  subject). Later labs require a flame graph + `perf stat` screenshot as part
  of submission. Incident drills (3.7.4) are graded on evidence.
- **Field Notes (answers "check the landscape" permanently):** a
  quarterly-updated feed section — new hardware, engine releases, benchmark
  movements — with "last verified YYYY-MM" badges on every landscape-sensitive
  lesson (T5.L8/L9, all of T6/T7). The curriculum rots in months without this;
  the badge system makes staleness visible instead of silent.

---

## 4. Curriculum map — before → after

| Track | Today | After |
|---|---|---|
| T0 Foundations | 5 lessons | + flame-graph micro-lesson (3.8) |
| T1 C-level model | 6 lessons | + C-reading lab, Rust allocator lab (3.1, 3.5) |
| T2 OS & concurrency | 7 lessons | + lock-free lab graded by fuzzer (3.1) |
| T3 Rust | 6 lessons | + thread-per-core/io_uring, profiling, Zig module (3), C-ABI interop lab, decision framework (3.5) |
| T4 GPU | 7 lessons | + B200/GB200 numbers, kernel speedruns (3.6), CUDA-C reading pane |
| T5 Serving | 9 lessons | + Rust block-manager & scheduler labs, EPD refresh of L8/L9 (3.1, 3.3) |
| **T6 Mega-scale** | — | **8 new lessons (3.3)** |
| **T7 Economics & SLO** | — | **5 new lessons (3.4)** |
| Sims | 9 islands | The Fleet — one persistent world (3.2) |
| Capstone | JS toy engine | Capstone Zero + **Fleet Week** (3.7) |
| Progress | XP/badges | + portfolio artifacts, personal-best speedruns, spaced-repetition drills (3.6) |
| Freshness | static | Field Notes + verified badges (3.8) |

New content-block types needed: `rust-lab` (runner — SHIPPED as
`src/lib/wasm-lab.ts` + `/forge`), `field-note` (dated landscape card),
`drill` (incident scenario). All extend the existing `ContentBlock` union
in `src/data/lessons/types.ts`.

---

## 5. Execution phases

**Phase 1 — The Forge (foundation everything else needs)**
`rust-lab` runner (compile-server/browser-run split), 6 Rust labs (3.1),
flame-graph micro-lesson.
*Exit: a student compiles, runs, and profiles Rust in every track.*

**STATUS 2026-08-03 — vertical slice SHIPPED, local-only, $0:**
- `labs/kit` (`kslab`) — zero-dependency wasm ABI: `ks_alloc`/`ks_free`/
  `ks_run`, JSON report in linear memory, self-checks compiled into the
  module. No wasm-bindgen, no wasm-pack: `rustup target add
  wasm32-unknown-unknown` is the only setup.
- `labs/rust-allocator` — lab 01: free-list allocator, 6 deterministic
  checks (boot, align, no-overlap, coalesce, reuse, 3000-op fragmentation
  gauntlet). Same suite in `cargo test` and in the browser. Reference
  solution in `labs/_solutions/` (never shipped in the zip).
- `labs/kv-block-manager` — lab 02 (2026-08-03): vLLM's paged block
  manager — block tables, fork+refcounts, copy-on-write, all-or-nothing
  allocation; 6 checks incl. a 2000-op churn gauntlet asserting block
  conservation after every op. Verified end-to-end in-browser.
- `labs/bpe-tokenizer` — lab 03 (2026-08-03): byte-level BPE — ranked
  merges (rank-beats-position trap check), UTF-8 roundtrip, robust
  decode, and a bit-exact contract check against a 48-merge table trained
  in-harness on a fixed corpus. Verified end-to-end in-browser.
- `labs/mpmc-queue` — lab 04 (2026-08-03): Vyukov bounded MPMC —
  per-slot sequence numbers, CAS cursors, Err(v) backpressure. 6
  semantic checks in wasm (5000 model-shadowed ops) + a native-only
  4P×4C/100k-item race fuzzer in `cargo test` (10/10 clean runs).
  Verified end-to-end in-browser.
- `labs/toy-executor` — lab 05 (2026-08-03): single-threaded executor —
  harness ships the unsafe RawWaker vtable; student writes spawn/run/
  block_on. 6 checks: FIFO wake order, exact poll counts (anti-spin),
  cross-task waker ping-pong, nested spawn. Verified end-to-end
  in-browser.
- `labs/batching-scheduler` — lab 06 (2026-08-03): continuous-batching
  admission policy graded on GOODPUT UNDER SLO. Harness is a full
  discrete-time engine simulator (pub, with a baseline-racing example):
  prefill cost, decode growth, memory cap, vLLM-style auto-preemption on
  overflow. 6 checks across 4 calibrated scenarios — burst, whale convoy
  (FCFS 54/89 vs reference 88/89), starvation stream (pure SJF completes
  0 of 3 longs; SJF + FIFO-guard completes all), fleet trace (FCFS 10%
  vs reference 62.5%). Thresholds empirically calibrated against FCFS/SJF
  baselines. Verified end-to-end in-browser.
- `src/lib/wasm-lab.ts` — browser ABI client; traps render as "not
  implemented yet".
- `/forge` + `/forge/:labId` — index, three setup lanes (rustup /
  devcontainer / Codespaces), template zip (`scripts/pack-labs.py` →
  `public/labs/*.zip`), drag-drop runner, results UI.
- Progress: `labs` slice in the store (+200 XP, `forge-first` achievement,
  streak integration). Verified in-browser end-to-end: solution wasm →
  6/6 passing → progress persisted; template wasm → clean trap message.

**Phase 1 lab spine: COMPLETE (6/6 labs).** Allocator → block manager →
tokenizer → queue → executor → scheduler — the engine's skeleton,
student-built in Rust, graded in-browser at $0 server cost.
- Flame-graph micro-lesson SHIPPED as t0.l6 (T0 now 6 lessons;
  TOTAL_LESSONS=41): reading flame graphs, generating them
  (cargo flamegraph / async-profiler / py-spy), the four serving-field
  signatures (scheduler tax, detokenizer drip, NCCL stall, KV-copy
  surprise).
- Remaining: optional verified-grading server (Appendix B).

**Phase 2 (Fleet) v0 SHIPPED 2026-08-03:**
- Runtime ABI: `ks_invoke` line protocol over the same three-export
  memory ABI (kit gained `emit_str`; zero-dep story intact). Lab 02's
  harness ships the bridge; student contract gains `dump()` — the
  observability hook the Fleet renders from.
- `/fleet`: live HBM pool (64 blocks × 16 tokens) driven by a
  deterministic traffic script (arrivals/decodes/forks/frees); demo mode
  (JS reference engine) or the student's uploaded lab-02 wasm. Per-tick
  CONFORMANCE vs a JS reference: op results, free_blocks, refcount
  multiset.
- Verified in-browser: student module ran the full 160-tick script
  (58 admissions, 9 rejections, 47 forks, 1394 decode steps) in
  lockstep — zero divergence; an off-by-one `free_blocks` variant was
  caught at tick 2 by the divergence banner.

**Fleet v1 (engine mode) SHIPPED 2026-08-03:**
- Lab 06 harness gained the same `ks_invoke` bridge (init/schedule line
  protocol: waiting/running views in, admit/preempt CSV out).
- `Engine` simulator (fleet-model.ts): prefill chunking, decode growth,
  memory cap, auto-preemption on allocation failure, legality
  enforcement (non-waiting admits / over-max-running are violations).
  Drivers are pluggable PER COMPONENT: student wasm or JS reference for
  scheduler and block manager independently — students can swap one
  component and isolate its effect.
- Engine mode UI: dual upload slots (gate: lab checks must be green),
  live goodput scoreboard (your engine vs reference engine on identical
  traffic), HBM grid from the active manager, violation banners.
- Verified in-browser: full 240-request run, student stack vs JS
  reference stack → IDENTICAL 70.0% goodput (cross-language correctness
  proof of both ports and both bridges). Upload gate rejected a 2/6
  module; headless legality test caught over-admission
  ("action exceeds max_running").
- Conformance rule going forward: managers conform (exact invariants),
  schedulers are scored (policies differ legitimately) — both against
  the same deterministic stream.

**Fleet v2 (intake queue + cluster mode) SHIPPED 2026-08-03:**
- Lab 04 (mpmc-queue) gained the `ks_invoke` bridge (init/push/pop).
  The queue is now the engine's INTAKE: arrivals push into it, full →
  shed (a lost request, honestly counted). Engine mode gained the third
  slot with per-op conformance vs a JS reference queue.
- Traffic gained flash crowds (3×45 requests over 2 ticks) so
  backpressure is real: one worker sheds 39; four workers shed 0.
- Cluster mode: N=1/2/4 worker engines behind a router (round-robin or
  join-shortest-queue); student modules instantiate PER WORKER from
  shared bytes (wasm singleton state → one instance per worker).
  Per-worker HBM grids + aggregate scoreboard.
- Calibrated scale-out numbers (headless, deterministic): 42% → 64% →
  84% goodput at 1→2→4 workers (reference stack), RR vs JSQ differences
  visible; shed collapses to 0 past 2 workers.
- Verified: engine run with all 3 student modules ≡ reference stack
  (46.3% == 46.3% with 15 shed); cluster browser run ≡ headless run
  (54.2% exactly). Two real bugs caught by running: Vyukov pow2
  capacity rounding vs JS ref queue (conformance caps must be pow2),
  and shed requests broke the completed-count completion check (now the
  engines' drained flags).

**Phase 2 — The Fleet (the world)**
Unify sim state into the persistent cluster; re-skin existing sims as
viewports; conformance interfaces for student components; personal-best
score tracking.
*Exit: T5 scheduler lab runs the student's code against shared traces and
shows the delta vs the reference scheduler.*

**Phase 3 — T6 + T7 (the 2026 content)**
13 lessons, EPD refresh of T5.L8/L9, Field Notes + badges.
*Exit: curriculum covers everything in §2's must-teach list.*

**STATUS 2026-08-03 — T6/T7 SHIPPED (13/13 lessons):**
- T6 Mega-Scale Serving (8): MoE anatomy (all-to-all, MLA 70KB vs 320KB),
  wide EP (DeepEP/EPLB/dual-batch, SGLang 96×H100 reproduction), EPD
  disaggregation (NIXL/KVBM/Mooncake/llm-d), parallelism zoo ×CP,
  FP4/Blackwell rooflines, MTP/EAGLE speculative, RL rollout (verl/slime),
  agents/structured output/multi-LoRA. Every number sourced from the §2
  research (DeepSeek open-infra, SGLang/vLLM blogs, NVIDIA, Meta, SemiAnalysis).
- T7 Economics & SLO (5): objective function (goodput), benchmarking
  methodology (LLMPerf/GenAI-Perf/InferenceMAX), Pareto frontier
  (tok/s/GPU vs tok/s/user with InferenceMAX regions), unit economics
  (DeepSeek 545% margin day reproduced, $0.20/M SGLang math),
  autoscaling/Planner.
- Wiring: TrackId union, lesson registry (54 lessons), TRACK_EXTRAS,
  track cards (also fixed pre-existing stale lesson counts T0–T5),
  TOTAL_LESSONS=54. Verified in-browser: curriculum cards, track pages,
  lesson blocks (isomorphism/diagram/statline/quiz), T5→T6 cross-boundary nav.
- Deferred from the original Phase 3 scope: EPD refresh of T5.L8/L9 prose
  (T6.L3 covers the 2026 state instead), Field Notes feed + badges (3.8).

**Phase 4 — Fleet Week + career layer**
4-act capstone, incident drills, portfolio pages, contribution runway
(curated good-first-issues across vLLM/SGLang/Dynamo/mistral.rs/candle/ZML).
*Exit: a graduate ships a public evidence pack: engine, benchmark report,
design doc, incident write-ups, speedrun personal bests.*

**STATUS 2026-08-03 — FLEET WEEK SHIPPED (all 4 acts, /week):**
- Act I (The Engine): student stack vs reference on the fleet trace —
  pass within 3 goodput points. Verified: 46.3% vs 46.3% identical.
- Act II (The Fleet): node death (t400, in-flight KV lost) + flash crowd
  (t600–750). Calibrated difficulty: 4 workers+JSQ passes (99.3% completed,
  57.4% goodput); 2 workers+RR fails (89%, 36.1%) — topology matters.
- Act III (The Business): three hardware options EXECUTED against the sim
  ($/Mtok computed, not claimed): H100 $13.2 but SLO-failing, B200 $16.5
  best-value, GB200 $229 overkill. Design doc rubric: claim within 25%,
  SLO met, ≥60 words + vocabulary. Verified: b200 pick + doc → PASS.
- Act IV (The Incident): three scripted broken engines with telemetry
  sparklines — KV thrash (naive scheduler + small pool: 1053 auto-preempts,
  p95 9271), intake stall (drain=1: 36 shed, idle GPUs), no admission
  control (greedy: 444 preempts). Root cause + mitigation graded; verified
  all three diagnosed correctly in-browser.
- Progress: `fleetWeek` slice (actsDone, scores, docText for portfolio),
  250 XP/act, `fleet-week` achievement at 4/4. Capstone hero links to it.
- Remaining from original Phase 4 scope: contribution runway (curated
  good-first-issues list), Field Notes feed (3.8).

**Revised-plan items SHIPPED 2026-08-03:**
- **EPD Fleet mode** (the disaggregation lesson, executable): prefill-only
  engine mode, timed KV transfer between pools, decode-pool headroom
  gating, and the missing mechanism the sim needed — the ITL coupling
  (shared iteration budget: P prefills → decode every (P+1)th tick) plus
  per-seq max-decode-gap SLO. Caught and fixed a double-append bug that
  silently doubled KV growth in every engine run. CALIBRATED CROSSOVER
  (identical headless + browser): EPD wins at ITL≤2 on chat mix (39.2% vs
  23.8%) and long context (8.1% vs 3.1%); colocated wins at ITL≥3/5
  (52.1% vs 39.2%) — T5.L8's rule made executable. UI: topology toggle in
  cluster mode, traffic toggle, ITL slider, P/D pool grids.
- **Decision framework lesson** (t3.l7, replaces the Zig module + duel
  lab): the four-question rubric (failure cost, ecosystem gravity, team,
  allocation budget), the honest 2026 map (Rust owns the data plane;
  Zig = deliberate niche — TigerBeetle/Bun/Ghostty/ZML; C = the water you
  read weekly), component-by-component application. No Zig code lab (std
  churn = maintenance rot, same class as the deferred contribution list).
- **T5.L8/L9 prose refresh**: disaggregation framed as the 2025–26
  default with pointer to T6.L3; Mooncake FAST'25 + PyTorch ecosystem;
  vLLM V1 default; SGLang EPD; Dynamo v1.3/KVBM + llm-d.

Sequencing note: 1→2 are load-bearing for everything after; 3 and the
language-track work (3.5) can run in parallel with 2.

---

## 6. Why this is 10x, and how we'll know

The gap between "read about serving" and "world-class" is reps, recency, and
evidence. Today the app delivers world-class *explanations*. This plan adds the
other three: a forge (reps in Rust, graded), a living fleet (systems thinking
under SLO pressure), the 2026 canon (recency, with a freshness system so it
stays true), and a portfolio (evidence the market can verify).

**Success metrics**
- A student who finished T0–T7 + Fleet Week can: build a paged-KV continuous
  batcher in Rust from scratch; whiteboard DeepSeek-on-96-GPUs with EP/EPLB
  arithmetic; defend Rust-vs-Zig-vs-C per component with the rubric; produce
  a benchmark report InferenceMAX-style; pass the incident drill.
- Portfolio artifacts per graduate: ≥6 (engine, allocator, scheduler,
  benchmark report, design doc, speedrun ranks).
- Every landscape-sensitive lesson carries a verified-badge ≤ 6 months old.

---

## Appendix B — Infrastructure (the only new backend)

The site stays static (Netlify). The plan adds **one service** (`forge`),
and even that has a local-only escape hatch:

```
Static site (Netlify) ──► forge API (single small service, OPTIONAL —
                            │  local-only mode shipped 2026-08)
                            ├─ POST /compile  → sandbox pool → wasm bytes back
                            ├─ POST /grade    → hidden tests, server-side → JSON
                            └─ POST /check    → rustc/clippy diagnostics for editor
```

- **Compile/grade sandbox** — the only hard requirement. Untrusted-code
  execution, so: no network in sandbox, read-only FS, CPU/mem/time limits
  (rustc wants ~1–2 GB, 30 s cap), seccomp, gVisor/Firecracker isolation.
  Jobs are 1–3 s with a warm shared cargo cache + prebuilt deps.
- **Build options, cheapest first:** (a) **Piston** or **Judge0** —
  open-source code-execution engines, Rust supported out of the box, good
  for the alpha; (b) **custom axum service** wrapping a container pool —
  the end state, and it dogfoods the curriculum (students study the thing
  that grades them); (c) **AWS Lambda + toolchain layer** — fits the
  bursty seconds-long job shape, zero idle cost.
- **Verified grading** — the only reason the service exists at all now
  that leaderboards are cut: hidden-test re-grading of local passes for a
  verified badge.
- **Needs NO server:** lessons/T6/T7 content, the Fleet sim, speedrun
  client-side scoring, Field Notes (static JSON + rebuild), progress
  (localStorage, as today), portfolio artifacts (client-generated,
  downloadable/exportable).
- **Local mode:** every lab ships as a cargo template + devcontainer —
  students with a toolchain never touch the sandbox; the service is a
  convenience layer, not a dependency.
- **Sizing:** a single 4-vCPU VM handles a small cohort (bursty 1–3 s jobs,
  2–4 concurrent); scale the pool or move to Lambda when bursts demand it.
  This is the cheapest component of the plan — less engineering than the
  Fleet sim itself.

### Recommended cost floor (the "one box" config)

**One 4-vCPU/8 GB VPS (Hetzner CX32-class, ~€7/mo flat; prices 2026,
verify) + free-tier Netlify = under $10/month total, fixed.**

- On the box: Caddy (auto-TLS) → `forge` (axum): compile queue + grader +
  clippy; Docker for sandboxing (or Piston until the custom service
  lands); SQLite for verified-pass records. No managed DB, no auth
  provider, no per-request third-party APIs — nothing that bills per use.
- **Why not Lambda/serverless here:** near-free at low volume but *variable*
  — one abusive user or a viral week turns it into a meter running. The
  box inverts the trade: cost is capped by construction; overload becomes a
  longer queue, not a bigger invoice.
- **Cost stays fixed by design:** per-IP rate limits, global queue-depth
  cap, 30 s/2 GB job limits. Excess demand waits; it never spends.
- **Capacity sanity:** 100 students × 30 compiles/day × ~3 s ≈ 2.5
  CPU-hours/day — fits the box ~10× over. Upgrade path if queue waits get
  painful: 16-vCPU class (~€30/mo, still flat), then a second box.
- **Local-only mode (the $0 launch path):** every lab is a git template repo
  — a crate with `TODO(you)` slots, a visible `cargo test` suite, a wasm
  build script, and `.devcontainer` config. Flow: lesson page → clone, or
  one-click **GitHub Codespaces** (free tier burns the *student's* quota,
  not ours — covers students with no local toolchain) → `cargo test` for
  instant feedback → `wasm-pack build` → **drag the .wasm file into the
  Fleet page**: the browser loads it through the same ABI as a
  sandbox-compiled module, so the flagship "your scheduler runs the
  cluster" experience works with zero server. Grading is honor-system
  (paste the harness's completion hash / push to a public repo — commit
  history is decent portfolio evidence) until the forge box exists; then
  the same repo gets re-graded server-side against hidden tests for a
  **verified** badge. Degrades: grading integrity, zero-install
  onboarding. Doesn't degrade: any of the actual learning.
  Labs are authored once (same tests, same ABI) and served both ways —
  the sandbox is literally "`cargo test` + `cargo build --target
  wasm32-unknown-unknown` as a service."

---

## Appendix A — Sources (landscape verification)

- vLLM V1: vllm.ai/blog/2025-01-27-v1-alpha-release; releases page
- SGLang EPD disaggregation (Dec 2025): docs.sglang.ai advanced features
- SGLang 96×H100 DeepSeek EP reproduction: lmsys.org/blog/2025-05-05-large-scale-ep
- vLLM wide-EP (Dec 2025): vllm.ai/blog/2025-12-17-large-scale-serving
- Dynamo + KVBM + NIXL: docs.nvidia.com/dynamo; github.com/ai-dynamo/{dynamo,nixl,modelexpress}
- Mooncake: arXiv 2407.00079; kvcache-ai.github.io/Mooncake (FAST'25 best paper)
- DeepSeek open infra (EP32/EP144, 545% margin day): github.com/deepseek-ai/open-infra-index
- TRT-LLM DeepSeek-R1 on B200 (368 tok/s/user): NVIDIA TRT-LLM tech blog
- InferenceMAX: inferencex.semianalysis.com
- Meta parallelism/CP writeup: engineering.fb.com (Oct 2025)
- Cloudflare Infire (Rust): blog.cloudflare.com
- GPU MODE: gpumode.com; UW CSE599K: courses.cs.washington.edu/courses/cse599k
- Zig inference: github.com/zml/zml, github.com/zolotukhin/zinc
- Rust stack: candle, mistral.rs, Burn/cubecl, cudarc, glommio, monoio, rkyv
- Inference arithmetic: kipp.ly/p/transformer-inference-arithmetic
