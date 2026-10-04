# KERNELSPACE 100x — The Learning-Experience Plan

**"100x" is the owner's aspiration, not a forecast.** This plan commits only to per-learner outcomes it can measure (§1).

**Date:** 2026-10-03. Verified against `master` @ 4b578c8. The `deploy.yml` action bump (2026-10-04) is separate from this plan.

**Evidence base:** `docs/100x-evidence/` holds the 3 audits and 8 research reports this plan cites; `research/…` and `audit/…` paths below are relative to it. Each dossier ends with its verification log.

## In plain words

- **The problem.** The lessons, sims and Rust labs are excellent, but the loop around them rewards clicking, not learning. "Always pick the longest answer" passes 58 of 68 quizzes, *Mark complete* pays more XP than passing a quiz, nothing is ever reviewed, and the first Rust exercise starts with installing a toolchain.
- **The idea: evidence, not clicks.** Every concept runs the same loop. Predict it, play it by hand, build it in Rust, prove it without AI, then keep it through a 10-minute daily review that generates fresh numbers every time.
- **What learners will feel:**
  - a 10-minute, phone-friendly opener that turns a guess about GPU speed into a real insight about memory bandwidth;
  - hand-scheduling a real production traffic burst before automating it in Rust;
  - a daily incident drill on their own components;
  - "this has changed" cards when the field moves;
  - lab pages that show progress check by check.
- **Games and 3D.** Yes to game mechanics where the rule *is* the concept, built on the existing deterministic simulator. No to game engines: Bevy, Godot and Unity are too heavy, would be a second source of truth, and hurt accessibility. 3D only for the matmul Tiling Cube, opt-in, until it is shown to teach at least as well as linked 2D views.
- **AI help.** Hand-written hint ladders, a no-AI "Prove it" check and agent guardrails inside every lab zip come first. An in-page AI tutor is deferred, because the research shows unguarded AI help raises practice scores and lowers real learning.
- **Content.** 14 errors are fixed immediately, every number becomes a dated, sourced claim that flags itself when stale, and lessons are updated to the state of the field in October 2026.
- **"100x"** is treated as an aspiration, not a promise. Success is measured on the learner's own device: how many concepts they still get right, unassisted, 30 days later.
- **Timeline.** It is sized to the maintainer's review time at 10 h/week. Wave 0a (2 weeks) stops paying for clicks. Wave 0b (8 weeks) adds the evidence ledger, the Boot opener and the content fixes. Waves 1–3, through October 2027, build the full loop. More review hours shorten it (OD11).

**Scope:** the learning experience across 68 lessons in 9 tracks, ~20 sims, the Forge, the Fleet, Fleet Week and Capstone Zero. New lessons inside existing tracks are in scope. New courses and servers are out.

**Prior plans:**
- PLAN.md (2026-08-03) and PLAN-WORLDCLASS.md (2026-08-11) have shipped. PLAN-WORLDCLASS §10 stays the release gate, extended in §7.4.
- From NEXT.md, trace replay and the single-slot real engine shipped. The BYOK tutor and classroom mode did not.
- Nothing here re-proposes shipped work.

**Evidence:** 3 repo audits; 7 adversarially verified dossiers; 1 unverified feasibility study (`research/forge-friction.md`, tagged [single-machine]); 5 proposals; 3 judges; 3 critics (83 requests).

**Tags:**
- [measured 2026-10-03]
- [derived]: computed from cited inputs; reproduced in CI before shipping
- [estimated]
- [unverified]: never load-bearing

**Owner constraints (2026-08):** zero always-on servers, local-first, no telemetry or accounts, every number sourced, one maintainer plus agents.

---

## 0. The plan on one screen

**Thesis.** The instruments are strong: deterministic sims, an engine that runs the learner's own Rust, and browser-graded labs. The roofline and KV sims use sourced hardware numbers; the Fleet's v1 timing is a flat 50 ms tick, not hardware-calibrated.

The loop around those instruments measures clicks:
- a keypress pays 100 XP;
- "always pick the longest option" passes 58 of 68 lessons;
- nothing returns for review;
- the first ten minutes end at `rustup`.

The owner's 100× is an aspiration, not a forecast; this plan commits to measurable per-learner outcomes: every minute leaves valid evidence that is spaced, transferred and defended, in one world with one source of truth.

**Spine: Evidence, not clicks.** Each mechanism runs **Predict → Play → Build → Prove → Keep** on three substrates:
- an append-only on-device **Evidence Ledger**;
- **one source of truth**: claims, a hardware atlas, a seeded RNG and the Fleet engine;
- a **knowledge-component (KC) graph**.

Only ledger evidence moves completion, XP, rings and "what next".

The course runs on the machine it teaches, and Today and `/me` speak its vocabulary:

| Course part | Serving analogue |
|---|---|
| The ledger | a write-ahead log |
| Review | DRAM refresh against a recall SLO with an error budget |
| A fact | a cache entry with a TTL |
| Practice | a seeded on-call drill |
| `/me` | observability for your memory |

**What changes:**
- **Valid instruments first:** shuffled, id-keyed options with a "why"; a test-wiseness lint; 14 errors fixed; one claims registry; fresh seeds; `m` stops paying.
- **Honest rewards:** XP = nominal graded minutes; streaks from graded work; rings re-earned on unseen seeds; nothing locks.
- **Ask before telling:** prequestions, prediction gates, outcome-graded sim tasks, isomorphisms that say where they break.
- **Play, compose, automate:** by hand, then as a policy, then in Rust; a daily incident on your own components.
- **A Forge without the wall:** per-check results, staged labs, phone-friendly compile items, fenced help, a no-AI "Prove it".
- **Kept knowledge:** generators feed a 10–12-minute Today; test-out; one Up Next; a private Mirror.
- **Games yes, engines no, 3D on trial.**

**Flagship moments:**
1. **Boot (Wave 0b).** On a phone you find that one user keeps ≈0.3% of an H100's math busy. Even when KV memory runs out at ~120 chats of 4k tokens, ~90% still idles. Your 5,000 tok/s guess is what it delivers across ~120 users [derived].
2. **"I placed the blocks" → "I was the scheduler" (Waves 1–2).** You hand-place T1.L4's trace until fragmentation stops you. Then you hand-schedule BurstGPT's busiest minute against a hidden reference ghost and reproduce it with four dials. Your Rust then orders and preempts 8 canned prompts on a one-slot real engine (Qwen3-0.6B in the tab).
3. **"1 thing you learned has changed" (Wave 0b).** Dynamo deprecated KVBM on 2026-09-21. Today shows the struck line, the source and two retrieval items, including to pre-v3 T6 finishers.
4. **The Tiling Cube (Wave 3).** Intensity is volume ÷ lit surface, and raster order alone moves the roof several-fold [derived].
5. **"You just wrote the structure SGLang made its default" (Wave 3).** After lab 07 you trace SGLang's Rust radix TreeCore (default since 2026-09-29) at a pinned SHA.

---

## 1. What "100x" means and how we will know

**Calibration.**
- Across ~750 education RCTs the median effect is 0.10 SD, and ≥0.20 counts as large (Kraft 2020).
- Bloom's 2σ was never replicated; tutoring measures 0.33–0.37 SD (von Hippel 2024).
- Appendix A's effects come from aligned, researcher-made tests, mostly K-12 or undergraduate. They do not add up, and field effects are typically ~0.1 SD.

We expect tenths of an SD on aligned tests. No learner-facing copy will claim 100×.

**North star: VRK₃₀, per learner, on the device.** A KC counts when the learner answers fresh generated items on it correctly, unassisted, ≥30 days after first learning it, on unseen seeds wherever a generator exists. `/me` shows the count and its rate per active study-month, with intervals.

Population figures appear only as "among n opt-in reporters (self-selected, not representative)" with n and a CI, never compared across versions as causal; partner figures are a labelled convenience sample.

**Baseline (Wave 0).** Partners who used v2 take cold checks on the lessons they completed. Fixing validity changes the measurement, not the learning.

| Lever | Today | Target | Rationale | Measure |
|---|---|---|---|---|
| Activation | first 10 min end at `rustup`; 45–90+ min to first Forge green on fresh Windows [estimated] | ≥70% of partners finish Boot with ≥3 correct and return for a second graded session within 7 days | design rationale; no outcome-matched evidence | ledger |
| Persistence | streak counts UTC page views | own weekly target met in ≥8 of 12 weeks | design rationale, no outcome-matched evidence; dosage binds (Oreopoulos & Low 2026) | active minutes (visibility + interaction heartbeat), not XP |
| Dosage | ~4 MCQs per lesson, seen once | 8.9–18.4 graded opportunities per KC in year one at SLO 0.90 [derived] | Koedinger 2023 (7.24 to reach 80%), as an analogy | attempts per KC |
| Retention | never measured | 30-day accuracy within the CI of the 0.90 SLO on ≥140 pooled checks (Wave 2) | Rowland 2014; Adesope 2017; Cepeda 2008; Rawson & Dunlosky 2022 | cold checks |
| Verified | always-longest passes 58/68; one seed; Act I passes with no module | no blind strategy above chance + 2 SD (≈≤2/68); unseen-seed results within 10 pts of practice | Pan & Rickard 2018 (application items d=0.40); Bastani 2025 (unguarded AI −17%) | provenance |
| Time-efficiency | placement unstored; placed learners sent to R.L1 | ≥30% of KCs tested out; ≥85% confirmed at day 7 | design rationale, no outcome-matched evidence; Kalyuga 2003; Math Academy as vendor-described precedent only | ledger |
| Reach | every lab needs a toolchain; ~10 canvases lack text | core surfaces at 360 px; 0 serious axe violations; manual screen-reader pass per wave | WCAG 2.2 AA | CI plus manual pass |

**Time budget.**
- **Today, ≈52 h:** 30.3 h of declared lesson minutes, 17 h of systems labs, and ~5 h of Fleet Week and Capstone Zero.
- **Added:**
  - 12–50 h of spaced review in year one [derived: ts-fsrs defaults; 160 KCs at 1.2 new/day; recall equal to FSRS's prediction vs 10 points below it; 30–60 s per item, assumed until timed with partners];
  - ~10 h of new active blocks [estimated].
- **Total ≈75–110 h:** 19–28 weeks at 4 h/week.

The learner sets the week (K2). Defaults are sized for the pessimistic case.

---

## 2. Diagnosis

### 2.1 The moat (keep and amplify)

| Asset | Evidence | Becomes |
|---|---|---|
| Deterministic engine running learner wasm | `Engine`/`Cluster`/`EpdCluster` (`fleet-model.ts:471,908,1076`); a 240-request run takes ≈7 ms; timing is a flat tick plus an unsourced $7.5/worker-hour (`:408–409`) | the World; generators |
| Zero-dependency wasm ABI | `runLabWasm` (`wasm-lab.ts:68`); `ks_run` exists in all 18 crates and ignores its input (`labs/kit/src/lib.rs:16`) | template v2 (F1) |
| OS ≡ LLM isomorphisms | 18 panels, 51 pairs, 53 analogy callouts | P3 |
| Traces, CI leaderboard, real engine | sha256-pinned traces; lab 06 on a one-slot Qwen3-0.6B serving 8 canned prompts (`real-engine.ts:1–25`) | bestiary; finale |

### 2.2 What is broken

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | Assessment measures test-wiseness | 230/266 keys are B; the key is the longest option 94.7% of the time; always-longest passes 58/68 lessons, always-B 40/68; retry keeps option order (`QuizBlock.tsx:75–78`); 7/8 placement keys are B | V1, V2 |
| 2 | Completion is a click | `m` (`Lesson.tsx:616`) pays 100 XP vs 40 for a quiz (`progress.ts:97–104`); a sim toggle pays 60 vs 200 for a lab; "double XP" is unpaid (`Track.tsx:233`) | V5 |
| 3 | No return loop | no review; best-ever scores only; UpNext's review pick is `null` until all 68 lessons are done (`Progress.tsx:1057`); page views feed a UTC streak | K2, V5 |
| 4 | Practice is the exam | every run uses `0x5eed` (`fleet-week.ts:61,67,120,301,384,484`); worker 0 always dies at t400; `makeRng` (`fleet-model.ts:181`) has 31 fixed-point seeds below 2²² [measured] | S3 |
| 5 | Completable without understanding | toggle tasks (`RooflineSim.tsx:561,566,570`); Act I passes with no module (`fleet-week.ts:82–88`); Acts I–III evidence passes on keyword counts and any image (`:209–211,341–346`); Act IV MCQs; Capstone step 5 passes on one token (`Capstone.tsx:538–545`) | P2, W3, F7, §6.2 |
| 6 | Toolchain wall | 45–90+ min on fresh Windows [estimated]; one `todo!()` hides every result (`wasm-lab.ts:88–92`) | F1, F3 |
| 7 | No hands-on work | exercise blocks: R 0/10, T6 0/10, T7 0/5 | W5, F3 |
| 8 | Content errors | 14 items (§6.1) | S1 |
| 9 | Islands | 3 of 18 crates reach the Fleet; uploads vanish on reload (`slots.ts`); 6 of 8 lab hosts never link their lab | W4, K3 |
| 10 | Blind help | a truncated prefill with answer keys rides the URL (`AgentActions.tsx:28–33`); one-click Capstone solution (`:1301`) | H1–H4 |
| 11 | Dead ends | placement unstored; Resume sends T5 learners to R.L1; ⌘K has no lessons; `/week` missing from the nav; `badge-r.svg` 404s; the hero sends everyone to `/tracks/r` (`Home.tsx:182`) | K3, §4.D |
| 12 | Platform | 16 eager pages; 725 KB gz main chunk [measured, 4b578c8, 2026-10-03]; fake "TTFT 0.31s" (`StatusBar.tsx:11–22`); `text-3` at 3.3–3.7:1 contrast across 696 uses | §7 |

---

## 3. Design principles

1. **Fix the instrument before anything consumes it.** Haladyna 2002; Attali & Bar-Hillel 2003; Roediger & Marsh 2005 (lures become "facts" without feedback).
2. **Evidence, not clicks.** Deci 1999 (completion-contingent rewards −0.36, informational +0.33); Chi & Wylie 2014; Koedinger 2015 (one MOOC, correlational).
3. **Ask before telling.** St. Hilaire 2023; Crouch 2004; Hohman 2020 (optional interactivity gets skipped).
4. **Retrieve, space, relearn; interleave only confusable material.** Rowland 2014; Adesope 2017; Cepeda 2008; Rawson & Dunlosky 2022; Brunmair & Richter 2019. "Never on first exposure" is Math Academy practice, not a finding.
5. **Fail first only on "why this design".** Sinha & Kapur 2021: 0.36 conceptual, −0.03 procedural. Procedures get fading examples (van Gog & Sweller 2015; Kalyuga 2003).
6. **Compare actively and say where analogies break.** Alfieri 2013: d=.50 overall, larger with active alignment and the principle given afterwards. Gentner 2003.
7. **Same skill, new numbers.** Pan & Rickard 2018.
8. **The rule is the concept; schematic beats realistic.** Habgood & Ainsworth 2011 (time-on-task, n=16 children); Clark 2016 (small k).
9. **Help at the point of error, authored, never a substitute.** VanLehn 2011: step-based ITS vs no tutoring d=0.76, with answer-based systems lower. That is an upper bound, not an expectation for hint ladders. Bastani 2025; Oreopoulos & Low 2026.
10. **Every number is a claim; randomness lives in code.** Pardos & Bhandari 2024; Ipeirotis & Rizakos 2026.
11. **Soft gates, honest streaks, no XP leaderboards.** Kulik 1990; Silverman & Barasch 2023; pwn.college 2026.
12. **Measure on the device, publish n, and say it will feel harder.** Deslauriers 2019; Kornell & Bjork 2008.

---

## 4. Flagship experiences

Illustrative runs on pinned seeds. Every number shown to learners is a claim or [derived].

### A. Priya, Java payments backend, week 1

**Lunch, phone, Boot.**
1. She guesses an H100 serves Llama-3-8B to one user at 5,000 tok/s, and taps *sure*.
2. A faded example streams 16 GB per token at 3.35 TB/s: ≈209 tok/s, using ≈0.3% of ~990 TFLOPS.
3. She steps the roofline slider to the ridge, ≈295.
4. **The catch:** the 64 GB left holds ≈488k tokens at 128 KiB each, about 120 chats of 4k tokens. Each step then streams ≈80 GB in ≈24 ms, and ~90% of the math still idles.
5. **The reveal:** ≈5,000 tok/s is what the GPU delivers across ~120 users, not to one [all derived]. Right number, wrong reason.

She picks *Java, new to Rust*, sets 30-minute weekdays and scans the handoff QR.

**Next morning, on the train.** On `let first = &v[0]; v.push(4);` she answers E0499; it is E0502. A Java tab shows the `ConcurrentModificationException` she knows.

**Monday.** Asked for an FP8 KV size, she answers 320 KB, *sure*: exactly 2× [derived]. The grader says "you priced FP16" and returns the item with new numbers.

### B. Marco, Python infra: "I was the scheduler"

**The play.** T5.L7 opens on BurstGPT's busiest minute with 256 blocks. At iteration 37 he admits a 1,024-token prompt with 144 tokens free, and three short requests miss TTFT. Only then does the hidden ghost appear, and the debrief stops at the first divergence: "reference skips: 1,024 + 48 headroom > 144".

**Compose.** Four dials reproduce the reference. An In-production card shows the matching engine settings.

**Saturday, lab 06.** He predicts the reference's goodput. His agent hits the zip's deny rule, and a 20-word teach-back opens rung R1. He passes on seeds drawn at grade time; Prove-it v2 asks what his module does on a seeded trace.

### C. Aisha, SRE, C++ background

**Placement** finds T0, T2 and T4 solid, and catches her belief that CFS still schedules Linux (EEVDF since 6.6). She takes the serving-first path.

**Monday's Daily runs on her own block manager:** `TPOT p99 +12% after a tenant onboarded`. She logs a hypothesis; probes spend SLO budget; fixing the drain recovers the replay. The debrief scores 11 burn-minutes against the expert's 6 and flags her first probe "Streetlight".

### Two more walks

- **Wei, ML engineer, serving-first:** Boot, t0.l1–l2, t4.l3, then T5–T7, 755 declared minutes [measured]. Rust arrives as compile-bank reading items, and the labs are optional. He pastes his model's `config.json` into the Attention Zoo.
- **Sam, new grad:** answers Boot's no-job value prompt ("what do you want to build or be hired for?"), takes the braided full ramp, and ends with an Evidence Pack.

### D. One journey

**Paths.** `recommend()` targets three:
- *full ramp* (braided, ~75–110 h);
- *serving-first*;
- *Rust systems* (R, T1–T3, labs 01, 04, 05).

Switching keeps all evidence.

**Braid.** Never more than 2 consecutive R lessons. Each R lesson is paired with the T0/T1 lesson that first needs it (V4 `requires` edges).

**Cadence.** ~4 h/week. This table is re-cut at every wave exit.

| Weeks | Surfaces | You can now… | Peak / valley | Features |
|---|---|---|---|---|
| 1 | Boot → Today; R.L1 ⇄ T0.L1 | estimate decode tok/s | peak: Boot | K4, K2 |
| 2–3 | R.L2–3 ⇄ T0.L2–4; compile bank | predict E0502 | valley: syntax → braid | F3, F4 |
| 4–5 | T1.L1–4; placement play | place blocks | peak: fixed blocks fit | P1, W1 |
| 6–7 | lab 01 stages | pass unseen seeds | valley: first lab → 2-min stage 1 | F1–F2, H3 |
| 8–11 | T2; lab 04; R.L7–10 | reason about scheduling, MPMC | RING 2, RING 1 | V5 |
| 12–15 | T3, lab 05; T4 | predict tiling payoffs | peak: Tiling Cube | W7 |
| 16–19 | T5.L1–7; Capstone Zero; lab 06 | size KV; schedule under SLO | peaks: first engine, scheduler | W6, W1, F7 |
| 20–23 | T5.L8–10, T6; labs 02, 03, 07, 08; Daily | diagnose on a budget | valley: lab load → short Dailies | W3–W5 |
| 24–26 | T7; Fleet Week on own components | defend $/Mtok with receipts | peak: finale, ROOT | receipts (§6.2); §5.8 |

**Information architecture.** At most five primary destinations replace today's eight nav items (`Navbar.tsx:10–19`):

**Today** (Warm Cache, Daily, Up Next, changes); **Path** (curriculum, lessons, glossary); **Build** (Forge, Fleet, Week, sims, Capstone); **Me** (mastery, rings, "your engine", Evidence Pack); **⌘K**.

- **Changes.** Field Notes, errata and change cards merge into one Changes surface at `/freshness`.
- **First visits** land on Boot, which replaces "Start at Rust Zero" (`Home.tsx:182`).
- **Returning visits** land on Today, which reads "recall SLO 0.90 · error budget 4 cards · refresh due".

### E. Arc

| When | Peak | Mitigation or design |
|---|---|---|
| Day 1 | Boot | a 30-second "this will feel harder, here is why" card (Deslauriers 2019) |
| Months 1–2 | placement play; lab 01 stage 1; RING 2 | syntax → braid, compile bank, ≤25-min stages |
| Mid-course | Tiling Cube; Capstone Zero moved after t5.l4 as "your first engine"; "I was the scheduler" | lab load → Saturday stages, Daily |
| Finale | Fleet Week on own components (t7.l5 points here, not to Capstone Zero; `Lesson.tsx:753`); Evidence Pack | ceremonies as competence statements plus an artifact card (Deci 1999) |
| After ROOT | Daily, change cards, field labs, Season 0 | — |

---

## 5. The pillars

### 5.0 How it fits

V (valid evidence) and S (one source of truth) are substrates; P, W, F, H and K are the loop stages. Each feature gives experience and mechanism, *Ev* (outcome data) or *Prec* (precedent only), code, risk and metric (§5.8: code and inline mitigations); S ≤3 agent-days, M ≤2 weeks, L ≤6 weeks; zero-server unless marked. A 30-minute day always works: lab stages ≤25 min, lessons resumable at H2 boundaries, Today 10–12 min.

| Stage | Learner act | ICAP / Naps | Ledger events | Features |
|---|---|---|---|---|
| Predict | commits a number with confidence | constructive / responding | `predict`, `item` | P1–P4, K4 |
| Play | plays by hand; debriefed against a hidden ghost | constructive / changing | `play`, `incident` | W1–W7 |
| Build | automates it in Rust | constructive | `lab-check`, `fleet-run` | F1–F8 |
| Prove | defends it without AI, on unseen seeds | presenting / transfer | `prove` | H1–H4, V6 |
| Keep | retrieves it later, regenerated | retrieval | `item`, `probe` | K1–K5 |

### 5.1 V — Valid evidence

**V1 · Item integrity (M).**
- Options are keyed by id and shuffled per attempt in QuizBlock, InlineQuiz, Act IV and placement; a retry changes order and items and shows no key first. Every option carries a `why` and a misconception id; ~100 numeric MCQs become generators; tutor-mode exports drop keys.
- `verify-items` fails when the key is strictly longest in >30% of a track's items, a length ratio exceeds 1.3, a `why` or `kc` is missing, or a distractor is a joke.
- *Ev:* Haladyna 2002; Attali & Bar-Hillel 2003; Roediger & Marsh 2005. *Code:* `QuizBlock.tsx`; `PlaygroundShell.tsx:826`; `export-lessons-md.ts:42–48`; `Curriculum.tsx:44–118`.
- *Risk:* lures teach falsehoods → a `why` on every submit. *Metric:* no blind strategy above chance + 2 SD (≈≤2/68) [derived].

**V2 · Confidence (S).**
- Guess, think-so or sure on keys 1–3; sure-and-wrong answers come first; confidence feeds FSRS, never gates.
- *Ev:* Butterfield & Metcalfe 2001; Metcalfe & Finn 2011. *Code:* `src/lib/learner/calibration.ts`.
- *Risk:* an extra tap → keyboard shortcuts. *Metric:* Brier's reliability component.

**V3 · Evidence Ledger (L).**
- IndexedDB events `{id, v, at, tz, day, kind, ref, rev, score∈[0,1], ok, conf, seed?, wasmSha256?, provenance, ms?}`. KCs derive at read time from a versioned ref→kc map with a KC-id migration table; XP, streaks, rings and FSRS state are selectors behind the existing `useProgress` façade; ts-fsrs is pinned and replayed on change.
- Import offers merge or replace with undo (today it only replaces, with no undo, `Progress.tsx:950`). A backup nudge after 30 days and an iOS install prompt cover eviction (Safari's policy is [unverified] for 2026).
- *Code:* `src/lib/ledger.ts`; `Progress.tsx:122–231,792`.
- *Risk:* lost or duplicated history → §7.1. *Metric:* the property tests pass, and a 12-month ledger round-trips.

**V4 · KC graph (M).**
- ~160 KCs (cap 200) with `requires`, `contains`, `confusable` and `threshold`, seeded from 250 H2s, 128 chips, 51 pairs and 141 back-references; a DAG check; one notional-machine card per track (its rules, and what it ignores).
- *Ev:* Koedinger 2023; Fincher 2020. *Code:* `src/data/kc.ts`; `verify-kc.ts`.
- *Risk:* granularity drift → the cap. *Metric:* 100% of items tagged.

**V5 · Honest economy, exit tickets, rings (M).**
- `m` only navigates. *Mark complete* becomes an **exit ticket**: 3 KC items, ≥2 correct including one non-MCQ (a self-checked constructed response where no generator exists); a miss offers new numbers or "continue anyway" (*read, not passed*). Tracks end in spiral checkpoints; nothing locks.
- XP = nominal graded minutes. Streaks count graded work in local days against a weekly target, with freezes and 48-hour repair, never showing 0. Rings derive from the ledger, never revoke (amber below 80%) and never gate. Legacy gets a frozen "pre-v3" badge plus Recertify.
- *Ev:* Deci 1999; Kulik 1990; Silverman & Barasch 2023. *Code:* `progress.ts:97–160` → `src/lib/{economy,streak,rings}.ts`; `Lesson.tsx:468,616`.
- *Risk:* veterans feel demoted → §7.1. *Metric:* 0 evidence-free completions; ≥70% of XP from labs and practice.

| Ring | Earned by |
|---|---|
| RING 2 | R1–R5; lab 01 on unseen seeds; T0–T2 exit tickets |
| RING 1 | R6–R10; labs 04–05 on unseen seeds; T3–T4 checkpoints |
| RING 0 | labs 02, 03, 06, 07 on unseen seeds (lab 06 within 3 pts of the reference); T5 checkpoint |
| ROOT | lab 08; Fleet Week I–III with own modules on unseen seeds; 5 Daily incidents; T6–T7 checkpoints; ≥80% on ≥40 30-day cold checks |

**V6 · Provenance (S).**
- `proved` (H4 v2) and `unseen` (seeds drawn at grade time; unseen, not secret) credit KCs at w=1.0; `lab-green` (v1 modules), `practice` and `assisted` at w≤0.3; `field` marks field labs; `legacy` is uncredited. Rings and VRK₃₀ need `proved` or `unseen`.
- *Rationale:* an engineering premise, that agents can produce most artifacts. Bastani 2025 and Shen & Tamkin 2026 are cited only for the harm of substitution. *Code:* `src/lib/learner/provenance.ts`.
- *Risk:* v1 Prove-it is self-graded → practice weight only. *Metric:* cold-check accuracy on credited KCs ≥ on reviewed ones.

### 5.2 S — Single source of truth

**S1 · Errata (S).**
- §6.1 fixes are dated at the source; scores graded against an older `rev` are flagged "re-check", never deducted; every block links to an issue form.
- *Ev:* Butterfield & Metcalfe 2001. *Code:* `public/errata.json`; `verify-errata.ts`.
- *Risk:* feels punitive → flags only. *Metric:* 0 errors open >14 days.

**S2 · Claims registry and atlas (M).**
- Every chip, spec, price and benchmark taps through to `{id, value, unit, source{url,quote,row}, verifiedAt, ttlDays, rev, derived?, boundary?, discrepancy?}`. $7.5/worker-hour, $25/hr and $900/hr become claims or are labelled *synthetic*.
- Expiry never fails CI: the client shows "stale since" and a weekly issue lists expiring claims. CI fails only on new or changed claims lacking source, quote or date; quotes are re-checked on change plus a monthly 10% sample.
- *Code:* `src/data/claims/`; `src/data/atlas.ts`; `fleet-model.ts:409`.
- *Risk:* PDFs resist quote checks → manual flag. *Metric:* 100% of chips cited.

**S3 · Seed hygiene (S).**
- Graded seeds are drawn at grade time, difficulty-banded (≈6–7 ms per run), with baselines re-simulated on them; node death is randomized; leaderboard seeds come from an Actions secret.
- *Code:* `src/lib/rng.ts`; `fleet-week.ts:61–142`.
- *Risk:* comparability → `makeRng` frozen for v1. *Metric:* 0 degenerate seeds in 10k; the same hash in 3 browsers.

**S4 · Change cards and watcher (M).**
- "N things you learned have changed": struck line, new line, source, a ≤40-word why and 1–2 retrieval items; `seenClaims` is seeded for pre-v3 completions. A weekly digest of ~20 repos and arXiv feeds local triage; nothing auto-merges.
- *Ev:* none yet. "Keywords flag the KVBM lessons" is an assertion; the planning backtest read 3 repos, was proposer-rated and missed llm-d's `fs-connector` deprecation. The watcher waits for an independently rated ≥8-week backtest over all ~20 repos (Dynamo included) reporting precision and recall. *Code:* `src/lib/deltas.ts`; `scripts/landscape/*`.
- *Risk:* hallucinated freshness → quote CI and human merge. *Metric:* change → fix in ≤14 days.

**S5 · Fleet physics v2 (L)** waits in Wave 4.

### 5.3 P — Predict

**P1 · Prequestions and `predict` blocks (M).**
- Two prequestions open each core lesson; `DiagramBlock.predictAt` holds captions until a prediction is committed.
- *Ev:* St. Hilaire 2023; Crouch 2004; Hohman 2020. *Code:* `types.ts`; `blocks.tsx:292`.
- *Risk:* expert friction → skip once the KC is solid. *Metric:* every diagram or sim lesson records a prediction.

**P2 · Outcome-graded sim tasks (M).**
- Tasks complete only after predict → run → a one-line explanation; toggle and "watch" tasks are rewritten; "what just happened" stays hidden until done; the lessons' 114 tasks merge into one registry covering all 20 sims.
- *Ev:* Hundhausen 2002; Naps 2002; Bisra 2018. *Code:* `*.tasks.ts`; `RooflineSim.tsx:561,566,570`; `blocks.tsx:644–680`.
- *Risk:* slows fluent learners → one-line explanations only. *Metric:* 0 tasks complete without a prediction.

**P3 · Active isomorphisms (M).**
- The 18 panels become align-then-reveal: align, name the break, then see the principle. Pairs gain `breaks` and an optional `work` analogue by background, each with its own break: connection pool ↔ KV block pool; G1 regions ↔ fixed KV blocks (G1 evacuates, KV blocks never move); backpressure ↔ admission control; CDN TTL ↔ KV TTL.
- *Ev:* Alfieri 2013; Gentner 2003. *Code:* `types.ts`; `src/lib/items/map-it.ts`.
- *Risk:* drag accessibility → a keyboard path. *Metric:* 30-day paging/PagedAttention/radix discrimination.

**P4 · Protégé blocks (S, one per track).**
- "Sam explains PagedAttention" with one false sentence to find, tag and fix; a sim preset proves the fix.
- *Rationale:* error detection, without outcome-matched evidence. Kucharavy 2025: +0.72 points on a 1–6 scale (correlational, preliminary). *Code:* `src/components/Protege.tsx`.
- *Risk:* the false line sticks → always shown struck through. *Metric:* grows to 25 only if a within-learner comparison favours it.

### 5.4 W — Play in the World

#### 5.4.0 Games, game engines, 3D: the answer

- **Games: yes**, as mechanics inside the deterministic engine wherever the rule *is* the concept.
- **Game engines: no.**
- **3D: candidates, pending evaluation.** The Tiling Cube defaults to linked 2D views, with 3D opt-in. The Device Mesh is gated.

**Seven-test gate** (games-3d §2.3): (1) intrinsic; (2) ≥3 axes reasoned about together; (3) model-backed; (4) recurs in ≥3 sessions; (5) schematic; (6) low load: pausable, DOM mirror, reduced motion; (7) debriefed. `verify-plays.ts` fails plays without a mirror, sources or a debrief, and any `View3D` outside `GATE_3D = ['tiling-cube','device-mesh']`.

**Stack:** three 0.185.1 and R3F 9.x on WebGL2 (Firefox lacks WebGPU on Linux and Android); one lazy three+R3F chunk ≤240 KB gz (238 KB measured) plus ≤40 KB per scene; no drei `Text`; `frameloop="demand"`; the 2D mirror renders first.

| Candidate | Verdict | Why |
|---|---|---|
| Tiling Cube | 2D default, 3D opt-in (W7) | passes all seven tests; no evidence yet that 3D beats linked 2D views |
| Device Mesh | gated (Wave 4) | needs sourced collectives and S5 |
| Placement and scheduler plays, Daily, EPLB | 2D | the rule is the concept; ≤2 axes |
| Bevy, Godot, Unity | reject | size (Godot ~32 MB, or 13 MB only with 3D disabled; a feature-heavy Bevy 0.19 app is 26–28 MB); WebGL2-only or experimental WebGPU; a second source of truth; breaks React accessibility |
| Babylon.js, PlayCanvas | reject | a second 3D runtime, no capability gain |
| WebXR, walkable datacenter | reject | small HMD meta-analysis effect (+0.24; Wu, Yu & Gu 2020), and one N=52 study lost learning (Makransky 2019); immersion without a generative task adds load |
| Photoreal hardware, 3D token flows | reject | realistic g=−0.01 vs schematic 0.48 (Clark 2016, small k) |
| Lore, loot, avatars, twitch play | reject | cost; seductive detail (illustrations: d≈0.95 retention cost, Rey 2012 via Tislar & Steelman 2021); Clark's narrative values (none 0.44, irrelevant 0.63, relevant 0.17; small k) are directional only |

**W1 · Play → Compose → Code (M; +S per mechanism).**
- **Play:** `ManualDriver` implements `SchedulerDriver`; a lockstep reference ghost stays hidden until the debrief, which stops at the first divergence; turn-based, 60-turn cap, expert skip. Block placement first (T1.L4 → T2.L7), then the scheduler (T5.L7).
- **Compose:** `PolicySpec` compiles to a driver (a test proves `{sjf, 2000, 48, none}` ≡ the reference); an In-production card lists the equivalent engine settings as version-pinned claims. **Code:** histograms against a ~12-policy bestiary, the real-engine finale, physics floors in the leaderboard validator.
- *Ev:* Sinha & Kapur 2021; Chernikova 2020. *Prec:* KernelGuard 2026. *Code:* `fleet-model.ts:280`; `src/lib/world/*`; `leaderboard.ts`.
- *Risk:* tedium → the cap and skip. *Metric:* goodput on unseen seeds, plus a 30-day diagnosis item.

**W3 · Incidents: signatures, Daily, Act IV (M).**
- `generate(hash32(ns+key)) → {trace, fault, severity, onset, slo}`, 4 faults first, feeds 30-second signature items; a **Fleet Daily** per local date on the learner's installed W4 components (hypothesis first, probes spend SLO budget, share string `KS-Daily #47 · 3 probes · burn 18%`); and Act IV probe drills on unseen seeds, scored against an expert's USE-ordered replay.
- *Ev:* Clark 2016; Shen & Tamkin 2026. *Prec:* Zeller; Gregg. *Code:* `src/lib/world/{faults,daily}.ts`; `sim.worker.ts`; `fleet-week.ts:400–505`.
- *Risk:* look-alike faults → separability ≥90%. *Metric:* diagnosis accuracy on unseen seeds at 7 and 30 days.

**W4 · Your engine (M).**
- Components persist in IndexedDB; a 2D schematic turns grey boxes mint; radix-cache becomes the prefix router via `ks_invoke`; bpe-tokenizer compares its counts with Qwen3's and the learner explains the gap (no pre-tokenizer); Act I requires one of your components.
- *Prec:* Turing Complete. *Code:* `slots.ts`; `drivers.ts`; `fleet-model.ts:825`.
- *Risk:* stale modules → `ks_abi_version`. *Metric:* Act I runs on your modules.

**W5 · T6/T7 hands-on (M).**
- Generator items first (goodput/SLO, $/Mtok, one speculative-acceptance function from precomputed tables, P:D ratio, FP4 capacity, parallelism memory), then v1-physics Fleet exercises (goodput knee, broken-benchmark detective, speculation push-your-luck) and an EPLB expert-placement play for t6.l1–l2. Each predicts first, passes on 3 fresh seeds and ends with an In-production card.
- *Ev:* Chernikova 2020. *Code:* `ExerciseBlock.fleet`; new `src/lib/fleet-{spec,moe}.ts`.
- *Risk:* invented calibration → claims or *synthetic* labels. *Metric:* 15/15 lessons.

**W6 · Attention Zoo (M).**
- `KvCacheSim` and t5.l4 plot capacity and per-step bytes for GQA, MLA, SWA+sinks, DSA, CSA/HCA and GDN/KDA from `config.json` presets or a pasted config; log-scored predictions; KV as a log, recurrent state as a checkpoint.
- *Ev:* the serving dossier's top delta; Alfieri 2013. *Code:* `src/lib/kv-zoo.ts`; `KvCacheSim.tsx:171–190`.
- *Risk:* misread configs → a second reader. *Metric:* 30-day log error.

**W7 · Tiling Cube (M).**
- Six prediction-opened levels: count the cube (AI = T/2 at FP16), SMEM budget, occupancy, raster order and L2 (AI ≈127 vs ≈950), FP8 (ridge ≈590), FlashAttention; all values [derived]. `Mirror2D.tsx` (three linked face views plus a DOM table) is the default; `Cube3D.tsx` opens on request.
- *Ev:* Clark 2016. *Code:* `src/components/play/tiling-cube/*`.
- *Risk:* spatial ability moderates learning from visualisations (Höffler 2010), so 2D is first-class and an opt-in 2-item spatial proxy stratifies the evaluation. *Metric:* 30-day fresh-item prediction error (§9).

W2 (Be the Scheduler, an interleaving play) waits in Wave 4.

### 5.5 F — Build in the Forge

**F1 · Template v2: per-check ABI in a Worker (L).**
- The only template change through Wave 3: `kslab::run(input, &CHECKS)` with `{only?, seed?}` in every `lib.rs`; `ks_abi_version()` with a host compatibility table; `ks_invoke` with a `probe` verb in all 8 systems labs (3 today); tracing through an export, `ks_trace_drain()`, never an import (zero imports is a security invariant); stage markers inside the existing TODO file.
- Each check runs in a fresh `lab.worker` instance with a 2 s timeout. Reference modules report `lab: '<id>@reference'` and earn no credit in ForgeLab, `validateModule` or the leaderboard.
- *Prec:* CodeCrafters. *Code:* `labs/kit`; `wasm-lab.ts:71,137`; `scripts/verify-wasm-lab.ts` (expect-trap becomes per-check); `ForgeLab.tsx:68–84`; `drivers.ts:47–55`.
- *Risk:* instantiation cost → a cached `Module`. *Metric:* per-check results on 18/18 crates; a reference earns 0 (CI).

**F2 · Staged labs (M).**
- Predict and run the reference; investigate with 3–5 harness items; modify a parameter; make the `TODO(you)` file in stages mapped to check ids (stage 1 a 2-minute win; every stage ≤25 min). Tiers: correct → efficient → survives.
- *Ev:* Lister 2004; Lopez 2008; Sentance 2019; Margulieux 2020. *Code:* `labs.ts`; `ForgeLab.tsx`.
- *Risk:* decompiled references → accepted. *Metric:* attempts-to-green per stage (descriptive).

**F3 · Zero-install lanes.**
- **(a) Compile bank (M).** ~150 snippets (~600 variants), compiled in CI against a pinned rustc. The learner names the code, the missing Read/Write/Own permission and the fix; `.clone()` is the lure. Snippets use serving domain objects and work on a phone. *Ev:* Crichton & Krishnamurthi 2024.
- **(b) Type and borrow checks via a 2024 Miri build, UB checks off (M; R drills only):** CodeMirror 6 + `lang-rust` (~162.5 KB gz) in a lazy chunk; a flatten script and a `#[cfg(miri)] fn main` emitting the same report; CI checks templates, solutions and error codes against the pinned rustc; the 54 MB download is sha256-pinned and needs consent. Figures are [single-machine], so re-measure on a mid-range laptop and an Android phone first.
- **(c) Build bot** and **(e) in-page rustc:** Wave 4.
- **(d) PowerShell, `.tar.gz`, Codespaces, folder watch (S).**
- *Code:* `scripts/build-rust-items.ts`; `src/lib/forge/*`.
- *Risk:* rustc drift → pinned toolchains. *Metric:* a graded Rust item on a phone; R1 green in ≤10 min once (b) ships.

**F4 · Rust on-ramp rewrite (M).**
- R3, R4, R8 and R9 are rebuilt on Read/Write/Own permissions with build-time Aquascope diagrams, an analyzer-limit-vs-UB segment and an Error Museum; t3.l1 retrieves rather than re-teaches; `codeLang` drives Java/Python ↔ Rust side-by-sides.
- *Ev:* Crichton 2023; Gentner 2003. *Code:* `src/data/lessons/r/*.ts`.
- *Risk:* nightly drift → build-time only. *Metric:* R KCs pass cold checks before lab 01.

**F7 · Capstone Zero repair and move (S).**
- Step 5 writes the cache append; accounting checks cache length; the speedup is measured from the learner's code; the solution reveal becomes a ladder; the capstone moves to after t5.l4, inside a sandboxed iframe (§7.3).
- *Code:* `Capstone.tsx:121–126,538–545,1301`.
- *Risk:* none significant. *Metric:* the one-token mutant fails.

**F8 · Field labs (S each; stretch).**
- Optional, on the learner's own or rented GPU, ≤1.5 GPU-hours each (≈$5 at the $3.39/h H100 median): after t5.l4, measure batch-1 decode and the KV-full concurrency against your Boot prediction; after t5.l7, replay the pinned BurstGPT slice with vLLM's benchmark CLI.
- *Code:* `labs.ts`.
- *Risk:* version churn → pinned commands as claims. *Metric:* `field` results (opt-in).

F5 (trace your own wasm) and F6 (lab 10) wait in Wave 4.

### 5.6 H — Help and prove

**H1 · Guardrail kit in every lab zip (S).**
- A deny rule plus a PreToolUse hook on `Edit|Write|Bash|mcp__.*` guard the `TODO(you)` file and fail closed (friction, not DRM); an explanation gate (state the failing check, its invariant and your hypothesis before any hint); a Socratic output style; an AI-use card labelled "hypotheses from a small preprint (N=52; groups n=2–7; speed-incentivised)".
- *Ev:* Sankaranarayanan 2026 (preprint, N=78, three arms); Bastani 2025. *Prec:* CS50's duck. *Code:* `labs/{AGENTS,CLAUDE}.md`; `pack-labs.py`.
- *Risk:* binds only opted-in agents → provenance. *Metric:* 18/18 zips compliant.

**H2 · Context packets (S).**
- "Ask claude/chatgpt" copies a ≤6,000-character packet to the clipboard (contract and rung, prediction, failing checks or `?cfg=`, sourced claims, a keyless tutor-mode lesson; all marked untrusted data); the deep link carries only a ≤500-character paste instruction.
- *Ev:* Kestin 2025; Tutor CoPilot. *Code:* `AgentActions.tsx:28–33`; `src/lib/mentor/packet.ts`.
- *Risk:* reading ahead → no code in the packet. *Metric:* URLs under 2 KB.

**H3 · Authored hint ladders (M).**
- Per check id and sim task: **R0** prompt-and-compare (write a teach-back, reveal three authored ideas, tick those covered; self-assessment, never credit); **R1** the concept, opened by any good-faith teach-back of ≥12 words; **R2** where to look; **R3** a ≤3-line pseudo-fragment; **R4** the design in prose.
- Bottom-out after R4 plus 2 red runs: a walkthrough to the first divergence, then re-implement after ≥24 h, credited `assisted` until an unseen-seed pass. "Ask a human" opens a prefilled Discussions post. Scaffolds fade from lab 04.
- *Ev:* VanLehn 2011 (an upper bound); Kestin 2025. *Code:* `labs/<lab>/tutor/ladder.json`; `lint-mentor.ts`.
- *Risk:* help avoidance → no hearts or delays. *Metric:* 30-day accuracy, ladder-first vs packet-only (randomized checks), with help-seeking reported.

**H4 · Prove it, no AI (S for v1; M for v2).**
- "Close your agent: 3 questions about your code." v1 is self-graded at practice weight, outside rings and VRK₃₀; v2 grades your prediction of your own module on a seeded trace (`probe`) and earns `proved`. One question returns at 30 days; retries use fresh questions after 24 h.
- *Ev:* Lister 2004. *Code:* `labs/<lab>/tutor/prove.json`; `ForgeLab.tsx:559–567`.
- *Risk:* the honour system → framed as calibration. *Metric:* ≥60% of greens attempted.

### 5.7 K — Keep and return

**K1 · Seeded generators (L).**
- Pure `Gen {kcs, make(seed, level), grade, solution}`: numeric with ratio diagnosis (exactly 2× → "you priced FP16"), log-scored 90% intervals, predict-run, compile, signature, why-slow, Parsons, map-it; fading from worked example to two-KC transfer at ~80% expected accuracy.
- *Ev:* Rowland 2014; Adesope 2017; van Gog & Sweller 2015. *Prec:* Execute Program. *Code:* `src/lib/items/*`; `verify-generators.ts`.
- *Risk:* a wrong number at scale → property tests and cue-ablation QA. *Metric:* ≥70% of KCs generated.

**K2 · Today (M).**
- 10–12 minutes, phone-first and offline. One `ts-fsrs` card per KC, created at the exit ticket (card creation, not lesson access, capped at ≤1.2/day). Due and threshold KCs first; interleaving only inside confusable sets; new cards pause when due items exceed two sessions. After ≥7 idle days, a 12-minute welcome-back set with the rest spread over 14 days, never an overdue count. Sized on the pessimistic case: ≈6–9 items/day while KCs arrive, ≈3–8 after [derived].
- *Set your week* (in Boot): minutes, session length, phone or laptop days, SLO 0.85 or 0.90; optional `.ics`. QR delta handoff; Today flags unmerged events from the other device.
- *Ev:* Cepeda 2008; Rawson & Dunlosky 2022. AI-era gains favour self-regulated learners (GenAI meta-analysis 2025). *Code:* `src/pages/Today.tsx`; `src/lib/learner/*`.
- *Risk:* flashcard-fitted defaults → an optimism offset. *Metric:* first-review recall within ±10 pts (Wave 1); 30-day recall within the SLO's CI (Wave 2).

**K3 · Placement, test-out, Up Next, search (S slice, then M).**
- A 15-minute adaptive placement (≤20 items) from six threshold KCs plus a Rust anchor, persisted as `{entryTrack, missedKcs, at}`; test-out on 3 fresh items; one `recommend()` with a one-line *why*, implementing the paths and braid (§4.D); ⌘K over a build-time index.
- *Ev:* Kalyuga 2003; Khajah 2016; Kulik 1990. *Prec:* Math Academy. *Code:* `src/lib/learner/recommend.ts`; `Home.tsx:77`; `CommandPalette.tsx:11–49`.
- *Risk:* false positives → a day-7 check. *Metric:* ≥85% of placements confirmed; nobody placed lands on R.L1; Boot → first T lesson in ≤3 days.

**K4 · Boot (M).**
- §4.A at 360 px, no install; its own roofline slider (no embedded sim) with a stepper (WCAG 2.5.7); every number a claim or [derived]. It ends with a value prompt (job and no-job variants), the path, *Set your week*, optional placement, an iOS install prompt and the "will feel harder" card.
- *Ev:* St. Hilaire 2023; Bertsch 2007; Crouch 2004; Kizilcec 2020 and Hulleman & Harackiewicz 2009 (population limits in Appendix A). *Code:* `src/pages/Boot.tsx`; `Home.tsx:182`.
- *Risk:* math-averse learners → "show me the step". *Metric:* every partner's first-success time (n≥5), with a median ≤4 min.

**K5 · The Mirror, `/me` (M).**
- Replaces `/progress`: VRK₃₀ and cold checks with intervals; calibration and the optimism offset; competence statements on ≥6 fresh items across ≥2 sessions. Track forms A/B/C come from generator unseen seeds, ≥12 items each (gain moves in ~8-point steps), order counterbalanced, gain labelled "including the pretest effect".
- *Ev:* Deslauriers 2019; Kornell & Bjork 2008. *Code:* `src/pages/Me.tsx`.
- *Risk:* noisy forms → track-level results only, with intervals. *Metric (opt-in):* C/B ≥0.8 with a CI.

### 5.8 The last mile

- **Evidence Pack (S).** A one-file HTML export of `proved` and `unseen` artifacts: lab metrics against the bestiary, Fleet Week receipts, the Daily record and calibration. It is previewed and makes no requests. The copy describes artifacts, not identity (Gollwitzer 2009). *Code:* `src/lib/evidence-pack.ts`.
- **Production twins (S per lab).** Three tracing questions on the upstream counterpart at a pinned SHA (a 60-day version claim): lab 07 ↔ SGLang's Rust TreeCore (PR #39627); to verify, lab 06 ↔ vLLM's scheduler, lab 02 ↔ its KV cache manager, lab 03 ↔ HF tokenizers, lab 04 ↔ crossbeam. *Code:* a `twin` field on `ForgeLab` (`labs.ts:21`).
- **Interview mode (M; stretch; untimed).** A napkin round, a seeded incident and a T7 capacity design. An H2 packet makes the learner's agent a skeptical interviewer, with objections seeded in code. *Code:* `src/pages/Drills.tsx`; `src/lib/mentor/packet.ts`.
- **OSS lower rungs (S).** Reproduce a published number, then file an evidence-backed upstream issue. *Code:* `reproductions/` plus `validate-reproduction.yml`, mirroring the leaderboard flow.
- **Bring-your-own-service capstone (M; stretch).** Size KV, batching and $/Mtok for your own trace, on-device. *Code:* `parseTraceArtifact` (`traces.ts:119`, kind `local-derived`); `src/lib/kv-zoo.ts`.

## 6. Content upgrade map

### 6.1 Errors to fix now (Wave 0)

| # | Error | Where | Fix |
|---|---|---|---|
| 1 | t0.l4 key marks correct work wrong | `t0/aos-vs-soa.ts:37,60,178,189–193`; `layoutLab.tasks.ts:6` | 1/4 |
| 2 | CFS taught as current | `t2/scheduling.ts:30,35,50`; `processes-threads.ts:38,63`; `toy-executor.ts:117,197` | EEVDF since Linux 6.6 |
| 3 | "2 × 61" all-to-alls | `t6/moe-anatomy.ts:24,36` | 2 × 58 (first 3 layers dense) |
| 4 | V0 vLLM semantics | `pagedattention-deep-dive.ts:92–96`; `production-stack.ts:23–25` | V1 recompute preemption; refcount-0 blocks stay cached |
| 5 | B200 "192 GB"; 671B FP4 "fits a 2-node NVL72 pair" | `t6/fp4-blackwell.ts:16,34`; `fleet-week.ts:270` | ≈180 GB shipped; NVFP4 ≈377 GB [derived] fits one 8×B200 node |
| 6 | Act III prices undated or unsourced | `fleet-week.ts:267–272`; `fleet-model.ts:409` | dated claims (H100 $3.39, B200 $6.25/GPU-hr); $900, $25 and $7.5/hr labelled synthetic; B200 ≈$6.43/Mtok, not $15.43 [derived, v1 flat-tick physics; not a real-world $/Mtok] |
| 7 | Tiled AI given three ways | `matmul-tiling.ts:26`; `RooflineSim.tsx:14,293` | T/2 per FP16 tile |
| 8 | KVBM taught as current | `epd-disaggregation.ts`; `rust-zig-c-decision.ts:27,112`; 3 more files | deprecated in Dynamo v1.5.0 (2026-09-21) |
| 9 | NIXL "a Rust library" | `epd-disaggregation.ts:10,26` | C++ with Rust bindings |
| 10 | t0.l2 Q3 key; fig 1 wiring | `memory-hierarchy.ts:60–66,132–141` | dispatch, boxing, no SIMD; L1→L2→L3 |
| 11 | Draft artefacts | `pagedattention-deep-dive.ts:22`; `exam-pagedattention.ts:87` | delete |
| 12 | Loose isomorphism pairs | `toy-allocator.ts:157–161`; `scheduling.ts:69–72` | rewrite with `breaks` |
| 13 | Two K ranges for speculation | `speculative-chunked.ts:65`; `speculative-production.ts:36` | one function |
| 14 | Double XP; Capstone step 5; R badge | `Track.tsx:233`; `Capstone.tsx:538–545`; `badge-r.svg` | delete; F7; add |

### 6.2 Per track (2026-10)

| Track | Deltas (each becomes a claim) | New active work |
|---|---|---|
| R | compile bank pins its own rustc (rust-analyzer dropped its borrow checker) | braid; compile bank; F4 |
| T0 | SRAM-chip rungs (Groq 3 LPX: 500 MB at 150 TB/s per LPU; WSE-3 44 GB); HBM4 | Boot; prequestions |
| T1 | vLLM uses one page size across layer types | placement play; lab 01 PRIMM |
| T2 | EEVDF; SLRU/T-LRU and KV-TTL eviction; TGI archived | exit tickets; checkpoint |
| T3 | Rust is winning parts of the CPU path (frontends, routers, radix cache, EPP). The vLLM Rust frontend's 837 vs 162 req/s used a tiny model at 1,024 concurrent requests, preprocess-bound (Qwen3-0.6B, DP=4, 4×GB200): not a general speedup | compile bank; t3.l1 spiral |
| T4 | B300 and Rubin presets, flagging the HGX page's Rubin discrepancy (22 TB/s per GPU vs ≈16 implied by NVL8 totals); why the FP16 ridge fell [derived]; FA4 in CuTe DSL | predict-first roofline; cube |
| T5 | MRV2 default (vLLM v0.29.0); hybrid KV groups; SWA radix hit rate 43.8→60.8% (SGLang v0.5.20); cache price tiers | Attention Zoo; scheduler play; twins |
| T6 | Kimi K3 (16 of 896 experts); Rubin CPX dropped from GTC slides, not cancelled; Copilot KV hit 90%→55% across turns; determinism (80 unique of 1,000 → 1, Thinking Machines; BF16 vs FP16 diverge on 49–100% of prompts, TMLR 2026) | generators; Fleet exercises; EPLB; t6.l12 on attention–FFN disaggregation (Step-3, MegaScale-Infer; stretch) |
| T7 | InferenceX/AgentX; dated $/GPU-hr; price = f(cost, load, cache state) | generators; Fleet exercises |

**Fleet Week receipts** (S, Wave 3) replace the keyword checks:
- Each number in an analysis cites a run hash, which the page re-runs to verify the value within tolerance.
- The screenshot requirement is retired.
- Learners self-review against 3 scored exemplars on a 4-criterion rubric: capacity math, SLO reasoning, cost sensitivity, failure modes.

### 6.3 Stale numbers become claims

| File:line | Now | Claim (2026-10-03) | TTL |
|---|---|---|---|
| `t7/unit-economics.ts:20` | "H100 $2–3/hr" | median $3.39, cheapest $1.30 | 90 d |
| `t7/unit-economics.ts:32,44` | "API prices fell ~80%" | not monotone; B200 rental +17% YoY | 90 d |
| `KvCacheSim.tsx:171–190` | GQA only; 2023 presets | atlas rows | 365 d |
| `RooflineSim.tsx:62–66` | stops at B200 | + B300, Rubin, TPU7x | 365 d |
| 11 InferenceMAX mentions | "InferenceMAX nightly" | InferenceX v2, AgentX | 60 d |

**Freshness pipeline:**
- **Every deploy** blocks on the claim schema, derived drift, spec and price literals outside the atlas, errata, and citations.
- **Weekly:** the watcher digest (once justified), expiring claims and link rot raise amber badges and an issue. They never block.
- **Monthly:** a 10% quote re-check.
- **Quarterly:** Field Notes, plus compile-bank and Miri pin updates.

**Rules:**
- Model names live in presets only.
- No lesson rests on hardware without a public spec sheet and an independent benchmark.
- Prices are dated ranges with a TTL of ≤90 days.

---

## 7. Architecture

### 7.1 Data model and the one migration

**Today:** state `version: 2`, persist `version: 3`, key `kernelspace:v1`.

**v3:** truth moves to IndexedDB (`ledger`, `components`, `meta.schemaVersion`), with a derived snapshot under a **new key, `kernelspace:v2`**. Static content (KC graph, items, claims, atlas) is CI-verified; the learner model is always derived.

> **Superseded by OD1 (decided 2026-10-04): start fresh.** The ledger starts empty under the new key and old `kernelspace:v1` data is ignored. The schema guard, cross-tab sync and import/export rules below still apply; the legacy-migration points (1, 2, 5) and the pre-v3 badge/Recertify do not.

**Migration (idempotent, mixed-version safe):**
1. **Deterministic legacy ids.** Legacy events get ids `legacy:<kind>:<ref>:<completedAt>`, so re-migration and re-import dedupe. Labs become `legacy` `lab-check` events; clicks become "introduced"; best scores become "practiced". `legacyXp` is the maximum across devices.
2. **Read-only old key.** `kernelspace:v1` becomes read-only legacy input, re-projected idempotently on change, so stale-tab writes are captured. zustand 5.0.14 migrates on any version mismatch, including downgrades; hence the new key.
3. **Schema guard.** A bundle that sees a newer `schemaVersion` goes read-only and prompts a reload.
4. **Cross-tab sync.** A BroadcastChannel rebuilds snapshots in other tabs.
5. **Pre-migration backup.** Downloads automatically.
6. **Service worker.** Ships only with a self-unregister kill switch, a network-first `index.html` and the schema handshake.
7. **CI property tests.** Double-migrate, double-import, stale-tab write and two-device merge all yield identical ledgers.

**Export v3** adds the ledger, components (sha256, with bytes optional) and Capstone drafts. Import accepts versions 1–3.

**What learners see:** a one-time "What changed and why" screen; the old rank and achievements frozen under a "pre-v3" badge (new achievements derive from the ledger); and **Recertify**: old modules re-run at once and earn `lab-green` (v1 ignores seeds), a one-command template-v2 rebuild runs them on unseen seeds, and a 15-minute item sweep per track follows.

### 7.2 Blocks, anatomy, scheduler, tutor layers

**New block types (cap four):** `predict`, `item`, `play`, `protege`.

**Extended:** `QuizQuestion`, `DiagramBlock.predictAt`, `ExerciseBlock.fleet`, `SimTask.predict/explain`, `IsomorphismPair.breaks/work`, `Lesson.kcs/prereqs/rev`.

**Lesson anatomy:** hook and prequestions (≤2 min); segments of ≤12 min, each ending in a graded interaction; one play or sim; an active isomorphism; the exit ticket; a "Build this" card; Up Next. At most one gate per ~4 minutes of reading; `verify-lessons` enforces the anatomy and recomputes declared minutes.

**Scheduler:** `ts-fsrs`, default FSRS-6 weights, plus one optimism offset. Implicit credit (`S_Y ← S_Y + w·(S_good − S_Y)`, pruned below w=0.2; failures weaken containers by `S·(1 − w/2)`) is **untested**. It counts no savings until cold checks confirm retention.

**Tutor layers:** L0 (authored) and L1 (the learner's own agent) are in plan; L2 BYOK is deferred (OD8); L3 on-device is rejected.

### 7.3 Routes, performance, mobile, accessibility, security

**Routes:**
- New: `/boot`, `/today`, `/me` and `/freshness`.
- `/progress` redirects to `/me`.
- `/freshness` holds errata, claims and later physics as tabs; `/field-notes` redirects there.
- All new routes join `staticRoutes` in `scripts/prepare-pages.mjs`, keeping HTTP 200.

**Performance:**
- `React.lazy` on all 16 pages and every sim.
- Main chunk ≤250 KB gz (725 KB today [measured]).
- `/boot` and `/today` ≤200 KB gz each (TTI ≤3 s on a mid-range phone at Fast 4G), offline after the first visit.
- Navbar and StatusBar read only the persisted snapshot, never ledger, KC or FSRS modules.
- **SimHost.** Config comes from props and syncs to the URL only on `/lab/*`; inline embeds would otherwise rewrite the host's `?cfg=` (`PlaygroundShell.tsx:155–198`). No iframes, which would boot a second store.
- **`lab.worker`** (2 s per check) runs grading and `validateModule`, which today runs on the main thread (`drivers.ts:47–55`).
- **Fleet Week batches** run in a worker; their `disrupt` closure (`fleet-week.ts:122–140`) becomes a serializable FaultSpec.
- Interactive panels stay at one tick per frame.

**Mobile contract:**
- Lessons are fully usable at 360 px.
- Embedded sims get a phone mode: predict, see the canonical outcome as a chart and table, and queue the hands-on task "for laptop".
- Forge and Fleet are labelled laptop-only.
- The 54 MB Miri and ~400 MB model downloads need consent.

**Accessibility (WCAG 2.2 AA gate):**
- `text-3` lightened to ≥4.5:1 in Wave 0a (OD12).
- `MotionConfig reducedMotion="user"`.
- Keyboard alternatives to drags.
- DOM mirrors for the ~10 canvases and every play, checked by `verify-plays`.
- axe at 360 and 1280 px on 12 routes: `/`, `/boot`, `/today`, `/me`, `/curriculum`, `/tracks/t5`, `/lesson/t5.l4`, `/lesson/r.l3`, `/lab/roofline`, `/forge/rust-allocator`, `/fleet`, `/freshness`.
- A VoiceOver (iOS) and NVDA (Windows) pass at every wave exit.

**Security:**
- Capstone JS runs in a sandboxed opaque-origin iframe (`allow-scripts` without `allow-same-origin`) that hosts a worker.
- A meta CSP follows, with `'wasm-unsafe-eval'` and no `'unsafe-eval'` (`Capstone.tsx:78`). Meta CSP does not govern workers.
- Zero-import wasm is an invariant.
- Disclosed third parties: Google Fonts, the transformers.js CDN, giscus, GitHub.

### 7.4 Verification (extends PLAN-WORLDCLASS §10)

**§10 stands**, amended for per-check isolation. Playwright becomes a committed devDependency.

**Fast gate** (`deploy.yml`, <3 min, blocking): `setup-bun`, pinned as in `validate-leaderboard-submission.yml`; lint and build; `verify-items`, `-kc`, `-claims` (structural), `-errata`, `-generators`, `-lessons`, `-citations`; the determinism lint; bundle budgets; the route list.

**Heavy lane** (nightly; files an issue, never blocks): cross-browser hashes, axe, FSRS load, separability, `build-rust-items`, Miri drills, claim expiry and link rot.

**Cue-ablation QA** (local; outputs committed) replaces "blind-solver" checks, which frontier models fail on domain knowledge alone. The maintainer's agent answers each item three ways:
1. **Options only.** Beating chance by >15 pts across 2 runs fails the item.
2. **Numbers perturbed.** Keeping the old key flags it.
3. **With the lesson.** Unanswerable, or disagreeing with the key, flags it.

It gates only after validation on ~50 hand-labelled items, with false rejects reported.

**Determinism lint:** no `Math.exp/log/pow` or trig in seeded paths (`src/lib/fleet-*`, `world/*`, `physics/*`). `SCORE_TOLERANCE` 0.01 (`leaderboard.ts:17`) cannot absorb divergence.

**Thresholds:** every pass bar is proven against FCFS, SJF and the reference. Nothing [unverified] ships.

---

## 8. Roadmap

**Fixed capacity, variable scope.**
- **Calendar.** Starts Monday 2026-10-05. Weeks 12–13 (2026-12-21 → 2027-01-03) are off.
- **Review hours are the binding constraint.** Code QA is costed at 4, 8 or 20 h per S, M or L, plus content, partner and a11y time.
- **Cap.** 10 h/week, plus ≤2 h of triage.
- **Gating.** A wave starts only when the previous wave's queue is under 10 h.
- **Stretch items** enter in order while the queue stays under 10 h; otherwise they roll into Wave 4.

**Wave 0a — Stop paying for clicks** (weeks 1–2, → 2026-10-18; 20 h)
- *Scope:* V1 shuffle and exporter ids; `m` pays 0, the double-XP copy goes, streaks count graded local days; errata #1, #11 and #14; `badge-r.svg`; `/week` in the nav; Scores out; F7; the CI fast gate; the contrast token; partner recruitment.
- *Exit:* always-B ≤ chance + 2 SD; `m` pays 0; the one-token Capstone mutant fails; the fast gate runs in <3 min.

**Wave 0b — One ledger, one truth, a first whoa** (weeks 3–10, → 2026-12-13; 80 h)
- *Scope:* V3 with migration and "what changed" (20); workers, lazy routes, budgets (8); S3 (4); errata #2–10, #12–13 and Changes (12); S4 cards (4); T0–T2 distractors (4); V2 (4); S2 v0 (11); **K4 Boot** (11); baseline cold checks (2).
- *Exit:* §7.1 property tests pass; always-longest ≤1/19 in T0–T2; no untrusted wasm first runs on the main thread; no Fleet Week task over 50 ms; 0 known errors; Boot timed per partner (n≥5) at ≤200 KB gz.

**Wave 1 — The first complete loop** (weeks 11–29, → 2027-04-25; 17 working weeks; 169 h)
- *Scope:* F1 template v2 (20); Capstone sandbox and CSP (4); SimHost, registry, phone mode, 3 P2 sims, 3 mirrors (18); V4 v1 (13); K1 with 3 families (17); K2 (18); K3 slice (6); T0–T2 tickets and RING 2 (11); P1 for T0–T1 (10); W1 and the **block-placement play** (12); F2, H3 and H4 v1 for lab 01 (26); H1 (4); giscus (4); partners (6).
- *Exit:* **≥5 partners complete the block-placement loop**: prequestions → play → lab 01 stages → unseen-seed pass → Today; first-review recall within ±10 pts of predicted, plus a 7-day cold check; blind strategies ≤5/68; per-check results; reference modules earn 0; median Today ≤12 min.

**Wave 2 — Play, frontier, Forge without the wall** (weeks 30–43, → 2027-08-01; 140 h)
- *Scope:* W1 scheduler play, Compose and In-production card (14); W3 Daily on own components and Act IV (12); W4 (8); K3 (11); V4 v2 (7); K1 +4 families (12); T3–T7 tickets (5); P1 T4–T5 (3); W6 (11); F4 (14); F3a (13); F3d (4); labs 02–03 (6); H2 (4); 7 mirrors (7); backtest (3); partners (6).
- *Stretch:* F3b after re-measurement (8); Evidence Pack (6); Team kit (5): facilitator notes, shared Daily seeds for team Wheel-of-Misfortune sessions, private boards as gists.
- *Exit:* **30-day recall within the SLO's CI on ≥140 pooled checks**, ≥35 days after K2 reached partners; `PolicySpec` ≡ reference; blind strategies ≤2/68; Act IV passes only on unseen seeds; ≥10/15 T6/T7 lessons hands-on; nobody placed lands on R.L1; Boot → first T lesson ≤3 days; the Daily works at 360 px and by keyboard.

**Wave 3 — Depth, proof, last mile** (weeks 44–54, → 2027-10-17; 102 h)
- *Scope:* W5 Fleet exercises, EPLB play and 2 families (19); receipts (7); H4 v2 (10); labs 04–08 (10); P3 (14); K5 (8); remaining P2 (4); **W7 Tiling Cube** (10); twins for labs 07 and 06 (4); S4 watcher if justified (10); partners (6).
- *Stretch, in order:* W7 3D evaluation (8); t6.l12 (6); more W5 exercises (12); Interview mode (8); 2 field labs (8); On-Call pilot (6); Season 0 (4: 7 dated seeds, nothing to moderate); BYO-service capstone (8); P4 (7); a T0/T4 measured-vs-predicted real-engine run (4; Wi-Fi and consent).
- *Exit:* 15/15 T6/T7 hands-on; receipts validate Fleet Week; `proved` live on ≥3 labs; `/me` intervals; the journey re-cut.

**Wave 4 — Gated, each with a date and a default**

| Item | Gate | Not before | Default |
|---|---|---|---|
| Cube 3D as default | within-learner non-inferiority (§9) | 2027-12 | opt-in |
| S5 physics v2 → step-time exercises, Device Mesh, Throughput Factory | η fitted on a subset of published points; leave-one-out error ≤15% per hardware row (SGLang's ~6% simulator is vendor-reported precedent only) | 2027-10 | v1 + generators |
| F6 lab 10 + t6.l11 | tier 2 calibrated against the lab's own naive vs shipped references. Planning toy: in 2,000 of 2,000 random length-4,096 f32 dot products, ≥2 of 7 split counts gave different bits; 7 greedy decodes gave one completion [toy model, random weights, not an LLM]; real models hit near-ties often | 2027-10 | labelled-toy lesson |
| Agent-session Fleet mode (+ lab 07 `ttl_ms`) | Copilot statistics registered as claims | 2027-11 | t6.l8 generators |
| On-Call shift | Daily KCs' 30-day diagnosis ≥ non-Daily, or favourable think-alouds | 2027-12 | none |
| W2 Be the Scheduler; F5 trace-your-own-wasm | lab 04 data from ≥5 partners; red-to-green binds | 2027-11 | T2 prose; ladders |
| Lab 11 EPP router (Rust); lab 09 suffix drafter; PyO3 bridge | router slot stable; ≥3 partners finish lab 08; ≥3 requests | 2027-11; 2028-01; 2027-12 | none |
| F3c build bot (OD4); F3e in-page rustc | loop re-measured; F3e ≤3 s per lab | 2027-10; 2028 | local lanes |
| K1 v2; learner item PRs | ≥70% KC coverage; queue slack | 2027-11 | hand items |
| Seasons, peer review, credentials | ≥15 giscus posters/month for 3 months; ≥10 team kits forked | 2028 | — |

### 8.1 Capacity plan

| Wave | Working weeks | Code QA h | Content h | Partners/a11y h | Total h | Cap h |
|---|---|---|---|---|---|---|
| 0a | 2 | 15 | 3 | 2 | 20 | 20 |
| 0b | 8 | 60 | 18 | 2 | 80 | 80 |
| 1 | 17 | 124 | 39 | 6 | 169 | 170 |
| 2 | 14 | 68 | 66 | 6 | 140 | 140 |
| 3 | 11 | 56 | 40 | 6 | 102 | 110 |
| **Total** | **52** | **323** | **166** | **22** | **511** | **520** |

**Content** covers ~800 distractor whys, ~120 misconceptions, ~160 KCs, 128+ claims, 12 generator families, ~650 rungs and ~150 compile snippets.

**Cut order:** stretch items, then W5's Fleet exercises, then P3's work analogues, then K5's track forms.

### 8.2 Steady state

**Expected load:** ≈4.5 h/week [estimated], against a ≤4 target:
- weekly triage ≤1.5 h (re-derived once S4's ≥8-week backtest runs), plus errata, giscus and merges: ~3 h;
- monthly claims and generator fixes: ~3 h;
- quarterly Field Notes, a partner round, pins and a manual a11y pass: ~10 h.

**Vacation mode:**
- only structural CI blocks;
- expired claims show "stale since";
- Today, the Daily and labs run offline;
- an `AGENTS.md` playbook lets agents draft triage, errata and re-pins, and a human merges.

---

## 9. Measurement and experimentation

**On the device:** VRK₃₀, active minutes, attempts per KC, cold checks, calibration, attempts-to-green, the unseen-seed gap, help-seeking and Prove-it rates.

**Comparing variants without a server: within-learner randomization.**
- For each keep/kill feature, code randomizes each learner's eligible KCs to either the feature or a matched alternative. Examples: ladder-first vs packet-only help; P4 vs reading the same correction; cube levels × view, fully counterbalanced.
- The outcome is 30-day cold-check accuracy on fresh items.
- Thresholds and non-inferiority margins are pre-registered in `docs/prereg/<feature>.md` before any data arrives.
- Partners donate redacted exports privately: week-level dates, no free text, no hashes.
- Where n cannot reach adequate power by the dated deadline, the decision is a qualitative judgement from think-alouds, and the default is the cheaper option.
- "Ladders ship lab by lab" is a *staggered rollout*, reported descriptively.

**Opt-in aggregates.**
- One bucketed issue form, labelled *public and tied to your GitHub identity*.
- No randomized response. It would add only per-field deniability (ε≈2.6) and inflate variance ≈1.8× [derived].
- A nightly Action publishes `public/outcomes.json` only for fields with n ≥30, always as "among n opt-in reporters (self-selected)" with a CI.
- Donated item logs drive rewrites (Crichton & Krishnamurthi 2024).
- No causal claims.

**Keep/kill rules**, each with a date and a default:

| Feature | Keep if (pre-registered) | Decide by | Default if underpowered |
|---|---|---|---|
| Exit tickets | median ≤4 min; ≥70% pass within two tries | Wave 2 exit | 2 items |
| Today | median ≤15 min; recall within the SLO's CI | Wave 2 exit | fewer new cards; SLO 0.85 |
| Hint ladders | 30-day accuracy non-inferior (5 pts) to packet-only help | Wave 3 exit | R0–R2 only |
| A play | non-inferior (5 pts) to reading plus sim at 30 days; favourable think-alouds | ship + 60 d | optional sim |
| Fleet Daily | Daily KCs' 30-day diagnosis accuracy on unseen seeds ≥ non-Daily KCs' | Wave 3 exit | weekly; no On-Call |
| Cube 3D | non-inferior to the 2D mirror, with no time cost | 2027-12 | opt-in |
| P4 | 30-day discrimination favours it | Wave 3 + 60 d | one per track |
| Prove-it | ≥60% of greens attempted | Wave 2 exit | 1 question |
| Watcher | backtest precision and recall justify the hours | Wave 3 | manual scan |

**Observable without tracking:** giscus posters, posted Daily share strings, and forked team kits.

---

## 10. Risks, anti-patterns, and what we will not build

| Risk | Mitigation |
|---|---|
| Review hours saturate (≈511 h) | queue gate; stretch lists; cut order; OD11 |
| Agent-drafted errors | cue-ablation QA; property tests; verification logs |
| FSRS miscalibrated for skills | pessimistic sizing; optimism offset; cold checks |
| Migration loses or duplicates history | §7.1; property tests; automatic backup |
| Storage eviction | iOS install prompt; backup nudge; QR handoff |
| Completion time swells (≈75–110 h) | Set your week; card cap; re-entry rule |
| Agents do the work | provenance; unseen seeds; H4 v2 |
| False precision | [derived] checked in CI; flat-tick and synthetic labels |

**We will not build:**

| What | Why |
|---|---|
| Game engines, WebXR, photoreal hardware, lore, loot, avatars | §5.4.0 |
| Runtime LLM-generated items; LLM-graded XP, rings or credentials | unsourced numbers; Boot.dev admits "AI-slop"; LLM raters agree only at α 0.52–0.65 before deliberation |
| In-page BYOK drawer; on-device rubric classifier | key custody, CORS fragility (OpenAI's browser CORS broke twice in four months) and zero-server. The evidence is mixed: Kestin found gains under enforced structure (~16–30% on re-analysis); Bastani's guarded tutor showed no significant exam gain; Khanmigo's ITT was 0.06–0.08 SD |
| Hearts or delays on hints | help avoidance is the problem |
| Plugin or MCP before L0 and Prove-it | binds only opt-in learners; spec churn |
| Credentials, peer review or Seasons before a community exists | 0 leaderboard entries; moderation load |
| Timers, speed bonuses, hard locks, loss-framed streaks, XP leaderboards | Kulik 1990; Silverman & Barasch 2023; harm appeared under speed pressure |
| Owner-paid proxy, grading server, anonymous endpoint | each breaks zero-server |
| Good-first-issue rungs; a study contract as core | GFIs are scarce (vLLM 21, Dynamo 7, candle 0) and newcomer merges fell 61.9%→42.2% (Hoshikawa 2026, preprint); Patterson's reminder arm was null |
| "100×" or "2σ" in learner-facing copy | Kraft 2020; von Hippel 2024 |

---

## 11. Owner decisions

| # | Decision | Options | Trade-offs | Recommendation |
|---|---|---|---|---|
| OD1 | Legacy progress | frozen pre-v3 badge plus Recertify; recompute; keep XP live; start fresh | honest vs feels like deletion vs keeps click-earned ROOT vs simplest | **Decided 2026-10-04: start fresh.** kernelspace is new, so there is no legacy cohort to protect. v3 ignores `kernelspace:v1`; no migration, pre-v3 badge or Recertify |
| OD2 | Where LLM triage runs | locally; in Actions with a secret | attention vs spend and key custody | locally |
| OD3 | Outcome channel | public issue form; anonymous endpoint | identity-linked vs breaks zero-server | bucketed issue form, n ≥30 |
| OD4 | Build bot | offer opt-in; don't | zero-install vs public solutions | Wave 4, opt-in |
| OD5 | Hosting Miri (54 MB), future rustc | Pages + cache; a mirror | 100 GB/month soft cap vs another third party | Pages, bandwidth watch |
| OD6 | play.rust-lang.org lane | never; ask its maintainers first | one community server, no API terms, code leaves the machine | not in this plan |
| OD7 | Community | giscus, Team kit, Season 0; Discord or Zulip | relatedness vs moderation load | giscus in Wave 1 |
| OD8 | BYOK tutor, plugin, MCP | defer; build in Wave 3 | convenience vs key custody and zero-server | defer |
| OD9 | 3D evaluation | 2D default + opt-in 3D + pre-registered test; 3D default | same burden of proof as any seductive detail | 2D default |
| OD10 | Design partners | ≥8, including ≥2 new grads, ≥2 ML engineers, 1 phone-first and 1 screen-reader user; skip | owner time vs validating K-12 assumptions | recruit; private redacted exports |
| OD11 | Review capacity | 10 h/week (ends 2027-10-17); 15 h/week (~2027-06); cut Wave 3 | pace vs sustainability | 10 h/week; revisit at the Wave 1 exit |
| OD12 | `text-3` contrast | lighten to ≥4.5:1 (e.g. #7A889C); keep | brand tone vs AA | lighten |

---

## Appendix A — Evidence table

These effects come from aligned, researcher-made tests, mostly with K-12 or undergraduate samples. They do not add up. Field effects are typically ~0.1 SD (Kraft 2020), so expect tenths of an SD.

| Technique | Effect | Boundary | Source |
|---|---|---|---|
| Retrieval vs restudy | g=0.50; cued recall 0.61 vs recognition 0.29 | feedback effect in this meta-analysis only | Rowland 2014 |
| Practice testing | g=0.61; mixed formats 0.80 | similar with or without feedback | Adesope 2017 |
| Transfer of testing | d=0.40 | needs application items | Pan & Rickard 2018 |
| Spacing | gap ≈5–10% of a 1-year horizon | mostly verbal | Cepeda 2008 |
| Interleaving | g=0.42; words −0.39 | similar categories | Brunmair & Richter 2019 |
| Prequestions | g=0.54 vs 0.04 | mostly the asked content | St. Hilaire 2023 |
| Productive failure | 0.36 conceptual; −0.03 procedural | needs consolidation | Sinha & Kapur 2021 |
| Case comparison | d=.50 overall | larger with active alignment | Alfieri 2013 |
| Rewards | completion-contingent −0.36; informational +0.33 | weaker in college students | Deci 1999 |
| Mastery gating | self-paced programs reduce completion | college | Kulik 1990 |
| Doer effect | >6× learning per SD of doing | one MOOC; correlational | Koedinger 2015 |
| Step-based tutoring | d=0.76 (human 0.79); answer-based systems lower | ITS with step-level feedback; K-12 and college STEM; vs no tutoring | VanLehn 2011 |
| Unguarded AI | practice +48%, exam −17%; a guarded tutor ≈0 | one Turkish high school | Bastani 2025 |
| AI while learning | 50% vs 67% (d=0.738) | preprint; N=52; speed-incentivised; immediate quiz | Shen & Tamkin 2026 |
| Explanation gate | 39% vs 77% blackout failure | preprint; N=78; three arms | Sankaranarayanan 2026 |
| Engagement binds | ITT 0.06–0.08 SD; help sought in 17% of mistake sessions | middle school | Oreopoulos & Low 2026 |
| Self-regulation and AI | g 0.863 vs 0.284 | higher-order outcomes | GenAI meta-analysis 2025 |
| Simulation | g=0.85 | vs other instruction | Chernikova 2020 |
| Games | multi-session 0.44 vs 0.08; schematic 0.48 vs realistic −0.01; narrative 0.44/0.63/0.17 (none/irrelevant/relevant) | K-16; small k; directional | Clark 2016 |
| Intrinsic integration | 7× voluntary time-on-task | n=16 children aged 7–11; time, not learning | Habgood & Ainsworth 2011 |
| Seductive illustrations | retention cost d≈0.95 | secondary source | Rey 2012 via Tislar & Steelman 2021 |
| Immersive VR | −0.80 in one study; meta-analysis +0.24 | N=52; 35 RCTs | Makransky 2019; Wu, Yu & Gu 2020 |
| Spatial ability | moderates learning from visualisations | effect sizes not retrieved | Höffler 2010 |
| Ownership model | d=0.56 | self-selected readers | Crichton 2023 |
| Item rewrites | +20% in 10 of 12 | server-logged | Crichton & Krishnamurthi 2024 |
| PRIMM | post-test above control | K-12; non-randomized; no effect size | Sentance 2019 |
| Nudges at scale | plan-making ~20× smaller; value-relevance +2.79 pp | value-relevance: less-developed countries, global-gap courses only | Kizilcec 2020 |
| Utility value | interest and grades up | low-expectancy high-school students | Hulleman & Harackiewicz 2009 |
| Identity intentions | acted on less | strongly committed only | Gollwitzer 2009 |
| Protégé diagnosis | +0.72 points on a 1–6 scale | correlational; preliminary; n not reported | Kucharavy 2025 |
| Tutoring benchmarks | tutoring 0.33–0.37 SD; 2σ not replicated | — | von Hippel 2024 |

## Appendix B — Sources

- **Learning science:** Kraft 2020 <https://doi.org/10.3102/0013189X20912798>; von Hippel 2024 <https://www.educationnext.org/two-sigma-tutoring-separating-science-fiction-from-science-fact/>; Rowland 2014 <https://doi.org/10.1037/a0037559>; Adesope 2017 <https://doi.org/10.3102/0034654316689306>; Pan & Rickard 2018 <https://doi.org/10.1037/bul0000151>; Cepeda 2008 <https://doi.org/10.1111/j.1467-9280.2008.02209.x>; Rawson & Dunlosky 2022 <https://doi.org/10.1177/09637214221100484>; Brunmair & Richter 2019 <https://doi.org/10.1037/bul0000209>; Kornell & Bjork 2008 <https://doi.org/10.1111/j.1467-9280.2008.02127.x>; St. Hilaire 2023 <https://doi.org/10.3758/s13423-023-02353-8>; Bertsch 2007 <https://pubmed.ncbi.nlm.nih.gov/17645161/>; Kalyuga 2003 <https://doi.org/10.1207/S15326985EP3801_4>; van Gog & Sweller 2015 <https://doi.org/10.1007/s10648-015-9310-x>; Sinha & Kapur 2021 <https://doi.org/10.3102/00346543211019105>; Alfieri 2013 <https://doi.org/10.1080/00461520.2013.775712>; Gentner 2003 <https://doi.org/10.1037/0022-0663.95.2.393>; Bisra 2018 <https://doi.org/10.1007/s10648-018-9434-x>; Chi & Wylie 2014 <https://doi.org/10.1080/00461520.2014.965823>; Koedinger 2015 <https://doi.org/10.1145/2724660.2724681>; Crouch 2004 <https://doi.org/10.1119/1.1707018>; Butterfield & Metcalfe 2001 <https://doi.org/10.1037/0278-7393.27.6.1491>; Metcalfe & Finn 2011 <https://pmc.ncbi.nlm.nih.gov/articles/PMC3079415>; Roediger & Marsh 2005 <https://doi.org/10.1037/0278-7393.31.5.1155>; Haladyna 2002 <https://doi.org/10.1207/S15324818AME1503_5>; Attali & Bar-Hillel 2003 <https://doi.org/10.1111/j.1745-3984.2003.tb01099.x>; Deslauriers 2019 <https://doi.org/10.1073/pnas.1821936116>; Deci 1999 <https://doi.org/10.1037/0033-2909.125.6.627>; Kulik 1990 <https://doi.org/10.3102/00346543060002265>; VanLehn 2011 <https://doi.org/10.1080/00461520.2011.611369>; Koedinger 2023 <https://doi.org/10.1073/pnas.2221311120>; Khajah 2016 <https://arxiv.org/abs/1604.02416>; Silverman & Barasch 2023 <https://doi.org/10.1093/jcr/ucac029>; Kizilcec 2020 <https://pmc.ncbi.nlm.nih.gov/articles/PMC7334459>; Hulleman & Harackiewicz 2009 <https://doi.org/10.1126/science.1177067>; Gollwitzer 2009 <https://pubmed.ncbi.nlm.nih.gov/19389130/>; Patterson 2018 <https://www.gwern.net/doc/psychology/personality/conscientiousness/2018-patterson.pdf>.
- **Computing education:** Hundhausen 2002 <https://faculty.cc.gatech.edu/~john.stasko/papers/jvlc02.pdf>; Naps 2002 <https://doi.org/10.1145/960568.782998>; Fincher 2020 <https://luce.si.usi.ch/publications/2020-06-01-notional-machines.html>; Crichton 2023 <https://cel.cs.brown.edu/paper/ownership-conceptual-model/>; Crichton & Krishnamurthi 2024 <https://arxiv.org/abs/2401.01257>; Lister 2004 <https://www.cs.auckland.ac.nz/~j-hamer/ITiCSE04-wg.pdf>; Lopez 2008 <https://opus.lib.uts.edu.au/handle/10453/10806>; Sentance 2019 <https://doi.org/10.1080/08993408.2019.1608781>; Margulieux 2020 <https://doi.org/10.1186/s40594-020-00222-7>; Hohman 2020 <https://distill.pub/2020/communicating-with-interactive-articles/>; Hoshikawa 2026 <https://arxiv.org/abs/2604.27532>; Gregg USE <https://www.brendangregg.com/usemethod.html>; Zeller <https://www.debuggingbook.org/html/Intro_Debugging.html>.
- **AI tutoring:** Bastani 2025 <https://doi.org/10.1073/pnas.2422633122>; Shen & Tamkin 2026 <https://arxiv.org/abs/2601.20245>; Sankaranarayanan 2026 <https://arxiv.org/abs/2602.20206>; Kestin 2025 <https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/>; Ford re-analysis <https://www.clayford.net/posts/ai_tutoring_nature/>; Oreopoulos & Low 2026 <https://www.nber.org/papers/w35620>; GenAI meta-analysis 2025 <https://pmc.ncbi.nlm.nih.gov/articles/PMC12734368/>; Pardos & Bhandari 2024 <https://pmc.ncbi.nlm.nih.gov/articles/PMC11125466/>; Ipeirotis & Rizakos 2026 <https://arxiv.org/abs/2603.18221>; Tutor CoPilot <https://arxiv.org/abs/2410.03017>; Kucharavy 2025 <https://aclanthology.org/2025.bea-1.19>; CS50 duck <https://news.harvard.edu/gazette/story/2026/09/taming-the-duck-for-starters/>; Claude Code hooks <https://code.claude.com/docs/en/hooks>.
- **Games and 3D:** Clark 2016 <https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/>; Habgood & Ainsworth 2011 <https://shura.shu.ac.uk/3556/>; Chernikova 2020 <https://doi.org/10.3102/0034654320933544>; Rey 2012 via Tislar & Steelman 2021 <https://pmc.ncbi.nlm.nih.gov/articles/PMC8442593/>; Makransky 2019 <https://doi.org/10.1016/j.learninstruc.2017.12.007>; Wu, Yu & Gu 2020 <https://doi.org/10.1111/bjet.13023>; Höffler 2010 <https://doi.org/10.1007/s10648-010-9126-7>; Bevy sizes <https://github.com/Tristan578/project-forge/pull/10268>; Godot web <https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html>; Godot size <https://amann.dev/blog/2025/godot_web_size/>; Babylon.js <https://github.com/BabylonJS/Babylon.js/releases>; WebGPU status <https://github.com/gpuweb/gpuweb/wiki/Implementation-Status>; WCAG 2.2 <https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/>; Pages limits <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>.
- **Serving landscape:** Dynamo v1.5.0 <https://github.com/ai-dynamo/dynamo/releases/tag/v1.5.0>; vLLM v0.29.0 <https://github.com/vllm-project/vllm/releases/tag/v0.29.0>; vLLM Rust frontend <https://github.com/vllm-project/vllm/issues/40846>; SGLang TreeCore <https://github.com/sgl-project/sglang/pull/39627>; SGLang v0.5.20 <https://github.com/sgl-project/sglang/releases/tag/v0.5.20>; llm-d v0.10.0 <https://github.com/llm-d/llm-d/releases/tag/v0.10.0>; Thinking Machines <https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/>; precision divergence (TMLR 2026) <https://arxiv.org/abs/2609.26621>; NVIDIA HGX <https://www.nvidia.com/en-us/data-center/hgx/>; DGX B200 <https://www.nvidia.com/en-us/data-center/dgx-b200/>; GPU prices <https://getdeploying.com/reference/cloud-gpu/nvidia-h100>, <https://getdeploying.com/reference/cloud-gpu/nvidia-b200>; InferenceX <https://github.com/SemiAnalysisAI/InferenceX>; Copilot traces <https://arxiv.org/abs/2608.00101>; Step-3 <https://arxiv.org/abs/2507.19427>; MegaScale-Infer <https://arxiv.org/abs/2504.02263>; Groq 3 LPX <https://developer.nvidia.com/blog/inside-nvidia-groq-3-lpx-the-low-latency-inference-accelerator-for-the-nvidia-vera-rubin-platform/>; NIXL <https://github.com/ai-dynamo/nixl>.
- **Exemplars and Forge:** Math Academy <https://mathacademy.com/how-our-ai-works>; pwn.college <https://adamdoupe.com/publications/pwn-college-five-years-sigcse2026.pdf>; KernelGuard 2026 <https://icml.cc/virtual/2026/67922>; Boot.dev <https://www.boot.dev/blog/news/training-grounds-launch>; CodeCrafters <https://docs.codecrafters.io/challenges/how-challenges-work.md>; Turing Complete <https://store.steampowered.com/app/1444480/Turing_Complete/>; Execute Program <https://notes.andymatuschak.org/Execute_Program>; giscus <https://giscus.app/>; rubri <https://github.com/LyonSyonII/rubri>; CodeMirror <https://codemirror.net/>; Aquascope <https://github.com/cognitive-engineering-lab/aquascope>.
