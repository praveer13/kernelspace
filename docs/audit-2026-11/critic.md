# Critic: roadmap for audit waves 1 to 5

> This is the critic's review of the roadmap, written on 2026-11-21 against an earlier draft of it (117 package rows), the advocate's review, the audit report and the course at master d478f91. Its findings were applied in [roadmap.md](roadmap.md) section 15, so some of what it calls missing is in the published roadmap. It is a plan, not a record: only Wave 0 has been built ([docs/specs/k0.md](../specs/k0.md)). The text below is unchanged apart from this note and the plain descriptions that replace references to files not in the repository. What has changed since is in [after-wave-0.md](after-wave-0.md).

Read: the draft of roadmap.md (not in the repository) and packages.json (117 rows), advocate.md, docs/audit-2026-11/report.md (sections 3, 5, 6, 7, 8, Appendix A), the Wave 0 plan and task list, not in the repository (re-read at 00:45, 101 tasks, still being edited by the Wave 0 run), and the tree at d478f91. Scripts, not in the repository: an id census (with its output) and a check of touched paths. Nothing in any repository was changed; no web request.

Verdict: **fix-first.** No finding id is lost outright, but one report fix (L6's second half and the t4.l3 task cut) falls between Wave 0 and this roadmap, two of section 5.4's planned items have neither a package nor an owner question, the owner's P4 comparison (section 6 item 3) is missing, and a dozen packages still carry the planner's text that the roadmap overruled, so a builder given `what` and `done_when` builds the version the roadmap rejected.

## 1. Completeness

Census (regex over docs/audit-2026-11/report.md; table rows for F, O, N7-N18, M, A; bold paragraphs for L, D, N1-N6, N9, N12, N14, N16): **131 ids**: F 14, O 16, L 15, D 10, N 18, M 9, A 49.

| Placement | Count |
|---|---|
| Wave 0 only (findings of the Wave 0 task list, not in the repository) | 34 |
| Waves 1-5 packages only | 64 |
| Both (Wave 0 does part, a package the rest) | 33: F2 F3 F4 F5 F6 F7 F11 F12 O11 O15 L2 L9 D2 N4 M3 A4 A5 A11 A12 A14 A18 A21 A22 A25 A26 A28 A30 A33 A34 A37 A44 A47 A48 |
| Nowhere | 0 by id |

No id is absent. But an id being named is not its fix being planned:

- **L6 (and section 5.6 "t4.l3's eight tasks to four") is half-orphaned.** Wave 0 does only the rendering (K0-A8, A9, A9b, A10). The Wave 0 plan's section 7 (not in the repository) hands "K0-A11 t4.l3 fig 1 as a drawn log-log roof ... Wave 1" and lists "t4.l3's task set and the 'prediction held' tolerance: grading decisions" as not planned; its owner-question table (1-26) has no t4.l3 row. The roadmap plans none of it and says the opposite: section 10 "t4.l3's eight tasks to four (section 5.6), which Wave 0 put to the owner"; K1-18's risk "Wave 0 rebuilds t4.l3's roofline rendering and cuts its tasks to four (L6)"; K5-16 "t4.l3 (after W0's L6 rebuild)". Nobody draws the roof in the reading column, opens the full-screen lab with this lesson's tasks, cuts eight tasks to four, or fixes "Your prediction held. You said 295 requests; the sim measured 512".
- **A46's anchor rename**: section 10 "left with the Wave 0 run"; the Wave 0 plan's section 7 lists "A46's Museum anchor rename" as left out. Owned by nobody.
- Section 10's "Left with the Wave 0 run" bullet is wrong for its other items too: "L7's knee pass rule" is in Wave 0's not-planned list (not required by the report, so it belongs in "will not be built"); L1's recommend() change is not needed (K0-A1 to A3 close L1).
- **Section 5.4, "As sections, if wanted"** (tensor cores and a modern kernel in t4.l6; MPS or MIG; quality as an axis in t4.l7 and t7.l3; one worked million-token request in t6.l4; containers as cgroups and namespaces for t6.l10): no package, no owner question, not in section 10. "If wanted" is the owner's call; it needs a question with default "not built". (Reasoning traffic, the sixth item, is M9 and is planned.)
- **Section 5.4, "labs 02, 06 and 07 as stages of the engine the Fleet already wires five crates into"**: section 10 drops it as "not in any wave of section 7". The report plans it ("After that") in the labs paragraph that Wave 4's D9 and L14 come from. "All of the improvements" makes this an owner question (default not built, asked after K4-17), not a silent cut.
- **No ledger of which package closes which id.** For the 33 split ids the roadmap never says which part each side closes (F3 alone: K0-B6, K0-B7, K3-9, K2-3, K2-4). Add an id table: id, Wave 0 task(s), package(s), what each closes, or the section 10 reason.

Ids in two or more packages: every pair has a PR order and section 5 or a package states the split for each, except the stale-text cases in section 4 below (K5-7 against K5-7b, K4-6 against Q18) and K1-27 against K1-5 (O7).

## 2. Truth (touches opened in the tree)

Every non-new touched path exists, apart from files a dependency creates (ref-revs.json from K1-1, baselines from K3-2 and K5-1, freshness scripts from K3-6). Checked against the tree:

| Package | Checked | Result |
|---|---|---|
| K1-1 | canonicalRef only in fold.ts foldInto (:117-118) | holds |
| K1-3 | Lesson.tsx:997, LessonRow.tsx:118 `L{lesson.index}`; 123 files cite T#.L# | holds (count of citations depends on scope; 332 in lessons, kc and labs.ts, 520 in all of src by a looser regex) |
| K1-5 | SERVING_READING_HOSTS (outcomes.ts:2345), ring lists (economy-table.ts:91-128) | holds |
| K1-8 | search index 20 KB gzip budget (verify-search-index.ts:20) | holds |
| K1-9 | Lesson.tsx:716-717, :922-925; Curriculum.tsx:390-391; Track.tsx:209; You.tsx:99; Home.tsx:767, :867-871 | holds |
| K1-11 | recommend.ts:132 "Keep your cache warm"; autoscaling-planner.ts:389 "Fleet Week (the plan's capstone 2.0)"; Curriculum.tsx:338, Capstone.tsx:796; production-stack.ts:296; Lesson.tsx:643 | holds |
| K1-18 | "Wave 0 rebuilds t4.l3's roofline ... cuts its tasks to four" | **wrong** (section 1) |
| K1-28 | t6.l8 sections "The token mask is not a string mask", "the mask walk", "Make the parser executable"; erratum 2026-10-05-t6-l8 | holds |
| K2-9 | "Sam explains what an MoE holds in memory"; "every frontier open model of 2025-2026 is an MoE"; reference build at moe-anatomy.ts:246 | holds |
| K2-20 | "## Reading an incident before changing anything" (autoscaling-planner.ts:187); no "Prometheus" or "/metrics" in lessons | holds |
| K2-21 | "the TTFT-SLO card" (ClusterPanel.tsx:322) | holds |
| K2-23 | t6.l9, t6.l10 (one diagram), t7.l1, t7.l5 have no predict block | holds |
| K4-8, K4-11 | stress_threads in queue.rs; `fade: 'r2'` in mpmc-queue and batching-scheduler | holds; the package text still sends material to R3/R4 (section 4) |
| K4-14 | `per_mask_us > 10_000` (xgrammar-lite lib.rs:633) | holds |
| K4-15 | "template v2", "(Placeholder until embedded.)", io_uring sentence (labs.ts:757); agent guard packed separately by pack-labs.py:244-277 | holds |
| K5-9 | prints "the K5-6 or K5-7 model's prediction" | **wrong** after K5-7 was narrowed: no K5-7 mechanism model exists at default |
| K5-16 | "t4.l3 (after W0's L6 rebuild)" | **wrong** (section 1) |
| K1-0 | "Sessions run before the protocol is signed cannot be used (PLAN-100X.md:753)" | **over-read**: :753 is "Thresholds and non-inferiority margins are pre-registered ... before any data arrives", about keep/kill features, not a think-aloud of five newcomers |

## 3. Size

One lesson, t5.l7: continuous-batching.ts is 283 lines, 23.6 KB, 15 blocks (3 prose, 3 callouts, diagram, exercise, play, predict, quiz, reading, statline, items); 4 KCs in kc/t5.ts; the play in plays.ts and its 859-line test; 29 files in src, tests and scripts name it.

Largest five, judged believable: K5-23 (16 d, six lessons at about 2.7 d each), K5-25 (12), K5-8 (9), K5-24 (9), K5-6 (8).

Most under-sized:
- **K5-17 (4 d).** It is the only package that passes over T5's ten lessons and the residue of T6 and T7 (about 27 lessons): 19 analogies, sim wiring for four lessons, protégé positions, a word list, then `breaks` made required; its done_when claims the shape baseline's D3 and D8 rows empty. No package owns T5's share of the ~600 option cuts, its D10 density, or section 5.6's echoes ("V1 recomputes, V0 could swap" in nine lessons, the decode arithmetic in six). Split out a T5 pass (about 5 d) and give the echoes an owner.
- **K5-7 (4 d) as written**: its `what` is still the 10-day mechanism rebuild (section 4).
- **K1-5 review (8 h).** The proxy maps 5.5 agent-days to M. It is the one PR that changes ids, order, rings and path heads for every stored learner on a site that deploys on each merge; cost it L (20 h).
- **K1-8 review (8 h)** for about 150 definitions, each checked against its lesson, plus a render pass over every lesson. The roadmap itself says it may be two PRs; cost it as two.
- K3-11 (4.5 d, about 120 listings in four toolchains with preludes) and K1-23 (2 d, block moves in 16 lessons): tight but believable.

## 4. Order and conflicts

- **Package text contradicts the roadmap's own decisions.** `roadmap_changes` records each advocate fix, but `title`, `what`, `done_when` and `touches` were left as the planners wrote them:
  - K5-7: title and `what` are the discrete-event rebuild that Q27 gates as K5-7b; size says 4 d. K5-9 depends on that model.
  - K3-9: title "claim changes carry an erratum"; done_when "a fixture PR changing a claim value without an erratum fails the check". The change says report only. As written, every re-pin and price refresh becomes an erratum, which returns to learners as a review card (section 6 item 9).
  - K4-8 and K4-11: `what` sends material to rungs R3 and R4, which labs 04 to 08 do not have (`fade: 'r2'`).
  - K4-6: `what`, touches and done_when build a drill crate; the default (Q18) is compile-bank items.
  - K5-10: title lists r.l3, r.l4, r.l8, r.l9; done_when "shows the six lessons with a predict block", which is the change the advocate refused for section 6 item 13's plain voice.
  - K3-12: done_when "build-rust-items --check passes on the new pin"; the pin change was dropped.
  - K5-22: touches still list kc/migrations.ts and economy-table.ts.
  - K1-22: `what` still offers "moves after the first lesson".
  Fix: rewrite those fields from `roadmap_changes`, and add a check in the script that builds packages.json (not in the repository) that fails when a package's `what` or `done_when` names something its `roadmap_changes` removed.
- **K1-27 and K1-5.** K1-27: "It ships inside K1-5 because it moves material between three tracks' lessons". Section 4 merges it alone as PR-025 before PR-031. Report section 7 puts O7 in the one structure release. Pick one.
- **Wave 0's Q24 and K2-4.** Wave 0 made "an item that can only be answered from the paper (it changes what the exam grades)" an owner question to answer "before Wave 1". K2-4 adds three graded stops to t2.l7 with no question. Carry the question over; default: the stops ungraded until it is answered.
- **Q8 against Q7.** For the signed hint-ladders study the roadmap builds and holds (PR-H1). For the signed fleet-daily study it ships K2-20 and K2-21, which change when four fault KCs' cards are created and what the Daily prints, with only an unsigned draft amendment, although fleet-daily.md says nothing changes "except by a dated amendment". Hold both merges as PR-H1 is held, or merge them without the Daily changes.
- **N16 (K2-8).** The report says "It needs one measured step: run the two field labs once first." At Q3's default the lesson ships without it. That is allowed with the label, but section 4 should say the report's precondition is unmet, or schedule K2-8 after PR-O1 when Q3 is yes.
- **Wave 0 is still being edited** (its task list, not in the repository, rewritten at 00:45, after roadmap.md at 00:35). Re-run the census of section 1 when Wave 0 is final.
- No new-lesson slot was found misnumbered: every later package uses K1-5's slot ids, and labels come from position.

## 5. Owner questions

Each of Q1 to Q27 rests on a recorded decision or on the report's words, apart from Q18 (crate or compile-bank items for N2), which is a build choice. It is harmless, since its default is the cheaper one.

Defaults not the cheapest to undo:
- **Q2 (i).** Default: no sessions and Wave 1's content goes ahead. The report: the five newcomers "should precede the months of work, not accompany them". K1-0's kit targets today's t0.l1, r.l1 and t2.l1, so it measures nothing once PR-009 (t0.l1), PR-015 (t2.l1) and PR-029 (N1) merge. Cheaper default: hold those three PRs until the sessions run or the owner answers, and let everything else go ahead. Drop the :753 signing gate (section 2).
- **Q8**: see section 4.
- **Q16.** The default keeps the only copy of new private references and mutants in a scratchpad, which the question itself says "can be cleared". That loss cannot be undone. Cheaper: do not merge a recalibrating lab PR until the owner confirms the tarball has been copied somewhere durable, or put the files in a gitignored directory outside any worktree.

Missing questions:
- **P4, the protégé comparison** (section 6 item 3: "run that comparison rather than take this audit's word"; docs/prereg/protege.md, an unsigned draft). The question is not in Group D, the signature is not among section 8's owner steps, and K5-17 moves protégé false sentences while Wave 2 rewrites lessons that host the blocks. Ask: sign or not. Default: unsigned, one block per track. Say in each package that edits a protégé passage that it does so.
- **Section 5.4's optional sections**, and **labs 02, 06, 07 as engine stages** (section 1).
- **Wave 0's Q24** (section 4).
- Minor: Wave 0's Q12 default already creates a 30-day price claim (price.h100.median-2026-11) while roadmap Q12 defaults to "as the schema has them (90 days)". Say so in Q12.

## 6. Section 6 (best in class)

Packages that touch a kept item mostly name it as something that must survive: the plays (K1-18, K2-10, K2-4), the broken benchmark (K2-17), Boot's ten minutes (K1-22), t6.l12 (K2-11), the plain voice of the R lessons (K5-10's change), the agent guard (pack-labs packs it apart from the README K4-15 removes), the twins and the real-engine panel (K2-3, K4-17). Gaps:
- **Item 9**: K3-9's text as it stands (section 4) floods learners' review with errata cards.
- **Item 3**: the comparison the section asks for is not planned (section 5).
- **Item 13**: K5-10's title and done_when as they stand put prequestion blocks in r.l3, r.l4, r.l8 and r.l9.
- **Item 12** (the spiral toward PagedAttention): K2-6 rewrites t2.l3, the T2 stop of the spiral, to three verbs, and lists the eviction lab and the mapping as what must survive, not the spiral's step into t2.l7 and t5.l5. Add it.
