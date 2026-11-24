# After Wave 0: what changed for the roadmap

> This note was written on 2026-11-23 by the build host's clock (UTC−8), which was 2026-11-24 in UTC, after Wave 0 was merged, against this branch at commit 5782014 (the tree pull request #30 merged, plus the published copies in this folder). It says where [roadmap.md](roadmap.md) and [packages.json](packages.json), written on 2026-11-21 while Wave 0 was still being built, no longer match the course, what Wave 0 left open and which package would meet it, and what a later package must respect. It is not a plan and changes none: nothing of waves 1 to 5 is built, their scope and order are the owner's open decision, and every owner question named here is unanswered ([docs/specs/k0.md](../specs/k0.md) records no answer). Each statement names where it was read: a file and line on this branch, a pull request, or a section of docs/specs/k0.md. "The branch" below means this branch; "d478f91" is the audited export.

## 1. What Wave 0 was

Wave 0 ("what harms a learner today") was built as two pull requests into master. Pull request #29 merged on 2026-11-22T16:56:39Z (GitHub's `mergedAt`): it re-pinned the course's engine claims to vLLM v0.34.0 and SGLang v0.5.23, made every place that typed vLLM's default KV block as 16 read the claim or name the 2023 paper's 16, and added two errata and a guard test (its description). Pull request #30 merged on 2026-11-24T00:01:20Z: it holds every other Wave 0 task (graded and factual fixes in t0 to t7 and Rust Zero, learner-app and rendering fixes, signposts, and the follow-ups #29 listed), 71 new errata, and a closing check with ten fix groups A to J (its description, "What a learner gains" and "How it was checked"). The wave's record is [docs/specs/k0.md](../specs/k0.md): decisions K0-Z-D1 to K0-Z-D17 (section 2), the task list by lane (section 3), owner questions 1 to 27 and rows A to H (section 6), what was left out (section 7) and follow-ups (section 10). Every one of the 116 task ids k0.md section 3 lists has at least one commit with its `Task:` trailer between d478f91 and the branch (`git log --format='%(trailers:key=Task,valueonly)' d478f91..HEAD`, compared with the ids of k0.md section 3).

## 2. Where the roadmap speaks of Wave 0, and what is true now

I went through every line of roadmap.md that matches `Wave 0`, `wave 0` or `K0-` (107 lines) and every field of packages.json that matches `Wave 0`, `W0` or `K0-` (127 sentences in 75 packages), and grouped the ones that say the same thing. Line numbers are those of the published roadmap.md. Verdicts: **holds**, **holds with a difference** (the difference is stated), **no longer true** (what is true is stated). The note under roadmap.md's title (line 3) was written when it was published and is current; it is not counted. A package's `what` can also ask for work Wave 0 already did without naming Wave 0; the five found are P31 to P35. R1 to R17 and P1 to P35 are this note's labels; "R10" in a table row of section 3 means Rust Zero's R10 exercise, not group R10. "Decision N" below is item N of #30's "For the owner" (b); section 5 lists all ten.

### In roadmap.md

**R1. Lines 5 and 11: Wave 0 was planned by another run, its plan and task list are not in the repository, and "everything below builds on Wave 0's merged base".** Branch: Wave 0 merged (#29, #30); its record is docs/specs/k0.md; the plan and task list are still not in the repository. The merged base is the tree #30 merged, which this branch starts from. **Holds.**

**R2. Section 5's table (lines 211 to 249): which lessons Wave 0 touches before later packages.** The table names Wave 0 for t0.l1, t0.l6, t1.l3, t1.l6, t2.l3, t2.l7, t3.l4, t4.l3, t4.l6 and t5.l5. Branch: each of those lesson files changed between d478f91 and HEAD (`git diff --name-only d478f91 HEAD -- src/data/lessons`). But Wave 0 changed 55 lesson files, so most rows that do not name Wave 0 also start from Wave 0's text: t0.l2 to t0.l5, t1.l2, t2.l1, t2.l2, t2.l5, t3.l5, t3.l7, t4.l2, t4.l5, t4.l7, t5.l2 to t5.l4, t5.l6 to t5.l10, t6.l1 to t6.l3, t6.l8, t7.l1, t7.l5, r.l4, r.l8 and r.l9 (t5.l1 and r.l1 to r.l3, r.l5 and r.l10 did not change; t6.l13 does not exist yet: K1-28 creates it). **Holds with a difference:** every package brief that touches one of these lessons builds on Wave 0's sentences and the tests that pin them (section 4 below), not only those in the ten rows that say "Wave 0".

**R3. Line 256 and K3-12's `what` and `roadmap_changes`: K3-12 "skips r.l8's panic message if Wave 0 merged it".** Branch: K0-C44 merged; r.l8 says the panic message is "RefCell already borrowed" (src/data/lessons/r/interior-mutability.ts:159). **Holds:** K3-12 skips it.

**R4. Lines 264, 266 and 420: K1-31 is "L2's second half, which Wave 0 left", K1-32 "L6's second half and t4.l3's four tasks, which Wave 0 left", K2-24 "F4's section and exercise, which Wave 0 handed on".** Branch: K0-A4 fixed only the keys (`isWidgetKeyTarget`, src/lib/sims/host.ts:664); k0.md section 7 leaves the drawn roof (K0-A11) out; no lesson holds a "where the pool comes from" section (`git grep -i "pool comes from" -- src/data/lessons` finds nothing). **Holds.**

**R5. Lines 312, 628 and 650: Wave 0 left the drawn-roof figure (K0-A11) out because it needs a new block type, and K1-32 takes it.** Branch: k0.md section 7, first bullet, says the same. **Holds.**

**R6. Lines 314 and 643, and K3-14's `roadmap_changes`: Wave 0's default for its owner question 12 adds one 30-day price claim, `price.h100.median-2026-11`, used only by t7.l4.** Branch: the claim is at src/data/claims/lazy/economics.ts:367, `verifiedAt` 2026-11-23, `ttlDays` 30. **Holds with a difference:** it lives in a lazy group (lazy/economics.ts), which K3-14's `touches` (src/data/claims/prices.ts) does not reach, and by `verifiedAt + ttlDays` (the rule at src/data/claims/index.ts:51) it goes stale on 2026-12-23, the first claim on the branch to do so (computed over public/claims.json, 427 claims).

**R7. Line 322 (Q28) and K1-32's `what`: t4.l3's batch-to-ridge task has tolerance rel 0.45 at roofline.tasks.ts:155, and Wave 0 asked no question about it.** Branch: the tolerance is unchanged, now at src/components/sims/roofline.tasks.ts:156; Wave 0 changed only the `roof.coalesce` task (its prompt and model answer, with the `coalesceFactor` import they use) in that file; k0.md section 6 has no t4.l3 row. **Holds with a difference:** the line number is 156.

**R8. Lines 324 and 632, and K2-4's `owner_question` and `roadmap_changes`: Q29 carries Wave 0's owner question 24 (an item answerable only from the paper changes what the exam grades).** Branch: k0.md section 6 row 24 and section 7 (K0-A20) leave it out, unanswered. **Holds.**

**R9. Line 358: Q1, Q2, Q4, Q6, Q10, Q11, Q14, Q16, Q23 and Q29 are asked in week 1 because they bear on "Wave 0's hand-over".** Branch: the hand-over has happened (both pull requests merged); none of these questions is answered. **Holds.**

**R10. Line 371: the owner's GPU session comes "after PR-028 and Wave 0's re-pin".** Branch: the re-pin is merged; `VLLM_PIN` is v0.34.0 and `SGLANG_PIN` v0.5.23 (src/data/claims/engines.ts:10-11); the field-lab commands are pinned to the release engines.ts uses (src/data/claims/lazy/field.ts:7). **Holds.**

**R11. Line 432, section 10: A46's Museum key rename, L7's tolerant Fleet pass rule and a change to `recommend()` for L1 are "left out by Wave 0 too".** Branch: `BorrowMutError` is still a key at src/lib/rust/museum.ts:30 and :39; K0-B10 retitled the Fleet exercise "Find the goodput peak" with its pass rule, id and revs unchanged (k0.md section 6 row 10; src/data/lessons/t7/benchmarking.ts:73); K0-A1 to A3 merged. **Holds.**

**R12. Line 439, section 11: Wave 0's re-pin is "the repair (the other run, due before 2026-12-04)"; everything that names vLLM waits on its merge; "K3-1 adopts whatever mechanism Wave 0 wired F4 through".** Branch: the re-pin merged on 2026-11-22. No claim in public/claims.json goes stale on 2026-12-04 or 2026-12-13 by `verifiedAt + ttlDays`; the first is 2026-12-23 (R6), then seven claims on 2027-01-02 (six price claims and `price.act3.b200-node-hourly`, derived from them). The mechanism is a reader module and a generated snapshot (section 4, first line). **Holds with a difference:** the wait is over, and the two lapse dates no longer apply on the branch.

**R13. Line 455, section 12: "Wave 0's final plan was not complete" (101 tasks); "re-run the ledger script when Wave 0 is final".** Branch: the final task list has 116 tasks in 21 lanes (k0.md line 5, its "Sources" paragraph), all merged (section 1 above). The ledger script is not in the repository and was not re-run; the ledger pass below is done by hand. **No longer true.**

**R14. Lines 465 and 467, section 13: each wave's plan re-reads "the Wave 0 run's final files and what of them merged" and, for Wave 1, "how Wave 0 wired F4 (K3-1 must adopt it)" and "the frozen budgets as they stand".** Branch: the final files are docs/specs/k0.md and the descriptions of #29 and #30; how F4 is wired and where the budgets stand are in section 4 below. **Holds with a difference:** the answers now exist; this note gives them as of commit 5782014.

**R15. Line 469: Wave 2 re-reads "Wave 0's corrected sentences that the rewrites must keep true (Wave 0's facts file, not in the repository)".** Branch: no facts file is in the repository; the nearest records are #30's description ("What a learner gains", by track) and the tests named for each task (`tests/**/k0-*.test.ts`). **Holds.**

**R16. Line 471: Wave 3 re-reads "Wave 0's listing mechanism (K0-B1) before K3-11".** Branch: K0-B1 was left out (k0.md section 7, third bullet; owner question 25, unanswered); Wave 0 compiled the listings it changed by hand and recorded the output. **No longer true:** there is no Wave 0 listing mechanism; K3-11 starts from none.

**R17. Lines 623, 628, 639 and 640, section 15: the critic's round read Wave 0's files "as they stood at 00:48" on 2026-11-21.** Branch: the tasks split during the build (K0-A9b, K0-C8a, K0-C8b) were already in that read (the ledger names them); the follow-up tasks K0-E1 to K0-E11, K0-Z3, K0-Z4 and the closing groups A to J came later (k0.md section 3; #30's description). **Holds with a difference:** what the critic's round checked was the plan of 00:48; the ledger pass below adds what came after.

### Section 14, the id ledger

The ledger (roadmap.md lines 482 to 616) gives 67 finding ids to Wave 0 tasks: F1 to F12, O11, O15, L1, L2, L3, L6, L7, L9, L11, D2, N4, M3, A1 to A14, A18, A19, A21 to A23, A25 to A31 and A33 to A49. Every Wave 0 task it names merged (section 1's check). Its counts ("131 ids: Wave 0 only 30, Waves 1 to 5 only 64, both 37") are of the plan's 101 tasks; no id moves between the columns because of a task that merged. **Holds with a difference**, in these places, where #30's description says a task did less than asked or left something in its own lines:

| Id | Wave 0 task | What #30 says is left | Where on the branch |
|---|---|---|---|
| F7, A22 | K0-C3 | The derived claims were left out (k0.md section 7, fifth bullet); Epoch AI's date and range came out of t7.l4 instead of becoming claims (decision 4); the dated median quotes "46 providers" where the page read 48 later that day. | src/data/claims/lazy/economics.ts:375 |
| F10 | K0-B9 | Its derived claim was left out (k0.md section 7, fifth bullet). | k0.md section 7 |
| F11, A42 | K0-C11 | One erratum for t2.l6 where an "error" and a "changed" were asked (decision 10); its task-size sentence cites Docker's seccomp page, which does not discuss task size. | src/data/errata/2026-11-22-t2-l6-task-size-and-io-uring.ts:10, :13 |
| F11, A13 | K0-C1, K0-C7 | The KVBM erratum is of kind "changed" (decision 10); t6.l3 types "Dec 2025" for SGLang's EPD with no claim. | src/data/lessons/t6/epd-disaggregation.ts:17 |
| A1 to A3 | K0-C17 | Two errata where three were asked (decision 10). | #30, "For the owner" (b) 10 |
| A11 | K0-C8b | t5.l10 still heads its SGLang section "structured generation as a first-class citizen" and calls it "engine + frontend lang". | src/data/lessons/t5/production-stack.ts:246, :278 |
| A12 | K0-C25 | The item stem was left out (k0.md section 7, fourth bullet). | k0.md section 7 |
| A14 | K0-C5, K0-C6 | t6.l4's opening "real deployments compose all of them" beside "two reported runs"; its Meta clause; the Kimi K2 benchmark credited with "fleet-scale goodput". | src/data/lessons/t6/parallelism-zoo.ts:16, :184 |
| A30 | K0-C35 | t4.l5 question 1's keyed option still says gid.x is the index "across the whole dispatch" (decision 6). | src/data/lessons/t4/wgsl-playground.ts:198 |
| A35, A43 | K0-C16 | A t1.l6 quiz explanation still says Rust removes "the memory-bug class at compile time". | src/data/lessons/t1/rust-ownership-intro.ts:270 |
| A43 | K0-C15 | GCC and Clang sharing the Itanium ABI rests on the task text; Clang was not installed. | #30, "T1" |
| A40 | K0-C38 | t2.l4's stem "Continuous batching maps to preemptive scheduling because…" is kept (decision 6). | src/data/lessons/t2/scheduling.ts:209 |
| A44 | K0-C40 | The performance-core timings were measured once by the builder; t0.l3 still says "10–100×" and "~20x" beside them. | src/data/lessons/t0/row-vs-column.ts:10, :150, :185, :206 |
| A46 | K0-C44 | The task asked for a run on current stable Rust (1.100.0); it ran on rustc 1.96.0 only. The compile family still names the panic "BorrowMutError"; compile-bank and Museum texts say a variable "has lost W" where rustc names the place behind it (#30 counts 53 items). | src/data/rust-items/snippets/borrows.ts:236; src/data/rust-items/constants.ts:72 |
| A48 | K0-C46 | Lab 04 still says "Run it ten times" while R10's brief now says its checks run on one thread; left to the owner (decision 7). | src/data/labs.ts:476, :759; labs/mpmc-queue/src/queue.rs:44; labs/mpmc-queue/tests/queue_tests.rs:12 |
| A49 | K0-C12 | The ledger's "README" part is not done: README.md is frozen for tasks, and line 58 still says "Nine Rust-to-WASM simulators" (an owner step). The home ticker still shows NVMe at 150 µs; the external-fragmentation card still pairs with reservation waste. | README.md:58; src/pages/Home.tsx:314; src/data/glossary.ts:45 |
| L1 | K0-A1 | The rule for a Rust "Not sure" counts frontier probes too, so one missed serving topic brings back the ten Rust Zero lessons (decision 5); PlacementWalk's header comment still describes the old rule. | src/components/learner/PlacementWalk.tsx:9 |
| L3 | K0-A6 | Four families are held to the rule; seven (frag, kv, memory, prefill, rollout, sig, spec) are exempt from "nothing visible after the blank" (K0-Z-D17, decision 9); spec's best-k item shows its key among the visible steps in 659 of 1,000 level-1 instances. | tests/items/worked-leak.test.ts:20 |
| L6 | K0-A9, K0-A9b | K0-A9b measured lessons 1 to 7 of t0 to t5; the embedded simulators of t5.l8 to t5.l10, t6, t7 and Rust Zero were not checked. | #30, "What was not checked" |
| L6, L11 | K0-A10 | The figure-fit test allows 91 known spills, 74 of them older figures added by the closing check; about 70 were not checked by eye. | tests/lessons/diagram-fit.test.ts:56 |
| L11 | K0-A12 | 16 practice explanations still repeat a clause of their key's reason; the lesson Checkpoint does not de-duplicate. | tests/items/feedback-dedupe.test.ts:217, :237, :242 |
| O15 | K0-A17, K0-A18 | The signpost test misses "build-plan" and "wave 64" as written (a nit). | tests/lessons/signposts.test.ts |
| A4 | K0-D14 to K0-D22, K0-E3 | A "4%" in square brackets still passes the guard (a nit). | tests/content/vllm-block-size.test.ts |

The tasks added after the ledger was generated have no row in it. By lesson and subject (my reading of #30's description; the build's task list, not in the repository, records each task's own finding ids): K0-E2, K0-E4, K0-E5 and K0-E6 continue F4 and A4 (the lesson-claims generator, t5.l6's wording, t1.l4's and t2.l7's waste figures); K0-E3 is the "<4%" guard (A4); K0-E8 and K0-E9 are the home and glossary figures and `/glossary`'s accessibility (A49); K0-E1, K0-E7, K0-E10, K0-E11, K0-Z3 and K0-Z4 fix faults the reviews found (a reading-block race, renamed-heading links, `/freshness` on a phone, the `fleet-time` spec, the search index). The closing groups touch F1, F7, F11, A10 to A14, A21, A23, A26, A28, A30 and L1 by lesson; groups G, H and I fix older false statements in t2.l1, t2.l4, t5.l7, t6.l4, t3.l4 and t4.l5 and the home page; group J edited five of #30's own errata before publication.

### In packages.json

**P1. `deps: "W0"` (with or without a list of findings) in 67 packages, K3-1 to K5-22 in file order.** Branch: every Wave 0 task merged. **Holds:** the base for any of them is the tree #30 merged.

**P2. K1-0 (`what`, `risk`) and K1-1 (`risk`): a record of master against d478f91 says which rows Wave 0 fixed; Wave 0's edits to t0.l1 merge first; the ref snapshot is taken on the merged Wave 0 base.** Branch: t0.l1 changed in Wave 0 (src/data/lessons/t0/why-systems.ts, two lines); the diff of master against d478f91 is now Wave 0's two pull requests. **Holds.**

**P3. K3-1 (`what`, `risk`): Wave 0 "renders F4's nine places (t5.l5, t5.l6, t1.l3, t1.l4 prose and prequestion, t2.l7, block-placement play, glossary, capstone briefing, lab 02) from that one claim"; K3-1 adopts the mechanism or migrates them so the course never carries two syntaxes; the entry chunk must not grow.** Branch: lessons read claim values through src/data/lessons/claims.ts (`claimNumber`, `claimCite`, `claimRelease`, `ENGINE_BLOCK_SCOPE` at line 24) from a generated snapshot, and may not import `@/data/claims` (K0-Z-D12); k0.md section 5 lists the nine surfaces as t5.l5, t5.l6, t1.l3, t1.l4, t2.l7, the glossary, the allocator sim, the block-table explorer and its task; several of them name "the paper's 16" (`serving.pagedattention.paper-block-size`) instead of reading vLLM's default, and the sims' and labs' own 16-token blocks stay (k0.md section 7). **Holds with a difference:** the mechanism to adopt is a reader module plus a snapshot, not a token; the list of places differs from K3-1's; and K0-Z-D12 records that a direct claims import from a lesson put claims chunks in the entry's preload map, which K3-1's lazy loading must avoid.

**P4. K1-9 (`risk`, `what`) and K1-31 (`deps`, `what`): Wave 0's L2 fix edits the lesson key handler; K1-31 is the second half.** Branch: the check is `isWidgetKeyTarget` in src/lib/sims/host.ts:664, a file K1-31 touches; src/pages/Lesson.tsx changed too. **Holds with a difference:** the line references in K1-9's `what` moved: in Lesson.tsx, `next` and `prev` are at :728-729, not :716-717, the arrow-key cases at :933 and :936, not :922-925, and the footer's previous link at :1076, not :1064; the "T0 · L1 — Why systems" card's `cta` and `to` are at Curriculum.tsx:386-387, not :390-391, and the three cards it places at :386-404 are at :382-400. Home.tsx and boot/You.tsx changed too (`git diff --stat d478f91 HEAD`); K1-9's references in them were not re-checked.

**P5. K1-12 (`what`): "Wave 0 adds the warning to Boot and gives the reading question its cheap fix".** Branch: K0-A16 and K0-A15 merged (#30, "The learner app"). **Holds.**

**P6. K1-15 (`risk`), K5-16 (`what`, `risk`, `roadmap_changes`) and K3-3 (`roadmap_changes`): Wave 0 corrects t4.l4 (F9), t4.l1 (F10), t5.l5's figure (F3), t4.l3's rendering and A28, and the A26 sentences.** Branch: K0-B8, K0-B9, K0-B6, K0-A8 to A10, K0-C33, K0-C30 and K0-C31 merged; the four lesson files changed. **Holds.**

**P7. K1-16 (`what`) and K5-12 (`what`): t1.l3's listing after F6, "a 16-byte header, alignment, coalescing or no chip".** Branch: the listing is a 72-line allocator with a 16-byte header, aligned payloads and an address-ordered free list that coalesces (#30, "T1"; owner question 8's default, unanswered). **Holds with a difference:** of the two options, coalescing is what is built.

**P8. K1-18 (`risk`, `roadmap_changes`), K1-32 (`findings`, `deps`, `what`): Wave 0 fixes only t4.l3's rendering (K0-A8, A9, A9b, A10, with B8 and C33); the drawn roof and the four tasks are K1-32.** Branch: all six tasks merged; the drawn roof was left out; the tolerance is at roofline.tasks.ts:156 (R7). **Holds with a difference:** the line number.

**P9. K1-19 (`risk`) and K2-17 (`findings`, `what`, `deps`, `risk`): Wave 0 "changes t7.l2's knee grading (L7)", writes the open- and closed-loop paragraph (N4), gives one definition of the knee, and names GuideLLM and AIPerf, which K2-17 and K3-5 make status claims.** Branch: the knee is "the highest load step that still meets the SLO" (k0.md section 6 row 10, unanswered); the Fleet exercise's pass rule, id and revs are unchanged (#30, "T7"); t7.l2 defines open and closed loop (src/data/lessons/t7/benchmarking.ts:25); four status claims already exist, `status.loadgen.llmperf`, `-genai-perf`, `-guidellm` and `-aiperf` (src/data/claims/lazy/economics.ts:126, :140, :155, :172). **Holds with a difference:** the grading did not change, only the definition and the exercise's title; the status claims are already registered. K1-19's `risk` also says t7.l5's re-pricing must use t7.l4's prices (F7) as "corrected numbers from claims": Wave 0 took Epoch AI's figures out of t7.l4 instead of making them claims (decision 4), and the price claims t7.l4 reads now include `price.h100.median-2026-11` and DeepSeek's list prices (src/data/lessons/t7/unit-economics.ts).

**P10. K2-17 (`what`): "Must survive: the broken-benchmark exercise and its sentence 'a p95 taken past the knee is not a latency number'".** Branch: closing group B changed the sentence to "a p95 taken past capacity is not a latency number" (src/data/lessons/t7/benchmarking.ts:84), with an erratum (src/data/errata/2026-11-23-t7-l2-knee-and-step-32.ts). **No longer true:** the sentence to keep is the new one; a brief that keeps the old wording would undo a published correction.

**P11. K1-20 (`risk`): "Wave 0's L1 fix changes how placement scores a skip, in the same file".** Branch: src/lib/learner/placement.ts changed; a Rust "Not sure" is stored as skipped only after a walk in which every other probed idea was solid (k0.md section 6 row H; #30, "The learner app"). **Holds.**

**P12. K1-21 (`risk`): t3.l7's first question is a graded model answer that Wave 0 fixes (A36).** Branch: K0-B4 merged; t3.l7's written exit item now says any language with free C interop can drive io_uring and eBPF (#30, "Graded answers that changed" 8). **Holds.**

**P13. K1-22 (`risk`): "Wave 0's L3 changes Today's first button".** Branch: K0-A5 merged; "Keep going" offers practice only on ideas from lessons passed or found solid (#30, "The learner app"). **Holds.**

**P14. K1-25 (`what`, `risk`), and the re-pin in the `deps` of K2-3, K2-5, K2-20, K2-24 and K4-10: the runbook and twins use the vLLM version the claims pin after Wave 0's re-pin, v0.34.0.** Branch: R10; `production.vllm.block-size` is 64 from vLLM v0.34.0's `vllm/config/cache.py`, read 2026-11-21 (public/claims.json). The field labs keep `--gpu-memory-utilization 0.90` (owner question 20's default, unanswered). **Holds with a difference:** K1-25's `risk` sentence "The commands are pinned to v0.31.0 today" is past; the commands now read v0.34.0 (src/data/claims/engines.ts:10; src/data/claims/lazy/field.ts:7).

**P15. K1-27 (`what`): "Wave 0's F1 corrections to t0.l6 (the wait-bar feedback, the y-axis rule, on-CPU against wall-clock) are the base".** Branch: K0-B13 and closing group C merged (#30, "T0"). **Holds.**

**P16. K1-30 (`what`): "Wave 0 corrects only the signposts (K0-A17); this is the body".** Branch: K0-C16 also rewrote t1.l6's claim that Rust catches every bug class at compile time (#30, "T1"; tests/lessons/k0-c16-no-all-of-the-above.test.ts). **Holds with a difference:** the body K1-30 rewrites already holds K0-C16's sentences, and one quiz explanation it did not reach (the A35 row above).

**P17. K2-4 (`what`) and K2-24 (`findings`, `what`): K2-4 adds "where the pool comes from" to t5.l5 "if Wave 0 did not add it"; K2-24 adds the same section and the block-size exercise.** Branch: Wave 0 did not add it (R4). **Holds with a difference:** both packages now name the section; one brief must give it to the other.

**P18. K2-4 (`deps`, `risk`): t2.l7 keeps Wave 0's link and its corrected figure and section numbers (D2, A1 to A4).** Branch: K0-A19 and K0-C17 merged, with tests that pin them (tests/lessons/k0-a19-paper-link.test.ts, tests/lessons/t2-l7-paper-refs.test.ts). **Holds.**

**P19. K2-10 (`what`, `deps`): EPLB taught as replicate-then-pack "after Wave 0 drops the hashing analogy"; the node-day item survives "with Wave 0's fix to the worked step leak".** Branch: K0-C5 merged; t6.l2's question 2 explanation now calls EPLB replication plus bin-packing (#30, "Graded answers that changed" 7). The node-day item is the cost family (src/lib/items/families/cost.ts:88), which Wave 0 did not change (`git diff d478f91 HEAD -- src/lib/items/families/cost.ts` is empty); tests/items/worked-leak.test.ts now holds it to both worked-step rules at 30 seeds. **Holds with a difference:** the guard is a test, not a change to the item.

**P20. K3-4 (`what`, `deps`): Wave 0 fixes the listing errors (F6, A34); K3-4 re-reads and updates `production.glibc.bins`.** Branch: K0-B5 and K0-B3 merged; K0-C47 already edited glibc's bins claim (#30, "Claims": production.ts). **Holds with a difference:** the glibc claim was re-read in Wave 0.

**P21. K3-5 (`what`, `deps`): status claims for "the GuideLLM and AIPerf that Wave 0 names" and for F11's Dynamo, KVBM and NATS.** Branch: P9's four status claims exist; Dynamo's release, NATS and etcd are read from claims (#30, "T3" and "T5"). **Holds with a difference:** some of K3-5's claims exist; its brief extends them rather than adding duplicates.

**P22. K3-6 (`done_when`): the first dispatch lists "the claims expiring 2026-12-04 and 2026-12-13 (or none, if Wave 0 re-verified them)".** Branch: none expires on either date (R12). **Holds:** the "none" case applies.

**P23. K3-7 (`what`): inputs are the GitHub-pinned claims "as they stood at d478f91, before Wave 0's re-pin".** Branch: d478f91 is in this clone; on the branch, 18 claims cite vLLM at v0.34.0 and 9 SGLang at v0.5.23, and one historical status claim cites vLLM v0.10.2 (my count of source addresses in public/claims.json). **Holds.**

**P24. K3-11 (`deps`, `done_when`): builds on Wave 0's F2, F6 and A34 listing fixes; "the listings workflow is green on master after Wave 0".** Branch: K0-B2, K0-B5 and K0-B3 merged; no listings workflow exists. **Holds.**

**P25. K3-12 (`what`): r.l4's and r.l9's Polonius sentences "become renderings of status claims with a 45-day life" and "r.l4.json's `all` column trace is fixed".** Branch: `status.rust.polonius` exists with `ttlDays` 45 (src/data/claims/lazy/rust-lang.ts:11, :22) and r.l4 and r.l9 read it (src/data/lessons/r/borrowing-and-slices.ts:174, src/data/lessons/r/practical-lifetimes.ts:252); commit 38fb0eb put the trace's write on `*all`. **No longer true:** these two clauses are done; r.l4's quiz question 4, also named in that sentence, was not changed by Wave 0 (`git diff d478f91 HEAD -- src/data/lessons/r/borrowing-and-slices.ts` changes one prose block).

**P26. K4-6 (`deps`), K4-7 (`what`) and K5-15 (`what`): t3.l4's listing after Wave 0's compiling fix for F2; K4-7 makes it "the lab's single-threaded design (Rc, RefCell…)" and corrects r.l8's "Arc/Mutex queue in executor lab 05" sentence "if Wave 0 left it".** Branch: t3.l4's listing is a thread-safe executor (`Arc`, `Condvar`, `Mutex`: src/data/lessons/t3/toy-executor.ts:74, :79), Appendix B's shape with one sentence on lab 05 (owner question 7's default, unanswered); r.l8 still says "the Arc/Mutex queue in executor lab 05" (src/data/lessons/r/interior-mutability.ts:212). **Holds with a difference:** K4-7's change would reverse Wave 0's default for its owner question 7, so the two questions are one decision; the r.l8 sentence was left.

**P27. K4-15 (`deps`): builds on Wave 0's A48 lab text.** Branch: K0-C46 merged; Lab 04's "Run it ten times" was left (the A48 row above). **Holds with a difference:** Lab 04's contradiction is open and is K4-8's to fix (section 3).

**P28. K5-20 (`risk`): "t6.l2 is rebuilt in W2 (D4) after W0's F12 fix".** Branch: K0-C5 merged. **Holds.**

**P29. K5-22 (`what`): t7.l2's "open-loop paragraph W0 adds".** Branch: src/data/lessons/t7/benchmarking.ts:25. **Holds with a difference:** the same `what` has Little's law "stated as L = λW for the first time in the course", but Wave 0 already states it in t2.l4 ("Little's Law, L = λW, holds for any stable queue", src/data/lessons/t2/scheduling.ts:50, K0-C38) and in t7.l2 ("*L = λ × W*", benchmarking.ts:25, K0-B12; t7.l2 had no formula at d478f91). K5-22 does not state it first; its brief can link back to those two.

**P30. K5-27 (`what`): "Dispatch sizes respect the 65,535-per-dimension limit Wave 0 states".** Branch: src/data/lessons/t4/wgsl-playground.ts:97 and :122. **Holds.**

### Packages whose `what` asks for work Wave 0 already did, without naming Wave 0

**P31. K1-13 (`what`, `touches`): in t5.l2, "'Greedy longest-first' becomes lowest merge rank first, and the Llama 3 tokenizer sentence is corrected with a claim and an erratum"; its `touches` include "src/data/errata/ (A5)".** Branch: K0-C19 merged; t5.l2 says "Apply the lowest-rank merge first, left to right without overlap" (src/data/lessons/t5/tokenization.ts:23), and the erratum is published (src/data/errata/2026-11-22-t5-l2-bpe-merge-order.ts; #30, "T5": "Llama 3's tokenizer is tiktoken-style [K0-C19]"). The ledger's row A5 (roadmap.md line 572) already splits it: "W0: the two t5.l2 sentences. K1-13: encode() (O16)." **No longer true:** these two corrections are done; what is left of K1-13 is the encode() listing and t5.l1's query, key and value paragraphs, and a second erratum would duplicate a published one.

**P32. K2-9 (`what`): t6.l1 "puts the batch-1 framing of the \"~18\" saving next to the per-expert batch", and a table "replaces \"every frontier open model of 2025-2026 is an MoE\"".** Branch: t6.l1 says the per-token weight read "divides by ~18 for the whole model at batch 1 … and by about 28 for the expert path alone", and that larger batches shrink the saving (src/data/lessons/t6/moe-anatomy.ts:43; the stat chip at :59); the "every frontier open model" sentence is gone (`git diff d478f91 HEAD` of that file). **No longer true:** these two clauses are done; the prequestion block, the dispatch-and-combine stepper and the then-and-now table remain.

**P33. K2-13 (`what`): "t5.l8's family tree marks Medusa as removed from vLLM v0.33.0 and dated".** Branch: t5.l8 says "Medusa, the plain-heads version, was removed from vLLM in v0.33.0" (src/data/lessons/t5/speculative-chunked.ts:185; K0-C24, closing group D). #30 lists the wording as a nit: no claim holds it, and vLLM's releases list only v0.33.0rc3. **Holds with a difference:** the removal is stated; what is left is the date as a claim, at the release that shipped it.

**P34. K2-17 (`what`): t7.l2's Rule 3 hands the concurrency sweep to t7.l3 and keeps an arrival-rate sweep for capacity.** Branch: closing group B rewrote Rule 3's worked example (the knee is "the highest step that still meets the SLO" and sits at or below the goodput peak, src/data/lessons/t7/benchmarking.ts:76; step 32 serves fewer tokens per second than step 16) with an erratum (src/data/errata/2026-11-23-t7-l2-knee-and-step-32.ts). P10 covers only the p95 sentence. **Holds with a difference:** the rewrite starts from the corrected sweep; if it changes what that erratum's "after" says, it supersedes the erratum with a new one (K0-Z-D5).

**P35. K5-16 (`what`): "t4.l6 gains A31's 'what changed after 2022' section (FlashAttention-3 and -4, each a claim)".** Branch: t4.l6 already names FlashAttention-2, -3 and -4 with links to their papers (src/data/lessons/t4/matmul-tiling.ts:183; K0-C31, closing group C); their dates were taken out rather than made claims (decision 4). **Holds with a difference:** the names and links exist; the claims and the section remain, and a claim needs a prefix in src/data/claims/homes.ts (section 4).

### Count

53 groups: 17 in roadmap.md (R1 to R17), the ledger, and 35 in packages.json (P1 to P35). Holds: 23. Holds with a difference: 24. No longer true: 6 (R13, R16, P10, P25, P31, P32).

## 3. What Wave 0 left open, and which package would meet it

Every item of #30's description under "What is still wrong or open" and "For the owner". "Still on the branch" says what grep finds. A package is named only where its `touches` reach the place and its `what` covers that kind of change; the clause that makes me say so is quoted. Where a package only shares the file, the row says "no package owns this" and names it as the nearest.

### What is still wrong or open

| # | Item | Still on the branch | Package |
|---|---|---|---|
| 1 | Broken, older: Lab 04 "Run it ten times" against R10's one-thread brief; R10's "What green means" labels | Yes: src/data/labs.ts:759, :476; labs/mpmc-queue/src/queue.rs:44; labs/mpmc-queue/tests/queue_tests.rs:12 | K4-8: "the lab 04 and R10 pages say plainly what the browser checks and the native stress test can and cannot see on x86-64" |
| 2 | t2.l6 erratum's task-size sentence cites Docker's seccomp page | Yes: src/data/errata/2026-11-22-t2-l6-task-size-and-io-uring.ts:10, :13 | No package owns this. Published errata are never edited (K0-Z-D5); a fix is a new erratum, and no package's `what` covers it (K1-21, K3-10 and K3-12 touch src/data/errata/ for other rows). |
| 3 | Dated H100 median quotes "46 providers"; the page read 48 | Yes: src/data/claims/lazy/economics.ts:375 | No package owns this. Nearest: K3-14 ("the ten price claims are re-read at source on the day"), whose `touches` hold prices.ts, not lazy/economics.ts. |
| 4 | t5.l7's keyed explanation credits block tables for per-step re-decision | Yes: src/data/lessons/t5/continuous-batching.ts:236 ("switching only updates block tables") | No package owns this. Nearest: K5-28 (a pass over t5.l1 to t5.l11 "for what the rewrites left"). |
| 5 | t6.l4's "real deployments compose all of them" beside "two reported runs" | Yes: src/data/lessons/t6/parallelism-zoo.ts:16, :184 | K2-11: "t6.l4 carries out its composition procedure once on R70 and once on RV3" (a rebuild of the lesson) |
| 6 | Placement's "every other idea solid" counts frontier probes (decision 5) | Yes: src/lib/learner/placement.ts (k0.md section 6 row H) | No package owns this. K1-20 touches placement.ts, for T3 only. |
| 7 | 16 practice explanations repeat a clause of their key's reason; the Checkpoint does not de-duplicate | Yes: tests/items/feedback-dedupe.test.ts:217 to :242 (t0.l1, t0.l3, t2.l7, t3.l1, t5.l6, t5.l8, t5.l10, t6.l3, t7.l2, t7.l4, t7.l5) | No package owns this. Passes and rewrites reach those lessons but none names the repeats or the Checkpoint. |
| 8 | Figure-fit list of 91 known spills; about 70 not checked by eye | Yes: tests/lessons/diagram-fit.test.ts:56 (t3.l4 14, t4.l6 8, t1.l4 7, and 17 more lessons) | No package owns this. |
| 9 | t4.l5 question 1's keyed option (decision 6) | Yes: src/data/lessons/t4/wgsl-playground.ts:198 | No package owns this. Nearest: K5-16, which touches the file for t4.l5's word cut and tasks. |
| 10 | Older generated families: spec's best-k shows its key; frag 0.363 against 0.3632; spec "k + 1 = 3"; a kv blank with no "?"; the blank step's screen-reader text | Yes: src/lib/items/families/spec.ts and frag.ts unchanged by Wave 0's fixes for these | No package owns this. K2-13 and K2-7 read spec.ts and kv.ts only. |
| 11 | Glossary external-fragmentation card pairs it with reservation waste; its Figure 2 citation, written by Wave 0, points at a figure that splits that waste three ways | Yes: src/data/glossary.ts:45 | K1-8: "the pair that still teaches what an erratum retracted is corrected" and "Each definition is checked against the lesson that teaches it" |
| 12 | t2.l4's stem "Continuous batching maps to preemptive scheduling because…" (decision 6) | Yes: src/data/lessons/t2/scheduling.ts:209 | No package owns this. K5-13 touches t2.l4 but shortens options, not stems. |
| 13 | Home page "context switch ≡ iteration-level scheduling" | Yes: ScrollStory.tsx:305, in the folder src/components/home | No package owns this. |
| 14 | Home ticker shows NVMe at 150 µs; t0.l2 keeps about 100 µs | Yes: src/pages/Home.tsx:314 | No package owns this. K1-9 and K1-10 touch Home.tsx for its calls to action and times. |
| 15 | t0.l3 and t0.l5: "10–100×", "~20×", "a DRAM miss on every access" | Yes: src/data/lessons/t0/row-vs-column.ts:10, :150, :185, :206; src/data/lessons/t0/your-runtime.ts:159 | K1-17 for t0.l3: "t0.l3 gets a reveal on why its 20x falls to 6x … Each number is a registry claim"; K5-11 for t0.l5: "absolutes and slogans in T0's older voice cut to the claim" |
| 16 | t0.l3's exercise: 512² "fits L2"; "enable the prefetcher" | Yes: src/data/lessons/t0/row-vs-column.ts:186; src/components/sims/matrixBench.tasks.ts:16, :21 | K1-17 (touches matrixBench.tasks.ts): "The simulators … only stop contradicting the lesson" |
| 17 | t1.l6 quiz explanation: "the memory-bug class" at compile time | Yes: src/data/lessons/t1/rust-ownership-intro.ts:270 | K1-30: "t1.l6 … becomes a retrieval lesson" |
| 18 | t2.l2 "Humongous allocations go straight to huge pages", no source | Yes: src/data/lessons/t2/virtual-memory.ts:135 | K3-4: "An inventory of T0-T3's dated and numeric statements … each registered as a sourced claim" |
| 19 | t3.l3's exercise says "re-measure" beside "not a measurement" | Yes: src/data/lessons/t3/rust-concurrency.ts:105 | K5-15: "t3.l3 stops calling its sim a measurement" |
| 20 | t4.l4 says the simulator moves bandwidth "an order of magnitude" (it moves 8×) | Yes: src/data/lessons/t4/occupancy-coalescing.ts:162 | No package owns this. Nearest: K5-16 ("t4.l2, t4.l4, t4.l6: breaks, words"). |
| 21 | t5.l5's listing "the fork as in the 2023 paper" writes into a shared tail in place | Yes: src/data/lessons/t5/pagedattention-deep-dive.ts:185 | No package owns this. Nearest: K2-4 ("t5.l5 gets the one sentence on the partial-hit copy"). |
| 22 | The block-table lab shows `blk.sweep`'s answer in its size list | Not checked (a rendered list) | No package owns this. Nearest: K2-24, which touches the same sim to add a task. |
| 23 | t5.l10's SGLang heading and "engine + frontend lang" | Yes: src/data/lessons/t5/production-stack.ts:246, :278 | K2-5: "a dated table of the four engines … each cell a status claim" |
| 24 | t6.l4's Meta clause; the Kimi K2 card's "fleet-scale goodput" | Yes: src/data/lessons/t6/parallelism-zoo.ts | K2-11 (as row 5) |
| 25 | t6.l3 and t5.l10 type "Dec 2025" and Dynamo's v1.5.0 date with no claim | Yes: "Dec 2025" at src/data/lessons/t6/epd-disaggregation.ts:17 and src/data/lessons/t5/production-stack.ts:248; Dynamo's "v1.5.0 (2026-09-21)" at epd-disaggregation.ts:31 and production-stack.ts:266 | K3-3: "each chip and dated sentence … cites an existing claim, a new claim …"; K2-6 and K2-5 rewrite the two lessons first |
| 26 | t7.l4 and t6.l2 type older figures no claim holds | Not settled by grep (no single phrase) | K3-3 (as row 25); K2-18 and K2-10 rewrite the two lessons |
| 27 | Rust: compile-bank items say "`v` has lost W" where rustc names `*v`; the Museum's E0382 marks line 2 rejected; the compile family names the panic "BorrowMutError" | Yes: src/data/rust-items/snippets/borrows.ts:236; src/data/rust-items/constants.ts:72 | No package owns this. Roadmap section 10 keeps the `BorrowMutError` key (line 432). |
| 28 | App: a held arrow key skips several lessons | Not checked (behaviour) | No package owns this. K1-9 touches the same keys. |
| 29 | App: Space on a focused simulator button starts playback | Not checked | No package owns this. |
| 30 | App: Up Next gives a t1 starter a reason about t4.l7 | Not checked | K1-9: "Every surface follows the learner's plan instead of the registry" |
| 31 | App: the roofline chart's labels collide in a lesson | Not checked | K1-32: "the roofline chart, read-only and without tasks … mounted right after fig 1" |
| 32 | App: the Curriculum names the track entered, not the lesson started on | Not checked | K1-9: "the Curriculum (Path) page opens on 'Your path', an ordered list with the current step marked" |
| 33 | App: prequestions and a diagram's "predict first" read saved answers before they load | Not checked | No package owns this. K1-31 keeps in-progress state, a different fault. |
| 34 | App: the field gate F3 counts every r.l1 landing | Not checked | No package owns this. |
| 35 | App: change cards print erratum titles without curly quotes | Not checked | No package owns this. K3-9 touches ChangeCards.tsx for the history kind. |
| 36 | App: from 640 px up the claims table is 3,258 px wide in its box | Not checked | No package owns this. |
| 37 | App: diagram text about 5 to 9 px on a 390 px phone | Not checked | No package owns this. |
| 38 | App: active edges end at a node's centre | Not checked | No package owns this. |
| 39 | App: a statline chip's hint is a mouse-over title only | Not checked | No package owns this. K3-1 adds a claim popover to chips; the authored hint stays. |
| 40 | App: a full-ramp plan at entry T3 puts t3.l1 before r.l6 to r.l8 | Not checked | K1-4: "edges the text needs are added" |
| 41 | The nits, as one group (errata wordings, the t0.l6 icicle wording, t3.l6's Android sentence (it would misread if its claim became a number), t1.l4's chip wrap, t7.l2's "live", "Medusa removed in v0.33.0", t6.l6, the signpost test's misses, "4%" in brackets, k0.md:103, row H's exception, the Kimi erratum id, t4.l3 and t3.l4 figure labels, PlacementWalk.tsx:9, test placement, the Boot blurb, the t5.l10 caption test) | k0.md:103 says setup-rest merges first and names K0-E1 to E3; PlacementWalk.tsx:9 still describes the old rule; the rest not checked one by one | No package owns these. Some sit in lessons a later rewrite replaces (t0.l6: K1-27; t5.l10: K2-5; t6.l6: K2-13; t7.l2: K2-17). |
| 42 | Not checkable: the builder's performance-core timings | — | No package owns this. |
| 43 | Not checkable: Clang's mangling | — | No package owns this. |
| 44 | Not checkable: which bar of the paper's Figure 2 is 20.4% and which 38.2% | — | K2-4: its first stop asks about "the memory-waste figure in t1.l4's words", which needs the mapping |
| 45 | Not checkable: no GPU | — | K1-25 and K1-26 (the runbook and the owner's run) |
| 46 | Not checkable: no learner | — | K1-0 and K1-29 (owner steps; Q2) |
| 47 | Not checkable: the live site | — | K1-0: "the build hash the live site serves, read from the deployed page" |
| 48 | The search index's headroom: 63 B | Yes (section 4) | No package owns this. k0.md section 10 asks the next wave to make room losslessly first; no package's `what` says so, and K1-8's `what` still counts 757 B. |

### For the owner

Row a is #30's part (a) with the first step of its part (d); rows 1 to 10 are part (b)'s decisions; rows d1 to d4 are part (d)'s other steps. Part (c), Wave 0's owner questions, is in section 5.

| # | Item | Still on the branch | Package |
|---|---|---|---|
| a | Merging #30; checking that #29's two errata carry their ship day (K0-Z-D13) | #30 merged on 2026-11-24. #29's errata are still dated 2026-11-21 (src/data/errata/2026-11-21-paged-waste-not-the-papers-figure.ts, 2026-11-21-vllm-default-block-size-64.ts); #29 merged on 2026-11-22 | No package owns this (an owner decision; see decision 3) |
| 1 | Decision 1: `blk.cow` 16 to 8 and `blk.sweep` 16 to 24 | Yes: the 40-token prompt in src/components/sims/blockTableExplorer.tasks.ts:27, :120 | No package owns this. K2-24 builds on the same sim. |
| 2 | Decision 2: the compile family's hashes moved without a version bump | Yes: commit 07cdf47; src/lib/items/families/compile.ts:54 (`VERSION = 2`); docs/specs/serving-reading.md:483 still says "15 rows identical" | No package owns this. Nearest: K5-5, which touches compile.ts and the compile hash fixture to add T3 snippets. |
| 3 | Decision 3: the errata dates | #30's 71 errata keep their build days (9 dated 2026-11-21, 51 dated 2026-11-22, 11 dated 2026-11-23; with #29's two, 73 files in src/data/errata carry those dates); they are now published, and K0-Z-D5 says published errata are never edited | No package owns this. |
| 4 | Decision 4: five figures taken out instead of made claims, for want of a prefix in homes.ts | Yes (the sentences keep their links) | K5-16 for FlashAttention-3 and -4: "t4.l6 gains A31's 'what changed after 2022' section (FlashAttention-3 and -4, each a claim)"; K3-3 for the T6 and T7 figures (Mooncake, ModelExpress, Epoch AI, SGLang's `enable_mixed_chunk`): "a new claim with the source's own words". K3-3's `touches` include src/data/claims/lazy/ but not src/data/claims/homes.ts, which a new lazy claim needs. |
| 5 | Decision 5: the Rust "Not sure" rule counts frontier probes | Yes | No package owns this (as row 6 above). |
| 6 | Decision 6: t4.l5 question 1's option and t2.l4's stem kept | Yes | No package owns this (rows 9 and 12). |
| 7 | Decision 7: Lab 04 left to the owner | Yes | K4-8 (row 1) |
| 8 | Decision 8: the search index's version 2 encoding | Yes: src/lib/search.ts:55 (`EncodedSearchIndex`) | Nothing to fix. K1-3, K1-8 and K3-1 touch scripts/build-search-index.ts and must keep the encoding. |
| 9 | Decision 9: seven families show steps after their level-1 blank; rollout/long-tail's three instances | Yes: tests/items/worked-leak.test.ts:20 | No package owns this. K2-14 reads rollout.ts to mount a variant. |
| 10 | Decision 10: work beyond the plan; t2.l6 and t2.l7 got fewer errata than asked; the KVBM erratum is "changed" | Yes | No package owns the missing errata. K2-6 touches the KVBM erratum: "supersede the KVBM erratum if its after changes". |
| d1 | Lab 04 and R10 made to agree | Yes | K4-8 |
| d2 | README.md:58 "Nine Rust-to-WASM simulators" | Yes | No package owns this. K1-5, K2-2, K2-8 and K2-19 touch README.md for the lesson counts only; K5-24 (built only on a yes) for N12. |
| d3 | docs/specs/serving-reading.md §5.5 has no row for a Rust item answered "Not sure"; its hash-fixture row is out of date | Yes: docs/specs/serving-reading.md:483 | No package owns this. K1-12 and K1-28 touch docs/prereg/serving-reading.md, a different file. |
| d4 | The owner questions and the scope of the waves after Wave 0 | — | Roadmap section 7 (section 5 below) |

### What docs/specs/k0.md sections 7 and 8 hand on

Items of k0.md section 7 ("What was left out of Wave 0") and section 8 ("What the build cannot verify") that #30's two lists above do not already hold.

| # | Item | Where it is recorded | Package |
|---|---|---|---|
| e1 | K0-D24, `verify-claims --online`: a re-read of every GitHub- and docs-pinned quote at its pin (owner question 23, unanswered) | k0.md section 7 | K3-6: "a seeded 10% sample of quoted claims re-read at their pinned bytes, extending `verify-claims --online` from Hugging Face configs to GitHub raw files at a tag and to HTML pages" |
| e2 | The Wave 3 re-read of 108 tag-pinned claims | k0.md section 7 | K3-7 pre-registers the tag re-read (Q9, unanswered); K3-8 runs it only on a signed keep |
| e3 | A v0.34.0 field note | k0.md section 7 ("the feed is quarterly") | No package writes it. K3-15, only on the owner's yes, makes field notes monthly; "Curating and writing the notes stays the owner's step". |
| e4 | K0-C3's conversion of `synthetic.cost.gpu-hourly` to a price claim in the eager group | k0.md section 7; the F7 row of the ledger table above | No package owns this. K3-14 re-reads the price claims and derives node prices from per-GPU claims, but does not name this claim. |
| e5 | The derived claims of K0-B9 (t4.l1, F10) and K0-C3 (t7.l4, F7) | k0.md section 7; the F7 and F10 rows above | K3-3: each chip and dated sentence of T4 to T7 "cites an existing claim, a new claim … or a synthetic or derived claim" |
| e6 | K0-A9's sweep of the thirteen other simulators: the embedded simulators of t5.l8 to t5.l10, t6, t7 and Rust Zero were not checked | k0.md section 7; the L6 row above | No package owns this. K1-32 covers only t4.l3's chart. |
| e7 | Five sources left unsettled: reading speed (through secondary pages), the released glibc 2.43 tree, whether Dynamo's v1.5.0 notes were edited, the H100's shared-memory bandwidth, and "85-95% shared prefix", which has no source | k0.md section 8, "Sources move" | No package names them. K3-4 (T0 to T3) and K3-3 (T4 to T7) re-read their tracks' claims at source as part of their inventories. |

### Count

70 items: 48 under "What is still wrong or open", 15 under "For the owner" (the merge step, ten decisions, four steps) and 7 handed on by k0.md sections 7 and 8. Owned by a package: 26 (rows 1, 5, 11, 15, 16, 17, 18, 19, 23, 24, 25, 26, 30, 31, 32, 40, 44, 45, 46, 47; decisions 4 and 7; step d1; e1, e2, e5). Nothing for a package to fix: 2 (decision 8, step d4). No package owns: 42 (28 under "What is still wrong or open", 10 under "For the owner", 4 handed on by k0.md).

The unowned items, in short: the seccomp citation and the missing t2.l6 and t2.l7 errata; the dated median's quote; t5.l7's explanation; the placement rule; the repeated explanations and the Checkpoint; the 91 figure spills; t4.l5's option and t2.l4's stem; the older generator families and the rollout instances; the home page's analogy line and NVMe ticker; t4.l4's "order of magnitude"; t5.l5's fork listing and the block-table size list; the compile bank's wording; nine app faults (held arrow key, Space, the saved-answer race, F3's count, curly quotes, the claims table above 640 px, diagram text size, edge ends, chip hints by keyboard and phone); the nits; two unverifiable measurements; the search index's headroom; the errata dates and #29's two errata; the compile family's version; blk.cow and blk.sweep; README.md:58; serving-reading.md §5.5; the v0.34.0 field note; `synthetic.cost.gpu-hourly`'s conversion; the unchecked embedded simulators; and the five unsettled sources.

## 4. What Wave 0 changed that later waves must build on

| Rule or guard | Where |
|---|---|
| Lessons read claim values from the snapshot `src/data/lessons/claims.generated.ts` through `src/data/lessons/claims.ts` and never import `@/data/claims`, its `cite` module or a lazy group. After changing a claim a lesson reads, run `bun scripts/gen-lesson-claims.ts`; `--check` runs in the unit suite. | K0-Z-D12; tests/claims/lesson-claims.test.ts, tests/claims/k0-e2-cli.test.ts, tests/claims/k0-e2-imports.test.ts |
| A lazy claim's id prefix needs a line in `LAZY_GROUP_HOMES`; Wave 0 added none after K0-D0, and took five figures out rather than add one (decision 4). | src/data/claims/homes.ts; tests/claims/lazy.test.ts |
| The ⌘K index's budget is 20,480 B gzip and frozen. On the branch it is 20,417 B, 63 B of room, about one claim row: Bun's `gzipSync` over src/data/search-index.json (the measure the gate uses), after `bun run verify:search-index` passed ("19.9 KB gzip of 20"), so the file is current. Room is made losslessly first; leaving a group out (`UNINDEXED_GROUPS`) needs the owner's answer. K1-8's `what` ("757 B … left") predates Wave 0. | scripts/verify-search-index.ts:20; scripts/build-search-index.ts:34; K0-Z-D16; k0.md section 10 |
| The index is version 2 (`EncodedSearchIndex`), decoded by the palette; a change to the builder keeps it decoding to the same rows. | src/lib/search.ts:55; tests/search/k0-z3-encoding.test.ts |
| Every correction of a published fact adds one erratum module; published errata are never edited. | K0-Z-D5; k0.md section 4, "Errata" |
| An erratum dated 2026-11-21 or later must carry an https source with a title. | tests/content/k0-close-a.test.ts:146 |
| Errata dates are the day each was written; whether to move them to the ship day (decision 3, K0-Z-D13) is unanswered, and `verify-errata` refuses only a future date. | k0.md K0-Z-D13; #30 decision 3 |
| The figure-fit test's list of known spills (91) may only shrink; a figure edit must not add one. | tests/lessons/diagram-fit.test.ts:56 |
| The feedback lint's two lists (14 verbatim, 2 paraphrases, at most 16) may only shrink. | tests/items/feedback-dedupe.test.ts:216 to :242 |
| The signpost scan fails lesson data that names a wave, a build-plan section, a stale lesson count or a lesson id that does not exist; a true statement narrows the rule, never an allow-list. | tests/lessons/signposts.test.ts:4 to :10 |
| Saved answers: items are stored by position with a fingerprint of stem, options and key; a generator change bumps the family's `version` and moves only that family's hash fixture. No lesson id, track order, path, ring, sim task id, Fleet exercise id or KC id changes. | k0.md section 4, "Saved answers"; K0-Z-D2; tests/fixtures/items/hashes/ |
| Worked steps at levels 0 and 1: the blank is the last step shown and no other step equals the answer, except the seven exempt families. | K0-Z-D17; tests/items/worked-leak.test.ts |
| Engine pins: vLLM v0.34.0 and SGLang v0.5.23. vLLM's default block is `production.vllm.block-size` (64), stated with `ENGINE_BLOCK_SCOPE`; the paper's 16 is `serving.pagedattention.paper-block-size`. A typed default fails the build. | src/data/claims/engines.ts:10-11; src/data/lessons/claims.ts:24; K0-Z-D14; tests/content/vllm-block-size.test.ts |
| "Under 4%" is the course's estimate (`synthetic.kv.paged-waste`); the guard catches "<4%" and its variants. | K0-Z-D14, K0-Z-D15; tests/content/vllm-block-size.test.ts |
| The first-load entry chunk is 349,812 raw bytes (115.7 KB gzip) and may not grow by a byte. | K0-Z-D6, K0-Z-D12; #30 "Sizes and frozen files" (not re-measured here) |
| Field Notes are not re-issued during the quarter; a correction's date lives in its erratum and claim. | K0-Z-D10 |
| `/glossary` is in the accessibility sweep. | scripts/a11y.mjs:60 |
| A lesson heading's link id is its slug. A task that renames a heading adds an old-to-new row to the alias map, and a task that adds a heading adds its slug to the headings fixture; the test fails otherwise. The map has rows for t2.l7, r.l8 and t6.l2, which K2-4, K4-7 and K2-10 edit. | K0-E7; src/pages/lesson/anchor-aliases.ts:1-7; tests/lessons/k0-e7-anchor-aliases.test.ts; tests/fixtures/lesson-headings/slugs.json; e2e/k0-e7-anchor-alias.spec.ts |

## 5. Owner decisions waiting

The ten decisions of #30's description ("For the owner" (b)), all unanswered:

1. Two graded block-table answers moved (`blk.cow` 16 to 8, `blk.sweep` 16 to 24) to match t5.l5's 40-token figure (owner question 9).
2. The compile family's hashes and the Error Museum's checksum moved without a version bump: bump the version, or record that a stem-only bank change may move legacy rows.
3. The errata keep their build days (2026-11-21 to 2026-11-23), or move to the ship day as K0-Z-D13 moves #29's two.
4. Five figures were taken out rather than made claims, because a claim needs a prefix in homes.ts.
5. Placement's rule for a Rust "Not sure" counts every probed idea, frontier probes included: confirm, or narrow it to core ideas.
6. t4.l5 question 1's keyed option and t2.l4's stem stay, to spare saved answers the changed note.
7. Lab 04 is left to the owner.
8. The search index's version 2 encoding keeps the budget without dropping a claim group.
9. Seven generated families show steps after their level-1 blank; rollout/long-tail prints the answer in 3 of 4,000 instances.
10. The work beyond the plan (the closing check, groups A to J), and the tasks that wrote fewer errata than asked.

The roadmap's own owner questions, section 7, are all unanswered: 32 questions, Q1 to Q32, in seven groups (A: Q1; B: Q2, Q3; C: Q4, Q5; D: Q6 to Q9 and Q32; E: Q10 to Q15, Q28, Q29; F: Q16 to Q22; G: Q23 to Q27, Q30, Q31). So are Wave 0's owner questions 1 to 27 and rows A to H (k0.md section 6, whose status line says no owner question is answered).

## 6. Not verified

- Master itself. This clone does not hold master after #29 or #30 (nothing was fetched); that master's tree equals the tree #30 merged, and that the deploy ran, are not checked. The merge times are GitHub's `mergedAt`, read with `gh pr view`.
- The app items of section 3 (rows 22 and 28 to 40) and several older lesson faults were not reproduced; "Not checked" says so where grep could not settle them. Row 26 was not found by a fixed phrase.
- The suites: I ran lint and `verify:search-index` only. No unit, browser or accessibility suite, no build and no bundle check; the entry-chunk figure is #30's.
- Which finding ids the follow-up tasks (K0-E1 to K0-E11, K0-Z3, K0-Z4) and the closing groups close is my reading by lesson; the task list that records it is not in the repository.
- Whether each owned item in section 3 is in a package's scope is a judgment from its `what` and `touches`; the planners did not see these items.
- The values of `blk.cow` and `blk.sweep` were not recomputed; the 40-token prompt was read in the task file.
- Claim staleness was computed as `verifiedAt + ttlDays` over public/claims.json, the rule src/data/claims/index.ts:51 states; it was not run in the app.
