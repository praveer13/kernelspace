# Exemplar learning platforms & mechanics worth stealing (2024–2026) — kernelspace dossier

Researched 2026-10-03. Scope: mechanics from ~30 platforms/courses, each mapped to a concrete kernelspace surface (block type, page, sim, lab, file). Repo read-only. Items I could not open at a primary source are marked **[unverified]**.

---

## 1. Executive summary

The strongest exemplars share three mechanics kernelspace lacks: **(a) a knowledge graph that drives review** (Math Academy's prerequisite + "encompassing" graph with Fractional Implicit Repetition; Execute Program's *executable* spaced reviews), **(b) staged, verifiable work with performance tiers** (CodeCrafters stages, Gossip Glomers efficiency targets, Sasha Rush puzzles with memory-traffic scoring), and **(c) mastery signals rather than rank signals** (pwn.college found belts beat leaderboards at scale; 50k+ learners). Evidence on AI tutors cuts both ways. A tutor built around step-by-step solutions produced 0.73–1.3 SD gains in a Harvard RCT (0.63 SD by linear model; measured on immediate post-tests only, with no delayed-retention test) [fixed]. Unguarded GPT access left students 17% *worse* once it was removed (PNAS 2025).

Kernelspace already does well on the "real stakes" layer: Forge, Fleet, CI leaderboard and real traces. It is weakest on **retention**. There is no review loop and no prerequisite graph. XP is flat per item, not tied to effort. The quizzes are gameable: confirmed **230/266 correct answers at index 1**, and none at index 3, even though all 266 questions have four options. The correct option is also the longest (or tied-longest) in 252/266 (94.7%). The placement check in `Curriculum.tsx` has the same skew (7 of 8 answers at index 1). The quick wins are retrieval-practice infrastructure and quiz integrity, which are small, zero-server, high-impact changes. Only three of the mechanics studied truly need a server: hosted browser environments (pwn.college DOJO), live AI-generated-and-validated practice (Boot.dev Training Grounds), and instant GPU benchmarking (KernelBot/Tensara/LeetGPU).

---

## 2. Findings (claim → evidence → boundary → implication)

### 2.1 Retention & sequencing engines

**F1. Math Academy: hierarchical spaced repetition ("FIRe") cuts review load by giving implicit credit through an "encompassing" graph.**
- *Evidence:* FIRe tracks a per-topic repetition number, `repNum → max(0, repNum + speed·decay^failed·rawDelta)`, with memory decaying as `0.5^(days/interval)`. Credit from advanced topics "trickles down" encompassing edges at fractional weights. Failures on prerequisites penalize dependants upward. The scheduler picks tasks whose implicit reps "knock out" other due reviews. Speed is calibrated per student per topic (justinmath.com, 2023-10-05). Math Academy uses two graphs: prerequisites (forward, mastery learning) and encompassings (backward credit) (mathacademy.com/how-our-ai-works). The graph spans "multiple thousands" of topics. The adaptive diagnostic cuts question count "by an order of magnitude" vs. assessing every topic.
- *Boundary:* Math Academy publishes **no outcome numbers** on these pages. The evidence is mechanism plus the general spacing/retrieval literature. Math is unusually hierarchical. Kernelspace is too (cache → allocator → KV block manager → PagedAttention → disaggregation).
- *Implication:* Add `requires: LessonId[]` and `encompasses: {id, w}[]` to `Lesson` in `src/data/lessons/types.ts`. Today there is no prerequisite field at all. Passing lab `kv-block-manager` or Fleet Week Act I should then grant fractional review credit to T1/T2/T5 lessons. That makes the Forge and Fleet the *review* mechanism, not just capstones.

**F2. Math Academy: 1 XP ≈ 1 minute of focused effort; ~50–60 XP/day is the sustainable maximum.**
- *Evidence:* "1 XP … equivalent to 1 minute of fully-focused work for an average serious but imperfect student"; "maximum sustainable XP rate is around 50-60 XP/day" (justinmath.com, 2024-07-26). XP depends on performance, with bonuses for perfect scores (mathacademy.com/how-it-works).
- *Boundary:* This is a calibration convention, not an experimental result. Its value is that it is honest: XP becomes a time budget the learner can plan around.
- *Implication:* `XP` in `src/lib/progress.ts` is flat: lesson 100, quiz 40, lab 200, Fleet Week act 250. That is unrelated to `Lesson.minutes`, and reading earns more than retrieval. Recalibrate to minutes of *demonstrated* work. Make quiz/review XP performance-scaled, add a daily goal (e.g. 45 XP ≈ 45 focused minutes), and re-base RANKS thresholds accordingly.

**F3. Execute Program: spaced repetition where every review prompt is executed code.**
- *Evidence:* Reviews "answer … prompts by executing a program". Missed answers don't penalize unless the learner gives up. Lessons assume solid recall of earlier ones. Progress mechanics favor new lessons over longer recall intervals (Andy Matuschak notes, notes.andymatuschak.org/Execute_Program). Reported intervals are 2 days → 1 week → 3 weeks → 2 months **[unverified, secondary summary]**.
- *Boundary:* No published efficacy data. Courses are limited to JS/TS/SQL/regex.
- *Implication:* Kernelspace reviews should be *executable*: re-run a short simulator task (e.g. a 2-item checklist from `layoutLab.tasks.ts`), predict a number on the roofline, or recompute a KV-cache size. Most of this already exists as `*.tasks.ts` checklists. A `/review` page can draw from them.

**F4. FSRS is the open state of the art for item-level scheduling and ships as MIT TypeScript and Rust libraries.**
- *Evidence:* srs-benchmark on 9,999 Anki collections / ~350M reviews. Log loss: FSRS-7 0.3401, FSRS-6 0.3460, FSRS-5 0.3561. FSRS-7 has 34 params, FSRS-6 has 21 and FSRS-5 has 19. The best FSRS-7 variant ("recency") scores 0.3370. RWKV-Instant is better (0.2773) but has 2.76M params (github.com/open-spaced-repetition/srs-benchmark, read 2026-10). `ts-fsrs` (MIT, FSRS-6, browser/ESM) and `fsrs-rs` exist. Anki has shipped FSRS since 23.10. Users get "fewer reviews … to achieve the same retention" (faqs.ankiweb.net). The common "FSRS cuts reviews 25% vs SM-2" figure comes from secondary sources **[unverified]**.
- *Boundary:* FSRS models *independent flashcards*. It is wrong for hierarchical skills without FIRe-style implicit credit (F1). Optimizing parameters needs hundreds of reviews per user, so early on the defaults dominate.
- *Implication:* Use `ts-fsrs` with default params as the per-item memory model inside a local review queue. Layer F1's encompassing credit on top. Everything persists in the zustand store, and JSON export/import already round-trips. Zero-server.

**F5. Duolingo Birdbrain: IRT/Elo-style ability × difficulty model picks exercises at a target difficulty.**
- *Evidence:* V1 (2020) used logistic regression inspired by item response theory (learner ability vs. exercise difficulty), updated per exercise by SGD as "a generalization of the Elo chess rating system". V2 (May 2022) is an LSTM that compresses history into a 40-dim vector. The session generator targets an optimal difficulty zone (IEEE Spectrum, Bicknell/Brust/Settles). Half-life regression reduced recall-prediction error by 45%+ vs. baselines (Settles & Meeder, ACL 2016).
- *Boundary:* Needs population data to fit item difficulty. A local-first app has one learner's data. Item difficulties would have to be pre-calibrated by the maintainer, or estimated from opt-in exported progress files.
- *Implication:* An Elo-lite is enough. Tag each quiz item with a hand-set difficulty, keep a per-track ability score in localStorage, and use it to (a) turn the 8-question placement in `src/pages/Curriculum.tsx` into an adaptive diagnostic and (b) order the review queue.

### 2.2 Staged, verifiable building

**F6. CodeCrafters: "build your own X" as a sequence of tiny stages, each gated by a remote tester on `git push`.**
- *Evidence:* "For each stage we'll run tests … The tests will initially fail, and then you'll submit code to make those tests pass." Stage 1 is often just uncommenting starter code and pushing. Instructions are tailored per language (docs.codecrafters.io).
- *Boundary:* Testing is server-side. Kernelspace's local `cargo test` + in-browser wasm check already does the same job without a server.
- *Implication:* Forge labs currently expose **six checks all at once** (`labs/AGENTS.md`). Restructure each into ordered stages (`cargo test stage_1`…), with the lab page in `src/pages/ForgeLab.tsx` showing stage N unlocked only after N−1. Make stage 1 a 2-minute "hello wasm" win. This is the biggest friction point for professionals bouncing off a local toolchain.

**F7. Fly.io Gossip Glomers: correctness first, then the *same* problem under performance budgets with injected faults.**
- *Evidence:* Six challenges on Maelstrom (built on Jepsen), which routes messages, injects failures and checks consistency (fly.io/dist-sys). Challenge 3d adds 100 ms per-message latency and requires msgs-per-op < 30, median latency < 400 ms, max < 600 ms (fly.io/dist-sys/3d). 3e tightens the trade-off.
- *Boundary:* Targets must be calibrated against baselines, which the kernelspace convention already does ("thresholds proven against baselines").
- *Implication:* Give every Forge lab and Fleet scenario a **correct → efficient → under-fault** tier ladder. For example, batching-scheduler must first pass, then hit goodput ≥ X with p99 TTFT ≤ Y on the BurstGPT slice, then survive node death. Tiers become belt requirements (F10).

**F8. Sasha Rush's puzzles: tiny, visual, *scored on memory traffic*, runnable free in Colab.** [fixed]
- *Evidence:* GPU-Puzzles has 14 puzzles (Map → Matrix Multiply) in Numba-CUDA. Each shows memory-access diagrams and scores global and shared reads/writes per thread. The repo recommends running in Colab with the GPU runtime enabled. It does not document a CPU path. Numba's generic CUDA simulator could serve as one, but the repo does not use or mention it (github.com/srush/GPU-Puzzles; README, lib.py and notebook checked) [fixed]. Sibling sets: Tensor Puzzles and LLM-Training-Puzzles (8 multi-GPU training puzzles on memory efficiency and pipelining).
- *Boundary:* Puzzles teach primitives, not systems judgment. They are a ramp, not a capstone.
- *Implication:* Ship "Serving Puzzles": 12–16 one-screen puzzles in the existing WGSL playground (`WgslSim.tsx`) and block-table/scheduler labs. Score them on bytes moved / blocks wasted / tokens recomputed, not just correctness. A natural `exercise` block variant.

**F9. Nand2Tetris and Turing Complete: build a whole machine from one primitive, layer by layer; every layer is used by the next.**
- *Evidence:* Nand2Tetris materials are used at "400+ universities, high schools, and bootcamps" (nand2tetris.org). Turing Complete (Early Access since 2021-10-02) has 70+ levels from NAND to a CPU with a custom assembly language. It holds 94% positive of 3,023 Steam reviews (store.steampowered.com/app/1444480).
- *Boundary:* Neither publishes learning outcomes. The evidence is popularity and longevity. Turing Complete works because each level's *output* is a reusable component in the next, not because of 3D.
- *Implication:* Kernelspace already has the "student components plug into the Fleet" spine. Make it *visible as a build*. A persistent "Your Engine" schematic on `/fleet` and `/progress` shows which components are the student's wasm and which are still the JS reference, with each lab swapping a grey box for theirs. This is the game loop. A 3D rack view (R3F is already a dependency) is optional polish, not the pedagogy.

### 2.3 Motivation: mastery signals, streaks, competition

**F10. pwn.college: belts beat leaderboards at scale; volunteer mentors were the most helpful community members.** [fixed]
- *Evidence:* "Open Cybersecurity Education: Five Years of pwn.college" (SIGCSE 2026, pp. 743–749) reports 50,000+ learners solving ≥1 challenge (as of Nov 2025). 13,500+ were retained 90+ days and 3,833 retained 365+ days. Belts "encouraged sustained, self-directed mastery". Global leaderboards "quickly stabilized", so position became "a reflection of timing and historical participation rather than ongoing learning" (paraphrased earlier as "lose meaning at scale", which is not a quote) [fixed]. On volunteer "HANTO" mentors: "across nearly every semester … the single most helpful Discord member was a volunteer from the broader community". The paper does not say they became the *primary* support channel [fixed]. Archived help threads enable shortcut-seeking ("digital archaeology"). Required-course students needed "frequent, lightweight incentives", while intrinsic learners respond to long-horizon mastery signals (adamdoupe.com PDF). Dojos are git repos + YAML. The companion Linux Luminarium paper won SIGCSE 2026 Best Paper.
- *Boundary:* These are observational, single-platform findings, not RCTs.
- *Implication:* Kernelspace's RING 3 → ROOT ranks are XP totals, which reward reading volume. Add **belts** (white → black) awarded only for *verified* artifacts: lab tiers (F7), Fleet Week acts, and a review-retention threshold. Belts can be verified through the existing CI leaderboard PR flow (`validate-leaderboard-submission.yml`). Make the leaderboard secondary to belts.

**F11. Duolingo streaks: big engagement effects, but engagement ≠ learning.**
- *Evidence:* Decoupling the daily goal from the streak gave +3.3% D14 retention, +1% DAU and +10.5% daily learners on a streak. Learners at a 7-day streak were 2.4× more likely to return next day (blog.duolingo.com, 2020-11-19). Streak Wager gave +14% D7 retention (this figure is from the 2017-05-10 post, not the 2020 one) [fixed]. The "Weekend Amulet" (a sanctioned break) made learners 4% more likely to return a week later and 5% less likely to lose their streak. Binge learners were "much more likely to abandon" (blog.duolingo.com, 2017-05-10).
- *Boundary:* Every metric is retention/DAU, not learning. Streak loss-aversion can drive low-effort "streak-saving" sessions.
- *Implication:* `streakDays` in `progress.ts` currently counts *any* activity, so opening a lesson counts. Count a streak day only when the daily retrieval goal is met (reviews due cleared or N XP of graded work). Add a weekly "maintenance day" freeze, which Duolingo's own data supports, and a weekly mode for professionals who study 3×/week.

**F12. modded-nanogpt speedrun: a public record log with statistical rules turned a benchmark into a research community.**
- *Evidence:* The record fell from the 45-minute llm.c baseline to **0.665 min (~40 s), record #92, 2026-08-30**, on 8×H100 to 3.28 FineWeb val loss. Records need p<0.01 that mean val loss ≤ 3.28, plus full source in run logs via PR (github.com/KellerJordan/modded-nanogpt). Karpathy's nanochat runs a similar "time to GPT-2 CORE" leaderboard, with best 1.65 h as of 2026-03-14 (github.com/karpathy/nanochat).
- *Boundary:* Speedruns attract experts. Novices need a separate ladder or they disengage.
- *Implication:* The CI leaderboard exists. Add a **records history** (each record = PR + write-up of *what changed*), multi-seed significance rules on Fleet traces, and a "Fleet goodput speedrun" track. The write-ups become a curated learning corpus ("the record log is the curriculum").

**F13. Competitive kernel platforms need anti-cheat, and agents now cheat.**
- *Evidence:* KernelBot (CODEML workshop at ICML 2025, not the main track) [fixed] had 25k+ submissions in its first two competitions after its March 2025 launch. All submissions are open-sourced after each competition. The abstract says top kernels "had real impact and success on two popular hardware vendors, NVIDIA and AMD", not that they were "adopted by" them [fixed] (icml.cc/virtual/2025/48171). KernelGuard (a workshop poster at ICML 2026's "Agents in the Wild" workshop, not a main-track paper) [fixed] found **3.45% of 141,800 submissions were hacks** (4,889, e.g. timer manipulation). The rate was 0.37% (152 of 40,998) on later submissions after its static rules, physics-floor checks and LLM judge were deployed. This is a before/after comparison on different submission sets, not a controlled comparison (icml.cc/virtual/2026/67922). KernelBench (ICML 2025): frontier models matched the PyTorch baseline in <20% of cases at launch (arXiv 2502.10517).
- *Implication:* Add **physics-floor checks** to `validate-leaderboard-submission.yml`: goodput cannot exceed the roofline/bandwidth bound, and TTFT cannot be below prefill FLOPs ÷ peak. Also open-source top submissions after each season (KernelBot norm).

**F14. Advent of Code removed its global leaderboard in 2025.**
- *Evidence:* 2025 runs Dec 1 to mid-December (fewer days). The global leaderboard was "one of the largest sources of stress", with abuse and DDoS. Private leaderboards remain, and AI use is discouraged: "If you send a friend to the gym on your behalf…" (adventofcode.com/2025/about).
- *Implication:* A seasonal event ("Fleet Week Live", tied to quarterly Field Notes) should use **private, file-based leaderboards** (a team JSON in a gist/repo), not a global race.

### 2.4 Tutoring & AI-native education

**F15. Structured AI tutors can double gains; unguarded ones harm learning.**
- *Evidence:* Kestin et al., *Scientific Reports* 2025-06-03 (Harvard PS2, n=194, crossover RCT): 0.63 SD by linear model, **0.73–1.3 SD** by quantile regression. Median 49 min vs 60 min in class. The tutor prompt embedded pre-written step-by-step solutions and scaffolded multi-part problems (PMC12179260). Caveats: 194 of 233 enrolled students were eligible, and eligibility *required* taking part in both conditions. The earlier "only 63% did both conditions" is not in the paper [fixed]. All outcomes are immediate post-tests, with no delayed retention test. Bastani et al., *PNAS* 122(26) 2025 (~1,000 students in grades 9–11 at a high school in Turkey, Fall 2023) [fixed]: GPT Base improved practice grades 48%, but **−17% on exams once access was removed**. A guardrailed "GPT Tutor" (+127% in practice) "largely mitigated" the harm. Its exam effect was ≈0 (−0.004), meaning no harm but also no gain (PMC12232635; ssrn 4895486).
- *Implication:* Kernelspace's "never write the solution" lab `AGENTS.md` is the right guardrail. Strengthen it with Kestin's ingredient: per-check *solution-step outlines* the tutor may reveal one rung at a time (a hint ladder). Ship them in the zip as `HINTS.md` with collapsible rungs, accepting that a determined student can read them.

**F16. In-situ AI tutor logs: *how* students talk to the tutor predicts completion.**
- *Evidence:* pwn.college SENSAI (SIGCSE 2025) reads the learner's live terminal and files as context. It served 2,742 users, 178,074 messages and 15,413 sessions for **$1,979 total** (sigcse2025 page). Tompkins et al. (arXiv 2602.17448; n=309, 142,526 queries, 383 challenges) found Short/Reactive/Proactive conversation styles that correlate significantly with completion. The gap widens on advanced material, where tutor utility declined.
- *Implication:* Teach *how to use the tutor* as a skill. Add a 2-minute "asking good questions" card to Rust Zero, and give `AgentActions.tsx` deep links pre-filled with context (failing check message, sim state JSON) plus a "state your hypothesis first" template that pushes the proactive style.

**F17. Claude Code's "Learning" output style is a native match for kernelspace's TODO(you) labs.**
- *Evidence:* Built-in Learning style: Claude leaves design-decision code for the human, marked `TODO(human)`, with Context/Your Task/Guidance. Custom output styles are Markdown files in `.claude/output-styles/` (code.claude.com/docs/en/output-styles, read 2026-10).
- *Boundary:* The docs say an output style "doesn't guarantee that something always happens or never happens". For must-happen behavior they point to hooks. Custom styles also drop Claude Code's software-engineering instructions unless `keep-coding-instructions: true` is set. Styles do not apply to non-fork subagents.
- *Implication:* Ship `.claude/output-styles/kernelspace-tutor.md` (plus `"outputStyle"` in `.claude/settings.json`; the value is case-sensitive) inside every lab zip. This *steers* the session toward Socratic behavior, which is stronger than CLAUDE.md alone, but it does not enforce it [fixed]. Zero-server, a one-afternoon change.

**F18. Boot.dev Training Grounds: AI-generated, server-validated, spaced practice. The newest "AI-native" mechanic, and it needs a server.**
- *Evidence:* Launched 2025-08-27. It picks topic, difficulty and type from progress, struggle areas and spaced-repetition timing. It generates a new challenge from hand-written exemplars with frontier LLMs ("GPT5/Claude Sonnet 4 at time of writing") and runs it on Boot.dev's backend to check that it is valid and has a correct solution. The ~45 s figure is how long generation takes, not validation alone [fixed]. The post admits occasional "AI-slop" challenges. Base curriculum: 2,500 hand-crafted lessons (boot.dev/blog/news/training-grounds-launch). Boot.dev's tutor "Boots" is Socratic.
- *Implication:* Steal the *selection* logic, which is local. Replace LLM generation with **seeded parametric generators** for numeric items (KV bytes = 2·L·H·d·bytes·tokens; roofline AI; $/Mtok). Those are infinite, correct by construction and zero-server. LLM-generated items are a BYOK or needs-server option.

**F19. Google "Learn Your Way" (2025-09-16): multi-representation, personalized textbook gave +11 pp delayed retention.**
- *Evidence:* RCT, n=60, ages 15–18. Retention 3–5 days later was 78% vs 67% for a PDF reader (research.google/blog). Small sample, teen readers, and the novelty effect is uncontrolled.
- *Implication:* Weak but suggestive support for kernelspace's multiple representations (prose + step-through diagram + sim + isomorphism). Don't build personalization of prose. Its effect is not separable from the quiz/representation effects here.

**F20. Other AI-native signals (2025–2026).**
MIT Missing Semester returned in Jan 2026 with an "Agentic Coding" lecture, and AI tools were folded into every lecture (missing.csail.mit.edu). Brilliant pretests before teaching ("We don't teach how to do something before asking questions") and runs a Socratic AI tutor "Koji". Its About page publishes no efficacy data (brilliant.org/about). Eureka Labs/LLM101n still has no launch date per available reporting **[unverified for 2026 status]**. The nanochat README no longer references Eureka Labs. ChatGPT Study Mode (mid-2025) and Duolingo's 2025 generative-AI course expansion (148 courses) are **[unverified — primary pages unreachable]**.
- *Implication:* Brilliant's **pretest-first** move is cheap. Open each lesson with a 1–2 question prediction ("guess the p99 when batch doubles") before the prose. This is the existing quiz block placed first, ungraded.

### 2.5 Reference-grade content & from-scratch courses

**F21. "How to Scale Your Model" (DeepMind, 2025-02-04) and the HF Ultra-Scale Playbook set the content bar: worked problems + interactive calculators backed by experiments.**
- *Evidence:* 12 chapters on roofline, sharding, transformer math, inference/serving, profiling, and a GPU chapter added later. Problems end each chapter with collapsible answers (jax-ml.github.io/scaling-book). The Ultra-Scale Playbook builds on 4,000+ scaling experiments on up to 512 GPUs, with interactive widgets like a memory-breakdown calculator (InfoQ 2025-03; hf space).
- *Implication:* Add a **`problem` block** (numeric answer with tolerance, units, worked solution) and a **`calculator` block** (KV-cache sizing, parallelism planner, $/Mtok). Wire both into the review queue. These are the highest-signal retrieval items for this audience.

**F22. Stanford CS336: minimal scaffolding, from-scratch, leaderboards on three of five assignments.**
- *Evidence:* A1 builds tokenizer + transformer + optimizer (leaderboard). A2 profiles and writes FlashAttention2 in Triton plus distributed training (leaderboard). A3 covers scaling laws, A4 data (leaderboard), A5 SFT/RL. Students are told to debug on CPU, then use H100s at ~$2–3/h (cs336.stanford.edu/spring2025).
- *Boundary:* Stanford students with 5 units of time. Kernelspace's audience is working professionals, so heavier scaffolding early is appropriate (expertise reversal), fading later.
- *Implication:* Add a **fading-scaffold** policy to Forge. Early labs have one TODO function. Late labs (radix-cache, xgrammar-lite) get a "hard mode" zip with only the trait signature and tests.

**F23. Rust learning resources: small compiler-driven exercises win the on-ramp.**
- *Evidence:* Rustlings is an official Rust project ("small exercises to get you used to reading and writing Rust"), supports community exercises, and is installed via cargo with `rustlings init` (rustlings.rust-lang.org). Mainmatter's "100 Exercises to Learn Rust" has ~100 incremental exercises and follow-on courses (PyO3, testing, telemetry) (rust-exercises.com). Google's Comprehensive Rust is 4 days of fundamentals plus deep dives (Android, Chromium, bare-metal, concurrency), with speaker notes for classroom delivery and 9+ translations [unverified count] (google.github.io/comprehensive-rust).
- *Implication:* Rust Zero's 10 drill crates are the right shape. Steal (a) Rustlings' *watch mode* via `cargo watch`-style instructions in the drill README, (b) Comprehensive Rust's *speaker notes*, i.e. a "teach this" mode for study groups, and (c) Mainmatter's PyO3 angle: one optional lab exposing the student's Rust block manager to Python. This speaks directly to the Java/Python audience.

**F24. Community & cohort formats.**
Recurse Center's self-directives: "work at the edge of your abilities", "build your volitional muscles", "learn generously" (recurse.com/self-directives). Exercism: free, not-for-profit, 83 languages, volunteer mentoring with reputation (exercism.org/about, /mentoring). Public mentor counts **[unverified]**. Self-paced MOOC completion is famously low, ~3% of enrollees in HarvardX/MITx 2017–18 (Reich & Ruipérez-Valiente, "The MOOC pivot", *Science* 363, 2019-01-11, doi:10.1126/science.aav7958; the citation is confirmed via Crossref) **[unverified — the figure is still paywalled]**. Cohort platforms (e.g. Maven) claim much higher completion **[unverified]**.
- *Implication:* Kernelspace can run **zero-server cohorts**. A dated cohort file (`public/cohorts/2027-q1.json`) gives start date and weekly milestones. A GitHub Discussions category serves as the async room. Weekly "office hours" can be recorded YouTube walkthroughs of record PRs. GitHub Discussions is a third-party host, not a kernelspace server.

---

## 3. Steal-list ranked by expected learning impact ÷ build effort

Impact: H/M/L on durable skill. Effort: S (≤2 days agent-assisted), M (≤1–2 weeks), L (>2 weeks). Zero-server tag per brief.

| # | Idea (source) | What to build in kernelspace | Impact | Effort | Zero-server |
|---|---|---|---|---|---|
| 1 | **Quiz integrity** (defect + Brilliant pretest) | Seeded shuffle of options at render in `QuizBlock.tsx`. CI lint failing if any lesson's correct-index distribution is skewed or the correct option is the longest > 60% of the time. Rewrite distractors to equal length. Add confidence rating ("sure / guess"). | H (the current quizzes don't measure learning) | S | yes |
| 2 | **Lab tutor output style** (Claude Code Learning style, Kestin, Bastani) | `.claude/output-styles/kernelspace-tutor.md` + settings in every lab zip. `HINTS.md` per check as graded rungs. "State your hypothesis" deep-link template in `AgentActions.tsx`. | H | S | yes |
| 3 | **`problem` + parametric generators** (Scaling Book, Training Grounds) | New block: numeric answer ± tolerance, units, worked solution, seeded variants (KV bytes, AI, TTFT floor, $/Mtok). Generators in `src/lib/problems/*.ts`. | H | S–M | yes |
| 4 | **Executable review queue** (Execute Program + FSRS) | `/review` page. Items = problem variants, 2-task sim mini-checklists, quiz items. `ts-fsrs` per item. Due counts on Home. Review-first daily goal. | H | M | yes |
| 5 | **Prereq + encompassing graph, FIRe-lite** (Math Academy) | `requires` / `encompasses` on `Lesson`. Lab/Fleet passes grant fractional credit to encompassed lessons. Failures flag prerequisites for review. Curriculum page renders the graph. | H | M | yes |
| 6 | **Staged labs** (CodeCrafters) | Split six checks into ordered stages with `cargo test stage_N`. `ForgeLab.tsx` shows a stage ladder. Stage 1 is a 2-minute wasm "hello". | H (onboarding drop-off) | M | yes |
| 7 | **Correct → efficient → under-fault tiers** (Gossip Glomers) | Per-lab and per-Fleet-scenario tier thresholds, calibrated vs baselines and documented in lab READMEs. | H | S–M | yes |
| 8 | **XP = focused minutes; honest streak** (Math Academy, Duolingo) | Recalibrate `XP` to minutes of graded work, performance-scaled. Streak counts only goal-met days. Weekly freeze; 3×/week mode. Re-base RANKS. | M | S | yes |
| 9 | **Belts over ranks** (pwn.college) | White → black belts awarded only for verified artifacts (lab tiers, Fleet Week acts, review retention ≥ 85%). Optional CI-verified belt badge via the existing PR flow. | M–H | S–M | yes (with-caveat: public verification uses GitHub Actions) |
| 10 | **Adaptive diagnostic** (Math Academy, Birdbrain) | Replace the 8-question placement with an Elo-lite adaptive check over the graph (#5). Mark known lessons with partial credit and seed their review schedule. | M | M | yes |
| 11 | **Serving Puzzles** (Sasha Rush) | 12–16 one-screen puzzles in WGSL/block-table/scheduler sims, scored on bytes moved / blocks wasted / recompute. | M–H | M | yes |
| 12 | **Pretest-first lessons** (Brilliant) | Allow the `quiz` block first in `blocks`, ungraded prediction, revealed at the end ("you predicted X; measured Y"). | M | S | yes |
| 13 | **Records log + physics-floor anti-cheat** (modded-nanogpt, KernelGuard) | `public/records.json` with PR links and "what changed" write-ups. Multi-seed significance on traces. Roofline/bandwidth floor checks in `validate-leaderboard-submission.yml`. Season-end open-sourcing. | M | S–M | yes (with-caveat: Actions) |
| 14 | **"Your Engine" build view** (Turing Complete, Nand2Tetris) | Persistent schematic on `/fleet` and `/progress` showing which components are the student's wasm vs reference. 3D rack (R3F) optional. | M (motivation, mental model) | M (2D) / L (3D) | yes |
| 15 | **Fading scaffolds / hard-mode zips** (CS336) | Late labs offer a "signature-only" zip variant. Same tests. | M | S | yes |
| 16 | **Zero-server cohorts** (Recurse, cohort platforms, pwn.college HANTOs) | Cohort JSON with milestones. GitHub Discussions room. "Learn generously" norms. Recognized volunteer mentors (badge in leaderboard JSON). | M (completion) | S | with-caveat (relies on GitHub Discussions) |
| 17 | **Private seasonal event** (Advent of Code) | Quarterly 7–12-day "Fleet Week Live" tied to Field Notes. Private file-based team leaderboards. No global race. | M | M | yes |
| 18 | **PyO3 bridge lab** (Mainmatter) | Optional lab: expose the student's block manager to Python via PyO3 and run a tiny Python driver. Speaks to the Python audience. | L–M | M | yes (local toolchain) |
| 19 | **Teach-mode speaker notes** (Comprehensive Rust) | `deepdive`-like collapsible "facilitator notes" per lesson for study groups. | L–M | S | yes |
| 20 | **AI-generated practice** (Boot.dev Training Grounds) | LLM-generated challenges validated before serving. | M | L | **needs-server** (or BYOK, with-caveat) |
| 21 | **Hosted browser dev environment** (pwn.college DOJO, LeetGPU) | In-browser Rust toolchain/VM so no local install. | H for onboarding | L | **needs-server** (Codespaces link = with-caveat, third-party) |
| 22 | **Instant real-GPU benchmarking** (KernelBot, Tensara/Modal, LeetGPU) | Submit a kernel → timed on a real GPU. | M | L, plus $ | **needs-server** |
| 23 | **Context-aware embedded tutor** (SENSAI) | Tutor reads live sim state/terminal. | M–H | M | with-caveat (BYOK, as already proposed in NEXT.md §4; SENSAI-style hosted = needs-server) |

**Sequencing suggestion:** #1–#3 first (a week; fixes measurement). Then #4–#5 together (the retention engine). Then #6–#7 + #9 (the Forge becomes a CodeCrafters/Gossip-Glomers ladder with belts). #11/#14/#17 are the "game" layer once retention exists.

**Mechanics requiring the zero-server constraint to be relaxed:** #20 (validated LLM generation, unless BYOK), #21 (hosted dev environments), #22 (GPU benchmarking), and the hosted variant of #23. A live global leaderboard with instant feedback (KernelBot/Tensara) also needs one, but the existing PR→Actions flow is an acceptable asynchronous substitute.

---

## 4. Anti-patterns & risks

1. **Optimizing engagement metrics as if they were learning.** Every Duolingo number above is retention/DAU. Streaks that count "any activity" (current `touchStreak`) reward opening a tab. Gate streaks on graded work (F11).
2. **Leaderboards as the primary motivator.** pwn.college reports global leaderboards "quickly stabilized", so new learners "could never catch up" [fixed]. AoC killed its global board over stress and abuse. Keep the leaderboard opt-in and secondary to belts (F10, F14).
3. **AI as crutch.** Bastani: −17% once access was removed. Any tutor feature must be guardrailed, with hint ladders rather than answers. Tompkins: utility falls on advanced material, which is exactly T5–T6 (F15, F16).
4. **Agent cheating on public benchmarks.** 3.45% hacked submissions before KernelGuard. CI reproducibility ≠ originality (already noted in NEXT.md). Add physics floors (F13).
5. **AI-slop items.** Boot.dev admits generated challenges are sometimes bad. Kernelspace's "every number sourced" rule makes parametric generators strictly better than LLM-generated items (F18).
6. **Digital archaeology.** Archived solutions and discussion threads enable copying (pwn.college). Season-end open-sourcing (#13) should lag the season, and review items should be parametric so copying doesn't transfer.
7. **Flashcards for hierarchical skills.** Plain FSRS over 68 lessons would over-schedule reviews of foundations already exercised by labs. FIRe-style implicit credit is needed (F1/F4).
8. **Gamified quizzes that can be passed by pattern.** 86.5% "B" answers, and the correct option is the longest in 94.7% of questions. Together these mean XP and "quiz passed" are currently noise. Fix before building anything that consumes quiz data (adaptive placement, review scheduling).
9. **3D for its own sake.** Turing Complete and Nand2Tetris succeed through *composable progression*, not rendering. A 3D Fleet that doesn't change decisions adds GPU cost and accessibility problems. Use 3D only where spatial layout *is* the concept (rack topology, NVLink domains, wide-EP all-to-all).
10. **Over-scaffolding experts / under-scaffolding novices** (CS336 vs Rust Zero). Use fading scaffolds plus an adaptive diagnostic, not one difficulty for all.
11. **Unverifiable efficacy claims.** Brilliant, Math Academy and Boot.dev publish mechanisms, not controlled outcomes. Cite them as design inspiration, never as effect sizes, consistent with kernelspace's sourcing rule.

---

## 5. Sources

| URL | Title | Date |
|---|---|---|
| https://mathacademy.com/how-our-ai-works | Math Academy — How our AI works | read 2026-10 |
| https://mathacademy.com/pedagogy | Math Academy — Pedagogy | read 2026-10 |
| https://justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/ | Optimized, Individualized Spaced Repetition in Hierarchical Knowledge Structures (FIRe) | 2023-10-05 |
| https://www.justinmath.com/what-is-the-highest-sustainable-daily-xp-on-math-academy/ | What's the Highest Sustainable Daily XP on Math Academy? | 2024-07-26 |
| https://notes.andymatuschak.org/Execute_Program | Andy Matuschak — Execute Program notes | read 2026-10 |
| https://github.com/open-spaced-repetition/srs-benchmark | SRS Benchmark (FSRS-7/6/5, RWKV) | read 2026-10 |
| https://github.com/open-spaced-repetition/ts-fsrs | ts-fsrs (MIT, FSRS-6) | read 2026-10 |
| https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html | Anki FAQ — FSRS | read 2026-10 |
| https://spectrum.ieee.org/duolingo | How Duolingo's AI Learns What You Need to Learn (Birdbrain) | 2023 |
| https://blog.duolingo.com/improving-the-streak | Improving the streak | 2020-11-19 |
| https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals | How streaks keep learners committed | 2017-05-10 |
| https://blog.duolingo.com/how-we-learn-how-you-learn | Half-life regression | 2016 |
| https://adamdoupe.com/publications/pwn-college-five-years-sigcse2026.pdf | Open Cybersecurity Education: Five Years of pwn.college (SIGCSE 2026) | 2026-02 |
| https://ctf.asu.edu/education/ace-outcomes | ASU ACE outcomes (Luminarium Best Paper, SENSAI, DOJO) | read 2026-10 |
| https://sigcse2025.sigcse.org/details/sigcse-ts-2025-Papers/59/SENSAI-Large-Language-Models-as-Applied-Cybersecurity-Tutors | SENSAI (SIGCSE 2025) | 2025-02 |
| https://arxiv.org/abs/2602.17448 | Do Hackers Dream of Electric Teachers? (Tompkins et al.) | 2026-02-19, rev. 2026-09-24 |
| https://docs.codecrafters.io/challenges/how-challenges-work.md | CodeCrafters — How challenges work | read 2026-10 |
| https://fly.io/dist-sys/ ; https://fly.io/dist-sys/3d/ | Gossip Glomers; Challenge 3d | 2023 |
| https://protohackers.com/ | Protohackers | read 2026-10 |
| https://adventofcode.com/2025/about | Advent of Code 2025 — About | 2025 |
| https://github.com/srush/GPU-Puzzles | GPU Puzzles (Sasha Rush) | read 2026-10 |
| https://icml.cc/virtual/2025/48171 | KernelBot: A Competition Platform for Writing Heterogeneous GPU Code | ICML 2025 |
| https://icml.cc/virtual/2026/67922 | KernelGuard: Defending GPU Competitions from Adversarial Agentic Systems | ICML 2026 |
| https://arxiv.org/abs/2502.10517 | KernelBench | 2025-02-14 |
| https://www.i-programmer.info/news/204-challenges/17945-leetgpu-the-cuda-challenges.html | LeetGPU — The CUDA Challenges | 2025-04-04 |
| https://tensara.org/ | Tensara | read 2026-10 |
| https://github.com/KellerJordan/modded-nanogpt | modded-nanogpt speedrun (record #92, 2026-08-30) | read 2026-10 |
| https://github.com/karpathy/nanochat | nanochat | 2025-10 → 2026 |
| https://techcrunch.com/2024/07/16/after-tesla-and-openai-andrej-karpathys-startup-aims-to-apply-ai-assistants-to-education | Eureka Labs launch | 2024-07-16 |
| https://jax-ml.github.io/scaling-book/ | How to Scale Your Model (Google DeepMind) | 2025-02-04 |
| https://www.infoq.com/news/2025/03/huggingface-ultra-scale-playbook | HF Ultra-Scale Playbook (InfoQ) | 2025-03 |
| http://cs336.stanford.edu/spring2025/ | Stanford CS336 Spring 2025 | 2025 |
| https://missing.csail.mit.edu/ | MIT Missing Semester (2026 edition, Agentic Coding) | 2026-01 |
| https://www.nand2tetris.org/ | Nand to Tetris | read 2026-10 |
| https://store.steampowered.com/app/1444480/Turing_Complete/ | Turing Complete (Steam) | read 2026-10 |
| https://www.recurse.com/self-directives | Recurse Center self-directives | read 2026-10 |
| https://exercism.org/about ; https://exercism.org/mentoring | Exercism about / mentoring | read 2026-10 |
| https://rustlings.rust-lang.org/ | Rustlings | read 2026-10 |
| https://rust-exercises.com/ | 100 Exercises to Learn Rust (Mainmatter) | read 2026-10 |
| https://google.github.io/comprehensive-rust/ | Comprehensive Rust | read 2026-10 |
| https://www.boot.dev/blog/news/training-grounds-launch | Boot.dev Training Grounds launch | 2025-08-27 |
| https://brilliant.org/about/ | Brilliant — About | read 2026-10 |
| https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/ | Kestin et al., AI tutoring outperforms in-class active learning (Sci Rep) | 2025-06-03 |
| https://papers.ssrn.com/abstract=4895486 | Bastani et al., Generative AI without guardrails can harm learning (PNAS 122(26)) | 2025 |
| https://research.google/blog/learn-your-way-reimagining-textbooks-with-generative-ai/ | Learn Your Way | 2025-09-16 |
| https://code.claude.com/docs/en/output-styles | Claude Code output styles (Learning, TODO(human)) | read 2026-10 |
| https://numinous.productions/timeful/ | Matuschak & Nielsen, Timeful texts (mnemonic medium; no quantitative data) | 2020-07 |
| repo: src/lib/progress.ts, src/data/lessons/types.ts, src/components/QuizBlock.tsx, labs/AGENTS.md, src/pages/Curriculum.tsx | kernelspace code (quiz index count: 230×[1], 26×[2], 10×[0]) | 2026-10-03 |

---

## Verification log

Fact-checked 2026-10-03 against primary sources: the repo, publisher pages, PMC/Crossref/OpenAlex metadata and GitHub READMEs. Verdicts: confirmed / corrected (text fixed in place) / unverified / refuted.

| Claim | Verdict | Evidence URL |
|---|---|---|
| Quiz skew: 230×[1], 26×[2], 10×[0], 0×[3] of 266 | confirmed (all 266 have 4 options; correct option is longest in 252/266; placement check 7/8 at index 1) | repo: `grep -rhoE "correct\s*:\s*\[[^]]*\]" src/data/lessons`; src/pages/Curriculum.tsx |
| XP flat (lesson 100, quiz 40, lab 200); `streakDays` counts any activity; six checks per lab; no prereq field | confirmed | repo: src/lib/progress.ts L97–149; labs/AGENTS.md L9; src/data/lessons/types.ts |
| Math Academy FIRe: fractional credit down encompassings, failures penalize upward, knock-out reviews, per-student-topic speed, repNum/memory formulas | confirmed (post dated 2023-10-05, terminology updated 2026) | https://justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/ |
| Math Academy two graphs, "multiple thousands" topics, diagnostic cut "by an order of magnitude", no outcome numbers | confirmed | https://mathacademy.com/how-our-ai-works |
| 1 XP ≈ 1 focused minute; 50–60 XP/day sustainable max | confirmed (2024-07-26) | https://www.justinmath.com/what-is-the-highest-sustainable-daily-xp-on-math-academy/ |
| srs-benchmark 9,999 collections / ~350M reviews; FSRS-7 0.3401 (34p), FSRS-6 0.3460, FSRS-5 0.3561; RWKV-Instant 0.2773 (2.76M p) | confirmed (349,923,850 reviews; best FSRS-7 variant "recency" 0.3370; FSRS-6 = 21 params) | https://github.com/open-spaced-repetition/srs-benchmark |
| ts-fsrs MIT, FSRS-6, ESM | confirmed | https://github.com/open-spaced-repetition/ts-fsrs |
| Anki ships FSRS since 23.10; "fewer reviews … same retention" | confirmed | https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html |
| Birdbrain V1 IRT/Elo logistic regression; V2 May 2022 LSTM, 40-dim | confirmed (IEEE Spectrum 2023-02-05) | https://spectrum.ieee.org/duolingo |
| HLR reduced error 45%+ vs baselines | confirmed (also +12% daily engagement) | https://aclanthology.org/P16-1174.pdf |
| Execute Program: executable prompts, no penalty unless give up, favors new lessons | confirmed; interval ladder stays unverified | https://notes.andymatuschak.org/Execute_Program |
| CodeCrafters stage tests, stage 1 = uncomment + git push | confirmed | https://docs.codecrafters.io/challenges/how-challenges-work.md |
| Gossip Glomers 3d: msgs-per-op < 30, median < 400 ms, max < 600 ms, 100 ms latency | confirmed (25 nodes) | https://fly.io/dist-sys/3d/ |
| GPU-Puzzles: 14 puzzles, scored on global/shared reads/writes | confirmed | https://github.com/srush/GPU-Puzzles |
| GPU-Puzzles run on CPU via NUMBA_ENABLE_CUDASIM | corrected: the repo recommends Colab with a GPU runtime and never mentions the simulator | https://github.com/srush/GPU-Puzzles (README, lib.py, notebook) |
| LLM-Training-Puzzles: 8 puzzles on memory efficiency / pipelining | confirmed | https://github.com/srush/LLM-Training-Puzzles |
| Nand2Tetris at 400+ universities, high schools, bootcamps | confirmed | https://www.nand2tetris.org/ |
| Turing Complete EA 2021-10-02, 70+ levels, 94% of 3,023 reviews | confirmed (exit from EA projected 2026) | https://store.steampowered.com/app/1444480/Turing_Complete/ |
| pwn.college: 50k+ solved ≥1 (Nov 2025), 13,500+ at 90 d, 3,833 at 365 d, SIGCSE 2026 pp. 743–749 | confirmed (doi:10.1145/3770762.3772636) | https://adamdoupe.com/publications/pwn-college-five-years-sigcse2026.pdf |
| pwn.college: leaderboards "lose meaning at scale"; HANTOs "became primary support" | corrected: the first is a paraphrase in quote marks, not a quote; the paper says the single most helpful Discord member was a volunteer | same PDF |
| Linux Luminarium won SIGCSE 2026 Best Paper | confirmed | https://ctf.asu.edu/education/ace-outcomes |
| Duolingo 2020: +3.3% D14, +1% DAU, +10.5% on streak, 2.4× at 7-day streak | confirmed (2020-11-19) | https://blog.duolingo.com/improving-the-streak |
| Weekend Amulet +4% return / −5% streak loss; Streak Wager +14% D7 | confirmed, but Streak Wager is in the 2017 post, not the 2020 one (attribution fixed) | https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals |
| modded-nanogpt #92 = 0.665 min (2026-08-30), 45-min llm.c baseline, p<0.01 that mean val loss ≤ 3.28, 8×H100 | confirmed | https://github.com/KellerJordan/modded-nanogpt |
| nanochat time-to-GPT-2 best 1.65 h (2026-03-14); README has no Eureka Labs reference | confirmed | https://github.com/karpathy/nanochat |
| KernelBot "ICML 2025"; kernels "adopted by NVIDIA and AMD" | corrected: CODEML workshop at ICML 2025; abstract says "real impact and success on" NVIDIA and AMD | https://icml.cc/virtual/2025/48171 |
| KernelGuard 3.45% of 141,800 hacks → 0.37% of 40,998 | confirmed numbers (4,889 and 152); venue corrected to ICML 2026 workshop poster; before/after, not controlled | https://icml.cc/virtual/2026/67922 |
| KernelBench: frontier models match the PyTorch baseline in <20% of cases | confirmed | https://arxiv.org/abs/2502.10517 |
| AoC 2025 removed global leaderboard (stress, DDoS), ends mid-December, AI discouraged | confirmed (the page gives no puzzle count, so "fewer days" is the author's inference) | https://adventofcode.com/2025/about |
| Kestin: n=194, 0.63 SD linear / 0.73–1.3 SD quantile, median 49 min, step-by-step solutions in prompt | confirmed | https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/ |
| Kestin: "only 63% of students did both conditions" | refuted: eligibility required both conditions (194 of 233 eligible), and "63%" does not appear in the paper | https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/ |
| Bastani PNAS 122(26): +48% practice, −17% exams, GPT Tutor +127%, largely mitigated | confirmed (Turkey, grades 9–11; GPT Tutor exam effect ≈0; a later correction fixed only an affiliation) | https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/ |
| SENSAI: 2,742 users, 178,074 messages, 15,413 sessions, $1,979 | confirmed (Nelson, Doupé, Shoshitaishvili) | https://sigcse2025.sigcse.org/details/sigcse-ts-2025-Papers/59/SENSAI-Large-Language-Models-as-Applied-Cybersecurity-Tutors |
| Tompkins et al.: n=309, 142,526 queries, 383 challenges; Short/Reactive/Proactive styles correlate with completion; utility drops on harder material | confirmed (rev. 2026-09-24; arXiv metadata notes an ACM CCS venue) | https://arxiv.org/abs/2602.17448 |
| Claude Code Learning style leaves TODO(human); custom styles in .claude/output-styles/ | confirmed (also: styles don't guarantee behavior; custom styles drop coding instructions unless keep-coding-instructions: true) | https://code.claude.com/docs/en/output-styles |
| Boot.dev Training Grounds 2025-08-27: selection by progress + SRS; LLM generation; backend validation; AI-slop admitted; 2,500+ lessons | confirmed; "~45 s" is generation time (wording fixed) | https://www.boot.dev/blog/news/training-grounds-launch |
| Learn Your Way: RCT n=60, ages 15–18, 78% vs 67% at 3–5 days | confirmed (2025-09-16) | https://research.google/blog/learn-your-way-reimagining-textbooks-with-generative-ai/ |
| MIT Missing Semester 2026 with Agentic Coding lecture, AI folded into every lecture | confirmed | https://missing.csail.mit.edu/ |
| Brilliant: "We don't teach how to do something before asking questions"; Koji tutor; no efficacy data | confirmed | https://brilliant.org/about/ |
| Scaling Book: 12 chapters, 2025-02-04, GPU chapter | confirmed (collapsible-answers format not checked) | https://jax-ml.github.io/scaling-book/ |
| Ultra-Scale Playbook: 4,000+ experiments, up to 512 GPUs, memory widget | confirmed (InfoQ 2025-03-04, a secondary source) | https://www.infoq.com/news/2025/03/huggingface-ultra-scale-playbook |
| CS336: leaderboards on A1, A2, A4; debug on CPU; H100 ~$2–3/h | confirmed | http://cs336.stanford.edu/spring2025/ |
| Rustlings official, `cargo install rustlings` / `rustlings init` | confirmed (watch mode not checked on landing page) | https://rustlings.rust-lang.org/ |
| Exercism: 83 programming languages | confirmed | https://exercism.org/about |
| Recurse self-directives (three) | confirmed | https://www.recurse.com/self-directives |
| Comprehensive Rust: 4 fundamentals days + Android/Chromium/bare-metal/concurrency | confirmed; "9+ translations" unverified | https://google.github.io/comprehensive-rust/ |
| MOOC ~3% completion (Reich & Ruipérez-Valiente 2019) | unverified (citation confirmed, figure paywalled) | https://doi.org/10.1126/science.aav7958 |
| ChatGPT Study Mode / Duolingo 148 courses / Eureka Labs status / FSRS "25% vs SM-2" | unverified (primary pages returned 403 or were not found) | https://openai.com/index/chatgpt-study-mode/ (403) |

## Gaps the author missed

1. **3D/immersion can *reduce* learning.** The user asked about "modern games with game engine 3D". The plan must know the classic counter-evidence: Makransky, Terkildsen & Mayer, "Adding immersive virtual reality to a science lab simulation causes more presence but less learning", *Learning and Instruction* (2019), doi:10.1016/j.learninstruc.2017.12.007. This turns anti-pattern 9 from opinion into evidence. Gate any 3D/engine work on a concept that is spatial by nature, and A/B test it against the 2D version.
2. **Productive failure / problem-solving-before-instruction has meta-analytic support, so pretest-first should be more than a Brilliant anecdote.** Sinha & Kapur, *Review of Educational Research* 2021 (53 studies, 166 comparisons): PS-I beats I-PS with g = 0.36, rising to 0.37–0.58 with high-fidelity Productive Failure. Effects reverse for young learners and domain-general skills. doi:10.3102/00346543211019105. This is the evidence base for steal-list #12 and for "predict the p99 first" sim openers.
3. **The testing effect is the evidence base for the whole retention engine.** The dossier cites FSRS/FIRe mechanisms but no learning-science meta-analysis. Adesope, Trevisan & Sundararajan, "Rethinking the Use of Tests: A Meta-Analysis of Practice Testing", *RER* 2017: practice tests beat restudying and all other comparison conditions, moderated by test format. doi:10.3102/0034654316689306.
4. **How learners use an LLM matters more than whether they have one.** Lehmann, Cornelius & Sting, "AI Meets the Classroom: When Do Large Language Models Harm Learning?" (arXiv 2409.09047, rev. 2025-03): no overall effect, but *substitution* use (more topics covered, shallower understanding) vs *complement* use (deeper understanding), and LLMs widened gaps between strong and weak students. This programming-learning evidence fits kernelspace's Forge labs better than Bastani's high-school math, and it supports F16's "teach how to use the tutor".
5. **AI that coaches the *mentor* (not the student) has RCT evidence and fits HANTO-style volunteers.** Wang et al., Tutor CoPilot (arXiv 2410.03017): 900 tutors / 1,800 K-12 students, +4 pp topic mastery, +9 pp for lower-rated tutors, ~$20/tutor/year. This is relevant to zero-server cohorts (#16): give volunteer mentors an AI "suggest a Socratic next move" prompt rather than giving students answers.
6. **Larger-scale AI-tutor field evidence beyond Harvard/Turkey.** De Simone et al., World Bank Policy Research WP 11125 (2025-05-20, doi:10.1596/1813-9450-11125): a six-week after-school GPT-4 tutoring program in Nigeria gave about 0.3 SD, outperforming ~80% of comparable developing-country RCT interventions (blogs.worldbank.org, 2025-01-09). It was a teacher-guided, structured program, which reinforces "structure + guardrails", not free chat.
7. **Kestin's effect is immediate-post-test only.** This boundary was absent from F15. Neither Kestin nor Learn Your Way (3–5 days) measures retention over weeks. Kernelspace's review engine could produce *better* evidence than the exemplars it copies. The plan should budget an opt-in delayed-retention measurement (e.g. a 30-day re-test of parametric problems) so its own claims meet its "every number sourced" rule (PMC12179260).
8. **The quiz defect goes beyond index skew.** The correct option is the longest or tied-longest in 252/266 questions (94.7%), and the placement check puts 7 of 8 answers at index 1. Shuffling at render (steal-list #1) fixes position bias but *not* the length cue. Distractor rewriting must be a CI-enforced criterion (e.g. the correct option must not be the strict-longest in more than ~30% of items per track), not an optional nicety (repo: src/data/lessons/**, src/pages/Curriculum.tsx L44–118).
