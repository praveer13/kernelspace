# Wave 3, depth, proof and the last mile: spec (PRs 3a, 3b, 3c, 3s)

**Status:** draft for owner review, revised after a verified critique (findings A1–A12, B1–B11, C1–C10, D1–D15), then refreshed against its real base (findings R1-01–R1-13, R2-01–R2-08). **Date:** 2026-10-13, refreshed 2026-10-14. **Base:** `wave-3a` = 4b32c09, the Wave 2 integration: `wave-2c` 2663128 merged with `wave-2b` 7c1d329, each holding the fixed `wave-2a` (Wave 2's PRs #10 for 2a, #11 for 2c, #12 for 2b). The spec was first written at 474ea3e, before the 2b and 2c fix rounds. File:line citations are at `wave-3a` unless marked; each names its symbol, which is the stable anchor, and line numbers are hints.
**Implements:** PLAN-100X §8 Wave 3: W5 Fleet exercises, EPLB play and two families; receipts; H4 v2; labs 04–08; P3; K5; remaining P2; W7 Tiling Cube; twins for labs 07 and 06; the S4 watcher if justified; partners. Stretch, in the plan's order: W7 3D evaluation, t6.l12, more W5 exercises, Interview mode, two field labs, the On-Call pilot, Season 0, the bring-your-own-service capstone, P4, the T0/T4 measured-versus-predicted real-engine run.
**Nothing but this file is committed with the spec.** PR 3a's level 0 commits the contracts (ledger v3.3, types, gates, claims, KCs) before any other task starts.

Section numbers below are cited by the task DAG (§19) and by `wave3-dag.json`.

---

## Decisions (read first)

| # | Decision | Where |
|---|---|---|
| D1 | **A linear stack: 3a → 3b → 3c, then stretch (3s).** 3a holds contracts, gates and engines; 3b play, proof and the Mirror; 3c the exit gates, measurement and the watcher decision. Each PR branches from the previous one's merged tip, so no two PRs are open in parallel and nothing needs a two-way sync. Inside a PR, the tasks of a level run in parallel and never share a file. Wave 2's 2b and 2c ran in parallel, never merged each other, and still conflicted on `mc-cues.test.ts` and `wave-2.md`. | §19 |
| D2 | **Wave 3 starts from the Wave 2 integration commit, `wave-3a` = 4b32c09:** `wave-2c` 2663128 (2c after its fix round) merged with `wave-2b` 7c1d329 (2b complete, with 2b-17's Act IV drills and 2b-21's Daily on your engine, after its fix round), each holding the fixed `wave-2a`. On it `verify:items` passes, `bun run test` passes (3,865 tests in 150 files), and `tests/kc/hands-on.test.ts` passes (12 of 15; its fixture already uses the unregistered `no-such-play`). The fix rounds changed code this spec cites: CF1 split the compile bank into per-group lazy chunks with a generated manifest (`src/data/rust-items/`), and the compile family's `make` throws `NotReady` until its group loads (`src/lib/items/on-demand.ts`: `collect`, `settle`); on-KC item draws go through `drawOnKc` (`src/lib/learner/on-kc.ts`); Act IV's `diagnosed` is the hypothesis held at the first fix (labels in `src/lib/world/incident-spec.ts`); the scheduler's practice minute (`SCHED_PRACTICE_MINUTE_SEED`) is in band on all five §8.2 rules and verify-plays enforces all five (wave-2 D33); align ids are 1-based; Today starts a set through `useStartSet` and `settle`; mounted UI tests use `tests/dom/mini-dom.ts`; wave-2 Decisions D26–D39 record the rest. Wave 3 touches neither the compile bank nor the Error Museum. | §1 |
| D3 | **Gates and engines land first, in 3a level 0, before any content they gate.** Every change to a verify script, an item pool, the ledger, the lesson or bundle types, the claims registry or the lab worker protocol is a 3a-L0 task; later tasks fill files. Two gate flips are declared and placed after everything they gate: 3b-06 makes /me's budget a gate when it rebuilds the page, and 3c-01 makes 15/15 hands-on and "no credit without a prediction" gates. Content tasks keep a margin: their own items stay within chance + 10 points (`verify:items -- --subset`), so the merged pool keeps the 15-point gate. In Wave 2 a gate upgraded in 2a failed 2c's items only on the merged tree. | §4, §19.1 |
| D4 | **Ledger contract v3.3: `SCHEMA_VERSION` 5 → 6, `AGGREGATE_VERSION` 3 → 4, `IDB_VERSION` unchanged, no new event kind and no new ref grammar.** `prove` events gain a v2 shape and the first writer of provenance `proved`; items and predictions gain the sources `form` and `play`; plays gain a numeric metric and per-level results; Fleet Week acts gain receipts and a rubric; there are two new working keys, `fw:runs` and `profile:background`. | §3 |
| D5 | **`proved` means: after an unseen-seed green, you predicted what your own module replies to a seeded list of calls, and it replied that.** The plan's "prediction of your own module on a seeded trace (`probe`)" uses verbs the bridges already answer: kv-block-manager, mpmc-queue, batching-scheduler and radix-cache (`src/pages/fleet/drivers.ts:33–131`, `wasm-scheduler.ts`). So there is no crate, ABI or calibration change. Where a lab's required checks pin a correct module's behaviour exactly (labs 04 and 07), an eligible module can only be correct, so its templates are tracing items about a correct module, answerable from your code and never from the story alone; where your design is free (lab 02's free-list order, lab 04's capacity rounding), the answer reads your own choice. `proved` goes live on four labs (02, 04, 06, 07); the exit asks for three. Labs 01, 05 and 08 answer only `probe`, and predicting lab 03's token counts by hand is not reasonable, so those four keep v1. The ledger already has a `probe` event kind (cold checks), so this spec says "verb calls", never "probe", for this mechanism. | §7 |
| D6 | **W5's "two families" are `prefill` and `rollout`.** W5 names six generator kinds. Wave 2 built five of them in four families (`memory` merged FP4 capacity and parallelism memory, wave-2 D11), leaving the P:D ratio. `prefill` covers it, plus KV transfer, tiering and the prefix-cache timing oracle, which makes t6.l3 and t6.l10 hands-on; `rollout` makes t6.l7 hands-on. So 15/15 rests on families and the EPLB play, never on the Fleet exercises, which are the first cut after stretch (PLAN §8.1). | §5 |
| D7 | **The base Fleet exercises are the load knee (t7.l2) and the P:D split (t6.l3).** The broken-benchmark detective and speculation push-your-luck move to stretch ("more W5 exercises", 12 h), beside two new ones for t6.l7 and t6.l10. The Fleet engine models neither speculation nor experts (flat tick, `fleet-model.ts`), and the plan's three exercises otherwise land on lessons that are already hands-on. Exercises record ordinary `item` events (`item:fleet.<id>`), as item blocks do. | §5.3, §16.3 |
| D8 | **The EPLB play is 2D, turn-based and synthetic.** A seeded skewed load on a 16-expert layer and 4 GPUs of 5 slots: replicate 4 experts, then place 20 copies. The hidden ghost is DeepSeek EPLB's balanced packing. The score is the busiest GPU's load over the mean, because a step waits at the combine barrier for the busiest GPU (t6.l1, `moe-anatomy.ts:27`). There is no step-time physics; S5 is Wave 4. | §5.2 |
| D9 | **W7 ships the 2D cube; Cube3D and the 3D evaluation are stretch item 1.** The plan makes 3D opt-in and puts its evaluation in stretch; shipping the 3D view without its evaluation would ship an untested seductive detail. three 0.185.1 and R3F 9.6.1 are already runtime dependencies (Home's ParticleField, a 242.4 KB gzip lazy chunk), so the stretch adds none. | §6, §16.1 |
| D10 | **The cube's numbers come from one stated model, and two of the plan's figures change.** Nothing in the repo or the evidence derives "≈127 vs ≈950". 127.0 is one row's bound (T·N/(T+N) at N = 16,384), and with one CTA per SM, ≈950 comes from 128 × 256 tiles (965.5). With one tile shape (128 × 128, FP16) and one 132-CTA wave on a 16,384³ GEMM (one CTA per SM, a persistent kernel), raster order alone takes the wave's intensity from 130.0 (row-major) to 734.6 FLOP/B (grouped 11 × 12): 5.7×, still "several-fold". The FP8 ridge (≈590) rests today on a ×2 multiplier over BF16 dense (`models/roofline.ts:55–60`, and the roofline family). The cube keeps that one rule, so the cube, the family and RooflineSim share one H100 FP8 ridge, 590.4; 3a-08 adds H100 FP8 (1,979 dense) as a claim, which confirms the ×2 within rounding. The cube also needs SM-count, L2, SMEM and register claims; today those are lesson literals (`gpu-memory.ts:85–87, 110`). | §6.1, §4.4 |
| D11 | **W7 adds a third family, `tiling`, inside its own line.** W7's metric is "30-day fresh-item prediction error", which needs generated items. Levels 2–6 of the cube are that family's variants (level 1 reuses `roofline/tile-ai`), so the play and Today use one instrument. | §6.2 |
| D12 | **W1's Code stage (deferred by wave-2 D6) lands as lab 06's race and bestiary.** After an unseen-seed green, lab 06 races the reference on a graded seed; this is RING 0's "within 3 points", deferred by wave-2 D14. It then shows where your goodput falls among 12 policies from the Compose dials. The real-engine finale is the existing /fleet panel, linked. The leaderboard's physics floors are cut: the leaderboard has 0 entries, and floors need calibrated physics. | §8.3 |
| D13 | **Labs 04–08 get faded scaffolds:** six PRIMM items, hint ladders R0–R2 and then the packet, Prove-it v1, and v2 where the bridge allows. This is the plan's "scaffolds fade from lab 04". It fits 10 review hours for five labs, and it matches the hint-ladder pre-registration's default if underpowered (R0–R2). The ladder-or-packet experiment stays on labs 01–03. | §8.2 |
| D14 | **A receipt is verified by re-running it and comparing at the precision written.** A receipt names a run record (act, job, entropy, module hashes, values; its id is 8 hex characters of the record's sha256). The page re-runs it, and the cited value must equal the re-run value rounded to the decimals cited. The engine is deterministic, so no tolerance is needed. The keyword lists, word counts and the screenshot go; the screenshot check only ever read the file's name and size. The rubric is self-review against three scored exemplars, recorded but never scored. | §10 |
| D15 | **P3 is align → name the break → principle, on all 18 panels; the 23 T3–T7 pairs without a `breaks` line get one.** Work analogues need a learner background that nothing records today (Boot keeps only a free-text value prompt, `You.tsx:88`), so an optional background pick lands with them; they are third in the cut order. | §11 |
| D16 | **K5's VRK₃₀ is made computable.** A KC counts when its latest credited, unassisted check at least 30 days after its card was created is right. "First learning" is the card's creation; "credited" is provenance `unseen` or `proved` (V6), so authored items (`practice`) never count. VRK₃₀ therefore covers generator KCs and lab KCs with `proved`, and /me says so. | §12.2 |
| D17 | **Remaining P2 is Wave 1's 13 deferred tasks, t5.l5's 4 block-table tasks, and one registry.** 36 task ids live in inline arrays outside the registry; they move into tasks files. Every `taskIds` entry of a lesson exercise block then resolves to an outcome task; link-card blocks (no `taskIds`, free-text `tasks`; 18 of the 28 lesson files with an exercise block on 2c, e.g. `t0/memory-hierarchy.ts`, `t2/scheduling.ts`; `exercise.tsx:5`) stay link cards that earn nothing, deferred like the 79 legacy tasks, which are exploration steps that earn nothing. Converting all of them is not a 4-hour line. | §13 |
| D18 | **The watcher is built only on a signed `keep`.** `docs/prereg/watcher.md` is unsigned and no rating exists. The default is the plan's: the manual scan stays and the 10 hours return to the queue. arXiv feeds were never backtested, so they stay out. | §14 |
| D19 | **Wave 3 adds no claim to the eager registry.** Its claims live in lazy groups that their consumers (families, plays, panels) import, so the 17 KB claims chunk on /boot and /today does not grow. Splitting the existing 169 claims by page stays deferred. | §4.4 |
| D20 | **/me is gated at 200 KB once rebuilt.** /progress's static closure is about 615 KB gzip, because Progress.tsx imports all lesson content for one count (`Progress.tsx:47, 93`; that chunk is 394 KB). The Mirror imports no lesson content. | §2.2, §12.5 |
| D21 | **Twins are data files, not a `labs.ts` field.** `labs.ts` is shared metadata; a twin carries items and a pinned claim, so it lives in `src/data/twins/<lab>.ts`, found by readdir. The plan's `labs.ts:21` pointer is stale (ForgeLab is at `labs.ts:26`). | §9 |
| D22 | **The journey re-cut is a field gate.** The plan re-cuts §4.D's cadence table at every wave exit, which needs partners' minutes per surface. Wave 3 ships the selector and the report table; the owner re-cuts the table. | §15, §18.2 |
| D23 | **Stretch keeps Wave 4's gates.** The On-Call *shift* is gated in Wave 4; the stretch "On-Call pilot" is a three-incident shift mode plus a think-aloud protocol that produces that gate's evidence. Season 0 is seven dated Daily seeds with a local record and no board, since Seasons stay gated. t6.l12 changes the 68-lesson count that four tests pin. | §16 |
| D24 | **One carry-over from the Wave 2 reviews remains, and goes to the task that owns the file:** RooflineSim's SMEM curve assumes 4-byte elements (3a-18). The others are already fixed in the base and only need their tests kept green: ROOT's cold-check part reads `ach:root-cold` (25e4b8a, `selectColdChecks`, `economy.ts:290–323`); the PRIMM row uses the gate's own comparison (25e4b8a, `overChance`, `verify-items.ts:879`); `selectPlacementLanding` reads the first lesson-ref event after the placement (25e4b8a, `outcomes.ts:725–748`); alignment refs are 1-based in both `AlignItem` and item-pools (2c fix 9111d08; `tests/lesson/align.test.ts` holds them equal). | §3.4, §4.1, §13, §15 |

**Decisions from the 3a fix round** (the final review of 3a, round 1, and its follow-ups):

| # | Decision | Where |
|---|---|---|
| D25 | **RING 0's race ships inert until the race exists.** `RING0_RACE_LABS` (`economy-table.ts`) is empty in 3a, and the ring's race row shows only while the list is non-empty; 3b-09, which ships the race, adds `'batching-scheduler'` to it. `master` deploys on every merge, and rings are derived, not stored: with the lab 06 requirement live and nothing able to meet it, merging 3a alone would un-earn RING 0 for every learner who holds it and show a row that links to a lab page with no race. This replaces 3a-01b's "RING 0 needs the race" until 3b-09 merges; §3.4's tests run with the list both empty and set. | §3.4, 3a-01b, 3b-09 |
| D26 | **Faded ladders render only the rungs a bundle has.** `CheckLadder.r3` and `r4` are optional (3a-05b), and a bundle with `fade: 'r2'` stops at R2 with the packet after it, as D13 says. No Wave 3 task owns `HintLadder.tsx`, so the 3a fix round makes it render no gate for an absent rung. Labs 01–03 and their ladder-or-packet arms are unchanged. | §8.2, D13 |
| D27 | **getClaim's unknown-id error points at `claims/homes.ts`.** Naming the group would put the homes table in the eager chunk, against D19; `homes.ts` is what tooling reads (AF9). This replaces 3a-07's "getClaim names the group to import". The eager claims chunk is 63,086 B raw and 17,688 B gzip against Wave 2's 63,030 and 17,646: the 42 B gzip are getClaim's guard against inherited names (`getClaim('toString')` throws) and its longer message. Both print as 17.8 KB, so D19's "no growth" holds at the 0.1 KB the gate prints. | §4.4, 3a-07, D19 |
| D28 | **SGLang's prefill scene runs at one GPU's share of the node.** `prefill/hit-gap` and `prefill/namespace-cost` both time a request's prefill at 52.3k ÷ 8 ≈ 6.54k tok/s (`serving.sglang-deepseek.*`; 2,000 tokens take 305.9 ms, not the node rate's 38.2), because with data-parallel attention each GPU prefills its own requests (AF3). The stems state the model ("every GPU busy"). Data-parallel attention is not yet a registered claim (an owner check in PR 3a). | §5.1, 3a-15 |
| D29 | **A task's `legacyId` may be a list.** `alloc.fixed-block-waste` carries `t-paged` and `t-quiz`, so old completions of either show (AF8). 3c-01's no-credit test reads `legacyId` as a string or a list. | §13, 3a-19, 3c-01 |
| D30 | **The roofline tasks are calculations, not estimates.** The eight probes are graded within 10 % (5 % for occupancy, tiers and pcie; 5 points for coalesce) and the four worksheet rows within 5 %, and every answer follows from its own prompt, which a test works through (AF2). | §13, 3a-18 |
| D31 | **A prove event with no `v` is v1.** Only Prove-it v2 writes `v: 2`, so every prove event already in a ledger reads as before. | §3.2, 3a-01 |
| D32 | **Static budgets after 3a.** The entry chunk is 114.8 KB: 3a used 1.1 of Wave 3's 2 KB (about 0.8 of it is AF1's façade checks, D35, which keep the codec out of the entry), so 3b, 3c and 3s share 0.9 KB. The entry's growth counts against its own line, and §17.1's "Wave 3 adds nothing static to /today" counts Today's own chunks: 3a grew them by 0.3 KB for the two lazy `ProveReturnCard` mounts (DoneCard and EmptyState, 3a-06), and no later task grows them. /today is 188.1 KB. /daily is 184.3 KB (the entry +1.1, labs.ts metadata for labs 04–08 +1.6), so 3s-08 and 3s-09 have 15.7 KB. This is the default; the owner may ask for the bytes back instead. | §17.1 |
| D33 | **Wave 3 gates static closures, not what a page fetches after it renders.** A fresh /today visit fetches 745.8 KB of JS (719.7 on the base): `loadTodayContent` loads every generator family (`loadAllFamilies`), so the three new families and the tiling and serving3 claim groups (with `claims/registry.ts`, 3.0 KB) come with them. That is reported, not gated; D19 covers the static closure. Loading only the families a set needs is open to the owner (no Wave 3 task owns `today.ts` or `items/registry.ts`). | §17.1, D19 |
| D34 | **Competence counts no form item.** Forms are measurement (W18), and VRK30 and the scheduler already skip src `form`; a 'can' line that a form moved would be the measuring moving what /me shows. 3b-06b makes the change in `competence.ts` before the Mirror shows a 'can' line. | §12.4, W18, 3a-17, 3b-06b |
| D35 | **progress.ts copies four codec bounds.** The façade holds prove and Fleet Week act events to the codec's rules without loading the codec (AF1), so `MAX_ACT_RUNS`, `RUBRIC_KEYS`, `MAX_QID_LENGTH` and `MAX_PROVE_IDS` exist twice; `facade-prove-act.test.ts` checks the copies against the codec on its cases. A task that changes one of those rules changes both in one commit, or moves the shared constants into `ledger/constants.ts`, which the entry chunk already loads. | §3.5, 3a-01 |
| D36 | **rollout/sync-seconds' dense-and-expert split variant is deferred.** It is optional in §5.1, and no task after 3a-16 owns `rollout.ts`; the family ships its other variants. The owner may open it as a content task. | §5.1, 3a-16 |
| D37 | **The 3a reviews' carry-overs go to the tasks that own the files**, written into their Accept lines: 3b-01 (practice on `CUBE_PRACTICE_SEED`; the shapes `waveAI` and `tileAt` refuse), 3b-04 (`readAnswer`'s messages and `none`), 3b-05 (the scanner's units, with `fleet-receipts.ts`; D35), 3b-06b (D34, with `competence.ts`), 3b-18 (a raster-order section, so `t4.raster-l2-reuse`'s search row gets an anchor) and 3c-01 (D29). PR 3a lists the known limits that no Wave 3 task owns. | §19 |

**Decisions from the 3b fix round** (the final review of 3b, rounds 1 and 2, and their follow-ups):

| # | Decision | Where |
|---|---|---|
| D38 | **Lab 06's third Prove-it v2 template is `walk-past`, not `preempt`.** `preempt` answered `none` on every seed for every module that never preempts, the reference included, so it could be answered without reading code. In `walk-past` an old request (waiting 2,600 iterations or more, so aging puts it first in any module that passes `starvation`) heads the line and does not fit even with no margin: a module that skips it admits the old request that fits and then the young ones smallest first, and one that stops there (`scheduler.rs`: skip, don't stop at; no check catches it) admits at most one. The private reference, run natively through the bridge on 1,003 seeds per template, answers what `referenceScheduler` answers on all three templates; `stop_at_first` differs on `walk-past` on every seed; the reference's `walk-past` answers take 908 distinct values. A default the owner may revert. | §7.2, 3b-12 |
| D39 | **A Fleet exercise shows its scene before the prediction, and done is 3 right in a row on at least 2 different answers.** A round draws its fair seed first and shows that seed's scene (the knee's 1× offered rate and slot-hold time; the P:D split's prompt and output lengths); the sweep's outcome stays hidden until the lock. Done is 3 right predictions in a row on fresh seeds whose right answers include at least 2 different values, and the progress line says both counts. Each generator spreads its answers so none is right on more than about 29 % of banded seeds (the knee draws its target multiplier, the P:D split the split its Little's-law estimate names, uniformly), so a constant never finishes; the best scene-ignoring guesser finishes within 10 rounds 14 % of the time (40 % within 30), and a learner who applies the scene's Little's-law reading 98–99 % of the time within 10. `goodputRps` moves to `fleet-ex/rate.ts`. Only saved rounds count so far (D48 gives 3c-06 the rest). Replaces §5.3's and 3b-20's "done after 3 right predictions on distinct fresh seeds"; a default the owner may revert. | §5.3, 3b-03, 3b-20 |
| D40 | **The Tiling Cube's element type is FP8 or FP16.** FP32 left the control: H100 runs FP32 inputs at the TF32 tensor rate or on CUDA cores, and no registered claim carries either rate, so the cube cannot price them. The tiling family keeps its FP32 transfer-level variants. | §6.3, 3b-01 |
| D41 | **/play/tiling-cube's figure stays 200 KB, reported.** Its static closure is 242.7 KB gzip (250.2 before the fix round): the views, the table, the debriefs and the card load on demand, and what remains is the item card with its claim chips and the roofline and tiling families that the opening prediction needs. verify-bundle prints `warn` for a reported route over its figure. The owner may restate the figure or ask for a further cut. | §17.1, 3b-01 |
| D42 | **The keyboard walks read the shipped lesson, and a local e2e run can take its own port.** e2e/isomorphism.spec.ts walks t2.l2's real block (3b-16) at 360 and 320 px and reads its expectations from the lesson data, instead of §17.2's and 3b-07's fixture block. With `PW_PORT` set, playwright.config.ts serves on that port and never reuses a running server; CI is unchanged. | §17.2, 3b-07 |
| D43 | **A misconception's distractor is never replaced; a new lure rides on a new question.** An item takes at most four options (`MAX_RANK_SUBSET_OPTIONS`), and ledgers hold misses under a distractor's id, so §11.2's "add otherwise" adds a question. The distractors and miss ids that 3b-17 replaced (`t5.apc-caches-token-ids`, `t5.key-includes-sampling`, and pagedattention-deep-dive's shared-system-prompt distractor) are restored verbatim from wave-3a; t5.l5 and t5.l6 each end with a question (q5) that carries their `confuse.<KC>` lures, and earlier `quiz:<lesson>#<qi>` refs keep their meaning. | §11.2, 3b-17 |
| D44 | **Labs 05 and 08 run their Modify.** Their Modify items are estimates over run dials, not §8.2's no-run choice items: they keep the run-first loop and add nothing to the PRIMM choice pool (D48). Lab 05's `nested_spawn` R1 links r.l8 ("Make the guard shorter", in lab 05's readiness list): no H2 of the host lesson t3.l4 teaches how long a borrow lasts, so this is the one exception to §8.2's host-lesson anchor. | §8.2, 3b-11, 3b-14 |
| D45 | **A v2 30-day return on installed bytes can earn `proved`.** §7.3 condition 2's "the module ForgeLab just graded" reads as "a module a fresh-seed run graded", since installing needed a fresh-seed green. Checked in the browser: a day-31 return on the installed lab 06 module is saved as `proved` with `data.return`. A default the owner should confirm. | §7.3, 3b-04 |
| D46 | **The EPLB debrief says only what it knows.** The turn `eplbDivergence` names is headed "Where the layer was lost: turn N" (the last turn after which even the reference's rule could not recover the layer; earlier turns may differ too), and a skipped layer is headed "The reference finished this layer". The pass tally is rebuilt at mount from the learner's `play:eplb` events (phase `play`, ok, not skipped; practice is the practice load, unseen one new load per seed). A Compose record carries the play's load seed and that load's provenance, practice or unseen, and only Compose's verdict line is a live region. The scheduler play's Compose still records practice, which understates and harms nothing. | §5.2, 3b-02 |
| D47 | **/me shows its sections once the Mirror's read settles.** The forms card, the journey and data ownership wait for the Mirror, so nothing on screen moves when it lands. On a fresh profile under Fast-3G at 360 px the rings and "Reset everything" appear at 6.6 s (3.05 s before the fix round); the Mirror lands at 6.1–6.6 s either way, because its read loads every generator family. A lighter Mirror read would fix both and is left to a later wave; the owner may instead ask for data ownership to render without waiting. | §12.5, 3b-06b |
| D48 | **The 3b reviews' carry-overs go to the tasks that own the files**, written into their Accept lines: 3c-06 (a locked round with no saved item counts as a miss, so leaving before saving cannot erase one; D39), 3c-02 (the routes it adds already pass at 360, 320 and 1280 px in the 3b review), 3c-05, 3s-11 and 3s-12 (check verify:items' length-cue margins before adding lesson choice items: the Wave 2 bar's middle-length strategy is at 1.81 of 2 and the gated tracks' aggregate at 1.93 of 2), and 3s-07 (a choice item added to a lab pool must not raise the PRIMM pool's worst strategy, 39.3 % against 40.0 %). D35's move of the shared codec bounds into `ledger/constants.ts`, with `exemplars.ts`'s `RUBRIC_KEYS` as a third copy, goes to the next task that changes a codec bound. PR 3b lists the known limits that no Wave 3 task owns. | §19 |

**Decisions from the 3c fix rounds and the owner's sign-offs** (the final review of 3c, rounds 1 to 4, and the owner's answers of 2026-10-14):

| # | Decision | Where |
|---|---|---|
| D49 | **A donation keeps a form item's `track`.** Only for src `form`, and only as one of the KC graph's nine tracks (`DONATION_TRACKS`, which `redact.test.ts` holds to the KC graph; `parseDonation` checks it again). `selectFormsGain` reads it and falls back to the kcs majority only for an event without one: T5's forms draw sig items whose kcs tie T5 and T7, so the kcs alone sent a quarter of T5's slots to T7. Replaces 3c-03's "track from the kept kcs" and adds one field to §15.2's whitelist. | §15.2, 3c-03 |
| D50 | **"Clear my pick" deletes `profile:background` everywhere it could come back from.** Memory clears at once and the snapshot at its next write (at the latest when the page hides). Every outbox clears synchronously, before the store's delete commits: the key's records written at or before the clear are stripped, and a tombstone `{ key, at }` stays in this tab's outbox. Then the store. Boot applies every outbox's tombstones by `at`: a record written at or before the latest tombstone is dropped and other tabs reload, and a later write wins, in the same tab even within one millisecond. An import or undo that writes the key drops its tombstones, so a file exported before the clear still restores the pick; reset removes them; otherwise a tombstone lives as long as its outbox, 24 h after that tab's last write. (Fix round 3: an earlier page's unsaved pick under another tab id used to come back.) | §11.3, 3c-05 |
| D51 | **An F1 `quiz` summary counts its time unless an answer of the same attempt (same `grp`) carries its own `ms`.** Lesson QuizBlock attempts keep their time on the `quiz` event, so F1's lessons row no longer drops them, and nothing counts twice. | §15.1, 3c-03 |
| D52 | **F2 applies `hint-ladders.md` §4 whole:** a powered result whose upper bound is below 0 cuts the ladder to R0-R2 ('packet-better'), as well as one whose lower bound is at or below -5 points. | §18.2 F2 |
| D53 | **D35's shared codec bounds live in `ledger/constants.ts`** (`MAX_QID_LENGTH`, `MAX_PROVE_IDS`, `MAX_ACT_RUNS`, `RUBRIC_KEYS`; D48's carry-over), imported by the codec, the façade, the exemplars, the redaction and the outcomes, and `learner/proportion.ts` breaks the outcomes, vrk and forms import cycle. | D35, D48 |
| D54 | **/me shows the forms card, the background pick and the sections below them only once the Mirror has settled and the card's chunk has loaded**; the card renders from the loaded module. Extends D47. | §12.5, D47 |
| D55 | **verify-bundle's on-demand line counts each on-demand chunk's own static imports**, so Boot's last step reports what it really loads. Reported, not gated (D33). | §17.1, D33 |
| D56 | **A Fleet exercise's note shows in phone mode only after the lock, and in embed mode only when the exercise is done**: it states the answer rule, so it never shows before a prediction. | §5.3, 3c-06 |
| D57 | **F9 prints a seeded bootstrap interval for each median** of the VRK30 spread. | §18.2 F9 |
| D58 | **The G1 work pair's break says a paged KV cache never moves a block to compact**, and names the other reasons an engine moves or copies one (swapping a preempted sequence out, copy-on-write for a shared block). Refines §11.3's "KV blocks never move". | §11.3, 3c-05 |
| D59 | **Daily and Fleet Week events carry `ms`, the page's visible time** (`useVisibleClock`), passed into the builders, since `world/` and `fleet-*.ts` read no clock. The Daily and an Act IV drill count from the alert to the debrief (capped at 32 min); an act run its visible wall time (10 min); an act the visible page time to its pass that no run or drill of the visit holds (60 min). A hidden tab adds nothing, and each second counts once, except that an Act I or II run started during a drill is counted in both. Events written before this carry no `ms`. | §15.1 F1, 3c-03 |
| D60 | **A QuizBlock answer records `slot` of `of`, and on a miss the picked lure's `miss` id.** F6 reports a quiz miss with neither as `unattributed`: out of the confusion share, in the accuracy. No current QuizBlock question carries a miss id (QuizBlock renders only on R.L1-R.L10, and the P3 lessons' tickets already record their lures), so this matters for answers written earlier and for future content. | §18.2 F6 |
| D61 | **F2's window starts at the lab's first all-green run, for every ledger.** The owner's choice, signed in `docs/prereg/hint-ladders.md` (section 3 and the sign-off table, 2026-10-14): a donation keeps no per-check timing, so the lab's run is the anchor every ledger can show, and the arms, randomized per check within a lab, share it alike. | §18.2 F2 |
| D62 | **F5 keeps Prove-it v2 only if the lower bound of the attempted share's 95 % Wilson interval is at least 0.60**, with 5 partners; anything else takes the underpowered default (one question, PLAN §9), never a kill. The report prints n, the share and both bounds. The owner's choice (2026-10-14), over the point estimate. | §18.2 F5 |
| D63 | **F3 keeps the Daily daily if the one-sided 97.5 % lower bound of d is above -5 points**, with 197 learners. The owner chose the margin over PLAN §9's literal "≥" and signed `docs/prereg/fleet-daily.md` (2026-10-14). | §18.2 F3 |
| D64 | **F4: the watcher is dropped and the manual release-note scan stays.** The owner signed `docs/prereg/watcher.md` (2026-10-14). Ten blind raters labelled the snapshot's 9,960 distinct lines, and `score.ts` scored the matcher: precision 6.3 % (39 of 617; bar 25 %), recall 88.6 % (39 of 44), 70.8 flags a week. A second rater on a seeded 10 % sample gave kappa 0.57 (`docs/backtest/agreement.json`). The verdict does not rest on the rating's misses: even if all 110 flagged lines of the batch that rated none true were true, precision would be 24.1 %. `ratings.json` is not a gold set. 3c-04 builds no digest. | §14, §18.2 F4, 3c-04 |
| D65 | **The 3c reviews' carry-overs.** The signed pre-registrations promise secondary outputs the report does not print yet (`hint-ladders.md` §3 and §5: the intention-to-treat population, packet use per arm, a lab-by-arm table, attempts and minutes to green, rungs reached, bottom-outs; `fleet-daily.md` §3 and §5: the per-fault-KC table and the learners with a check in only one group); they are added before the Wave 3 exit readings. Each file's standard deviation (20 and 25 points) is replaced by the observed value in a dated amendment, the owner's, before the first report that could reach 126 or 197 learners. Budgets left for 3s: the entry chunk about 0.25 KB of §17.1's 2 KB, /daily 14.3 KB (D32 planned 15.7). | §15, §17.1, §19 |

**Decisions from the 3s reviews and the owner's answers** (the final review of 3s, rounds 1 and 2, and the owner's answers of 2026-10-15):

| # | Decision | Where |
|---|---|---|
| D66 | **The 3D cube is a plain opt-in on every level, with no study** (the owner, 2026-10-15). Every level offers "Show it in 3D" after the 2D faces and their table. `CUBE_VIEW_STUDY` (`src/lib/learner/cube-views.ts`) stays false while `docs/prereg/tiling-cube-3d.md` is unsigned, and `tests/plays/cube-eval.test.ts` fails if it is true while the draft is unsigned; so the cube creates no `exp:seed`, records no `PlayLevel.view` and offers no spatial puzzle. 3s-02's split, `SpatialProxy` and `selectCubeByView` stay built and dormant, and a signature turns them on in that one line. Learners who play before a switch-on have seen 3D on every level, so the draft must exclude or stratify them before it is signed (its status note says so). Replaces Q7's default, §16.1's "learners see it only through 3s-02's counterbalanced arms" and 3s-02's "merges only after the owner signs"; amends D9: the view ships without its evaluation, and no view data exists. | §16.1, Q7, D9 |
| D67 | **`docs/prereg/protege.md` stays an unsigned draft** (the owner, 2026-10-15). No reading arm, assignment or recording is built, every protégé block shows the protégé arm to everyone, and the Wave 3 + 60 d decision takes PLAN §9's default: one block per track. | §16.9 |
| D68 | **Season 0 runs Monday 2026-11-02 to Sunday 2026-11-08**, Dailies #21 to #27 (the owner, 2026-10-15; `SEASON0_START`). The /me card shows until the season ends and is gone from 2026-11-09 (`season0Over`). Replaces §16.7's "the Monday after 3s-09 merges"; PR 3s merges before 2026-11-02. | §16.7 |
| D69 | **The timing oracle asks one number per seed**, drawn from a stream of its own, each on about half the seeds: the probe's TTFT gap with the shared key, P ÷ 128 ticks of 50 ms, right within 50 ms or 5 %; or the hit rate the tenant key loses, K(T − 1) ÷ n, right within 0.25 point or 5 %. The prompt says which. Three fresh seeds in a row ask for both numbers 3 times in 4. Replaces reading §16.3's row as two predictions per round. | §16.3, 3s-05 |
| D70 | **The broken benchmark draws its answer first**, by D39's rule: over capacity the p95 request's wait, uniform in log over 100 to 2,503 ticks; under capacity the p95 prompt's prefill, 5 to 150 ticks weighted 1 ÷ ticks. On 480 seeds the scene's reading passes 99.0 %; the best scene-blind constant finishes within 10 rounds 2.8 % of the time, and the flaw-label constants 9.4 % (30.6 % within 30), inside D39's 14 % and 40 %. | §16.3, 3s-04, D39 |
| D71 | **F1 leaves the team grammar's practice incidents out of Daily minutes**: `inc:team/shift-<k>/<date>` (the On-Call pilot), `inc:team/interview/<date>` (Interview mode), and a donation's `inc:team/-/d<k>`, since a donation drops every team code and the only team incidents so far are those two. `PRACTICE_TEAM_CODE` reserves the codes; a team Daily must keep its code through a donation (or take a grammar of its own) before the re-cut can count it. Refines §15.1 F1's "team incidents". | §15.1 F1, 3s-06, 3s-08 |
| D72 | **Wave 3's closing budgets.** The entry is 115.7 KB gzip, +2.0 KB over wave-3a's 113,673 B base (4b32c09) at the gate's 0.1 KB precision (D27's rule), so the allowance is spent, Wave 4 inherits none, and any entry growth needs bytes back first. Its gzip size moves by tens of bytes when other chunks change, because it names every chunk by hash: it was 115,694 B at 01ccf83 and 115,712 B at PR 3s's head with the same 349,812 raw bytes, so a byte-exact count against the 2,000 means nothing finer than that noise. The ⌘K index is 19,723 B, 19.3 of 20 KiB, after plan §4.4's cut (`CAN_MAX` 41 to 32); Wave 3 added 1,106 B against its 1.2 KiB line. /daily is 187.7 KB: 3s used 1.9 KB of the 14.3 KB D65 left it, once D74 took the shift out of an ordinary visit. | §17.1, D27, D65 |
| D73 | **`t6.attention-ffn-split` cites no claims**: its three benchmark claims are lazy (§4.4, D19), and `claimsFor` reads only the eager registry. t6.l12's statline cites them, and its H2 packet carries none. **Either sign-off form is a signature**: `isPreregSigned` accepts a `Signed:` line with a name and an ISO date, or the table's Owner and Date signed cells, and both drafts say so. | §4.4, D19, 3s-03, 3s-11 |
| D74 | **/daily loads the shift only for a shift.** `/daily` reads `?shift=` with `pages/daily/wants-shift` and, on `3` alone, loads `pages/daily/shift-kit` with one `import()`. The kit holds `world/shift`, `world/shift-note`, the note card and the shift's markup, and a shift visit opens no session until it arrives; if it cannot be fetched, the page says the shift did not load, and its retry is a reload, since the browser keeps a failed dynamic import for the life of the page (`e2e/shift.spec.ts` blocks the chunk). `data/season0` keeps only what the Daily's header reads, and the /me card's rows sit in `data/season0-rows`. An ordinary /daily visit fetches neither: /daily fell from 189.6 to 187.5 KB (187.7 KB with the failed-load card), and /drills from 172.2 to 171.4 KB (D72). | §17.1, D65, D72, 3s-08, 3s-09 |
| D75 | **A donation keeps one bit of a `field` event.** Of every event of provenance `field`, `redactForPartner` and `parseDonation` keep its kind, ref, day offset, provenance, `ok` and `data.src` (`fieldOnly`, `FIELD_EVENT_KEYS`, `FIELD_DATA_KEYS`), which covers a field lab's reading and the real-engine run's `predict` and `item`. The score, conf, ms and all other data go: a field item's score is 1 − \|log10(value ÷ prediction)\| and the prediction is public, so a kept score gave the reading back up to the sign of the ratio. No report needs it. Refines §15.2's donation and §16.5's "a donation drops its value and truth". | §15.2, §16.5, §16.10, 3s-07, 3s-13 |
| D76 | **The protégé export prints the passage and the find step only.** `public/lessons-md` gives a block's sentences, the find question and its options without the key, then a line saying the tag and fix steps follow in the app (`protegeLater`). No tag or fix stem, option or why is exported, since a fix restates the false line and a tag can echo it. In the app the tag opens only after the find, and a tag key shares at most one content word with the false sentence, with no lure sharing fewer (`tests/lesson/protege.test.ts`). Replaces SF2's fixed export stems. | §16.9, 3s-11, 3s-12 |
| D77 | **The measured run checks its cap, not characters.** The generation worker returns text only, so the untimed warm-up asks for hi + 1 tokens (41). Decoding is greedy, so every run is a prefix of one answer, and a long run that reached its cap of 40 has less text than the warm-up: a long run with as much text as the warm-up ended early and is refused, and so is one with no more text than the short run. An answer of 40 tokens or fewer cannot be timed. The model select is locked while a run holds the slot. | §16.10, 3s-13 |
| D78 | **Interview mode's objections fit the incident line.** Code still draws the three objections (`pickObjections`). `buildInterviewerPacket` swaps out an incident objection the packet's incident line does not support (`supportedObjections`: the incident not played, no suspect held, no probe taken or no recovery) for a supported one of the same topic, else one of the topic the draw left out, chosen by a hash of the replaced id, so a rebuilt packet is the same packet. The incident line and the shift's handoff note say no suspect was held when the learner held "unsure" or nothing (`suspectHeld`). | §16.4, §16.6, 3s-06, 3s-08 |
| D79 | **ROOT does not require t6.l12.** `ROOT_LESSONS` stays T6's first ten lessons and T7's five: rings are derived, so adding stretch's t6.l12 would take ROOT away from every learner who holds it on deploy (D25's reasoning). Whether ROOT grows is the owner's call. `tests/economy/table.test.ts` filters out t6.l12 alone, so any other new T6 or T7 lesson must join the list. | §16.2, D25, 3s-03 |
| D80 | **F2's intention-to-treat population is every check of labs 01 to 03 that was ever red, by the arm recorded on its acks.** A check counts as ever red when it is left out of a recorded run's `passed`, or when it was helped, since help shows only under a red check. The page records an arm only on a `hint:` or `packet:` ack, and neither a donation nor the report's stripped export keeps `exp:seed`. So a red check that was never helped has no recorded arm and is never given one (hint-ladders.md §2). It is counted in the population, and its first cold check is reported alone. The ITT's armed checks are therefore the primary's, and its d is the primary's own: the line prints the population's counts and says so (D100). A true intention-to-treat d needs the arm recorded when a check is first shown red, which is a page change for the owner to open. | §15.1, D65, XF1, XF3 |
| D81 | **An attempt to green is a recorded run.** It is a `lab-check` event of the check's lab, counted from the check's first red run through the first later run in which it passed. A check that no later run turned green is reported as not green yet. | §15.1, D65, XF1 |
| D82 | **F2's unseen-seed gap is the share of a check's runs after its first green in which it was red again.** Every ForgeLab run draws fresh seeds, and the crate's own-seed runs (`cargo test`) are never recorded, so each of those runs is on newly drawn seeds. | §15.1, D65, XF1 |
| D83 | **Minutes to green are the recorded `ms` of the lab's runs from the check's first red run to its first green**, which is the time F1 counts for labs. They are printed with the whole days between those runs. No lab event carries the page's visible time (D59 covers the Daily and Fleet Week), and none records the coding time between runs. A check whose span has a run with no `ms` is left out and counted. | §15.1, D59, D65, XF1 |
| D84 | **The share of red checks with any help is pooled, not by arm**, because a check with no help records no arm. Its denominator is the checks red in a recorded run. Any `hint:` ack (R0 included, written when a check's help is first expanded) or `packet:` ack counts as help, as in the primary. | §15.1, D65, XF1 |
| D85 | **Packet use per red check by arm (§3) and packet use per arm as the contamination check (§5) are one line.** Each use is one `packet:lab/<lab>/<check>` ack, counted over the checks of each recorded arm. The line gives uses per check and the share of checks with any. | §15.1, D65, XF1 |
| D86 | **Rungs reached is the highest rung acked per check, by arm**, in the order R0 < R1 < R2 < R3 < R4 < bottom-out. A check helped by packets alone is "packet only". | §15.1, D65, XF1 |
| D87 | **Each bottom-out opens one 24 h window on its lab.** A donation carries no instants, so a window's runs are the lab's runs credited `assisted`, each assigned to the latest bottom-out before it. Windows on one lab may overlap, and the line says so. | §15.1, D65, XF1 |
| D88 | **F2's Prove-it attempt rate is split by the recorded arms of the lab's helped checks**: ladder only, packet only, both, or none. The rate itself is all-green randomized labs followed by a `prove:<lab>` event, Wave 2's F6 rule. It is split this way because Prove-it is per lab and the arms are per check. | §15.1, D65, XF1 |
| D89 | **§5's lab-by-arm table gives, for each randomized lab and recorded arm, the checks, the help acks and the primary's first-cold-check accuracy pooled over checks.** Help acks are rungs opened plus packet uses. A cell prints "no outcome" where no check has one. The accuracy is held back until the decision, and its n (the checks with an outcome) is printed in its place (D97). | §15.1, D65, XF1, XF3 |
| D90 | **A randomized lab's release day is the first day the full exports show both an armed hint ack and an armed packet ack for it**, taking the later of the two first days across ledgers. Labs print in that order, descriptively, each with its day counted after the first lab's (D104). A donation keeps day offsets and no calendar day (§15.2), so donations are not in it, and the line says so. | §15.1, §15.2, D65, XF1 |
| D91 | **§5's help-seeking counts per arm, the safety read, are the rungs opened and the packet uses per arm**, over the arm's checks and learners, with the checks not green yet as the stuck signal (D101). "Ask a human" is a link and records nothing. | §15.1, D65, XF1 |
| D92 | **A donation keeps a `lab-check` event's `data.passed`.** Only check-id-shaped strings are kept (`/^[a-z][a-z0-9_]{0,47}$/`, no run of 32 hex digits, deduplicated, at most 32), on a `lab-check` only and never on a `field` event, and `parseDonation` checks them again. The run's per-check detail (`checks`: seeds, statuses, fresh flags) still goes, and the donation dialog says the check names are kept (D103). This refines §15.2. It removes the premise of the note beside hint-ladders.md §7's sign-off ("a donation keeps no per-check timing") without changing what that note fixed: the primary does not read `passed` and still anchors at the lab's first all-green run for every ledger (D61). | §15.2, D61, XF1 |
| D93 | **Every per-arm F2 secondary output reads only checks whose acks name a single arm.** A check helped before its arm was known (§6.3), or with both arms recorded (§2), is out of each per-arm line, as it is out of the primary. The population line counts such checks, and the pooled share of red checks with help counts their help. A bottom-out on such a check is counted outside the arms. | §15.1, D65, XF1 |
| D94 | **F3's secondary outputs show accuracies only after the decision**: once the primary reaches its 197 learners, or when the report is read after the decision (D98). Until then the report prints the counts: checks and learners per group and per fault KC, learners with a Daily, and learners in one group only. Every accuracy is replaced by "held back until the decision (§5: no interim looks at outcomes; n = … of 197 …)", in F2's words, and `--json` holds the same values back (D99). The reason: fleet-daily.md §4 shows nothing before the minimum and prints no difference, two groups' accuracies side by side are that difference, and §5 lets only counts be read before the decision. Refines D65 and §15.3. | §15.3, D65, XF2, XF3 |
| D95 | **F3's secondary outputs never classify a check.** `selectDailyVsOther` hands each eligible check it counts to an optional sink (`DailyCheck`), and `selectDailySecondary` reads only those. A check therefore sits in the same group in the primary and in every table. The primary's numbers are byte-identical with and without the sink. | §15.1, D65, XF2 |
| D96 | **The per-fault-KC table counts an answer once for each fault KC it carries, as the primary does.** It lists the four fault KCs in the file's order and gives any other KC a check names a row of its own, so the rows add up to the pooled groups. A cell's learners are those with at least one check in it. "Learners with a check in only one group" counts learners whose eligible checks all fall in one group, each group separately. "Learners with a Daily" counts donors with any `inc:daily/` incident, eligible or not. | §15.1, D65, XF2 |
| D97 | **F2's secondary outputs hold back every outcome until the decision, as D94 does for F3.** Until the primary reaches 126 learners, or the report is read after the decision (D98), F2's block prints the counts and help-seeking measures only: the population, the share of red checks with any help, packet use, rungs reached, bottom-outs and their windows, the release order and the help-seeking counts. Each outcome line, pooled or by arm, prints its name, its n and that it is held back: the never-helped checks' first cold check, attempts to green, the unseen-seed gap, minutes to green, the Prove-it attempt rate and the lab-by-arm accuracy. The reason is hint-ladders.md §5, which allows no interim look at outcomes and lets only help-seeking counts be read. This reads all of §3's per-arm process outcomes as outcomes under §5, the conservative reading. | §15.3, D65, D94, XF3 |
| D98 | **"The decision" is the primary reaching its required n, or the owner's `--after-decision`.** The owner passes `scripts/partner-report.ts --after-decision` only after recording the F2 and F3 decisions, the underpowered defaults included. It shows every held-back output of both blocks, and F2's and F3's rows end "(read after the decision was recorded: --after-decision)". The primaries' own text lines do not change with it (pinned), so an underpowered primary's d prints only in `--json --after-decision`. The flag is a Wave 3 flag only (with `--wave1` or `--wave2` it is a usage error), and it changes nothing while a file is unsigned. | §15.3, D94, D97, XF3 |
| D99 | **`--json` holds back what the text holds back.** `wave3ReportJson` replaces each held-back value with `{ n, held: true }`: the primaries' d and bounds (`hint.diff`, `daily.diff`), F3's pooled accuracies (`daily.daily`, `daily.other`) and every outcome of the two blocks. F3's cells keep their learners, and the gap keeps its checks. Verdicts, counts and each n stay. Once powered, or after the decision, the JSON is the report object unchanged. Below their minimum this changes the primaries' JSON, which printed d and accuracies at d31a770; no verdict or text line changes. | §15.3, D97, D98, XF3 |
| D100 | **The ITT line computes no d of its own.** Its armed checks are the primary's by construction (D80), so a second bootstrap (seed `hint-ladders:itt`) would print the primary's d with different bounds. The line prints the population's counts (learners with a cold check in both arms, learners with any, checks per arm) and says its d is the primary's. | §15.1, D80, XF3 |
| D101 | **Each arm's "not green yet" is a help-seeking count, shown before the decision.** hint-ladders.md §5's example of the safety read is "if the packet arm turns out to leave learners stuck". So the help-seeking line keeps, per arm, the checks red in a run that no later run turned green, in the text and in `--json`. The never-helped checks are in no arm: the text prints their not-green count beside their attempts to green, and the JSON keeps it, since never-helped checks less the attempts' n give it back (4fb07d2). | §15.1, D91, D97, XF3 |
| D102 | **Both blocks print directly under their own row, and nothing while their file is unsigned**; the row says the file is not signed. F2's block reports "among n donors (self-selected; no causal claim beyond the randomization within them)", in §5's words, and counts its population "from k of the n donors", as F3's block does. | §15.3, D65, XF3 |
| D103 | **The donation dialog names the passed check ids.** Its "Kept besides" sentence now begins "the names of the checks each lab run passed", before the numbers, so the hardware exception qualifies only the numbers (D92). | §15.2, D92, XF3 |
| D104 | **F2's release order prints days after the first lab's release, never a calendar date.** The report's header says "day offsets only, no calendar dates", so the line gives each randomized lab's release as days after the first lab's, in the text and in `--json`; the calendar days stay inside the selector. A test checks that neither view of the block holds an ISO date. | §15.1, §15.2, D90, 4fb07d2 |

## Owner questions

The owner has asked us to proceed on these defaults and record them; nothing waits for an answer.

| # | Question | Default we build |
|---|---|---|
| Q1 | Start Wave 3 from the Wave 2 integration commit (2b with 2b-17 and 2b-21, 2c after its fix round), as a linear stack 3a → 3b → 3c → 3s (D1, D2)? | Yes. If Wave 2 is on `master` by then, 3a branches from `master`. |
| Q2 | Does `proved` mean "after an unseen-seed green, predicted your own module's replies to a seeded call list" (D5)? It is an honour system, framed as calibration. | Yes. |
| Q3 | Labs 04–08 with faded ladders (R0–R2, then the packet) and outside the ladder-or-packet experiment (D13)? | Yes. |
| Q4 | W5's two families are `prefill` and `rollout`, and no exit gate depends on the Fleet exercises (D6, D7)? | Yes. |
| Q5 | Does the EPLB play use synthetic seeded loads on a 16-expert toy layer, scored by max/mean imbalance, with no step-time physics (D8)? | Yes. |
| Q6 | Do W7's level-4 figures become 130.0 vs 734.6 FLOP/B, one tile shape with raster order alone, instead of the plan's ≈127 vs ≈950 (D10)? | Yes. |
| Q7 | Build the 3D cube (stretch) on the three and R3F already in `package.json` (D9)? | Yes, after the 2D cube ships. 3s-01 builds the scene dark; learners see it only through 3s-02's counterbalanced arms, and 3s-02 merges only after the owner signs the 3D pre-registration. The two are cut or kept together. **Superseded by D66** (the owner, 2026-10-15): a plain opt-in on every level, with the evaluation built and dormant. |
| Q8 | /me replaces /progress (a redirect) and is gated at 200 KB once rebuilt (D20)? | Yes. |
| Q9 | K5 forms: opt-in; A before a track's first lesson, B after its spiral, C at least 30 days after B; measurement only (no card is rescheduled); only tracks with 12 generated items over at least 3 KCs (§12.6)? | Yes. |
| Q10 | Receipts verify by equality at the cited precision with a re-run; the rubric is self-review only; the screenshot goes (D14)? | Yes. |
| Q11 | Make {t2.address-translation, t5.block-tables, t5.prefix-cache-keys} a confusable set, so Today interleaves the paging, PagedAttention and radix discrimination that P3's metric measures? It would not replace Wave 1's t2.address-translation ↔ t2.pagedattention-as-paging pair (a KC may sit in several sets, and `graph.test.ts:54–65` checks only `toContain`), but t2.address-translation would reach the 3-entry cap, the four KCs would form one interleaving component on Today (`composer.ts:153–170`), and verify-kc's confusable-set count would change (§4.3). | No: no extra interleaving; the metric reads the three KCs directly (§15.1). |
| Q12 | Build the watcher only if the pre-registration is signed, the backtest is independently rated and the report says `keep` (D18)? | The manual scan stays until all three hold. |
| Q13 | Add an optional, local background pick (never donated) in Boot's last step and on /me, for P3's work analogues (D15)? | Yes. |
| Q14 | Ship the lab 06 twin only if the pinned vLLM scheduler file supports three tracing questions (§9)? | Yes; lab 07's twin alone still meets the line. |
| Q15 | Cut the leaderboard's physics floors (D12)? | Cut. |
| Q16 | Keep the split of the existing claims registry deferred, and add Wave 3's claims as lazy groups (D19)? | Yes. |
| Q17 | Pin twin and engine-flag claims to the releases current at implementation? | Yes, recorded in each claim's `pin`. |

**Item-validity rule (carried from Waves 1 and 2).** Every learner-facing multiple-choice item added in Wave 3 carries a `why` per option and lands in a named pool that `verify-items` (§4.1) or `verify-generators` (B27's cue gate) checks. The pools are `iso` (P3 break items), `twin` (tracing questions), `primm` (labs 04–08), `lessons` (a new quiz item in t4.l6), `generator` (forms serve existing families' choice variants), and in stretch `protege` and `lessons`. Prefer non-multiple-choice evidence: `prefill`, `rollout` and `tiling` are numeric only, and so are the cube's predictions; Prove-it v2 answers are numbers or ordered id lists; Fleet exercise and sim-task predictions are numeric (Wave 1's rule for task predictions); the align step of P3 is matching, not multiple choice. Every content task names its pool (§19.2).

---

## 0. Summary

Wave 2 took the loop to every track and built the World (the scheduler play, incidents, your engine) and a Forge without the wall. Wave 3 adds the depth the plan promised, makes proof real, and finishes the last mile.

**Depth.**
- **W5:** two numeric families (`prefill`, `rollout`) and an EPLB expert-placement play make all 15 T6/T7 lessons hands-on. Two Fleet exercises (the load knee, the P:D split) run on the Fleet engine.
- **W7:** the Tiling Cube opens six prediction-first levels, from "count the cube" (T/2 at FP16) to FlashAttention as cache blocking, in three linked 2D face views with a DOM table. A `tiling` family brings the same arithmetic back on fresh seeds.
- **P3:** all 18 isomorphism panels become align, name the break, then see the principle.
- **Remaining P2:** one task registry for every sim, and no credit without a prediction.

**Proof.**
- **H4 v2:** `proved` provenance goes live. After an unseen-seed green, you predict what your own module replies to a seeded list of calls, and the page runs it.
- **Labs 04–08:** they join the forge layer with faded scaffolds.
- **Lab 06:** races the reference (RING 0's "within 3 points") and sees itself in a bestiary of 12 policies.
- **Receipts:** replace Fleet Week's keyword counts. Each number cites a run the page re-runs.
- **Twins:** labs 07 and 06 meet their production counterparts at pinned SHAs.

**The Mirror.** `/me` replaces `/progress`:
- VRK₃₀ and cold checks with intervals;
- calibration and the optimism offset;
- competence statements;
- opt-in track forms A/B/C.

**Measurement.** The exit's build gates are owned by tasks (§18.1). Its field gates (the journey re-cut, the H3 and Daily keep-or-kill rules, the watcher decision) need partners, calendar time or the owner's signature. Agents cannot satisfy them: Wave 3 ships the selectors, the donation fields and the report rows that measure them.

**Out of scope** (and where it goes): every Wave 4 gated item (PLAN §8): Cube 3D as default, S5 physics and its exercises, the Device Mesh, F6 lab 10, agent-session Fleet mode, the On-Call shift, W2, F5, labs 09 and 11, the PyO3 bridge, F3c, F3e, K1 v2, learner item PRs, Seasons, peer review and credentials. Also out: the BYOK tutor (PLAN §10); the leaderboard's physics floors (D12); the split of the existing claims registry (D19); arXiv feeds and link-rot checks in the watcher (D18).

---

## 1. Scope, base, invariants

**Base and branches.**
- `wave-3a` is the Wave 2 integration commit 4b32c09 (`wave-2c` 2663128 merged with `wave-2b` 7c1d329, D2), plus this spec's commits. Every task prompt names the base sha it starts from. External dependencies are written `w2:<task>`; the base holds them all.
- The stack is linear (D1). 3a's levels merge into `wave-3a`. `wave-3b` branches from 3a's merged tip, `wave-3c` from 3b's, and `wave-3s` from 3c's. Stretch tasks start in the plan's order while the review queue is under 10 h (PLAN §8).
- Each PR is opened against the previous wave branch (the owner merges in order; stacked PRs).

**What Wave 3 builds on** (all from Wave 2): the play registry, `LockstepModel` and per-play production rows (2b); the Fleet engine's EPD cluster, fleet-worker sessions and fault hooks (2b); the engine store and slots (2b-04); the forge bundles and panels (2c-01, 2c-02); the item block and the four T6/T7 families (2a); the hint-ladder experiment and H2 packets (2c-06); the outcome selectors, redacted donations and the partner report (2a-21); the watcher backtest harness (2a-20); the a11y harness with the sideways-scroll check at 360 and 320 px.

**Invariants.** W1–W14 of the Wave 1 and Wave 2 specs stand: evidence, not clicks; derived, not stored; pure generators; constants from claims; zero imports; untrusted code off the main thread; no new runtime dependency; nothing locks; validation before writers; faults are data; one scorer; module bytes stay on the device; version-pinned facts carry a pin; one owner per file per level. Wave 3 adds:

| # | Invariant |
|---|---|
| W15 | **Proof reads your module, never the reference.** A Prove-it v2 answer is graded against your module's own replies, run in the lab worker; the reference solutions stay in the gitignored `labs/_solutions/`. |
| W16 | **A receipt is re-run, never trusted.** A cited number counts only when the page reproduces it from the run record, with the same entropy and the same module bytes. |
| W17 | **New claims are lazy.** Wave 3 adds no claim to the eager registry (D19); every new claim is imported by the module that shows or uses it. |
| W18 | **Measurement never reschedules.** Forms (src `form`) never update a card, so retention measured on /me is not moved by the measuring. |
| W19 | **No crate changes behaviour in Wave 3.** Labs 04–08 gain STAGE marker comments only: no verb, ABI or check changes. Their archives are repacked, but a module built from an older zip still runs and earns credit. |

---

## 2. Architecture and module map

```
 static content (CI-verified)
   lessons (+ fleet blocks, active isomorphisms, play blocks) · KCs (+ t4.raster-l2-reuse, gen links) ·
   claims (eager registry + lazy groups) · labs.ts (labs 04–08 stages) · forge bundles 01–08 · twins
                                         │
 ledger v3.3 ──▶ learner/{provenance, vrk, competence, cold-checks, forms, iso} [pure] ──▶ /me (the Mirror)
 (prove v2 + proved,      │
  form/play sources,      └──▶ economy (RING 0 lab 06 race, ROOT achievement) ──▶ ring checklists
  fw:runs, background)
 world/tiling (pure) ──▶ families/tiling ──▶ /play/tiling-cube (2D: three face views + DOM table) · Today
 world/eplb (lockstep, ghost = EPLB) ──▶ /play/eplb ──▶ t6.l2
 families/{prefill, rollout} ──▶ item blocks in t6.l3, t6.l7, t6.l10 · Today · forms
 world/fleet-ex/* ──▶ fleet worker job 'exercise' ──▶ FleetExercise panel (fleet blocks in t6.l3, t7.l2)
 lab worker 'calls' ──▶ forge/prove2 ──▶ ProveFromModule (ForgeLab) · ProveReturnCard (Today, 30 days)
 fleet-receipts (run records, re-run) ──▶ Fleet Week Acts I–III (receipts, rubric)
 forge/race + world/bestiary (sim worker) ──▶ RaceReference (lab 06) ──▶ RING 0
 twins/<lab> ──▶ TwinPanel (ForgeLab)
 landscape/digest (only on `keep`) ──▶ weekly issue · TRIAGE.md
```

### 2.1 New modules

| Path | Contents | Task |
|---|---|---|
| `src/lib/world/tiling.ts`, `src/lib/items/families/tiling.ts` | the cube's model; the `tiling` family | 3a-13 |
| `src/lib/world/{eplb,eplb-policy}.ts` | the EPLB world, ghost and Compose | 3a-14 |
| `src/lib/world/bands/<play>.ts` | practice bands, one module per play | 3a-05, 3a-13, 3a-14 |
| `src/lib/items/families/{prefill,rollout}.ts` | W5's two families | 3a-15, 3a-16 |
| `src/lib/world/fleet-ex/{index,knee,pd-split}.ts` | Fleet exercises | 3a-03, 3b-03 |
| `src/components/fleet-ex/*` | the exercise panel | 3a-03, 3b-20 |
| `src/lib/forge/{prove2,prove-return,race}.ts` | Prove-it v2, the 30-day return, lab 06's race | 3a-11, 3b-04, 3b-09 |
| `src/lib/world/{bestiary,radix}.ts` | 12 scheduler policies; lab 07's in-browser reference | 3b-09, 3b-13 |
| `src/data/forge/<lab>/{index,primm,ladder,prove,prove2}.ts` | bundles for labs 04–08; v2 for 02, 04, 06, 07 | 3a-22, 3b-10 … 3b-14 |
| `src/data/twins/*` | production twins | 3b-08, 3b-15 |
| `src/lib/fleet-receipts.ts`, `src/components/fleetweek/*`, `src/data/fleetweek/exemplars.ts` | receipts and the rubric | 3a-12, 3b-05 |
| `src/components/lesson/Isomorphism.tsx`, `src/lib/learner/iso.ts` | active isomorphisms | 3a-03, 3b-07 |
| `src/lib/learner/{provenance,vrk,competence,cold-checks,forms}.ts` | K5 selectors | 3a-17, 3b-19 |
| `src/pages/Me.tsx`, `src/pages/me/*`, `src/components/me/*` | the Mirror | 3a-02, 3b-06 (the fold), 3b-06b (the Mirror), 3b-19, 3c-05 |
| `src/data/claims/{all.ts,lazy/*}` | the full registry for tooling; lazy claim groups | 3a-07, 3a-08 |
| `src/components/play/{tiling-cube,eplb}/*` | the two plays | 3b-01, 3b-02 |
| `scripts/landscape/digest.ts`, `.github/workflows/landscape-watch.yml`, `TRIAGE.md` | the watcher, only on `keep` | 3c-04 |

### 2.2 Routes and budgets

| Route | Page | Budget (gzip, §17.1) | Offline |
|---|---|---|---|
| `/me` | the Mirror (replaces `/progress`) | 200 KB: reported from 3a-02, gated from 3b-06 | no |
| `/progress` | redirect to `/me` (`replace`), as `/field-notes` redirects (`App.tsx:82`) | — | — |
| `/play/tiling-cube` | the Tiling Cube (existing `/play/:playId`) | reported, figure 200 KB, with its play chunk | no |
| `/play/eplb` | the EPLB play | reported, figure 200 KB, with its play chunk | no |

- Each new route joins `App.tsx`, `staticRoutes` in `scripts/prepare-pages.mjs` (`me`, `play/tiling-cube`, `play/eplb`; today :9–27), the palette's page list (`STATIC_ITEMS`, `CommandPalette.tsx:22`), `verify-bundle`'s `ROUTE_BUDGETS` (`verify-bundle.ts:63–71`) and a11y's default routes (`a11y.mjs:28–43`).
- Nav "Me" points at `/me` and holds `/me` and `/progress` (`nav-links.ts:24`). The other `/progress` links move: `Footer.tsx:8`, `Navbar.tsx:208`, `CommandPalette.tsx:38`, `Forge.tsx:197`. Two more (`Capstone.tsx:1124`, `src/components/ledger/LedgerNotices.tsx:24, 32`) keep working through the redirect.
- **Why /me is reported before it is gated (D20).** Until 3b-06, `Me.tsx` wraps today's Progress page, whose static closure is about 615 KB: one import of all lesson content (`Progress.tsx:47`, used once at :93) pulls the 394 KB lessons chunk, and framer-motion adds about 40 KB. 3a-02 routes /me through `lazyMotion`, as Progress is routed today (`App.tsx:34`; B26's list in `tests/shell/nav.test.ts:163–168`). 3b-06 rebuilds the page without either and turns the line into a gate (the declared flip of D3). It also routes /me with plain `lazy` in `App.tsx`: `lazyMotion` loads `src/lib/motion.tsx`, which imports framer-motion, beside the page, and verify-bundle's closure follows only the page's static imports, so it would never see that ≈ 40 KB. Each lazy /me section that uses framer-motion renders inside `MotionScope`.
- **The plays** load from `Play.tsx` through the registry, so their route figure counts the play chunk (`playSrc`, `verify-bundle.ts:36–50`). A row whose `playSrc` file does not exist yet prints "skip <route>: <playSrc> does not exist yet" (3a-02); without that check, `bundle-plays.ts`'s by-name fallback hands a missing play the scheduler's hoisted `_Play-*` chunk and reports the scheduler's figure under the new route.

### 2.3 What level 0 scaffolds (3a-02, 3a-03, 3a-06)

So that 3b and 3c fill files instead of editing shared ones:

**Types** (`src/data/lessons/types.ts`, 3a-03):
```ts
export interface SimExerciseBlock { type: 'exercise'; simId: SimId; machine?: string; title: string; tasks: string[];
  note?: string; taskIds?: string[]; config?: unknown }          // today's ExerciseBlock, unchanged (types.ts:148–165)
export interface FleetExerciseBlock { type: 'exercise'; fleet: string; title: string; note?: string }  // PLAN §7.2
export type ExerciseBlock = SimExerciseBlock | FleetExerciseBlock
export interface IsomorphismPair { os: string; osLine: string; llm: string; llmLine: string; breaks?: string
  work?: { backgrounds: Background[]; os: string; osLine: string; breaks: string } }   // §11.3
export interface IsomorphismBlock { type: 'isomorphism'; title?: string; pairs: IsomorphismPair[]
  principle?: string            // ≤ 40 words, shown after the break (§11.1)
  breakItem?: QuizQuestion      // "where does this analogy break?" (pool `iso`)
  kcs?: KcId[] }                // the block's KCs; default: the lesson's
// Background is the ledger's type (§3.2), imported here, so 3a-03 follows 3a-01.
```

**Bundles** (`src/data/forge/types.ts`, 3a-03): `ForgeBundle` (`types.ts:204–222`) gains `fade?: 'r2'` (ladders stop at R2 and the packet follows, §8.2) and `prove2?: ProveV2Spec` (§7.2).

**Seams:**
- **Renderers.** `ExerciseView` (`exercise.tsx`) narrows on `fleet` and renders a lazy `FleetExercise({block, lessonId, index})` stub. `IsomorphismView` (`blocks.tsx:117–148`) moves unchanged into `src/components/lesson/Isomorphism.tsx`, and the dispatcher (`blocks.tsx:438`) imports it from there; 3b-07 then fills it without touching `blocks.tsx`.
- **The exporter** prints fleet blocks, pairs with their breaks (it omits breaks today, `export-lessons-md.ts:58–61`) and the principle, and break items without their keys, as it prints quizzes. Lessons without breaks export byte-identically; the ten T0–T2 lessons whose 29 pairs carry `breaks` gain their "where it breaks" lines, which is the only change in their markdown.
- **Readers of exercise-only fields** narrow on the union: `Progress.tsx:97` reads `block.tasks` and narrows with `'tasks' in block` (3a-03), as does any other reader `tsc -b` flags. One reader is outside tsc's view (`tsconfig.app.json` includes only `src`): `scripts/kc/seed-candidates.ts:56–57`, not run in CI, spreads `b.tasks` for every exercise block and would throw on the first fleet block; 3a-03 narrows it too.
- **`FLEET_EXERCISES`** is exported empty from `src/lib/world/fleet-ex/index.ts`, with the `FleetExerciseDef`, `SweepPoint` and `SweepResult` types (§5.3). The hands-on test (3a-05b) counts a fleet block whose exercise is listed there, so 3b-03 adds exercises without touching the test.

**Mounts:**
- **ForgeLab** (3a-06): `TwinPanel({lab, done})`, `RaceReference({lab, bytes, report, credit})` and `ProveFromModule({lab, bundle, bytes, report, credit})` are lazy stubs that render nothing and export their final props types. ForgeLab already keeps the last run's bytes, report and credit for `InstallButton` (`ForgeLab.tsx:393`); it passes the same values. 3b-04, 3b-08 and 3b-09 then never edit `ForgeLab.tsx`.
- **Today** (3a-06): `ProveReturnCard({variant})` is a lazy stub beside `DailyCard` on the done card and the empty state (`DoneCard.tsx:13, 89`, `EmptyState.tsx:6, 41`).
- **/me** (3b-06b): `FormsCard()` is a lazy stub that 3b-19 fills.

**Pending lists.** A lesson can place a play block before its play is registered; such a block renders nothing (`PENDING_PLAYS`, `src/components/play/registry.ts`). The tiling-cube and EPLB blocks are placed only after their plays register (3b-18, 3b-21), so the list stays empty.

---

## 3. Ledger contract v3.3 (tasks 3a-01, 3a-01b)

### 3.1 Versions and the upgrade path

- **`SCHEMA_VERSION = 6`** (`constants.ts:9`). A Wave 2 bundle's codec rejects the new item sources, ProveData v2, `proved` on a prove event and the two new working keys. Validation runs at import, outbox recovery and cross-tab sync, so a Wave 2 tab would silently drop them. With the bump it goes read-only through the existing guard (`guard.ts`), as wave-2 §3.1 did for v3.2.
- **Exports** carry `schemaVersion: 6`; import accepts ≤ 6 (`codec.ts:414`).
- **`AGGREGATE_VERSION = 4`** (`constants.ts:15`). The `upgradeAggregate` chain gains a v3 → v4 step (`fold.ts:325–361`), and `isAggregate` and the hydrate path accept v1–v3 snapshots and upgrade them (`progress.ts:262–277, 287–316`), so the first Wave 3 load never paints empty.
- **OD1 stands.** Nothing stored is rewritten. **`IDB_VERSION` stays 1** (`names.ts:11`).

### 3.2 Refs and data

**No ref grammar changes.** Every Wave 3 ref already passes `REF_RULES` (`refs.ts:115–133`):

| Ref | Kind | Example | Writer |
|---|---|---|---|
| `prove:<labId>` | `prove` | `prove:kv-block-manager` | Prove-it v1 and v2 (§7) |
| `play:tiling-cube`, `play:eplb` | `play` | — | the plays (§5.2, §6.3) |
| `gen:<family>/<variant>` | `item`, `predict` | `gen:tiling/raster-ai` | cube levels (src `play`), forms (src `form`), item blocks |
| `item:fleet.<exerciseId>` | `item`, `predict` | `item:fleet.knee` | Fleet exercises (src `lesson`, §5.3) |
| `item:<lessonId>.iso.<n>`, `item:<lessonId>.iso.<n>.break` | `item` | `item:t2.l2.iso.1.break` (n from 1, as align refs) | P3 (§11.1) |
| `item:lab<NN>.twin.<n>` | `item` | `item:lab07.twin.1` | twins (§9) |
| `fleet:engine` | `fleet-run` | — | lab 06's race (§8.3) |
| `fw:engine`, `fw:fleet`, `fw:business` | `fleet-act` | — | Fleet Week with receipts (§10) |
| `item:field.<lab>.<metric>`, `item:engine.measured-tps` | `item`, `predict` | `item:field.decode-kv.tps` | stretch: field labs and the real-engine run (§16.5, §16.10), src `practice`, provenance `field` |
| `item:<lessonId>.protege.<n>.<step>` (step `find`, `tag` or `fix`), `item:cube.spatial.<n>` | `item` | `item:t4.l3.protege.1.find` | stretch: protégé blocks (src `lesson`, §16.9) and the spatial proxy (src `practice`, §16.1) |

**Types** (`types.ts`):

```ts
export type ItemSrc = /* today's 13 (types.ts:176–189) */ | 'form' | 'play'   // PREDICT_SRCS gains 'play' and 'practice'
// ItemData (types.ts:193–237) gains, all optional:
//   formId?: 'A' | 'B' | 'C'; formSlot?: number /* 0–11 */; formSet?: 0 | 1 | 2; track?: string   // form items (§12.6)
//   return?: true                                                                                    // the 30-day return's v1 follow-up item (§7.5)
// data.form stays TicketForm ('ticket' | 'spiral' | 'testout') and data.slot stays the Today or ticket position.
export type Background = 'jvm' | 'backend' | 'sre' | 'ml' | 'student' | 'other'   // BACKGROUNDS in constants.ts

export interface ProveDataV1 { v: 1; qids: string[]; self: number[]; kcs?: KcId[] }   // today's (types.ts:368–375)
export interface ProveDataV2 {
  v: 2
  qid: string                          // the template, e.g. 'free-after' (§7.2)
  kcs: KcId[]                          // the KCs of the checks the template exercises, ≤ 6
  answer: number | number[]            // the learner's prediction: a number or an ordered id list
  actual: number | number[] | null     // what the module replied; null when it trapped or timed out
  calls: number                        // verb calls that ran, 1–12
  return?: true                        // the 30-day return (§7.5)
}
export type ProveData = ProveDataV1 | ProveDataV2

export interface PlayMetric { name: 'imbalance'; mine: number; ghost: number; lowerIsBetter: true }
export interface PlayLevel { id: string; ok: boolean; logErr?: number; view?: '2d' | '3d' }
// PlayData (types.ts:332–345) gains metric?: PlayMetric and levels?: PlayLevel[] (≤ 8);
// its spec widens to PlacementSpecData | SchedSpecData | EplbSpecData
export interface EplbSpecData { replicate: 'none' | 'per-copy' | 'total'; place: 'round-robin' | 'least-loaded' }

export interface RunRecord {           // one Fleet Week run that receipts cite (§10.2); Opus approves this shape before 3a-01 starts, and 3a-12 imports it
  id: string                           // 8 lowercase hex: sha256(stableStringify(record without id and at)), first 8
  act: 'engine' | 'fleet' | 'business'
  job: JsonObject                      // the SimJob, module bytes replaced by {slot, sha256}
  entropy: number                      // the uint32 handed to drawGradedSeeds
  values: Record<string, number>       // §10.1's keys
  at: IsoInstant
}
export interface FleetActData {        // FleetActMeta.data for Acts I–III (types.ts:1094–1099)
  receipts?: { cited: number; verified: number; uncited: number }
  rubric?: { capacity: 0 | 1 | 2 | 3; slo: 0 | 1 | 2 | 3; cost: 0 | 1 | 2 | 3; failure: 0 | 1 | 2 | 3 }  // self-review
  runs?: string[]                      // receipt ids cited, ≤ 20
}
```

**Codec** (`codec.ts`):
- **Sources.** `ITEM_SRCS` (:53) gains `form` and `play`; `PREDICT_SRCS` (:54) gains `play` and `practice` (the 3s-13 prediction).
- **Form items** (src `form`): `data.formId` ∈ {A, B, C}, `data.track` a track id, `data.formSlot` an integer 0–11, `data.formSet` ∈ {0, 1, 2}. They never use `data.form` or `data.slot`, which ticket and Today readers already read (`cards.ts:375`, `fold.ts:165`, `outcomes.ts:396, 829`, `progress.ts:805`).
- **The return flag.** `data.return` is absent or `true` on an item (the v1 follow-up of §7.5) as on ProveData v2.
- **Stretch shapes, defined now so no stretch task edits the ledger:** field-lab and real-engine items and predictions (src `practice`, provenance `field`), protégé items (src `lesson`) and the spatial proxy (src `practice`), with the refs of the table above. All pass `REF_RULES` as `item:` refs today.
- **`checkData('prove')`** (:175–178):
  - v1 is checked as today, and `v` is now checked too.
  - v2: `qid` is non-empty and ≤ 40 characters; `kcs` ≤ 6; `answer` and `actual` are finite numbers or arrays of ≤ 12 non-negative integers (`actual` may be null); `calls` is an integer 1–12; `return` is absent or `true`.
  - **Provenance `proved` is accepted only on a v2 event with `ok: true` and a 64-hex `wasmSha256` in the envelope.** Every other `proved` prove event is rejected.
- **`checkData('play')`** (:171–174): `metric` has a known name and finite `mine` and `ghost` ≥ 0; `levels` has ≤ 8 entries, each a string `id` and a boolean `ok`, with optional finite `logErr` ≥ 0 and `view` in the set; `spec` may be an `EplbSpecData` with known values.
- **`checkData('fleet-act')`** (no case today): `receipts` holds non-negative integers; `rubric` holds four integers 0–3; `runs` holds ≤ 20 strings of 8 hex digits.
- **Working keys** join `WORKING_EXACT` (:228–245), and `checkWorkingValue` (:254–275) checks them:
  - `fw:runs` is an array of ≤ 50 RunRecords: an 8-hex `id`, a known `act`, a `job` object of ≤ 4 KB serialized, a uint32 `entropy`, ≤ 40 finite `values`, an ISO `at`.
  - `profile:background` is one of `BACKGROUNDS`.

**Scores.**
- **`prove` v2:** `score = ok ? 1 : 0`, with `ok = answer equals actual` (§7.3). Provenance is `proved` or `practice` (§7.3). v1 stays `practice`.
- **`play:eplb`:** `score = min(1, ghost ÷ mine)`; `ok = mine ≤ ghost + 0.05`. In the compose phase, `ok` when the spec is equivalent, or within 0.05 on all its traces.
- **`play:tiling-cube`:** `score` = levels right ÷ 6; `ok` once all six levels are attempted (the closing debrief is reached). The fold's `play:` fact (`fold.ts:249–263`) therefore means "debriefed", as for the other plays.
- **Form items** are graded like any item and are never card reviews (W18; 3a-17 changes `cards.ts`).

### 3.3 Façade (`LedgerFacadeActionsV33`)

| Action | Writes | Change |
|---|---|---|
| `recordProve(r)` | `prove prove:<lab>` | takes `provenance: 'practice' \| 'proved'` (default `practice`) and `wasmSha256`; ProveData v1 or v2. Today it hard-codes `practice` (`progress.ts:849–851`) |
| `recordPlay(r)` | `play play:<id>` | carries `metric`, `levels` and `EplbSpecData` through |
| `setWorking('fw:runs', records)` | working | existing action; newest last, oldest dropped past 50 |
| `setWorking('profile:background', b)` | working | existing action; broadcast to other tabs |
| `completeFleetWeekAct(act, score, meta)` | `fleet-act fw:<act>` | as today (`progress.ts:664–674`); 3b-05 passes the seed, provenance `unseen` and `FleetActData` |

### 3.4 Aggregate v4 and rings

| Field | Fold (order-insensitive) |
|---|---|
| `proved[labId]` | min `at` of an ok `prove` event with provenance `proved` |
| `labFleetOk[labId]` | `true` when an ok `fleet-run` with provenance `unseen` and mode `engine` has exactly one component, from `labId` (ok = within 3 points of the reference, `fold.ts:77–78`) |

- **RING 0** (`economy.ts:358–359`) adds `labFleetOk['batching-scheduler']`: the plan's "lab 06 within 3 points of the reference", deferred by wave-2 D14. Lab 06's race (§8.3) is its only writer. 3a-01b adds it and its checklist row (`ring-rows.ts:80–87`), which takes RING 0 from 2 rows to 3; the row-count pin (`tests/economy/rings.test.ts:595`, `[3, 3, 2, 6]` today) becomes `[3, 3, 3, 6]`.
- **ROOT's cold-check part** is already safe: `selectColdChecks` reads the `ach:root-cold` achievement that `useRingEvidence` unlocks the first time the bar is met, so a merge that inserts earlier misses cannot revoke ROOT (25e4b8a; `economy.ts:290–323`, `src/pages/progress/useRingEvidence.ts:38–40`). Wave 3 keeps its tests green and builds no second mechanism.
- **Prices** (3a-01b; `economy-table.ts:59–62`): `PLAY_MINUTES['tiling-cube'] = 25`, `PLAY_MINUTES.eplb = 15`. As in Wave 2, prices land before the plays register; the economy test requires every registered play to be priced with its `PlayDef.minutes`.

### 3.5 Working keys

| Key | Value | Writer | Broadcast |
|---|---|---|---|
| `fw:runs` | `RunRecord[]`, ≤ 50 | Fleet Week (3b-05) | yes |
| `profile:background` | `Background` | Boot's last step and /me (3c-05) | yes |

Neither is ever donated: the redaction keeps no working record except the week plan's SLO (`redact.ts:155`).

### 3.6 Tests (3a-01; the RING 0 and ROOT lines are 3a-01b's)

`tests/ledger/contract-v33.test.ts`, plus `OPS_TABLE` entries (`tests/ledger/gen.ts:173–676`). The entries are: prove v2 (weighted to include `proved`), a form item, a v1 return item, a play-source item and prediction, a field item, a play with `metric` and `levels`, a fleet act with receipts and rubric, and the two working keys. The tests cover:
- P6/P7 (order-insensitivity, optimistic agreement) and the export round trip, at 100 seeds × 40 ops.
- Codec round trip of every new shape, and rejection of each malformed case:
  - `proved` on a v1 event, on a not-ok event, or without `wasmSha256`;
  - `calls` of 0 or 13;
  - a form `formSlot` of 12, and a form item that sets `data.form` to `'A'`;
  - a level whose `ok` is not boolean;
  - a rubric score of 4;
  - a 9-hex receipt id;
  - 51 run records;
  - background `'rust'`.
- The outbox keeps every new shape.
- `upgradeAggregate` from v1, v2 and v3 snapshots deep-equals `derive_v4` on their fields.
- The schema guard at 6 vs 5 goes read-only.
- A Wave 2 fixture ledger derives identically on every v3 field.
- `contract-v32.test.ts` relaxes its exact pins to "at least" (`:98–101, 134, 138, 144, 146`), as contract-v31 did for v3.2.
- RING 0 with and without `labFleetOk`, and the RING 0 row count (3a-01b).
- ROOT's existing "stays earned after an earlier miss merges in" tests stay green (3a-01b).

---

## 4. Gates, KCs and claims first (3a level 0)

### 4.1 Item gates (3a-04)

**Today** (`wave-3a`) `verify-items` passes. It gates 290 lesson items (278 quiz plus 12 PRIMM), 8 Fleet Week Act IV items and 67 errata items, plus five own pools: prequestion 49, predictAt 16, spiral 42, align 7, primm 12.

Wave 3:
- **The `iso` pool.** Every `IsomorphismBlock.breakItem`, with ref `item:<lessonId>.iso.<n>.break` (`n` counts the lesson's isomorphism blocks from 1, as align refs count) and the block's KCs (else the lesson's).
- **The `twin` pool.** Every `src/data/twins/<lab>.ts` that exports `TWIN_ITEMS`, found by readdir (the `discoverPrimm` pattern, `item-pools.ts:116–126`).
- **Both run every gate.** They join `checkPoolItems` (`verify-items.ts:809`) and `ALL_OWN_POOLS` (:819): structure, a why per option, the cue limits per pool (≤ chance + 15 points), odd-one-out, the longest-key ratchet (baseline entry 0) and the adversary (:1026).
- **Labs 04–08's PRIMM items** join the existing `primm` pool through `discoverPrimm`; no gate change.
- **The content margin: `bun run verify:items -- --subset <selector>`.** The selector is a comma-separated list of ref prefixes, or one `/regex/`. It matches the ref verify-items prints for each item: `<lessonId> q<n>` for lesson quizzes (`verify-items.ts:215`), `forge/<lab dir> <item id>` for PRIMM items (`:228`, e.g. `forge/kv-block-manager lab02.primm.p1`), and `item:…` for the align, iso and twin pools. It runs every strategy and the adversary over the selected items and prints n and their hit rates.
  - It exits 1 when the selection is empty, so a mistyped selector never passes on zero items.
  - At n ≥ 12 it exits 1 above chance + 10 points. Below 12 a hit rate moves 8 points or more per item, so it reports the rates without failing, and the merged-level run decides.
  - Each content task runs it on its own refs: a lab's PRIMM items with `'forge/<lab dir> '`, a twin's with `item:lab07.twin.`, P3's T0–T2 break items with `'/^item:t[0-2]\.l[0-9]+\.iso\./'`.
  - For any single strategy, a pooled hit rate is a weighted mean of the parts' rates. Parallel content tasks that each keep within 10 points therefore cannot push the merged pool past the 15-point gate.
  - The adversary learns over the pool, so the integrator still runs `verify:items` on every merged level (§19.1).
- **Alignment refs are 1-based in both `AlignItem` and item-pools** (2c fix 9111d08; `tests/lesson/align.test.ts` holds the lesson's ref equal to the pool's). 3a-04 keeps that test and `verify-items.test.ts:48` green.
- **The PRIMM row** already prints with the gate's own comparison (`overChance`, 25e4b8a); nothing to do.
- **Not touched:** `OWN_POOLS` (`item-cues.ts:242`; pinned by `mc-cues.test.ts:478`); the 68-lesson pins (`verify-items.test.ts:186`).

### 4.2 Play, sim, determinism and mentor gates (3a-05, 3a-05b)

- **Practice bands by module (3a-05).** Today `practiceBandOf(id, root)` (`verify-plays.ts:230–252`) is async and knows only block placement and the scheduler; a new play fails with "add it to practiceBandOf". Bands move to `src/lib/world/bands/<playId>.ts`, each exporting `band(read: (repoPath: string) => Promise<string>): Promise<{ok: boolean; detail: string}>`, and are discovered by readdir. A band that needs trace files (the scheduler's two `public/traces/burstgpt-v2-busiest-*.json`) reads them through the injected loader; nothing under `src/lib/world/bands` imports `node:fs`. The two existing bands move unchanged. The scheduler's `ok` is `checkSchedBand(practiceMinute(source)).inBand`, over all five §8.2 rules (wave-2 D33: the shared practice minute, `SCHED_PRACTICE_MINUTE_SEED`, is in band on all five, and verify-plays enforces all five; `sched-traces.ts:306`); its `detail` is today's note ("in band on all five rules", or the rules missed). The mapping from that result to `{ok, detail}` is a pure export of the band module, and `tests/plays/bands.test.ts` shows that a result missing only rule 2, only rule 3 or only rule 5 is out of band (the pinned minute passes all five either way, so the existing test cannot catch a weakened rule). `practiceBandOf(id, root)` stays exported with its signature, delegates to the module, maps its `{ok, detail}` to today's `{inBand, note}`, and returns null for an unknown play (the test "the practice minute is in band on every §8.2 rule, and verify-plays enforces all five", `tests/plays/scheduler.test.ts:530–537`; the null check is :537). 3a-13 and 3a-14 then add the cube's and EPLB's bands without editing `verify-plays.ts`.
- **Claim ids from the full registry (3a-05).** `verify-plays` builds `claimIds` from `src/data/claims/all.ts` (§4.4; today the eager `CLAIMS`, `verify-plays.ts:259, 267`), and the card-claim checks in `tests/plays/play.test.ts` and `tests/plays/scheduler.test.ts` do the same, so the cube's and EPLB's lazy card claims pass. The exact `PLAY_IDS` pins (`play.test.ts:84`, and the `PLAY_IDS` pin in `scheduler.test.ts`, :225) become "starts with `block-placement`, `scheduler`", so 3b-01 and 3b-02 register plays without editing them; the ties of `PLAYS`, `PLAY_REGISTRY` and `PLAY_PRODUCTION_ROWS` to `PLAY_IDS` stay.
- **Mirrors.** `src/components/fleet-ex` joins the mirror scope; its charts are SVG with a `SimMirror` table, or a canvas with `aria-describedby` to one.
- **Unchanged:** `GATE_3D = ['tiling-cube', 'device-mesh']` (`verify-plays.ts:106`) and the ≥ 3 production rows per play (:161).
- **Hands-on (3a-05b).** `tests/kc/hands-on.test.ts` (definition at :46–56) counts a fleet block whose `fleet` id is in `FLEET_EXERCISES`. The gate stays at ≥ 10 (12 today); 3c-01 makes it all 15 by id. Its "a pending play and an unregistered task do not count" fixture already uses an unregistered id (`no-such-play`, `hands-on.test.ts:83`) and keeps it.
- **Sim registry (3a-05b).** `tests/sims/registry.test.ts:82` hard-codes the outcome prefixes `/^(roof|kv|alloc|zoo)\./`; it now accepts the prefixes the tasks files declare. A tasks file may also export `HOME: {simId, machine?}`, which the registry reads before `LEGACY_HOME` (`registry.ts:29–40`), so moving inline lists into files (§13) adds files without editing that table. Where the sim has machines, a HOME names the machine the component renders the list on (for example `batching.tasks.ts`: `{simId: 'sim-batching', machine: 'batching'}`): `forSim` keeps machine-less tasks on every machine (`registry.ts:127`), so a machine-less HOME would put the batching tasks on the scheduler and context-switch machines and fail the pin that the default batching query is empty (`registry.test.ts:95`).
- **Determinism (3a-05b).** `src/lib/world/**` and `src/lib/items/families/**` are already in scope (`verify-determinism.ts:152–161`); that covers tiling, EPLB, the Fleet exercises, the bestiary, radix, prefill and rollout. Added: `src/lib/learner/{provenance,vrk,competence,cold-checks,forms,iso}.ts` and `src/lib/forge/prove2.ts`.
- **Mentor (3a-05b).** `lint-mentor` requires R0–R4 for every required check (`lint-mentor.ts:50`). A bundle with `fade: 'r2'` needs R0–R2, and may omit R3 and R4. Every other rule stands.

### 4.3 The KC contract (3a-09)

**New KC.** `t4.raster-l2-reuse` ("Raster order decides L2 reuse"), introduced in t4.l6, requires `t4.tiling-intensity`, kind concept. It is t4.l6's third `Lesson.kcs` entry (`matmul-tiling.ts:14`). The graph goes from 153 to 154 KCs (cap 200).

**Gen links,** set now so the family tasks never edit a KC file (wave-2 §4.2's rule: `Gen.kcs` must equal the KCs whose `gen` lists the family):

| Family | KCs whose `gen` lists it |
|---|---|
| `tiling` | `t4.shared-memory-scratchpad`, `t4.occupancy`, `t4.raster-l2-reuse`, `t4.ridge-point` (keeps `roofline`), `t4.flashattention-blocking` |
| `prefill` | `t6.epd-phases`, `t6.kv-tiering`, `t6.cache-timing-oracle` |
| `rollout` | `t6.rollout-bound-rl`, `t6.weight-sync` |

- `PENDING_FAMILIES` (`verify-kc.ts:48`) gains `tiling`, `prefill` and `rollout`.
- **No confusable change (Q11).** P3's metric is discrimination between paging, PagedAttention's block tables and the radix cache. Its selector reads `t2.address-translation`, `t5.block-tables` and `t5.prefix-cache-keys` directly (§15.1). Making them a confusable set would make Today interleave them (`composer.ts` interleaves only inside confusable components, :153–170). It would not replace the `t2.address-translation` ↔ `t2.pagedattention-as-paging` pair that Wave 1 pins (a KC may sit in several sets; `graph.test.ts:54–65` checks only `toContain`), but t2.address-translation would reach the 3-entry cap (`verify-kc.ts:180–185`), the four KCs would become one interleaving component, and verify-kc's set count would change. The owner keeps "no" unless extra interleaving is wanted.
- **verify-kc reads the full claims registry** (`src/data/claims/all.ts`, §4.4) for its known-claims set (3a-09, after 3a-07), and so do the two tests that build verify-kc's input and expect no errors on the committed graph (`tests/kc/verify.test.ts:21`, `tests/kc/scope.test.ts:136`), which 3a-09 owns too. Wave 3 still attaches no lazy claim to a KC (§4.4).
- **Labs 04–08's check KCs** (§8.1) are tagged by 3a-10, which follows 3a-09 in level 0 and edits the same KC files and `tests/kc/graph.test.ts`, whose `labs` and `requires` pins of the newly tagged KCs (:194–212) move with the tags.

### 4.4 Claims (3a-07, 3a-08)

**Lazy groups (3a-07, D19).** Today `src/data/claims/index.ts` imports seven groups eagerly; the chunk is 17.1–17.4 KB gzip and loads on /boot and /today.
- `registerClaims(group)` adds a group once (idempotent; a duplicate id with a different body throws).
- `getClaim` on an unknown id throws with the name of the lazy group that holds it, which `all.ts` knows.
- New groups live under `src/data/claims/lazy/`. Each consumer (a family, a play, a panel) imports its group, which registers on import.
- `src/data/claims/all.ts` imports the registry and every lazy group. `verify-claims`, `public/claims.json`, the /freshness claims table (`ClaimsTable.tsx`) and the search index read it.
- **Every gate that checks claim ids reads `all.ts`:** `verify-claims` and `verify-search-index` (3a-07; `verify-search-index.ts:12` imports the eager `byId` today, and would reject a lazy claim's index row), `verify-plays` and the plays tests (3a-05), and `verify-kc` (3a-09). 3a-05 and 3a-09 follow 3a-07 inside level 0. `src/data/plays.ts` never imports a lazy group: Up Next loads it on /today (`up-next.ts:42`), and a lazy group there would load on /today at runtime.
- A static-import walk proves `Boot.tsx` and `Today.tsx` never reach `src/data/claims/lazy/` (the `tests/boot/imports.test.ts` pattern).
- **KC claims stay eager.** H2 packets read a KC's claims through `claimsFor` (`src/lib/mentor/packet.ts:278–288`), which imports the eager `byId` and silently skips an unknown id. Wave 3's lazy claims go to plays, families, panels and cards, never to a KC's `claims`; a later wave that wants one has `claimsFor` import `all.ts` (it is already a dynamic import).
- The split of the existing 169 claims stays deferred.

**Wave 3 claims (3a-08).** Each claim is quoted with url, quote and `verifiedAt`, or pinned with `{repo, ref}` and a url that contains the ref (`pinProblems`, `schema.ts:45–56`). A claim that cannot be quoted is dropped with a note in the PR, never invented. A cube level whose figure is dropped uses a labelled synthetic value. The owner signs off the quotes.

| Group | Claim (proposed id) | Kind | Value | Used by |
|---|---|---|---|---|
| `lazy/tiling.ts` | `hw.h100-sxm.sm-count` | spec | 132 SMs | cube levels 3–4 |
| | `hw.h100-sxm.l2` | spec | 50 MB | level 4 (the L2 window check) |
| | `hw.h100-sxm.smem-per-sm`, `hw.h100-sxm.smem-per-block` | spec | 228 KiB, 227 KiB | levels 2–3 |
| | `hw.h100-sxm.registers-per-sm` | spec | 65,536 × 32-bit | level 3 |
| | `hw.h100-sxm.fp8-sparse` | spec | 3,958 TFLOPS | level 5 |
| | `hw.h100-sxm.fp8-dense` | derived | floor(sparse ÷ 2) = 1,979 TFLOPS | level 5 (as `bf16-dense` is derived, `hardware.ts:59`) |
| | `production.triton.group-size-m` | status, pinned | the grouped raster's group size in Triton's matmul tutorial | cube card |
| `lazy/moe.ts` | `model.deepseek-v3.routed-experts`, `model.deepseek-v3.experts-per-token` | spec, pinned | 256, 8, from `config.json` at the zoo's pinned revision | EPLB card |
| | `production.eplb.rebalance` | status, pinned | DeepSeek EPLB's `rebalance_experts` and its replication rule (`deepseek-ai/EPLB` at a sha) | EPLB card |
| | `production.vllm.eplb`, `production.sglang.eplb` | status, pinned | the EPLB flag and the redundant-expert setting at the current releases | EPLB card |
| `lazy/serving3.ts` | `production.vllm.disagg`, `production.sglang.disagg` | status, pinned | the prefill/decode disaggregation flags | P:D split rows (§5.3) |
| | `bench.checkpoint-engine.sync` | benchmark | "1T in about 20 s" (serving-landscape.md:149), only if quotable | a cited comparison line in `sync-seconds`' solution, never a pin (the evidence gives no bytes, shard count or link bandwidth) |
| `lazy/twins.ts` | `twin.sglang.treecore` | status, pinned, ttlDays 60 | Rust TreeCore, SGLang's default since 2026-09-29 (PR #39627; serving-landscape.md:116) | lab 07's twin |
| | `twin.vllm.scheduler` | status, pinned, ttlDays 60 | vLLM v1's scheduler at the current release | lab 06's twin |

The search index (18.2 KB of 20 KB at `wave-3a` by `verify:search-index`; verify-bundle's ⌘K line prints 18.6 KB) indexes these claims too. 3a-08 grows it by ≤ 1.2 KB gzip and prints the size. If a merged index would pass 20 KB, the integrator shortens `CAN_MAX` (41 → 32, `build-search-index.ts:33–34`) before asking the owner to raise wave-2 D24's 20 KB budget.

---

## 5. W5: T6/T7 hands-on (tasks 3a-14 … 3a-16, 3b-02, 3b-03, 3b-20, 3b-21, 3c-06)

**Today.** 12 of the 15 T6/T7 lessons are hands-on by wave-2 §5.4's definition (`tests/kc/hands-on.test.ts`); t6.l3, t6.l7 and t6.l10 are not. The Fleet engine has no experts and no speculation: one 50 ms tick advances every running sequence by one prefill chunk or one decode token (`fleet-model.ts`). `EpdCluster` takes any number of prefill and decode workers (`fleet-model.ts:1363–1477`), but its only builder hard-codes one of each (`fleet-host.ts:244–249`), and its aggregate has no TPOT p95 (:1450–1476).

### 5.1 The `prefill` and `rollout` families (3a-15, 3a-16)

Both families are numeric only: no choice variant, so no cue gate applies (D6). Scenario numbers live in `SYNTHETIC` and the prompt says "a hypothetical …". Real-world numbers come only through `claimNumber`. Each family has levels 0–3, `ratioRules`, `solution` steps, pins, a hash fixture of its own, and a chunk of ≤ 8 KB.

**`prefill`** (KCs `t6.epd-phases`, `t6.kv-tiering`, `t6.cache-timing-oracle`)

| Variant | Asks | Answer | KC |
|---|---|---|---|
| `pd-ratio` | a fleet with arrivals λ req/s, mean prompt P and output O tokens, prefill throughput p tok/s per GPU and decode throughput d tok/s per GPU at the TPOT SLO: prefill GPUs ÷ decode GPUs = (λ·P/p) ÷ (λ·O/d) | numeric (ratio) | `t6.epd-phases` |
| `transfer-ms` | the KV of a P-token prompt at b bytes per token over a link of B GB/s: milliseconds to hand it to the decode worker | numeric (ms) | `t6.epd-phases` |
| `load-or-recompute` | the tier bandwidth at which loading a cached prefix costs the same as recomputing it at prefill rate p: b × p | numeric (GB/s) | `t6.kv-tiering` |
| `hit-gap` | the TTFT a prefix hit saves: cached tokens ÷ prefill rate. This is the timing oracle's signal (t6.l10, `security-boundaries.ts:289`) | numeric (ms) | `t6.cache-timing-oracle` |
| `namespace-cost` | N tenants share an S-token system prompt; with the tenant in the cache key, each prefills it once instead of once for all: extra prefill GPU-seconds = (N − 1)·S ÷ p | numeric (s) | `t6.cache-timing-oracle` |

- **Diagnoses:**
  - `prefill.flipped` (decode over prefill);
  - `prefill.tokens-not-rate` (a ratio of token counts that ignores per-GPU rates);
  - `prefill.bits-bytes` (×8);
  - `prefill.ms-s` (×1,000);
  - `prefill.gb-gib` (×1.0737);
  - `prefill.one-tenant` (forgot N − 1).
- **Pins** are hand-computed instances. If t6.l3's ≈25 ms KV-transfer budget (its deep dive) states its inputs, a `transfer-ms` instance reproduces it.

**`rollout`** (KCs `t6.rollout-bound-rl`, `t6.weight-sync`)

| Variant | Asks | Answer | KC |
|---|---|---|---|
| `rollout-share` | rollout takes a share f of an RL step; rollout throughput rises s×: the step's speedup 1 ÷ ((1 − f) + f/s) | numeric (×) | `t6.rollout-bound-rl` |
| `long-tail` | a synchronous group of k samples whose output lengths are listed (a `table` prompt part), decoded at one rate: the share of sequence slots idle while the longest finishes, 1 − mean ÷ max | numeric (%) | `t6.rollout-bound-rl` |
| `group-tokens` | prompts × samples per prompt × mean output tokens: tokens one step generates | numeric | `t6.rollout-bound-rl` |
| `sync-seconds` | each rollout worker pulls only its slice of the new weights (`sharded_rdt`, serving-landscape.md:149). The weights are split over S ranks (one seeded shard count, labelled synthetic): params × bytes ÷ S ÷ link bandwidth. A harder variant splits dense and expert parameters: a rank holds dense ÷ TP + experts ÷ EP, with EP stated as reusing the TP × DP ranks (as in vLLM and SGLang), never TP·EP as a product | numeric (s) | `t6.weight-sync` |

- **Diagnoses:**
  - `rollout.linear` (speedup s, ignoring the training share);
  - `rollout.mean-not-max`;
  - `rollout.unsliced` (×S: forgot to slice);
  - `rollout.bits-bytes`.
- **Scenario numbers.** The lesson's "70–90 % of wall-clock" (t6.l7) is a `SYNTHETIC` range. `bench.checkpoint-engine.sync` ("1T in about 20 s") appears only as a cited comparison line in `sync-seconds`' solution, never as a pin: the evidence states no bytes, shard count or link bandwidth.

### 5.2 The EPLB play (3a-14 world, 3b-02 UI)

**The rule is the concept.** t6.l2 teaches EPLB as "a bin-packing problem: … replicate the hottest experts … reassign expert→GPU placement" (`wide-ep.ts:33–37`), and t6.l1 says a hot expert's GPU makes "143 others wait at the combine barrier" (`moe-anatomy.ts:27`). The evidence proposes exactly this play: "Pack experts with skewed (sourced) routing frequencies onto GPUs, with replication allowed. Score: max GPU load" (games-3d.md:207; audit/interactive.md:260). It is 2D: the rule is the concept, on ≤ 2 axes (PLAN §5.4.0).

**World** (`src/lib/world/eplb.ts`, pure, in the determinism scope):
- **The scenario** (synthetic, labelled): one MoE layer with 16 experts on 4 GPUs of 5 slots each, so 4 replicas fit. `drawLoads(seed)` gives 16 loads in integer per mille, summing to 1,000, from a seeded skewed draw. In band (`bands/eplb.ts`):
  1. the hottest expert carries 150–300 ‰;
  2. round-robin placement without replicas has imbalance ≥ 1.4;
  3. the ghost reaches ≤ 1.10.

  Acceptance must be ≥ 20 %, printed.
- **Turns** (`LockstepModel`, `world/play.ts:47–53`):
  - 4 replicate turns: pick an expert to copy. Its load splits evenly over its copies.
  - Then 20 place turns: copies are offered heaviest first, by load per copy, and you choose a GPU with a free slot.
  - After 5 turns, "skip to debrief" lets the ghost finish (`SKIP_AFTER_TURNS`).
- **The outcome.** A GPU's load is the sum of its copies' loads. Imbalance = max load ÷ mean load (the mean is 250 ‰). Lower is better: the layer's expert phase waits for the busiest GPU at the combine barrier.
- **The ghost** is DeepSeek EPLB's balanced packing, played up front and hidden until the debrief (`production.eplb.rebalance`). Replicate: add a copy to the expert with the highest load per copy, repeatedly. Place: put each copy, heaviest first, on the least-loaded GPU that has a free slot (ties go to the lower index).
- **The debrief** (`eplbDivergence`) walks back to the first divergence from which handing the rest to the ghost would have met its imbalance, with one sentence per kind:
  - replicate: "At turn 2 you copied expert #9 (60 ‰ per copy). The reference copies #3: 140 ‰ per copy is the heaviest."
  - place: "At turn 15 you put #3's copy (70 ‰) on GPU 2, already at 260 ‰. The reference puts it on GPU 4, the least loaded with a free slot (190 ‰)." (Turns 1–4 replicate, so a place sentence that names four loaded GPUs comes from a late place turn.)
  - outcome: "Your busiest GPU carries 1.38× the mean, so this layer's expert phase waits 38 % longer than a balanced one."

  These are templates. 3a-14's tests generate each sentence from the world on banded seeds, never copying these examples: the "least loaded with a free slot" GPU is the one the ghost picks in that state. The Opus check (3a-14) approves the sentences on 50 banded seeds.
- **Compose** (`eplb-policy.ts`): `{replicate: 'none' | 'per-copy' | 'total', place: 'round-robin' | 'least-loaded'}`. `compileEplbPolicy({per-copy, least-loaded})` equals the ghost at every turn on the practice load and on 1,000 banded loads (test). The Compose table runs a spec on the practice load and 5 fresh loads.

**The loop** (3b-02):
1. **Predict first:** "Round-robin, no replicas: the busiest GPU's load ÷ the mean?" (numeric, log-scored).
2. **Play** the practice load.
3. **Debrief.**
4. **Compose.**
5. **Pass** when your imbalance is within 0.05 of the ghost's on the practice load and on 3 fresh loads (W5: "passes on 3 fresh seeds").
6. **The In-production card**, with ≥ 3 rows: DeepSeek-V3's 256 routed experts and 8 per token; DeepSeek EPLB's rebalancing rule; vLLM's and SGLang's EPLB and redundant-expert settings at pinned releases (§4.4). A row that cannot be quoted is dropped.

**UI** (`src/components/play/eplb/*`):
- The GPUs are rows of slot buttons (≥ 44 px), and each copy shows its load.
- The next copy is announced in an `aria-live` line; arrows move between GPUs and Enter places.
- The mirror is a table of GPUs × copies with loads and the running imbalance.
- Reduced motion is respected. It plays at 360 px by tap and by keyboard (`e2e/eplb.spec.ts`).
- `recordPlay` writes phase `play` or `compose`, `metric {name: 'imbalance', mine, ghost, lowerIsBetter: true}`, and KCs `t6.expert-load-balance` and `t6.all-to-all`.
- `PlayDef {id: 'eplb', lessonId: 't6.l2', minutes: 15}`. `paths.ts` and `recommend()` place and offer it after t6.l2 with no code change (`withPlays`, `paths.ts:260–264`; rule 5, `recommend.ts:244–272`).

| Seven-test gate | How the EPLB play passes |
|---|---|
| intrinsic | replicating and placing copies *is* expert load balancing |
| ≥ 3 axes | expert load, copy count, slot capacity per GPU |
| model-backed | the EPLB algorithm (pinned); the loads are synthetic and labelled |
| recurs in ≥ 3 sessions | t6.l1–l2 cards in Today; fresh loads on replay |
| schematic | rows of slots, not hardware |
| low load | turn-based, pausable, a DOM mirror, skip after 5 turns |
| debriefed | first divergence, then Compose |

### 5.3 Fleet exercises (3b-03 engine, 3b-20 panel, 3c-06 blocks; cut 2nd)

```ts
// src/lib/world/fleet-ex/index.ts (3a-03 creates it empty; 3b-03 fills it)
export interface FleetExerciseDef {
  id: string                        // 'knee' | 'pd-split' (stretch adds four, §16.3)
  title: string
  lessonId: string
  kcs: KcId[]
  unit: string                      // what the learner predicts
  points: readonly number[]         // the sweep, e.g. load multipliers or prefill-worker counts
  sweep(seed: number): SweepResult  // pure and deterministic: runs the Fleet engine classes (fleet-model.ts) at each point,
                                    // or a stated model for an exercise the engine cannot express (labelled so)
  truth(results: SweepResult): number     // the right answer for this seed's run
  band(results: SweepResult): boolean     // the seed is a fair question
  pass(prediction: number, results: SweepResult): boolean  // the pass rule (3b-03): both exercises ask for the exact point
  productionClaims: string[]        // rows of the In-production card
  phone: { canonical: SweepResult } // phone mode's outcome
}
export interface SweepPoint {
  x: number
  goodputRps: number                // SLO-met requests ÷ the trace's arrival window in seconds (50 ms per tick); never Engine.goodput()'s percentage
  ttftP95: number
  tpotP95?: number
  metrics?: Record<string, number>  // anything else an exercise reads (e.g. speedup, idle share, hit rate)
}
export interface SweepResult { points: SweepPoint[] }
export const FLEET_EXERCISES: Readonly<Record<string, FleetExerciseDef>>
```

| Exercise | Lesson | KCs | The sweep (fleet worker, flat tick, labelled v1) | You predict |
|---|---|---|---|---|
| `knee` | t7.l2 | `t7.goodput-curve`, `t7.benchmark-hygiene` | a seeded BurstGPT-shaped trace at load × {0.5, 0.75, 1, 1.25, 1.5, 2} on one `Engine`: `goodputRps` (requests within the SLO per second of the trace's arrival window) and TTFT p95 per point | the load multiplier where goodput peaks (in band: an interior peak, ≥ 10 % above both ends) |
| `pd-split` | t6.l3 | `t6.epd-phases` | 8 workers split p : 8 − p for p = 1 … 7 on one `EpdCluster`, long prompts, interference on: `goodputRps` (the same rate), TTFT p95, TPOT p95 | the number of prefill workers with the highest goodput (in band: an interior optimum) |

- **Engine (3b-03).**
  - A fleet-worker job `{kind: 'exercise', id, seed}` calls `FLEET_EXERCISES[id].sweep(seed)` and returns the result within the 10 s job budget (`fleet-protocol.ts:27`). It dispatches by id only, so a later exercise (§16.3) adds a fleet-ex module and never edits `fleet-protocol.ts`, `fleet-host.ts` or `fleet-session.ts`.
  - `EpdOpen` and `openEpd` take `{prefill, decode}` worker counts. 1 + 1 stays the default, so existing EPD runs are byte-identical (test).
  - `EpdCluster`'s aggregate gains TPOT p95, which only the exercise job reports. The EPD session's result keeps its shape (`tests/fleet/session.test.ts` pins it).
- **Panel (3b-20).**
  - A numeric prediction comes first. The sweep runs on `freshSeed()` and draws an SVG chart with a `SimMirror` table.
  - The explain step requires ≥ 8 words and three ideas ticked (TaskPanel's rule, `host.ts:366`); no text is stored.
  - The exercise is done after 3 right predictions in a row on fresh seeds whose right answers include at least 2 different values, each round's scene shown before its prediction (D39). As an item block does, it records `predict` and `item item:fleet.<id>` events with src `lesson`, `grp = <lessonId>#<block>`, the seed and provenance `unseen`, and restores its state from them after a reload.
  - The In-production rows: `knee` reuses `production.vllm.max-num-seqs` and `production.sglang.max-running-requests` (`engines.ts`, pinned); `pd-split` uses the disaggregation flags (§4.4).
  - Phone mode shows the canonical outcome.
- **Cut order.** The exercises are the first cut after stretch (PLAN §8.1). No exit gate depends on them (D6).

### 5.4 Placement and 15/15 (3b-21)

| Lesson | Hands-on block added in Wave 3 | KCs it assesses (∩ `Lesson.kcs`) |
|---|---|---|
| t6.l2 | play `eplb` (beside its `cost/node-day` item block) | `t6.expert-load-balance` |
| t6.l3 | item `prefill/{pd-ratio, transfer-ms}`; fleet `pd-split` (3c-06, cut 2nd) | `t6.epd-phases` |
| t6.l7 | item `rollout/{rollout-share, long-tail}` | `t6.rollout-bound-rl` |
| t6.l10 | item `prefill/{hit-gap, namespace-cost}` | `t6.cache-timing-oracle` |
| t7.l2 | fleet `knee` (3c-06, cut 2nd; already hands-on through `goodput/knee`) | `t7.goodput-curve` |

- **Item block placement.** Each item block sits before its lesson's quiz, as wave-2 §5.4 requires. Its variant KCs intersect `Lesson.kcs`: t6.l3 holds `t6.epd-phases` and `t6.kv-tiering` (`epd-disaggregation.ts:159`); t6.l7 holds `t6.rollout-bound-rl` and `t6.weight-sync` (`rl-rollout.ts:135`); t6.l10 holds `t6.isolation-boundaries`, `t6.cache-timing-oracle` and `t6.tool-authorization` (`security-boundaries.ts:452`).
- **t6.l10 is T6's spiral.** Its spiral ticket stays its checkpoint; the item block is the separate graded active block that hands-on requires.
- **The result is 15 of 15.** 3c-01 turns the gate into all fifteen by id.

---

## 6. W7: the Tiling Cube (tasks 3a-13, 3a-18, 3b-01, 3b-18; 3D in stretch §16.1)

**Today.**
- t4.l6 teaches "`T/2` FLOP/byte at FP16", the ≈590× gap of naive matmul, and FlashAttention as cache blocking (`matmul-tiling.ts:90, 98, 175`). It has a 2-task exercise on RooflineSim (`roof.tile-ai`, `roof.flash-ai`) and no play or item block. Erratum #7 (tiled AI given three ways) is fixed (`errata/2026-10-04-tiled-arithmetic-intensity.ts`).
- RooflineSim's tiling panel has a synthetic SMEM curve that assumes 4-byte elements and K = T (`RooflineSim.tsx:286–294`), which contradicts the FP16 formula; 3a-18 points it at the cube's model.
- The evidence defines the cube's geometry ("FLOPs = volume of a tile (i×j×k), and bytes loaded = the areas of its three face projections", games-3d.md:124) and its mirror ("three linked 2D face views (A, B, C matrices) plus a DOM table", :190–196). It does not derive the plan's level numbers (D10).

### 6.1 The model and its numbers (3a-13; `src/lib/world/tiling.ts`)

Pure, products and sums only. Inputs come from the §4.4 claims: H100 SXM HBM 3.35 TB/s and BF16 dense 989 TFLOPS (exist), plus SMEM, SM count, L2, registers and FP8 (new). b is bytes per element. The FP8 rate is 2 × BF16 dense, the rule RooflineSim and the roofline family already use, so the app has one FP8 ridge; the FP8 claim (1,979 dense) is shown beside it and a test holds it within 1 TFLOPS of 2 × 989.

| Level | The question | Formula | Pin (H100 SXM) | KC |
|---|---|---|---|---|
| 1 Count the cube | a Tm × Tn output tile streams K in slabs of k: FLOP per byte from HBM | AI = 2·Tm·Tn ÷ ((Tm + Tn)·b); C stays in registers and is written once (`roofline.ts:13–17`) | 128 × 128 FP16: **64** (T/2) | `t4.tiling-intensity` (`roofline/tile-ai`) |
| 2 SMEM budget | the largest square tile (a multiple of 32) whose A and B slabs fit SMEM per block, counting SMEM only | smem = stages·(Tm + Tn)·k·b ≤ 227 KiB | k = 64, 2 stages, FP16: **448** (AI 224, still below the ridge, 295.2). SMEM allows it, but its FP32 accumulators need 448²·4 B = 784 KiB of registers against 256 KiB, so it cannot run: level 3 shows the real cap (256 for one CTA, 128 for three) | `t4.shared-memory-scratchpad` |
| 3 Occupancy | CTAs resident per SM | min(⌊228 KiB ÷ smem⌋, ⌊256 KiB ÷ (Tm·Tn·4)⌋): SMEM, and FP32 accumulators in registers | T = 128: **3** (SMEM-bound; registers allow 4); T = 64: 7; T = 256: 1 | `t4.occupancy` |
| 4 Raster order and L2 | the FLOP per HBM byte of one wave of 132 CTAs, one per SM (a persistent kernel, as deep-pipelined Hopper GEMMs run; level 3's 3 CTAs per SM would make a 396-CTA wave), on a 16,384³ GEMM, when tiles in a wave share A and B slabs through L2 | AI_wave = 132·2·Tm·Tn ÷ ((rows·Tm + cols·Tn)·b), with rows × cols the distinct tile rows and columns the wave touches; valid when stages × (rows + cols) slabs fit L2; nothing survives between waves (A and B are 512 MiB each, ≫ 50 MB) | 128 × 128 FP16: row-major (2 rows × 128 columns) **130.0**; grouped 11 × 12 **734.6**; 5.7× from raster order alone | `t4.raster-l2-reuse` |
| 5 FP8 | the ridge at FP8, and the tile size that would reach it | ridge = FP8 rate (2 × BF16 dense) ÷ HBM bandwidth; at b = 1 a square tile's AI is T | **590.4** FLOP/B (1,978 ÷ 3.35). A lone tile would need T ≥ 591 at FP8 as at FP16 (FP8 doubles the roof and halves the bytes), far past the register cap of level 3, so no single CTA tile reaches either ridge on H100; reaching it needs reuse across CTAs through L2 (level 4). The `fp8-ridge` variant's "tile that reaches it" answer is arithmetic only and says so | `t4.ridge-point` |
| 6 FlashAttention | one query block of Br rows streams K and V once: FLOP per HBM byte, and the score matrix it never writes | AI = 4·Br·N·d ÷ (b·2·d·(N + Br)); S = N²·b bytes | N = 32,768, d = 128, Br = 128, FP16: **127.5** FLOP/B; S = **2 GiB** per head | `t4.flashattention-blocking` |

- **Simplifications** are stated in the play: no bank conflicts, the 1 KiB per-CTA SMEM reserve ignored, no register-allocation granularity, waves aligned to grid rows, and level 4's one CTA per SM (a persistent kernel). The evidence asks for this (games-3d.md:277: "label the simplifications in a callout").
- **The Opus check (3a-13)** approves each formula and pin before 3b-01 builds the UI. It may fix level 6's accounting (whether softmax passes count) and record the resulting pins. The single-row bound 127.0 (T·N/(T+N)) and the 128 × 256 grouped figure (965.5, one CTA per SM) are printed beside the level-4 pins, so the plan's two figures can be traced to this model. A test holds that every tile a debrief names as a reference choice has `ctasPerSm ≥ 1`, or that the debrief names the register cap.

### 6.2 The `tiling` family (3a-13)

| Variant | Asks | Answer | KC |
|---|---|---|---|
| `smem-fit` | the largest square tile that fits a seeded SMEM budget, slab depth, stage count and dtype | numeric | `t4.shared-memory-scratchpad` |
| `ctas-per-sm` | resident CTAs per SM for a seeded tile, slab depth and stage count | numeric | `t4.occupancy` |
| `raster-ai` | a wave's FLOP per HBM byte under row-major or grouped raster (group height, tile shape and GEMM size seeded) | numeric | `t4.raster-l2-reuse` |
| `fp8-ridge` | the FP8 ridge, or the square-tile size whose AI reaches it (arithmetic only: such a tile exceeds the register file, and the solution says so) | numeric | `t4.ridge-point` |
| `qblock-ai` | a FlashAttention query block's FLOP per HBM byte, or the bytes of the score matrix it never writes | numeric | `t4.flashattention-blocking` |

- **Diagnoses:**
  - `tiling.counted-c` (counted C's bytes: T/3);
  - `tiling.single-buffer` (forgot the stages);
  - `tiling.fp32-bytes` (4-byte elements);
  - `tiling.smem-only` (ignored registers);
  - `tiling.row-panels` (the row raster's panel count used for a grouped wave);
  - `tiling.fp8-same-ridge` (kept 295);
  - `tiling.materialized` (counted S in FlashAttention's bytes).
- **Pins** are §6.1's.
- **The variants are numeric**, so no cue gate applies. A choice variant added later goes through B27's gate.
- **Today serves the family** through its KCs' cards. `Gen.kcs` equals §4.3's row.

### 6.3 The play (3b-01; `src/components/play/tiling-cube/*`)

**Each level:**
1. **Predict.** An item on a fresh seed: `roofline/tile-ai` for level 1, the `tiling` variant for levels 2–6. It is recorded as `predict` and `item` events with src `play`, log-scored where numeric. The opening blurb is the evidence's generative prompt: "predict the AI of this tile, then rotate to check" (games-3d.md:61), in 2D.
2. **Explore.** Steppers (no drag-only control, WCAG 2.5.7) set the tile (Tm, Tn), slab depth k, stages, dtype, raster order and group height, or Br and N.
   - **Three linked face views** (`Mirror2D.tsx`): A's Tm × k slab, B's k × Tn slab, and C's Tm × Tn tile, as SVG grids with the current tile lit. Level 4 adds a wave map: the output grid with one wave's 132 tiles lit, and the distinct A rows and B columns counted.
   - **A DOM table** (`Mirror.tsx`) shows FLOPs, bytes, AI, SMEM, CTAs per SM and the ridge, and announces changes at most once a second.
3. **Check.** The item is graded, and its error is shown.
4. **Debrief.** The level's reference choice from the model (the largest tile SMEM allows and why the register file forbids it, the occupancy trade-off, grouped raster, why no lone tile reaches the FP8 ridge, the query block) and one line of principle, with claim chips.

**The closing debrief** lists the six errors and the six principles: "intensity is volume ÷ lit surface; raster order alone moved this wave 5.7×".

**Recording and registration:**
- **Ledger.** `recordPlay {phase: 'play', turns: 6, survived: levels right, ghostSurvived: 6, levels: [{id, ok, logErr}]}`; `ok` once the closing debrief is reached.
- **The card** has ≥ 3 rows: H100 SMEM per SM and per block, SM count and L2 (spec claims), and Triton's group size (pinned) if quotable. `verify-plays` checks the rows against `productionClaims`.
- **`PlayDef`** is `{id: 'tiling-cube', lessonId: 't4.l6', minutes: 25, kcs: [the six KCs]}`. `paths.ts` and rule 5 offer it after t4.l6 (§5.2).
- **Band** (`bands/tiling-cube.ts`): every practice instance is gradable; its diagnoses differ from the truth by more than the tolerance; and level 4's two rasters differ ≥ 3×.
- **Budget:** reported, figure 200 KB.

### 6.4 The seven-test gate (PLAN §5.4.0)

| Test | How the cube passes |
|---|---|
| intrinsic | choosing a tile, a raster and a precision *is* blocking for intensity |
| ≥ 3 axes | Tm, Tn and k (and raster, stages, dtype) |
| model-backed | §6.1's model on spec claims, the same numbers as the `tiling` family and RooflineSim (3a-18), with one FP8 ridge (590.4) |
| recurs in ≥ 3 sessions | the family's items on its five KCs in Today; forms (§12.6) |
| schematic | slabs and tiles, not hardware |
| low load | one level at a time, steppers, a DOM table first, reduced motion, no timer |
| debriefed | per level and at the end |

### 6.5 t4.l6 (3b-18)

- A play block `{playId: 'tiling-cube'}` follows the tiling prose.
- One new quiz item on raster order (`t4.raster-l2-reuse`), with a why per option, joins the checkpoint (pool `lessons`).
- The ticket's generated item can draw `tiling` variants through the lesson's KCs (`planTicket`, `ticket.ts:355–402`).
- The existing exercise block (`roof.tile-ai`, `roof.flash-ai`) stays.

---

## 7. H4 v2: `proved` (tasks 3a-11, 3a-22, 3b-04, and the v2 halves of 3b-10, 3b-12, 3b-13)

**Today.** Prove-it v1 asks three of six authored questions about your code. It is self-graded and recorded as `prove prove:<lab>` with provenance hard-coded to `practice` (`progress.ts:849–851`). It is weight ≤ 0.3, outside rings and VRK₃₀ (`prove.ts:7`). Nothing writes `proved`. The 30-day return is promised in the copy (`ProveIt.tsx:242`) but not implemented. ForgeLab grades in `grade` mode and never calls `ks_invoke` (`lab-protocol.ts:6–10`); no worker request can carry an arbitrary command.

The plan: "v2 grades your prediction of your own module on a seeded trace and earns `proved`. One question returns at 30 days; retries use fresh questions after 24 h." The evidence: "3–5 tracing items on the lab's own `src/lib.rs` checks … which request gets preempted first?" (computing-education.md:142), and the simulator, not a model, grades (ai-tutoring.md:165).

### 7.1 Verb calls in the lab worker (3a-11)

- **The request.** `LabRunMode` (`lab-protocol.ts:6–10`) gains `'calls'`: `{id, mode: 'calls', bytes, calls: string[]}` → `{type: 'replies', id, replies: string[]}`, or `failed`.
- **The run.** The worker instantiates the module once and sends each entry of `calls` through `ks_invoke` in order. An entry may contain newlines: a batching-scheduler `schedule` call is one multi-line entry (a header, then W and R lines; `lib.rs:1011`), never split. That is the existing `invoke(cmd)` path (`wasm-lab.ts:226–242`); the bridge keeps its state between lines, as the Fleet drivers rely on.
- **Limits.**
  - One 2 s budget covers the whole list (`LAB_TIMEOUT_MS`, `lab-worker.ts:21`); expiry raises `LabTimeoutError` and the worker is discarded.
  - A trap ends the list as a failed call.
  - Replies are capped at 4 KiB each.
- **Refusals.** A module whose `list` reply names an `@reference` lab is refused, so reference builds earn nothing (F1). A module without `ks_invoke` is refused with "this module has no ks_invoke bridge".
- **Main thread.** No learner code runs there (W6).

### 7.2 Question templates (`src/data/forge/<lab>/prove2.ts`)

```ts
export interface ProveV2Template {
  id: string                                   // 'free-after'
  kcs: KcId[]                                  // the KCs of the checks it exercises
  bug: string                                  // the plausible mistake that changes the answer (for the test)
  make(seed: number): { calls: string[]; story: string[]; ask: string; answer: 'number' | 'ids' }
  read(replies: string[]): number | number[]   // the module's answer, from its replies
}
export interface ProveV2Spec { templates: ProveV2Template[] }   // ForgeBundle.prove2 (§2.3)
```

A seeded trace is at most 12 calls. `story` tells it in words ("Allocate sequence 1 with 40 tokens; fork 1 as 2; append 5 tokens to 2; free 1."). The calls use only verbs the bridges answer today, so W19 holds:

| Lab | Template | The calls (seeded) | You predict | What it separates |
|---|---|---|---|---|
| 02 kv-block-manager | `free-after` | `init 32 16`, then ≤ 10 of `allocate`, `append`, `fork`, `free` | `free_blocks` | freeing a shared block at the first owner's free |
| | `translate` | `init`, `allocate s 40`, `fork`, `append` | the physical block of token t (`translate`) | the free-list order your code chose (FIFO or LIFO) |
| | `shared-after-append` | `init`, `allocate`, `fork`, `append` to the child | shared blocks (from `dump`) | copying on fork instead of on append |
| 04 mpmc-queue | `last-pop` | `init c`, then ≤ 11 `push`/`pop` | the last `pop`'s reply | tracing a correct module (the checks pin FIFO) |
| | `full-count` | `init c` with c not a power of two, `push` × n with pops between | how many pushes replied `full` | your capacity rounding (`queue.rs:38–39` lets `new()` round up or not; the checks use only powers of two) |
| | `after-wrap` | `init 4`, six push/pop pairs | the value popped after the index wraps | tracing a correct module (the checks pin wraparound) |
| 06 batching-scheduler | `admit-order` | `init`, one `schedule` view (≤ 6 waiting, ≤ 4 running) | the admit list, in order | arrival order vs shortest first |
| | `admit-count` | `init`, a view whose running requests' tokens leave little of `mem_cap` free | how many are admitted | no headroom |
| | `walk-past` (D38; was `preempt`) | `init`, a view whose oldest waiting request does not fit what `mem_cap` leaves free | the admit list, in order | skipping what does not fit vs stopping at it |
| 07 radix-cache | `match-len` | `reset`, `insert` × 3, `match` | the match length | tracing a correct module (the checks pin exact and longest-prefix matching) |
| | `match-after-split` | `reset`, `insert`, a diverging `insert`, `match` | the match length | tracing a correct module (a node split) |

- **Verbs.** They come from the bridges: kv-block-manager (`lib.rs:655–695`), mpmc-queue (`lib.rs:327, 341–370`), batching-scheduler (`schedule`, `lib.rs:1002, 1035`; its view format is `wasm-scheduler.ts`), radix-cache (`lib.rs:599–614`).
- **The scheduler bridge ignores the header's `mem_used`** (`lib.rs:1047`, "reserved") and works free memory out from `mem_cap` minus the running requests' tokens, so `admit-count` and `walk-past` build pressure from `mem_cap` and the running views' tokens, never from `mem_used`.
- **Lab 07 has two templates.** `match-cold` (no shared first token) is dropped: every eligible module replies 0, so the story alone answers it. Eviction cannot be reached in 12 calls (the bridge's cache holds 256 entries, `lib.rs:582`).
- **What a template measures.** Credit `unseen` (§7.3, condition 2) means every required check passed, and labs 04 and 07's checks pin the behaviour exactly (FIFO, backpressure at capacity 4, 1,000 wraps and a 3,000-op model gauntlet; exact and longest-prefix matching). An eligible module there can only be correct, so those templates are tracing items about a correct module, except where the checks leave a choice free (lab 04's capacity rounding). Lab 02's `translate` reads a free design choice (FIFO or LIFO free list).
- **Labs without v2.** Lab 03's `count` verb exists, but predicting your tokenizer's count needs its merge table, so lab 03 keeps v1. Labs 01, 05 and 08 answer `probe` only.
- **Answers** are numbers or ordered id lists ("3, 7, 1"), never options.
- **The Opus check (3a-22)** approves, on lab 02, that each template can be answered by reading your own code and never from the story alone, and that a plausible bug changes the answer. Labs 04, 06 and 07 apply the same rule, and the integrator (Opus) checks their templates against it before 3b's level 1 merges. Lab 02's and lab 06's tests prove it with a fake correct module and a fake module with the template's bug; labs 04 and 07's tests prove that a fake correct module answers each template and that the answer is not given by the story (it differs across seeds). The fakes live in that lab's own test file; `tests/forge/fixtures.ts` changes only in 3a-11.

### 7.3 Grading, provenance and timing (`src/lib/forge/prove2.ts`, 3a-11)

- **A question** is drawn when you open the panel: a template (rotating, never-served first) and a seed from `freshSeed()`.
- **Grading.** The answer is right when it equals `read(replies)` exactly. A trap or timeout makes `actual` null and the answer wrong; the panel says the module failed.
- **Provenance `proved`** needs all three:
  1. the answer is right;
  2. the module is the one ForgeLab just graded, with credit `unseen` (every required check passed on fresh seeds, `creditFor`, `forge/run.ts:313–325`; never an `@reference` build);
  3. no credited attempt for this lab is waiting out a 24 h retry.

  Otherwise the event is `practice`. The event is `prove prove:<labId>`, with the module's sha256 as the envelope's `wasmSha256`, the seed, and ProveData v2.
- **Retries.** A wrong credited attempt opens the next credited attempt 24 h later (v1's `RETRY_AFTER_MS`, `prove.ts:23`), with a fresh question. Attempts before then are practice and say so. Nothing is hidden or locked (W8): you can always practise.
- **Weight.** `proved` credits the template's KCs at weight 1.0 (V6; `creditOf`, §12.1).
- **Honour system.** You could run your module and read its reply; the panel says "Close your agent; this is calibration, not a test". This is the plan's framing (PLAN §5.6, risk "the honour system → framed as calibration").

### 7.4 The panel (3b-04; `ProveFromModule`)

- **Where.** Under v1's panel on ForgeLab, for a lab whose bundle has `prove2`, after a run with credit `unseen`.
- **The flow.** "Close your agent: what will *your* module say?" The story is shown, then the input (numeric, or ids separated by commas), then "Run my module", then the verdict in an `aria-live` region. A miss shows your module's actual reply beside your prediction, and when the next credited attempt opens.
- **Keyboard and size.** Fully usable by keyboard at 360 px; the story wraps and never scrolls sideways.

### 7.5 The 30-day return (3b-04; `ProveReturnCard`, `src/lib/forge/prove-return.ts`)

- **When.** One question per lab returns 30 local days after that lab's first `prove` event, v1 or v2, and appears on Today's done card or empty state.
- **What.** If that lab's component is installed (`engine:slots`, its bytes on this device) and the bundle has `prove2`, it is a v2 question on a fresh seed, run against the installed bytes in the lab worker. Otherwise it is v1's follow-up item (`followUpRef`, `item:lab0N.prove.<qid>`, `kv-block-manager/prove.ts:94`) as a self-checked constructed response.
- **Recording.** It records with `data.return: true` (on ProveData v2, or on the v1 follow-up `item`, whose ItemData gains `return` in 3a-01) and never blocks Today. The card is lazy, so /today's static closure does not grow.

---

## 8. Labs 04–08 (tasks 3a-10, 3b-09 … 3b-14)

**Today.**
- Labs 04–08 have no forge bundle.
- Their `labs.ts` checks carry only `id` and `label`: no `stage`, `kcs` or `expectation` (`labs.ts:711–716, 748–753, 785–791, 823–828, 860–865`). So `stageRows` would show empty stages (`forge/primm.ts:26–34`).
- No KC names these labs, and their TODO files have no STAGE markers. Their crates already declare stages and seeds.

### 8.1 Metadata (3a-10)

| Lab | Host | Check (stage) | KCs |
|---|---|---|---|
| 04 mpmc-queue (`queue.rs:50`) | t2.l5 | `fifo` (1), `backpressure` (2), `burst_model` (4) | `t2.mutex-atomics` |
| | | `wraparound` (3), `slot_conservation` (3) | `t2.aba` |
| | | `model_gauntlet` (4) | `t2.mutex-atomics`, `t2.aba` |
| 05 toy-executor (`executor.rs:50`) | t3.l4 | `block_on` (1) | `t3.futures-state-machines` |
| | | `fifo_poll` (2), `ping_pong` (3), `nested_spawn` (3), `many_tasks` (4) | `t3.wakers-executor` |
| | | `pending_repoll` (2) | `t3.futures-state-machines`, `t3.wakers-executor` |
| 06 batching-scheduler (`scheduler.rs:45`) | t5.l7 | `runs_clean` (1), `burst` (2) | `t5.continuous-batching` |
| | | `slo_light` (2), `overload_seeded` (4, optional) | `t5.admission-headroom` |
| | | `convoy` (3), `starvation` (3) | `t5.sched-order` |
| | | `goodput_score` (4) | `t5.batching-throughput` |
| 07 radix-cache (`cache.rs:36`) | t5.l6 | `exact_match` (1), `longest_prefix` (2) | `t5.prefix-cache-keys` |
| | | `eviction_order` (3) | `t5.radix-eviction` |
| | | `cow_divergence` (3), `block_conservation` (4) | `t5.block-refcounts` |
| | | `chat_hit_rate` (4) | `t5.prefix-cache-keys`, `t5.radix-eviction` |
| 08 xgrammar-lite (`grammar.rs:42`) | t6.l8 | all six: `schema_compile` (1), `valid_acceptance` (2), `earliest_rejection` (2), `token_mask` (3), `mask_overhead` (4), `compile_cache` (4) | `t6.grammar-masks` |

- **Stages** are each crate's `list` reply (`mpmc-queue/lib.rs:65–72`, `toy-executor/lib.rs:290–297`, `batching-scheduler/lib.rs:633–641`, `radix-cache/lib.rs:57–64`, `xgrammar-lite/lib.rs:49–56`). A test holds `labs.ts` to the committed calibration lists.
- **Lab tags.** Each tagged KC's `labs` names its lab (`verify-kc.ts:290–305`). The readiness rules must pass: lab 04's R10, lab 07's R5–R7 plus lab 02, lab 08's R5–R6 plus lab 03 (`labs.ts:697–701, 811, 848`). Where they fail, 3a-10 adds `requires` edges in the T KC files it owns.
- **STAGE markers** go in the TODO files as comments, with a header saying which check catches which mistake (the lab 01–03 pattern). Signatures and `lib.rs` do not change (W19). Calibration reruns only for a crate whose `calibration.json` pins an edited file; it reruns from the private solutions (`labs/_solutions/`, never committed). Archives are repacked.

### 8.2 Bundles with faded scaffolds (3b-10 … 3b-14)

Each bundle follows the `ForgeBundle` contract (`forge/types.ts:204–222`), with `fade: 'r2'`:
- **PRIMM:** six items: 2 predict (one estimate, one choice), 3 investigate, 1 modify, around a reference run in the browser. Choice items land in the `primm` pool with a why per option.
- **Ladder:** R0–R2 for every required check. R0 is the teach-back and its three ideas; R1 is the concept, with an H2 anchor in the host lesson; R2 is where to look, a function that exists. After R2 the H2 packet is offered (`AskPacket`), as in the ladder arm. These labs are outside the ladder-or-packet experiment (`RANDOMIZED_LABS`, `experiments.ts:19`, stays labs 01–03).
- **Prove-it v1:** six questions, three drawn. Prove-it v2 as §7.2, for labs 04, 06 and 07.
- **Bottom-out:** none. Walkthroughs are optional per lab (`ForgeBundle.walkthrough`).

| Lab | The reference run (in the browser) | Predict (examples) | Modify |
|---|---|---|---|
| 04 | the Fleet's reference queue (`makeRefQueue`, `fleet-model.ts:1488`) on a seeded burst of 40 pushes and pops: occupancy and `full` replies per step | how many pushes reply `full` at capacity 8 | capacity 8 → 16 |
| 05 | the committed calibration reply of the crate's `probe` at seed 7 (`calibration.json`: tasks, yields, polls), shown as one frame per poll round and labelled "the reference on seed 7" | polls per task in the ping-pong pair | a choice item: what changes if wakers re-queue at the back (no run) |
| 06 | the Fleet `Engine` with `referenceScheduler` on a seeded 60-request trace: goodput, TTFT p95, preemptions | the reference's goodput on a fresh trace | headroom 48 → 0 |
| 07 | `src/lib/world/radix.ts`, a pure JS radix tree with LRU leaf eviction, on a seeded chat trace: hit rate, entries | the hit rate after 48 requests | capacity halved |
| 08 | the committed calibration reply of `probe` at seed 7, one frame per grammar step with the legal tokens at that step | legal tokens at step 3 | a choice item: what an extra enum value does to the mask (no run) |

- **Frames.** Every bundle's reference run has more than one frame (`tests/forge/registry.test.ts:89` asserts it over `loadAllForgeBundles()`), which is why labs 05 and 08 replay their committed reply step by step.
- **In-browser references** follow Wave 2's precedent: lab 02 runs the Fleet's `RefBlockManager`, lab 03 `world/bpe.ts`. The Rust reference solutions stay private.
- **Margins.** Each lab runs `verify:items -- --subset 'forge/<lab dir> '`, which selects its PRIMM items (§4.1). A lab adds about four choice items, below the 12-item minimum, so the run reports its hit rates and the integrator's merged-level `verify:items` decides; lab 01's PRIMM items already sit at the pool's limit, so a lab whose items push the merged `primm` pool over is fixed in that lab's PR before the level merges.
- **Stopwatch.** The implementer records the time to stage 1 in the PR, a field measure of "stage 1 is a 2-minute win", as 2c-09 and 2c-10 were asked to.

### 8.3 Lab 06's race and the bestiary: W1's Code stage (3b-09)

- **The race.**
  - After a run of batching-scheduler with credit `unseen`, `RaceReference` offers "Race the reference".
  - It runs Act I's sim job with only your scheduler (`SimJob act1 {modules}`, `sim-protocol.ts:15–19`) on a graded entropy drawn now (`runSim` with `freshSeed()`, `sim-client.ts:123–131`).
  - It records `fleet-run fleet:engine` with `{components: [{slot: 'scheduler', labId: 'batching-scheduler', sha256}], seeds: 'fresh', goodput, refGoodput}`.
  - Within 3 points (`fold.ts:77–78`), the fold sets `labFleetOk['batching-scheduler']`, and RING 0's lab 06 row turns green (§3.4).
- **The bestiary** (`src/lib/world/bestiary.ts`): twelve named policies from the Compose dials (`SchedPolicySpec`, wave-2 §8.4), run on the race's entropy through `compileSchedPolicy`. A sim-worker job `bestiary` returns their goodputs. The panel shows where yours falls, as an SVG histogram with a `SimMirror` table. The bestiary is labelled "twelve policies from the Compose dials", not "production schedulers".
- **Twelve distinct policies.** On Act I's runs (CFG 256 × 16, 16 running, a 32-entry intake draining 8 per tick) the guard dial's 2000 never fires: guard 2000 and guard 0 gave identical goodput on all 30 graded entropies measured on 2b (as `sched-policy.ts:18` says, "2,000 never fires inside a minute"), and so did the reference's own guard. Under FCFS the guard is a no-op by construction (aged requests are a prefix of arrival order), and preempting the newest never changed an outcome at headroom 48 or 128. Of the 48 dial settings, 19 behave differently. The table keeps twelve of them, each labelled only by effects that occur on these runs; the mean goodput is over those 30 entropies. `tests/world/bestiary.test.ts` holds the twelve goodputs pairwise distinct on ≥ 80 % of banded Act I entropies (86.7 % measured).

  | # | Policy | {order, guard, headroom, preempt} | Mean goodput (%, 30 entropies, 2b) |
  |---|---|---|---|
  | 1 | the reference | {sjf, 2000, 48, none} | 44.6 |
  | 2 | FCFS | {fcfs, 0, 48, none} | 18.8 |
  | 3 | FCFS, greedy | {fcfs, 0, 0, none} | 12.0 |
  | 4 | FCFS, greedy, preempting | {fcfs, 0, 0, newest} | 14.1 |
  | 5 | FCFS, tight headroom | {fcfs, 0, 16, none} | 21.2 |
  | 6 | FCFS, tight headroom, preempting | {fcfs, 0, 16, newest} | 20.1 |
  | 7 | FCFS, wide headroom | {fcfs, 0, 128, none} | 13.9 |
  | 8 | SJF, greedy | {sjf, 0, 0, none} | 41.8 |
  | 9 | SJF, greedy, preempting | {sjf, 0, 0, newest} | 44.8 |
  | 10 | SJF, tight headroom | {sjf, 0, 16, none} | 46.9 |
  | 11 | SJF, wide headroom | {sjf, 0, 128, none} | 37.5 |
  | 12 | SJF, short guard, greedy | {sjf, 20, 0, none} | 13.5 |

- **The real-engine finale.** It already exists: lab 06's scheduler arbitrates a one-slot Qwen3-0.6B in the tab (`real-engine.ts`, `RealEnginePanel.tsx`). The panel links to it.
- **Cut.** The leaderboard's physics floors (D12).

---

## 9. Production twins for labs 07 and 06 (tasks 3a-08 claims, 3b-08 panel, 3b-15 content)

The plan: "Three tracing questions on the upstream counterpart at a pinned SHA (a 60-day version claim): lab 07 ↔ SGLang's Rust TreeCore (PR #39627); to verify, lab 06 ↔ vLLM's scheduler". The evidence: "lab 07 radix-cache is the same data structure SGLang just rewrote in Rust" (serving-landscape.md:116–118). This is flagship moment 5: "You just wrote the structure SGLang made its default".

```ts
// src/data/twins/types.ts
export interface TwinModule {
  labId: string                  // 'radix-cache'
  labNo: string                  // '07' (refs item:lab07.twin.<n>)
  claimId: string                // 'twin.sglang.treecore': status, pin {repo, ref}, ttlDays 60
  path: string                   // the file at that ref
  symbols: string[]              // the functions the questions trace
  youWrote: string               // "You just wrote the structure SGLang made its default on 2026-09-29."
  items: TwinItem[]              // exactly 3
}
export interface TwinItem { id: string; q: QuizQuestion; kcs: KcId[] }   // a why per option; pool `twin`
// each src/data/twins/<lab>.ts exports `default: TwinModule` and `TWIN_ITEMS`
```

- **The panel** (`TwinPanel`, mounted by 3a-06) shows once a lab is done. It shows the file link at the pinned ref, the claim's `verifiedAt` and a "stale since" badge past its 60-day TTL (`staleSince`), the "you just wrote" line, and the three questions played by `ItemCard`. They are recorded as `item:lab<NN>.twin.<n>` with src `practice`. A lab without a twin module renders nothing.
- **The content** (3b-15): questions that trace the upstream code on a small example. Lab 07: which node a `match_prefix` ends at; what an insert splits; what eviction removes first. Lab 06: which waiting request vLLM's scheduler admits next; what it preempts under memory pressure. The lab 06 twin ships only if the pinned file supports three such questions (Q14). The plan says "to verify", and lab 07 alone meets the line. The owner reviews the questions against the pinned files.
- **No `labs.ts` field** (D21): the registry (`src/data/twins/index.ts`) finds twins by readdir, as the forge registry does.

---

## 10. Receipts: Fleet Week validated by re-running (tasks 3a-12, 3b-05)

**Today** (`wave-3a`):
- **Acts I–II** pass on a trace pass plus a write-up check (`gradeMeasurementSubmission`, `fleet-week.ts:446–517`). The write-up needs:
  - ≥ 2 metric keywords and ≥ 1 decision keyword (:454–472);
  - one number with a unit (:473);
  - 40–150 words (:479);
  - a "screenshot", for which only the file's name ending and a byte count above 0 are checked (:476–478). The image is never stored or looked at.
- **Act I's trace pass** needs one of the learner's own components (scheduler, block manager or intake) taking part, with goodput within 3 points of the reference (`act1Verdict`, `fleet-week.ts:265–267`, since 2b-21). An all-reference run fails it (`tests/world/faults.test.ts:117–121`), and no passing module is ever committed (private solutions stay private; `tests/fleet/act1.test.ts:1–8` tests the passing side on the verdict).
- **Act III** passes on a $/Mtok claim within 25 % of the simulation, an SLO check, and a doc of ≥ 60 words with ≥ 3 of 11 vocabulary terms (`gradeAct3Doc`, :614–653).
- **Recording.** Acts are recorded only on a pass, as `practice`, with no seed (`useActRunner`'s `finish`, `FleetWeek.tsx:165–171`). The evidence calls this "keyword stuffing; any image counts as the screenshot" (audit/interactive.md:117).

### 10.1 Values (3a-12)

`ActResult` (`fleet-week.ts:39–54`) keeps its display `metrics` and gains `values: Record<string, number>`:

| Act | Keys |
|---|---|
| I (`engine`) | `goodput`, `refGoodput`, `completed`, `shed`, `preempts`, `ttftP95`, `tpotP95`, `queueP95` |
| II (`fleet`) | `goodput`, `completedPct`, `shed`, `lost`, `ttftP95`, `workers` |
| III (`business`) | for each option o ∈ {h100, b200, gb200}: `costPerMtok.o`, `goodput.o`, `meetsSlo.o` (0 or 1) |

Latencies stay in iterations, as the acts display them. The runs themselves do not change. `tests/world/faults.test.ts` hashes the acts' outputs (`EXISTING_RUNS_SHA256`); it leaves the new `values` field out, and the hash stays.

### 10.2 Run records and receipt tokens (3a-12)

- **`runSim(job, onProgress?, entropy?)`** takes an optional entropy and keeps its `Promise<SimResults[K]>` return, so its three callers in `FleetWeek.tsx` (:224, :287, :414) compile unchanged; today it draws `freshSeed()` itself (`sim-client.ts:123–131`). A new export, **`runSimWithEntropy(job, onProgress?, entropy?)`**, resolves `{result, entropy}` with the entropy it used, and 3b-05 adopts it. Every job already draws its graded seeds from the request's entropy (`sim.worker.ts:19`), so a record holding the entropy can be re-run.
- **`runRecord(act, job, entropy, values, at)`** replaces module bytes with `{slot, sha256}`. Its caller (`FleetWeek.tsx`) passes `at`, the ISO instant: `src/lib/fleet-receipts.ts` is inside verify-determinism's `src/lib/fleet-*.ts` scope (`verify-determinism.ts:158`), which bans `Date.now`, `new Date(`, `performance.now` and `crypto.getRandomValues`. Its id is the first 8 hex digits of `sha256(stableStringify(record without id and at))` (`ledger/stable.ts:9, 69`). Records go to `fw:runs`, newest last, at most 50.
- **A receipt token** in an analysis is `[[r:7f3a9c21 goodput=41.2]]`. Each metric row of a run offers "cite", which inserts a token. The editor shows tokens as chips; the text stays plain.

### 10.3 Verification (3a-12, 3b-05)

- **"Check my receipts"** re-runs each distinct cited record once. The job is the same, the entropy is the same, and the module bytes come from the components store by sha256 (`componentBytes`).
- **A cited value is verified** when it equals the re-run value rounded to the decimals written, at most 2 (D14). A record whose module is not on this device cannot be verified here and says so; it does not count.
- **Uncited figures.** `uncitedFigures(text)` flags every number with a %, ms, s, iters, tok/s, req/s or $ unit outside a token. The act lists them: "cite it or cut it".
- **Determinism.** The engine is deterministic and inside the determinism lint (`src/lib/fleet-*.ts`), so a re-run in another browser gives the same values (S3: "the same hash in 3 browsers").

### 10.4 Grading and the rubric (3b-05)

| Act | Passes when | Score |
|---|---|---|
| I, II | the trace passes as today (for Act I, your own component within 3 points of the reference), ≥ 2 receipts verify, and no uncited figure remains | 0.6 × the trace score + 0.4 when the receipts verify |
| III | the executed SLO check passes, and the claimed $/Mtok is a verified receipt from an Act III run | 0.55 for the verified cost + 0.45 for the SLO |

- **Retired.** The keyword lists, the word counts, the 25 % band and the screenshot are gone, and the file input is removed. `fw:evidence:<act>` keeps the analysis text only.
- **The rubric** is self-review, never scored. It has four criteria from the plan (capacity math, SLO reasoning, cost sensitivity, failure modes), each with levels 0–3 and one-line descriptors. For each act, three exemplars (`src/data/fleetweek/exemplars.ts`) are written from real runs, carry receipts and are scored on all four criteria with a why. You read them, then score your own analysis. The four scores go into the act's `data.rubric`. The evidence supports this form: "self-assessment against a rubric of 3 required ideas plus model answers" (computing-education.md:199), and "rubric grading is formative, and only the existing executed checks … gate XP" (ai-tutoring.md:278).
- **Recording.** The act is recorded with its seed and provenance `unseen` (the entropy was drawn at run time) and `FleetActData {receipts, rubric, runs}`. Act IV (2b-17) is unchanged.
- **Testing a pass.** A receipt check compares values and needs no pass, so the browser walk (`e2e/receipts.spec.ts`) cites and verifies receipts on an Act I run with no passing module (the all-reference practice run, or a hand-assembled losing module) and passes Act III, which needs no module. "Acts I–II pass with the trace pass and ≥ 2 verified receipts" is proved in unit tests that feed the grading a fixture passing trace result (`tests/fleet/receipts-act.test.ts`, 3b-05; `tests/fleet/receipts-exit.test.ts`, 3c-01).

---

## 11. P3: active isomorphisms (tasks 3b-07, 3b-16, 3b-17, 3c-05)

**Today.**
- 18 isomorphism blocks hold 52 pairs. The 29 pairs in T0–T2 have a `breaks` line (Wave 0b's erratum #12 work); the 23 pairs in T3–T7 have none.
- `IsomorphismView` is passive: an OS card ≡ an LLM card, then "where it breaks:" (`blocks.tsx:117–148`). The exporter drops the breaks (`export-lessons-md.ts:58–61`).
- Nothing aligns, nothing is graded, and no work analogue exists (the type has no `work` field, `types.ts:226–240`).
- The evidence: active alignment, with the principle given *after* the comparison, is where Alfieri's d = .50 comes from, and "passive side-by-side display is much weaker" (learning-science.md:139–145).

### 11.1 The interaction (3b-07; `src/components/lesson/Isomorphism.tsx`, `src/lib/learner/iso.ts`)

A block with `breakItem` runs three steps; a block without one renders as today.
1. **Align.** One row per pair's `os` element; the pairs' `llm` labels, shuffled per attempt, are buttons on each row. You give every row a label, by keyboard (Tab to a row, arrows across labels, Space to choose) or by tap; nothing needs a drag. Each row's feedback is the pair's own two lines. Recorded as `item:<lesson>.iso.<n>` (n from 1), `score` = base rows right ÷ base rows, `ok` = all base rows right. A work row (§11.3) gets its feedback but is never graded, so the score, which a donation keeps, never reveals the background. This step is matching, not a multiple-choice item: the options are the pairs themselves.
2. **Name the break.** The `breakItem`: "Where does this analogy break?" One option is a true break from the pairs; three are statements that hold on both sides; each has a why. Recorded as `item:<lesson>.iso.<n>.break`. Pool `iso`, gated (§4.1).
3. **The principle** (≤ 40 words), then all pairs with their breaks, as today's view.

**Details:**
- **KCs:** the block's `kcs`, or the lesson's. Items carry src `lesson`.
- **Retries** re-shuffle; nothing locks. Reduced motion is respected; the verdicts are `aria-live`.
- **The work line** of a pair shows only when `profile:background` is one of its backgrounds (§11.3).

### 11.2 Content (3b-16, 3b-17)

| Task | Panels (lesson: pairs) | Adds |
|---|---|---|
| 3b-16 | t0.l1: 3, t0.l5: 3, t1.l2: 2, t1.l3: 3, t1.l6: 2, t2.l1: 2, t2.l2: 3, t2.l3: 3, t2.l4: 4, t2.l7: 4 | a principle, `kcs` and a break item on each panel (the breaks exist) |
| 3b-17 | t3.l6: 3, t5.l6: 3, t5.l9: 2, t6.l1: 3, t6.l3: 3, t6.l9: 3, t6.l10: 3, t7.l5: 3 | a `breaks` line on each of the 23 pairs, plus a principle, `kcs` and a break item on each panel |

- **Unchanged:** existing pairs, titles and hooks.
- **Margins.** Each task runs `verify:items -- --subset` with a regex over its iso refs (`'/^item:t[0-2]\.l[0-9]+\.iso\./'` for 3b-16, `t[3-7]` for 3b-17); n is printed, and the merged-level run decides (§4.1).
- **The discrimination** P3's metric measures (paging, PagedAttention, the radix cache) is taught in t2.l2, t2.l7, t5.l5 and t5.l6, and read from three KCs (§4.3, §15.1). Its confusion share needs lures that name the confusion: on these lessons' quiz items for the three KCs, a lure whose misconception is taking one KC for another of the three carries the miss id `confuse.<that KC>` (3b-16 on t2.l2 and t2.l7; 3b-17 on t5.l5 and t5.l6; retagged where such a lure exists, added otherwise). 3c-03's test requires ≥ 2 such lures per KC.

### 11.3 Work analogues by background (3c-05; cut 3rd)

- **The pick.** An optional "What do you work on?" pick in Boot's last step (`You.tsx`) and on /me writes `profile:background` (§3.5). Its values are `jvm` (Java or Kotlin services), `backend` (Python, Go or Node services), `sre`, `ml`, `student` and `other`. It is local, broadcast to other tabs, never donated, and skippable. Today Boot keeps only the free-text value prompt (`You.tsx:88`) and a work-in-software radio (:120) that is not stored.
- **The pairs.** Four work pairs from the plan, each with its own break:

| Work pair | Panel | Backgrounds | Its break |
|---|---|---|---|
| connection pool ↔ KV block pool | t2.l7 | `backend`, `jvm` | a connection returns to the pool whole; KV blocks are freed per sequence and shared by refcount |
| G1 regions ↔ fixed KV blocks | t1.l3 | `jvm` | G1 evacuates live objects to compact; KV blocks never move |
| backpressure ↔ admission control | t2.l4 | `sre`, `backend` | backpressure slows the producer; admission control leaves the request waiting while decode runs on |
| CDN TTL ↔ KV TTL | t5.l6 | `sre`, `backend` | a CDN entry can go stale (the origin changed under it); a KV prefix keyed by its tokens, model and adapter revision can never be wrong, so TTL or space eviction only costs a re-prefill |

- **What changes.** The `work` field sits on the pair whose LLM side it shares (`IsomorphismPair.work`, §2.3). A matching background adds one align row: the work concept, whose right label is that pair's LLM label. That row gets its feedback but is never graded (§11.1): a score of k/4 for a `jvm` learner beside k/3 for everyone else would let a donation reveal the background. Its break shows with the others. Nothing else changes. 3c-05's test proves two ledgers that differ only in `profile:background`, with the same answers on the base rows, give identical donations.
- **Budget.** /boot grows by ≤ 1 KB gzip (gate 200, target 165).

---

## 12. K5: the Mirror at `/me` (tasks 3a-17, 3b-06, 3b-06b, 3b-19)

**Today.**
- /progress shows first-review calibration only (`ReviewPanel.tsx:63–80`). The Brier score and reliability (`selectCalibration`, `calibration.ts:92–140`) and the learned optimism offset (`learnOffset`, `cards.ts:172–182`) are computed and never shown.
- No code computes VRK₃₀. The nearest selector, `selectRetention30` (`outcomes.ts:600–658`), pools answers for partners; it does not count a learner's KCs.
- Cold checks are Today's `probe` slots (src `today`, reason `probe`, `sinceDays`; `composer.ts:25–27`, `today.ts:233, 246`).
- The KC type already has a `can` line, "You can …" (`kc/types.ts:38`).

### 12.1 Provenance weights (`src/lib/learner/provenance.ts`, 3a-17)

`creditOf(provenance)`: `proved` and `unseen` 1.0; `lab-green`, `practice` and `assisted` 0.3; `field` and anything unknown 0. It is applied at read time and never stored (ledger-v3 §4.4). It feeds VRK₃₀ and competence. Rings keep their binary rules.

### 12.2 VRK₃₀ (`src/lib/learner/vrk.ts`, 3a-17; Opus first)

PLAN §1: "A KC counts when the learner answers fresh generated items on it correctly, unassisted, ≥30 days after first learning it, on unseen seeds wherever a generator exists."

- **First learning** of a KC is the day its card was created (cards are created by a passed quiz, Boot or placement, `cards.ts:374–382`).
- **A check** is a graded `item`, `probe` or `prove` event on the KC with credit 1.0 (`unseen` or `proved`). It is unassisted, not a form item, and on a day ≥ 30 local days after first learning.
- **A KC is retained** when its latest check is right; it is **checked** when it has a check.
- **Rate.** Active study-months are calendar months (local) with ≥ 4 days of graded work. VRK₃₀ per active study-month is the retained count ÷ those months.
- **Output.** `selectVrk30(events, content, now)` returns `{retained: KcId[], checked: KcId[], share: Proportion (Wilson 95 %), perActiveMonth, activeMonths}`. It is pure, with `now` a parameter.
- **Coverage.** Authored items are `practice`, so KCs that no generator covers count only through `proved`. /me says so beside the number.
- **The Opus check** approves the definition on fixture ledgers (an assisted miss, a practice-only KC, a card created late) before 3b-06b builds the Mirror.

### 12.3 Cold checks and calibration (3a-17)

- **`selectColdCheckSummary`** gives n, accuracy and Wilson 95 % intervals for Today's cold checks at ≥ 7 and ≥ 30 days, overall and by track.
- **Calibration** is shown as computed: Brier, reliability, sure-and-wrong; the optimism offset with its n, and "0.02 (default) until 20 first reviews" (`OFFSET_MIN_N`, `cards.ts:47`).

### 12.4 Competence statements (`src/lib/learner/competence.ts`, 3a-17)

- **The rule.** A KC's `can` line is shown when it has ≥ 6 credited fresh items over ≥ 2 local days, with ≥ 5 of the last 6 right. "Credited" is weight 1.0. "Fresh" means a generated item on an unseen seed, or a `proved` prove event.
- **The copy** is informational, never a badge: "You can size KV for an MLA model: 6 of your last 6, on new numbers each time." The evidence: informational competence signals, d = +0.33 (learning-science.md:248–250).

### 12.5 The page (3b-06 the fold, 3b-06b the Mirror)

- **Order:**
  1. **VRK₃₀:** the count, the share retained with its interval, and per active month;
  2. **cold checks** by track with intervals;
  3. **calibration** and the optimism offset;
  4. **competence statements;**
  5. **forms** (`FormsCard`, lazy; §12.6);
  6. then, moved from Progress: rings with their checklists, your engine (`EngineCard`), Up Next, data (export, import, reset, donate) and the history heatmap.
- **Small n.** Every figure states its n and shows "not enough data (n = …)" below its minimum: 20 for calibration (`CALIBRATION_MIN_N`), 10 for a track's cold checks, 5 checked KCs for VRK₃₀'s share.
- **Two tasks.** 3b-06 is the fold: Progress's sections move into lazy /me sections (`src/pages/me/Journey.tsx`, `src/pages/me/DataOwnership.tsx`), /me is routed with plain `lazy`, and the budget becomes a gate. It needs only 3a-02 and is judged on the budget. 3b-06b is the Mirror (items 1–5 above), built on 3a-17's selectors after the fold, and judged on behaviour.
- **Budget** (D20; 3b-06). `Progress.tsx` is deleted. No /me module imports `src/data/lessons`; Progress's one use, a count of lesson tasks (`Progress.tsx:93`), is computed from the sim registry or dropped. framer-motion loads only in lazy sections: `App.tsx` routes /me with plain `lazy`, never `lazyMotion` (which loads `src/lib/motion.tsx`, and so framer-motion, beside the page, where verify-bundle does not look; §2.2), and each lazy section that uses framer-motion renders inside `MotionScope` or loads through a section-level `lazyMotion`. The /me line becomes a gate at 200 KB (`verify-bundle`).
- **Tests.** `tests/me/motion.test.ts` (3b-06) mounts a lazy /me section with `tests/dom/mini-dom.ts` and shows it honours reduced motion; B26's list in `tests/shell/nav.test.ts` gives way to a check that /me is plain `lazy` and its motion sections are scoped. `tests/me/mirror.test.ts` (3b-06b) checks every figure's n and interval on fixture ledgers. `e2e/me.spec.ts` (3b-06b) reaches every control by Tab at 360 px.

### 12.6 Track forms A/B/C (3b-19; cut 4th)

- **The forms.** `formsFor(track)` builds 12 slots over ≥ 3 KCs from the families that cover the track's KCs, at level 2, or returns null.
- **Drawing.** `formsFor` runs its draws inside `settle()` (`src/lib/items/on-demand.ts`) when the card opens, as Today's start flow does (`Today.tsx`, `useStartSet`): R's `compile` family throws `NotReady` until the bank group an item needs has loaded, and outside `collect`/`settle` a caller reads that as "no item", so a form would lose items or change with load timing in the browser. Bun loads every group up front, so a test sees this only when it withholds a group. Each slot is drawn on its KC with `drawOnKc(kc, seed, (s) => gen.make(s, 2, variant))` (`src/lib/learner/on-kc.ts:35`, as Today and tickets draw), so every slot carries its KC and the ≥ 3-KC rule and `selectFormsGain`'s per-KC grouping read the right items. `tests/learner/forms.test.ts` withholds one compile group, runs `formsFor` under `settle` with the group loaded on demand, gets the fully loaded result, and shows every slot's instance carries its KC. Forms exist for R (`compile`), T1 (`frag`), T4 (`roofline`, `memory`, `tiling`), T5 (`kv`, `spec`, `sig`), T6 (`memory`, `cost`, `spec`, `prefill`, `rollout`) and T7 (`goodput`, `cost`, `sig`). T0, T2 and T3 have too little generator coverage and show no forms.
- **Seeds.** Three disjoint seed sets per track come from the learner's `exp:seed` (`hash32('forms:' + track + ':' + set + ':' + i + ':' + expSeed)`), so the seeds are unseen and differ between learners.
- **Counterbalancing.** Which set is form A, B or C is one of the 6 permutations, chosen by `armOf('forms', track, expSeed, 6)`. `armFor` (`experiments.ts:37–39`) generalizes to n arms; the hint-ladder arms are unchanged (test).
- **Timing** (opt-in, never gating; the card on /me offers each form while it is open):
  - A is offered before your first lesson of the track is done;
  - B after the track's spiral is passed;
  - C ≥ 30 days after B.
- **Recording.** Items record src `form` with `{formId, track, formSlot, formSet}` (§3.2; never `data.form` or `data.slot`, which mean the ticket form and the Today position). They pay XP like items but never reschedule a card (W18).
- **The card** shows k/12 per form with Wilson intervals, B − A labelled "including the pretest effect", and C beside B. Each step is about 8 points (100 ÷ 12), so only track-level results are shown, with intervals (the plan's risk line). The plan's opt-in metric, C/B ≥ 0.8 with a CI, is a partner selector (§15.1).

---

## 13. Remaining P2: one registry, no credit without a prediction (tasks 3a-05b, 3a-18 … 3a-21)

**Today** (`wave-3a`):
- **The registry** holds 86 tasks: 21 outcome tasks (the zoo's six from 2b among them) and 65 legacy ones. 36 more task ids live in inline arrays the registry never sees: `MemoryGridSim.tsx:51–56, 58–79`, `VmPagingSim.tsx:1018–1028`, `QuantizerSim.tsx:340–345`, `WgslSim.tsx:652–657`, `BatchingSim.tsx:621–626`, `ToyEngineSim.tsx:42–48`. RooflineSim repeats its 12 legacy ids at :1165–1176.
- **Wave 1 left these legacy "until Wave 3's remaining P2"** (wave-1.md:983): the twelve roofline tasks and `t-double-free`. The twelve are `t-cpu-serial`, `t-gpu-map`, `t-gpu-divergence`, `t-roof-occupancy`, `t-roof-coalesce`, `t-roof-bank`, `t-roof-tiers`, `t-roof-pcie` and the four `t-roof-fleet-*` worksheet rows (`roofline.tasks.ts:188–201`).
- **Five superseded allocator ids** (`t-frag`, `t-coalesce`, `t-paged`, `t-quiz`, `t-trace-lab`) are still registered, detected and listed (`AllocatorSim.tsx:75, 196, 344, 369, 387, 390, 509`).
- **Exercise blocks.** Five lesson exercise blocks list legacy ids: t4.l1, t4.l2, t4.l3, t4.l4 and t5.l5's four `t-blk-*` tasks. Their "what just happened" note unlocks on a toggle.

**Wave 3:**
- **Roofline (3a-18).** The twelve roofline ids become outcome tasks: a numeric predict spec, an observe key the sim emits, a three-idea explain, and a phone canonical where the model exists. Each names its old id in `legacyId`. RooflineSim's SMEM curve reads the cube's `smemBytes` and `ctasPerSm` (D24), so the sim, the cube and the family share one model.
- **Allocator and block tables (3a-19).** `t-double-free` and the four `t-blk-*` tasks become outcome tasks. The five superseded allocator ids leave the registry, the detection calls and the checklist; old completions still show "you finished the old click-through".
- **One registry (3a-20, 3a-21).** The 36 inline ids move into tasks files as legacy entries, with `HOME` exports (§4.2). Each HOME names the machine its list renders on (sim-memory's `grid` and `latency`, sim-vm's `paging`, sim-batching's `batching`); ToyEngineSim's list stays machine-less, like `engineExt`. So no other machine's list grows and `tests/sims/registry.test.ts:95` holds unchanged. The components import them and render exactly as before.
- **The result.** 38 outcome and 79 legacy tasks, all in one registry (117, against the plan's "114 tasks", whose count mixed two lists; audit/content.md:40 and audit/interactive.md:23). Every `taskIds` entry of a lesson exercise block resolves to an outcome task. Link-card blocks (no `taskIds`; 18 of the 28 lesson files with an exercise block on 2c, `exercise.tsx:5`) are exempt: they earn nothing and stay link cards, deferred with the legacy tasks (D17).
- **Legacy tasks are exploration steps.** They earn 0 XP (as today), resolve to no KC (so they feed no card, ring or VRK₃₀), and unlock no lesson note. 3c-01's test proves all three, and that no sim component keeps an inline task array.
- **Not in Wave 3.** Converting the remaining 79 legacy tasks into outcome tasks is not a 4-hour line (D17). They stay visible and uncredited.

---

## 14. S4: the watcher decision (task 3c-04)

**Today.**
- The backtest harness exists (2a-20, `scripts/landscape/*`). It holds a frozen snapshot of 20 repos with 181 releases and 9,960 distinct lines over 2026-08-01 → 09-30, and 617 flagged candidates, 71 a week.
- `docs/prereg/watcher.md` sets the keep bar, mirrored by `KEEP_BAR` (`score.ts:27–34`): recall ≥ 0.80, precision ≥ 0.25, ≤ 90 flags a week, both known deprecations caught, ≥ 20 lines rated true.
- It is **unsigned** (`watcher.md:58`, "Signed: (pending owner)"), and no `ratings.json` or `report.json` exists on any branch.
- The flags-per-week bar already passes (71). Both deprecations are flagged, so they count once the rater marks them true. Recall, precision and the true-line count are open.

**The decision rule** (no partial keep, and no threshold relaxed after the numbers are known; `watcher.md:52`):
1. **Unsigned at 3c's start** (`isSigned`, `score.ts:244–246`): outcome "not decided". The manual scan stays (PLAN §9's default), 3c-04 ships no code, and the 10 hours return to the queue.
2. **Signed, but no independent rating:** the same. The rater is the owner, or a fresh agent given only `snapshot.json` and `match.ts --lessons`, who never reads `candidates.json` (`watcher.md:27–31`). Only the owner or the orchestrator may launch that agent; 3c-04's implementer, who reads `candidates.json` and `match.ts`, never does.
3. **Signed and rated:** `bun scripts/landscape/score.ts` writes `report.json` with `keep`, `drop` or `underpowered`.
   - `keep`: build the digest (below).
   - `drop`: the manual scan stays.
   - `underpowered`: the manual scan stays, and the backtest is repeated on a second 8-week window before the Wave 3 decision, as `watcher.md:50` says. Moving that repeat to Wave 4 would need a dated amendment the owner signs before any rating exists.

**The digest, only on `keep`:**
- **The script.** `scripts/landscape/digest.ts` fetches releases since the last digest (`fetch.ts`) and matches them with the frozen `match.ts`, untouched (`watcher.md:23`).
- **The issue.** It writes one "Landscape digest YYYY-WW" issue body: candidate lessons and claims per release-note line, plus the claims expiring within 14 days (PLAN §6.3's weekly line).
- **The workflow.** `.github/workflows/landscape-watch.yml` runs it weekly with `GITHUB_TOKEN` only, opens or updates that issue, and never commits.
- **Triage.** `TRIAGE.md` is the local triage prompt: LLM triage runs locally (OD2) and nothing auto-merges.
- **Left out:** arXiv feeds (never backtested) and link-rot checks.
- **Field step.** Signing and rating are the owner's (Q12). Agents cannot satisfy them.

---

## 15. Partners and measurement (task 3c-03)

No telemetry: partners donate redacted exports privately and the owner runs `scripts/partner-report.ts` (wave-2 §20).

### 15.1 Selectors (`src/lib/learner/outcomes.ts`)

| Selector | Measures | Definition |
|---|---|---|
| `selectVrk30Spread` | VRK₃₀ across partners | `selectVrk30` per learner: median, spread and n |
| `selectProveV2` | H4's keep-or-kill ("≥ 60 % of greens attempted") and `proved` | the share of unseen-seed greens on labs with `prove2` followed by a v2 attempt, and the share of those attempts proved |
| `selectHintArms` | H3's keep-or-kill, decided at the Wave 3 exit | per `docs/prereg/hint-ladders.md`: first cold-check accuracy on a check's KCs 25–45 days after its first green, by arm; the learner-level ladder − packet difference with a one-sided 97.5 % bootstrap bound (10,000 resamples) against the 5-point margin |
| `selectDailyVsOther` | the Fleet Daily's keep-or-kill (Wave 3 exit) | 30-day accuracy on unseen-seed `sig` items for Daily KCs vs other KCs (PLAN §9), read only after the owner signs `docs/prereg/fleet-daily.md` (3c-03 drafts it) |
| `selectDiscrimination30` | P3's metric | 30-day accuracy on items of `t2.address-translation`, `t5.block-tables` and `t5.prefix-cache-keys` answered ≥ 30 days after the KC's card was created, with the confusion share: misses whose `miss` id is `confuse.<one of the other two KCs>` (§11.2's lure convention), over all misses. "Not enough data", never 0, when the content holds no such lure or the misses are below the minimum |
| `selectCubeError30` | W7's metric | median \|log₁₀(answer ÷ truth)\| on `tiling` and `roofline/tile-ai` items ≥ 30 days after a learner's cube play |
| `selectFormsGain` | K5's opt-in metric (C/B ≥ 0.8 with a CI) | per track (from the kept `kcs`: a KC id's track prefix), keyed by `formId`: B − A and C ÷ B, with bootstrap intervals over learners |
| `selectReceiptStats` | receipts | receipts cited and verified per act, uncited figures, the rubric self-scores' distribution |
| `selectSurfaceMinutes` | the journey re-cut (D22) | active minutes per surface per week (Today, lessons, plays, labs, Daily, Fleet Week, /me), from event `ms` and C19's span rule |
| `selectPlacementLanding` | Wave 2's F3 | unchanged: it already takes the first event on any lesson ref after the placement (25e4b8a, `outcomes.ts:725–748`); its tests stay green |

### 15.2 The donation (`src/lib/learner/redact.ts`)

- **Kept**, added to the whitelist (`DATA_KEYS`, `redact.ts:43–64`; `form` and `slot` are there already and keep their meaning):
  - `sinceDays`, which Wave 2 dropped, so cold checks and ROOT's count read 0 on donations (`redact.test.ts:98`);
  - `formId`, `formSet` and `formSlot` (§3.2);
  - each level's `id`, `ok` and `view` from `levels`;
  - `metric`'s `name`, `mine` and `ghost`;
  - `qid`, `return` and `calls`;
  - `receipts` ({cited, verified, uncited}, non-negative integers) and `rubric` (four integers 0–3) of a fleet act, which `selectReceiptStats` reads;
  - `miss`, only when it is a `confuse.<kcId>` id (§11.2), which `selectDiscrimination30` reads; every other miss id stays dropped, so the `'kv.priced-fp16'` assertion of `redact.test.ts:92` stands;
  - `value` and `truth` of numeric items (`ItemData`, `types.ts:194–237`), numbers only, which W7's metric needs, and only on events whose provenance is not `field`: your own GPU or device measurements (§16.5, §16.10) never leave the device.
- **Still dropped:** seeds, hashes (`wasmSha256` included), free text, Prove-it v2's `answer` and `actual`, `profile:background`, `fw:runs`, a field item's `value` and `truth`, and calendar dates. Tests prove it.

### 15.3 The report (`scripts/partner-report.ts`)

- **The table.** It prints §18.2's field gates F1–F12, each with its n, its interval (Wilson or bootstrap) and the number of partners. Below a gate's minimum it prints "not enough data (n = …)", never a pass. The gate list lives in `outcomes.ts` (`FieldGate`, :965–975); adding a gate means a selector, a widened id union, a `FieldReport` field and a row.
- **The journey re-cut** (D22): the report prints minutes per surface per week next to PLAN §4.D's planned cadence, which the owner re-cuts.

---

## 16. Stretch (PR 3s)

Stretch tasks start in the plan's order, while the review queue is under 10 h (PLAN §8). What does not start rolls into Wave 4.

### 16.1 The 3D cube and its evaluation (3s-01, 3s-02; 8 h)

**D66 (the owner, 2026-10-15):** the view ships as a plain opt-in on every level, with no study. The evaluation below is built and stays dormant behind `CUBE_VIEW_STUDY` until `docs/prereg/tiling-cube-3d.md` is signed.

- **The view (3s-01) ships dark.**
  - `View3D` renders only for ids in `GATE_3D` (verify-plays already checks the ids, `verify-plays.ts:106–121`), and only when its `available` prop is true. Nothing sets it until 3s-02 wires the counterbalanced arm, so no learner sees "Show it in 3D" before the evaluation exists (D9, Q7); a test proves the entry is absent by default.
  - Once available, it shows the 2D view first and opens the scene on request ("Show it in 3D").
  - `Cube3D` builds on the three 0.185.1 and R3F 9.6.1 already in `package.json` (D9). It uses `InstancedMesh`, `frameloop="demand"`, DPR ≤ 1.5, no drei and ≤ 100 draw calls, and falls back to 2D without WebGL2 (games-3d.md:250–255).
- **Budgets.** `verify-bundle` reports the three + R3F chunk against 240 KB (ParticleField's is 242.4 KB today) and fails the scene's own chunk above 40 KB. A static-import walk proves /today, /boot, /me and /play/tiling-cube never load three (the `tests/boot/imports.test.ts:16` pattern).
- **The evaluation (3s-02).**
  - Within-learner, as PLAN §9 asks ("cube levels × view, fully counterbalanced"): each learner's six levels split 3 + 3 between "2D only" and "3D available" by `armOf('cube-view', level, expSeed, 2)`. The play records each level's view (`PlayLevel.view`, §3.2).
  - The 2-item spatial proxy is opt-in and has no choice items: a cube count (numeric) and a view ordering (an ordered id list), so no pool applies. It records `item:cube.spatial.<n>` with src `practice` and no KC, and stratifies the analysis (Höffler 2010, games-3d.md:407).
  - `selectCubeByView` compares 30-day fresh-item error by view. `docs/prereg/tiling-cube-3d.md` sets the non-inferiority margin, and the default: 3D stays opt-in. The owner signs it before 3s-02 merges, so no view data exists before the margin is registered (PLAN §9).
  - 3s-01 and 3s-02 are cut or kept together (§19.3).
  - 3D as default is a Wave 4 gate (2027-12).

### 16.2 t6.l12: attention–FFN disaggregation (3s-03; 6 h)

- **The lesson.** It sits between t6.l9 and t6.l10, so the spiral stays last. It has one new KC; a statline of pinned benchmark claims (Step-3: "up to 4,039 tok/s/GPU decode at a 50 ms TPOT SLA on Hopper"; MegaScale-Infer: "up to 1.90× per-GPU throughput"; serving-landscape.md:30–31); and the boundary that "per-layer, per-token activation exchange needs very low-latency fabric" (:126–129).
- **Its blocks.** An isomorphism with breaks and a break item (databases' compute/storage separation), a 4-item quiz with whys, a ticket, and a `prefill/pd-ratio` item block.
- **Counts.** The 68-lesson pins become 69: `verify-items.test.ts:186`, `scope.test.ts:29`, `packet.test.ts:87`, `recommend.test.ts:191`, and the ticket XP pin `xp.test.ts:308` (`68 * 3 + 6 * 5` becomes `69 * 3 + 6 * 5`, or is derived from the lesson count). The T3–T7 pins (`graph.test.ts:105`, `scope.test.ts:33`) become 40, and TICKETED (`scope.test.ts:31`) becomes 59. PREDICTED (`scope.test.ts:34`) counts T0, T1, T4 and T5 only, so it stays 29. T6's lesson count in `src/lib/tracks.ts` (10) becomes 11, since TrackCard marks a track done at `done >= track.lessons` (`TrackCard.tsx:19–20`).
- **KCs it may name.** Every T3–T7 lesson needs ≥ 2 KCs introduced there or earlier (`graph.test.ts:102–110`), so t6.l12 names the new KC and an existing T6 KC whose `lessons` list gains t6.l12. 3s-03 owns `tests/kc/graph.test.ts` for the count.

### 16.3 More W5 exercises (3s-04, 3s-05; 12 h)

| Exercise | Lesson | What you predict |
|---|---|---|
| `broken-bench` | t7.l2 | a Fleet run is seeded with one of four benchmark flaws (warm-up counted, closed-loop clients, a warm prefix cache, outputs capped); you predict the p95 TTFT the benchmark should have reported, graded against the corrected run |
| `push-luck` | t6.l6 | a seeded acceptance rate α and draft-to-target cost ratio c; the draft length γ (among the sweep's points) that maximises the speedup (1 − α^(γ+1)) ÷ ((1 − α)(γc + 1)). Without a draft cost the expected tokens per step, (1 − α^(γ+1)) ÷ (1 − α), only rises with γ, so the question needs c |
| `straggler` | t6.l7 | the idle share of a synchronous rollout group with long-tail outputs |
| `timing-oracle` | t6.l10 | the TTFT gap a probe sees through a shared prefix cache, and the hit rate lost when the cache key carries the tenant |

All four are numeric, banded and deterministic, and register in `FLEET_EXERCISES` as one module each; the exercise job calls their `sweep(seed)` (§5.3), so no worker, host or session file changes. The Fleet engine models no speculation and no RL group (D7), so `push-luck` and `straggler` are model-only: their `sweep` computes the stated model (powers as repeated products) and puts its values in each point's `metrics`. `broken-bench` and `timing-oracle` run on the Fleet engine only for flaws it can express (warm-up, closed-loop clients, capped outputs; prefix-cache hits only if the engine models them); otherwise the flaw is left out, or the exercise is model-only and labelled so.

### 16.4 Interview mode (3s-06; 8 h)

- **Untimed**, at `/drills`. It has three parts:
  1. a napkin round of three generated items;
  2. a seeded incident in the drill namespace (practice);
  3. a T7 capacity design that chains `goodput/replicas` and `cost/per-mtok`.
- **The interviewer.** An H2 packet (≤ 6,000 characters, fenced) makes your own agent a skeptical interviewer. Its three objections are chosen by code from an authored list, never by the model (ai-tutoring.md:105–107, 273–278).
- **Nothing gates.** No free text is recorded and nothing pays XP.
- **Budget.** `/drills` is reported at 200 KB.

### 16.5 Two field labs (3s-07; 8 h)

- **The labs.** One after t5.l4 measures batch-1 decode and the KV-full concurrency against your Boot prediction. One after t5.l7 replays the pinned BurstGPT slice with vLLM's benchmark CLI.
- **On your GPU.** Each runs on your own or a rented GPU, ≤ 1.5 GPU-hours (≈ $5 at the $3.39/h H100 median, a claim). Its commands are pinned claims.
- **Recording.** Your entered measurements record `item:field.<lab>.<metric>` with src `practice` and provenance `field` (weight 0; §3.2). Nothing leaves the device: a donation drops a field item's `value` and `truth` (§15.2).
- **Owner step.** The owner signs off the pinned commands, and the owner or a partner runs each one once on a GPU, with its output recorded in 3s-07's PR. Agents cannot run them.

### 16.6 The On-Call pilot (3s-08; 6 h)

- **The shift mode.** `/daily?shift=3` chains three drill-namespace incidents from one seed, with a handoff note between them that is never stored, and records each as practice.
- **The protocol.** `docs/oncall/pilot.md` is a think-aloud protocol: consent, script, and what the owner writes down.
- **What it is for.** It produces the evidence of the Wave 4 gate ("Daily KCs' 30-day diagnosis ≥ non-Daily, or favourable think-alouds"); it is not the On-Call shift (D23). The session notes stay private to the owner; only a de-identified summary feeds that gate.

### 16.7 Season 0 (3s-09; 4 h)

- **Seven dated Daily seeds:** the Dailies of seven consecutive dates, starting the Monday after 3s-09 merges. **D68:** Monday 2026-11-02 to Sunday 2026-11-08, Dailies #21 to #27.
- **What shows.** The Daily's header says "Season 0 · day k of 7", and a card on /me lists your own results and share strings from the ledger.
- **Nothing to moderate:** no board, no fetch. Seasons stay gated (PLAN §10).

### 16.8 The bring-your-own-service capstone (3s-10; 8 h)

At `/capstone/service`, on the device:
- **Inputs.** Your trace goes through `parseTraceArtifact` (kind `local-derived`, `traces.ts:118`) or a CSV converted locally. Your model config goes through the zoo reader, and the hardware is an atlas row.
- **Outputs.** KV per token, a batching run on a 400-request sample in the fleet worker, and $/Mtok at a dated price.
- **Nothing is stored.** The summary downloads as a file.

### 16.9 P4: protégé blocks (3s-11, 3s-12; 7 h)

- **The block.** A `protege` block, the plan's fourth new block type (PLAN §7.2), shows 4–6 sentences with one false. Finding, tagging and fixing it are choice items with whys in a new `protege` pool. Once found, the false line is shown struck through (the plan's risk mitigation).
- **The content.** One block per track, nine in all, on misconceptions the evidence names (ai-tutoring.md:294). A sim preset or a family item proves each fix.
- **The decision.** `docs/prereg/protege.md` fixes the within-learner comparison. The keep-or-kill is due at Wave 3 + 60 days (PLAN §9), so it lands after this wave. **D67:** the draft stays unsigned, so no arm is built and the default holds: one block per track.

### 16.10 The T0/T4 measured-versus-predicted real-engine run (3s-13; 4 h)

After consent for the ~400 MB download (Wi-Fi), you predict decode tok/s for Qwen3-0.6B q4 on your device from its bytes and a bandwidth you choose. Then you run the real engine (`real-engine.ts`) and see measured against predicted. It is recorded as `predict` plus `item` on `item:engine.measured-tps` with src `practice` and provenance `field` (§3.2), and labelled "your device, not an H100".
- **Build acceptance** covers the prediction UI, the comparison and the recording, tested with a stubbed measurement.
- **Owner step.** One device run on a laptop and one on a phone, with predicted and measured values in 3s-13's PR. Agents cannot satisfy the device run (as wave-2's F3b device runs).

---

## 17. Budgets, accessibility, determinism, tests

### 17.1 Budgets (gzip; `verify:bundle`)

| Gate | Measured | Wave 3 budget | Enforced |
|---|---|---|---|
| entry chunk | 113.7 KB | ≤ 250 KB (target 125); Wave 3 adds ≤ 2 KB | fails |
| `/boot` closure | 168.2 KB | ≤ 200 KB (target 165); 3c-05 adds ≤ 1 KB | fails |
| `/today` closure | 186.7 KB (full flow 239.1) | ≤ 200 KB; Wave 3 adds nothing static (`ProveReturnCard` is lazy) | fails |
| `/daily` closure | 181.6 KB (18.4 KB of headroom for 3s-08 and 3s-09, which edit `Daily.tsx`) | ≤ 200 KB | fails |
| `/me` closure | — (/progress's static closure ≈ 615 KB, 394 KB of it lesson data) | ≤ 200 KB | reported from 3a-02, fails from 3b-06 (D20) |
| `/play/tiling-cube`, `/play/eplb` (with their play chunks) | — (skipped until each play exists, 3a-02) | figure 200 KB | reported |
| `/play/block-placement`, `/play/scheduler` | 206.1 KB, 197.0 KB | figure 220 KB | reported |
| `/errors` | 157.8 KB; the compile bank is four group chunks, 72.9 KB in all (figure 30 KB), and verify-bundle checks that no other chunk holds bank data | figure 200 KB | reported |
| family chunks `tiling`, `prefill`, `rollout` | — | ≤ 8 KB each | reported |
| the claims chunk on /boot and /today | 17.1–17.4 KB | no growth: Wave 3's claims are lazy groups (D19) | test (3a-07) |
| ⌘K index | 18.2 KB of 20 KB (`verify:search-index`; verify-bundle's line prints 18.6) | ≤ 20 KB; Wave 3 adds ≤ 1.2 KB | fails (`verify:search-index`) |
| FSRS + cards + composer | 6.2 KB | report 6 KB (warns today) | reported |
| stretch: three + R3F chunk | 242.4 KB (ParticleField) | 240 KB | reported |
| stretch: the cube's 3D scene chunk | — | ≤ 40 KB | fails (3s-01) |
| stretch: `/drills`, `/capstone/service` | — | figure 200 KB | reported (3s-06, 3s-10 add their `ROUTE_BUDGETS` lines) |

### 17.2 Accessibility (WCAG 2.2 AA) and the harness

- **The harness** is Wave 2's (`scripts/a11y.mjs`): axe at 360, 320 and 1280 px plus the sideways-scroll check (`a11y.mjs:143–166`). Chromium runs through `PW_CHROMIUM_EXECUTABLE` (:214–215). Every UI task runs `npm run a11y -- --routes <its routes> --widths 360,320,1280` and walks its keyboard path (the "UI check" of §19.2); that needs the headless Chromium wrapper.
- **Default routes** (3a-02, 3c-02): /me replaces /progress, and `/week` stays (already listed, `a11y.mjs:41`). Added: `/play/tiling-cube`, `/play/eplb`, `/lesson/t6.l3`, `/lesson/t2.l2`, `/forge/batching-scheduler`. The smoke spec's reflow list adds `/me` and `/lesson/t4.l6` at 360 and 320 px.
- **Keyboard walks** (e2e at 360 px, by keyboard alone):

  | Spec | What it walks | Task |
  |---|---|---|
  | `e2e/tiling-cube.spec.ts` | level 1 to its debrief | 3b-01 |
  | `e2e/eplb.spec.ts` | the practice load to the debrief | 3b-02 |
  | `e2e/me.spec.ts` | every control on /me | 3b-06b |
  | `e2e/isomorphism.spec.ts` | t2.l2's shipped block, at 360 and 320 px (D42) | 3b-07 |
  | `e2e/receipts.spec.ts` | cite and check receipts on an Act I run with no passing module (they verify), then pass Act III | 3b-05 |
  | `e2e/fleet-exercise.spec.ts` | the knee | 3c-06 |
  | `e2e/boot.spec.ts` | Boot from the intro to its last step: the path line, the background pick and its clear, Go to Today; a replay keeps the stored path | 3c (fix round 2) |
  | `e2e/fleet-exercise-more.spec.ts` | the four stretch exercises: phone outcome, a fresh seed, the verdict, the explanation, saved | 3s-04, 3s-05 |
  | `e2e/drills.spec.ts` | an Interview round: three napkin items, the incident, the design items and the packet; only the practice incident is recorded | 3s-06 |
  | `e2e/shift.spec.ts` | /daily?shift=3 from the first alert to incident 2 with the carried note open, at 360, 320 and 1280 px; a failed load of the shift's code and its reload (D74) | 3s fix round 2 |
- **WCAG 2.2 specifics** as in Wave 1 §16.2:
  - targets ≥ 44 px;
  - steppers instead of sliders or drags (2.5.7);
  - focus not obscured;
  - verdicts in `aria-live`;
  - tables that scroll inside their own region, never the page.
- **Screen readers** (owner step): a VoiceOver (iOS) and NVDA (Windows) pass at the wave exit, over Boot → Today → /me → /play/tiling-cube → /forge/batching-scheduler (Prove-it v2, the race) → /week (receipts). The owner records it in `docs/a11y/wave-3-screen-readers.md`: per route and reader, the findings and pass or fail (a serious or critical finding fails).

### 17.3 Determinism

- **Already in scope:** everything new under `src/lib/world/**` (tiling, EPLB, bands, Fleet exercises, the bestiary, radix) and `src/lib/items/families/**` (`tiling`, `prefill`, `rollout`). That means no `Math.random`, no `Date`, and no `Math.pow`, `exp`, `log` or trigonometry (`verify-determinism.ts:37–48`).
- **Added** (3a-05b): the pure learner files (`provenance`, `vrk`, `competence`, `cold-checks`, `forms`, `iso`) and `src/lib/forge/prove2.ts`.
- **Fixtures.** Per-family hash fixtures pin the families. The receipts test pins re-runs (§10.3), and the EPLB equivalence test pins the ghost.

### 17.4 Tests and verify scripts

**`bun run test` gains:**
- `tests/ledger/contract-v33.test.ts`;
- `tests/items/{tiling,prefill,rollout}.test.ts`;
- `tests/world/{tiling,eplb,eplb-policy,fleet-ex,bestiary,radix}.test.ts`;
- `tests/plays/{bands,tiling-cube,eplb}.test.ts`;
- `tests/fleet/{receipts,act-values,receipts-act,receipts-exit,exercise-session}.test.ts`;
- `tests/fleet-ex/panel.test.ts`;
- `tests/forge/{prove2,lab-calls,prove2-lab02,prove-ui,race,twin,twins-content,labs-meta,proved-labs}.test.ts`, and one per new bundle (`mpmc-queue`, `toy-executor`, `batching-scheduler`, `radix-cache`, `xgrammar-lite`);
- `tests/learner/{vrk,competence,cold-checks,iso,forms,prove-return}.test.ts`;
- `tests/me/{mirror,motion}.test.ts`;
- `tests/plays/bundle-plays.test.ts`;
- `tests/lesson/{isomorphism-view,isomorphism,work-analogue}.test.ts`;
- `tests/lessons/export-blocks.test.ts`;
- `tests/sims/{block-table,inline-registry-a,inline-registry-b,no-credit}.test.ts`;
- `tests/claims/{lazy,wave3}.test.ts`;
- `tests/kc/hands-on.test.ts` (all 15);
- `tests/landscape/digest.test.ts` (only on `keep`; the watcher scored drop, D64, so it is not written).

**`npm run e2e` gains** `e2e/fleet-time.spec.ts` (D59: a Daily and a drill with a hidden stretch record their visible time).

**The existing gates cover more:**
- `verify:items`: the `iso` and `twin` pools, and `--subset`;
- `verify:generators`: the nine families on the base (`frag`, `kv`, `roofline`, `goodput`, `cost`, `memory`, `spec`, `sig`, `compile`), plus `tiling`, `prefill` and `rollout`;
- `verify:plays`: four plays, with bands by module;
- `verify:kc`: 154 KCs and labs 04–08 tags;
- `verify:claims`: lazy groups;
- `verify:bundle`: /me and the two plays;
- `verify:mentor`: labs 01–08, with faded ladders;
- `verify:determinism`: the added files;
- `verify:labs`: the repacked archives.

**Every task** runs `npm run lint`, `npm run build`, `bun run test` and every `bun run verify:*`, bare and never piped (PLAN-WORLDCLASS §10). UI tasks add their a11y routes. Tasks with an e2e spec run `npm run e2e` through the Chromium wrapper.

**UI behaviour tests.** Wave 3 adds about ten mounted-UI tests (`isomorphism-view`, `panels`, `forgelab-page`, `tiling-cube`, `eplb`, `prove-ui`, `receipts-act`, `motion`, `mirror`, `isomorphism`, the fleet-ex `panel`). They use the mounted-DOM kit `tests/dom/mini-dom.ts`, as `tests/today/start-set.test.ts` and `tests/forge/forge-ui.test.ts` do: `installDom()` in `beforeAll` (it first resets React's streaming context, so a page streamed by an earlier file cannot leak a `<Router>`), `uninstall()` in `afterAll`, and `mount`, `act`, `press` (focus, then click), a keydown `MiniEvent` and `until` in between. They assert on the DOM, focus, `aria-live` text and ledger events, never on source text; structural import gates (static-import walks, the pins `nav.test.ts` and `rings.test.ts` keep) stay as they are. Every global a test sets is restored. The kit provides no-op `ResizeObserver`, `IntersectionObserver` and `MutationObserver` and a `matchMedia`, but no `Worker` or `fetch`: tests inject a fake through props, or stub and restore it.

---

## 18. Wave 3 exit criteria: build gates and field gates

PLAN §8's Wave 3 exit is "15/15 T6/T7 hands-on; receipts validate Fleet Week; `proved` live on ≥3 labs; `/me` intervals; the journey re-cut", plus the keep-or-kill rules PLAN §9 dates at the Wave 3 exit.
- **Build gates** are provable in CI by the agents, and each names the task that owns it.
- **Field gates** need partners, calendar time or the owner. **Agents cannot satisfy them.** Wave 3 ships their instruments (§15): the owner collects donated exports, runs `scripts/partner-report.ts`, and signs what needs signing.

### 18.1 Build gates

| Gate | PLAN wording | Check | Owner task |
|---|---|---|---|
| B1 | 15/15 T6/T7 hands-on | `tests/kc/hands-on.test.ts` requires all fifteen lessons by id (wave-2 §5.4's definition, fleet blocks included) | 3c-01 (content: 3b-21) |
| B2 | receipts validate Fleet Week | `tests/fleet/receipts-exit.test.ts` replays a fixture Act I (with a fixture passing trace result, since no passing module is committed) and Act III through the real grading: verified receipts pass, and an edited value, another entropy or a missing module fails. No keyword, word count or screenshot remains in the grading (`receipts-act.test.ts`) | 3c-01, 3b-05 |
| B3 | `proved` live on ≥ 3 labs | `tests/forge/proved-labs.test.ts`: labs 02, 04, 06 and 07 write `proved` after an unseen green and a right answer, and never after a miss, a v1 answer, a reference build or a practice-seed run | 3c-01 (labs: 3a-22, 3b-10, 3b-12, 3b-13) |
| B4 | `/me` intervals | `tests/me/mirror.test.ts`: every figure has its n and an interval, or "not enough data" (3b-06b); `verify:bundle` gates /me at 200 KB (3b-06) | 3b-06, 3b-06b |
| B5 | remaining P2 (scope) | `tests/sims/no-credit.test.ts`: one registry, no inline task arrays, every `taskIds` entry of a lesson exercise block resolves to an outcome task (link-card blocks, with no `taskIds`, are exempt and earn nothing), legacy tasks earn nothing and resolve to no KC | 3c-01 (content: 3a-18 … 3a-21) |
| B6 | W7 (scope) | `verify:plays` with the cube's mirror, debrief, card and band; `e2e/tiling-cube.spec.ts`; the cube's pins (`tests/world/tiling.test.ts`) | 3a-13, 3b-01 |
| B7 | W5's EPLB play (scope) | the equivalence test (`eplb-policy.test.ts`), `verify:plays`, `e2e/eplb.spec.ts` | 3a-14, 3b-02 |
| B8 | accessibility (scope) | `npm run a11y` over §17.2's default routes: 0 serious or critical violations and no sideways scroll at 360, 320 and 1280 px; the six keyboard walks | 3c-02 and the owning tasks |
| B9 | Wave 3 scope | `verify:items` (`iso`, `twin`, `primm` with labs 04–08), `verify:generators` (`tiling`, `prefill`, `rollout`), `verify:kc` (154 KCs), `verify:claims` (lazy groups), `verify:mentor` (labs 01–08), `verify:labs`, `verify:bundle`, `verify:determinism` | the owning tasks |

### 18.2 Field gates

| Gate | PLAN wording | Measurement (partner report, §15) |
|---|---|---|
| F1 | the journey re-cut | `selectSurfaceMinutes` over partners (n ≥ 5): minutes per surface per week next to §4.D's cadence. The owner re-cuts PLAN §4.D's table |
| F2 | hint ladders keep-or-kill (Wave 3 exit) | `selectHintArms` under `docs/prereg/hint-ladders.md` (a draft, unsigned, while its arms already collect data; the owner signs it before any Wave 3 analysis of the arms): keep if the one-sided 97.5 % bootstrap bound of ladder − packet is above −5 points. Default if underpowered: R0–R2 only (`hint-ladders.md:50`) |
| F3 | Fleet Daily keep-or-kill (Wave 3 exit) | `selectDailyVsOther` under `docs/prereg/fleet-daily.md` (3c-03 drafts it; the owner signs it before the selector is read, PLAN §9): Daily KCs' 30-day diagnosis accuracy on unseen seeds ≥ the other KCs'. Default if underpowered: weekly, no On-Call |
| F4 | the watcher (Wave 3) | §14's rule on the signed pre-registration and an independent rating. Default: manual scan |
| F5 | Prove-it (H4's metric, "≥ 60 % of greens attempted") | `selectProveV2`, with n and partners. Default if underpowered: 1 question (PLAN §9) |
| F6 | P3's metric | `selectDiscrimination30`: 30-day accuracy and the confusion share (`confuse.<kcId>` misses, §11.2) on the paging, PagedAttention and radix set; "not enough data" without tagged lures |
| F7 | W7's metric | `selectCubeError30`: the 30-day fresh-item log error, reported with n |
| F8 | K5's opt-in metric | `selectFormsGain`: C/B ≥ 0.8 with a CI, per track, among opt-in partners |
| F9 | VRK₃₀ (the north star, PLAN §1) | `selectVrk30Spread`, reported as "among n partners (self-selected)", never as a pass |
| F10 | `proved` in use (beyond B3's build half) | the share of partners with ≥ 1 `proved` lab; descriptive |
| F11 | queue gating (PLAN §8) | Wave 3's review queue is under 10 h before Wave 4 starts. The owner sums the open tasks at PLAN §8's rates |
| F12 | accessibility | the VoiceOver and NVDA passes of §17.2, recorded by the owner in `docs/a11y/wave-3-screen-readers.md` (routes, findings, pass or fail) |

---

## 19. Task DAG for Sonnet implementers

### 19.1 How the PRs fit together

- **One PR per task into its wave branch**, as in Waves 1 and 2. Each task works in its own worktree. Its prompt names the base sha and checks it with `git merge-base --is-ancestor`, because worktrees start at `master`. Each worktree makes a private hard-linked `node_modules`. The integrator merges a level before the next starts, and runs every gate on the merged tree: Wave 2's failures appeared only there.
- **The stack is linear (D1).**
  - `wave-3a` is the Wave 2 integration commit, 4b32c09 (D2).
  - `wave-3b` comes from 3a's merged tip, `wave-3c` from 3b's, and `wave-3s` from 3c's.
  - A task may depend on any task of an earlier PR. A file may change in several PRs, in sequence.
- **File ownership** (D23 of Wave 2, W14):
  - Inside a level, unordered tasks never touch the same file. An arrow inside a level marks a pair that runs in sequence.
  - **Every file a task edits is listed, tests included.**
  - **Generated files are never merged by hand.** The integrator regenerates them from the merged sources: `src/data/search-index.json` (`bun scripts/build-search-index.ts`), `public/lessons-md/*.md` and `public/llms.txt` (`export-lessons-md.ts`), `public/claims.json` (`verify-claims.ts --write`), per-family hash fixtures (`verify-generators --update-hashes --family <id>`), and repacked lab archives (`pack-labs.py`).
  - `tests/forge/fixtures.ts` changes only in 3a-11; each lab's fake modules live in its own test file.
- **UI behaviour tests** mount with `tests/dom/mini-dom.ts` and assert on the DOM, focus, `aria-live` and ledger events, never on source text (§17.4).
- **Gates first (D3).** Every gate or engine file changes in 3a level 0. The exceptions are declared flips placed after what they gate: 3b-06 (the /me budget, in the fold) and 3c-01 (15/15, no credit without a prediction, `proved`, receipts). Stretch tasks change gates only after 3a–3c have merged.
- **Pools and margins.** Every task that adds multiple-choice items names its pool, runs `verify:items -- --subset <its refs>` (≤ chance + 10 points), and leaves the 15-point gate to the merged tree.
- **The DAG was checked mechanically.** The task list below and `wave3-dag.json` come from one data file, `tasks.py`. It checks:
  - unique ids;
  - dependencies that exist and never point forward (inside a PR to a lower level, or the same level in sequence; across PRs only to an earlier PR of the stack);
  - contiguous levels;
  - disjoint files between unordered tasks of a level (generated files exempt);
  - gate files only in 3a level 0, declared flips or stretch;
  - a named pool for every multiple-choice task;
  - the browser flag on every UI check;
  - task size.

  It reports no problems.
- **External dependencies** are written `w2:<task>` (`w2:2c-fix` is the 2c fix round); the base holds them.
- **Opus first** marks a task whose design needs an Opus decision before (or while) a Sonnet implementer builds it. There are six: 3a-12 (the run record, approved before 3a-01 starts because 3a-01 freezes it in the codec, and the rounding rule), 3a-13 (the cube's formulas and pins), 3a-14 (the EPLB turn rule, band and sentences), 3a-17 (VRK₃₀'s definition), 3a-22 (the Prove-it v2 template rules) and 3c-04 (the watcher rule on the signed inputs).
- **Private solutions.** 3a-10 recalibrates, and lab tasks time stage 1, from `labs/_solutions/<lab>/` copied from the main checkout into the worktree's gitignored `labs/_solutions/`. They are never committed or packed; `pack-labs.py`'s audit fails on any `_solutions` path.
- **Browser checks.** Headless Chromium runs only through the wrapper (`PW_CHROMIUM_EXECUTABLE`). Tasks that need it say "Browser" (37 of 65).
- **Owner steps** are listed per task and are not build acceptance:
  - claim quotes and pins (3a-08, 3s-07);
  - item and content reviews (3a-18, 3a-19, 3b-05, 3b-10 … 3b-18, 3c-05, 3s-03, 3s-12);
  - signing the watcher pre-registration and rating the backtest (3c-04; a fresh rater agent is launched only by the owner or the orchestrator), and the 3D and protégé pre-registrations (3s-02, before it merges; 3s-11);
  - signing `docs/prereg/hint-ladders.md` (carried from 2c-06, still a draft) before any Wave 3 analysis of `selectHintArms`, and `docs/prereg/fleet-daily.md` (3c-03 drafts it) before `selectDailyVsOther` is read (F2, F3);
  - the On-Call think-alouds, whose notes stay with the owner (3s-08);
  - the GPU runs of the field labs' pinned commands (3s-07) and the real-engine device runs (3s-13);
  - the screen-reader passes, recorded in `docs/a11y/wave-3-screen-readers.md` (§17.2);
  - partner rounds and the journey re-cut (§18.2).
- **Integration after 3c** (Opus):
  - Regenerate the generated files and run every gate.
  - Build the private solutions as ordinary learner modules and pass Prove-it v2 on labs 02, 04, 06 and 07 with them.
  - Race lab 06's private solution, as a learner module, against the reference.
  - Play the cube and the EPLB play to their debriefs, and cite and verify a receipt in Act I.
  - Record the bundle table.

```
        tasks in a level run in parallel (∥); * = Opus first; → = in sequence inside a level
3a  L0: 3a-01 → {3a-01b, 3a-03, 3a-12*};  3a-03 → {3a-04, 3a-05b, 3a-11};  3a-07 → {3a-08, 3a-09 → 3a-10};
        {3a-03, 3a-07} → 3a-05;  ∥ 3a-02 ∥ 3a-06            (→ = in sequence; every other pair in parallel)
    L1: 3a-13* ∥ 3a-14* ∥ 3a-15 ∥ 3a-16 ∥ 3a-17* ∥ 3a-19 ∥ 3a-20 ∥ 3a-21 ∥ 3a-22*
    L2: 3a-18                                                          ← wave-3b branches from 3a's merged tip
3b  L0: 3b-01 ∥ 3b-03 ∥ 3b-04 ∥ 3b-05 ∥ 3b-06 → 3b-06b ∥ 3b-07 ∥ 3b-08 ∥ 3b-09
    L1: 3b-02 ∥ 3b-10 ∥ 3b-11 ∥ 3b-12 ∥ 3b-13 ∥ 3b-14 ∥ 3b-15 ∥ 3b-16 ∥ 3b-17 ∥ 3b-18 ∥ 3b-19 ∥ 3b-20
    L2: 3b-21                                                          ← wave-3c branches from 3b's merged tip
3c  L0: 3c-01 ∥ 3c-02 ∥ 3c-03 ∥ 3c-04* ∥ 3c-05 ∥ 3c-06
3s  L0: 3s-01 ∥ 3s-03 ∥ 3s-04 ∥ 3s-07 ∥ 3s-08 ∥ 3s-11 ∥ 3s-13      (each starts in the plan's order while the queue is < 10 h)
    L1: 3s-02 ∥ 3s-05 ∥ 3s-06 ∥ 3s-09 ∥ 3s-12
    L2: 3s-10
```

**Task counts:** 3a 24, 3b 22, 3c 6, 3s 13 (65 in all; 52 outside stretch). 3a-01b and 3a-05b split the old 3a-01 and 3a-05 (the critique's A3, A10 and B4 grew them). 3b-06 splits in two (R2-02): 3b-06 keeps the mechanical fold of Progress into /me and the budget gate, and 3b-06b is the Mirror; 3b-19, 3c-02 and 3c-05 depend on 3b-06b.

### 19.2 The tasks

#### PR 3a: contracts, gates and engines

**Level 0**

**3a-01 · Ledger contract v3.3: Prove-it v2 and `proved`, form and play item sources, form keys, the return flag, play metrics, run records and receipts, background, the stretch shapes, Aggregate v4 (spec §3.1-3.3, §3.5-3.6)** M. Depends: w2:2b-21, w2:2c-fix.
- **Files:** `src/lib/ledger/constants.ts`, `src/lib/ledger/types.ts`, `src/lib/ledger/codec.ts`, `src/lib/ledger/fold.ts`, `src/lib/progress.ts`, `tests/ledger/contract-v33.test.ts`, `tests/ledger/contract-v32.test.ts`, `tests/ledger/gen.ts`, `tests/ledger/codec.test.ts`, `tests/ledger/fold.test.ts`, `tests/ledger/facade.test.ts`.
- **Accept:** §3 as specified: SCHEMA_VERSION 6 and AGGREGATE_VERSION 4 with the upgrade chain v1→v2→v3→v4 at hydrate (no empty first paint); no new event kind and no new ref grammar; checkData accepts ProveData v2, the item sources `form` and `play`, the predict sources `play` and `practice`, the form keys `formId`, `formSlot`, `formSet` and `track` (never `data.form` or `data.slot`, which stay the ticket form and the Today position), `return: true` on an item, PlayData's `metric` and `levels`, EplbSpecData, the `fw:runs` and `profile:background` working keys and fleet-act data with `receipts` and `rubric`, and rejects every malformed case listed in §3.2 (including provenance `proved` on a v1, a not-ok or a hash-less prove event); RunRecord and FleetActData are exported from types.ts in the shape the Opus check of 3a-12 approved before this task started (§3.2), and 3a-12 imports them; the stretch shapes of §3.2 pass the codec, so no stretch task edits the ledger; recordProve takes provenance `practice` (the default, so v1's callers and tests/forge/prove.test.ts are unchanged) or `proved`; the fold derives `proved[lab]` and `labFleetOk[lab]`; contract-v32 relaxes its pins to 'at least'; the property suite (P6, P7, round trip) passes at 100 seeds × 40 ops with every new shape in OPS_TABLE (a v1 return item and a form item among them); a Wave 2 fixture ledger derives identically on every v3 field; the schema guard at 6 vs 5 goes read-only; entry growth ≤ 1 KB gzip, printed.

**3a-01b · Economy for Wave 3: RING 0's lab 06 race row from `labFleetOk`, the play prices, ROOT kept green (spec §3.4)** S. Depends: 3a-01.
- **Files:** `src/lib/economy.ts`, `src/lib/economy-table.ts`, `src/pages/progress/ring-rows.ts`, `tests/economy/rings.test.ts`, `tests/economy/table.test.ts`.
- **Accept:** §3.4: RING 0 (economy.ts) adds lab 06 within 3 points of the reference from the fold's `labFleetOk['batching-scheduler']`, and ring-rows.ts adds its checklist row (RING 0 goes from 2 rows to 3, so the row-count pin at tests/economy/rings.test.ts:595, [3, 3, 2, 6] today, becomes [3, 3, 3, 6]); PLAY_MINUTES prices tiling-cube 25 and eplb 15, and the PLAY_MINUTES price test in tests/economy/table.test.ts ('every registered play is priced with its PlayDef.minutes', :71-75; its filter at :75 admits only the scheduler ahead of its play) allows prices for plays that register later, as it did for the scheduler; ROOT's cold-check part is unchanged: it already reads the `ach:root-cold` achievement (25e4b8a, selectColdChecks, economy.ts:290-323), and its existing tests stay green; RING 0 is tested with and without `labFleetOk`.

**3a-02 · Routes and budgets: /me with /progress redirecting, nav and palette, budget lines for /me and the two plays, a11y defaults (spec §2.2, §17.1)** M. Depends: this spec.
- **Files:** `src/App.tsx`, `src/pages/Me.tsx`, `scripts/prepare-pages.mjs`, `src/components/nav-links.ts`, `tests/shell/nav.test.ts`, `src/components/CommandPalette.tsx`, `src/components/Footer.tsx`, `src/components/Navbar.tsx`, `src/pages/Forge.tsx`, `scripts/verify-bundle.ts`, `scripts/bundle-plays.ts`, `tests/plays/bundle-plays.test.ts`, `scripts/a11y.mjs`.
- **Accept:** §2.2 and §17.1: /me renders today's Progress page (Me.tsx wraps it until 3b-06 rebuilds the page) and is routed through lazyMotion, as Progress is today (App.tsx:34; the B26 list in tests/shell/nav.test.ts:163-168 names Me in Progress's place, and 3b-06 moves /me to plain `lazy`), /progress redirects to /me with `replace` (the /field-notes pattern, App.tsx:82), and both return HTTP 200 after prepare-pages; nav 'Me' points at /me and holds /me and /progress (nav test updated); the palette's page list and the Footer, Navbar and Forge links say /me; verify:bundle reports /me against a 200 KB figure (3b-06 turns it into a gate), reports /play/tiling-cube and /play/eplb against a 200 KB figure with their play chunks once each play exists: a row whose playSrc file does not exist yet prints 'skip <route>: <playSrc> does not exist yet' before any chunk lookup (the check sits in scripts/bundle-plays.ts beside playChunkKey, whose by-name fallback would otherwise hand a missing play the scheduler's hoisted `_Play-*` chunk), and tests/plays/bundle-plays.test.ts proves a missing playSrc is skipped and never resolves to another play's hoisted chunk (3b-01 and 3b-02 then print their figures); it prints the shared claims chunk on /boot and /today; a11y's default routes swap /progress for /me; existing routes render as before. UI check (§17.2) on `/`, `/me`, `/today`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3a-03 · Lesson and bundle types, exporter and renderer seams: Fleet exercise blocks, active isomorphism fields, Prove-it v2 and faded ladders in bundles (spec §2.3)** M. Depends: 3a-01.
- **Files:** `src/data/lessons/types.ts`, `src/data/forge/types.ts`, `src/pages/lesson/exercise.tsx`, `src/pages/lesson/blocks.tsx`, `src/components/lesson/Isomorphism.tsx`, `src/components/fleet-ex/FleetExercise.tsx`, `src/lib/world/fleet-ex/index.ts`, `src/pages/Progress.tsx`, `scripts/export-lessons-md.ts`, `scripts/kc/seed-candidates.ts`, `tests/lesson/isomorphism-view.test.ts`, `tests/lessons/export-blocks.test.ts`, `public/lessons-md/*.md`.
- **Accept:** §2.3: ExerciseBlock becomes SimExerciseBlock | FleetExerciseBlock and every reader narrows (src/pages/Progress.tsx:97 reads `block.tasks` and narrows with `'tasks' in block`; any other src reader of exercise-only fields that `tsc -b` flags is narrowed the same way and listed in the PR; scripts/kc/seed-candidates.ts, which tsc does not see and CI does not run, spreads `b.tasks` for every exercise block (:56-57) and narrows with `'tasks' in b`, printing a fleet block's title and fleet id); IsomorphismBlock gains principle, breakItem and kcs, IsomorphismPair gains work (typed with the ledger's Background); ForgeBundle gains prove2 and fade, with ProveV2Spec typed in forge/types.ts; ExerciseView renders a lazy FleetExercise stub (renders nothing, exports its final props type) for a fleet block; IsomorphismView moves unchanged into src/components/lesson/Isomorphism.tsx (a test renders a T2 panel identically); src/lib/world/fleet-ex/index.ts exports the FleetExerciseDef, SweepPoint and SweepResult types (§5.3) and an empty FLEET_EXERCISES; the exporter prints fleet blocks (title plus 'run it in the lesson'), pairs with their breaks and the principle, and a break item without its key; lessons without isomorphism breaks export byte-identically; the ten T0-T2 lessons whose 29 pairs carry `breaks` change only by their 'where it breaks' lines (the diff is in the PR), and a test pins one such pair's exported line; public/lessons-md is regenerated.

**3a-04 · Item gates for Wave 3: the iso and twin pools, and the --subset margin report (spec §4.1)** M. Depends: 3a-03.
- **Files:** `scripts/item-pools.ts`, `scripts/verify-items.ts`, `scripts/baselines/verify-items.json`, `tests/items/verify-items.test.ts`.
- **Accept:** §4.1: item-pools.ts collects `iso` (every IsomorphismBlock.breakItem, ref `item:<lesson>.iso.<n>.break`, n counting the lesson's isomorphism blocks from 1, as align refs count) and `twin` (every src/data/twins/<lab>.ts exporting TWIN_ITEMS, found by readdir); both run through checkPoolItems, the cue limits, the odd-one-out check, the ratchet and the adversary (ALL_OWN_POOLS), with baseline entries; OWN_POOLS in item-cues.ts is untouched (mc-cues pins it); `bun run verify:items -- --subset <selector>` takes comma-separated ref prefixes or one /regex/, matched against the ref verify-items prints for each item (`<lesson> q<n>` for lesson quizzes, `forge/<lab dir> <item id>` for PRIMM items, `item:…` for the align, iso and twin pools), prints n and the subset's hit rate per strategy and the adversary's, exits 1 when the subset is empty, exits 1 above chance + 10 points when n ≥ 12, and below n = 12 reports the rates without failing (the merged-level run decides, §4.1); alignment refs stay 1-based in both AlignItem and item-pools (2c fix 9111d08) and tests/lesson/align.test.ts stays green; the PRIMM row keeps the gate's own comparison (already true since 25e4b8a); fixtures prove a break item without a why per option fails, a PRIMM subset (`forge/kv-block-manager `) selects at least one item, an empty subset fails, a regex subset over iso refs works, and a subset of n ≥ 12 over the margin fails; verify:items passes on this tree.

**3a-05 · Play gates: practice bands by module, claim ids from the full registry, the fleet-ex mirror scope, PLAY_IDS pins that admit new plays (spec §4.2)** S-M. Depends: 3a-03, 3a-07.
- **Files:** `scripts/verify-plays.ts`, `src/lib/world/bands/block-placement.ts`, `src/lib/world/bands/scheduler.ts`, `tests/plays/bands.test.ts`, `tests/plays/play.test.ts`, `tests/plays/scheduler.test.ts`, `tests/sims/host.test.ts`.
- **Accept:** §4.2: verify-plays reads each play's practice band from src/lib/world/bands/<id>.ts, whose `band(read)` returns Promise<{ok, detail}> and reads trace files only through the injected `read(repoPath)` loader (no node:fs under src/lib/world/bands); block-placement and scheduler move there unchanged: the scheduler's ok is checkSchedBand(practiceMinute(source)).inBand over all five §8.2 rules (wave-2 D33, the shared practice minute SCHED_PRACTICE_MINUTE_SEED; never rules 1 and 4 alone) and its detail is today's note ('in band on all five rules', or the rules missed); the mapping from checkSchedBand's result to {ok, detail} is a pure export of the band module, and tests/plays/bands.test.ts shows a result that misses only rule 2, only rule 3 or only rule 5 gives ok false; a registered play without a band module fails; `practiceBandOf(id, root)` (verify-plays.ts:230-252) stays exported with its signature, delegates to the module and maps its {ok, detail} to today's {inBand, note}, returning null for an unknown play (the test 'the practice minute is in band on every §8.2 rule, and verify-plays enforces all five', tests/plays/scheduler.test.ts:530-537, stays green, its null check at :537); verify-plays builds `claimIds` from src/data/claims/all.ts (§4.4), and every card-claim check in tests/plays/play.test.ts and tests/plays/scheduler.test.ts reads all.ts too, so 3b-01 and 3b-02 cite lazy claims; the exact PLAY_IDS pins (play.test.ts:84 and the `PLAY_IDS` pin in scheduler.test.ts, :225) become 'starts with block-placement, scheduler' and the PLAYS, PLAY_REGISTRY and PLAY_PRODUCTION_ROWS ties to PLAY_IDS stay; src/components/fleet-ex joins the mirror scope (MIRROR_SCOPE; tests/sims/host.test.ts follows); GATE_3D is unchanged; verify:plays passes.

**3a-05b · Sim, hands-on, determinism and mentor gates: fleet blocks in hands-on, per-file task homes, faded ladders (spec §4.2)** S-M. Depends: 3a-03.
- **Files:** `tests/kc/hands-on.test.ts`, `tests/sims/registry.test.ts`, `src/lib/sims/registry.ts`, `scripts/verify-determinism.ts`, `scripts/lint-mentor.ts`, `tests/forge/ladder.test.ts`.
- **Accept:** §4.2: the hands-on test counts a fleet block whose exercise is in FLEET_EXERCISES and still gates at ≥ 10; its 'a pending play and an unregistered task do not count' fixture already uses an unregistered play id ('no-such-play', hands-on.test.ts:83) and keeps it; registry.test.ts, whose outcome-prefix check hard-codes /^(roof|kv|alloc|zoo)\./ (:82), accepts the prefixes the tasks files declare and narrows fleet blocks; a tasks file may export HOME {simId, machine?}, with LEGACY_HOME as the fallback; verify-determinism's scope adds src/lib/learner/{provenance,vrk,competence,cold-checks,forms,iso}.ts and src/lib/forge/prove2.ts; lint-mentor accepts a bundle with fade 'r2' whose required checks have R0-R2 only, and still requires R0-R4 elsewhere (tested); verify:determinism and verify:mentor pass.

**3a-06 · Mount points for Wave 3 panels: twin, race and Prove-it v2 on ForgeLab, the 30-day return on Today (spec §2.3)** S. Depends: w2:2b-12.
- **Files:** `src/pages/ForgeLab.tsx`, `src/components/forge/TwinPanel.tsx`, `src/components/forge/RaceReference.tsx`, `src/components/forge/ProveFromModule.tsx`, `src/pages/today/DoneCard.tsx`, `src/pages/today/EmptyState.tsx`, `src/components/learner/ProveReturnCard.tsx`, `tests/forge/panels.test.ts`, `tests/forge/forgelab-page.test.ts`.
- **Accept:** §2.3: TwinPanel {lab, done}, RaceReference {lab, bytes, report, credit} and ProveFromModule {lab, bundle, bytes, report, credit} are lazy stubs that render nothing and export their final props types, mounted by ForgeLab after a run with the bytes, report and credit ForgeLab already keeps for InstallButton; ProveReturnCard {variant: 'done' | 'empty'} is a lazy stub on Today's done card and empty state beside DailyCard; the /today static closure does not grow (printed); panel and page tests updated. UI check (§17.2) on `/today`, `/forge/batching-scheduler`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3a-07 · Lazy claim groups: registerClaims, a full registry for tooling, and a test that /boot and /today never load them (spec §4.4)** S-M. Depends: this spec.
- **Files:** `src/data/claims/index.ts`, `src/data/claims/all.ts`, `scripts/verify-claims.ts`, `src/components/ClaimsTable.tsx`, `scripts/build-search-index.ts`, `scripts/verify-search-index.ts`, `tests/claims/lazy.test.ts`, `public/claims.json`, `src/data/search-index.json`.
- **Accept:** §4.4: registerClaims(list) adds a group to the registry once (idempotent; a duplicate id with a different body throws); getClaim names the group to import when an id is unknown; src/data/claims/all.ts imports the registry and every group under src/data/claims/lazy/ and is what verify-claims, the /freshness claims table, the search-index builder and verify-search-index read (verify-search-index.ts:12 imports `byId` from the eager registry today; it reads all.ts, so a lazy claim's index row is not 'not in the registry'); verify-plays (3a-05) and verify-kc (3a-09) switch to all.ts after this task; a static-import walk proves Boot.tsx and Today.tsx never reach src/data/claims/lazy/ (the tests/boot/imports.test.ts pattern), and src/data/plays.ts imports no lazy group; public/claims.json and the index are byte-identical (no group exists yet); verify:claims and verify:search-index pass.

**3a-08 · Wave 3 claims: H100 tiling figures and FP8, DeepSeek-V3 experts and EPLB, engine flags for EPLB and disaggregation, the two twins, the cube and play card rows (spec §4.4)** M. Depends: 3a-07.
- **Files:** `src/data/claims/lazy/tiling.ts`, `src/data/claims/lazy/moe.ts`, `src/data/claims/lazy/twins.ts`, `src/data/claims/lazy/serving3.ts`, `src/data/claims/all.ts`, `scripts/verify-claims.ts`, `tests/claims/wave3.test.ts`, `public/claims.json`, `src/data/search-index.json`.
- **Accept:** §4.4: every claim in the §4.4 table exists with url, quote and verifiedAt (spec and price), or a pin {repo, ref} whose url contains the ref (status claims about engine flags, and the two twins with ttlDays 60), or is dropped with a note in the PR, never invented; the H100 FP8 dense figure is a derived claim from the sparse one with a DERIVATIONS entry; the DeepSeek-V3 expert counts reuse the zoo's pinned config revision; verify:claims passes; the index grows ≤ 1.2 KB gzip (printed); public/claims.json regenerated.
- **Owner step (not build acceptance):** The owner signs off every new quote and pin in the PR.

**3a-09 · KC contract for Wave 3: t4.raster-l2-reuse and the gen links for tiling, prefill and rollout (spec §4.3)** S-M. Depends: 3a-07.
- **Files:** `src/data/kc/ids.ts`, `src/data/kc/t2.ts`, `src/data/kc/t4.ts`, `src/data/kc/t5.ts`, `src/data/kc/t6.ts`, `scripts/verify-kc.ts`, `tests/kc/graph.test.ts`, `tests/kc/verify.test.ts`, `tests/kc/scope.test.ts`, `src/data/lessons/t4/matmul-tiling.ts`, `public/lessons-md/*.md`, `src/data/search-index.json`.
- **Accept:** §4.3: t4.raster-l2-reuse is defined (t4.l6, requires t4.tiling-intensity) and t4.l6's Lesson.kcs lists it third; every gen link of the §4.3 table is set, so each family lands later without a KC edit; PENDING_FAMILIES gains tiling, prefill and rollout; verify-kc builds its known-claims set from src/data/claims/all.ts (verify-kc.ts:414-427 reads the eager CLAIMS today), and so do tests/kc/verify.test.ts (:21) and tests/kc/scope.test.ts (:136), which build `claims` for verifyKc and expect no errors on the committed graph, so a KC that cites a lazy claim fails no gate; Wave 3 attaches no lazy claim to a KC all the same, because H2 packets read KC claims through src/lib/mentor/packet.ts claimsFor (the eager byId, which drops unknown ids; §4.4); no confusable set changes (Q11; graph.test.ts:54-65 pins Wave 1's pairs); verify:kc passes; KC count printed (154).

**3a-10 · Labs 04-08 metadata: stages, KCs and expectations in labs.ts, lab tags on KCs, STAGE markers, repacked archives (spec §8.1)** M. Depends: 3a-09.
- **Files:** `src/data/labs.ts`, `src/data/kc/t2.ts`, `src/data/kc/t3.ts`, `src/data/kc/t5.ts`, `src/data/kc/t6.ts`, `labs/mpmc-queue/src/queue.rs`, `labs/toy-executor/src/executor.rs`, `labs/batching-scheduler/src/scheduler.rs`, `labs/radix-cache/src/cache.rs`, `labs/xgrammar-lite/src/grammar.rs`, `labs/*/calibration.json`, `public/labs/*.zip`, `public/labs/*.tar.gz`, `tests/forge/labs-meta.test.ts`, `tests/kc/graph.test.ts`.
- **Accept:** §8.1: every check of labs 04-08 has the stage its crate's `list` reply gives, the KCs of the §8.1 table and an expectation; each tagged KC's `labs` names the lab, and verify-kc's lab and readiness rules pass; the KC table pins in tests/kc/graph.test.ts (:194-212: the `labs` and `requires` of t5.continuous-batching, t5.admission-headroom, t5.sched-order and t5.block-refcounts) move with the new tags and any `requires` edge added; the five TODO files carry STAGE markers and a header saying which check catches which mistake, with signatures and lib.rs unchanged; calibration reruns only for a crate whose calibration.json pins an edited file (from the private solutions in the main checkout's labs/_solutions, never committed); zips and .tar.gz repacked; verify:labs, verify:guardrails and verify:kc pass; a test holds labs.ts stages to each crate's committed calibration list.

**3a-11 · Verb calls in the lab worker, and the Prove-it v2 core: plan, grade, eligibility, retry and return timing (spec §7.1, §7.3)** M. Depends: 3a-03.
- **Files:** `src/workers/lab-protocol.ts`, `src/workers/lab.worker.ts`, `src/lib/lab-worker.ts`, `src/lib/forge/prove2.ts`, `tests/forge/prove2.test.ts`, `tests/forge/lab-calls.test.ts`, `tests/forge/fixtures.ts`.
- **Accept:** §7.1 and §7.3: a `calls` request instantiates the module once in the lab worker, sends each entry of `calls` through ks_invoke in order (an entry may contain newlines: a batching-scheduler `schedule` call is one multi-line entry, never split) and returns the replies, with one 2 s budget for the whole list, LabTimeoutError on expiry and a trap reported as a failed call; replies are capped at 4 KiB each and `@reference` builds are refused; prove2.ts plans a question from (template, seed), grades the learner's answer against the module's replies, and returns a ProveResult v2 whose provenance is `proved` only when the answer is right and the run that graded this module (its sha256) had credit `unseen`; a miss opens the next credited attempt 24 h later and attempts in between are practice; the 30-day return is due 30 local days after a lab's first prove event; tested with fake modules (fixtures.ts, which no later task edits).

**3a-12 · Receipts engine: numeric run values, run records and their id, the receipt-token parser, verification by re-run, uncited figures [Opus first: approve the run record before 3a-01 starts, and the rounding rule] (spec §10.1-10.3)** M. Depends: w2:2b-17, w2:2b-21, 3a-01.
- **Files:** `src/lib/fleet-receipts.ts`, `src/lib/fleet-week.ts`, `src/workers/sim-client.ts`, `tests/fleet/receipts.test.ts`, `tests/fleet/act-values.test.ts`, `tests/world/faults.test.ts`.
- **Accept:** §10.1-10.3: ActResult gains `values` (numbers, by §10.1's keys) for Acts I-III with `metrics` unchanged; runSim(job, onProgress?, entropy?) keeps its Promise<SimResults[K]> return (FleetWeek.tsx's three callers, :224, :287, :414, compile unchanged), and a new export runSimWithEntropy(job, onProgress?, entropy?) resolves {result, entropy} with the entropy it used (3b-05 adopts it); RunRecord is imported from src/lib/ledger/types.ts (3a-01 defines it; never redefined here); runRecord(act, job, entropy, values, at) builds {id, act, job with module bytes replaced by {slot, sha256}, entropy, values, at}, with `at` the ISO instant its caller (FleetWeek.tsx) passes, because src/lib/fleet-receipts.ts is inside verify-determinism's src/lib/fleet-*.ts scope (no Date.now or new Date there), and id = the first 8 hex of sha256(stableStringify(record without id and at)), and every record passes 3a-01's `fw:runs` codec (job ≤ 4 KB serialized, ≤ 40 values; tested); parseReceipts reads tokens of the form `[[r:7f3a9c21 goodput=41.2]]` (an 8-hex id, a value key, an equals sign, a number); verifyReceipts re-runs each distinct record with the same entropy and module bytes (from the components store) and verifies a cited value when it equals the re-run value rounded to the decimals written (at most 2); uncitedFigures flags every %, ms, s, iters, tok/s, req/s or $ figure outside a token; tests prove an edited value, a record for another entropy and a module missing from the device each fail, and a correct receipt passes; Acts I-III outputs are otherwise byte-identical: tests/world/faults.test.ts leaves the new `values` field out of its hashed outputs, and EXISTING_RUNS_SHA256 does not change (fix the change, never the hash).

**Level 1**

**3a-13 · The tiling world and the `tiling` family: the six levels on claims, and the cube practice band [Opus first: approve each level formula and its pins (64, 448, 3 CTAs, 130.0 vs 734.6, 590.4, 127.5)] (spec §6.1-6.2)** M-L. Depends: 3a-05, 3a-08, 3a-09.
- **Files:** `src/lib/world/tiling.ts`, `src/lib/items/families/tiling.ts`, `src/lib/world/bands/tiling-cube.ts`, `tests/world/tiling.test.ts`, `tests/items/tiling.test.ts`, `tests/fixtures/items/hashes/tiling.json`.
- **Accept:** §6.1-6.2: tiling.ts implements tileAI, smemBytes, maxTile, ctasPerSm, waveAI (row and grouped raster, with the L2 window check, one CTA per SM as a persistent kernel) and qBlockAI with products and sums only (determinism scope), on the §4.4 claims; pins: a 128 × 128 FP16 tile 64 FLOP/B; the largest square tile whose slabs fit 227 KiB at k = 64 and 2 stages 448 (SMEM only: ctasPerSm(448) = 0, and the largest square tile with ≥ 1 CTA per SM is 256); 3 CTAs per SM at T = 128; the 16384³ GEMM's 132-CTA wave 130.0 FLOP/B row-major and 734.6 grouped 11 × 12; the FP8 ridge 590.4 (FP8 rate = 2 × BF16 dense, the rule RooflineSim and the roofline family use; a test holds hw.h100-sxm.fp8-dense within 1 TFLOPS of 2 × 989) and the square tile that reaches it T ≥ 591; the FlashAttention Q-block pass at N = 32768, Br = 128 127.5; every tile a level's debrief names as a reference choice has ctasPerSm ≥ 1, or the debrief names the register cap (tested over the §6.3 debriefs); the family serves five numeric variants (levels 2-6 of the cube; level 1 is roofline/tile-ai) at levels 0-3 with ratio rules, Gen.kcs equal to §4.3's row, chunk ≤ 8 KB gzip (printed); verify:generators passes at 1,000 seeds; the practice band holds.
- **Pool:** none: numeric variants only.

**3a-14 · The EPLB world: seeded expert loads, replicate-then-place turns, the EPLB ghost, first-divergence debrief, Compose dials and the equivalence proof [Opus first: approve the turn rule, the band and the debrief sentences on 50 seeds] (spec §5.2)** M. Depends: 3a-05, 3a-08.
- **Files:** `src/lib/world/eplb.ts`, `src/lib/world/eplb-policy.ts`, `src/lib/world/bands/eplb.ts`, `tests/world/eplb.test.ts`, `tests/world/eplb-policy.test.ts`.
- **Accept:** §5.2: drawLoads(seed) gives 16 expert loads in integer per-mille summing to 1,000, inside the band; the lockstep model (world/play.ts) runs 4 replicate turns, then 20 place turns, heaviest copy first; the ghost replicates the expert with the highest load per copy and places each copy on the least-loaded GPU with a free slot (DeepSeek EPLB's balanced packing); eplbDivergence names the first recoverable divergence with the §5.2 sentence templates, and tests generate each sentence from the world on banded seeds (never copied from the spec's examples): a place sentence's 'least loaded with a free slot' GPU is the one the ghost picks in that state, and the outcome sentence speaks of the layer's expert phase; compileEplbPolicy({replicate: 'per-copy', place: 'least-loaded'}) equals the ghost at every turn on the practice load and 1,000 banded loads; deterministic; no Math.pow.

**3a-15 · Generator family `prefill`: P:D ratio, KV transfer time, load or recompute, the timing-oracle gap, the namespace cost (spec §5.1)** S-M. Depends: 3a-08, 3a-09.
- **Files:** `src/lib/items/families/prefill.ts`, `tests/items/prefill.test.ts`, `tests/fixtures/items/hashes/prefill.json`.
- **Accept:** §5.1 (prefill): five numeric variants at levels 0-3 with their ratio rules and pins; Gen.kcs = t6.epd-phases, t6.kv-tiering, t6.cache-timing-oracle; real-world numbers only through claimNumber, scenario numbers in SYNTHETIC and labelled hypothetical; verify:generators passes at 1,000 seeds; chunk ≤ 8 KB gzip, printed.
- **Pool:** none: numeric variants only.

**3a-16 · Generator family `rollout`: rollout share, the long tail, group tokens, weight-sync seconds (spec §5.1)** S-M. Depends: 3a-08, 3a-09.
- **Files:** `src/lib/items/families/rollout.ts`, `tests/items/rollout.test.ts`, `tests/fixtures/items/hashes/rollout.json`.
- **Accept:** §5.1 (rollout): four numeric variants at levels 0-3 with ratio rules and pins; `sync-seconds` divides params × bytes by one seeded shard count S (the ranks the weights are split over, labelled synthetic) and its slip is rollout.unsliced (×S), never a TP·EP product; bench.checkpoint-engine.sync appears only as a cited comparison line, never as a pin; Gen.kcs = t6.rollout-bound-rl, t6.weight-sync; verify:generators passes at 1,000 seeds; chunk ≤ 8 KB gzip, printed.
- **Pool:** none: numeric variants only.

**3a-17 · K5 selectors: provenance weights, VRK30, cold-check summaries and competence statements; forms never reschedule cards [Opus first: approve the VRK30 definition on fixture ledgers] (spec §12.1-12.4)** M. Depends: 3a-01.
- **Files:** `src/lib/learner/provenance.ts`, `src/lib/learner/vrk.ts`, `src/lib/learner/competence.ts`, `src/lib/learner/cold-checks.ts`, `src/lib/learner/cards.ts`, `tests/learner/vrk.test.ts`, `tests/learner/competence.test.ts`, `tests/learner/cold-checks.test.ts`, `tests/learner/cards.test.ts`.
- **Accept:** §12.1-12.4: creditOf(provenance) is 1.0 for proved and unseen, 0.3 for lab-green, practice and assisted, and 0 for field and anything else (read time, never stored); selectVrk30(events, content, now) returns the retained KCs (the latest credited, unassisted check ≥ 30 days after the KC's card was created is right), the checked KCs, the share retained with its Wilson interval, and the count per active study-month; selectColdCheckSummary gives n, accuracy and Wilson intervals at ≥ 7 and ≥ 30 days, overall and by track; selectCompetence returns a KC's `can` line after ≥ 6 credited fresh items over ≥ 2 local days with ≥ 5 of the last 6 right; cards.ts ignores items with src 'form' (measurement never reschedules a card, W18); all pure with `now` a parameter; fixture ledgers cover every rule.

**3a-19 · Remaining P2, allocator and block-table explorer: t-double-free and the four t-blk tasks as outcome tasks, the superseded legacy ids retired (spec §13)** S-M. Depends: 3a-05b.
- **Files:** `src/components/sims/allocator.tasks.ts`, `src/components/sims/AllocatorSim.tsx`, `src/lib/sims/models/allocator.ts`, `src/components/sims/blockTableExplorer.tasks.ts`, `src/components/sims/BlockTableExplorer.tsx`, `src/data/lessons/t5/pagedattention-deep-dive.ts`, `tests/sims/allocator.test.ts`, `tests/sims/block-table.test.ts`, `tests/sims/registry.test.ts`, `tests/sims/kv.test.ts`, `public/lessons-md/*.md`.
- **Accept:** §13: alloc.double-free and blk.share, blk.cow, blk.preempt and blk.sweep are outcome tasks (numeric predict, an observe key the sim emits, a three-idea explain, a phone canonical where the model exists) that name the old ids in legacyId; t-frag, t-coalesce, t-paged, t-quiz and t-trace-lab leave the registry, the detection calls and the lab checklist, and old completions still show as 'you finished the old click-through'; t5.l5's exercise block lists the four blk ids (the pins at tests/sims/kv.test.ts:350 and tests/sims/registry.test.ts:78 move with them); verify:plays passes; exporter fresh. UI check (§17.2) on `/lab/allocator`, `/lab/kv-calc`, `/lesson/t5.l5`.
- **Pool:** none: sim and Fleet task predictions are numeric (Wave 1's rule for task predictions).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews the five tasks.

**3a-20 · Remaining P2, one registry (A): the inline task lists of MemoryGridSim and VmPagingSim move into tasks files (spec §13)** S. Depends: 3a-05b.
- **Files:** `src/components/sims/memoryGrid.tasks.ts`, `src/components/sims/latencyWalk.tasks.ts`, `src/components/sims/vmPaging.tasks.ts`, `src/components/sims/MemoryGridSim.tsx`, `src/components/sims/VmPagingSim.tsx`, `tests/sims/inline-registry-a.test.ts`.
- **Accept:** §13: the grid, latency and paging lists become legacy entries of tasks files that export HOME, keep their ids and render exactly as before; each HOME names the machine the component renders the list on (sim-memory's `grid` and `latency` machines; sim-vm's `paging` machine), so no other machine's forSim list grows and the existing tests/sims/registry.test.ts pins hold unchanged (3a-19 owns that file in this level); the components import them; a test proves every id of those lists resolves in the registry and no array literal of tasks remains in the two components. UI check (§17.2) on `/lab/memory-grid`, `/lab/paging`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3a-21 · Remaining P2, one registry (B): the inline task lists of QuantizerSim, WgslSim, BatchingSim and ToyEngineSim move into tasks files (spec §13)** S. Depends: 3a-05b.
- **Files:** `src/components/sims/quantizer.tasks.ts`, `src/components/sims/wgsl.tasks.ts`, `src/components/sims/batching.tasks.ts`, `src/components/sims/toyEngine.tasks.ts`, `src/components/sims/QuantizerSim.tsx`, `src/components/sims/WgslSim.tsx`, `src/components/sims/BatchingSim.tsx`, `src/components/sims/ToyEngineSim.tsx`, `tests/sims/inline-registry-b.test.ts`.
- **Accept:** As 3a-20 for the quant, wgsl, batching and engine lists (ToyEngineSim keeps spreading ENGINE_EXT_TASKS after its own); batching.tasks.ts exports HOME {simId: 'sim-batching', machine: 'batching'} (BatchingSim renders TASKS only in machine mode 'batching'), so forSim('sim-batching') with no machine stays [] (tests/sims/registry.test.ts:95, untouched; only its 'inline for now' comment goes stale) and the scheduler and context-switch lists do not grow; ToyEngineSim's list stays machine-less, like engineExt. UI check (§17.2) on `/lab/quantizer`, `/lab/wgsl`, `/lab/batching`, `/lab/engine`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3a-22 · Prove-it v2 for lab 02 and the template rules [Opus first: approve that each template is answerable by reading your own code, and that a plausible bug changes the answer] (spec §7.2)** S-M. Depends: 3a-11.
- **Files:** `src/data/forge/kv-block-manager/prove2.ts`, `src/data/forge/kv-block-manager/index.ts`, `tests/forge/prove2-lab02.test.ts`.
- **Accept:** §7.2: three lab 02 templates (free blocks after a seeded fork-and-append trace; the physical block a token translates to; how many blocks a forked sequence shares after one append) drive init, allocate, append, fork, free, translate and free_blocks; answers are numbers; every trace is ≤ 12 calls and shown in words; the bundle exposes prove2; for every template a fake correct module and a fake module with the template's named bug answer differently on some seed (so the question reads your code), and the answer is not given by the story alone (it differs across seeds); the rule this Opus check sets (answerable from your own code, never from the story alone) is the one labs 04, 06 and 07 apply (§7.2); tests pass.
- **Pool:** none: answers are numbers or ordered id lists, never options.

**Level 2**

**3a-18 · Remaining P2, roofline: the twelve legacy roofline tasks become outcome tasks, the sim reads the tiling model, T4 lessons point at them (spec §13)** M. Depends: 3a-13, 3a-05b.
- **Files:** `src/components/sims/roofline.tasks.ts`, `src/components/sims/RooflineSim.tsx`, `src/lib/sims/models/roofline.ts`, `src/data/lessons/t4/cpu-vs-gpu.ts`, `src/data/lessons/t4/gpu-memory.ts`, `src/data/lessons/t4/roofline.ts`, `src/data/lessons/t4/occupancy-coalescing.ts`, `tests/sims/roofline.test.ts`, `tests/sims/registry.test.ts`, `public/lessons-md/*.md`.
- **Accept:** §13: each of the twelve ids becomes an outcome task with a numeric predict spec, an observe key the sim emits on its bus, a three-idea explain and a phone canonical where the model exists, replacing the old id through legacyId; RooflineSim's synthetic SMEM curve (RooflineSim.tsx:286-294, which assumes 4-byte elements) reads smemBytes and ctasPerSm from src/lib/world/tiling.ts, and its FP8 ceiling stays 2 × BF16 dense, the same rule as the cube (§6.1), so the app shows one H100 FP8 ridge (590.4); the inline list at RooflineSim.tsx:1165-1176 goes; the t4.l1-t4.l4 exercise blocks list the new ids; verify:plays passes; exporter fresh. UI check (§17.2) on `/lab/roofline`, `/lesson/t4.l3`.
- **Pool:** none: sim and Fleet task predictions are numeric (Wave 1's rule for task predictions).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews the twelve tasks.

#### PR 3b: play, proof and the Mirror

**Level 0**

**3b-01 · The Tiling Cube in 2D: six prediction-opened levels, three linked face views, the DOM mirror, debrief, In-production card, registration (spec §6.3-6.4)** M-L. Depends: 3a-13, 3a-02, 3a-08.
- **Files:** `src/components/play/tiling-cube/Play.tsx`, `src/components/play/tiling-cube/session.ts`, `src/components/play/tiling-cube/Mirror2D.tsx`, `src/components/play/tiling-cube/Mirror.tsx`, `src/components/play/tiling-cube/Level.tsx`, `src/components/play/tiling-cube/Debrief.tsx`, `src/components/play/tiling-cube/ProductionCard.tsx`, `src/data/plays.ts`, `src/components/play/registry.ts`, `tests/plays/tiling-cube.test.ts`, `tests/plays/play.test.ts`, `e2e/tiling-cube.spec.ts`, `src/data/search-index.json`.
- **Accept:** §6.3-6.4: each level opens with a prediction on a fresh seed (level 1 from roofline/tile-ai, levels 2-6 from the tiling family; predict and item events with src 'play'), then the three face views and the DOM table update from stepper controls (no drag-only control, WCAG 2.5.7); each level's debrief shows the reference choice and the prediction's error in §6.3's wording (level 2 names the register cap: 448 fits SMEM but not the register file; level 5 says no lone tile reaches the FP8 ridge), and the closing debrief lists the six; the card has ≥ 3 rows of pinned claims, which may be lazy claims (the plays tests and verify-plays read src/data/claims/all.ts since 3a-05; src/data/plays.ts imports no lazy group); recordPlay {phase 'play', turns 6, survived = levels right, ghostSurvived 6, levels}; registered in plays.ts and the registry with lessonId t4.l6 and 25 minutes; verify:plays passes (mirror, debrief, card, band); e2e/tiling-cube.spec.ts plays level 1 to its debrief by keyboard alone at 360 px; closure printed (figure 200 KB). UI check (§17.2) on `/play/tiling-cube`. Carry-overs from 3a (D37): practice and the e2e walk use `CUBE_PRACTICE_SEED` (the cube's band rejects 200 of 300 sampled seeds); `waveAI` and `tileAt` throw a RangeError for a GEMM smaller than one tile and for a grouped raster whose group is not a whole number ≥ 1 (AF3), so the controls never offer those shapes, and a test drives every control to its limits without an uncaught error.
- **Pool:** none: the predictions are numeric tiling and roofline items.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3b-03 · Fleet exercise engine: an exercise job in the fleet worker, any prefill:decode split, the load-knee and pd-split exercises (spec §5.3)** M. Depends: 3a-03, 3a-08.
- **Files:** `src/lib/world/fleet-ex/index.ts`, `src/lib/world/fleet-ex/knee.ts`, `src/lib/world/fleet-ex/pd-split.ts`, `src/workers/fleet-protocol.ts`, `src/lib/fleet-host.ts`, `src/lib/fleet-session.ts`, `tests/world/fleet-ex.test.ts`, `tests/fleet/exercise-session.test.ts`.
- **Accept:** §5.3: job {kind: 'exercise', id, seed} calls FLEET_EXERCISES[id].sweep(seed) in the fleet worker and returns its SweepResult inside the 10 s job budget, dispatching by id only, so a later exercise adds a fleet-ex module and never edits fleet-protocol, fleet-host or fleet-session (§16.3); each point's goodputRps is SLO-met requests ÷ the trace's arrival window in seconds at the engine's 50 ms tick (never Engine.goodput()'s percentage), for knee and pd-split alike; EpdOpen and the host take {prefill, decode} worker counts (1 + 1 stays the default, so existing EPD runs are byte-identical and the EPD session result that tests/fleet/session.test.ts pins keeps its shape) and EpdCluster's aggregate adds TPOT p95, which only the exercise job reports; knee sweeps the load multiplier over six values and pd-split sweeps 1:7 … 7:1 on 8 workers; each exercise's truth, band (≥ 20 % acceptance, printed) and pass rule are pure and deterministic; FLEET_EXERCISES lists both, so the hands-on test sees them.

**3b-04 · Prove-it v2 in ForgeLab and the 30-day return card on Today (spec §7.4-7.5)** M. Depends: 3a-06, 3a-11, 3a-22.
- **Files:** `src/components/forge/ProveFromModule.tsx`, `src/components/learner/ProveReturnCard.tsx`, `src/lib/forge/prove-return.ts`, `tests/forge/prove-ui.test.ts`, `tests/learner/prove-return.test.ts`.
- **Accept:** §7.4-7.5: after an unseen-seed green of a lab whose bundle has prove2, 'Close your agent' draws a fresh seed, shows the trace in words, takes the prediction (keyboard, aria-live verdict), runs the calls on the module just graded and records the result through recordProve; a miss shows your module's actual reply and when the next credited attempt opens; ProveReturnCard offers one question 30 days after a lab's first prove event (a v2 question on a fresh seed when that lab's installed component is on the device, otherwise v1's follow-up item as a self-checked constructed response) and records it with data.return; the /today static closure does not grow (printed). UI check (§17.2) on `/forge/kv-block-manager`, `/today`. Carry-over from 3a (D37): the answer box reads through prove2's `readAnswer(text, kind)`, shows its message (aria-live) for an input that is not an answer, and accepts `none` for an empty id list (AF1).
- **Pool:** none: Prove-it answers are numbers, id lists or free text.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3b-05 · Receipts in Fleet Week: cite buttons, receipt chips, verification by re-run, the rubric self-review with scored exemplars; screenshot and keyword checks retired (spec §10)** M-L. Depends: 3a-12, 3a-01.
- **Files:** `src/pages/FleetWeek.tsx`, `src/lib/fleet-week.ts`, `src/components/fleetweek/ReceiptEditor.tsx`, `src/components/fleetweek/RubricReview.tsx`, `src/data/fleetweek/exemplars.ts`, `tests/fleet/receipts-act.test.ts`, `e2e/receipts.spec.ts`. Carry-over from 3a (D37): also `src/lib/fleet-receipts.ts` and `tests/fleet/receipts.test.ts`, for the scanner's units only.
- **Accept:** §10: every run of Acts I-III writes its record to fw:runs and each metric row offers 'cite'; the analysis shows receipt tokens as chips; 'Check my receipts' re-runs each record and marks each cited value verified or not; Acts I-II pass with the trace pass, ≥ 2 verified receipts and no uncited figure, and Act III with its executed SLO check and its $/Mtok as a verified receipt; gradeMeasurementSubmission (fleet-week.ts:446) and gradeAct3Doc (:614) no longer read keyword lists, word counts or a screenshot, and the file input is gone; the rubric step shows three scored exemplars per act and records the four self-scores in the act's data, never in its score; acts record their seed and provenance 'unseen'; Act I passes only when one of the learner's own components takes part and comes within 3 points of the reference (act1Verdict, fleet-week.ts:265-267, since 2b-21), and no passing module is ever committed, so tests/fleet/receipts-act.test.ts proves 'Acts I-II pass with the trace pass and ≥ 2 verified receipts' by feeding the grading a fixture passing trace result; e2e/receipts.spec.ts, by keyboard at 360 px, cites and checks receipts on an Act I run with the all-reference practice run (or a hand-assembled losing module), asserts they verify (a receipt check compares values and needs no pass), and passes Act III, which needs no module. UI check (§17.2) on `/week`. Carry-overs from 3a (D37): `uncitedFigures` also flags `tok/sec` and `req/sec` and no longer flags `10s` in '10s of ms' (rows added to the scanner's table test, AF6's positives and negatives unchanged); the rubric's four keys are the codec's `RUBRIC_KEYS` (D35).
- **Pool:** none: receipts and the rubric are not choice items.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews the nine exemplars and the rubric levels.

**3b-06 · The /me fold: Progress folds into lazy /me sections, /me routed with plain lazy and framer-motion only inside lazy sections, and /me gated (spec §12.5)** M. Depends: 3a-02.
- **Files:** `src/App.tsx`, `src/pages/Me.tsx`, `src/pages/Progress.tsx`, `src/pages/me/Journey.tsx`, `src/pages/me/DataOwnership.tsx`, `scripts/verify-bundle.ts`, `tests/shell/nav.test.ts`, `tests/economy/rings.test.ts`, `tests/learner/recommend.test.ts`, `tests/me/motion.test.ts`.
- **Accept:** §12.5: Progress.tsx is deleted and nothing imports it; its sections move to lazy /me sections (src/pages/me/Journey.tsx: the rings with their checklists, the KPI band, the track breakdown, achievements, your engine, Up Next and the history heatmap; src/pages/me/DataOwnership.tsx: export, import, reset, donate) and render as before, after a Me.tsx head that 3b-06b fills; no /me module imports src/data/lessons (Progress's one use, Progress.tsx:47 and :93, pulled a 394 KB gzip chunk; the lesson-task count is computed from the sim registry or dropped); /me is routed with plain `lazy` in src/App.tsx, never lazyMotion (lazyMotion loads src/lib/motion.tsx, which imports framer-motion, beside the page, and verify-bundle's closure never sees it), and each lazy section that uses framer-motion renders inside MotionScope (or loads through a section-level lazyMotion); the source pins on Progress move to Me.tsx or its sections (tests/economy/rings.test.ts:641, tests/learner/recommend.test.ts:603-608), and tests/shell/nav.test.ts:163-168's B26 list drops Me for a check that /me is plain lazy and its motion sections are scoped; tests/me/motion.test.ts mounts a lazy /me section with tests/dom/mini-dom.ts under a reduced-motion matchMedia and shows it honours reduced motion; verify:bundle gates /me at 200 KB (the flip of §2.2), printed. UI check (§17.2) on `/me`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3b-06b · The Mirror at /me: VRK30, cold checks, calibration and the optimism offset, competence statements, with intervals, and the FormsCard mount (spec §12.5)** M. Depends: 3b-06, 3a-17.
- **Files:** `src/pages/Me.tsx`, `src/pages/me/MirrorSummary.tsx`, `src/pages/me/ColdChecks.tsx`, `src/pages/me/Calibration.tsx`, `src/pages/me/Competence.tsx`, `src/components/me/FormsCard.tsx`, `tests/me/mirror.test.ts`, `e2e/me.spec.ts`. Carry-over from 3a (D34): also `src/lib/learner/competence.ts` and `tests/learner/competence.test.ts`.
- **Accept:** §12.5: /me shows, in order, VRK30 with the share retained and its Wilson interval, cold checks by track with intervals, calibration (Brier, reliability, sure-and-wrong) and the learned optimism offset with its n, competence statements, then the sections 3b-06 moved; every figure states n and shows 'not enough data' below its minimum; the new sections import no lesson content and keep framer-motion inside lazy, MotionScope-wrapped sections (3b-06's rule); FormsCard is a lazy stub mounted after competence; tests/me/mirror.test.ts checks every figure's n and interval on fixture ledgers and mounts the page with tests/dom/mini-dom.ts; /me stays under its 200 KB gate (printed); e2e/me.spec.ts reaches every control by Tab at 360 px. UI check (§17.2) on `/me`. Competence counts no form item (D34): a fixture ledger whose form items alone would meet the bar yields no 'can' line, and the same items with src `item` do.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3b-07 · Active isomorphisms: align by keyboard, name the break, then the principle; ledger items and the work-analogue slot (spec §11.1)** M. Depends: 3a-03, 3a-04, 3a-01.
- **Files:** `src/components/lesson/Isomorphism.tsx`, `src/lib/learner/iso.ts`, `tests/learner/iso.test.ts`, `tests/lesson/isomorphism.test.ts`, `e2e/isomorphism.spec.ts`.
- **Accept:** §11.1: a block with breakItem runs align (one row per OS element; the shuffled LLM labels are buttons; feedback per row is the pair's own lines), then the break item (choice with whys), then the principle and the pairs with their breaks; a block without breakItem renders as today; records `item:<lesson>.iso.<n>` (n from 1; score = base rows right ÷ base rows, ok = all base rows right) and `item:<lesson>.iso.<n>.break` with src 'lesson' and the block's KCs; a work row (shown only when profile:background matches, empty until 3c-05) gets its feedback but is never graded, so the score never depends on the background; reduced motion respected; e2e/isomorphism.spec.ts completes a fixture block by keyboard at 360 px. UI check (§17.2) on `/lesson/t2.l2`.
- **Pool:** iso (the break items; content arrives in 3b-16 and 3b-17).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3b-08 · The production-twin panel and the twins registry (spec §9)** S. Depends: 3a-06, 3a-08.
- **Files:** `src/components/forge/TwinPanel.tsx`, `src/data/twins/index.ts`, `src/data/twins/types.ts`, `tests/forge/twin.test.ts`.
- **Accept:** §9: once a lab is done, TwinPanel shows the upstream file at its pinned ref (link, the claim's verifiedAt, and 'stale since' past its 60-day TTL), the 'you just wrote …' line and three tracing questions played by ItemCard with whys, recorded as `item:lab<NN>.twin.<n>` (src 'practice'); a lab without a twin module renders nothing; tested with a fixture twin. UI check (§17.2) on `/forge/radix-cache`.
- **Pool:** twin (content arrives in 3b-15).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3b-09 · Lab 06's race against the reference and the bestiary: RING 0's 'within 3 points', W1's Code stage (spec §8.3)** M. Depends: 3a-06, 3a-01b, 3a-12.
- **Files:** `src/components/forge/RaceReference.tsx`, `src/lib/forge/race.ts`, `src/lib/world/bestiary.ts`, `src/workers/sim-protocol.ts`, `src/workers/sim.worker.ts`, `tests/forge/race.test.ts`, `tests/world/bestiary.test.ts`, and `src/lib/economy-table.ts` (one line: `RING0_RACE_LABS` gains `'batching-scheduler'`, D25).
- **Accept:** §8.3: after an unseen-seed green of batching-scheduler, 'Race the reference' runs Act I's job with only your scheduler on a graded entropy drawn now and records fleet-run mode 'engine' {scheduler from batching-scheduler, seeds 'fresh', goodput, refGoodput}; RING 0's lab 06 row (added by 3a-01b, inert until this task adds `'batching-scheduler'` to `RING0_RACE_LABS`, D25) turns green from labFleetOk; the bestiary job runs the twelve §8.3 policies (compileSchedPolicy) on the same entropy, and tests/world/bestiary.test.ts proves their goodputs pairwise distinct on ≥ 80 % of 30 banded Act I entropies (86.7 % measured on 2b) and that guard 2000 never fires within Act I (it equals guard 0), and the panel shows where your goodput falls as an SVG histogram with a SimMirror table; a link opens /fleet's real-engine panel with your scheduler; tested with a fake scheduler module. UI check (§17.2) on `/forge/batching-scheduler`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**Level 1**

**3b-02 · The EPLB play: replicate and place experts by hand, the hidden EPLB ghost, debrief, Compose, In-production card, registration (spec §5.2)** M-L. Depends: 3a-14, 3b-01, 3a-08.
- **Files:** `src/components/play/eplb/Play.tsx`, `src/components/play/eplb/session.ts`, `src/components/play/eplb/Board.tsx`, `src/components/play/eplb/Mirror.tsx`, `src/components/play/eplb/Debrief.tsx`, `src/components/play/eplb/Compose.tsx`, `src/components/play/eplb/ProductionCard.tsx`, `src/data/plays.ts`, `src/components/play/registry.ts`, `tests/plays/eplb.test.ts`, `tests/plays/play.test.ts`, `e2e/eplb.spec.ts`, `src/data/search-index.json`.
- **Accept:** §5.2: predict round-robin's imbalance first (numeric); GPUs are rows of slot buttons (≥ 44 px), the next copy is announced and Enter places it; the ghost stays hidden until the debrief; recordPlay with metric {name 'imbalance', mine, ghost, lowerIsBetter} for play and compose; the card's lazy claims (DeepSeek-V3, EPLB, engine flags) are checked through src/data/claims/all.ts, never by importing a lazy group into src/data/plays.ts; passes on the practice load and on 3 fresh loads within 0.05 of the ghost; registered with lessonId t6.l2 and 15 minutes; verify:plays passes; e2e/eplb.spec.ts plays the practice load to the debrief by keyboard alone at 360 px. UI check (§17.2) on `/play/eplb`.
- **Pool:** none: the prediction is numeric and the play has no choice items.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3b-10 · Lab 04 (mpmc-queue) on the forge layer with faded scaffolds: PRIMM, R0-R2 ladders, Prove-it v1 and prove2 (three templates over init, push and pop) (spec §8.2)** M. Depends: 3a-10, 3a-05b, 3a-04, 3a-22.
- **Files:** `src/data/forge/mpmc-queue/index.ts`, `src/data/forge/mpmc-queue/primm.ts`, `src/data/forge/mpmc-queue/ladder.ts`, `src/data/forge/mpmc-queue/prove.ts`, `src/data/forge/mpmc-queue/prove2.ts`, `tests/forge/mpmc-queue.test.ts`.
- **Accept:** §8.2: the bundle sets fade 'r2'; PRIMM has 2 predict, 3 investigate and 1 modify item around the run of §8.2's table for lab 04; R0-R2 for every required check (R2 names a function in that lab's lib.rs); six Prove-it v1 questions; prove2 per §7.2: this lab's required checks pin a correct module's behaviour, so each template is a tracing question about a correct module, and this lab's test file (where its fakes live) proves a fake correct module answers it and that the answer is not given by the story alone (it differs across seeds); `full-count` uses a capacity that is not a power of two, which queue.rs leaves to your design (round up or not), so it reads your own code; verify:mentor and verify:items pass, and `verify:items -- --subset 'forge/mpmc-queue '` selects this lab's PRIMM items (n printed; below 12 it reports, and the merged-level run decides); the implementer's stopwatch time to stage 1 is recorded in the PR (a field measure, not a gate). UI check (§17.2) on `/forge/mpmc-queue`.
- **Pool:** primm.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews every new item.

**3b-11 · Lab 05 (toy-executor) on the forge layer with faded scaffolds: PRIMM, R0-R2 ladders, Prove-it v1 with no prove2 (its bridge answers probe only, §7.2) (spec §8.2)** M. Depends: 3a-10, 3a-05b, 3a-04.
- **Files:** `src/data/forge/toy-executor/index.ts`, `src/data/forge/toy-executor/primm.ts`, `src/data/forge/toy-executor/ladder.ts`, `src/data/forge/toy-executor/prove.ts`, `tests/forge/toy-executor.test.ts`.
- **Accept:** §8.2: the bundle sets fade 'r2'; PRIMM has 2 predict, 3 investigate and 1 modify item around the run of §8.2's table for lab 05; R0-R2 for every required check (R2 names a function in that lab's lib.rs); six Prove-it v1 questions; the reference run is a sequence of frames, as tests/forge/registry.test.ts:89 requires more than one: one frame per poll round of the committed seed-7 probe reply; verify:mentor and verify:items pass, and `verify:items -- --subset 'forge/toy-executor '` selects this lab's PRIMM items (n printed; below 12 it reports, and the merged-level run decides); the implementer's stopwatch time to stage 1 is recorded in the PR (a field measure, not a gate). UI check (§17.2) on `/forge/toy-executor`.
- **Pool:** primm.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews every new item.

**3b-12 · Lab 06 (batching-scheduler) on the forge layer with faded scaffolds: PRIMM, R0-R2 ladders, Prove-it v1 and prove2 (which waiting requests your schedule admits, in order) (spec §8.2)** M. Depends: 3a-10, 3a-05b, 3a-04, 3a-22.
- **Files:** `src/data/forge/batching-scheduler/index.ts`, `src/data/forge/batching-scheduler/primm.ts`, `src/data/forge/batching-scheduler/ladder.ts`, `src/data/forge/batching-scheduler/prove.ts`, `src/data/forge/batching-scheduler/prove2.ts`, `tests/forge/batching-scheduler.test.ts`.
- **Accept:** §8.2: the bundle sets fade 'r2'; PRIMM has 2 predict, 3 investigate and 1 modify item around the run of §8.2's table for lab 06; R0-R2 for every required check (R2 names a function in that lab's lib.rs); six Prove-it v1 questions; prove2 per §7.2, with a fake correct module and a fake module with each template’s named bug answering differently (fakes live in this test file); verify:mentor and verify:items pass, and `verify:items -- --subset 'forge/batching-scheduler '` selects this lab's PRIMM items (n printed; below 12 it reports, and the merged-level run decides); the implementer's stopwatch time to stage 1 is recorded in the PR (a field measure, not a gate). UI check (§17.2) on `/forge/batching-scheduler`.
- **Pool:** primm.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews every new item.

**3b-13 · Lab 07 (radix-cache) on the forge layer with faded scaffolds: PRIMM, R0-R2 ladders, Prove-it v1 and prove2 (two templates: match lengths after seeded inserts), with a JS radix reference for the run (spec §8.2)** M. Depends: 3a-10, 3a-05b, 3a-04, 3a-22.
- **Files:** `src/data/forge/radix-cache/index.ts`, `src/data/forge/radix-cache/primm.ts`, `src/data/forge/radix-cache/ladder.ts`, `src/data/forge/radix-cache/prove.ts`, `src/data/forge/radix-cache/prove2.ts`, `tests/forge/radix-cache.test.ts`, `src/lib/world/radix.ts`, `tests/world/radix.test.ts`.
- **Accept:** §8.2: the bundle sets fade 'r2'; PRIMM has 2 predict, 3 investigate and 1 modify item around the run of §8.2's table for lab 07; R0-R2 for every required check (R2 names a function in that lab's lib.rs); six Prove-it v1 questions; prove2 per §7.2: this lab's required checks pin a correct module's behaviour, so each template is a tracing question about a correct module, and this lab's test file (where its fakes live) proves a fake correct module answers it and that the answer is not given by the story alone (it differs across seeds); no `match-cold` template (every eligible module replies 0); verify:mentor and verify:items pass, and `verify:items -- --subset 'forge/radix-cache '` selects this lab's PRIMM items (n printed; below 12 it reports, and the merged-level run decides); the implementer's stopwatch time to stage 1 is recorded in the PR (a field measure, not a gate). UI check (§17.2) on `/forge/radix-cache`.
- **Pool:** primm.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews every new item.

**3b-14 · Lab 08 (xgrammar-lite) on the forge layer with faded scaffolds: PRIMM, R0-R2 ladders, Prove-it v1 with no prove2 (its bridge answers probe only, §7.2) (spec §8.2)** M. Depends: 3a-10, 3a-05b, 3a-04.
- **Files:** `src/data/forge/xgrammar-lite/index.ts`, `src/data/forge/xgrammar-lite/primm.ts`, `src/data/forge/xgrammar-lite/ladder.ts`, `src/data/forge/xgrammar-lite/prove.ts`, `tests/forge/xgrammar-lite.test.ts`.
- **Accept:** §8.2: the bundle sets fade 'r2'; PRIMM has 2 predict, 3 investigate and 1 modify item around the run of §8.2's table for lab 08; R0-R2 for every required check (R2 names a function in that lab's lib.rs); six Prove-it v1 questions; the reference run is a sequence of frames, as tests/forge/registry.test.ts:89 requires more than one: one frame per grammar step of the committed seed-7 probe reply, with the legal tokens at that step; verify:mentor and verify:items pass, and `verify:items -- --subset 'forge/xgrammar-lite '` selects this lab's PRIMM items (n printed; below 12 it reports, and the merged-level run decides); the implementer's stopwatch time to stage 1 is recorded in the PR (a field measure, not a gate). UI check (§17.2) on `/forge/xgrammar-lite`.
- **Pool:** primm.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews every new item.

**3b-15 · Twin content: lab 07 against SGLang's Rust TreeCore and lab 06 against vLLM's scheduler at pinned refs (spec §9)** S-M. Depends: 3b-08, 3a-04.
- **Files:** `src/data/twins/radix-cache.ts`, `src/data/twins/batching-scheduler.ts`, `src/data/twins/index.ts`, `tests/forge/twins-content.test.ts`.
- **Accept:** §9: each twin names the file and symbols at the pinned ref of its claim and three tracing questions with a why per option and KCs from its lab's checks; the lab 06 twin ships only if the pinned vLLM file supports three such questions (otherwise the PR says so and lab 07 ships alone, which still meets the plan's line); `verify:items -- --subset item:lab07.twin.,item:lab06.twin.` selects the twin items (n printed; below 12 it reports, and the merged-level run decides); verify:items passes.
- **Pool:** twin.
- **Owner step (not build acceptance):** The owner reviews the questions against the pinned files.

**3b-16 · P3 content, T0-T2: break items and principles for the ten panels that already have breaks (spec §11.2)** M. Depends: 3b-07, 3a-04.
- **Files:** `src/data/lessons/t0/why-systems.ts`, `src/data/lessons/t0/your-runtime.ts`, `src/data/lessons/t1/pointers.ts`, `src/data/lessons/t1/toy-allocator.ts`, `src/data/lessons/t1/rust-ownership-intro.ts`, `src/data/lessons/t2/processes-threads.ts`, `src/data/lessons/t2/virtual-memory.ts`, `src/data/lessons/t2/swapping-eviction.ts`, `src/data/lessons/t2/scheduling.ts`, `src/data/lessons/t2/exam-pagedattention.ts`, `public/lessons-md/*.md`.
- **Accept:** §11.2: each panel gets a principle (≤ 40 words), its lesson's KCs and a break item (one true break from the pairs, three statements that hold on both sides, a why per option); on t2.l2 (virtual-memory.ts) and t2.l7 (exam-pagedattention.ts), quiz lures on t2.address-translation whose misconception is taking it for t5.block-tables or t5.prefix-cache-keys carry the miss id `confuse.<that KC>` (retagged where such a lure exists, added otherwise; §15.1); existing pairs, titles and hooks unchanged; verify:items passes and `verify:items -- --subset '/^item:t[0-2]\.l[0-9]+\.iso\./'` reports the T0-T2 iso refs (n printed; the merged-level run decides); exporter fresh.
- **Pool:** iso.
- **Owner step (not build acceptance):** The owner reviews every new item.

**3b-17 · P3 content, T3-T7: breaks for the 23 pairs that have none, break items and principles for the eight panels (spec §11.2)** M. Depends: 3b-07, 3a-04.
- **Files:** `src/data/lessons/t3/dynamo-case-study.ts`, `src/data/lessons/t5/prefix-caching.ts`, `src/data/lessons/t5/distributed-serving.ts`, `src/data/lessons/t6/moe-anatomy.ts`, `src/data/lessons/t6/epd-disaggregation.ts`, `src/data/lessons/t6/multi-lora-serving.ts`, `src/data/lessons/t6/security-boundaries.ts`, `src/data/lessons/t7/autoscaling-planner.ts`, `src/data/lessons/t5/pagedattention-deep-dive.ts`, `public/lessons-md/*.md`.
- **Accept:** As 3b-16 for the eight T3-T7 panels, plus a `breaks` line for each of their 23 pairs; the `confuse.<KC>` lures of §15.1 on t5.prefix-cache-keys items (t5.l6, prefix-caching.ts) and on t5.block-tables items (t5.l5, pagedattention-deep-dive.ts, touched for those lures only); verify:items passes and `verify:items -- --subset '/^item:t[3-7]\.l[0-9]+\.iso\./'` reports the T3-T7 iso refs (n printed; the merged-level run decides).
- **Pool:** iso.
- **Owner step (not build acceptance):** The owner reviews every new break and item.

**3b-18 · W7 in t4.l6: the play block, and one raster-order quiz item (spec §6.5)** S. Depends: 3b-01.
- **Files:** `src/data/lessons/t4/matmul-tiling.ts`, `public/lessons-md/*.md`.
- **Accept:** §6.5: a play block {playId: 'tiling-cube'} after the tiling prose (Up Next and the paths pick it up from PLAYS); one quiz item on raster order (t4.raster-l2-reuse) with a why per option joins the checkpoint; titles and hooks unchanged; verify:kc and verify:items pass; exporter fresh. UI check (§17.2) on `/lesson/t4.l6`. Carry-over from 3a-09 (D37): t4.l6 teaches raster order before its quiz asks it: a short H2 section on raster order and L2 reuse (grouped launch order, as Triton's `GROUP_SIZE_M` does) joins the tiling prose, so the regenerated search index gives `t4.raster-l2-reuse` a non-empty anchor (`kcAnchor`, build-search-index.ts); the task's notes name the anchor.
- **Pool:** lessons.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews the new item.

**3b-19 · K5 track forms A/B/C: parallel 12-item forms on unseen seeds, counterbalanced, opt-in, measurement only [cut 4th] (spec §12.6)** M. Depends: 3b-06b, 3a-13, 3a-15, 3a-16.
- **Files:** `src/lib/learner/forms.ts`, `src/components/me/FormsCard.tsx`, `src/lib/learner/experiments.ts`, `tests/learner/forms.test.ts`, `tests/mentor/experiments.test.ts`.
- **Accept:** §12.6: formsFor(track) returns 12 slots over ≥ 3 KCs from loaded families at level 2, or null; it runs its draws inside settle() (src/lib/items/on-demand.ts) when the card opens, as Today's start flow does, because the compile family's make throws NotReady until its bank group loads (Bun loads every group up front, so only a test that withholds a group sees it), and draws each slot with drawOnKc(kc, seed, (s) => gen.make(s, 2, variant)) (src/lib/learner/on-kc.ts), so every slot carries its KC; tests/learner/forms.test.ts withholds one compile group, runs formsFor under settle with the group loaded on demand and gets the fully loaded result, and shows every slot's instance carries its slot's KC; three disjoint seed sets per track from the learner's exp:seed; the set-to-form order is one of 6 permutations from armOf('forms', track, expSeed, 6) (armFor generalised to n arms, the hint-ladder arms unchanged); A, B and C open by §12.6's timing and never gate; items record src 'form' with {formId, track, formSlot, formSet} (never data.form or data.slot, §3.2); the card shows k/12 with Wilson intervals, B − A labelled 'including the pretest effect' and C beside B; deterministic per seed. UI check (§17.2) on `/me`.
- **Pool:** generator (forms serve family items).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3b-20 · The Fleet exercise panel: predict, run on a fresh seed, explain, three passes, In-production rows [cut 2nd] (spec §5.3)** M. Depends: 3b-03.
- **Files:** `src/components/fleet-ex/FleetExercise.tsx`, `src/components/fleet-ex/session.ts`, `src/components/fleet-ex/SweepChart.tsx`, `src/components/fleet-ex/ProductionRows.tsx`, `tests/fleet-ex/panel.test.ts`.
- **Accept:** §5.3: a numeric prediction before the first run; the sweep runs in the fleet worker on freshSeed() and shows an SVG chart with a SimMirror table; the explain step (≥ 8 words, three ideas ticked, no text stored); done after 3 right predictions on distinct fresh seeds, restored from events after a reload; records predict and item events `item:fleet.<id>` with src 'lesson', the block's grp and provenance 'unseen'; rows of pinned claims; phone mode shows the canonical outcome. Mounted only by fleet blocks, so its route check runs in 3c-06.
- **Pool:** none: sim and Fleet task predictions are numeric (Wave 1's rule for task predictions).

**Level 2**

**3b-21 · W5 in the lessons: the EPLB play in t6.l2, prefill items in t6.l3 and t6.l10, rollout items in t6.l7 (spec §5.4)** M. Depends: 3b-02, 3a-15, 3a-16, 3b-17.
- **Files:** `src/data/lessons/t6/wide-ep.ts`, `src/data/lessons/t6/epd-disaggregation.ts`, `src/data/lessons/t6/rl-rollout.ts`, `src/data/lessons/t6/security-boundaries.ts`, `public/lessons-md/*.md`.
- **Accept:** §5.4: a play block {playId: 'eplb'} after t6.l2's EPLB section; item blocks before each quiz: t6.l3 prefill/{pd-ratio, transfer-ms}, t6.l7 rollout/{rollout-share, long-tail}, t6.l10 prefill/{hit-gap, namespace-cost}; each block's variant KCs intersect its lesson's Lesson.kcs; titles and hooks unchanged; the hands-on test prints 15 of 15; verify:kc and verify:items pass; exporter fresh. UI check (§17.2) on `/lesson/t6.l2`, `/lesson/t6.l7`, `/lesson/t6.l10`.
- **Pool:** none: item blocks serve numeric family variants.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

#### PR 3c: measure, gate and decide

**Level 0**

**3c-01 · Exit gates: 15/15 hands-on, `proved` on four labs, no credit without a prediction, receipts (spec §18.1)** S-M. Depends: 3b-21, 3a-22, 3b-10, 3b-12, 3b-13, 3a-18, 3a-19, 3a-20, 3a-21, 3b-05.
- **Files:** `tests/kc/hands-on.test.ts`, `tests/forge/proved-labs.test.ts`, `tests/sims/no-credit.test.ts`, `tests/fleet/receipts-exit.test.ts`.
- **Accept:** §18.1: the hands-on gate requires all 15 T6/T7 lessons by id (t6.l1-t6.l10, t7.l1-t7.l5); proved-labs drives recordProve through prove2 for labs 02, 04, 06 and 07 with fake modules and requires `proved` after an unseen green and a right answer, and none after a miss, a v1 answer, a reference build or a module graded on practice seeds; no-credit proves every registered task lives in exactly one tasks file, no sim component holds an inline task array, every `taskIds` entry of a lesson exercise block resolves to an outcome task (link-card blocks, which have no `taskIds`, are exempt and earn nothing), and a legacy completion earns 0 XP and resolves to no KC (so it feeds no card, ring or VRK30); receipts-exit replays a fixture Act I (with a fixture passing trace result, since no passing module is committed) and Act III through the real grading, passes the verified receipts and fails a tampered receipt. A task's `legacyId` may be a string or a list (D29).

**3c-02 · The a11y sweep and reflow list for Wave 3 surfaces (spec §17.2)** S. Depends: 3b-01, 3b-02, 3b-06b, 3b-21.
- **Files:** `scripts/a11y.mjs`, `e2e/smoke.spec.ts`, `.github/workflows/nightly.yml`.
- **Accept:** §17.2: a11y's default routes keep /me (3a-02) and /week (already listed) and add /play/tiling-cube, /play/eplb, /lesson/t6.l3, /lesson/t2.l2 and /forge/batching-scheduler; the smoke spec's reflow list adds /me and /lesson/t4.l6 at 360 and 320 px; nightly's comment states the three widths; `npm run a11y` over the default routes reports 0 serious or critical violations and no sideways scroll. Carry-over from 3b (D48): the 3b review measured every route this task adds at 0 violations and no sideways scroll at 360, 320 and 1280 px; a regression since then is this task's to fix.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3c-03 · Partners v3: Wave 3 selectors, the donation whitelist, the field-gate table and the journey re-cut table (spec §15)** M. Depends: 3a-17, 3b-19, 3b-05.
- **Files:** `src/lib/learner/outcomes.ts`, `src/lib/learner/redact.ts`, `scripts/partner-report.ts`, `tests/learner/outcomes.test.ts`, `tests/learner/redact.test.ts`, `docs/prereg/fleet-daily.md`.
- **Accept:** §15: the §15.1 selectors on fixture ledgers; selectDiscrimination30 counts a miss as confusion only when its id is `confuse.<one of the other two KCs>`, reports 'not enough data' (never 0) when the content holds no such lure, and a test holds that each of the three KCs has ≥ 2 such lures in the lesson content (3b-16, 3b-17); selectFormsGain groups by track from the kept `kcs` (the KC id's track prefix); selectPlacementLanding keeps its Wave 2 fix (25e4b8a: the first lesson-ref event after the placement) and its tests stay green; the donation keeps sinceDays, formId, formSet, formSlot, levels, metric, receipts, rubric, `confuse.*` miss ids and the prove fields of §15.2, keeps `value` and `truth` only on events whose provenance is not `field`, and still drops every other miss id (the 'kv.priced-fp16' assertion in redact.test.ts stands), seeds, hashes, free text, background and calendar dates (tests, including a field item whose value and truth are dropped); docs/prereg/fleet-daily.md drafts the Daily's keep-or-kill rule (PLAN §9; minimum n, the comparison, the underpowered default) for the owner to sign before selectDailyVsOther is read; the report prints gates F1-F12 of §18.2 with n, Wilson or bootstrap intervals and partners, 'not enough data' below each minimum, and the surface-minutes table for the journey re-cut.

**3c-04 · S4: apply the watcher decision rule; build the weekly digest only on `keep` [Opus first: apply the rule to the signed pre-registration and the report] (spec §14)** S-M. Depends: this spec.
- **Files:** `scripts/landscape/digest.ts`, `.github/workflows/landscape-watch.yml`, `TRIAGE.md`, `tests/landscape/digest.test.ts`.
- **Accept:** §14: if docs/prereg/watcher.md is signed and docs/backtest/report.json says `keep`, digest.ts fetches releases since the last digest (fetch.ts), matches them with the frozen match.ts and writes one 'Landscape digest YYYY-WW' issue body with candidate lessons and claims and the claims expiring within 14 days; the weekly workflow opens or updates that issue with GITHUB_TOKEN only and never commits; TRIAGE.md is the local triage prompt (OD2); digest.ts is tested on the frozen snapshot. Otherwise the task ships no code and the PR records the outcome (`drop`; `underpowered`, which repeats the backtest on a second 8-week window before the Wave 3 decision, watcher.md:50; or 'not decided: manual scan stays').
- **Owner step (not build acceptance):** Signing docs/prereg/watcher.md and the independent rating (docs/backtest/ratings.json) are the owner's; a fresh rater agent may be launched only by the owner or the orchestrator, given only snapshot.json and `match.ts --lessons`, never by this task's implementer, who reads candidates.json; score.ts then writes report.json.

**3c-05 · P3 work analogues by background: the optional background pick in Boot and /me, four work pairs [cut 3rd] (spec §11.3)** S-M. Depends: 3b-07, 3b-16, 3b-17, 3b-06b.
- **Files:** `src/pages/boot/You.tsx`, `src/pages/Me.tsx`, `src/pages/me/Background.tsx`, `src/components/lesson/Isomorphism.tsx`, `src/data/lessons/t2/exam-pagedattention.ts`, `src/data/lessons/t1/toy-allocator.ts`, `src/data/lessons/t2/scheduling.ts`, `src/data/lessons/t5/prefix-caching.ts`, `tests/lesson/work-analogue.test.ts`, `public/lessons-md/*.md`.
- **Accept:** §11.3: You.tsx and /me offer the optional pick that writes profile:background; the four work pairs of §11.3 land on their panels, each with its own break; a panel shows the pair for a matching background and nothing otherwise; the work row's feedback is shown and never graded (§11.1), and a test proves two ledgers that differ only in profile:background, with the same answers on the base rows, give identical redacted donations; /boot grows ≤ 1 KB gzip (printed; gate 200); /me stays under its gate. UI check (§17.2) on `/boot`, `/me`, `/lesson/t2.l4`. Carry-over from 3b (D48): before adding a lesson choice item, read verify:items' length-cue margins (after 3b the Wave 2 bar's middle-length strategy sits at 1.81 of 2 and the gated tracks' aggregate at 1.93 of 2) and keep every one under its limit.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews the four work pairs.

**3c-06 · Fleet exercise blocks: the load knee in t7.l2 and the P:D split in t6.l3 [cut 2nd] (spec §5.3)** S. Depends: 3b-20, 3b-21.
- **Files:** `src/data/lessons/t7/benchmarking.ts`, `src/data/lessons/t6/epd-disaggregation.ts`, `e2e/fleet-exercise.spec.ts`, `public/lessons-md/*.md`. Files gain `src/components/fleet-ex/session.ts`, `src/components/fleet-ex/FleetExercise.tsx` and `tests/fleet-ex/panel.test.ts` (D48).
- **Accept:** §5.3: an exercise block {fleet: 'knee'} in t7.l2 and {fleet: 'pd-split'} in t6.l3, before each quiz; e2e/fleet-exercise.spec.ts predicts, runs and explains the knee by keyboard at 360 px; exporter fresh. UI check (§17.2) on `/lesson/t7.l2`, `/lesson/t6.l3`. Carry-over from 3b (D39, D48): the panel records a round's `predict` event at the lock, and a locked round with no saved `item` counts as a miss when the panel restores, so a reload or a navigation away cannot erase a miss from the run of rights; test both.
- **Pool:** none: sim and Fleet task predictions are numeric (Wave 1's rule for task predictions).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

#### PR 3s: stretch, in the plan's order

**Level 0**

**3s-01 · Stretch 1a, the Cube in 3D: View3D and Cube3D on the three and R3F already in package.json, opt-in after the 2D view, budgets (spec §16.1)** M. Depends: 3b-01.
- **Files:** `src/components/three/View3D.tsx`, `src/components/play/tiling-cube/Cube3D.tsx`, `src/components/play/tiling-cube/Play.tsx`, `scripts/verify-bundle.ts`, `tests/plays/view3d.test.ts`, `tests/boot/imports.test.ts`.
- **Accept:** §16.1: View3D and Cube3D ship dark: View3D renders only for ids in GATE_3D and only when its `available` prop is true, which nothing sets until 3s-02 wires the arm (armOf('cube-view', …)), so no learner sees 'Show it in 3D' before then (a test proves the entry is absent by default) (**D66:** the play sets it on every level, as a plain opt-in with no arm); when shown, the 2D view comes first and the scene opens on request; Cube3D uses InstancedMesh, frameloop 'demand', DPR ≤ 1.5, no drei, ≤ 100 draw calls, and falls back to 2D without WebGL2; verify-bundle reports the three + R3F chunk against 240 KB and fails the scene chunk above 40 KB; a static-import walk proves /today, /boot, /me and /play/tiling-cube never load three; verify:plays passes. UI check (§17.2) on `/play/tiling-cube`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3s-03 · Stretch 2, t6.l12 attention-FFN disaggregation (Step-3, MegaScale-Infer), placed before the t6.l10 spiral (spec §16.2)** M. Depends: 3b-21.
- **Files:** `src/data/lessons/t6/attention-ffn.ts`, `src/data/lessons/index.ts`, `src/data/kc/t6.ts`, `src/data/kc/ids.ts`, `src/data/claims/lazy/serving3.ts`, `tests/items/verify-items.test.ts`, `tests/kc/scope.test.ts`, `tests/kc/graph.test.ts`, `tests/mentor/packet.test.ts`, `tests/learner/recommend.test.ts`, `tests/economy/xp.test.ts`, `src/lib/tracks.ts`, `public/lessons-md/*.md`, `public/llms.txt`, `public/claims.json`, `src/data/search-index.json`.
- **Accept:** §16.2: the lesson (between t6.l9 and t6.l10 in reading order) with Lesson.kcs (one new KC), a statline of pinned benchmark claims, an isomorphism with breaks and a break item, a 4-item quiz with whys, a ticket and an item block (prefill/pd-ratio); the 68-lesson pins become 69 (tests/items/verify-items.test.ts:186, tests/kc/scope.test.ts:29, tests/mentor/packet.test.ts:87, tests/learner/recommend.test.ts:191), and so does the ticket XP pin (tests/economy/xp.test.ts:308 becomes 69 * 3 + 6 * 5, or is derived from the lesson count); the T3-T7 pins (tests/kc/graph.test.ts:105, tests/kc/scope.test.ts:33) become 40; TICKETED (scope.test.ts:31) becomes 59; PREDICTED (scope.test.ts:34, T0, T1, T4 and T5 only) stays 29; t6.l12 has at least two KCs its Lesson.kcs may name (graph.test.ts:102-110): the new KC and an existing T6 KC whose lessons list gains t6.l12; T6's lesson count in src/lib/tracks.ts (10 → 11, which TrackCard's 'done' reads); verify:kc, verify:items and verify:claims pass; exporter and llms.txt fresh. UI check (§17.2) on `/lesson/t6.l12`.
- **Pool:** lessons, iso.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews the lesson and its claims.

**3s-04 · Stretch 3a, more W5 exercises: the broken-benchmark detective (t7.l2) and speculation push-your-luck (t6.l6) (spec §16.3)** M. Depends: 3c-06.
- **Files:** `src/lib/world/fleet-ex/broken-bench.ts`, `src/lib/world/fleet-ex/push-luck.ts`, `src/lib/world/fleet-ex/index.ts`, `src/data/lessons/t7/benchmarking.ts`, `src/data/lessons/t6/speculative-production.ts`, `tests/world/fleet-ex-more-a.test.ts`, `public/lessons-md/*.md`.
- **Accept:** §16.3: each exercise is one fleet-ex module whose `sweep(seed)` the existing exercise job calls, so no worker, host or session file changes; broken-bench seeds one of the benchmark flaws the Fleet engine can express into a Fleet run (a flaw it cannot express is left out and the PR says which) and asks for the p95 TTFT the benchmark should have reported (numeric, graded against the corrected run); push-luck is model-only (the Fleet engine has no speculation, D7): it seeds an acceptance rate α and a draft-to-target cost ratio c and asks for the draft length γ, among the sweep's points, that maximises the speedup (1 − α^(γ+1)) ÷ ((1 − α)(γc + 1)), with powers as repeated products; both pure, banded and deterministic, registered and placed as fleet blocks; verify:determinism passes. UI check (§17.2) on `/lesson/t7.l2`, `/lesson/t6.l6`.
- **Pool:** none: sim and Fleet task predictions are numeric (Wave 1's rule for task predictions).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3s-07 · Stretch 5, two field labs: decode and KV-full concurrency after t5.l4, the BurstGPT replay after t5.l7 (spec §16.5)** M. Depends: this spec.
- **Files:** `src/data/field-labs/decode-kv.ts`, `src/data/field-labs/burstgpt-replay.ts`, `src/components/forge/FieldLabs.tsx`, `src/pages/Forge.tsx`, `src/data/claims/lazy/field.ts`, `src/data/claims/all.ts`, `tests/forge/field-labs.test.ts`, `public/claims.json`.
- **Accept:** §16.5: each lab shows its pinned commands (claims with pin), the prediction from your Boot or roofline numbers and the [derived] cost at the H100 price claim (≤ 1.5 GPU-hours); entered measurements record `item:field.<lab>.<metric>` with src 'practice' and provenance 'field' (§3.2), whose value and truth a donation drops (§15.2); nothing else leaves the device. UI check (§17.2) on `/forge`. Carry-over from 3b (D48): a choice item added to a lab pool must not raise the PRIMM pool's worst strategy (39.3 % against its 40.0 % limit after 3b).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner signs off the pinned commands, and the owner or a partner runs each pinned command once on a GPU, with its output recorded in the PR; agents cannot run them.

**3s-08 · Stretch 6, the On-Call pilot: a three-incident shift mode of the Daily and a think-aloud protocol (spec §16.6)** S. Depends: w2:2b-21.
- **Files:** `docs/oncall/pilot.md`, `src/pages/Daily.tsx`, `src/lib/world/shift.ts`, `tests/world/shift.test.ts`.
- **Accept:** §16.6: /daily?shift=3 chains three drill-namespace incidents from one seed with a handoff note between them (never stored) and records each as practice; the protocol covers consent, script and what the owner writes down, and says the session notes stay private to the owner (only a de-identified summary feeds the Wave 4 gate); deterministic. UI check (§17.2) on `/daily`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner runs the think-aloud sessions and keeps the notes.

**3s-11 · Stretch 9a, the protégé block: type, renderer, pool and pre-registration (spec §16.9)** M. Depends: this spec.
- **Files:** `src/data/lessons/types.ts`, `src/components/blocks/ProtegeBlock.tsx`, `src/pages/lesson/blocks.tsx`, `scripts/item-pools.ts`, `scripts/verify-items.ts`, `scripts/export-lessons-md.ts`, `tests/lesson/protege.test.ts`, `docs/prereg/protege.md`.
- **Accept:** §16.9: a `protege` block (the plan's fourth new block type) shows 4-6 sentences with one false; find, tag and fix are choice items with whys in a new `protege` pool; the false line is shown struck through once found; a fixture lesson passes verify:items; the pre-registration fixes the within-learner comparison. Carry-over from 3b (D48): before adding a lesson choice item, read verify:items' length-cue margins (after 3b the Wave 2 bar's middle-length strategy sits at 1.81 of 2 and the gated tracks' aggregate at 1.93 of 2) and keep every one under its limit.
- **Pool:** protege.
- **Owner step (not build acceptance):** The owner signs docs/prereg/protege.md. **D67:** the owner chose to leave it unsigned (2026-10-15).

**3s-13 · Stretch 10, the T0/T4 measured-versus-predicted real-engine run (Wi-Fi and consent) (spec §16.10)** S. Depends: this spec.
- **Files:** `src/pages/fleet/RealEnginePanel.tsx`, `src/lib/real-engine.ts`, `src/components/engine/MeasuredRun.tsx`, `tests/engine/measured-run.test.ts`.
- **Accept:** §16.10: after consent for the ~400 MB download, the learner predicts decode tok/s for Qwen3-0.6B q4 on this device from its bytes and a bandwidth they choose, runs the real engine and sees measured against predicted; recorded as `predict` and `item` on `item:engine.measured-tps` with src 'practice' and provenance 'field' (§3.2); labelled 'your device, not an H100'; build acceptance covers the prediction UI, the comparison and the recording, tested with a stubbed measurement. UI check (§17.2) on `/fleet`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** One device run on a laptop and one on a phone, with predicted and measured values recorded in the PR; agents cannot satisfy the device run.

**Level 1**

**3s-02 · Stretch 1b, the 3D evaluation: pre-registration, levels × view counterbalanced, the opt-in spatial proxy, the selector (spec §16.1)** M. Depends: 3s-01, 3c-03.
- **Files:** `docs/prereg/tiling-cube-3d.md`, `src/components/play/tiling-cube/Play.tsx`, `src/components/play/tiling-cube/SpatialProxy.tsx`, `src/lib/learner/outcomes.ts`, `tests/plays/cube-eval.test.ts`.
- **Accept:** §16.1 (**D66:** built and dormant behind `CUBE_VIEW_STUDY`, false while the draft is unsigned, so no split, no recorded view and no proxy): this task turns the 3D entry on: each learner's six levels split 3 + 3 between '2D only' and '3D available' by armOf('cube-view', level, expSeed, 2); the play records each level's view in PlayData.levels; the 2-item spatial proxy is opt-in, has no choice items (a cube count, numeric, and a view ordering, an ordered id list) and records `item:cube.spatial.<n>` with src 'practice' and no KC; selectCubeByView compares 30-day fresh-item error by view; the pre-registration sets the non-inferiority margin and the default (3D stays opt-in).
- **Pool:** none: the spatial proxy is a numeric count and an ordering, never options.
- **Owner step (not build acceptance):** The owner signs docs/prereg/tiling-cube-3d.md before this task merges; 3s-01 and 3s-02 are cut or kept together (§19.3). **D66:** the owner chose a plain opt-in with no study (2026-10-15), so this task merges with the study dormant and the draft unsigned.

**3s-05 · Stretch 3b, more W5 exercises: the rollout straggler (t6.l7) and the prefix-cache timing oracle (t6.l10) (spec §16.3)** M. Depends: 3s-04.
- **Files:** `src/lib/world/fleet-ex/straggler.ts`, `src/lib/world/fleet-ex/timing-oracle.ts`, `src/lib/world/fleet-ex/index.ts`, `src/data/lessons/t6/rl-rollout.ts`, `src/data/lessons/t6/security-boundaries.ts`, `tests/world/fleet-ex-more-b.test.ts`, `public/lessons-md/*.md`.
- **Accept:** As 3s-04 (one module each, no worker edits) for the straggler, model-only (the idle share of a synchronous group with long-tail outputs, from seeded lengths), and the timing oracle (the TTFT gap a probe sees with a shared prefix cache, and the hit rate lost when the cache key carries the tenant), on the Fleet engine only if it models prefix-cache hits, otherwise model-only and labelled so; values beyond goodput and TTFT go in each point's `metrics`. UI check (§17.2) on `/lesson/t6.l7`, `/lesson/t6.l10`.
- **Pool:** none: sim and Fleet task predictions are numeric (Wave 1's rule for task predictions).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3s-06 · Stretch 4, Interview mode at /drills: a napkin round, a seeded incident, a T7 capacity design, a skeptical-interviewer packet (spec §16.4)** M. Depends: this spec.
- **Files:** `src/pages/Drills.tsx`, `src/App.tsx`, `scripts/prepare-pages.mjs`, `src/components/CommandPalette.tsx`, `src/data/interview/objections.ts`, `src/lib/mentor/interview.ts`, `tests/mentor/interview.test.ts`, `scripts/verify-bundle.ts`.
- **Accept:** §16.4: untimed; the napkin round serves three generated items, the incident is a drill-namespace incident (practice), the design chains goodput/replicas and cost/per-mtok; the packet (≤ 6,000 characters, fenced) names three objections chosen by code from objections.ts; nothing records free text or gates XP; /drills reported at 200 KB. UI check (§17.2) on `/drills`.
- **Pool:** generator (the napkin round serves family items).
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3s-09 · Stretch 7, Season 0: seven dated Daily seeds and a local record, nothing to moderate (spec §16.7)** S. Depends: 3s-08.
- **Files:** `src/data/season0.ts`, `src/pages/Daily.tsx`, `src/pages/me/Season0Card.tsx`, `src/pages/Me.tsx`, `tests/world/season0.test.ts`.
- **Accept:** §16.7: on the seven dates the Daily's header says 'Season 0 · day k of 7' and the card on /me lists the learner's own results and share strings from the ledger; no board, no fetch. UI check (§17.2) on `/daily`, `/me`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

**3s-12 · Stretch 9b, one protégé block per track (spec §16.9)** M. Depends: 3s-11.
- **Files:** `src/data/lessons/r/borrowing-and-slices.ts`, `src/data/lessons/t0/memory-hierarchy.ts`, `src/data/lessons/t1/fragmentation.ts`, `src/data/lessons/t2/virtual-memory.ts`, `src/data/lessons/t3/toy-executor.ts`, `src/data/lessons/t4/roofline.ts`, `src/data/lessons/t5/pagedattention-deep-dive.ts`, `src/data/lessons/t6/moe-anatomy.ts`, `src/data/lessons/t7/objective-function.ts`, `public/lessons-md/*.md`.
- **Accept:** §16.9: nine blocks, each on a misconception the evidence names, with a sim preset or a family item that proves the fix; verify:items passes and `verify:items -- --subset '/\.protege\./'` reports the protégé refs (n printed; the merged-level run decides). UI check (§17.2) on `/lesson/t4.l3`. Carry-over from 3b (D48): before adding a lesson choice item, read verify:items' length-cue margins (after 3b the Wave 2 bar's middle-length strategy sits at 1.81 of 2 and the gated tracks' aggregate at 1.93 of 2) and keep every one under its limit.
- **Pool:** protege.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).
- **Owner step (not build acceptance):** The owner reviews the nine blocks.

**Level 2**

**3s-10 · Stretch 8, the bring-your-own-service capstone: your trace, your model config, your hardware, on the device (spec §16.8)** M. Depends: 3s-06.
- **Files:** `src/pages/ServiceCapstone.tsx`, `src/lib/byo-service.ts`, `src/App.tsx`, `scripts/prepare-pages.mjs`, `scripts/verify-bundle.ts`, `tests/byo/service.test.ts`.
- **Accept:** §16.8: a trace file through parseTraceArtifact (kind local-derived, traces.ts:118) or a CSV converted locally, a config through the zoo reader and a hardware row from the atlas give KV per token, a batching run on a 400-request sample in the fleet worker and $/Mtok at a dated price; nothing is uploaded or stored, and the summary downloads as a file; verify-bundle's ROUTE_BUDGETS reports /capstone/service against a 200 KB figure (not gated), printed. UI check (§17.2) on `/capstone/service`.
- **Browser:** Needs headless Chromium through the wrapper (`PW_CHROMIUM_EXECUTABLE`).

### 19.3 Budget reconciliation and cut order

PLAN §8 gives Wave 3 102 review hours (cap 110). The tasks map onto its lines as follows:

| Plan line (h) | Tasks |
|---|---|
| W5 Fleet exercises, EPLB play and 2 families (19) | 3a-14, 3b-02 (EPLB); 3a-15, 3a-16 (families); 3b-03, 3b-20, 3c-06 (exercises); 3b-21 (lessons) |
| receipts (7) | 3a-12, 3b-05 |
| H4 v2 (10) | 3a-11, 3a-22, 3b-04; the v2 halves of 3b-10, 3b-12, 3b-13 |
| labs 04–08 (10) | 3a-10, 3b-10 … 3b-14; 3b-09 (W1's Code stage, D12) |
| P3 (14) | 3b-07, 3b-16, 3b-17, 3c-05 |
| K5 (8) | 3a-17, 3b-06, 3b-06b, 3b-19 |
| remaining P2 (4) | 3a-18, 3a-19, 3a-20, 3a-21 |
| W7 Tiling Cube (10) | 3a-13, 3b-01, 3b-18 |
| twins for labs 07 and 06 (4) | 3b-08, 3b-15; the twin claims in 3a-08 |
| S4 watcher if justified (10) | 3c-04: under the default (D18) it ships no code and the hours return |
| partners (6) | 3c-03, plus the owner's partner rounds |
| stretch, in order: W7 3D evaluation (8), t6.l12 (6), more W5 exercises (12), Interview mode (8), 2 field labs (8), On-Call pilot (6), Season 0 (4), BYO-service capstone (8), P4 (7), real-engine run (4) | 3s-01, 3s-02; 3s-03; 3s-04, 3s-05; 3s-06; 3s-07; 3s-08; 3s-09; 3s-10; 3s-11, 3s-12; 3s-13 |

**Not in the plan's 102 h:**
- The foundation: the ledger contract, routes, types, gates, mounts and lazy claims (3a-01 … 3a-07), the KC contract (3a-09), the exit-gate and a11y tasks (3c-01, 3c-02). About 12 h of review, like Wave 2's unbudgeted foundation.
- The one remaining Wave 2 carry-over of D24 (RooflineSim's SMEM curve, inside 3a-18), about 1 h.

That takes the base to about 115 h against the 110 h cap. The watcher's 10 h return under its default (D18). If they do not, cut 1 does not help, because stretch is not part of the 115 h base (it only frees review capacity); the second cut, W5's Fleet exercises (3b-03, 3b-20, 3c-06, about 7 of W5's 19 h), closes the gap.

**Cut order** (PLAN §8.1, binding). If the review queue saturates, cut in this order; each cut rolls into Wave 4. Nothing that owns a build gate (B1–B9) or the partner instrumentation is ever cut.
1. All of 3s (stretch is conditional anyway). 3s-01 and 3s-02 are cut or kept together: the 3D view ships dark and appears only with its evaluation (Q7). **D66:** both shipped, the view as a plain opt-in and the evaluation dormant.
2. W5's Fleet exercises: 3b-03, 3b-20 and 3c-06. No exit gate depends on them: t6.l3 and t7.l2 stay hands-on through their item blocks (§5.4).
3. P3's work analogues: 3c-05. Panels then align and name breaks with no background pick.
4. K5's track forms: 3b-19. /me then shows no forms, and 3c-03 drops `selectFormsGain`, its only reader of form data.

---

## Appendix A: measured baselines (`wave-3a` 4b32c09, 2026-10-14)

Measured in a fresh `git archive wave-3a` tree (the bundle lines after `npm run build`), except where the How column names an earlier source.

| What | Result | How |
|---|---|---|
| entry chunk | 113.7 KB gzip | `bun run verify:bundle` |
| `/boot` closure | 168.2 KB; target 165 | same |
| `/today` closure | 186.7 KB (full flow 239.1) | same |
| `/daily`, `/play/block-placement`, `/play/scheduler` | 181.6 KB, 206.1 KB, 197.0 KB | same |
| `/errors` closure | 157.8 KB; the compile bank is four group chunks, 72.9 KB in all (figure 30 KB); "no chunk holds compile bank data" | same |
| `/progress` static closure | ≈ 615 KB, of which 393.8 KB is `src/data/lessons/index.ts` and ≈ 40 KB framer-motion | the build manifest of `integ-2c`, at 474ea3e |
| ⌘K index | 18.2 KB of 20 (verify-bundle's line: 18.6) | `bun run verify:search-index` |
| claims chunk on /boot and /today | 17.1–17.4 KB | Wave 2a review; `verify-bundle` |
| FSRS + cards + composer | 6.2 KB | `bun run verify:bundle` |
| three + R3F (ParticleField) | 242.4 KB gzip, lazy, Home only | build manifest, at 474ea3e |
| `verify:items` | passes; 290 gated lesson items, 8 Fleet Week Act IV items, 67 errata; own pools prequestion 49, predictAt 16, spiral 42, align 7, primm 12 | `bun run verify:items` |
| `bun run test` | 3,865 pass, 0 fail, 150 files | `bun run test` |
| `hands-on.test.ts` | 17 pass, 0 fail; "hands-on T6/T7 lessons: 12 of 15"; not t6.l3, t6.l7, t6.l10 | `bun test tests/kc/hands-on.test.ts` |
| `verify:plays` | ok; the scheduler's practice minute in band on all five §8.2 rules | `bun run verify:plays` |
| Act I scheduler dials (2b, 30 graded entropies) | 19 of the 48 dial settings behave differently; guard 2000 = guard 0 everywhere; runs end within 2,949 ticks | `compileSchedPolicy` on Act I's `Engine` (§8.3), on `wave-2b` f5521f1 |
| KC graph | 153 KCs (r 19, t0 10, t1 14, t2 17, t3 13, t4 16, t5 28, t6 23, t7 13); 68 of 68 lessons tagged; 19 confusable sets | `bun run verify:kc` |
| claims | 169 (107 spec, 17 derived, 15 benchmark, 9 synthetic, 10 price, 11 status) | `bun run verify:claims` |
| sim tasks | 86 registered (21 outcome, the zoo's six among them; 65 legacy) plus 36 inline ids outside the registry | `src/components/sims/*.tasks.ts` and the components |
| isomorphisms | 18 blocks, 52 pairs, 29 with `breaks` (all in T0–T2) | `src/data/lessons/**` |
| Prove-it | v1 on labs 01–03, provenance `practice`; no writer of `proved`; no 30-day return | `progress.ts:849–851`; `ProveIt.tsx:242` |
| labs 04–08 | no bundle; checks without stage, KCs or expectation; no STAGE markers | `labs.ts:687–873` |
| Fleet Week acts | keyword, word-count and screenshot-name checks; recorded as `practice` with no seed; Act I passes only with your own component within 3 points of the reference | `fleet-week.ts:265–267, 446–653`; `FleetWeek.tsx:165–171` |
| watcher | harness and frozen snapshot; pre-registration unsigned; no rating or report | `docs/prereg/watcher.md:58`; `docs/backtest/` |
| hint-ladder pre-registration | draft, unsigned | `docs/prereg/hint-ladders.md:3, 70–76` |
