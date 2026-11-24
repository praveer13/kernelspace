# kernelspace: roadmap for audit waves 1 to 5

> This is the roadmap for the audit's waves 1 to 5, written on 2026-11-21 from the audit of master at d478f91 ([report.md](report.md)), before Wave 0 was finished. It is a plan, not a record: Wave 0 has since been built and merged (pull requests #29 and #30; its record is [docs/specs/k0.md](../specs/k0.md)), nothing of waves 1 to 5 is built, their scope and order are the owner's open decision, and the owner questions of section 7 are unanswered. The text below is unchanged apart from this note and the plain descriptions that replace references to files not in the repository. The "Files:" list is rewritten to say what this folder holds and what was left outside it. What Wave 0 changed for this plan is in [after-wave-0.md](after-wave-0.md).

Written 2026-11-21 from the audit of master at d478f91 (docs/audit-2026-11/report.md, section 7), five planners' packages and the owner's advocate. Wave 0 (what harms a learner today, the vLLM v0.34.0 re-pin) is planned by another run (its plan is not in the repository; docs/specs/k0.md is Wave 0's record) and is not repeated here; everything below builds on Wave 0's merged base.

The owner asked for the work on 2026-11-20 and, on scope, wrote: "i meant all of the ikprovements you planned for it". So every row of section 7's waves 1 to 5 is planned. Where the report leaves a choice to the owner, or where an improvement would reverse a decision the owner recorded in the tree, it is an owner question with a default (section 7 of this file). Nothing below says the owner approved anything beyond those two sentences.

Files:
- packages.json: every package (120 rows: 110 built at their defaults, of which 4 are built but held unmerged on an owner question; 9 built only on the owner's yes; 1 absorbed into others), with the planners' fields plus `wave` (the wave it is built in), `pr`, `lane`, `status`, `review_hours_estimate`, `planned_in` and `roadmap_changes` (what this roadmap changed in the planner's brief, and why). `title`, `what`, `touches` and `done_when` describe what is built at the default; where a note overruled the planner, the fields were rewritten to match (section 15).
- Also in this folder: report.md, the audit report this roadmap plans from; advocate.md and critic.md, the two reviews whose findings sections 9 and 15 apply; README.md, which says what the folder is. Not in the repository: the scripts that built packages.json from the planners' per-wave package files (applying the advocate's changes and then the critic's round, and failing if a package's text names something its changes removed), that wrote section 4's tables from a list of PR rows, that wrote section 14 from Wave 0's task list and packages.json (failing on an id with no home or a split with no stated parts), and that printed which packages touch each lesson in PR order; the planners' per-wave package files themselves; the files as they were before the critic's round; and Wave 0's plan and task list (docs/specs/k0.md is Wave 0's record).

---

## 1. Size, honestly

| Wave (as built) | Packages at default | Agent-days | Review hours (estimate) | Model tiers (packages, agent-days) | Built only on a yes |
|---|---|---|---|---|---|
| 1, followable by the stated learner (with stage 0) | 37 | 93.75 | 196 | mixed 22 (70), opus 7 (10), sonnet 8 (13.75) | none |
| 2, the serving half (T5 to T7) | 24 | 89 | 160 | mixed 14 (52), opus 4 (17), sonnet 6 (20) | none |
| 3, facts that do not decay (beside Wave 2) | 10 | 34 | 60 | mixed 5 (23.5), opus 1 (3), sonnet 4 (7.5) | K3-8: 2.5 d, 4 h; K3-16: 4 d, 8 h |
| 4, the Rust ramp and honest labs | 15 | 57 | 92 | opus 10 (43), sonnet 4 (10), mixed 1 (4) | K4-9, K4-12, K4-16: 10 d, 16 h |
| 5, depth in the lower tracks | 24 | 116.5 | 172 | mixed 17 (87), opus 3 (14.5), sonnet 4 (15) | K5-7b, K5-23, K5-24, K5-25: 43 d, 56 h |
| **Total** | **110** | **390.25** | **680** | | **9 packages: 59.5 d, 84 h** |

Everything, including every optional build: 449.75 agent-days and about 764 review hours. "At default" includes the four packages built but held unmerged (K1-6, K1-7, K1-14 on Q2; K4-10 on Q7), the owner-step kits, and PR-H2's 4 h (K2-20 and K2-21's Daily parts, held on Q8). The model columns count packages built at the default only. The critic's round added K1-32 (t4.l3, 3 d), K5-28 (T5 pass and echoes, 5 d) and the conditional K3-16 (P4's comparison), and re-costed K1-5 as L (20 h) and K1-8 as two M PRs (16 h).

- Agent-days are the planners' estimates for building and checking, not calendar time. "mixed" means Sonnet builds and Opus designs the hard parts and reviews. Stage 0 moved four packages from Waves 3 and 5 into Wave 1 (K3-1, K3-2, K3-9, K5-1), which is why Wave 1 is larger and Wave 3 smaller than the planners' files.
- Review hours are the binding cost. PLAN-100X.md:674: "Review hours are the binding constraint. Code QA is costed at 4, 8 or 20 h per S, M or L". The plan sizes features, not packages, so the estimate maps a package of up to 3 agent-days to S (4 h), up to 10 to M (8 h), above 10 to L (20 h), as the advocate did. It is a proxy, and it leaves out content, partner and accessibility time, which the plan adds on top.
- At the plan's cap of 10 h a week (PLAN-100X.md:675; OD11 at :827), the 680 h are about 68 weeks of review. Dates below take the running total of section 4's queue at each wave's last PR (held PRs counted where they sit), divided by the weekly hours, from week 1 = the week of 2026-12-07 with no weeks off: Wave 1 is reviewed by about 2027-04-17 (188 h), Waves 2 and 3 by about 2027-09-18 (408 h), Wave 4 by about 2027-11-13 (488 h), Wave 5 by about 2028-03-13 (660 h; the 20 h outside the stack bring the end to about 2028-03-27). At 15 h a week (OD11's other option): 2027-03-04, 2027-06-15, 2027-07-22, 2027-10-11. OD11's 10 h a week runs to 2027-10-17 in the plan's table. The plan's own calendar took 2026-12-21 to 2027-01-03 off (PLAN-100X §8); a similar break moves every date by two weeks.
- The report's own figures ("two to four weeks" for Wave 1, "one to two months" for Wave 2) are build time. With agents building ahead, build time is not the limit; the owner's review is. At 10 h a week, Wave 2 is not reviewed by spring 2027, the date the report puts on the serving-half lead (section 11). Q1 offers the three ways to change that.

New lessons over all waves: t0.l7 (N1, 15 min), t6.l13 (split from t6.l8, no net minutes), N3 (15), N16 (30), N9 (30), N2 (30), N4 (30): about 150 declared minutes, inside the report's budget of about three hours of new lessons in all. Public counts go from 69 lessons to 70 at the structure release, 71 when K1-6 fills t0.l7, and 76 by the end of Wave 5 (78 if N12 and N14 are chosen).

---

## 2. What is built in what order, and why

1. **Stage 0 first: the tools every later PR leans on, before any lesson text moves.** The ref guard (K1-1) makes every PR show which stored answers it re-points. The label helper and citation token (K1-3) runs a codemod over about 457 citations in 123 files: it must land before content PRs are in flight or it conflicts with all of them. Claim tokens and the coverage gate (K3-1, K3-2), the lesson-shape check (K5-1) and the history callout (K3-9) move here from Waves 3 and 5 so that Waves 1, 2 and 4 write every number as a claim, every dated sentence as history and every lesson in the shape from their first commit. Otherwise Wave 3 re-sources every rewritten lesson and Wave 5 re-opens them (advocate 24; the Wave 2 and Wave 3 planners disagreed on exactly this). The structure spec (K1-2) closes stage 0. None of these changes what a learner sees except that F4's places render from the claim with a source popover.
2. **One structure release, early, with every slot reserved.** K1-5 implements K1-2's spec once: the reading order apart from track membership, every move (t6.l12 after t6.l4, t6.l5 and t6.l6 swapped, t3.l6 and t3.l7 after t5.l10 on the full ramp), t0.l6's split by content (K1-27, which report section 7 puts in this release), the t6.l8 split registered as t6.l13, and reserved slots for every later new lesson: t0.l7 (N1, filled by K1-6 after the release, so the release does not wait on Q2), t5.l11 (N3), t6.l14 (N16), t7.l6 (N9, last of T7), t3.l8 (N2, before t3.l3), t7.l7 (N4, first in T7), and conditional t6.l15 (N12) and t4.l8 (N14). t6.l11 stays reserved by PLAN-100X. No id is renamed, removed or reused, because only fold.ts applies ref migrations (resolve.ts, cards.ts and item-block.ts read refs raw). Labels come from position, so the ids above never show. Later waves fill a slot by adding a file at a position the release already fixed, with counts derived rather than edited.
3. **Wave 1's learner-facing work in order of what a newcomer meets first**: t0.l1's first screen, the door (Boot step 3, hidden nouns), one order on screen, one computed time, T0's numbers, lost work on navigation, then the concept gaps (T2 primer, pointers, t1.l6, Q K V, T4 vocabulary), simulators that contradict their lessons, t4.l3's drawn roof and four tasks (K1-32), items moved to where they are taught, dated corrections, the hidden T6 and T7 blocks, the track pages and placement, the braid, t0.l6's split, the glossary, "Go deeper", the field-lab runbook, then the release and what needs it (routed finales, the bridge and reading glosses). The three PRs that rewrite what the report's five newcomers would see (PR-009 t0.l1, PR-015 t2.l1's primer, PR-029 N1 read right after t0.l1) are built in this order but, at Q2 (i)'s default, held unmerged until the sessions run or the owner answers: the report says the sessions "should precede the months of work, not accompany them". Nothing else waits on them.
4. **Wave 2 with Wave 3 beside it.** The report runs Wave 3 in parallel. In one review stack that means interleaving: Wave 2 by learner gain (the reference cards that every rebuild leans on, N3, KV off the GPU, the twins, N16, the Fleet, then the T5, T6 and T7 rewrites, N9 last because it needs t7.l4 and N8), with Wave 3's pieces placed where they are cheapest: the freshness job and price refresh early (claims lapse continuously), listings in CI before the R sweep, the tag re-read pre-registration whenever the owner can sign, product status claims mid-wave, T0 to T3 facts after Wave 1's sentences, the remaining T4 to T7 citations and the computed badge last. K4-1 (the lab baseline record) also comes here: it changes nothing and every Wave 4 lab package must be scoped from what it measures.
5. **Wave 4 after Wave 2**, as section 7 orders it: the Rust ramp (r.l5, r.l10 with t2.l5, drills, tickets), N2 in its slot, then the labs one crate at a time (each recalibrates), the shared lab hygiene, and the real-engine run on the path.
6. **Wave 5 last**: the queue simulator and the N4 lesson in its slot, the three serving sections (N10, N11, N13), then per track: generator families and simulators first, then one pass per track that wires them in (T5's pass, K5-28, also owns the echoes section 5.6 lists), then the residual sweep over T6, T7 and t4.l7 that makes the shape check binding.
7. **A lesson is rewritten once** (section 4). Where several waves touch a lesson, the rule is: facts and one-sentence corrections first, the rewrite next, the shape pass last, and a later package never re-edits a paragraph an earlier one wrote. Section 4 gives the order per lesson.

---

## 3. Which waves run side by side

**Building** runs in lanes, many agents at once; **review** is one stack.

- Build lanes (field `lane`): stage0-tooling; structure-release; path-and-door (site code); lesson text (W1); glossary-and-pointers; sims; field-gpu; serving rebuild (T5-T7); facts (runs beside W2); rust ramp and real engine; labs; generators; lesson passes and sections (W5); owner. Packages in different lanes rarely share a file; where they do, section 4 orders them.
- Review is one linear stack, as wave-3.md D1 recorded after Wave 2's parallel branches conflicted: each PR is a branch on the merged tip of the one before, opened only when the open review queue is under about 10 h (PLAN-100X.md:676, the default of Q1). Agents may build several PRs ahead; a built-ahead branch is rebased onto the stack tip before it opens.
- Side by side in the stack: Wave 3 interleaves with Wave 2 (PR-035 to PR-068); K4-1 sits at PR-034. Waves 4 and 5 follow. Q1's options change this.
- PR ids are fixed. A PR the critic's round inserted takes the previous number and a letter (PR-015a, PR-019a, PR-102a); a package reviewed in two parts takes one number and two letters (PR-026a, PR-026b).

**Stack rules for every PR.** The brief names the base sha (agent worktrees start at master, not the current branch). Every PR leaves the published course better if the next is never merged. Exceptions:
- K1-27 (t0.l6's split) and K1-28 (t6.l13) are reviewed as their own PRs into the release branch and reach master only with K1-5 (PR-025, PR-030, PR-031 merged as one unit), as report section 7 puts O7 and the t6.l8 split in the one structure release.
- A held PR (PR-009, PR-015, PR-029 on Q2; PR-H1 on Q7; PR-H2 on Q8) is built at its place, later PRs do not stack on it, and it is rebased onto the stack tip when its question is answered. A recalibrating lab PR (PR-074 to PR-079, PR-H1) is not merged until the owner confirms its private files are copied somewhere durable (Q16).

---

## 4. Pull requests in order

Review hours are the estimate above; "cum." is the running total, the position in the queue. "Gains" is what a learner gets if the stack stopped there; for tooling it says what it protects.

### Stage 0 (Wave 1): before any lesson moves
| PR | Packages | Days | Review h | Cum. | Gains |
|---|---|---|---|---|---|
| PR-001 | K1-0 newcomer kit; master vs d478f91 record | 1 | 4 | 4 | Nothing on the site. The owner can run the five sessions the report puts before everything; no audit row is fixed twice. |
| PR-002 | K1-1 positional-ref guard | 1 | 4 | 8 | Every later PR shows which stored answers it re-points; migration tables pinned empty with the reason. |
| PR-003 | K1-3 labels from position, citations as tokens | 3 | 4 | 12 | Byte-identical today; makes every move later safe; zero rev changes (advocate 16). |
| PR-004 | K3-1 claim tokens in prose and chips | 3.5 | 8 | 20 | F4's places and chips show their source, tag and date in a popover; one copy of each fact. |
| PR-005 | K3-2 coverage gate, shrinking baseline | 1.5 | 4 | 24 | No new uncited chip or dated sentence from here on. |
| PR-006 | K5-1 lesson-shape check; `breaks` on analogies | 3 | 4 | 28 | Analogies can say where they break; no lesson gets worse on the report's D3, D5, D8, D10 measures. |
| PR-007 | K3-9 history callout and erratum kind (narrowed) | 2.5 | 4 | 32 | Old designs can be shown as dated history instead of as the present. |
| PR-008 | K1-2 structure-release spec | 1.5 | 4 | 36 | A document the owner reads before ids, rings and paths change. |

### Wave 1: followable by the stated learner
| PR | Packages | Days | Review h | Cum. | Gains |
|---|---|---|---|---|---|
| PR-009 | K1-7 t0.l1 first screen, FLOP and FP16 | 1.5 | 4 | 40 | **Held on Q2 (i)** until the sessions run or the owner answers; built, rebased when released. A backend engineer's first screen asks a question they can reason about; its opening question is answered in the text. |
| PR-010 | K1-22 small things at the door (step 6 collapsed in Boot) | 2.5 | 4 | 44 | No ring or SLO jargon before the first lesson; Boot step 3 grades what it asks; a short planning step. |
| PR-011 | K1-9 one order on screen, "Your path" | 4 | 8 | 52 | Next and previous follow the learner's path; the Path page opens on it; no card points off the path. |
| PR-012 | K1-10 one computed time | 2 | 4 | 56 | One time figure everywhere, labelled as declared minutes. |
| PR-013 | K1-17 T0's numbers agree | 3 | 4 | 60 | One DRAM latency and bandwidth across T0; the simulator stops contradicting the lesson. |
| PR-014 | K1-31 in-progress work survives navigation | 2.5 | 4 | 64 | A locked prediction or half-played play is still there on return. |
| PR-015 | K1-14 T2 primer (t2.l1) | 0.75 | 4 | 68 | **Held on Q2 (i)** until the sessions run or the owner answers; built, rebased when released. Page table, TLB and system call defined before use. |
| PR-015a | K1-16 pointer-to-pointer step | 1.5 | 4 | 72 | The allocator's pointer plumbing taught, not skipped. |
| PR-016 | K1-30 t1.l6 as a retrieval table | 1 | 4 | 76 | Ownership is recalled, not taught a second time as new. |
| PR-017 | K1-13 Q, K, V, heads, causal mask; encode() | 2 | 4 | 80 | Attention's parts and the reason the KV cache works stated before use; tokenizer described correctly. |
| PR-018 | K1-15 T4 vocabulary first; T4 pays off in T5 | 2.5 | 4 | 84 | Kernel, block and barrier defined before t4.l2 uses them; the GPU kernel is not the OS's. |
| PR-019 | K1-18 simulators outside T0 agree with lessons | 2.5 | 4 | 88 | t5.l7, t2.l2 and t4.l3's sims show what the lessons say; t2.l2's tasks can all be done. |
| PR-019a | K1-32 t4.l3 draws its roof; four tasks; an honest verdict | 3 | 4 | 92 | The roofline lesson shows a roofline in the reading column; the lab opens on this lesson's four tasks; 'prediction held' names the gap it accepted (grading unchanged unless Q28). |
| PR-020 | K1-19 items moved to where they are taught | 3 | 4 | 96 | No question asks about what comes later; t7.l1 draws its knee; t7.l5 re-prices t7.l4's example with headroom. |
| PR-021 | K1-4 the braid from lesson text | 2 | 4 | 100 | Fixture-tested braid() with a lower bound; t0.l4's Java or Python tab first (KC edges staged for the release). |
| PR-022 | K1-21 dated corrections and lower-track history (absorbs K3-10) | 3.5 | 8 | 108 | Free-threaded Python, forkserver, JDK 27 headers, WASI, Bun's port to Rust, each dated and sourced, once. |
| PR-023 | K1-23 T6 and T7's point out of the collapsed blocks | 2 | 4 | 112 | What the serving lessons need is in the reading flow. |
| PR-024 | K1-20 T3 and T4 track pages; placement keeps T3 | 3 | 4 | 116 | Track pages tell the truth about what needs what; placement no longer drops T3 unasked. |
| PR-025 | K1-27 t0.l6 split by content (no new id), into the release branch | 2.5 | 4 | 120 | (With PR-031) t0.l6 reads flame graphs of T0's own experiments instead of labs not yet built. |
| PR-026a | K1-8 glossary, part 1: mechanism, T0 to T4 terms | 3 | 8 | 128 | Every T0 to T4 term searchable and underlined at first use. |
| PR-026b | K1-8 glossary, part 2: T5 to T7 terms | 3 | 8 | 136 | The serving terms (TTFT, ITL, goodput, MoE...) searchable and underlined; each definition checked against its lesson. |
| PR-027 | K1-24 "Go deeper" pointer per lesson | 3 | 4 | 140 | The best free chapter on each lesson's subject, checked at its address. |
| PR-028 | K1-25 field-lab runbook, parser, results slot | 2 | 4 | 144 | Pages unchanged ("Not run on a GPU yet."); the owner's GPU session is ready to run. |
| PR-029 | K1-6 N1, one request through an LLM server (fills slot t0.l7) | 5 | 8 | 152 | **Held on Q2 (i)** until the sessions run or the owner answers; built, rebased when released. Merges after PR-031, into the slot t0.l7 it reserves. The serving vocabulary arrives in lesson two, by stepping one request. |
| PR-030 | K1-28 t6.l8 split, t6.l13 created, into the release branch | 2 | 4 | 156 | (With PR-031) structured output becomes its own lesson before the agents half. |
| PR-031 | K1-5 the structure release (reviewed as L, 20 h) | 5.5 | 20 | 176 | t6.l13 in place, t0.l7 reserved; t6.l12 read where its argument belongs; T3's case studies after T5; slots for every later lesson; t1.l5 marked "optional unless you take T3". |
| PR-032 | K1-11 the built finales routed as plan steps | 3 | 4 | 180 | Capstone Zero, the real-engine run, Fleet Week and the service capstone are on the path, with one finishing step. |
| PR-033 | K1-12 bridge banner; Rust reading gloss | 3.5 | 8 | 188 | A learner who skips ahead sees what each lesson uses and where it is taught; the rustc question is readable for a non-Rust reader. Does not wait for N1. |

### Waves 2 and 3 side by side (and the lab baseline)
| PR | Packages | Days | Review h | Cum. | Gains |
|---|---|---|---|---|---|
| PR-034 | K4-1 lab baseline record (W4) | 3 | 4 | 192 | No site change; the first time any lab escape is run; scopes Wave 4. |
| PR-035 | K3-6 scheduled freshness job | 3.5 | 8 | 200 | A weekly issue of expiring claims with the lessons they feed, link rot, a monthly quote sample. |
| PR-036 | K2-1 reference cards R8, R70, RV3 | 4 | 8 | 208 | Three deployments a learner can open from any serving lesson; t5.l1 keeps one running model. |
| PR-037 | K2-2 N3, from logits to a token | 5 | 8 | 216 | Sampling taught on the toy model's real logits: why output length is what decode pays for. |
| PR-038 | K3-14 prices re-read; ratios generated | 1.5 | 4 | 220 | Current price ranges; Fleet Week's ratio computed, not typed. |
| PR-039 | K2-6 KV off the GPU (t6.l3, t2.l3, t5.l6) | 4 | 8 | 228 | Reload against recompute as a priced decision instead of a deprecated component. |
| PR-040 | K2-3 twins in the lessons; lab 02 twin | 3.5 | 8 | 236 | Real engine source questions inside t5.l6 and t5.l7; F3 settled at the source. |
| PR-041 | K3-11 every lesson listing run in CI | 4.5 | 8 | 244 | A listing that does not compile or print what the lesson says cannot ship again. |
| PR-042 | K2-8 N16, anatomy of one decode step | 6 | 8 | 252 | Where the milliseconds of a step go, from the bandwidth floor to two published apportionments. The report's precondition (the field labs run once) is unmet at Q3's default: it ships with 'Not run on a GPU by the course yet'; on Q3 (i) yes with readings in hand, it waits for PR-O1. |
| PR-043 | K2-21 the Fleet gives something to operate (items 1 to 5) | 5 | 8 | 260 | Controls without a .wasm, kept runs, a debrief that explains affinity. The Daily's probe text waits on PR-H2. |
| PR-044 | K3-7 tag re-read pre-registration and snapshot | 3 | 4 | 264 | No site change; a backtest the owner can sign before any tool is built. |
| PR-045 | K2-4 what survived of the 2023 design | 3 | 4 | 268 | The PagedAttention paper read with three stops (ungraded until Q29), and what changed since, dated. |
| PR-046 | K2-24 where the pool comes from; the block-size trade as an exercise | 3 | 4 | 272 | t5.l5 sizes the pool and makes the 64-token trade something to predict and run. |
| PR-047 | K2-5 t5.l10 as a dated map | 3 | 4 | 276 | One request through six named functions; four engines in a dated table; an ending that leads into T6. |
| PR-048 | K2-20 N8, the incident section at the end of T5 (prose, table, metric names) | 3 | 4 | 280 | Reading an incident before acting, with real metric names. The sig items, KC list and Daily link stay until PR-H2. |
| PR-049 | K3-5 a status claim for every product named | 5 | 8 | 288 | Archived and deprecated tools say so beside their names; the PR prints the upkeep they add. |
| PR-050 | K2-7 KV bytes per token as an architecture decision | 3 | 4 | 292 | The attention zoo explained; the 2024 law dated. |
| PR-051 | K2-9 t6.l1 rebuilt round RV3 | 4 | 8 | 300 | MoE derived on numbers, with the all-to-all drawn. |
| PR-052 | K2-10 t6.l2 sized and drawn | 4 | 8 | 308 | Bytes on the wire per layer and the overlap timeline. |
| PR-053 | K3-4 T0 to T3 facts registered | 6 | 8 | 316 | The lower tracks' numbers render from sources and age visibly. |
| PR-054 | K2-11 t6.l4 composed on two cards; t6.l12's ping-pong figure | 3 | 4 | 320 | The composition procedure carried out once; t6.l12 otherwise untouched. |
| PR-055 | K2-12 t6.l5 round one table across generations | 3.5 | 8 | 328 | The ridge per number format derived; each hardware row says whether a spec sheet and independent benchmark exist. |
| PR-056 | K2-13 t6.l6 round one question | 3.5 | 8 | 336 | Does speculation pay at this load? answered by arithmetic. |
| PR-057 | K2-14 t6.l7 rewritten | 3.5 | 8 | 344 | RL rollout serving with the three real weight-update paths. |
| PR-058 | K2-15 N17 grammars in t6.l13; agent traffic in t6.l8 | 4 | 8 | 352 | Why JSON needs a stack, before the lab that builds the mask. |
| PR-059 | K3-12 R's first sweep (no pin change) | 2.5 | 4 | 356 | R's dated statements checked, R's first errata. |
| PR-060 | K2-16 t7.l3 draws the frontier from real rows | 4 | 8 | 364 | The frontier read off a chart of registered runs (ungraded chart). |
| PR-061 | K2-17 t7.l2 rate sweep and recorded sessions | 2.5 | 4 | 368 | Which sweep measures what, and a dated benchmark landscape. |
| PR-062 | K2-18 t7.l4's close; t7.l1's traffic | 3 | 4 | 372 | A token has many prices; agent and reasoning traffic as default. |
| PR-063 | K2-19 N9, one deployment end to end | 5 | 8 | 380 | Size, batch and price R70 and decide buy, rent, reserve or API. |
| PR-064 | K2-22 t4.l7 who quantizes and when | 2.5 | 4 | 384 | Low-bit from training described from model cards. |
| PR-065 | K2-23 prequestions, figures, clauses in the rest of T6 and T7 | 4 | 8 | 392 | Every serving lesson opens on a question. |
| PR-066 | K3-3 remaining T4 to T7 citations | 5.5 | 8 | 400 | S2's "100% of chips cited" for T4 to T7. |
| PR-067 | K3-13 the verified badge computed | 1.5 | 4 | 404 | The badge says when the lesson's facts were last read, not a typed month. |
| PR-068 | K3-15 field-notes candidates issue at the chosen cadence | 1 | 4 | 408 | The owner's curation starts from drafted candidates. |

### Wave 4: the Rust ramp and honest labs
| PR | Packages | Days | Review h | Cum. | Gains |
|---|---|---|---|---|---|
| PR-069 | K4-2 r.l5 repaired | 3 | 4 | 412 | Structs, enums, Option and Result shown in code before the drills need them. |
| PR-070 | K4-3 r.l10 opens on the publication bug; t2.l5 recap | 3 | 4 | 416 | The ordering bug predicted and seen before the vocabulary. |
| PR-071 | K4-4 drills ask only what their lesson shows | 4 | 8 | 424 | No R drill needs something its lesson never showed. |
| PR-072 | K4-5 exit tickets for R | 3 | 4 | 428 | R gets produced-answer tickets and review cards (Today's load grows; O5's interim rule ends for R). |
| PR-073 | K4-6 N2, traits and generics (slot t3.l8; compile-bank items) | 6 | 8 | 436 | Send, Sync, Future and Pin taught before t3.l3, t3.l4 and lab 05 use them. |
| PR-074 | K4-7 lab 05 joined to its lesson | 3 | 4 | 440 | Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). One program in lesson and lab; a real first stage. |
| PR-075 | K4-8 lab 04 and R10 orderings made honest | 4 | 8 | 448 | Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). The pages say what the checks cannot see; the algorithm leaves the learner's file. |
| PR-076 | K4-11 lab 06 grades headroom | 3 | 4 | 452 | Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). A scheduler with no headroom fails; the file stops printing its answer. |
| PR-077 | K4-13 lab 07's radix tree earns its place | 4 | 8 | 460 | Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). A flat scan fails at scale; mid-block divergence specified and graded. |
| PR-078 | K4-14 lab 08 checks, stages, precheck | 6 | 8 | 468 | Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). The lab's checks kill real wrong designs; stages climb from a flat object. |
| PR-079 | K4-15 what every lab ships | 3.5 | 8 | 476 | Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). Merge waits for the owner's confirmation that this PR's private files are copied somewhere durable (Q16). A clean first cargo test, a learner README, MSRV, honest minutes, one regrade rule. |
| PR-080 | K4-17 the real-engine run on the path | 7 | 8 | 484 | The learner's scheduler and block manager over a real model, with one graded prediction. |
| PR-081 | K4-18 runbooks for the owner's runs | 0.5 | 4 | 488 | No site change; the owner's real, ARM and timed-learner runs are ready. |

### Wave 5: depth
| PR | Packages | Days | Review h | Cum. | Gains |
|---|---|---|---|---|---|
| PR-082 | K5-21 a queue the learner drives; queue family | 6 | 8 | 496 | Little's law and the utilisation curve on a seeded simulator. |
| PR-083 | K5-22 N4, the queueing lesson (slot t7.l7, first in T7) | 6 | 8 | 504 | Why waiting explodes near full load, before T7 uses the knee. |
| PR-084 | K5-18 N10, RDMA and collectives in t5.l9 | 2 | 4 | 508 | Two terms T6 leans on, defined with one picture. |
| PR-085 | K5-19 N11, cold start as arithmetic | 2.5 | 4 | 512 | A new worker's load time computed per path. |
| PR-086 | K5-20 N13, when a GPU dies | 3 | 4 | 516 | Failure and elastic resize in wide expert parallelism. |
| PR-087 | K5-2 families for T0 and T1 | 6 | 8 | 524 | Fresh-number review items for lines, bytes and addresses. |
| PR-088 | K5-6 T0 and T1 simulators labelled and graded | 8 | 8 | 532 | The sims say they are models; predictions graded against them. |
| PR-089 | K5-7 T2 simulators labelled as models, graded tasks | 4 | 8 | 540 | The T2 sims say what they compute and leave out; VmPagingSim on a log scale; predictions graded. |
| PR-090 | K5-9 your-machine field labs for T0 and T2 | 7 | 8 | 548 | The model beside a reading the learner takes on their own machine. |
| PR-091 | K5-11 T0 pass | 5 | 8 | 556 | T0's lessons open on questions and stop claiming the learner measured what the page computed. |
| PR-092 | K5-12 T1 pass | 4.5 | 8 | 564 | T1 in the same shape; t1.l4 touched only at its analogy break. |
| PR-093 | K5-3 families for T2 memory | 6 | 8 | 572 | Translate an address, count faults, with fresh numbers. |
| PR-094 | K5-4 family for T2 time | 4 | 8 | 580 | Schedule four jobs, size a pool. |
| PR-095 | K5-14 T2 pass, memory strand | 3.5 | 8 | 588 | t2.l2 and t2.l3 in the shape; the spiral to PagedAttention reads the same. |
| PR-096 | K5-13 T2 pass, time strand | 6 | 8 | 596 | t2.l1 opens on a prediction; t2.l4 to t2.l6 in the shape. |
| PR-097 | K5-5 T3 compile items | 6 | 8 | 604 | T3's review becomes generated (which error, which fix). |
| PR-098 | K5-8 T3, T4, T5 simulators labelled and graded | 9 | 8 | 612 | No legacy checklist task left; "measured in Rust" gone from a TypeScript model. |
| PR-099 | K5-27 the WGSL playground runs the learner's shader | 4 | 8 | 620 | Where WebGPU exists, the learner's shader runs. |
| PR-100 | K5-15 T3 pass | 7 | 8 | 628 | T3 in the shape, leaning on N2. |
| PR-101 | K5-16 T4 pass (with A31's section) | 5 | 8 | 636 | T4 in the shape; FlashAttention after 2022. |
| PR-102 | K5-10 R light pass (r.l1, r.l2; r.l4's limits to r.l9) | 2.5 | 4 | 640 | r.l1 and r.l2 get something to do early; r.l3, r.l4, r.l8, r.l9 untouched apart from the move. |
| PR-102a | K5-28 T5 pass; the course's echoes turned into questions | 5 | 8 | 648 | T5 in the shape; 'V1 recomputes' taught once from its claim; the decode arithmetic asked, not restated. |
| PR-103 | K5-17 residual sweep over T6, T7, t4.l7; gates made binding | 4 | 8 | 656 | The shape check holds every lesson from here on. |
| PR-104 | K5-26 session script for the new shape | 0.5 | 4 | 660 | No site change; the owner's optional sessions are ready. |
### Outside the stack
- **PR-O1** (K1-26): the field-lab readings, opened when the owner pastes the GPU session's output (4 h). It turns "Not run on a GPU yet." into dated measured values with the gap explained, and fills N16's measured row.
- **PR-O2** (K1-29): the first-hour session notes and measured minutes, opened after the owner's sessions (4 h).
- **PR-H1** (K4-10): lab 02's blocks hold values. Built after PR-034; merged only after the owner signs the hint-ladder amendment (Q7) and confirms the durable copy (Q16), then rebased onto the stack tip (8 h).
- **PR-H2** (K2-20 and K2-21's Daily parts): the sig items move with the incident section, KC t7.leading-signals lists the new lesson, the Daily's first screen links to the section (Q15's offer rule), and the intake probe stops printing worker state. Built after PR-048; merged only after the owner signs a dated amendment to the signed docs/prereg/fleet-daily.md (Q8), drafted in a separate file (4 h).
- **PR-C1 to PR-C9**: built only on the owner's yes. K3-8 tag re-read (Q9 and a signed keep), K4-9 loom (Q19), K4-12 lab 06 step time (Q20), K4-16 toolchain and edition re-pin (Q22), K5-7b T2 mechanism rebuild (Q27), K5-23 full R rewrite (Q24), K5-24 N12 (Q25), K5-25 N14 (Q26 and Q3), K3-16 P4's comparison (Q32).
- **Not yet packaged, on a yes**: the five optional sections of report 5.4 (Q30) and labs 02, 06 and 07 as stages of one engine (Q31). Each becomes a package and a PR-C row when answered.

---

## 5. Lessons that more than one wave touches, and in what order

From a script (not in the repository) over every package's touches (packages that touch whole directories, such as K1-23, K3-3, K3-4, K3-5 and K3-12, are placed by the rules after the table). Order is PR order.

| Lesson | Order of changes |
|---|---|
| t0.l1 | Wave 0's fixes, then K1-7 (first screen; held on Q2 (i)), then K1-6 leans on its reveal; K5-28 keeps its decode arithmetic as one of two places it is stated. Wave 5 leaves it out otherwise. |
| t0.l2 | K1-17 (numbers agree), K3-4, K5-11. Hosts a protégé block (Q32). |
| t0.l3 | K1-17 (numbers agree), K3-4 (facts registered), K5-11 (shape pass). |
| t0.l4 | K1-4 (tab order), K1-21 (header as history), K3-4, K5-11. |
| t0.l5 | K1-21 (free-threading as history), K3-4, K5-11. |
| t0.l6 | Wave 0's F1, K1-27 (split by content, in the release), K4-15 (lab numerals only), K5-28 (one echo site). |
| t1.l2 | K1-16, K5-12. |
| t1.l3 | Wave 0's F6 listing, K1-16, K4-15 ("Build this" block), K5-12 (breaks and words only). |
| t1.l6 | Wave 0's signposts, K1-30. Wave 5 leaves it out. |
| t2.l1 | K1-14 (primer, self-contained so the pass moves it; held on Q2 (i)), K5-13. |
| t2.l2 | K1-21 (forkserver as history), K1-18 (sim's opening mode), K3-4, K5-7 (VmPagingSim labelled), K5-14. Hosts a protégé block (Q32). |
| t2.l3 | Wave 0, K2-6 (three verbs; takes the "V1 current engine" sentence from K3-10; the spiral's step into t2.l7 and t5.l5 kept), K5-14, K5-28 (the one place "V1 recomputes" is taught). |
| t2.l5 | K1-27 (making a flame graph section), K4-3 (ordering paragraph to a recap), K4-8 ("Build this" for lab 04), K5-13. |
| t2.l7 | Wave 0's link, K2-4 (stops, ungraded until Q29, and afterword; takes it from K3-10). Wave 5 leaves it out (exam exception). |
| t3.l4 | Wave 0's F2, K4-7 (lab's design as the listing), K5-15. |
| t3.l5, t3.l7 | K1-21 (WASI, Bun), K1-5 (t3.l6, t3.l7 read after t5.l10), K5-15. |
| t4.l2, t4.l5 | K1-15 (first half of t4.l5 to t4.l2's opening), K5-8 and K5-27 (t4.l5's sim), K3-3 (A26's ratio as a claim, t4.l2), K5-16 (A26's trend, decode arithmetic asked). |
| t4.l3 | Wave 0's rendering (fence, embedded layout, labels; K0-A8 to A10) and A28, K1-18 (kernel table), K1-32 (drawn roof, lab on four tasks, verdict; Q28), K5-16 (analogy break and one sentence). Hosts a protégé block (Q32). |
| t4.l6 | Wave 0's A26 and A31 sentences, K3-3, K5-16 (A31's section, A26's trend). |
| t4.l7 | K2-22, K5-17 (residue only). |
| t5.l1 | K1-13, K1-15, K1-6 (recap lines, when it merges), K2-1 (R8 with GQA from the start), K3-3, K5-28 (shape residue; question 2 if still reusing the example). |
| t5.l2 | K1-13 (encode), K1-19 (ticket item out), K5-28. |
| t5.l3 | K1-6 (recap, when it merges), K2-8 (floor-to-step table), K3-3, K5-28. |
| t5.l4 | K1-19 (MLA question out), K2-7 (second half only; the best T5 lesson's first half kept), K5-28 (residue only). |
| t5.l5 | Wave 0's F3 figure and F4 sentence, K1-15, K1-12 (reading block), K2-4 (one sentence), K2-24 (pool section and exercise), K5-28 (residue; echo sites; protégé block moved only). Hosts a protégé block (Q32). |
| t5.l6 | K1-19 (receives an item), K2-2 (back-link), K2-6 (HiCache hand-off), K2-3 (twin after the quiz), K2-7 (one paragraph), K5-28. |
| t5.l7 | K1-10 (minutes), K1-18 (sim), K1-19, K1-27 (cargo flamegraph step), K2-3, K2-4, K4-11 (guard number), K5-8 (tasks), K5-28 (echo sites, task wiring; the play untouched). |
| t5.l8 | K1-19, K2-2, K2-13 (Medusa dated), K5-28. |
| t5.l9 | K5-18 (N10), K5-28 (echo site). |
| t5.l10 | K1-11 (hand-off), K2-5 (rewrite), K2-20 (incident section arrives; items follow on PR-H2), K5-28. |
| t6.l1, t6.l3 | K1-19 or K1-23 (moves only), K2-9 or K2-6 (rebuild). |
| t6.l2 | K1-23, K1-27 (serving graphs section), K2-10 (rebuild; play untouched), K5-20 (failure section). |
| t6.l8, t6.l13 | K1-28 (split), K2-15 (N17 and M9), K4-14 (links only). |
| t7.l1 | K1-19 (knee drawn), K2-18 (traffic section), K2-23 (prequestions). |
| t7.l5 | K1-19 (re-pricing), K1-11 (Fleet Week link), K2-20 (incident prose leaves; its sig items leave only on PR-H2), K2-23, K5-19 (cold start), K5-20 (one link), K5-17. |
| r.l1, r.l2 | K3-12 (facts), K4-4 (smallest additions), K5-10 (light pass); K5-23 only on a yes. |
| r.l4, r.l9 | K3-12 (Polonius claims), K5-10 (limits 2 and 3 move from r.l4 to r.l9; nothing else); K4-16 only on a yes. r.l4 hosts a protégé block (Q32). |
| r.l5, r.l10 | K4-2 and K4-3 take K3-12's rows for these lessons and rewrite once. |
| r.l3, r.l8 | K3-12 facts; K4-4 (r.l3: one listing); K4-7 (r.l8: one sentence on lab 05). Named exceptions in the shape check. |

Rules for the packages that touch whole directories:
- K1-23 only moves blocks; Wave 2 then rebuilds. t6.l3's NIXL section is not moved (K2-6 replaces it).
- K3-3 converts only lessons no rewrite touches, after their last Wave 1 or 2 edit; rewrites cite as they write (K3-2's gate holds them to it).
- K3-4 starts after K1-17 and K1-21 have made their sentences claims.
- K3-5 edits text only in lessons whose Wave 2 rewrite has merged or that no rewrite touches; for the rest it registers the status claims and the rewrite renders them.
- K3-12 hands r.l5 and r.l10 rows to K4-2 and K4-3 and skips r.l8's panic message if Wave 0 merged it.
- Wave 5's passes start from every earlier wave's merged text and never re-open a rewrite beyond residue (K5-28 for T5, K5-17 for T6, T7 and t4.l7).
- Protégé blocks (r.l4, t0.l2, t1.l4, t2.l2, t3.l4, t4.l3, t5.l5, t6.l1, t7.l1): every package whose touches reach one of these lessons carries a note in its `risk` (24 packages): the PR says so, the passage is moved only where the edit needs it, none is added, and once docs/prereg/protege.md is signed nothing changes but by a dated amendment (Q32).

---

## 6. Each wave in brief

**Wave 1 (PR-001 to PR-033; 37 packages, 93.75 agent-days, 196 h).** Stage 0: K1-0, K1-1, K1-3, K3-1, K3-2, K5-1, K3-9, K1-2. Learner-facing: K1-7 (held on Q2), K1-22, K1-9, K1-10, K1-17, K1-31, K1-14 (held on Q2), K1-16, K1-30, K1-13, K1-15, K1-18, K1-32, K1-19, K1-4, K1-21, K1-23, K1-20, K1-8 (two PRs), K1-24, K1-25. Release: K1-27, K1-28, K1-5. After it: K1-6 (fills t0.l7; held on Q2), K1-11, K1-12. Owner steps: K1-26, K1-29. New in this roadmap: K1-0, K1-30 (O15's t1.l6, which no planner owned), K1-31 (L2's second half, which Wave 0 left), K1-32 (L6's second half and t4.l3's four tasks, which Wave 0 left), t1.l5's "optional" mark (section 5.6) inside K1-5. Opus for the spec, the structure review, t0.l1, Q K V and the t1.l6 table; Sonnet for the guard, the time helper, the simulators.

**Wave 2 (24 packages, 89 agent-days, 160 h).** K2-1 to K2-23 as planned, with K2-24 added (F4's section and exercise, which Wave 0 handed on). K2-20 and K2-21's Daily parts wait on PR-H2 (Q8); K2-4's stops are ungraded until Q29. Every number a claim token and every lesson in the shape from the first commit (stage 0). Block mounts through existing blocks (Q11). Opus for N16 and the t6.l1, t6.l2, t6.l4 rebuilds; Sonnet for t5.l10, t7.l2, t4.l7, the Fleet and the residual T6/T7 edits.

**Wave 3 (10 packages at default, 34 agent-days, 60 h, beside Wave 2).** K3-3 (shrunk to what no rewrite touches), K3-4, K3-5, K3-6, K3-7, K3-11, K3-12 (no pin change), K3-13, K3-14, K3-15; K3-8 only on a signed keep; K3-16 (P4's comparison) only on a signed protege.md (Q32). K3-1, K3-2 and K3-9 moved to stage 0; K3-10 absorbed (section 5).

**Wave 4 (15 packages at default, 57 agent-days, 92 h).** K4-1 at PR-034; K4-2 to K4-8, K4-11, K4-13 to K4-15, K4-17, K4-18 in the stack; K4-10 held on Q7; K4-9, K4-12, K4-16 only on a yes; K4-6 builds compile-bank items, not a drill crate (Q18). Mostly Opus: every lab change needs a new mutant, a recalibration from private references and a check that kills it, and each recalibrating PR waits for the owner's durable copy (Q16).

**Wave 5 (24 packages at default, 116.5 agent-days, 172 h).** K5-2 to K5-22 (K5-1 moved to stage 0; K5-7 narrowed to labels and graded tasks; K5-10 narrowed to r.l1, r.l2 and r.l4's move; K5-17 narrowed to T6, T7 and t4.l7 plus the gate), K5-26, K5-27 (A30's second half, which no planner owned) and K5-28 (T5's pass and section 5.6's echoes, which no package owned). K5-7b, K5-23, K5-24, K5-25 only on a yes.

---

## 7. Owner questions

Each has: the question, the options, **the default the build takes if the owner says nothing** (the option cheapest to undo), and what waits. Work that does not depend on an answer goes ahead. Numbered once; answer a group together. Q28 to Q32 were added by the critic's round and sit in their groups (Q32 in D, Q28 and Q29 in E, Q30 and Q31 in G).

### Group A: capacity (ask first)

**Q1. Review hours and order.** The plan caps review at 10 h a week and starts a wave only when the previous wave's queue is under 10 h (PLAN-100X.md:675-676; OD11 "revisit at the Wave 1 exit"). At that pace the 680 h take about 68 weeks and Wave 2 is reviewed around 2027-09, after the spring-2027 date the report puts on the serving lead. Options: (a) the plan's 10 h a week and gate, PRs in section 4's order; (b) 15 h a week (OD11's other option: Waves 2 and 3 by about 2027-06-15); (c) 10 h a week, but Wave 2 goes right after stage 0 and the release spine (K1-13, K1-9, K1-4, K1-27, K1-28, K1-5; with stage 0 about 92 h, or 104 h if Q2 releases K1-7 and K1-6 by then), and the rest of Wave 1 follows Wave 2 (Wave 2's 156 h in the stack reviewed by about 2027-05-29); (d) waves overlap in review. **Default: (a)**; agents build ahead on branches, at most about 10 h of review sits in open PRs, branches open in section 4's order. **Waits:** when each PR opens, not what is built.

### Group B: people and hardware

**Q2. Learner sessions.** One question for four session sets, each with a think-aloud protocol the build drafts for the owner to read first: (i) five newcomers on today's t0.l1, r.l1 and t2.l1 before Wave 1's content (section 7 of the report: "it should precede the months of work, not accompany them"; the plan's own unmet gate "≥5 partners complete the block-placement loop", PLAN-100X.md:689); (ii) five newcomers on the new first hour after the release (K1-29); (iii) timed learners on r.l5, r.l10, N2 and labs 04, 05, 07 (K4-18 item 3); (iv) three to five learners on the rebuilt t2.l1 and the queueing lesson (K5-26). Options per set: run it or not; for (i), also whether the three PRs that rewrite what it observes wait for its notes. **Default:** the build runs no sessions; the kits merge (PR-001, PR-081, PR-104); **PR-009 (K1-7, t0.l1), PR-015 (K1-14, t2.l1's primer) and PR-029 (K1-6, N1 read right after t0.l1) are built but not merged until the sessions have run or the owner answers (i)**, because once they merge the kit no longer observes what the audit predicted; every other Wave 1 PR goes ahead and says it was not checked against a learner (r.l1 changes only in Wave 5). Lesson times stay declared. **Waits:** those three merges; measured minutes (PR-O2); any change the sessions ask for.

**Q3. Hardware sessions.** One question for: (i) the two field labs on one rented H100, at most 1.5 GPU-hours each (PLAN-100X.md:448), from K1-25's runbook, and the public name or handle for `ranBy`; (ii) if Q26 is yes, N14's profile capture in the same pod; (iii) K4-17's real-engine run on the owner's own machine, WebGPU and CPU-only; (iv) K4-8's all-Relaxed queue script on an ARM machine (the owner's Apple Silicon or Graviton, or a workflow_dispatch job on GitHub's arm64 runner, a workflow change only the owner makes). **Default: nothing runs;** pages keep "Not run on a GPU yet.", "Not run on a GPU by the course yet" (N16), "not run by the course yet" (K4-17), "x86-64 only" (K4-8). **Waits:** PR-O1, N16's measured row, N14, K4-17's measured line, K4-8's ARM line.

### Group C: stored progress (needed before PR-031)

**Q4. New lessons and the rings.** Rings are derived lists of lesson ids (src/lib/economy-table.ts). New lessons: t0.l7 (RING 2), t6.l13 (ROOT), t5.l11 N3 (RING 0), t6.l14 N16 and t7.l6 N9 (ROOT), t3.l8 N2 (RING 1), t7.l7 N4 (ROOT); if built, t6.l15 N12 (ROOT) and t4.l8 N14 (RING 1). Options: (a) the ring lists keep their ids; each new id goes on a named, dated exclusion list the table test reads (as wave-3.md D79 did for t6.l12: "Whether ROOT grows is the owner's call"); (b) add them, which takes the ring from every learner who holds it on deploy, **against the recorded rule** "Rings derive from the ledger, never revoke" (PLAN-100X.md:297; economy.ts:189); (c) add them with a rule that a ring once earned stays earned, which changes the rings' derived model. **Default: (a).** t1.l5 stays in RING 2's list while marked optional. **Waits:** the lists and tests/economy/table.test.ts only; every lesson ships either way. Answer before PR-031 or the default is built.

**Q5. When a lab gains a check** (K4-7, K4-8, K4-10, K4-11, K4-13, K4-14). Options: (a) earlier green completions and rings stand; the new check applies to runs after the release and the lab page names what changed; (b) the lab reopens for everyone and rings recompute, **which revokes** against PLAN-100X.md:297. **Default: (a).** **Waits:** K4-15's rule text.

### Group D: running experiments (signed and draft pre-registrations)

**Q6. serving-reading.md (unsigned draft).** K1-12 adds a line-by-line gloss before the rustc question and K1-28 moves the mask-walk reading block's host to t6.l13; both change what the draft measures. Options: (a) amend the draft in those PRs, sign after; (b) hold the gloss until the think-aloud has run; (c) sign the draft as it stands first, after which both changes need dated amendments. **Default: (a)**; if the owner has signed by then, the gloss waits for the owner's dated amendment. **Waits:** the gloss part of PR-033; the host list in PR-030 only if signed first.

**Q7. hint-ladders.md (signed 2026-10-14).** Lab 02 is one of the labs whose every red check is randomized (section 2), and "nothing below changes after it except by a dated amendment". K4-10 adds a copy-on-write read-back check, demotes the capacity check and adds a dump stage. Options: (a) sign a dated amendment that keeps the new and changed lab 02 checks out of the randomization (whole ladder, no arm, as labs 04 and later are); (b) an amendment that randomizes them as new checks; (c) leave lab 02 unchanged while the experiment runs. **Default:** K4-10 is built and held unmerged (PR-H1) until the owner signs. **Waits:** PR-H1.

**Q8. fleet-daily.md (signed 2026-10-14).** K2-20 moves the incident section (and with it when four fault KCs' cards are created; the file counts checks "at least 30 local days after that KC's card was created") and K2-21 changes what the Daily's probes print. The file was signed on 2026-10-14 and says "Nothing below changes after the signature except by a dated amendment at the end of this file" and "Nothing above it is edited after signature". Options: (a) sign a drafted dated amendment recording the release date of the Daily-facing changes, so the exit reading can split before and after, then merge them; (b) hold the Daily-facing changes until the study's exit reading. **Default:** the parts that do not touch the study ship (PR-048: the incident section's prose, table and metric names, with the sig items left in t7.l5; PR-043: the Fleet's items 1 to 5); the parts that change when four fault KCs' cards are created or what the Daily shows (the sig items' move, KC t7.leading-signals' lesson list, the Daily's link to the section, the intake probe's text) are built as PR-H2 with the amendment drafted in a separate file, and PR-H2 is not merged until the owner signs it. **Waits:** PR-H2 only.

**Q9. tag-reread.md (new, from K3-7).** Sign it with the keep bar (block size flagged as a stated must-flag; recall at least 0.80; precision at least 0.50; at most 15 flags a week; at least 5 rated-changed pairs; the snapshot.json window as the primary test, the v0.31.0 to v0.34.0 tags reported apart because their answer is known), or amend the bar before any rating exists; and launch the blind rater yourself or let the orchestrator launch a fresh agent (watcher.md's rule). **Default: unsigned;** the snapshot and scoring script merge, nothing is scored, K3-8 is not built, the manual release-note scan stays. **Waits:** PR-C1.

**Q32. protege.md (unsigned draft).** The false-sentence block is best in class and the report says of P4's within-learner comparison: "run that comparison rather than take this audit's word that it belongs in most lessons" (section 6 item 3). docs/prereg/protege.md is a draft "for the owner to sign"; until then "every protégé block shows the protégé arm to everyone ... and nothing a learner does on one is data". Its keep/kill row in the plan defaults to "one per track" if underpowered (PLAN-100X.md:775). Options: (a) leave it unsigned: the nine blocks stay, one per track, and packages that edit a host lesson move a passage only where their edit needs it and add none; (b) sign it as drafted: K3-16 builds the reading arm, assignment and recording (PR-C9), and from the signature no host passage changes except by a dated amendment; (c) amend the draft's section 6 choices first, then sign; (d) decline, and the file is withdrawn, as it says. **Default: (a).** **Waits:** PR-C9 only. Every package that touches a host lesson (r.l4, t0.l2, t1.l4, t2.l2, t3.l4, t4.l3, t5.l5, t6.l1, t7.l1; 24 packages) carries a note saying so.

### Group E: the owner's recorded rules

**Q10. Boot's last step.** The audit calls Boot step 6 a 2,131 px planning form and asks to move it after the first lesson or collapse it. PLAN-100X.md:486 and :496 put "Set your week" in Boot. Options: (a) collapse it to one choice inside Boot that still writes boot:week; (b) move it after the first lesson (reverses :496); (c) leave it. **Default: (a).** **Waits:** one part of PR-010.

**Q11. New block types.** PLAN-100X.md:601: "New block types (cap four): predict, item, play, protege"; `reading` (SR-D4) already went past it once. Candidates: history (K3-9), a twin block (K2-3), a chart block (K2-16), a calculator block (K2-19), a drawn-figure block for t4.l3's roof (Wave 0's left-out K0-A11, now K1-32). Options: (a) none; history is a callout variant, and twin, chart, calculator and the roof mount through existing exercise or play blocks; (b) lift the cap for the ones named. **Default: (a).** **Waits:** src/data/lessons/types.ts only.

**Q12. Price claims' life.** The schema gives prices 90 days, within the plan's "TTL of ≤90 days" (PLAN-100X.md:572); the audit found six of eight prices stale after 45 days. 30 days is inside the rule; the cost is the owner's re-reads, which triple. Wave 0's own default for its owner question 12 already adds one 30-day price claim, `price.h100.median-2026-11`, used only by t7.l4's dated median (docs/specs/k0.md section 6); this question is about every other price. Options: 90 days as the schema has them; 30 days for all prices; 30 for rental medians, 90 for list prices. **Default: as the schema has them** (Wave 0's one 30-day claim stays as Wave 0 sets it). **Waits:** ttlDays and the schema comment.

**Q13. Field Notes cadence.** PLAN-100X.md:567 and NEXT.md:7 say quarterly. Options: monthly; quarterly with a monthly candidates issue; quarterly as now. **Default: quarterly as now.** **Waits:** K3-15's period field and the issue cadence; the owner's curation hours.

**Q14. The "isomorphism" panel's name.** The panel is "OS ≡ LLM isomorphisms" in PLAN-100X; the audit (D10) says the name overclaims since every panel shows where the analogy breaks. Options: (a) keep name and sign; (b) learner-visible label "mapping", no "≡", every id and ref kept; (c) rename the type too. **Default: (a).** **Waits:** label strings only.

**Q15. When the Fleet Daily is offered** once the incident section sits at the end of T5. Options: (a) from day one, with a link to the section on its first screen; (b) only after the section is read, **which reverses** wave-1.md W8 "Nothing locks". **Default: (a).** **Waits:** the offer rule, which ships on PR-H2 (Q8).

**Q28. What t4.l3's batch-to-ridge task grades.** The task's tolerance is rel 0.45 (roofline.tasks.ts:155) and the slider moves in powers of two, so "You said 295 requests; the sim measured 512 requests" is graded "Your prediction held." Wave 0 left "the 'prediction held' tolerance" out as a grading decision and asked no question about it. Options: (a) grading unchanged (truth, tolerance, rev); the verdict text names the predicted value, the measured value and the tolerance that accepted it; (b) the task asks for the batch at which intensity reaches the ridge and grades against the crossing with a tight tolerance (the task's rev changes, and every learner who answered it sees a re-check flag); (c) a continuous slider so the measured value is the crossing. **Default: (a).** **Waits:** the grading half of PR-019a; the drawn roof, the lab on the lesson's tasks and the cut to four go ahead.

**Q29. Items in t2.l7 answerable only from the paper** (Wave 0's owner question 24, which it asks "before Wave 1": "it changes what the exam grades"). K2-4 adds three stops to t2.l7, each a question answered from the paper. Options: (a) the stops are ungraded: each answer sits behind a reveal and nothing is recorded; (b) each stop is a choice or numeric item with a why per option, recorded and graded like the rest of the exam. **Default: (a).** **Waits:** the stops' form in PR-045.

### Group F: labs and toolchain (before Wave 4)

**Q16. Where the private reference solutions and mutants live.** wave-1.md O1 settles who writes them ("Agents write them locally under labs/_solutions/ ... never committed or packed"); the only copy is in the old detached checkout. A scratchpad can be cleared, so it cannot be the only copy of a new reference or mutant; losing one cannot be undone. Options: (a) agents copy the old checkout's files (read only) into each worktree; new and changed private files go into a tarball whose path and sha256 the PR body names, nothing private is attached to a public PR, and **the PR is not merged until the owner confirms the tarball is copied somewhere durable**; (b) a directory the owner names outside every worktree, git repository and scratchpad, which agents write to directly; (c) a private repository agents may clone and push a branch to (the owner creates it); (d) the owner copies new files in by hand from a list in each PR. **Default: (a).** **Waits:** the merge of every recalibrating lab PR (PR-074 to PR-079, PR-H1); nothing in the build.

**Q17. Faded hint ladders, labs 04 to 08.** All five bundles have `fade: 'r2'` (wave-3.md D13, D26, Q3). The audit asks for the full ladder (R0 to R4) on labs 07 and 08; K4-8 and K4-11 also wanted rungs R3 and R4 for labs 04 and 06. Options: keep the fade for all five; full ladder on 07 and 08; on 08 only; on any of 04 to 08. **Default: keep the fade;** scaffolds that leave a learner's file (lab 04's algorithm, lab 06's policy, lab 07's arena shape) become R2 ideas within the word limit. **Waits:** where those scaffolds go in PR-075, PR-076, PR-077, PR-078.

**Q18. N2's drill.** Options: compile-bank items in the lesson; an eleventh Rust Zero drill crate (private reference, mutants, calibration on 10,001 seeds, archive, devcontainer). **Default: compile-bank items** (K4-6's fields describe only these). **Waits:** a crate, added to PR-073 or after it, only on a yes.

**Q19. loom for lab 04** as a native-only dev-dependency, against the zero-dependency rule (PLAN.md "zero-dependency wasm ABI"). **Default: no;** K4-8's measured, labelled record stands. **Waits:** PR-C2.

**Q20. Lab 06's own simulator with a step time that grows with the batch.** PLAN-100X dated step-time exercises to 2027-10, and S5 shipped no graded engine exercise (s5.md S5-D69). Options: build it now in the lab only; wait for the plan's date; never. **Default: not built;** the lab page says in one sentence that its step time does not grow with the batch. **Waits:** PR-C3.

**Q21. Lab 08 split** into 08a and 08b (new lab id, archive and path step; the public "8 Rust labs" changes) or one lab restaged. **Default: one lab, restaged.** **Waits:** the split only.

**Q22. Rust toolchain.** labs.yml pins rustc 1.96.0 "so a new stable release never changes lab results under a PR"; PLAN-100X.md:567 schedules "compile-bank and Miri pin updates" quarterly. Options: stay on 1.96.0 and edition 2021; move labs and compile bank to the current stable and edition 2024 (K4-16, with the compile-bank commit dropped from K3-12); move the compile bank only. **Default: stay.** K3-11's non-blocking nightly step shows what a move would flip (A47). **Waits:** PR-C4.

### Group G: optional scope

**Q23. T3 off the default full ramp** (the audit: "the owner's decision, not a cheap move"). Options: (a) T3 stays; track pages say T4 may be taken first; (b) T3 becomes a branch the learner opts into (changes RING 1's list, APPROVED_BRAID, placement's entry tracks and N2's position). **Default: (a).** **Waits:** must be answered before PR-031 so the structure changes once.

**Q24. The full R rewrite** (six cards to the standard of r.l3, r.l4, r.l8, r.l9; R from 332 declared minutes to about 500 to 600; the audit calls it the owner's call, after T6 and T7). **Default: not built.** **Waits:** PR-C6; on a yes, r.l1 and r.l2 leave PR-102.

**Q25. N12, encode as a stage, embeddings and rerankers.** It reopens the catalog cut of 2026-10-24. Options: not built; one T6 lesson (about 9 agent-days, slot t6.l15, outside ROOT unless Q4 says otherwise); a section of t6.l3 (about 2 days). **Default: not built.** **Waits:** PR-C7.

**Q26. N14, measuring a GPU** (a T4 lesson on recorded H100 profiles; needs Q3's session). **Default: not built.** **Waits:** PR-C8.

**Q27. T2 simulators rebuilt as discrete-event mechanisms** (K5-7b, beyond the report's "say it is a model, or make it real", which K5-7 and K5-9 already do). **Default: not built.** **Waits:** PR-C5.

**Q30. The report's sections "if wanted"** (section 5.4: "As sections, if wanted"): tensor cores and a modern kernel in t4.l6; sharing a GPU by MPS or MIG; quality as an axis in t4.l7 and t7.l3; one worked million-token request in t6.l4; containers as cgroups and namespaces for t6.l10. (The sixth item, reasoning traffic, is M9 and is planned in K2-15 and K2-18.) Options: none; any subset, each a section of about 1 to 3 agent-days sized when chosen, built in Wave 5 after its lesson's pass. **Default: none built.** **Waits:** nothing; a yes adds a package and a PR-C row.

**Q31. Labs 02, 06 and 07 as stages of one engine** (section 5.4: "After that, labs 02, 06 and 07 as stages of the engine the Fleet already wires five crates into"; the same paragraph gives Wave 4 its D9 and L14 work). It changes the labs' structure and would recalibrate three labs. **Asked after K4-17 (PR-080) merges**, when the real-engine run shows what wiring the crates together needs. **Default: not built.** **Waits:** nothing; a yes adds a Wave 5 package (sized then, against K4-1's record and K4-17's run).

**When to ask:** Q1, Q2, Q4, Q6, Q10, Q11, Q14, Q16, Q23, Q29 in week 1 (they bear on stage 0, the release and Wave 0's hand-over); Q28 before PR-019a; Q3, Q8, Q12, Q15, Q32 before Wave 2; Q9 and Q13 during Wave 3; Q5, Q7, Q17 to Q22 before Wave 4; Q31 after PR-080; Q24 to Q27 and Q30 before Wave 5. A late answer never blocks: the default is built and the answer changes a list, a label or one PR, except that the three PRs held on Q2 (i), PR-H1 (Q7), PR-H2 (Q8) and the recalibrating lab PRs (Q16) wait for theirs.

---

## 8. Steps only the owner can take, and what the build prepares

| Step | When | The build prepares |
|---|---|---|
| Answer Q1 to Q32 | Section 7's timing | This file; one PR per question's effect. |
| Merge every PR, in order | Throughout | A stack rebased on the tip, each PR's gates run from a pristine export at 4 cores, the list of changed pins, and for content PRs the ref-guard allowlist diff. |
| Recruit and watch five newcomers on today's t0.l1, r.l1, t2.l1, or answer Q2 (i) "no sessions" | Before PR-009, PR-015 and PR-029 can merge (they are held until then) | PR-001: a draft protocol to read first, task script, observation sheet, minutes-per-step report, and the record of master against d478f91. |
| Five newcomers on the new first hour | After PR-031 deploys (and PR-029, once released) | K1-29's kit (reuses PR-001's). |
| Timed learners on the Rust ramp and labs; optional sessions on the new shape | After Wave 4; after PR-096 and PR-083 | PR-081 and PR-104. |
| Rent one H100 (the RunPod credit), run the two field labs (at most 1.5 GPU-hours each), paste outputs, choose the public `ranBy` name | Any time after PR-028 and Wave 0's re-pin; before PR-042 if N16 should ship with its measured row | K1-25's runbook (pod image, driver and CUDA checks, the pinned commands by claim id, stop rule), the parser; PR-O1 follows. |
| N14's profile capture in the same pod | Only if Q26 is yes | K5-25's capture script and runbook (nsys checked in the container first). |
| Run the real-engine panel once on your own machine, WebGPU and CPU-only | After PR-080 | PR-081's runbook and the panel's export. |
| Run the all-Relaxed queue script on an ARM machine, or add an arm64 workflow_dispatch job | After PR-075 | PR-075's script and record format. |
| Sign or amend serving-reading.md, hint-ladders.md (amendment), fleet-daily.md (amendment), tag-reread.md; launch or approve the blind rater | Q6 to Q9 | Drafts in separate files, each PR naming what it changes in which study. PR-H1 and PR-H2 wait for the two signed studies' amendments. |
| Sign, amend or decline docs/prereg/protege.md (P4's comparison) | Q32, before Wave 2 rewrites host lessons | The note in each of the 24 packages that touch a host lesson; K3-16 ready to build on a signature. |
| Copy each lab PR's private references and mutants somewhere durable, and say so on the PR | Before each of PR-074 to PR-079 and PR-H1 merges | A tarball per PR, its path and sha256 in the PR body; the PR's merge waits for the confirmation (Q16). |
| Curate Field Notes at the chosen cadence | Quarterly by default | PR-068's candidates issue. |
| Merge the PRs that add or change workflows (freshness.yml, listings.yml, ci.yml, deploy.yml steps) | PR-006, PR-035, PR-041 | Each runs on manual dispatch on a fork first; the scheduled job uses GITHUB_TOKEN only. |

---

## 9. The advocate's findings

All 35 were checked against the tree at d478f91 (PLAN-100X.md:296-297, 322, 448, 485-486, 496, 524, 543, 565-572, 601, 674-677, 689, 733, 753, 827; labs.yml:37-38; the five forge bundles' `fade: 'r2'`; wave-1.md W8, O1, O5; wave-2.md:26 and :1276; wave-3.md D1, D13, D25, D26, D43, D79, Q3; s5.md S5-D15, D16, D57, D69; serving-reading.md SR-D4 and its unsigned status; hint-ladders.md and fleet-daily.md signed 2026-10-14 with the amendment rule; watcher.md:23; economy.ts and economy-table.ts; resolve.ts:35-52). Each held, and each is applied; the field `roadmap_changes` in packages.json names the finding in each package it changed.

| Finding | Applied as |
|---|---|
| 1 review hours | Section 1's estimate and Q1. **In part:** the default opens PRs in section 4's order, which interleaves Wave 3 with Wave 2 and puts K4-1 at PR-034, not strict wave order, because the report runs Wave 3 in parallel and K4-1 changes nothing yet scopes Wave 4. |
| 2 stage-0 newcomers | K1-0 (PR-001) and Q2 (i). |
| 3 Boot step 6 | K1-22 default collapses it inside Boot; Q10. |
| 4 K3-12 pin | Pin commit dropped; folded into Q22 with K4-16. |
| 5, 6, 7 fade | K4-8 and K4-11 default to R2 ideas; one question for labs 04 to 08 (Q17). |
| 8 hint-ladder prereg | K4-10 held on Q7 (PR-H1); K4-17 no longer waits for it. |
| 9 K3-9 too big | Erratum only when a rendered value changes meaning; check reports; history as a callout variant. **Kept:** the erratum kind `history`, which the report asks for. |
| 10, 11, 12 block types; S5's H1 | Q11; K2-16's chart ungraded; K2-19 takes g from measured claims. |
| 13 K4-1 tarball | Default changed: nothing private committed or attached, path and sha256 in the PR. The critic's round changed it again (section 15, finding 9): a recalibrating lab PR merges only after the owner confirms a durable copy. |
| 14 r.l3, r.l4, r.l8, r.l9 | Named exceptions in K5-1; K5-10 narrowed. |
| 15 K5-7 | Narrowed to 4 days; mechanism rebuild is K5-7b on Q27. |
| 16 K1-3 revs | Codemod skips hashed fields; zero rev changes required. |
| 17 slots and rings | N4 and conditional N12, N14 slots; option (b) marked revoking; named exclusion list; one rings question (Q4). |
| 18 spiral and counts | Spec states T3's spiral per path; counts derived. |
| 19, 20 fleet-daily | Option (b) labelled as reversing W8 (Q15); drafted amendments in separate files (Q8). |
| 21 V4.1-Flash preset | Config at a pinned revision or a labelled synthetic example. |
| 22 K2-8 | Stale reason replaced by S5's record; new variant is arithmetic or ungraded. |
| 23 K2-12 | Spec-sheet and benchmark status per row; Rubin discrepancy kept. |
| 24 K3-1 early | K3-1, with K3-2 and K3-9, in stage 0. |
| 25 K3-5 upkeep | The PR prints renewals per month. |
| 26 K3-7 window | Snapshot window primary; known-outcome tags reported apart. |
| 27 K3-14 framing | Q12 framed as re-read hours; default "as the schema has them". |
| 28 K4-3 dependency | Dropped. |
| 29 K4-5 PR text | Stated. |
| 30 K4-6 rings and counts | Rings via Q4; derived counts. |
| 31 K4-15 option (b) | Labelled revoking (Q5). |
| 32 option shortening | Ids and miss ids kept; allowlist; re-pointed counts printed. |
| 33 K5-22 | Uses the N4 slot; no KC migration. |
| 34 hardware | One question (Q3). |
| 35 learner sessions | One question (Q2); its default for (i) changed in the critic's round (section 15, finding 8). |

Changes this roadmap made beyond the advocate: K5-1 moved to stage 0; K3-10 absorbed into K1-21, K2-6 and K2-4 so no sentence is edited twice; K3-3 shrunk accordingly; K3-5's rule for lessons with a pending rewrite; K1-3's dependency on the spec dropped so the codemod lands first; K1-4 ordered before K1-21 (both edit t0.l4); K3-12's r.l5 and r.l10 rows handed to K4-2 and K4-3; K3-6's product step decoupled from K3-5; K5-7 before K5-9. New packages for report items no planner owned: K1-0 (section 7 "Before anything", including the master vs d478f91 diff), K1-30 (O15's t1.l6), K1-31 (L2's second half), K2-24 (F4's section and exercise, which Wave 0 handed to Wave 2), K5-27 (A30's second half), A31's section inside K5-16, t1.l5's optional mark inside K1-5.

---

## 10. What will not be built, and why

From the planners' lists, kept, with this roadmap's additions:
- **Refused by the audit or the owner's records:** T2 reordered (O6; refused in section 8, so K1-14's primer instead); renumbered lesson ids (O14; unsafe while only fold.ts applies ref migrations); O11's nine-lesson serving head (215 declared minutes against 75); N1 as Boot step 0 (Boot is kept best in class, with a frozen 200 KB budget); merging t3.l6, splitting r.l10 and t2.l5, rebuilding t3.l5, loom as a first step (section 8). Reviving the landscape watcher (signed backtest scored drop, wave-3.md D64); a CI gate that fails on expiry ("Expiry never fails CI", PLAN-100X.md:322); automatic re-pins or edits from a miss ("nothing auto-merges").
- **Gated by the owner to a later date:** calibrated step-time exercises (S5, and see Q20); an agent-session Fleet mode (2027-11; prose and generators instead); "W2 Be the Scheduler" interleaving play (2027-11; items only); K1 v2 and generating 70% of KCs (2027-11; Wave 5 takes coverage from about 52 to about 75 of 155 KCs); new protégé blocks (P4 gates their growth on a within-learner comparison; the comparison itself is Q32 and K3-16).
- **Withdrawn by the report or bigger than its evidence:** N5 as a six-stop traced walkthrough of vLLM (Engine Internals owns the trace; K2-5 is a map with links); tripling T7's prose; a T6 simulator for expert load (the EPLB play's debrief instead); a store-buffer simulator for r.l10; a separate KV-cache-in-Rust lab and an "efficient" tier (collides with the plan's reserved lab numbers; an owner call to raise with Wave 5); R drills from broken code, a drill that writes a lifetime, the learner writing unsafe (belong with Q24); lab 03's streaming detokenization stage and lab 01's sorted-map dodge (K4-1 records the dodge for the owner).
- **Not mechanical:** shortening all 1,339 quiz options at once (each shortened option needs its why checked; done lesson by lesson in the passes and rewrites, about 600 in Wave 5); renaming the isomorphism type or its item pool (ids are keys in stored data; Q14 covers only the visible label); rendering quiz keys from claims across all items (needs per-item re-check semantics; generators already do it); benchmark claims timed by CI runners (too noisy); running the CUDA listing (no GPU in CI; marked a fragment with that reason); applying canonicalRef in every reader (not needed while no id is renamed).
- **Absorbed, not dropped:** K3-10 (into K1-21, K2-6, K2-4); the Brown Rust Book pointer per R card (K1-24's "Go deeper" carries it); routing the finales (K1-11).
- **Not in the report's fix, and left out by Wave 0 too:** A46's Museum anchor rename (the report's fix is "Show the real message; name RwLock", which Wave 0's K0-C44 does; `BorrowMutError` is a key in museum.ts:30 and :39 and in generated items, and it is the real name of the Rust type, so renaming it re-keys stored items for no learner gain); L7's tolerant Fleet pass rule (the report's fix is the rename and throughput generated from concurrency and TPOT, Wave 0's K0-B10 and B11); L1 as a change to recommend() (Wave 0's K0-A1 to A3 close L1; the change would touch the K3 metric at wave-1.md:801).
- **Moved to owner questions by the critic's round:** labs 02, 06 and 07 as stages of one engine (Q31, asked after PR-080) and the five sections "if wanted" (Q30). t4.l3's eight tasks to four and L6's second half are built (K1-32); only the tolerance is a question (Q28).

---

## 11. Dated items

- **2026-12-04 and 2026-12-13.** 11 engine claims lapse on the first date and 17 more on the second. Wave 0's re-pin to vLLM v0.34.0 is the repair (the other run, due before 2026-12-04). Nothing here waits on those dates, but everything that names vLLM waits on the re-pin's merge: K1-25's runbook and predictions are regenerated from the re-pinned claims; K2-3's twin and K2-5's map are pinned to v0.34.0; K3-1 adopts whatever mechanism Wave 0 wired F4 through. Expiry never fails CI, so a lapse the re-pin misses shows learners "stale since" chips; K3-6 (PR-035) lists any that remain.
- **Spring 2027.** The *Machine Learning Systems* series plans predict-first labs on a continuing fleet project for spring 2027 (its labs page, read 2026-11-18). Wave 2 defends T5 to T7. At 10 h a week of review it is reviewed around 2027-09; Q1 (b) or (c) brings it to about 2027-06-15 or 2027-05-29.
- **vLLM v0.34.0 (2026-11-16) and the Rubin announcement (2026-11-17)** came after the audited export (2026-10-30). Wave 2 reads each engine and part at its newest release on the day a package is built, not at the audit's reading.
- **Claim lives created by this work:** status claims for every product (K3-5, 60 days), engine-table cells (K2-5, 60 days), Polonius and nightly claims (K3-12, 45 days), prices (90, or 30 on Q12). K3-5's PR prints the renewals per month against the plan's upkeep target (about 4.5 h a week estimated against 4 h, PLAN-100X.md:733).
- **The plan's calendar:** 2026-12-21 to 2027-01-03 off in PLAN-100X §8; OD11's 10 h a week runs to 2027-10-17.
- **Dynamo's KVBM removal** is targeted for v1.7.0 (K2-6 writes KVBM only as dated history).

---

## 12. What none of this can verify

- **No learner other than the owner has used the course** (the tree holds no other record; report section 8). Every "Gains" line in section 4 is a prediction until Q2's sessions run, and declared minutes stay declared.
- **No GPU number exists yet.** The field labs, N16's measured row, N14 and the real-engine run say "not run" until the owner's sessions.
- **No lab has been compiled or graded by the audit.** K4-1 is the first run of any escape the audit reasoned about; Wave 4's packages must be re-scoped from its record, and K4-1 may find that the old checkout's private references do not reproduce master's calibrations, in which case every lab package waits on the owner.
- **The audit's tables are a worklist** (section 8 of the report): every row is re-read at its source on the day before it becomes text. The web checker did not re-check A17, A33, M9 and the comparisons of teaching quality; those packages carry the risk in their briefs.
- **Sizes are estimates.** Agent-days are the planners'; review hours are a proxy mapping of the plan's S, M, L; owner hours for sessions, GPU runs, signatures and curation come on top.
- **Wave 0's final plan was not complete** when this was written. Its task list and plan (neither is in the repository) were rewritten at 00:45 to 00:48 on 2026-11-21; the critic's round re-read both (101 tasks; owner questions 1 to 27; section 7's left-out list) and section 14's ledger was generated from that read. Re-run the ledger script (not in the repository) when Wave 0 is final.
- **Which build the live site serves** was not recorded by the audit; K1-0 records it.
- **WebGPU in CI** is unknown (K5-27 tests the fallback path in CI and the WebGPU path by hand).

---

## 13. What each wave's detailed plan must re-read first

The tree will have moved. Before task-level planning of any wave:

**Every wave:** git log and diff of master against the last wave's base and against d478f91 (K1-0's record keeps this current); the Wave 0 run's final files and what of them merged, with the ledger script (not in the repository) re-run against its final task list; the build conventions file (not in the repository: merge gate on a detached HEAD, gates from a pristine export at 4 cores with CI=1, no raised budget or baseline, generic User-Agent for any fetch); the owner's answers to section 7; the stack tip's sha, which every brief names as its base; the frozen budgets as they stand (entry chunk, route budgets, search index headroom, verify-items ratchet, KC graph cap).

**Wave 1:** Wave 0's merged edits to t0.l1, t0.l6, t1.l3, t4.l1, t4.l3, t4.l4, t7.l2, Boot, Today, placement and the lesson key handler (L1 to L3); how Wave 0 wired F4 (K3-1 must adopt it); src/data/lessons/index.ts, paths.ts, paths.test.ts, economy-table.ts and its test, resolve.ts, refs.ts, fold.ts; serving-reading.md's signature status; field.ts after the re-pin; the citation count for K1-3's match list.

**Wave 2:** K1-2's spec and K1-5 as merged (the slot ids, the exclusion list); K3-1's token syntax and K5-1's baseline; the claims registry after the re-pin; each engine, model card and hardware page at its newest release on build day (vLLM after v0.34.0, SGLang, Dynamo, TensorRT-LLM, DeepSeek and Kimi cards, Rubin); s5.md's decisions; fleet-daily.md and any amendments; T6 and T7 after K1-23's moves; Wave 0's corrected sentences that the rewrites must keep true (Wave 0's facts file, not in the repository).

**Wave 3:** K3-2's baseline as Waves 1 and 2 left it; the registry's counts and lives; watcher.md, docs/backtest/snapshot.json and the release tags since d478f91 (for K3-7's frozen inputs); the workflows (ci.yml, nightly.yml, deploy.yml) and Wave 0's listing mechanism (K0-B1) before K3-11; field-notes.json.

**Wave 4:** K4-1's record (which escapes are caught, whether calibrations reproduce, MSRV); the private references' state; labs.yml's pin; the forge bundles' fade fields and the answers to Q16 to Q22; hint-ladders.md amendments; K1-11's step kind; t2.l5 after K1-27; the R lessons after K3-12; the transformers.js runtime the real-engine panel loads, for K4-17's two-slot spike.

**Wave 5:** the shape-check baseline as it stands (the counts 39, 12, 17, 10, 53 and 16 will have fallen); the families list and KC coverage from verify:kc; the simulator registry's legacy count; every lesson after Waves 1 to 4; ROOT's list and the N4 slot; the sources for Goetz's pool formula, ModelExpress's 11 s and vLLM's 0.82 s and 197 s at their primary addresses; P4's status for protégé blocks; the answers to Q24 to Q27.

---

## 14. Id ledger: which Wave 0 task and which package closes each finding

<!-- ledger:start (generated by the ledger script, not in the repository; do not edit by hand) -->
Generated from the Wave 0 task list (not in the repository; 101 tasks, read 2026-11-21) and packages.json. 131 ids: Wave 0 only 30, Waves 1 to 5 only 64, both 37, nowhere 0. Wave 0 ids are as its tasks name them; a package is listed by its PR. Where both sides name an id, the last column says what each closes.

| Id | Wave 0 tasks | Packages (PR) | What each closes, or why a part is not built |
|---|---|---|---|
| F1 | K0-B13 | - | Wave 0 only. |
| F2 | K0-B2 | K3-11 (PR-041) | W0: t3.l4's listing compiles. K3-11: every listing compiled in CI, so it cannot recur. |
| F3 | K0-B6, K0-B7 | K3-9 (PR-007), K2-3 (PR-040), K2-4 (PR-045) | W0: t5.l5's figure and explorer. K2-3: settled at the source (lab 02 twin); K2-4: today's partial-hit copy in prose; K3-9: the history callout it uses. |
| F4 | K0-D0, K0-D1, K0-D3, K0-D2, K0-D4, K0-D6, K0-D5, K0-D7, K0-D20, K0-D18, K0-D11, K0-D14, K0-D15, K0-D16, K0-D12, K0-D13, K0-D19, K0-D17, K0-D22, K0-D23 | K3-1 (PR-004), K3-2 (PR-005), K2-24 (PR-046), K3-7 (PR-044), K3-8 (PR-C1, on a yes) | W0: the re-pin, the nine places wired to the claim, errata, guard test. K3-1/K3-2: chips and prose as claim tokens with the gate; K2-24: pool section and trade exercise; K3-7 (K3-8 on a yes): the tag re-read that should flag the next one. |
| F5 | K0-D0, K0-C2 | K3-5 (PR-049) | W0: the archived generators no longer recommended. K3-5: a status claim for every product named. |
| F6 | K0-B5 | K3-11 (PR-041) | W0: toymalloc.c made true. K3-11: listings in CI. |
| F7 | K0-C3 | K2-18 (PR-062), K3-3 (PR-066), K3-14 (PR-038) | W0: t7.l4's dated price sentences. K3-14: prices re-read, ratios generated; K2-18: t7.l4's close; K3-3: the dated chips left in T4 to T7. |
| F8 | K0-D0, K0-C4 | - | Wave 0 only. |
| F9 | K0-D0, K0-B8 | - | Wave 0 only. |
| F10 | K0-D0, K0-B9 | - | Wave 0 only. |
| F11 | K0-D0, K0-C11, K0-C12, K0-C9, K0-C10, K0-C8a, K0-C8b, K0-C1, K0-C7 | K3-5 (PR-049) | W0: every wrong Dynamo, NATS, KVBM and io_uring sentence. K3-5: status claims, so the next deprecation shows. |
| F12 | K0-D0, K0-C5 | K3-5 (PR-049) | W0: EPLB sentence and DeepEP dates. K3-5: status claims. |
| F13 | - | K1-21 (PR-022), K3-4 (PR-053) | Waves 1 to 5 only. |
| F14 | - | K1-21 (PR-022), K3-4 (PR-053) | Waves 1 to 5 only. |
| O1 | - | K1-6 (PR-029), K1-7 (PR-009), K1-8 (PR-026a), K2-1 (PR-036) | Waves 1 to 5 only. |
| O2 | - | K4-2 (PR-069), K4-6 (PR-073) | Waves 1 to 5 only. |
| O3 | - | K4-2 (PR-069), K4-4 (PR-071) | Waves 1 to 5 only. |
| O4 | - | K1-4 (PR-021), K1-5 (PR-031) | Waves 1 to 5 only. |
| O5 | - | K4-3 (PR-070) | Waves 1 to 5 only. |
| O6 | - | K1-14 (PR-015) | Waves 1 to 5 only. |
| O7 | - | K1-2 (PR-008), K1-5 (PR-031), K1-27 (PR-025) | Waves 1 to 5 only. |
| O8 | - | K1-2 (PR-008), K1-5 (PR-031), K1-20 (PR-024) | Waves 1 to 5 only. |
| O9 | - | K1-15 (PR-018), K1-20 (PR-024) | Waves 1 to 5 only. |
| O10 | - | K1-16 (PR-015a) | Waves 1 to 5 only. |
| O11 | K0-A16 | K1-5 (PR-031), K1-6 (PR-029), K1-9 (PR-011), K1-12 (PR-033) | W0: the serving-first warning in Boot. K1-5: path heads; K1-6: N1; K1-9: one path on screen; K1-12: the bridge banner. |
| O12 | - | K1-7 (PR-009), K1-17 (PR-013) | Waves 1 to 5 only. |
| O13 | - | K1-2 (PR-008), K1-5 (PR-031), K1-19 (PR-020) | Waves 1 to 5 only. |
| O14 | - | K1-2 (PR-008), K1-3 (PR-003), K1-5 (PR-031) | Waves 1 to 5 only. |
| O15 | K0-A17, K0-A18 | K1-30 (PR-016), K2-5 (PR-047) | W0: the stale signposts and their CI check. K1-30: t1.l6's body as a retrieval table; K2-5: t5.l10's ending. |
| O16 | - | K1-13 (PR-017), K2-2 (PR-037) | Waves 1 to 5 only. |
| L1 | K0-A1, K0-A2, K0-A3 | - | Closed by Wave 0 (K0-A1 to A3). A change to recommend() is not in the report's fix and would touch the K3 metric (wave-1.md:801): section 10. |
| L2 | K0-A4 | K1-31 (PR-014) | W0: keys inside widgets. K1-31: in-progress work survives leaving the lesson. |
| L3 | K0-A5, K0-A6, K0-A7 | - | Wave 0 only. |
| L4 | - | K1-6 (PR-029), K1-7 (PR-009), K1-29 (PR-O2) | Waves 1 to 5 only. |
| L5 | - | K1-8 (PR-026a) | Waves 1 to 5 only. |
| L6 | K0-A8, K0-A9, K0-A9b, K0-A10 | K1-32 (PR-019a) | W0: rendering (fence, embedded layout, labels). K1-32: the drawn roof, the lab on this lesson's tasks, eight tasks to four, the verdict text (Q28 for grading). |
| L7 | K0-B10, K0-B11 | - | Closed by Wave 0 (K0-B10, B11: the rename and generated throughput, the report's whole fix). A tolerant Fleet pass rule is not in it: section 10. |
| L8 | - | K1-9 (PR-011), K1-10 (PR-012), K1-11 (PR-032), K1-29 (PR-O2), K4-17 (PR-080) | Waves 1 to 5 only. |
| L9 | K0-A15 | K1-12 (PR-033) | W0: the cheap half (what a reading item is, what 'moved' means). K1-12: the line-by-line gloss. |
| L10 | - | K1-17 (PR-013), K1-18 (PR-019) | Waves 1 to 5 only. |
| L11 | K0-A12, K0-A13, K0-A10 | - | Wave 0 only. |
| L12 | - | K2-20 (PR-048), K2-21 (PR-043) | Waves 1 to 5 only. |
| L13 | - | K1-28 (PR-030), K2-1 (PR-036), K2-6 (PR-039), K2-9 (PR-051), K2-10 (PR-052), K2-11 (PR-054), K2-14 (PR-057), K2-15 (PR-058), K2-23 (PR-065) | Waves 1 to 5 only. |
| L14 | - | K4-1 (PR-034), K4-6 (PR-073), K4-7 (PR-074), K4-8 (PR-075), K4-11 (PR-076), K4-12 (PR-C3, on a yes), K4-13 (PR-077), K4-14 (PR-078), K4-15 (PR-079), K4-18 (PR-081) | Waves 1 to 5 only. |
| L15 | - | K1-22 (PR-010), K1-29 (PR-O2) | Waves 1 to 5 only. |
| D1 | - | K4-2 (PR-069), K4-3 (PR-070), K4-4 (PR-071), K4-5 (PR-072), K4-18 (PR-081), K5-23 (PR-C6, on a yes) | Waves 1 to 5 only. |
| D2 | K0-A19 | K1-24 (PR-027), K2-3 (PR-040), K2-4 (PR-045) | W0: the paper link in t2.l7. K1-24: 'Go deeper' per lesson; K2-3: twins; K2-4: three stops (ungraded until Q29). |
| D3 | - | K5-1 (PR-006), K2-23 (PR-065), K5-10 (PR-102), K5-11 (PR-091), K5-12 (PR-092), K5-13 (PR-096), K5-14 (PR-095), K5-15 (PR-100), K5-16 (PR-101), K5-17 (PR-103), K5-26 (PR-104), K5-28 (PR-102a) | Waves 1 to 5 only. |
| D4 | - | K1-23 (PR-023), K2-6 (PR-039), K2-8 (PR-042), K2-9 (PR-051), K2-10 (PR-052), K2-11 (PR-054), K2-16 (PR-060), K2-19 (PR-063), K2-23 (PR-065) | Waves 1 to 5 only. |
| D5 | - | K5-1 (PR-006), K2-2 (PR-037), K5-6 (PR-088), K5-7 (PR-089), K5-7b (PR-C5, on a yes), K5-8 (PR-098), K5-9 (PR-090), K5-11 (PR-091), K5-12 (PR-092), K5-13 (PR-096), K5-14 (PR-095), K5-15 (PR-100), K5-16 (PR-101), K5-17 (PR-103) | Waves 1 to 5 only. |
| D6 | - | K5-2 (PR-087), K5-3 (PR-093), K5-4 (PR-094), K5-5 (PR-097), K5-11 (PR-091), K5-12 (PR-092), K5-13 (PR-096), K5-14 (PR-095), K5-15 (PR-100) | Waves 1 to 5 only. |
| D7 | - | K2-1 (PR-036), K2-9 (PR-051), K2-19 (PR-063) | Waves 1 to 5 only. |
| D8 | - | K5-1 (PR-006), K5-10 (PR-102), K5-11 (PR-091), K5-12 (PR-092), K5-13 (PR-096), K5-14 (PR-095), K5-15 (PR-100), K5-16 (PR-101), K5-17 (PR-103), K5-28 (PR-102a) | Waves 1 to 5 only. |
| D9 | - | K1-11 (PR-032), K4-1 (PR-034), K4-3 (PR-070), K4-8 (PR-075), K4-9 (PR-C2, on a yes), K4-10 (PR-H1), K4-11 (PR-076), K4-13 (PR-077), K4-14 (PR-078), K4-17 (PR-080), K4-18 (PR-081) | Waves 1 to 5 only. |
| D10 | - | K5-1 (PR-006), K3-9 (PR-007), K2-12 (PR-055), K5-10 (PR-102), K5-11 (PR-091), K5-12 (PR-092), K5-13 (PR-096), K5-14 (PR-095), K5-15 (PR-100), K5-16 (PR-101), K5-17 (PR-103), K5-28 (PR-102a) | Waves 1 to 5 only. |
| N1 | - | K1-5 (PR-031), K1-6 (PR-029), K1-29 (PR-O2) | Waves 1 to 5 only. |
| N2 | - | K1-5 (PR-031), K4-2 (PR-069), K4-6 (PR-073) | Waves 1 to 5 only. |
| N3 | - | K1-5 (PR-031), K2-2 (PR-037) | Waves 1 to 5 only. |
| N4 | K0-B12 | K2-17 (PR-061), K5-21 (PR-082), K5-22 (PR-083), K5-26 (PR-104) | W0: the open- and closed-loop paragraph. K2-17: t7.l2's rate sweep; K5-21: the queue; K5-22: the lesson; K5-26: session script. |
| N5 | - | K2-3 (PR-040), K2-4 (PR-045), K2-5 (PR-047) | Waves 1 to 5 only. |
| N6 | - | K2-6 (PR-039) | Waves 1 to 5 only. |
| N7 | - | K1-14 (PR-015) | Waves 1 to 5 only. |
| N8 | - | K2-20 (PR-048) | Waves 1 to 5 only. |
| N9 | - | K1-5 (PR-031), K2-19 (PR-063) | Waves 1 to 5 only. |
| N10 | - | K5-18 (PR-084) | Waves 1 to 5 only. |
| N11 | - | K5-19 (PR-085) | Waves 1 to 5 only. |
| N12 | - | K5-24 (PR-C7, on a yes) | Waves 1 to 5 only. |
| N13 | - | K5-20 (PR-086) | Waves 1 to 5 only. |
| N14 | - | K1-25 (PR-028), K1-26 (PR-O1), K5-25 (PR-C8, on a yes) | Waves 1 to 5 only. |
| N15 | - | K4-2 (PR-069), K4-4 (PR-071) | Waves 1 to 5 only. |
| N16 | - | K1-5 (PR-031), K1-25 (PR-028), K1-26 (PR-O1), K2-8 (PR-042) | Waves 1 to 5 only. |
| N17 | - | K1-28 (PR-030), K2-15 (PR-058) | Waves 1 to 5 only. |
| N18 | - | K1-17 (PR-013) | Waves 1 to 5 only. |
| M1 | - | K2-7 (PR-050), K2-9 (PR-051), K5-28 (PR-102a) | Waves 1 to 5 only. |
| M2 | - | K2-6 (PR-039) | Waves 1 to 5 only. |
| M3 | K0-D2, K0-D4, K0-D12 | K3-9 (PR-007), K2-4 (PR-045) | W0: the paper's 16 as a claim and t5.l5's sentence. K2-4: what survived of 2023 (stops, afterword); K3-9: the history callout. |
| M4 | - | K2-13 (PR-056) | Waves 1 to 5 only. |
| M5 | - | K2-16 (PR-060), K2-18 (PR-062) | Waves 1 to 5 only. |
| M6 | - | K2-16 (PR-060), K2-17 (PR-061) | Waves 1 to 5 only. |
| M7 | - | K2-12 (PR-055) | Waves 1 to 5 only. |
| M8 | - | K2-22 (PR-064) | Waves 1 to 5 only. |
| M9 | - | K2-15 (PR-058), K2-18 (PR-062) | Waves 1 to 5 only. |
| A1 | K0-C17 | - | Wave 0 only. |
| A2 | K0-C17 | - | Wave 0 only. |
| A3 | K0-C17 | - | Wave 0 only. |
| A4 | K0-D14, K0-D15, K0-D16, K0-D12, K0-D17, K0-D22 | K3-3 (PR-066) | W0: every '<4%' site and its erratum. K3-3: the T4 to T7 chips Wave 0 left uncited. |
| A5 | K0-C19 | K1-13 (PR-017) | W0: the two t5.l2 sentences. K1-13: encode() (O16). |
| A6 | K0-C20 | - | Wave 0 only. |
| A7 | K0-C21 | - | Wave 0 only. |
| A8 | K0-C22 | - | Wave 0 only. |
| A9 | K0-C23 | - | Wave 0 only. |
| A10 | K0-C24 | - | Wave 0 only. |
| A11 | K0-C8b | K2-5 (PR-047) | W0: t5.l10's table rows. K2-5: t5.l10 rebuilt as a dated map. |
| A12 | K0-C25 | K2-9 (PR-051) | W0: the three sentences. K2-9: the 'then and now' table. |
| A13 | K0-D0, K0-C7 | - | Wave 0 only. |
| A14 | K0-C5, K0-C6 | K2-10 (PR-052) | W0: the t6.l2 and t6.l4 sentences. K2-10: t6.l2 sized and drawn. |
| A15 | - | K2-12 (PR-055) | Waves 1 to 5 only. |
| A16 | - | K2-13 (PR-056) | Waves 1 to 5 only. |
| A17 | - | K2-14 (PR-057) | Waves 1 to 5 only. |
| A18 | K0-C26 | K2-15 (PR-058) | W0: 'Three shapes' and the mask sentence. K2-15: N17 in t6.l13. |
| A19 | K0-D0, K0-C27 | - | Wave 0 only. |
| A20 | - | K2-17 (PR-061), K3-3 (PR-066) | Waves 1 to 5 only. |
| A21 | K0-C28 | K2-16 (PR-060) | W0: 'concave' and the splice. K2-16: the frontier from registered rows. |
| A22 | K0-C3 | K2-18 (PR-062) | W0: t7.l4's margin sentences. K2-18: t7.l4's close. |
| A23 | K0-C29 | - | Wave 0 only. |
| A24 | - | K3-14 (PR-038) | Waves 1 to 5 only. |
| A25 | K0-D2, K0-D5, K0-C47 | K2-24 (PR-046), K3-4 (PR-053) | W0: the field-lab and kvpool claims re-read at v0.34.0, the glibc claim. K2-24: pool sizing at the re-pinned default; K3-4: glibc as a registered T0 to T3 fact. |
| A26 | K0-C30, K0-C31 | K3-3 (PR-066), K5-16 (PR-101) | W0: the 20-30x and L2 sentences. K3-3: the ratio as a claim; K5-16: the trend taught. |
| A27 | K0-C32 | - | Wave 0 only. |
| A28 | K0-C33 | K2-8 (PR-042) | W0: AI = seq_len and 'at least about 5 ms'. K2-8: the floor used as N16's start. |
| A29 | K0-C34, K0-C32 | - | Wave 0 only. |
| A30 | K0-C35 | K5-27 (PR-099) | W0: two dispatch dimensions. K5-27: the learner's shader runs. |
| A31 | K0-C31 | K5-16 (PR-101) | W0: FlashAttention named as more than the 2022 paper. K5-16: the 'what changed after 2022' section. |
| A32 | - | K2-22 (PR-064) | Waves 1 to 5 only. |
| A33 | K0-C10 | K3-11 (PR-041) | W0: the clone cost and PhantomData. K3-11: the listing compiled in CI. |
| A34 | K0-B3 | K3-11 (PR-041) | W0: checked_sub, CachePadded, the model called a model. K3-11: listings in CI. |
| A35 | K0-D0, K0-C14, K0-C16, K0-C9, K0-B4 | - | Wave 0 only. |
| A36 | K0-B4 | - | Wave 0 only. |
| A37 | K0-D0, K0-C13 | K3-4 (PR-053) | W0: WASI 0.3 and Wasm 3.0 sentences. K3-4: registered as claims (K3-10's history row absorbed into K1-21). |
| A38 | K0-C36 | - | Wave 0 only. |
| A39 | K0-C37 | - | Wave 0 only. |
| A40 | K0-C38 | - | Wave 0 only. |
| A41 | K0-C39 | K5-7 (PR-089), K5-9 (PR-090) | W0: biased locking. K5-7: ContentionLab labelled a model; K5-9: the contended counter measured on the learner's machine. |
| A42 | K0-C11 | - | Wave 0 only. |
| A43 | K0-C14, K0-C15, K0-C16 | - | Wave 0 only. |
| A44 | K0-C40 | K3-4 (PR-053), K3-11 (PR-041) | W0: real times and the Python tab. K3-4: the times as claims with the machine; K3-11: the listing in CI. |
| A45 | K0-C41, K0-C42, K0-C43 | - | Wave 0 only. |
| A46 | K0-C44 | - | Closed by Wave 0 (K0-C44: the real panic text, RwLock named). The Museum key 'BorrowMutError' (museum.ts:30, :39) is not renamed: section 10. |
| A47 | K0-D0, K0-C45 | K3-11 (PR-041), K3-12 (PR-059) | W0: the dated Polonius sentence and the r.l4 trace. K3-12: R's status claims; K3-11: the nightly step that sees the flip. |
| A48 | K0-C46 | K3-6 (PR-035) | W0: the dead URL, 'coalesces', the R10 promise. K3-6: the weekly link check over labs. |
| A49 | K0-C12 | K1-8 (PR-026a) | W0: the wrong glossary pairs, README and ticker. K1-8: the glossary rebuilt (L5). |
<!-- ledger:end -->

---

## 15. The critic's review (2026-11-21): what changed

critic.md was read whole. Each finding was checked against the tree at d478f91 (an export of the course at that commit, not in the repository), docs/audit-2026-11/report.md and Wave 0's files as they stood at 00:48 (its plan and task list, not in the repository) before it was applied. Package ids are unchanged; PR ids are unchanged, and inserted PRs take a letter. The script that builds packages.json (not in the repository) now runs the critic round's script and fails if a phrase a change removed comes back.

| # | Checked | Applied as |
|---|---|---|
| 1 | packages.json fields of K5-7, K5-9, K3-9, K4-8, K4-11, K4-6, K5-10, K3-12, K5-22, K1-22 against their own roadmap_changes; `fade: 'r2'` in the lab 04 and 06 bundles | Holds. `title`, `what`, `touches`, `done_when`, `risk` rewritten to the default for all ten (and K1-18, K5-16, K1-0, K1-29, K1-5, K1-6, K1-27, K2-4, K5-17, whose text the other findings made stale). The guard (the REMOVED list in the critic round's script, not in the repository) lists 37 phrases across 18 packages; a test run with an injected phrase failed as intended. |
| 2 | the Wave 0 plan (not in the repository), section 7 ("K0-A11 ... Wave 1"; "t4.l3's task set and the 'prediction held' tolerance: grading decisions"); Wave 0's questions 1 to 27 (no t4.l3 row); docs/audit-2026-11/report.md L6; roofline.tasks.ts:155 (rel 0.45); t4.l3's exercise lists eight task ids | Holds. New K1-32 (PR-019a, 3 d): the roof drawn in the reading column through an existing block, the lab opened on the lesson's tasks, eight to four (ids kept in the registry), the verdict names the gap. The tolerance is Q28 (default: grading unchanged). K1-18's risk, K5-16's text and section 10 corrected. |
| 3 | docs/audit-2026-11/report.md 5.4 line 327 | Holds. Q30 (default none built), Group G. |
| 4 | docs/audit-2026-11/report.md 5.4 line 328 ("After that, labs 02, 06 and 07 as stages ...") | Holds. Removed from section 10's withdrawn list; Q31, asked after PR-080, default not built. |
| 5 | docs/prereg/protege.md (status DRAFT, unsigned; "nothing ... is data"); docs/audit-2026-11/report.md section 6 item 3; PLAN-100X.md:751, :775; the nine host lessons (grep of `type: 'protege'`) | Holds. Q32 (default unsigned, one block per track), the owner step in section 8, conditional K3-16 (PR-C9) for the comparison, and a note in `risk` of the 24 packages whose touches reach a host lesson. |
| 6 | docs/specs/k0.md section 6 row 24 and section 7 (K0-A20) | Holds. Q29; K2-4's stops ungraded by default (done_when rewritten), status build-at-default. |
| 7 | docs/prereg/fleet-daily.md lines 3, 70, 72 (signed 2026-10-14; amendments only) | Holds. Q8's default now ships only what does not touch the study; the sig items' host, the KC list, the Daily link and the probe text are PR-H2, merged after the signed amendment. Of the critic's two options this is "ship them without the Daily changes", which keeps the lesson gain. |
| 8 | docs/audit-2026-11/report.md section 7 ("should precede the months of work, not accompany them"); PLAN-100X.md:753 (keep/kill thresholds pre-registered); K1-7, K1-14, K1-6 touch t0.l1, t2.l1 and the lesson read after t0.l1 | Holds. Q2 (i) default holds PR-009, PR-015 and PR-029; the :753 gate is gone from K1-0, K1-29 and Q2. K1-6 now fills a slot the release reserves, so the release (PR-031) does not wait; K1-12 no longer depends on K1-6. |
| 9 | Q16's own words ("a scratchpad can be cleared") | Holds. Default (a) now holds each recalibrating lab PR's merge until the owner confirms a durable copy; option (b) is the critic's directory outside every worktree. |
| 10 | K5-17's fields; no package names T5's option cuts, D10 for T5 or the echoes (script over every package); the audit's T5 track note at line 432 and pedagogy note at line 148 (not in the repository) | Holds. New K5-28 (PR-102a, 5 d): T5's pass and the echoes course-wide; K5-17 narrowed to T6, T7, t4.l7 and the gate. |
| 11 | K1-5 and K1-8 sizes and the proxy | Holds. K1-5 costed L (20 h); K1-8 two M PRs, PR-026a and PR-026b (16 h). |
| 12 | docs/audit-2026-11/report.md section 7 ("one structure release for ... O7"); K1-27's text against section 4 | Holds. K1-27 goes into the release branch with K1-28 and reaches master with K1-5; the earlier "ships before the release" note is withdrawn. |
| 13 | the Wave 0 plan (not in the repository), section 7 (A46's Museum anchor rename, L7's tolerant pass rule left out); docs/audit-2026-11/report.md L7 and A46 fixes; museum.ts:30, :39 | Holds. Both moved to "will not be built" with the reason (neither is in the report's fix; Wave 0 closes the fix); "Left with the Wave 0 run" removed. |
| 14 | the critic's id census (a script not in the repository), re-run on the rewritten files | Holds. Section 14, generated by the ledger script: 131 ids, every split id with its parts, no id without a home. The check also found A26 (a T4 row) listed under K3-4 (T0 to T3); it moved to K3-3 (claim) and K5-16 (the trend). A11 had been matched inside "K0-A11"; the regex no longer does that. |
| 15 | docs/audit-2026-11/report.md section 6 item 12; K2-6's must-survive list | Holds. The spiral's step from t2.l3 into t2.l7 and t5.l5 added, with a string test. |
| 16 | docs/audit-2026-11/report.md 5.2 (N16 "needs one measured step") | Holds. Section 4's PR-042 row and K2-8's risk say the precondition is unmet at Q3's default; on Q3 (i) yes with readings in hand, K2-8 waits for PR-O1. |
| 17 | docs/specs/k0.md section 6 row 12 | Holds. Q12 names Wave 0's 30-day `price.h100.median-2026-11`. |

Totals moved from 108 packages, 382.25 agent-days and 644 review hours at default to 110, 390.25 and 680 (section 1); conditional work from 8 packages and 76 h to 9 and 84 h.

### Critic's findings not applied

None was rejected: all seventeen held at the source. Three were applied in a form other than the one the critic wrote, for the reason given:
- **2, the drawn roof "through an existing block".** Wave 0 judged that K0-A11's drawn figure needs a new block type. K1-32 mounts the roofline chart read-only through the exercise mount (no new type), and Q11 already decides whether a figure block is added instead; the drawing does not wait on it.
- **8, "hold PR-015".** PR-015 held two packages; only K1-14 edits t2.l1. K1-16 (t1.l2 and t1.l3) is split out as PR-015a and is not held.
- **10, the T5 pass.** The report puts Wave 5's D-rows on "the lower tracks" and T5's option cuts with the M-rows of Wave 2; no Wave 2 package took them, so K5-28 holds them in Wave 5, after the rewrites, rather than reopening Wave 2's packages.
