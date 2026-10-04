# kernelspace: audit of the interactive layer (2026-10-03)

Scope: everything the learner *does*: the 20 simulator machines, the 18 Forge crates, the Fleet (engine, cluster, EPD, pool, real-engine), Fleet Week, the JS Capstone, traces and the leaderboard. I read the code only and changed nothing in the repo. Every claim cites a file:line or a measured count.

---

## 0. Verdict

The interactive layer is **broad, honest and well engineered**. Three things stand out: a deterministic serving engine with conformance checking, a dependency-free wasm ABI, and real, provenance-carrying traces. The weak part is the **pedagogical loop around these tools**. Five patterns recur:

1. **Task detection is mostly state detection.** A task completes when the learner reaches a UI state, not when they show a prediction or an explanation. There is no prediction-capture UI anywhere: `grep -i predict` over `src/components/sims` and `src/pages` returns no learner-facing hits.
2. **Everything is an island.** 20 machines, 18 crates and 4 Fleet modes share no world state. Only 3 of 18 crates plug into the Fleet, and the plugged-in modules are not persisted across a page reload.
3. **The frontier content has no hands-on layer.** T6 (10 lessons on MoE, wide-EP, disaggregation, FP4, spec-decode, RL, LoRA, security) and T7 (5 lessons) have **0 exercise blocks**. The two most spatial lessons, `t6/moe-anatomy.ts` and `t6/wide-ep.ts`, have **0 diagrams**.
4. **Practice equals exam.** Every Fleet, Fleet Week and incident run uses the single seed `0x5eed` (`fleet-week.ts:61,67,120,301,384,484`; `EnginePanel.tsx:86`; `ClusterPanel.tsx:78`; `EpdPanel.tsx:59`). The node death always strikes worker 0 at tick 400 (`fleet-week.ts:126`).
5. **The Forge has a steep first step.** A local Rust toolchain is required, the setup one-liner assumes POSIX `test`/`curl`/`unzip`, and there is no in-browser path. All of this lands before the learner writes their first line of Rust.

---

## 1. Inventory

### 1.1 Simulator machines (`/lab/:simId`, `src/pages/Playground.tsx:20-38`)

9 routed sims, 11 sub-machines selected via `?machine=`. Completion runs through `completeSimTask` → `recordSimTask` (`PlaygroundShell.tsx:101-108`; `progress.ts:303-309`), at a fixed 60 XP per task. I measured **110 auto-detected tasks**, worth about 6,600 XP. Three sims (Quantizer, KV, WGSL) use a private `useTaskAward` copy instead of the shared helper (`QuantizerSim.tsx:136`, `KvCacheSim.tsx:117`, `WgslSim.tsx:115`).

| Sim / machine | Learner manipulates | Feedback | Completion detection | Linked from lessons |
|---|---|---|---|---|
| sim-memory · grid (`MemoryGridSim.tsx:52-55`) | bytes, pointers, null deref, stack smash | byte grid, log | reaching a state (store 0x2A at 0x80, etc.) | — |
| · latency (`LatencyWalk.tsx`) | working-set, stride sliders | ns/access step chart from a **modeled** ladder (`LatencyWalk.tsx:7-11,35-40`: L1 0.5 ns … DRAM 100 ns) | `wsKb<=32`, `>=65536`, two strides run, HBM toggle (`:139-159`) | t0/memory-hierarchy |
| · matrix / layout / frames / pointer | order, size, prefetcher, AoS/SoA, padding, call stack | canvas charts, log | run-state (`matrixBench.tasks.ts`, `layoutLab.tasks.ts`, `frameSim.tasks.ts`, `pointerLab.tasks.ts`) | t0/row-vs-column, t0/aos-vs-soa, t1/stack-vs-heap, t1/pointers |
| sim-allocator (`AllocatorSim.tsx:50-55`) | malloc/free, fit policy, coalescing, traces, unsafe inspector | heap strip, frag sparkline | thresholds (<25% / >75% frag), trace run, 1 inline MCQ (`:414-425`) | t1/toy-allocator, t1/fragmentation |
| · rust-ownership / rust-concurrency (`RustLab.tsx`, `rustLab.tasks.ts`) | simulated moves, borrows, channels, Rc/Send | simulated compiler rejections | run-state, 8 tasks | t3/ownership, t3/rust-concurrency |
| sim-vm (`VmPagingSim.tsx:1018-1028`) | 4-level walk, faults, frames, LRU/Clock, COW, PagedAttention fork | page tables, TLB, log | 11 state triggers | t2/virtual-memory, t2/swapping-eviction |
| · contention (`ContentionLab.tsx`) | threads, padding, striping, ABA | canvas throughput | run-state | t2/concurrency-primitives |
| sim-roofline (`RooflineSim.tsx:1137-1148`) | AI, dtype, batch, regs, coalescing, bank padding, tile, FlashAttention, PCIe | canvas roofline (H100/B200) | 15 triggers, many single toggles: `if (attentionMode==='flash') complete…` (`:570`), `if (pcieMode) complete…` (`:561`) | t4 ×5 (cpu-vs-gpu, roofline, gpu-memory, occupancy, matmul-tiling) |
| sim-wgsl (`WgslSim.tsx:647-650`) | **editable WGSL**, workgroup size | real WebGPU result plus verification | run outcomes (`:859-959`) | t4/wgsl-playground |
| sim-quant (`QuantizerSim.tsx:336-339`) | value, format, group size, outlier | reconstruction error, drift | reaching states (`:565-608`) | t4/quantization |
| sim-kv · calc / blocks (`KvCacheSim.tsx:197-199`; `blockTableExplorer.tasks.ts`) | model preset, dtype, ctx, batch, GPUs; block tables, fork, COW | GB bars, ITL; block grid | OOM/rescue/fit states (`:338-350`) | t5/kv-cache-math, t5/pagedattention |
| sim-batching · batching / scheduler / context-switch (`BatchingSim.tsx:618-621`) | rate, policy, preemption, quantum, priorities | canvas Gantt, p99 | run-state | t5/continuous-batching, t2/scheduling, t2/processes-threads |
| sim-engine · transformer / tokenizer / executor (`ToyEngineSim.tsx:43-47`, `engineExt.tasks.ts`) | prompt, KV toggle, batch | stage glyph, ITL, waste counter | run-state | t5/transformer-internals, t5/tokenization, t3/toy-executor |

Coverage by track (count of lessons with an `exercise` block): R 0/10, T0 3/6, T1 4/6, T2 5/7, T3 3/7, T4 7/7, T5 5/10, **T6 0/10, T7 0/5**. In total 27 of 68 lessons (40%) have one.

### 1.2 Forge (`/forge`, `/forge/:labId`; `src/data/labs.ts`)

There are 10 Rust Zero drills (20–40 min each) and 8 systems labs (90–180 min: allocator 90, kv-block-manager 120, bpe 90, mpmc 120, executor 120, batching-scheduler 150, radix-cache 150, xgrammar-lite 180; `labs.ts:485-751`). The student edits one file, runs `cargo test`, builds wasm32 and drops it. `runLabWasm` (`wasm-lab.ts:67-115`) instantiates the module with no imports and calls `ks_run`. The page compares only *required* check ids (`ForgeLab.tsx:75-82`) and awards 200 XP.

Check quality varies:
- **Systems labs are strong.** `kv-block-manager` has a seeded randomized gauntlet (`labs/kv-block-manager/src/lib.rs:298-367`). `batching-scheduler` races three calibrated traces (`labs/README.md` "Lab 06 trace calibration").
- **Rust Zero drills are weak.** Each R1 function is checked on **one literal input**, e.g. `accumulate(&[4,-2,9]) == 11` (`labs/rust-zero/r1-bindings/src/lib.rs:8-15`). Returning the literal passes.
- **The honor-system caveat is acknowledged.** The checks ship inside the student's own crate (`labs/README.md` "How grading works").

### 1.3 Fleet (`/fleet`; `Fleet.tsx`, `src/pages/fleet/*`, `src/lib/fleet-model.ts` 1,256 lines)

Modes (`Fleet.tsx:42`):
- **engine:** your scheduler, block manager and intake queue against the reference, on synthetic, Kimi, BurstGPT or LMSYS-shape traffic, or a local trace file.
- **cluster:** 1/2/4 workers × RR, JSQ or prefix-affinity router, with an embedded EPD P/D split (`ClusterPanel.tsx:166-202`, `EpdPanel.tsx:127-137`).
- **real:** Qwen3-0.6B (~400 MB) or SmolLM2-135M (~90 MB) running in a Web Worker (`RealEnginePanel.tsx:12-13`, `public/gen-worker.js`).
- **pool:** op-by-op conformance of a block manager against `RefBlockManager` (`fleet-model.ts:20-115`).

Feedback is a MetricsDashboard of number cards (`MetricsDashboard.tsx`), counters, per-worker 32-column block grids (`ClusterPanel.tsx:257-290`) and divergence banners. There are **no time-series charts and no request-flow view**. A Fleet run records **nothing** in the progress store: `useProgress` does not appear in `Fleet.tsx` or `src/pages/fleet/*`. Slots require all checks green (`drivers.ts:55-58`).

Traces (`public/traces/`): Kimi conversation (72 KB), BurstGPT busiest hour (29 KB), LMSYS published shape (22 KB). **The brief mentions Azure, but no Azure trace exists** (`grep -i azure src` returns nothing; `FleetTrafficId` = synthetic | kimi | burstgpt | lmsys-shape, `traces.ts:30`).

### 1.4 Fleet Week (`/week`; `fleet-week.ts`)

- **Act 1:** goodput within 3 points of the reference (`:81`). **This passes with no student modules uploaded**, because an all-reference run equals the reference, and the UI says so (`:82-88`; `FleetWeek.tsx:130-134`).
- **Act 2:** a 2|4 workers × 3 routers choice (6 combinations), then a scripted death and flash crowd. Pass requires ≥92% completed and ≥40% goodput (`:149`).
- **Acts 1–2, evidence:** an analysis of 40–150 words with ≥2 metric keywords, ≥1 decision keyword and one number, plus *any* non-empty image as the "screenshot" (`:209-211`; `FleetWeek.tsx` rubric "trace 50% · screenshot 15% · analysis 35%").
- **Act 3:** a claimed $/Mtok within 25% of simulated, an SLO check, and a doc of ≥60 words containing ≥3 of 11 vocabulary terms (`:341-346`). The doc check is **keyword-countable**.
- **Act 4:** 3 static incidents, each a 4-cause × 4-mitigation MCQ with **unlimited retries**. In all 6 option sets, the correct option is the longest and most qualified (`:400-455`). The briefings nearly state the answer ("free blocks hover near zero", "drain").

### 1.5 Capstone (`/capstone`; `Capstone.tsx` 1,874 lines)

Seven JS steps edited in a `<textarea>` (`:1274`), run via `new Function` **on the main thread** (`:78`). A one-click "show solution" (`:1135`, `:1301`) only turns off a `no-hints` achievement; there is no graduated hinting. **Step 5 "KV cache" can be completed by changing one token:**
- The TODO is `const next = 0` → `argmax(biased)` (`:480-485`). The cache machinery is provided as `lib.forwardCached`.
- The "accounting" check, labelled *"cache grows exactly 1 position per appended token"*, only tests `out.length > 0` (`:538-545`).
- The "speedup ≥10×" check reads `REF_DECODE` vs `REF_CACHED` (`:121-126`) and **is independent of the student's code**.

The headline lesson of the course, the KV cache, is therefore passable without implementing a KV cache.

### 1.6 Leaderboard

A CI-verified scheduler leaderboard (`leaderboard.ts`, 3 workflows). `public/leaderboard.json` has **0 entries**.

---

## 2. Learning-loop evaluation

**Goal clarity: good.** Every machine has a 3–12 item task list. Forge pages state contracts before the run (`labs.ts:12-19` `expectation`). Fleet Week states its pass bars.

**Two parallel task lists that disagree.** The lesson's exercise card shows its *own* tasks as static, never-checked `Square` icons (`blocks.tsx:640-650`). The sim auto-detects a *different* list. For example, `t5/kv-cache-math.ts:96-101` asks to "Reproduce the 8B numbers … 128 KB/token, ~480k tokens", while `KvCacheSim.tsx:197-199` detects "70B OOM / rescue / 200k batch". The lesson's careful tasks, including "predict each split before you step" (`t1/toy-allocator.ts:187`), are never tracked.

**Feedback immediacy:**
- **Sims: excellent.** Live charts, logs and toasts.
- **Forge: delayed and coarse.** A single `todo!()` anywhere traps the whole `ks_run`. The browser reports "not implemented yet" with **zero per-check information** (`wasm-lab.ts:88-92`; no `catch_unwind` anywhere in `labs/`). Per-check feedback exists only in the terminal.
- **Fleet: good when it diverges.** It shows the first divergence line (`EnginePanel.tsx:195,335-340`). It does not say *why* a policy lost goodput.

**Informativeness of wrong answers.** `InlineQuiz` shakes on a wrong answer and allows unlimited retries with **no explanation** (`PlaygroundShell.tsx:826-886`). It is used only twice. The Forge's `profile.question` appears after green but is **not captured** (`ForgeLab.tsx:420-428`).

**Predict-then-observe: absent as a mechanic.** Prediction is exhorted in prose ("When you can predict both curves before running them…", `t1/fragmentation.ts:98`; index hooks `lessons/index.ts:182,195,220,232`). No sim asks for a number first and then compares. The lesson's "what just happened" note can be opened **before** the exercise (`blocks.tsx:652-680`), which spoils the discovery.

**Reflection:** captured only in Fleet Week Acts 1–3, and graded by keyword counts. Sim tasks phrased "explain the gap" (`MemoryGridSim.tsx:71`) complete on *running* both configurations (`LatencyWalk.tsx:142-145`).

**Scaffolding and fading.** Systems labs scaffold heavily: `manager.rs` hands over the suggested data structure (`labs/kv-block-manager/src/manager.rs:27-32`). No crate demonstrably fades that support. The Capstone gives 80% harnesses plus a full solution reveal. There is no hint ladder anywhere.

**Transfer: weak.**
- One seed everywhere (see §0).
- Act 2 always kills worker 0 at t=400 (`fleet-week.ts:126`).
- Sim tasks re-run the presets the lesson used.
- No held-out traces. The batching lab's scored traces are the same ones Fleet and the leaderboard use (`labs/README.md`; `leaderboard.ts:10`).

**Completable without understanding?** Often yes:
- Roofline: toggle FlashAttention → +60 XP (`RooflineSim.tsx:570`); toggle PCIe → +60 (`:561`).
- Capstone step 5: one token (§1.5).
- Fleet Week Act 1: zero modules (§1.4).
- Act 4: brute force over 16 combinations, plus a longest-answer tell.
- Act 3 and the evidence docs: keyword stuffing; any image counts as the screenshot.
- R-drills: hard-code the single expected literal.

**Incentives are misaligned.** A sim toggle earns 60 XP. A 120–180 minute systems lab earns 200 XP (`progress.ts:97-102`). The 110 sim tasks total ≈6,600 XP versus 18 × 200 = 3,600 XP for the entire Forge.

**Sims are optional for progression.** Lesson completion is gated only on exam quizzes (`Lesson.tsx:467-469`).

---

## 3. Forge onboarding: time-to-first-green for a Java/Python learner

These are the exact steps for R1 (`ForgeLab.tsx:122-129`, `LANES` `:29-47`, `labs/README.md`):

1. **Install rustup.**
   - macOS/Linux: a curl script, about 3–8 min.
   - **Windows:** `rustup-init.exe` needs the MSVC C++ Build Tools to link the host `cargo test` binaries. That is a multi-GB Visual Studio installer, about 20–60 min. **This is the biggest drop-off.**
2. `rustup target add wasm32-unknown-unknown` (≈1 min).
3. Paste the one-liner: `test ! -e … && curl … && mkdir … && unzip -q … && cd …` (`ForgeLab.tsx:123-128`).
   - POSIX only: fails in PowerShell or cmd.
   - Requires `unzip`, which is not installed by default on many minimal Linux images. **It is absent on the machine this audit ran on** (`unzip: command not found`).
4. Open `src/exercises.rs` in an editor. There is no rust-analyzer guidance unless the learner uses the devcontainer.
5. Run `cargo test`. The first compile takes ~10–30 s; then iterate.
6. Run `cargo build --release --target wasm32-unknown-unknown`.
7. In a file manager, navigate to `target/wasm32-unknown-unknown/release/rust_zero_r1.wasm`, four levels deep and hidden from many default views, and drag it onto the page.
8. **All six functions must be finished** before the browser shows anything other than "not implemented yet" (§2).

| Profile | Est. time-to-first-green | Main drop-off |
|---|---|---|
| Has Rust, macOS/Linux | 8–15 min | step 7 path, step 8 all-or-nothing |
| Fresh macOS | 15–30 min | rustup install, Xcode CLT prompt |
| Fresh Windows (no WSL) | 45–90+ min | MSVC Build Tools, POSIX one-liner, `unzip` |
| Codespaces | 5–10 min, plus quota | no deep link: "Open the kernelspace repo in a Codespace" is prose only (`ForgeLab.tsx:44-46`; `grep codespaces.new src` returns nothing). `postCreateCommand` builds the whole `labs` workspace (`.devcontainer/devcontainer.json`). |

Other friction:
- **The Rust Zero track is the course's on-ramp, yet R lessons contain zero runnable code.** There are no Rust Playground links (`grep play.rust src/data/lessons/r` returns nothing).
- **Lessons never surface their Forge lab.** `FORGE_LABS` is consumed only by `Forge.tsx` and `ForgeLab.tsx`. Of the 8 systems labs, only radix-cache is hand-linked from a lesson.
- **Infinite loops hang the tab.** Wasm runs on the main thread with no timeout (`wasm-lab.ts:67-115`); so does the Capstone `new Function` call.

---

## 4. Integration and persistence

**Islands.** Each machine keeps its config only in `?cfg=` (`PlaygroundShell.tsx` codec) plus task flags. Nothing flows between sims. For example:
- The KV calculator's chosen model and GPU don't seed the Fleet's `numBlocks`.
- The roofline's B200 doesn't configure Fleet Week's HW menu (`fleet-week.ts:259-276`).
- The toy engine shares `engine-core.ts` with the Capstone, but not with the Fleet.

**Fleet wiring.** Only 3 of 18 crates plug in: `SLOT_WANT_LAB` = batching-scheduler, kv-block-manager, mpmc-queue (`slots.ts:22-26`). The rest are not wired:
- **radix-cache (lab 07) is not plugged in**, even though the Fleet has a JS prefix-cache router (`fleet-model.ts:821-883`).
- **bpe-tokenizer is not used by real-engine mode.**
- allocator, executor and xgrammar-lite are unwired.

**Persistence.** `useSlots` is a plain zustand store with **no `persist`** (`slots.ts:34-39`). A reload drops all uploaded modules. There is no persistent "your cluster" world: Fleet keeps no history, no saved runs and no XP.

**Progression state that does persist** (`progress.ts`): lesson, quiz, sim-task, lab, capstone and Fleet Week flags, plus Fleet Week evidence and docs.

### Reusable engine pieces a game or 3D layer could stand on

- `Engine` / `Cluster` / `EpdCluster` (`fleet-model.ts:471,908,1076`): deterministic, tick-stepped, injectable `disrupt` hook (`fleet-week.ts:122`), `recorder` per tick (`:386`), `kill()` / `inject()`.
- Driver interfaces `SchedulerDriver`, `ManagerDriver`, `QueueDriver` (`fleet-model.ts:280-346, 1193`). Any component, including a JS "AI opponent", can slot in.
- The wasm ABI with the `ks_invoke` line protocol (`wasm-lab.ts:121-194`), which turns student Rust into game pieces.
- Traces with provenance and sha256 (`traces.ts:12-27`).
- `real-engine.ts` plus the worker protocol: real tokens as a game resource.
- `makeServingMetrics` with OTel-named metrics (`fleet-model.ts:413-470`).
- `engine-core.ts` (741 lines): a full toy transformer.
- three, R3F and drei are already installed, but used only by the decorative `ParticleField` (893 KB raw / 239 KB gz chunk in `dist/assets`).

---

## 5. Inherently spatial or flow concepts currently flattened to 2D

| Concept | Current treatment | Evidence | Why space or play would help |
|---|---|---|---|
| Memory hierarchy distance (reg→L1→L2→L3→DRAM→HBM→NVMe) | a step chart from modeled constants | `LatencyWalk.tsx:35-40` | latency as *distance travelled*: a 100 ns DRAM trip is 200× an L1 hop |
| GPU SM → warp → tensor core → SMEM → L2 → HBM | sliders plus a canvas roofline; a WGSL "dispatch visualizer" | `RooflineSim.tsx:7-20,167-168` | occupancy, coalescing and bank conflicts are geometric |
| NVLink/NVSwitch, NVL72 rack, IB/RoCE fabric | **none** (prose only) | T6 has no sims; `parallelism-zoo.ts` has 1 diagram | TP/EP/PP placement is a topology problem |
| MoE routing + all-to-all, hot experts, EPLB | **none** | `moe-anatomy.ts`, `wide-ep.ts`: 0 diagrams, 0 exercises | token flow, load imbalance and stragglers are visually obvious in motion |
| Request flow through router → prefill → KV transfer → decode | number cards plus block grids | `ClusterPanel.tsx:238-290`, `EpdPanel.tsx` | queues, transfers and node death are a flow-network game |
| KV block tables / radix tree / CoW | 2D grids (good) | `BlockTableExplorer.tsx`, `ClusterPanel.tsx:265` | a tree view would help; 2D is mostly adequate |
| Page-table walk (4 levels) | 2D tables | `VmPagingSim.tsx:1018` | hierarchy depth reads well as nested descent |
| Speculative decoding (draft tree / verify) | **none** | `speculative-production.ts` | tree acceptance is a branching spatial structure |
| Disaggregation economics, rack power | number cards | `fleet-week.ts:259-330` | a capacity-planning sim or tycoon loop |

---

## 6. Mobile, accessibility, performance

**Mobile.**
- The sim shell stacks the task sidebar below xl (`PlaygroundShell.tsx:354-358`). Sliders are Radix and therefore touch-capable.
- Pointer and touch handlers exist only in `MemoryGridSim` (2 instances).
- The Fleet's 32-column block grid shrinks to sub-10 px cells on phones (`ClusterPanel.tsx:265`).
- **Forge and the Fleet slots are desktop-only by nature.** Drag-drop of a locally built `.wasm` is impossible on a phone.
- A "study on the commute" mode (quizzes, prediction drills, flashcards) is entirely absent.

**Accessibility.**
- About 10 canvases carry the course's key results (latency, matrix, layout, roofline, scheduler, contention, batching, WGSL, quantizer).
- Six have `role="img"`, but labels are static, e.g. `"CPU scheduling Gantt chart. Press run to generate."` (`SchedulerLab.tsx:541-542`). There is **no live text equivalent of the plotted data**.
- `BlockTableExplorer`, `FrameSim`, `PointerLab`, `ContextSwitchLab`, `RealEnginePanel` and `FleetWeek` have 0 `aria-` attributes.
- Reduced motion is honored in 17 of 20 sim files but in **none** of the Fleet or Fleet Week files.
- The Forge drop zone is keyboard-operable (`ForgeLab.tsx:287-289`): good.

**Performance.**
- **No route code-splitting.** All 16 pages are eager imports (`App.tsx:1-18`); only `ParticleField` is lazy.
- The (stale, 2026-07-23) `dist` main chunk is **1.93 MB raw / 595 KB gzip**, and today's source is larger (all 68 lessons plus 20 sims).
- three.js weighs 239 KB gz for decoration only.
- The `/lab` gallery runs 9 live canvas previews at once (`Lab.tsx:1-4`, 8 → 30 fps).
- Fleet Week acts run up to 20,000 ticks synchronously on the main thread, with a string `ks_invoke` round-trip per op and 3 modules per worker (`fleet-week.ts:70-75,119-142`). Expect visible jank at 4 workers.
- Real-engine mode correctly uses a Worker (`real-engine.ts:69-75`).

---

## 7. Upgrade opportunities (concrete, constraint-compatible)

**A. Fix the loops before adding worlds (cheap, high impact).**
1. **Prediction gate on every sim task.** The `SimTask` type gains `predict: {prompt, unit, tolerance}`; the shell asks for a number before the run, then plots prediction against actual and stores the calibration error per learner. This adds a confidence-weighted calibration score to `/progress`. Predict-observe-explain is well supported in the learning-science literature.
2. **Unify task lists.** Make lesson exercise cards render the live detected tasks with real check state, and embed the sim inline (`?embed=1` already exists in `PlaygroundShell.tsx:10`). Hide "what just happened" until the tasks are done.
3. **Replace state-triggers with outcome or explanation checks.** For example, `t-roof-flash` completes only after the learner enters the AI multiplier they observed. Also repair Capstone step 5 so the student writes the cache append, and make "accounting" actually inspect cache length.
4. **Seeded variation ("same skill, new numbers").** Randomize `0x5eed` per attempt and keep a fixed held-out seed for grading. Randomize the node-death worker and tick, and generate incidents parametrically: inject cause X with severity S and noise. That yields 100s of incidents instead of 3, which serves both transfer and anti-gaming.
5. **Rebalance XP toward effortful work.** Weight by attempt quality and difficulty, and give no XP for single toggles.
6. **Partial credit in the browser.** Wrap each check in the harness with a per-check status, e.g. `panic = "abort"`-safe sentinel functions exported one per check: `ks_check_n`. A `todo!()` in function 6 should not hide that 1–5 are green.

**B. Lower the Forge on-ramp (zero-server).**
7. A **Codespaces deep link** (`https://codespaces.new/<repo>?devcontainer_path=…`) per lab, plus a lab-scoped devcontainer that builds only that crate.
8. A **PowerShell variant** of the one-liner (`Invoke-WebRequest` + `Expand-Archive`) and a WSL note. Drop the `unzip` dependency by also serving `.tar.gz`, which `tar` handles on macOS, Linux and Win10+.
9. A **browser-side "first 30 minutes" path for R1–R3:**
   - deep links to play.rust-lang.org with the exercise preloaded (a third-party service, no server of ours: an owner decision);
   - and/or an in-browser editor with rust-analyzer-wasm diagnostics. Rust compilation fully in-browser is still not proven practical (PLAN.md §3.1 records this).
   - Keep local cargo as the graded path.
10. **Watch-folder / File System Access API drop.** Pick the crate once, and the page re-reads the `.wasm` on every rebuild, so there is no drag-and-drop loop. This is Chromium-only, with a fallback to drag.

**C. Make it one world.**
11. **Persist Fleet slots** in IndexedDB (bytes plus sha). Add a persistent "your cluster" with history, best runs and Fleet XP.
12. **Wire the remaining crates:**
    - radix-cache → the cluster prefix router;
    - bpe-tokenizer → the real-engine's tokenizer-count check;
    - allocator → a host-memory pool;
    - xgrammar-lite → the real-engine's constrained JSON output;
    - executor → the intake loop.
    - The result: "every crate you write is a part in your engine".
13. **Thread sim configuration into the Fleet.** The KV calculator's model and GPU choice sets `numBlocks` and `blockSize`; the roofline's chosen GPU sets tick cost.

**D. Spatial and game treatments (where they earn their weight; all client-side on R3F, already installed).**
14. **"Datacenter" 3D view over `Cluster`/`EpdCluster`:** a rack of GPUs as instanced meshes, requests as particles flowing router → prefill → (KV transfer arc) → decode. Node death becomes visible, and the camera zooms rack → node → SM. It renders from the existing `recorder` samples, so no model changes are needed.
15. **MoE/EP game:** 2D first, 3D optional. Tokens route to experts on N GPUs; the player places experts, sets redundancy, and fights hot-expert stragglers on a skewed trace. This fills T6's zero-interactive gap, and a pure-TS model can be built on the `Engine` patterns.
16. **"Latency as distance" memory-hierarchy flythrough.** Scale distance by ns, with an optional *real* wasm pointer-chase that measures the learner's own machine. Coarse plateaus survive timer clamping when averaged over 10⁷ loads; NEXT-COURSES.md rejects only fine-grained PMU claims.
17. **Incident roguelike (Fleet Week Act 4++).** Procedurally generated incidents from injectable faults on the deterministic engine. The player must *probe* by toggling instruments, which costs "time", and gets a time-to-mitigate score with a seeded daily run. This is shareable via the existing CI leaderboard with zero servers.
18. **Speedruns and daily seeds** (PLAN.md §3.6, unshipped): scheduler, roofline and kernel speedruns on a date-seeded trace, scored locally, with optional PR submission.

**E. Content freshness inside the sims.**
19. KV calc presets are 2023-era: Llama-3 8B/70B and Mixtral 8x7B (`KvCacheSim.tsx:171-175`), on H100, A100, 4090 and T4 (`:184-190`). Add:
    - MLA (DeepSeek-V3/R1, Kimi K2);
    - sliding-window or hybrid attention;
    - FP4 KV;
    - H200, B200, B300 and MI355X-class parts.
    Then link the roofline and Fleet Week HW menus to one hardware table.

**F. Hygiene.**
20. Route-level `React.lazy` code-splitting. Run Fleet Week and Fleet loops in a Worker. Add a wasm execution timeout via a Worker plus `terminate()`. Add live data tables for canvases (`aria-describedby` → a hidden `<table>`), and reduced-motion support in the Fleet.
