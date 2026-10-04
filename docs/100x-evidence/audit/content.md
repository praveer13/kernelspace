# kernelspace: content and pedagogy audit of the lesson engine and 68 lessons

Audit date: 2026-10-03. Scope: `src/data/lessons/**`, `src/pages/Lesson.tsx`, `src/pages/lesson/*`, `src/components/QuizBlock.tsx`, `src/lib/progress.ts`, plus the parts of Progress, Curriculum, AgentActions and labs that decide what a learner sees again. Every number below comes from the lesson registry, loaded with bun (scripts in `scratchpad/audit/measure.ts`, `strat.ts`, `graph.ts`, `bloom.ts`). No repo file was modified.

## 0. Verdict

The writing is strong. The voice is right for Java and Python backend engineers, the analogies are concrete, and in places (T4.L3, T1.L3, T0.L4, T2.L4, T2.L7) the lessons link reading, a simulator and a primary source well. The engine around the writing is a linear reader with one end-of-lesson multiple-choice checkpoint. That checkpoint can be passed without knowing the material, and no score from it affects anything later. The course has no retrieval practice beyond that one checkpoint, and no spacing, interleaving, prediction capture, generative answers, misconception diagnosis or prerequisite model. Completion means clicking a button. The weakest pedagogy sits in the most novel content: T6 and T7, 20 lessons and 415 minutes, contain zero exercise blocks. A deep read also found a wrong quiz key and several stale or wrong technical claims, listed in §5. Those matter more than usual because the brand promise is "every number sourced".

## 1. How the engine actually works

**What "done" means.** A lesson becomes `done` only through `markLessonStatus(id,'done')`, called from `complete()` (`src/pages/Lesson.tsx:557-569`). Three things trigger it: the right-rail button, the sticky bar that appears after 90% scroll (`Lesson.tsx:527`, `:788-810`), and the `m` key (`Lesson.tsx:616-617`). The `m` key works from the top of the page, so a lesson can be completed without scrolling at all. The only gate is `examGate = !!lesson.exam && quizScore < 0.8` (`Lesson.tsx:468`), and exactly 1 of 68 lessons has `exam: true` (t2.l7). For the other 67, the quiz, exercise and reading do not affect completion.

**The incentives point the wrong way.** Clicking complete pays 100 XP (`progress.ts:243`). Passing the quiz pays 40 XP, and only on the first pass (`progress.ts:259,270`). So clicking pays 2.5 times more than showing understanding. `markExerciseDone` is defined (`progress.ts:275`) but nothing in `src/` calls it, so `LessonProgress.exerciseDone` is never set. Sim tasks earn XP inside the simulator (`recordSimTask`), but the lesson's "Guided tasks" list always renders static, unchecked `Square` icons (`src/pages/lesson/blocks.tsx:644`), even after the learner has completed those tasks in the sim. T2.L7 promises that its quiz "is worth double XP" (`exam-pagedattention.ts:18,106`; also `Track.tsx:233`). It is not: `recordQuizScore` pays a flat `XP.quiz`.

**Quiz mechanics.** `QuizBlock` requires every question to be answered before Submit (`QuizBlock.tsx:82`). It scores all-or-nothing per item and passes at 80% or above (`:46`). On submit it reveals the correct option for every item and shows the same `explanation` text whether the learner was right or wrong; only the border colour changes (`:168-186`). No distractor has its own feedback. Retry (`:75-78`) clears the selections and shows the same items in the same order with the same option order, right after the key was revealed, so the second attempt passes trivially. The store keeps the maximum score ever reached (`progress.ts:258`), so a lesson's record cannot show decay.

**Revisiting.** Nothing in the lesson engine ever brings content back. The only "review" logic is `UpNext` on the Progress page (`src/pages/Progress.tsx:1056-1069`). It returns `null` while any lesson is still not done (`if (nextId) return null`). After all 68 are done, it points to the single lesson with the lowest best-ever quiz score. In practice the course has no review before it is finished, and almost none after.

**Placement check.** `src/pages/Curriculum.tsx:44-111` has 8 single-answer items, and 7 of the 8 keys are index 1 (B). `recommendFor(score)` (`:112`) maps the raw count of correct answers linearly onto T0…T7. It never recommends the R track. Choosing B for every item scores 7/8 and tells the learner to start at T7. Because the score is a count, it cannot detect a gap such as "strong OS, weak GPU".

**Agent tutoring hand-off.** "ask claude/chatgpt" sends `md.slice(0, 1800)` (`AgentActions.tsx:32`). The exported lesson markdown files range from 2.8 KB to 12.5 KB, with a median of about 8 KB, so the agent receives roughly the first fifth of a typical lesson and never the exercise or the quiz. The exported markdown includes the answer key inline (`scripts/export-lessons-md.ts:42-48`: `Answer: B — …`).

## 2. Measurements

| Metric | Value |
|---|---|
| Lessons / declared minutes | 68 / 1,818 min (30.3 h) |
| Words (prose + callouts + deep dives + field notes) | 43,200 (prose 34,443); at 230 wpm this is only about 3.1 h of reading, so declared minutes are mostly sim, lab and paper time |
| Words per declared minute | median 24; R track 6–15 (each lesson about 230 words with a 24–42 min label, because the Forge drill carries the time); T6/T7 15–24 |
| Longest lessons | t2.l7 1,082 · t5.l10 1,059 · t4.l3 1,039 · t0.l5 962 · t6.l10 959 words |
| Block totals | prose 254 · callout 95 (analogy 53, warning 26, info 8, segfault 6, isomorphism 2) · quiz 68 · code 35 · statline 32 (128 stat chips) · exercise 27 · diagram 26 (avg 3.8 steps) · deepdive 19 · isomorphism 18 (51 pairs) · field-note 10 |
| Lessons lacking each block type | exercise 41/68 · diagram 42 · code 37 · isomorphism 50 · deepdive 49 · field-note 58 |
| Exercise blocks by track | R 0/10 · T0 3/6 · T1 4/6 · T2 5/7 · T3 3/7 · T4 7/7 · T5 5/10 · **T6 0/10 · T7 0/5** |
| `exercise` kind label | sim 24 · read+quiz 22 · code 14 · quiz 5 · read 2 · quiz+sim 1 |
| Quiz blocks per lesson | exactly 1 in all 68 lessons. Position as a fraction of blocks: 0.67–0.92, always last or next to last |
| Questions | 266 total. 3 per lesson in R (11 lessons have 3), 4 in 52 lessons, 5 in 5. All have 4 options. **0 multi-select** (the engine supports `multi`). All have explanations (median 29 words) |
| `verifiedAt` | 18/68 lessons (t5.l6, t5.l8, t5.l9, all of T6, all of T7), all dated `2026-08` |
| Exam-gated lessons | 1 (t2.l7) |
| Lessons with an in-prose "predict" exhortation | 15. No block captures a prediction |
| Exercise tasks | 114. 40 are "watch/observe" tasks; 10 ask the learner to predict, estimate or compute first; 6 ask for an explanation. Only RooflineSim grades a typed numeric answer (`numericClose`, `RooflineSim.tsx:628-636`) |

## 3. Quiz integrity: verified and worse than reported

- **Answer position.** Of 266 keys, 230 are B (86.5%), 26 are C (9.8%), 10 are A (3.8%) and **0 are D**.
- **Longest option.** The key is the longest option in 252/266 items (94.7%; strictly longest in 251). The median ratio of key length to mean distractor length is **4.14×**, and the 25th percentile is 2.89×. In 184 items (69%) the key is longer than 70 characters while the distractors average under 35. 260 of 798 distractors (32.6%) are 20 characters or fewer.
- **Blind strategies, evaluated per lesson against the 80% bar.** "Always B" passes 40/68 lessons, including the only exam, t2.l7. "Always pick the longest" passes **58/68**. Combining the two cues passes nearly everything. The XP, track badges, ranks and the opt-in leaderboard's lesson component therefore measure clicking, not knowledge.
- **Distractor quality.** Many distractors are jokes or category errors that no learner would pick: "The printer jams" (placement), "Buy two" and "Regulations require it" (t7.l1), "It halves the model size" (t5.l9), "The PCIe generation" (t4.l4), "GPUs ignore indirection" (t5.l5). 78 items contain absolute-word distractors ("always", "only", "never"), a classic test-wiseness cue.
- **Cognitive level.** A stem heuristic classifies about 6% of items as scenario or applied-numeric, about 19% as definitional ("…is defined as", "…best described as"), and about 31% as why/because items whose key restates the lesson's own sentence. Only 51 stems contain any digit and 11 ask for a calculation. **No stem references another lesson**, so there is zero cumulative or interleaved retrieval.
- **Wrong key (confirmed).** t0.l4 Q1 (`src/data/lessons/t0/aos-vs-soa.ts:189-193`) asks what fraction of each cache line is useful when a sweep reads one u64 from 32-byte AoS structs. The key is 1/8. Two structs fit in a line and the sweep touches both, so 16 of 64 bytes are useful: **1/4**, which is option B. The explanation contradicts itself ("…16 useful bytes of 64 only if you touch both…"). The same error appears in the prose (`:37`: "one eighth of every fetch is useful"), in a code comment (`:60`) and in a sim task (`:178`; `layoutLab.tasks.ts:6`). A learner who computes correctly is marked wrong, so the bias penalises the one learner who reasoned correctly.

## 4. Evaluation against learning-science principles

**Retrieval practice (testing effect; Roediger & Karpicke 2006, Agarwal 2021).** The course has one recognition-format retrieval event per lesson, placed at the end, after the answers were just read. Recognition MCQ with transparent cues produces weak testing effects. There are no free-recall, short-answer, numeric, "draw the block table" or code-completion items in the lesson engine. The strongest retrieval anywhere is the B200 worksheet inside RooflineSim. It is outside the quiz system and nothing reports it back to the lesson.

**Spacing and interleaving (Cepeda 2006; Rohrer and Taylor 2007).** There is no spacing at all: no scheduler, no due items, and no item ever reappears. Mixed practice exists only in Fleet Week, at the very end. PLAN.md §3.6 proposed spaced-repetition arithmetic drills seeded from the glossary; they were not shipped. The 128 statline chips, each with a hint, are a ready-made deck of exactly the "numbers that must be reflexive" (L1 ~0.5 ns, H100 ridge ~295 F/B, MLA ~70 KB/token, …), and none of them is ever quizzed again.

**Worked examples and fading (Sweller; Renkl and Atkinson).** Worked arithmetic is common and good (t4.l3 decode at 3.35 TB/s ÷ 16 GB ≈ 200 tok/s; t5.l4 KV bytes; t6.l1 MLA 70 KB). There is no fading: no follow-up has a step blanked out or a parameter swapped for the learner to complete. The t1.l3 C allocator is a complete worked example. Its coalesce step is left as a comment (`toy-allocator.ts:89`), which would have made a natural completion problem, but the lesson never asks for it. The completion problem lives in the Forge (rust-allocator lab), and t1.l3 does not link there (see §7).

**Prediction before reveal (generation effect; Brod 2021).** 15 lessons say "predict…before you step", but nothing records a prediction, so the learner skips straight to the answer. The step-through diagram (`blocks.tsx:292`) shows each caption immediately. It has no "what happens next?" pause before each step.

**Self-explanation (Chi 1994).** Rare. The best instance is t2.l7's "Exam briefing" ("You are ready when you can answer, without notes: …"), and it is still followed by an MCQ. The engine has no prompt-and-compare block.

**Cognitive load and segmenting (Mayer).** Segmentation is good. H2 sections, about 700 words per lesson outside R, and step-through captions keep chunks small. Two load problems stand out. (1) T6 and T7 put key reference facts in collapsed `deepdive` blocks (19 deep dives, 15 of them in T6/T7; for example, t6.l1's DeepSeek-V3 reference architecture at `moe-anatomy.ts:128`), so the most important "keep this in your head" content is hidden by default. (2) Several lessons carry draft artefacts that add extraneous load: `pagedattention-deep-dive.ts:22` ("128 KB/token… wait, per-block bytes = …") and `exam-pagedattention.ts:87` ("…compressed oops… no wait — swapping is literally *swapping*").

**Multimedia principles.** The 26 diagrams are generic labelled-box graphs on a 100×H viewBox. They follow the signalling principle (highlight per step) and keep text and image together. Some layouts contradict the mechanism, though. In t0.l2 fig 1, edges run CPU→L2 and CPU→L3 directly (a miss walks L1→L2→L3), SSD hangs off L3, and HBM is disconnected (`memory-hierarchy.ts:60-66`). No diagram is driven by data or state; for example, t5.l5's block table is a static picture, not the BlockTableExplorer embedded inline. 42 lessons have no diagram, including t6.l1 (all-to-all dispatch/combine), t6.l2 (wide-EP, DBO), and t7.l1 (the goodput knee, which is literally a curve).

**The OS≡LLM isomorphism pedagogy (analogical encoding; Gentner 2003).** This is the course's signature and its main strength. 18 panels with 51 pairs, plus 53 "YOU'VE SEEN THIS" analogy callouts. The risk is that the course never says where an analogy breaks. A regex for "breaks down / where … breaks / unlike the OS" finds **0 lessons**. Some pairs are loose enough to plant misconceptions. In t1.l3, "split + coalesce ≡ block append & COW fork" (`toy-allocator.ts:157-161`) pairs things that are not structurally parallel; the real lesson is that fixed blocks remove the need for coalescing. In t2.l4, "priority inversion ≡ head-of-line / preemption" (`scheduling.ts:69-72`) conflates inversion, which needs a shared lock and three priority levels, with the convoy effect. In t2.l7, "PCIe as the disk" ignores that GPU→CPU swap was dropped from vLLM V1's default path. Analogy research says the learning comes from comparing *both* the alignments and the non-alignments. The panel type has no field for the mismatch.

**Misconception handling.** About 13 lessons use "trap/myth/common mistake" language in prose, which is good. Quizzes do not diagnose misconceptions: because distractors are implausible, a wrong answer tells you nothing, and the explanation is not tied to the option chosen. Nothing is stored about *which* wrong option was picked.

**Numeric and estimation practice.** This is the most important skill for the stated outcome ("estimate any access pattern in nanoseconds", "price a serving business on a napkin"), and it is mostly assessed through recognition. In t5.l4 the 128k-context KV answer is chosen from four options rather than computed. In t7.l1, an economics lesson, the learner never computes goodput. The one graded numeric pathway (RooflineSim) shows the right pattern exists in the codebase.

**Connection to labs and sims.** The links mostly run one way. All 8 systems Forge labs declare a host lesson (`src/data/labs.ts`: t1.l3, t5.l5, t5.l2, t2.l5, t3.l4, t5.l7, t5.l6, t6.l8), but only **1 of those 8 lessons (t5.l6) hyperlinks to `/forge`**; the others mention "lab 0x" in passing or not at all. Lab completion never appears on the lesson page. The R lessons depend entirely on their Forge drill, yet they have no exercise block, and completing the drill does not mark the lesson.

**Redundancy without a spiral design.** Ownership is taught in r.l3, r.l4, t1.l6 and t3.l1. t3.l1 opens "T1 ended with the pitch; this lesson is the practice" (`ownership.ts:16`), as if the R track did not exist. No R lesson is ever referenced by a T-lesson (in-degree 0 for all 10). Repetition could be good spiral practice, but here it reads as drift from the R track being added later.

## 5. Content accuracy and freshness issues found while deep-reading

1. **t0.l4 cache-line fraction is wrong** (1/8 should be 1/4; details in §3). It affects prose, code, sim task and quiz.
2. **t2.l4 treats CFS as current.** "Linux CFS (what actually schedules your processes)" (`scheduling.ts:30`; also `processes-threads.ts:63`, `toy-executor.ts:117`). EEVDF replaced CFS as the fair scheduler in Linux 6.6 (2023). "No starvation, ever" also overclaims. The lesson has no `verifiedAt`.
3. **t6.l1 counts all-to-alls as "2 × 61".** DeepSeek-V3's first 3 layers are dense, so there are 58 MoE layers and 2 × 58 all-to-alls (`moe-anatomy.ts:24,36`). The "latency floor = RTT × 2 × layers" line also ignores dual-batch overlap, which t6.l2 then teaches.
4. **t5.l5 and t2.l7 describe vLLM V0.** Swap-to-CPU preemption, beam-search COW and `vllm/core` (`production-stack.ts:23`) are V0 paths. V1, the default since 2025 and acknowledged in t5.l10, uses recompute preemption and hash-based prefix caching that keeps zero-ref blocks as LRU-evictable cache. The `BlockManager` code at `pagedattention-deep-dive.ts:92-96` *deletes* cache entries at refcount 0, which is the opposite of how automatic prefix caching works, and `self.cache` is never populated. "Attention is a minority of decode time" is false at long context or large batch. t5.l5 has no `verifiedAt`.
5. **t0.l2 Q3 overweights cache misses.** It attributes the Python-list-vs-numpy gap "mostly" to cache misses (`memory-hierarchy.ts:132-141`). Interpreter dispatch, boxing and the lack of SIMD usually dominate, and small-int caching plus sequential allocation keep many PyLongs close together. The "correct" option is contestable, which is a rigour risk for the course's signature claim.
6. **t6.l5 capacity claims need re-verification.** "671B at FP4 ≈ 335 GB → fits a 2-node NVL72 pair instead of 5+ H100 nodes" (`fp4-blackwell.ts`) ignores NVFP4 scale overhead (about 4.5 bits per weight). 335 GB fits in one 8×B200 HGX node, and an NVL72 is one rack, not a "node". Freshness: no Blackwell Ultra (B300, 288 GB) and no Rubin.
7. **Volatile lessons have no freshness marker.** t5.l10 production-stack (vLLM, SGLang, TRT-LLM, Dynamo), t5.l7, t5.l2, t4.l7 and t3.l6 have no `verifiedAt`, although they are the most likely to go stale.

## 6. Five strongest and five weakest lessons

**Strongest**
1. **t4.l3 Roofline.** A clear model, the "hypothesis → model → measure → explain" norm, a graded numeric B200 worksheet where a guessed label does not pass, a near-ridge trap item (AI 256 vs ridge 281), and a field note that turns the roofline into a scheduler (Sarathi-Serve). It is the most-referenced lesson (in-degree 13) and the template the rest should follow.
2. **t1.l3 Toy allocator.** A complete worked example, a 4-step split/coalesce diagram, a five-task sim with prediction, a 1,000-op adversarial trace, a policy comparison and a deliberate double-free. It bridges explicitly to vLLM. Weaknesses: a loose isomorphism pair and no link to its own Forge lab.
3. **t2.l7 PagedAttention exam.** The task is translation (read the SOSP paper section by section in OS vocabulary), with an explicit self-explanation briefing and a completion gate. It is undermined because always-B passes the gate and because of the draft artefact at `:87`.
4. **t0.l4 AoS/SoA and false sharing.** Applied items (fraction of a line, an 8-thread counter), Rust code, and a layout lab that reproduces a 10–50× effect. Pedagogically it is among the best and has the best item stems. It also carries the confirmed numeric error.
5. **t2.l4 Scheduling and admission.** The sim reproduces convoy, round-robin, inversion, inheritance and overload. Each phenomenon gets a named serving twin, and the Splitwise field note frames the next step. It needs the EEVDF fix and a corrected inversion mapping.

**Weakest**
1. **r.l3 Ownership (stands in for all of R).** 247 words for 32 minutes, one code block, no exercise block, three recall MCQs with key B, no prediction of compiler errors (the stated track outcome is "predict moves and borrow-checker errors"), and drill completion does not show on the lesson.
2. **t6.l1 MoE anatomy.** The most visual and networking-heavy concept in T6 (dispatch/combine, hot-expert stragglers) has no diagram, sim or Fleet tie-in. The key architecture facts sit in a collapsed deep dive. Factual error: 2 × 61.
3. **t6.l5 FP4/Blackwell (and the same 6-block template in t6.l6–t6.l8).** 468 words with 2 prose blocks, a callout, a statline, a quiz and a deep dive. No interaction, despite the existing Quantizer sim. Capacity arithmetic is shaky, and Blackwell Ultra and Rubin are absent.
4. **t7.l1 Objective function.** An economics lesson in which the learner never computes goodput, the goodput knee is never drawn, the Fleet tie-in is collapsed, and the distractors are jokes ("Buy two"). It is shaped like a lecture, not a measurement.
5. **t5.l10 Production stack.** 1,059 words across 7 prose blocks, no diagram or exercise, no `verifiedAt`, and the most volatile content in the course (engine architecture comparisons). It should be a comparison matrix the learner fills in.

## 7. The concept graph

There is no structured prerequisite data at lesson level. What exists:
- `TRACK_EXTRAS[t].requires` holds human strings (`src/data/lessons/index.ts`). Most read as a linear chain, but some do not: T4 "requires T0", not T3.
- `ForgeLab.readiness.lessonIds` (`src/data/labs.ts:44-48`, for example rust-allocator ← r.l1–r.l5) is the **only machine-readable prerequisite edge set**, about 15 edges.
- Inline `Tn.Lm` references in content: **197 unique lesson→lesson edges, 141 backward (prerequisite-like) and 56 forward (advance organisers)**. Most-referenced: t4.l3 13, t2.l4 9, t5.l7 9, t5.l9 9, t2.l3 8, t5.l4 8, t6.l3 8, t0.l4 7. Never referenced: all 10 R lessons, t0.l2, t1.l2, t1.l6, t3.l5, t3.l7, t6.l7, t7.l5. These references are hard-coded strings, and the T5 renumbering already needed a progress migration (`progress.ts` `T5_LESSON_ID_MIGRATION`), which shows how brittle they are.
- 51 isomorphism pairs, 128 statline facts and the glossary are natural knowledge-component (KC) nodes.

**Can a KC graph be derived with modest effort? Yes.** Take the 197 regex edges as candidate lesson prerequisites, add the readiness edges, and have a person or agent review them (about 1 day). Then tag each of the 266 questions and 114 tasks with 1–3 KC ids from a vocabulary of about 120 KCs, seeded from the H2 headings (about 250), the statline labels and the isomorphism terms (about 2 days of agent drafting plus review). Store it as `prereqs: string[]` and `kcs: string[]` on `Lesson`, plus `kc: string[]` on `QuizQuestion`. Keep a typed `src/data/kc.ts` registry and validate it in CI (no dangling ids, the graph must be a DAG, every KC assessed at least twice). With that in place, placement diagnosis, review scheduling, "you're missing X" hints and the agent tutor all have something to reason over.

## 8. Upgrade opportunities, expressed as block types and engine features

**A. Assessment integrity (do first; mostly mechanical)**
1. **Shuffle options per attempt.** Store `correct` by option id, not index. Add a CI lint (`scripts/verify-quiz.ts`) that fails on a position skew above 35% at any index, a key-to-mean-distractor length ratio above 1.3, banned joke distractors, or a missing `kc`. Rewrite distractors from documented misconceptions (agent-drafted, human-reviewed). Fix t0.l4.
2. **Item banks of 2–3× size per lesson, sampled per attempt.** Retry then draws different items. Show the key only after a correct answer or after the second miss.
3. **Per-option feedback.** Add `QuizOption {text, why?: string, misconception?: string}` and store the chosen option ids, not just a score, so wrong answers become diagnostic data.
4. **Completion as a mastery gate for every lesson.** Completion requires passing the quiz on retrieval items and finishing the exercise or drill. Remove "m from the top". Rebalance XP so mastery pays more than clicking. Pay the promised double XP on t2.l7, or delete the claim.

**B. New item and block types (generative retrieval)**
5. `numeric`: an answer, a tolerance, units and a worked solution revealed after the attempt (KV bytes, ridge points, $/Mtok, Little's Law). Generalise RooflineSim's `numericClose`.
6. `predict`: the learner commits a choice, a number or a sketch-free option *before* a diagram step, code output or sim run is revealed, and the delta is stored. The step-through `diagram` gains `predictAt: stepIndex`.
7. `explain`: a free-text self-explanation compared against an expert model answer and a rubric checklist the learner ticks. Optionally the text is sent to the learner's own agent through the existing AgentActions pattern, which keeps it serverless.
8. `parsons` / `order`: order the steps of a block allocation, a PagedAttention request lifecycle or a Planner loop.
9. `spot-the-bug` / `compiler-says`: Rust snippets where the learner predicts the rustc error, or says "compiles", before the reveal. This makes R's stated outcome assessable in the browser without a toolchain.
10. `estimate` (Fermi): an order-of-magnitude answer scored on a log scale, with calibration tracking ("your estimates run 3× high on bandwidth").
11. `isomorphism` v2: add `breaks: string` per pair, plus an interactive "map it" exercise where the learner drags OS terms onto LLM terms and must identify the one that does not map.

**C. Spacing, interleaving, adaptivity (local-first; fits the constraints)**
12. A **review queue in the progress store** (FSRS or SM-2, all in localStorage). Cards are auto-generated from statlines (128), isomorphism pairs (51), glossary entries and failed quiz items. Daily review appears on Home and Progress, and streak days count only reviews or mastery events.
13. **Interleaved mixed checkpoints** at each track end and before Fleet Week, drawn by KC from earlier tracks. Make some cumulative stems mandatory ("using T4.L3 and T5.L4, …").
14. **Diagnostic placement** that scores per KC, not a count, routes to R when Rust is weak, and offers "test out" of specific lessons.
15. **Prerequisite nudges.** When opening a lesson whose `prereqs` contain a KC with no mastery evidence, show a two-item warm-up quiz.

**D. Linking reading to doing**
16. **Inline sim embeds**: an `embed` block that mounts a sim in a specific state inside the lesson (for example, BlockTableExplorer at t5.l5's fig 1), instead of a card that links out.
17. **Exercise status reflects reality.** Read `sims[simId].tasksDone` and `labs[id].checksDone` into the Guided-tasks list. Give every lab-host lesson a `forge` block (lab card, readiness, check status). R lessons get one too, and R completion is defined as drill all-green.
18. **T6/T7 interactivity.** A Fleet-scenario `exercise` per T6/T7 lesson (MoE hot expert, EPD transfer budget, Pareto sweep, goodput knee) using the existing fleet-model. This is where a 3D or animated view of all-to-all traffic across an NVL72 or EP144 topology would teach something rather than decorate. The three/R3F stack is already a dependency.

**E. Content hygiene**
19. A `verifiedAt` plus a `volatility: 'stable'|'landscape'` flag on every lesson, with CI that fails on any landscape lesson verified more than 2 quarters ago. Add a `claims[]` source ledger per numeric statline chip.
20. Fix the §5 items, strip draft artefacts, and rewrite t3.l1 as an explicit spiral that recalls R3/R4 by retrieval rather than re-teaching them.
21. Send the agent hand-off the full lesson markdown through a clipboard and file flow, without the 1,800-char cut, and a variant without the answer key ("tutor mode").
