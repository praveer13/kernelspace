# The owner's side against the draft roadmap (waves 1 to 5)

> This is a review of the draft roadmap, written on 2026-11-21 by a reviewer asked to argue the owner's side (the "owner's advocate"); it is not the owner's own text. It read the planners' draft package files (not in the repository) against the course at master d478f91. Its counts and its question letters (Q-A to Q-H) belong to that draft; [roadmap.md](roadmap.md) section 9 says how each finding was applied. It is a plan, not a record: only Wave 0 has been built ([docs/specs/k0.md](../specs/k0.md)). The text below is unchanged apart from this note and the plain descriptions that replace references to files not in the repository and details of where the private reference solutions are kept. What has changed since is in [after-wave-0.md](after-wave-0.md).

Read: the planners' package files for waves 1 to 5 (not in the repository), whole (python3 -I); docs/audit-2026-11/report.md sections 2.1, 3.4, 4 (O, L rows), 5, 6, 7, 8; in the export at d478f91: PLAN.md, PLAN-WORLDCLASS.md, PLAN-100X.md, NEXT.md, NEXT-COURSES.md, the decision and owner-question tables of docs/specs/wave-1.md, wave-2.md, wave-3.md, s5.md and serving-reading.md, every file in docs/prereg/, src/data/errata/schema.ts, src/lib/economy-table.ts, src/lib/economy.ts, src/lib/kc/resolve.ts, the forge bundles' `fade` fields, tests/learner/paths.test.ts, .github/workflows/labs.yml. Not read line by line: the bodies of wave-1/2/3.md and s5.md past their decision tables (1 MB), docs/100x-evidence, docs/backtest JSON. Line numbers below are in the export.

Labels: **reverses** (reopens a recorded decision), **question** (an owner choice the planner did not ask), **too big** (more than the report's evidence), **flattens** (touches a section 6 item), **default** (not the cheapest to undo), **note** (keep the package, change the brief).

---

## 1. Findings that cut across every wave

### 1.1 Review hours: the roadmap ignores the owner's own capacity rule (reverses)

PLAN-100X.md:674: "Review hours are the binding constraint. Code QA is costed at 4, 8 or 20 h per S, M or L". :676: "A wave starts only when the previous wave's queue is under 10 h." :827 OD11: 10 h a week. :733: steady state "≈4.5 h/week [estimated], against a ≤4 target".

The five files give agent-days only. Costed by the plan's own rule (S up to 3 agent-days = 4 h, M up to 2 weeks = 8 h, L = 20 h), the 111 packages are about **692 hours of owner review**: W1 136, W2 152, W3 84, W4 108, W5 212, before content, partner and accessibility hours. At 10 h a week that is about 69 weeks. The order fields then run waves side by side: W3 "in parallel" with W2, K4-1 "start now, beside Wave 0", W5 "start at once and in parallel", W1 "five or six agents in parallel". wave-3.md D1 records why the last waves went linear ("Wave 2's 2b and 2c ran in parallel, never merged each other, and still conflicted").

Change: every package gets an owner-review estimate by the plan's S/M/L rule. Owner question (Q-A below): weekly review hours, and whether waves may overlap. Default, cheapest to undo: agents may build ahead on branches, but no more than about 10 h of review sits in open PRs at once; the rest waits as unopened branches in wave order.

### 1.2 The audit's "before anything" step is planned by nobody (question)

docs/audit-2026-11/report.md section 7: "Watch five newcomers on t0.l1, r.l1 and t2.l1. It is the cheapest test of this report and the owner's own unmet gate ('≥5 partners complete the block-placement loop'); it should precede the months of work, not accompany them." PLAN-100X.md:689 holds that gate. The Wave 0 run's files (not in the repository) do not plan it. K1-29 watches newcomers only after K1-5 has shipped. So W1 rewrites t0.l1 (K1-7) and adds t0.l7 (K1-6) before anybody has seen a newcomer on the current first hour.

Change: add an owner step at W1 stage 0. The build prepares the kit (task script, think-aloud protocol as an unsigned docs/prereg draft, observation sheet, partner-report minutes per step) aimed at the current t0.l1, r.l1 and t2.l1. Ask it with K1-29 as one question (Q-C). Default: no sessions. W1 goes ahead and its report says the wave was not checked against any learner.

### 1.3 New block types beyond the plan's cap (question)

PLAN-100X.md:601: "New block types (cap four): predict, item, play, protege." wave-2.md:1276 refused one for that reason ("not a new block type: the plan caps new block types at four"). serving-reading.md SR-D4 went past the cap once (`reading`). The roadmap adds up to four more: `history` (K3-9), a twin block (K2-3, "if TwinPanel cannot be mounted"), a chart block (K2-16), an embeddable calculator block (K2-19). Owner question Q-F. Default: no new type. Mount through existing blocks: history as a callout kind; twin, chart and calculator through `exercise` or `play` mounts.

### 1.4 Wave 2 and Wave 3 disagree about claim tokens and history blocks (note)

W2's notes: chips name the claim id in a hint, "Wave 3 converts them", and dated "since then" sentences use a callout until Wave 3 adds a history block. W3's order: K3-1 "must merge before Wave 2's content PRs". If both run as written, every W2 lesson is re-sourced twice (K3-3 then sweeps it). Change: move K3-1, and the history-block decision (Q-F), to W1 stage 0, beside K1-1 and K1-3. They change nothing a learner sees.

---

## 2. Package by package

Packages not listed here have no finding.

### Wave 1

**K1-2 (structure spec), note.**
(a) Reserve N4's slot too. K5-22 puts a queueing lesson first in T7, and the spec reserves only t5.l11, t6.l14, t7.l6 and t3.l8. docs/audit-2026-11/report.md section 5.6: "Do every move, split and addition in one structure release, before design partners arrive." Without the slot, K5-22 makes a second structure change, as its own risk line admits. Add an unlabelled slot for N4, plus conditional slots for N12 (T6) and N14 (T4), which cost nothing while unused.
(b) In the rings question, option (b) contradicts PLAN-100X.md:297 ("Rings derive from the ledger, never revoke") and economy.ts:189 ("never revoked or gated (W8)"). Say so in the option text. Option (c) is the nearest to that rule.
(c) wave-3.md D79 wrote tests/economy/table.test.ts so that "any other new T6 or T7 lesson must join the list": it forces this question. The default should not become a silent filter. Keep a named, dated exclusion list that the test reads.

**K1-3 (citation tokens), note.** It claims "every lesson renders byte-identical". But quizRev, prequestionRev and constructedRev hash the source fields (src/lib/kc/resolve.ts:35-52: `q`, `options`, `correct`, `prompt`, `model`, `ideas`). A codemod that turns "T2.L3" into a token inside those fields changes the rev of every answered item that cites a lesson. Each one is then re-pointed, and PLAN-100X S1 flags them "re-check". Change: the codemod skips hashed fields, or revs are computed on resolved text. K1-1's guard must show zero rev changes for this PR.

**K1-5 (structure release), note.** t3.l7 is a spiral lesson (economy-table.ts:89 SPIRAL_LESSONS). PLAN-100X.md:296: "Tracks end in spiral checkpoints". Reading t3.l6 and t3.l7 after t5.l10 (O8, which the report does recommend) means T3's spiral comes after T4 and T5 on the full ramp. The spec must state where T3's run ends on each path and that the spiral checkpoint keeps its meaning. Count pins: derive them, or every new-lesson package fights over README.md and index.html (K1-5 says 71, K4-6 still says "69 to 70").

**K1-22 (small things at the door), reverses.** It moves Boot step 6 "after the first lesson". PLAN-100X.md:496: Boot "ends with a value prompt (job and no-job variants), the path, *Set your week*, optional placement"; :486 "*Set your week* (in Boot)". Owner question Q-F. Default: collapse step 6 to one choice inside Boot, still writing boot:week, rather than move it. The step 3 regrade and the course nouns go ahead.

**K1-26 and K1-29: owner steps.** Correctly framed. Ask K1-26 together with K5-25's GPU session (Q-B), and K1-29 with 1.2 (Q-C).

### Wave 2

**K2-2, K2-8, K2-19 (rings).** These are one question with K1-2's (Q-D). Asked three times, it invites three answers.

**K2-7, note.** wave-2.md D15 and Q14: "DeepSeek-V4 ships only if its config is public ... otherwise CSA/HCA appears as a labelled synthetic example." The V4.1-Flash zoo preset needs the same condition. Today the brief only says "from its config if absent".

**K2-8 (N16), note.** Its left-out reason ("gated by the owner to 2027-10") is stale. S5 ran (docs/specs/s5.md S5-D69: `frontier` killed by rule 1, η-free `step` variants shipped). Under S5-D15 and S5-D57, a `step` item grades arithmetic only, and decisions graded against measured values carry H1. The new "which term dominates" variant against published apportionments is such a decision. Make it arithmetic on the stated terms, or ungraded.

**K2-12 (t6.l5), note.** PLAN-100X.md:571: "No lesson rests on hardware without a public spec sheet and an independent benchmark." The Rubin row (shipped 2026-11-17 by NVIDIA's own word) and the AMD row need that status shown per row. The plan already asked for Rubin presets with the discrepancy flagged (PLAN-100X.md:543).

**K2-16 (t7.l3 frontier), note.** S5 killed the only graded engine exercise planned for t7.l3 (s5.md S5-D16, S5-D69). The chart must stay ungraded. No new graded decision against the plotted measured points without S5-D15's H1.

**K2-19 (N9), note.** It prices buy, rent or API on the BYO calculator, which runs the fleet worker's flat 50 ms tick. PLAN-100X.md:524 labels exactly that: "[derived, v1 flat-tick physics; not a real-world $/Mtok]". A decision lesson should take g for R70 from published measured throughput claims (or S5's napkin card) and use the calculator only for structure.

**K2-20 (N8), note.** Option (b), offering the Daily only after the section is read, is a lock. wave-1.md:86 W8: "Nothing locks." Label (b) as reversing W8. The default (a) is right. Moving the `sig` items also changes when the four fault KCs' cards are created. The signed fleet-daily.md counts checks "≥30 local days after that KC's card was created", so the release date goes into a dated amendment the owner signs (Q-E).

**K2-21 (Fleet and Daily), note.** It changes what the Daily's probes print while docs/prereg/fleet-daily.md (signed 2026-10-14) is collecting. Record the release date in a drafted dated amendment so the Wave 3 exit reading can split before and after (Q-E).

**K2-3, K2-16, K2-19 (block types).** See 1.3 and Q-F.

### Wave 3

**K3-1, note.** Schedule it in W1 stage 0 (1.4).

**K3-5, note.** The roadmap gives every named product a status claim with a 60-day life, against PLAN-100X.md:733's steady state of about 4.5 h a week (target 4 or less). The PR should count the distinct products and print the renewals per month that K3-6's weekly issue will raise.

**K3-7, note.** The tag window v0.31.0 to v0.34.0 is one whose answer the audit already knows (the block size). watcher.md:23: "A better matcher is a new matcher: it is scored on a new window". Keep the snapshot window as the primary test and report the known-outcome tags separately. Bar item (1) is fine as a stated must-flag, not as evidence.

**K3-9 (history kind and errata rule), too big, flattens, question.** Its CI rule "a claim whose value or pin changes needs an erratum naming it" is not in the report (sections 2.1 and 7 ask for a history kind, not an erratum per claim change). Errata mean "the course was wrong" or "the field moved and the course caught up" (src/data/errata/schema.ts:15) and come back to learners as review cards (section 6 item 9). Under this rule every routine re-pin would become a change card. Change: an erratum only when a value rendered in lesson text changes; pin-only re-pins need none; the check reports and does not fail. The `history` block is a new block type (1.3, Q-F). Note that the `changed` kind already covers "the field moved".

**K3-12 (R's first sweep), reverses.** Its separate commit moves the compile bank from rustc 1.96.0 to the current stable. labs.yml:38: "Pinned so a new stable release never changes lab results under a PR". wave-2.md D17 ties the bank to the labs' pin. K4-16 treats the same move as owner-gated, so the roadmap contradicts itself. PLAN-100X.md:567 does schedule "Quarterly: ... compile-bank and Miri pin updates", so it is a real owner choice. Change: drop the pin commit from K3-12 and ask it once with K4-16 (Q-G). Default: stay on 1.96.0. K3-11's non-blocking nightly step already shows A47's flip.

**K3-14, note.** PLAN-100X.md:572 says "TTL of ≤90 days", so 30 days is inside the owner's rule. The question is the owner's re-read hours (price re-reads triple), not a change of rule. The default (90) is fine, but say "as the schema has it", not "as the plan says".

**K3-15.** Correctly framed.

### Wave 4

**K4-1 (lab baseline), default.** Its default "attach a tarball of new and changed private files ... to every lab PR" would publish the references and mutants on a public repository. wave-1.md O1: "never committed or packed". PLAN.md:337: "solution in [the private reference solutions] (never shipped in the zip)". O1 already answers who writes references ("Agents write them locally under [the private reference solutions]"). The only open point is where the files persist between worktrees. Default: the tarball stays in the scratchpad, the PR body gives only its path and sha256, and nothing is uploaded.

**K4-3 (r.l10, t2.l5), note.** Its deps and the W4 order wait for "Wave 1 (O6 with N7 reorders T2)". The audit refused that reorder (docs/audit-2026-11/report.md O6 row; section 8 "The reorder of T2 (O6)" cut), and K1-14 keeps T2's order. Drop the dependency.

**K4-5 (R tickets), note.** A ticket creates FSRS cards (PLAN-100X.md:485, capped at 1.2 a day), so Today's load grows for every R learner. wave-1.md O5 (an R checkpoint of 80% or more counted as passed until tickets exist) ends for R. Both belong in the PR text.

**K4-6 (N2), note.** N2 joins T3, and RING1_LESSONS is "every T3 and T4 lesson *done*" (economy-table.ts:99). The package touches no economy file and asks only about the drill. It rides Q-D: add tests/economy/table.test.ts to its touches, and fix the stale "69 to 70".

**K4-8 (lab 04 orderings), reverses.** It moves the algorithm and the ordering cheatsheet out of queue.rs "for ladder rungs R3 and R4". Labs 04 to 08 have no R3 or R4: wave-3.md D13 ("hint ladders R0–R2 and then the packet"), D26, Q3; src/data/forge/mpmc-queue/index.ts:23 `fade: 'r2'`. Change: the material leaves the learner's file and goes into an R2 idea within its limit (as K4-13 does), unless the owner answers the fade question (Q-G) for lab 04.

**K4-10 (lab 02 values), question.** Lab 02 (kv-block-manager) is in the signed hint-ladder experiment: docs/prereg/hint-ladders.md section 2 randomizes "each red check of labs 01 to 03", section 3 reads each check's KCs from labs.ts, and "nothing below changes after it except by a dated amendment". K4-10 adds a copy-on-write read-back check, demotes the capacity check and adds a dump stage. Owner question Q-E. Default: build it but hold the merge until the owner signs an amendment that keeps the new and changed checks out of the randomization (whole ladder, no arm, as labs 04 and later are).

**K4-11 (lab 06 headroom), reverses.** Same as K4-8: "leaves scheduler.rs for ladder rung R4" while src/data/forge/batching-scheduler/index.ts:24 has `fade: 'r2'` ("no R3, no R4").

**K4-13 (lab 07), note.** Its fade question names labs 07 and 08 only. K4-8 and K4-11 depend on the same answer for labs 04 and 06. Ask it once for labs 04 to 08 (Q-G).

**K4-15, note.** Option (b) in the regrade question ("the lab reopens for everyone and rings recompute") contradicts PLAN-100X.md:297 ("never revoke"). Label it so. The default (a) is right. Ask it with Q-D.

**K4-17, K4-18.** No finding. K4-18's real run and ARM run go into Q-B.

### Wave 5

**K5-7 (T2 simulators), too big.** docs/audit-2026-11/report.md D5: "Say on the page when a simulator is a model, or make it real." K5-7 does a third thing, rebuilding three simulators as discrete-event mechanisms (10 days), on top of K5-9's real readings. Change: model labels, predict, run and explain tasks, slices, and VmPagingSim's log scale (about 4 days). The mechanism rebuild becomes an owner question or later work.

**K5-10 (R pass), flattens.** It adds prequestion blocks to r.l3, r.l4, r.l8 and r.l9, the plain voice that section 6 item 13 keeps. docs/audit-2026-11/report.md D3 already counts these four as asking "which line is rejected, within 450 words". Change: name them exceptions in K5-1's shape check, as t3.l1 is, and limit K5-10 to r.l1, r.l2 and r.l4's moved limits.

**K5-11 to K5-16 (option shortening), note.** Shortening about 600 options changes quizRev for each (resolve.ts:35), which re-points refs and raises S1 "re-check" flags for every learner who answered them. wave-3.md D43: "A misconception's distractor is never replaced". Keep option ids and miss ids, add the rows to K1-1's allowlist, and say in each PR how many answered items it re-points.

**K5-22 (queueing lesson), note.** It needs K1-2's reserved slot (above). Its touches include kc/migrations.ts "if needed", but K1-1 pins KC_MIGRATIONS empty because only fold.ts applies migrations. A migration needs the readers fixed first.

**K5-1, K5-23, K5-24, K5-25, K5-26.** Correctly gated, with cheapest defaults.

---

## 3. Owner questions, merged

Each question gives the options, the default if the owner says nothing (the cheapest to undo), and what waits on the answer.

**Q-A. Review capacity.** How many review hours a week, and may waves overlap? (PLAN-100X.md:674-677, :827.) Options: the plan's 10 h and its gate; more hours; overlap allowed. Default: agents build ahead on branches, at most about 10 h of review in open PRs, PRs opened in wave order. Waits: when PRs open, not what is built.

**Q-B. Hardware sessions.** One question covers K1-26 (two field labs on a rented H100, at most 1.5 GPU-hours each; the public `ranBy` name), K5-25 (N14's profile capture: run it in the same pod if wanted), and K4-18 items 1 and 2 (the real-engine run on the owner's own machine; the ARM run of K4-8's script). Default: nothing runs, and pages keep "Not run on a GPU yet" or "not run by the course yet". Waits: N16's measured row, N14, K4-8's ARM line, K4-17's "run by the course".

**Q-C. Learner sessions.** One question covers 1.2 (five newcomers on the current t0.l1, r.l1 and t2.l1, before W1's content), K1-29 (after the release), K4-18 item 3 (timed learners on the Rust ramp and labs) and K5-26. All need a signed think-aloud protocol first (PLAN-100X section 9). Default: no sessions; the kits are merged and the wave reports say "unvalidated". Waits: measured minutes and any change the sessions ask for. No build waits.

**Q-D. New lessons, rings and regrades.** One question covers K1-2, K2-2, K2-8, K2-19, K4-6, K5-22, K5-24(b), K5-25(b) and K4-15. Do new lessons join RING 2, RING 1, RING 0 or ROOT, given "never revoke" (PLAN-100X.md:297)? Does a lab's earlier green stand when the lab gains a check? Options as in K1-2, with (b) marked as revoking. Default: ring lists unchanged, new ids on a named exclusion list, earlier completions stand. Waits: economy-table.ts lists and their test only.

**Q-E. Running experiments.** One question covers: the unsigned serving-reading draft (K1-12's gloss, K1-28's host move: amend before signing); the signed hint-ladders.md (K4-10's new lab 02 checks: amendment); the signed fleet-daily.md (K2-20's section move and K2-21's probe change: dated release notes as amendments); docs/prereg/tag-reread.md (K3-7: sign or amend the bar, launch the blind rater). Defaults: draft amended in the K1-12 PR; K4-10 held unmerged until amended; Daily changes ship with a drafted amendment awaiting signature; tag re-read unsigned, so K3-8 is not built. Waits: K4-10's merge, K3-8.

**Q-F. Changes to the owner's recorded rules.** The Boot ending (K1-22, PLAN-100X.md:496); new block types (K3-9, K2-3, K2-16, K2-19; PLAN-100X.md:601); 30-day price life (K3-14); monthly Field Notes (K3-15; PLAN-100X.md:567, NEXT.md:7); the "isomorphism" name (K5-1). Defaults: Boot keeps step 6 collapsed in place; no new block type (existing mounts); 90 days; quarterly; name kept. Waits: one sentence or one field each.

**Q-G. Labs and toolchain.** Where private references persist (K4-1; O1 already says agents write them locally); the faded ladder for labs 04 to 08 (K4-8, K4-11, K4-13); N2's drill crate (K4-6); loom (K4-9); lab 06 step time (K4-12); the lab 08 split (K4-14); rustc and edition re-pin, including K3-12's compile-bank commit (K4-16; labs.yml:38; PLAN-100X.md:567). Defaults: scratchpad tarball, never uploaded; fade kept and scaffolds go to R2 ideas; compile-bank items only; no loom; no step time; one lab; stay on 1.96.0 and edition 2021. Waits: K4-6's crate, K4-9, K4-12, K4-16, the ladder rungs.

**Q-H. Optional scope.** T3 off the default ramp (K1-20); the full R rewrite (K5-23); N12 (K5-24, reopens the 2026-10-24 catalog cut); N14 (K5-25); K5-7's mechanism rebuild (2, above). Default: none built. Waits: nothing else.

---

## 4. Safe to build before any answer

These need no answer: K1-1, K1-3 (with the rev fix), K1-4, K1-6, K1-7, K1-8, K1-9, K1-10, K1-11, K1-13, K1-14, K1-15, K1-16, K1-17, K1-18, K1-19, K1-21, K1-23, K1-24, K1-25, K1-27, K1-28; K2-1, K2-4, K2-5, K2-6, K2-7, K2-9, K2-10, K2-11, K2-12, K2-13, K2-14, K2-15, K2-17, K2-18, K2-22, K2-23; K3-1, K3-2, K3-3, K3-4, K3-5, K3-6, K3-11, K3-13, K3-12 without its pin commit, K3-14's refresh half; K4-2, K4-3, K4-4, K4-5, K4-7, K4-17; K5-2, K5-3, K5-4, K5-5, K5-6, K5-8, K5-9, K5-11 to K5-16, K5-18, K5-19, K5-20, K5-21, K5-10 in its reduced form, K5-7's label half.

These can ship at their default, because the answer changes only a list, a label or a line: K1-2, K1-5, K1-12, K1-20, K1-22 without the step 6 move, K2-2, K2-8, K2-19, K2-20, K2-21 (with the drafted amendment), K2-3, K2-16 and K2-19 through existing block mounts, K3-9 as a callout kind under the narrowed errata rule, K3-10, K4-1 (scratchpad default), K4-6 as lesson plus compile-bank items, K4-15, K5-1, K5-17, K5-22.

These wait for an answer: K1-26, K1-29, K3-7's scoring, K3-8, K3-15's cadence change, K4-8 and K4-11's scaffold moves (until Q-G, or rewritten to R2), K4-9, K4-10's merge, K4-12, K4-13's full ladder, K4-14's split, K4-16, K5-23, K5-24, K5-25, K5-26, K5-7's mechanism half. Q-A governs when any PR is opened.

## 5. Steps only the owner can take

Merging every PR. Weekly review hours (Q-A). Recruiting and watching newcomers, and signing the protocol first (Q-C). Renting the H100 and pasting outputs, choosing the public `ranBy` name, the own-machine real-engine run, the ARM run (Q-B). Signing or amending serving-reading.md, hint-ladders.md, fleet-daily.md and tag-reread.md, and launching or approving the blind rater (Q-E). Curating Field Notes at the chosen cadence. Answering Q-D, Q-F, Q-G and Q-H.
