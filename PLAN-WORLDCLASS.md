# KERNELSPACE — The World-Class Plan

**Mission (unchanged):** take a Java/Python backend engineer to world-class systems
engineer for LLM serving at mega scale — Rust-native, Zig/C-literate, zero C++.

**Audit date:** 2026-08-11. Hands-on adversarial review (labs, build, e2e) plus a
landscape scan against UW CSE599K, GPU MODE, CS336, 15-445, CS149, MIT 6.5940, and
the 2025–26 practitioner canon. Sources in Appendix A.

**Completion status:** Waves 0–6 shipped on 2026-08-11. Final shape: 68 lessons,
10 Rust Zero drill crates, 8 systems labs, licensed/static trace replay, the
CI-verified opt-in leaderboard, a per-track paper spine, and quarterly Field Notes.
The release gate below remains the source of truth for every subsequent update.

**Starting state:** 55 lessons (T0–T7), 6 forge labs (all gates green), Fleet
(engine/cluster/EPD modes), Fleet Week (4 acts), build+lint clean, e2e smoke green.
PLAN.md's eight big ideas have shipped except: Field Notes feed, contribution
runway, and NEXT.md's unfinished items (real traces, leaderboard).

---

## 0. The verdict in one paragraph

The skeleton is world-class; the *on-ramp* and the *freshness layer* are not. The
course teaches Rust conceptually but grades written Rust from T1 onward — the exact
trap 15-418 self-learners warn about. Prefix caching — the single largest TTFT/cost
lever in production — is absent. And a "40-lesson era" copy layer contradicts the
registry on the public pages. Fix the defects, build the Rust ramp, add the caching
layer, and this is the best resource in the area.

---

## 1. Wave 0 — Defect sweep (confirmed, no design decisions)

Every item below was reproduced by the audit. File:line verified 2026-08-11.

| # | Defect | Location | Fix |
|---|---|---|---|
| 1 | Dead link "test yourself in a quiz" → `/lesson/t2.l8` (doesn't exist) | `src/pages/Glossary.tsx:522` | → `/lesson/t2.l7` (the PagedAttention exam) |
| 2 | Forge lab `toy-executor` links wrong lesson | `src/data/labs.ts:162` (`lessonId: 't3.l5'`) | → `'t3.l4'` (registry: t3.l5 = rust-wasm, t3.l4 = executor; the lab's own `completion.next` already says T3.L4) |
| 3 | T6/T7 completion badge 404s (`/badge-t6.svg`, `/badge-t7.svg` missing) | loaded at `src/pages/Lesson.tsx:391` | author `public/badge-t6.svg`, `public/badge-t7.svg` cloned from `badge-t5.svg` style |
| 4 | `/tracks/capstone` crashes (undefined `TRACK_EXTRAS['capstone']`) | `src/pages/Track.tsx:55,116` | guard: `capstone` → `<Navigate to="/capstone" replace />`; missing extras → NotFound |
| 5 | Footer GitHub link is placeholder `https://github.com` | `src/components/Footer.tsx:14` | → `https://github.com/praveer13/kernelspace` |
| 6 | Mojibake `â¥` where `≥` belongs (double-encoded UTF-8) | `labs/batching-scheduler/src/lib.rs:435` | literal `≥`; re-run `cargo test -p batching-scheduler` + `scripts/pack-labs.py` |
| 7 | Stale copy: "6 tracks / 40 lessons" (truth: 8 / 55) | `Home.tsx:64,441,682`; `Curriculum.tsx:359,407` (hardcoded `/40` → use store `TOTAL_LESSONS`); comments at `lessons/index.ts:3-4,111`, `tracks.ts:147`; `Progress.tsx:249` (`/36` → derive real task count), `Progress.tsx:496` | sweep all |
| 8 | Unreachable achievements: `heap-whisperer` needs 7 T1 lessons (has 6); `kernel-mind` needs 8 T2 lessons (has 7) + reads phantom `t2.l8` | `src/pages/Progress.tsx:122,130` | 7→6; 8→7; `t2.l8`→`t2.l7`. **Only these two** — other thresholds are design questions (§7) |
| 9 | XP promise unpaid: "TASKS EARN XP · +60 XP each" but `recordSimTask` grants 0 | `src/pages/Lab.tsx:874` vs `src/lib/progress.ts:266-274` | grant 60 XP on first completion only (idempotent) |
| 10 | SIMS `usedIn` labels pre-renumbering; three sources, three stories | `src/lib/tracks.ts:167-249` (roofline→T4.L3, wgsl→T4.L5, quantizer→T4.L7, kv-calc→T5.L4, batching→T5.L6, engine→capstone); `src/pages/Lab.tsx:44-50` vs `SIM_INFO` (`lessons/index.ts:277-283`) | update labels; derive Lab.tsx's tag from the single source of truth |
| 11 | Command palette omits Forge / Fleet / Fleet Week | `src/components/CommandPalette.tsx:18-42` | add 3 entries in existing style |

**Wave 0 verification gate:** `bun run lint` (bare, exit 0) → `bun run build` →
`pack-labs.py` + zip audit → Playwright rig smoke (glossary CTA resolves, badges
200, `/tracks/capstone` redirects, palette entries, zero console errors) →
commit + push (deploy is automatic via GH Pages).

---

## 2. Wave 1 — Track R: Rust Zero ⭐ (the answer to "should prereqs be added? yes")

### 2.1 The evidence

- **Audience reality.** The mission targets Java/Python backend engineers. Lab 01
  (`rust-allocator`) attaches to **t1.l3** — at which point the student has seen
  *zero Rust syntax*. t1.l6 is a pitch ("T3 will make you fluent; today is about
  believing it's possible"), and T3 is deliberately conceptual: *"just enough Rust
  to read Dynamo's data plane without flinching."*
- **The labs don't grade reading.** They demand: an address-ordered coalescing
  free list; CAS cursors with Acquire/Release/Relaxed orderings; a `spawn`/`run`/
  `block_on` executor over `Arc<Mutex<VecDeque>>`; the brief jokes about a
  `RefCell already borrowed` panic. Canyon between lesson and forge.
- **External precedent.** Georgia Tech CS3210 runs rustlings as Lab 0; Stanford
  CS140e front-loads TRPL ch. 1–19 before assignment 1; Google's Comprehensive
  Rust exists for exactly this audience; Mara Bos's *Rust Atomics and Locks*
  (free, CC-licensed) is the canonical pre-lock-free text.
- **Family precedent.** tablespace's Tᴿ Rust Zero track solved the identical
  problem for the identical audience. Pattern proven; copy the shape, not the
  content (kernelspace's drills target the forge labs' exact needs).

### 2.2 Design

**Track R — "Rust Zero." 10 lessons, placed before T1** (curriculum start moves:
`R → T0 → T1 …`). Positioning line: *"You already know how to program. This track
teaches you how Rust thinks — just in time for the forge."*

| Lesson | Content | Drill focus (unlocks) |
|---|---|---|
| R1 | Bindings, mutability, scalar types, expressions vs statements | `let`/`let mut`, shadowing, type inference |
| R2 | Functions & control flow: `if`/`loop`/`while`/`for`, first `match` | writing fns, ownership-free logic |
| R3 | Ownership: moves, clones, drops — "a is dead from here" | move-error fixes (compiler-driven) |
| R4 | Borrowing: `&` / `&mut`, one-writer-many-readers, slices | borrow-error fixes, `&[u32]` slicing |
| R5 | Structs, enums, `Option`/`Result`, `?` | modeling a block/sequence struct |
| R6 | Collections & closures: `Vec`, `HashMap`, iterator adapters | map/filter/fold pipelines |
| R7 | Smart pointers: `Box`, `Rc`, `Arc` — when each | refcounted sharing exercises |
| R8 | Interior mutability: `Cell`/`RefCell`/`Mutex` | the `RefCell already borrowed` trap, fixed |
| R9 | Lifetimes in practice: `'a` as a contract — `struct Block<'a> { tokens: &'a [u32] }` (the exact code T3.L1 shows) | lifetime-annotation drills |
| R10 | Atomics & memory orderings: `AtomicUsize`, Relaxed/Acquire/Release; companion reading: Mara Bos ch. 2–3 | CAS counter → spin-lock drill |

**Lab readiness map** (surfaced as a "readiness" chip on each forge page):
- lab 01 allocator ← R1–R5 (Vec, slices, Option)
- lab 02 kv-block-manager ← R5–R7 (HashMap, refcounts, Vec)
- lab 03 bpe-tokenizer ← R5–R6 (String, HashMap, iterators)
- lab 04 mpmc-queue ← **R10 required** (atomics + orderings)
- lab 05 toy-executor ← R7–R8 (Arc/Mutex/RefCell; harness ships the RawWaker)
- lab 06 batching-scheduler ← R5–R6 (VecDeque, HashMap, sort/ordering)

### 2.3 Drill mechanics (no new infrastructure)

- Each R lesson ships a **rustlings-style micro-crate**: 5–8 single-function
  exercises, `todo!()` bodies + a few intentional compile errors, same kslab
  ABI, same zip/upload flow as the forge. Compiler-error-driven drills are the
  perfect fit for the existing grader — rustc *is* the tutor.
- One shared harness (`labs/rust-zero` workspace, one crate per lesson) keeps
  packing trivial: extend `scripts/pack-labs.py`, `src/data/labs.ts` gains a
  `track: 'r'` section, Forge page groups them under Track R.
- Check-ids follow the existing convention; `cargo test` mirrors the browser
  suite 1:1, as with all current labs.
- **Optional v2 (not in this wave):** inline editor with compile server — the
  Appendix-B forge service. Local-first stays the default ($0 architecture).

### 2.4 Exit criteria

A Java/Python student completes R1–R10, then solves lab 01 *without leaving the
course to learn syntax*. Measured: lab 01 median attempts-to-green drops vs
current (instrument via existing progress store).

---

## 3. Wave 2 — The Caching Layer (biggest content gap)

**Grounding:** vLLM Automatic Prefix Caching (default-on in V1); SGLang
RadixAttention → HiCache L1 GPU / L2 host / L3 storage (production: hit rate
40→80%, TTFT −56%, QPS 2×); llm-d prefix-aware scorers (~100% KV hit);
Baseten: 2× from KV-aware routing. Our lab 02 manages blocks but never *shares*
them across requests — the course teaches paging without a page cache.

### 3.1 Lab 07 — `radix-cache` (Rust/WASM, forge)

Built **on top of lab 02's manager API** (imported as the harness's block
allocator), the vLLM-APC / SGLang-RadixAttention arc made executable:

- Radix tree keyed by token-id sequences; nodes hold block-id lists.
- `match_prefix(tokens)` → longest cached prefix (block ids + length).
- `insert(tokens, blocks)` after prefill; **CoW on shared prefixes** (reuse
  lab 02's refcounting — shared nodes are read-only).
- LRU eviction of leaf nodes when the pool is full; evict only refcount-0 nodes.
- Checks (6): exact-match hit; longest-prefix-among-ancestors hit; eviction
  order correctness; block conservation under a 2000-op churn gauntlet; CoW
  divergence (writer can't corrupt a sharer); hit-rate floor on a replayed
  chat-trace (system-prompt-heavy — the workload where APC shines).

### 3.2 Fleet — cache-aware router mode

- Cluster mode gains a third routing policy beside RR/JSQ: **prefix-affinity**
  (route to the worker holding the longest cached prefix, subject to a load
  guard — pure cache affinity herds, llm-d's scorers balance both).
- Scoreboard adds **KV hit rate** and TTFT-SLO attainment; shared trace with
  realistic system-prompt sharing so the policy difference is measurable.
- Lesson wiring: new T5 lesson *"Prefix caching: the free lunch"* (APC,
  RadixAttention, HiCache tiers, side-channel teaser → Wave 6), slotted after
  `pagedattention-deep-dive`; T6.L3 gains a router paragraph.

---

## 4. Wave 3 — Measure First (performance engineering as a graded skill)

**Grounding:** CSE599K opens with roofline/performance-modeling; CS336 A2 is
"profile and benchmark, *then* write the kernel"; CS149 Assignment 1 is a graded
analysis write-up. We teach architecture but not the discipline of measurement.

- **Roofline practice** (extends t4.l3, doesn't replace it): given the Fleet
  engine's kernel table, compute arithmetic intensity, place each kernel on the
  B200 roofline, classify compute- vs memory-bound — graded numeric checks in a
  sim, not prose.
- **Instrument-your-engine artifact:** the Fleet gains an OTel-GenAI-semconv-
  named metrics surface (TTFT, TPOT, queue delay, KV hit rate, goodput,
  $/Mtok). Fleet Week Act I/II submissions require the dashboard screenshot +
  a ≤150-word analysis, rubric-graded like Act III's design doc.
- **The flame-graph lesson (t0.l6) gains teeth:** later labs' completion panel
  links the "profile this" guidance; incident drills (Act IV) explicitly
  reference the metrics surface as the diagnosis tool.

---

## 5. Wave 4 — Real Traces + Zero-Server Leaderboard (finish NEXT.md's items)

Both are already designed in NEXT.md; this wave is execution, using the
patterns proven in tablespace.

- **Traces:** `public/traces/` gains an LMSYS-Chat-1M slice and a BurstGPT
  slice (license-checked, downsampled deterministically, documented in
  `traces/README.md`). Lab 06 and the Fleet load them alongside synthetic
  traces; thresholds recalibrated per trace (calibration numbers recorded in
  the lab README, as with existing labs).
- **Leaderboard (zero-server, CI-verified):** PR with
  `submissions/<user>.{wasm,json}` → validate workflow (re-runs the wasm
  against the harness, verifies the JSON matches) → publish commits to
  `public/leaderboard.json` → `/leaderboard` page renders after next deploy.
  Ranked on goodput-under-SLO (lab 06) and Fleet goodput; personal-best
  localStorage stays the default view — the leaderboard is opt-in.
  (2026-08 decision reaffirmed: no always-on server.)

---

## 6. Waves 5–6 — The Agent Era + The Spine

**Wave 5a — Lab 08 `xgrammar-lite` (structured output).** Compile a JSON
schema → pushdown automaton → **token-mask** over the student's own lab-03 BPE
tokenizer (token masks ≠ string masks is the lesson), with a grammar compile
cache. Checks: valid-JSON acceptance, invalid rejection at the earliest token,
µs-level mask overhead, cache-hit reuse. Grounding: XGrammar default in
vLLM/SGLang/TRT-LLM; XGrammar-2 for agentic tool-calling.

**Wave 5b — Multi-LoRA lesson (+ optional lab-02 extension).** S-LoRA unified
paging (adapter weights as paged objects alongside KV blocks), Punica SGMV
batching, vLLM heterogeneous-LoRA batching. Lesson in T6; extension check in
lab 02 marked optional-advanced.

**Wave 6a — Paper spine.** Per-track reading boxes (existing `field-note`
block type from PLAN.md §4): Orca, vLLM/PagedAttention, SGLang/RadixAttention,
DistServe, Sarathi-Serve, Splitwise, Mooncake (FAST'25), S-LoRA, plus the
DeepSeek open-infra index. One-paragraph "why this paper" per box; no new
mechanics.

**Wave 6b — Security lesson (T6).** Agent sandboxing (Firecracker microVMs,
~150 ms cold start, E2B pattern), confidential GPU inference (H100 TEE,
4–8% throughput overhead measured), prefix-cache side channels (timing the
cache you're sharing). One lesson, survey depth, links out.

**Wave 6c — Field Notes + verified badges** (PLAN.md §3.8, still deferred):
quarterly static JSON feed; "last verified YYYY-MM" badges on all
landscape-sensitive lessons (T5.L8/L9, T6, T7, and the new caching lesson).

---

## 7. Resolved design decisions (2026-08-11)

1. **Achievement thresholds:** the early thresholds remain intentional warm-up
   achievements and say so. Separate `track-*` cards require 100% completion.
2. **Achievement coverage:** T6/T7 and every other track now have catalog cards;
   `forge-first` and `fleet-week` are visible; unreachable `polyglot` was removed.
3. **Capstone prerequisite:** one story everywhere — **unlocks after T5; best
   after T7**.
4. **Placement:** the check now spans T0–T7 with roofline, wide-EP, and goodput
   questions for advanced entry recommendations.
5. **Quantization hands-on:** no duplicate Forge crate. The existing Quantizer is
   the graded hook: calibrate per-tensor vs group-128, inject a salient outlier,
   then rescue distribution drift in an explicit AWQ-style challenge.

---

## 8. Curriculum map — before → after

| Track | Today | After |
|---|---|---|
| **R Rust Zero** | — | **10 lessons + micro-drill crates (Wave 1)** |
| T0–T4 | unchanged spine | readiness chips → R lessons; roofline practice (W3) |
| T5 | 9 lessons | + prefix-caching lesson + lab 07 (W2); traces (W4) |
| T6 | 8 lessons | **10 lessons:** + multi-LoRA (W5b), security (W6b) |
| T7 | 5 lessons | + instrument-your-engine artifact (W3) |
| Forge | 6 labs | + radix-cache (07), xgrammar-lite (08), 10 R drill sets |
| Fleet | engine/cluster/EPD | + prefix-affinity router, KV-hit scoreboard (W2) |
| Fleet Week | 4 acts | + metrics-dashboard requirement (W3) |
| Standing | — | leaderboard (W4), paper spine + Field Notes (W6) |
| Defects | 11 confirmed | Wave 0 sweep |

---

## 9. Success metrics

- A graduate can: write the Rust every lab demands *without leaving the course*;
  build paged KV + prefix caching + continuous batching from scratch; route a
  fleet cache-aware; defend every choice with a measured number.
- Every forge lab has a named R-track readiness path; lab 01 attempts-to-green
  measurably drops.
- Landscape-sensitive lessons carry verified-badges ≤ 6 months old (W6c).
- Portfolio per graduate: ≥8 artifacts (6 labs + radix/xgrammar + dashboard +
  design doc).

---

## 10. Standing build & verification conventions (unchanged, apply to all waves)

- Template crate compiles clean, traps as "not implemented" (`todo!()`);
  solution `cargo test` N/N green; template N red. Check ids match
  `src/data/labs.ts` verbatim. `bun scripts/verify-wasm-lab.ts <wasm>
  expect-pass|expect-trap`. `python3 scripts/pack-labs.py` ships templates
  only — audit every zip for `_solutions`/`target/` leakage.
- `bun run lint` bare (never piped — masks exit codes) before every commit.
- Playwright rig at `/tmp/pw` (node at `/tmp/node/bin`) against `vite preview`
  for every shipped wave; kill preview servers by exact PID.
- No public leaderboards or always-on servers (2026-08 decision, reaffirmed).

---

## Appendix A — Sources (2026-08-11 verification)

**Courses & mechanics**
- UW CSE599K LLM Serving Systems: courses.cs.washington.edu/courses/cse599k/25sp
  (topic list: roofline, memory mgmt, sparsity, collectives, scheduling; specs
  not public); 24au calendar (FlashAttention, DistServe, SarathiServe, vLLM, MoE)
- GPU MODE: github.com/gpu-mode/lectures (100+), KernelBot paper (ICML'25
  CODEML), reference-kernels, per-GPU-arch leaderboards, ~400K submissions;
  hosts Stanford CS149 Asst 5 kernels; Decart job posts cite submissions
- Stanford CS336 spring2025: 5 assignments, public leaderboards, A2 =
  profile + FlashAttention2 in Triton
- CMU 15-445 (BusTub: one persistent codebase, autograder, Discord);
  15-418/CS149 (Asst 1 = measure-and-explain write-ups)
- MIT 6.5940 (Han lab): Lab4 AWQ-style LLM compression, Lab5 TinyChat deployment
- CMU 15-779 slides (Batching/PagedAttention/RadixAttention); CMU 11-868 LLM Systems
- Rust ramps: rustlings-as-lab-0 (GT CS3210), CS140e TRPL-first sequencing,
  google/comprehensive-rust, mara.nl/atomics (Mara Bos, free)

**Practitioner canon (2025–26)**
- vLLM Automatic Prefix Caching (default-on V1); SGLang HiCache best practices
  (hit 40→80%, TTFT −56%; Alibaba production report)
- llm-d v0.3 prefix-aware scorers (~100% KV hit); Baseten 2× via Dynamo KV-aware
  routing; NVIDIA Dynamo v1.3 (NIXL, KVBM, SLO planner)
- XGrammar (default structured-output backend; XGrammar-2 agentic tool-calling)
- S-LoRA (arXiv 2311.03285) + Punica SGMV; vLLM multi-LoRA batching
- LMCache KV tiering (arXiv 2510.09665 — offload-vs-recompute crossover)
- SemiAnalysis InferenceMAX → InferenceX (tok/s/GPU, $/Mtok, tok/MW Pareto)
- OTel GenAI semantic conventions (opentelemetry.io/blog/2026/genai-observability)
- Firecracker microVM agent sandboxes (~150 ms cold start); NVIDIA TEE
  confidential inference (4–8% overhead, ETH SPCL); PrefixWall side channels
- Microsoft Vidur (MLSys'24) — prior art validating the Fleet sim approach
- LMSYS-Chat-1M — the standard public production trace
