# master against d478f91: what is already fixed

> This record was written on 2026-11-24 (06:19 UTC) by Wave 1 stage 0, task K1-0. It compares the tree `master` serves after pull request #31 with the audit's export `d478f91` (2026-10-30): every audit id that Wave 0 touched, by file and by commit, and what changed in the three lessons the first-session kit watches. It is a record, not a plan: it re-reads no fact at its source and closes no row that pull request #30's description says did less than the row asked (those are listed in [after-wave-0.md](after-wave-0.md), section 2, "the id ledger"). Its purpose is the audit's own: diff master against d478f91 so that no row is fixed twice, and give the observer of the first sessions the rows the course has already changed under them.

## 1. What was compared

| | |
|---|---|
| Base | `d478f91`, the export of `master` the audit read (exported 2026-10-30) |
| Tip | `237c1ce`, the head of pull request #31; its tree is `79899d5`, the same tree as the merge commit `4021d60` that `master` now points at (GitHub reports both) |
| Pull requests in the difference | #29 (merged 2026-11-22T16:56:39Z), #30 (merged 2026-11-24T00:01:20Z), #31 (merged 2026-11-24T03:45:06Z) |
| Commits | 398 |
| Files | 444 changed, 23,788 insertions, 2,013 deletions |
| What the difference is | Wave 0's two pull requests, and #31's documentation (the audit, the roadmap and package list, and Wave 0's record in docs/specs/k0.md). No other code is in it: the code is the whole of #29 and #30 |

The local clone holds the audited export, the branch #31 merged and every commit of #29 and #30, but not the merge commit `4021d60` itself, and its `master` ref is older than the merge. The comparison therefore uses `237c1ce`, checked against GitHub: pull request #31's head is `237c1ce`, its merge commit `4021d60` has parents `875e6058` (the merge of #30) and `237c1ce`, and the merge commit's tree `79899d5` is `237c1ce`'s tree. A merge with the same tree on both sides adds no change to the comparison.

The three commands that reproduce it in a clone that holds the objects:

```
git log --format='%H%x1f%s%x1f%(trailers:key=Task,valueonly)%x1e' d478f91..237c1ce
git diff --numstat d478f91 237c1ce
gh api 'repos/{owner}/{repo}/commits/4021d60159889e5fd69ddf9d2c6f831dd05c96e9'
```

Commit hashes below are the task's own commits, the ones that carry a `Task:` trailer. Wave 0's merge commits carry none, by its own decision (docs/specs/k0.md, K0-Z-D13).

## 2. What the live site served

Read on 2026-11-24 at 06:19 UTC with a plain HTTP client and the generic User-Agent `Mozilla/5.0 (X11; Linux x86_64)`; no page script was executed.

| What | Value |
|---|---|
| `/` | HTTP 200, 2,169 bytes; entry script `assets/index-DjZnv-Zv.js`; stylesheet `assets/index-DCrKOG8q.css` |
| `/sw.js` | HTTP 200, 12,541 bytes; `BUILD.id` `9644d5d40bcc`; `schema` 6; `Last-Modified` 2026-11-24T04:00:02Z |
| Deploy workflow | "Deploy to GitHub Pages" ran on `master` at `4021d60`, created 2026-11-24T03:45:09Z, and completed successfully; the service worker's `Last-Modified` is 04:00:02Z, after it |

**What this does and does not say.** The site publishes no git commit. `BUILD.id` is a hash of the files the service worker precaches (scripts/build-sw-manifest.ts), so it changes when any of them does; it names a build, not a commit. To compare two looks at the site, compare the `BUILD.id` and the `assets/index-*.js` name, and read the deploy run's head sha from GitHub. This record names the build the kit was written against, so that a session run later can say whether it read the same one.

## 3. The diff by area

| Area | Files | Insertions | Deletions |
|---|---|---|---|
| tests/ | 141 | 8565 | 124 |
| src/data/errata/ | 73 | 1381 | 0 |
| public/ (generated) | 59 | 1524 | 452 |
| src/data/lessons/ | 59 | 1248 | 532 |
| site code (pages, components) | 26 | 461 | 136 |
| src/data/claims/ | 19 | 1126 | 83 |
| src/data/ (other) | 16 | 579 | 516 |
| src/lib/ | 15 | 395 | 50 |
| sims | 12 | 166 | 71 |
| other | 10 | 619 | 34 |
| docs/ | 8 | 7463 | 0 |
| scripts/ | 5 | 260 | 14 |
| labs/ | 1 | 1 | 1 |

The `public/` area is mostly generated or packaged: `public/lessons-md/`, `public/llms.txt`, `public/claims.json` and the two `public/labs` archives come from their scripts, while `public/field-notes.json` is authored; `src/data/search-index.json` is generated too. Of the 59 files under `src/data/lessons`, 55 are lessons Wave 0 corrected and 4 are their scaffolding (`index.ts`, `claims.ts`, `claims.generated.ts` and the shared `pagedMix.ts`); no lesson was added, renamed or removed.

## 4. By audit row

The roadmap's ledger ([roadmap.md](roadmap.md), section 14) gives 131 finding ids a home: 30 belong to Wave 0 alone, 37 to Wave 0 and at least one later package, and 64 to waves 1 to 5 alone. The table below lists all 67 ids with a Wave 0 task: the id, the Wave 0 tasks, the task commits, their counts, and the ledger's own sentence on what the row closes. The 64 ids with no Wave 0 task have no Wave 0 commit; the roadmap names their packages.

| Id | Wave 0 tasks | Commits | Commits (#) | Files (#) | The ledger's note |
|---|---|---|---|---|---|
| F1 | K0-B13 | `b80ce5d` | 1 | 7 | Wave 0 only. |
| F2 | K0-B2 | `afb284d` | 1 | 4 | W0: t3.l4's listing compiles. K3-11: every listing compiled in CI, so it cannot recur. |
| F3 | K0-B6, K0-B7 | `0f86e72` `3ad4238` | 2 | 10 | W0: t5.l5's figure and explorer. K2-3: settled at the source (lab 02 twin); K2-4: today's partial-hit copy in prose; K3-9: the history callout it uses. |
| F4 | K0-D0, K0-D1, K0-D3, K0-D2, K0-D4, K0-D6, K0-D5, K0-D7, K0-D20, K0-D18, K0-D11, K0-D14, K0-D15, K0-D16, K0-D12, K0-D13, K0-D19, K0-D17, K0-D22, K0-D23 | `19055b2` `2405277` `26ce362` `27cacbb` `5dcdba5` `6cdc8a4` `719999b` `81f5d6d` `8fbd9c8` `953a814` `a45d3d1` `b2c6bdd` `b6bef23` `c08722e` `cba027c` `cc4aa40` `d0e88cd` `d3eff42` `d7367a8` `d9dc425` `e3048c1` `f2ad54c` | 22 | 60 | W0: the re-pin, the nine places wired to the claim, errata, guard test. K3-1/K3-2: chips and prose as claim tokens with the gate; K2-24: pool section and trade exercise; K3-7 (K3-8 on a yes): the tag re-read that should flag the next one. |
| F5 | K0-D0, K0-C2 | `5b8ddb6` `81f5d6d` `873daf1` | 3 | 17 | W0: the archived generators no longer recommended. K3-5: a status claim for every product named. |
| F6 | K0-B5 | `b6acb4c` | 1 | 3 | W0: toymalloc.c made true. K3-11: listings in CI. |
| F7 | K0-C3 | `8bd2eb3` | 1 | 11 | W0: t7.l4's dated price sentences. K3-14: prices re-read, ratios generated; K2-18: t7.l4's close; K3-3: the dated chips left in T4 to T7. |
| F8 | K0-D0, K0-C4 | `2dbcc36` `81f5d6d` | 2 | 15 | Wave 0 only. |
| F9 | K0-D0, K0-B8 | `4c38d90` `81f5d6d` `ad7356f` | 3 | 21 | Wave 0 only. |
| F10 | K0-D0, K0-B9 | `81f5d6d` `c87a76f` | 2 | 17 | Wave 0 only. |
| F11 | K0-D0, K0-C11, K0-C12, K0-C9, K0-C10, K0-C8a, K0-C8b, K0-C1, K0-C7 | `09a100d` `1e6bd59` `20602b8` `2821b3e` `2e1d91b` `5559445` `6f6ec96` `81f5d6d` `9d24d45` `d8e43aa` `d90213e` `e59683a` | 12 | 42 | W0: every wrong Dynamo, NATS, KVBM and io_uring sentence. K3-5: status claims, so the next deprecation shows. |
| F12 | K0-D0, K0-C5 | `81f5d6d` `d8c0117` | 2 | 19 | W0: EPLB sentence and DeepEP dates. K3-5: status claims. |
| O11 | K0-A16 | `e208fe0` | 1 | 2 | W0: the serving-first warning in Boot. K1-5: path heads; K1-6: N1; K1-9: one path on screen; K1-12: the bridge banner. |
| O15 | K0-A17, K0-A18 | `45b773a` `ba7fa4e` | 2 | 19 | W0: the stale signposts and their CI check. K1-30: t1.l6's body as a retrieval table; K2-5: t5.l10's ending. |
| L1 | K0-A1, K0-A2, K0-A3 | `05b034d` `a3e4623` `a4f446a` | 3 | 10 | Closed by Wave 0 (K0-A1 to A3). A change to recommend() is not in the report's fix and would touch the K3 metric (wave-1.md:801): section 10. |
| L2 | K0-A4 | `f084e57` | 1 | 5 | W0: keys inside widgets. K1-31: in-progress work survives leaving the lesson. |
| L3 | K0-A5, K0-A6, K0-A7 | `042fbdf` `d38a964` `e66b5d2` | 3 | 17 | Wave 0 only. |
| L6 | K0-A8, K0-A9, K0-A9b, K0-A10 | `06cfada` `27e9100` `2c84826` `931f860` | 4 | 36 | W0: rendering (fence, embedded layout, labels). K1-32: the drawn roof, the lab on this lesson's tasks, eight tasks to four, the verdict text (Q28 for grading). |
| L7 | K0-B10, K0-B11 | `1b80190` `839efb9` | 2 | 9 | Closed by Wave 0 (K0-B10, B11: the rename and generated throughput, the report's whole fix). A tolerant Fleet pass rule is not in it: section 10. |
| L9 | K0-A15 | `7e52e2b` | 1 | 2 | W0: the cheap half (what a reading item is, what 'moved' means). K1-12: the line-by-line gloss. |
| L11 | K0-A12, K0-A13, K0-A10 | `186cf9e` `27e9100` `637207a` | 3 | 37 | Wave 0 only. |
| D2 | K0-A19 | `bcc4e13` | 1 | 3 | W0: the paper link in t2.l7. K1-24: 'Go deeper' per lesson; K2-3: twins; K2-4: three stops (ungraded until Q29). |
| N4 | K0-B12 | `8ad352d` | 1 | 2 | W0: the open- and closed-loop paragraph. K2-17: t7.l2's rate sweep; K5-21: the queue; K5-22: the lesson; K5-26: session script. |
| M3 | K0-D2, K0-D4, K0-D12 | `5dcdba5` `6cdc8a4` `c08722e` `e3048c1` | 4 | 13 | W0: the paper's 16 as a claim and t5.l5's sentence. K2-4: what survived of 2023 (stops, afterword); K3-9: the history callout. |
| A1 | K0-C17 | `966ecfc` | 1 | 5 | Wave 0 only. |
| A2 | K0-C17 | `966ecfc` | 1 | 5 | Wave 0 only. |
| A3 | K0-C17 | `966ecfc` | 1 | 5 | Wave 0 only. |
| A4 | K0-D14, K0-D15, K0-D16, K0-D12, K0-D17, K0-D22 | `26ce362` `27cacbb` `953a814` `b6bef23` `d7367a8` `e3048c1` | 6 | 17 | W0: every '<4%' site and its erratum. K3-3: the T4 to T7 chips Wave 0 left uncited. |
| A5 | K0-C19 | `ac983f8` | 1 | 3 | W0: the two t5.l2 sentences. K1-13: encode() (O16). |
| A6 | K0-C20 | `56e0e7b` `7763d73` | 2 | 3 | Wave 0 only. |
| A7 | K0-C21 | `07ca4cd` | 1 | 4 | Wave 0 only. |
| A8 | K0-C22 | `25826ac` | 1 | 4 | Wave 0 only. |
| A9 | K0-C23 | `e3e5a21` | 1 | 4 | Wave 0 only. |
| A10 | K0-C24 | `0816443` `478dcb1` `76450f7` `c6a71bc` | 4 | 13 | Wave 0 only. |
| A11 | K0-C8b | `e59683a` | 1 | 8 | W0: t5.l10's table rows. K2-5: t5.l10 rebuilt as a dated map. |
| A12 | K0-C25 | `d46850d` | 1 | 4 | W0: the three sentences. K2-9: the 'then and now' table. |
| A13 | K0-D0, K0-C7 | `6f6ec96` `81f5d6d` | 2 | 17 | Wave 0 only. |
| A14 | K0-C5, K0-C6 | `27c57a3` `d8c0117` | 2 | 15 | W0: the t6.l2 and t6.l4 sentences. K2-10: t6.l2 sized and drawn. |
| A18 | K0-C26 | `5b84024` | 1 | 3 | W0: 'Three shapes' and the mask sentence. K2-15: N17 in t6.l13. |
| A19 | K0-D0, K0-C27 | `81f5d6d` `e17e4d7` | 2 | 16 | Wave 0 only. |
| A21 | K0-C28 | `695b6c3` | 1 | 4 | W0: 'concave' and the splice. K2-16: the frontier from registered rows. |
| A22 | K0-C3 | `8bd2eb3` | 1 | 11 | W0: t7.l4's margin sentences. K2-18: t7.l4's close. |
| A23 | K0-C29 | `d296010` | 1 | 5 | Wave 0 only. |
| A25 | K0-D2, K0-D5, K0-C47 | `5dcdba5` `6cdc8a4` `d3eff42` `ead6762` | 4 | 10 | W0: the field-lab and kvpool claims re-read at v0.34.0, the glibc claim. K2-24: pool sizing at the re-pinned default; K3-4: glibc as a registered T0 to T3 fact. |
| A26 | K0-C30, K0-C31 | `dc96e6e` `e25c9ac` | 2 | 7 | W0: the 20-30x and L2 sentences. K3-3: the ratio as a claim; K5-16: the trend taught. |
| A27 | K0-C32 | `c086f17` | 1 | 5 | Wave 0 only. |
| A28 | K0-C33 | `5883c26` | 1 | 4 | W0: AI = seq_len and 'at least about 5 ms'. K2-8: the floor used as N16's start. |
| A29 | K0-C34, K0-C32 | `c086f17` `d96e885` | 2 | 7 | Wave 0 only. |
| A30 | K0-C35 | `f2a1208` | 1 | 4 | W0: two dispatch dimensions. K5-27: the learner's shader runs. |
| A31 | K0-C31 | `dc96e6e` | 1 | 3 | W0: FlashAttention named as more than the 2022 paper. K5-16: the 'what changed after 2022' section. |
| A33 | K0-C10 | `1e6bd59` | 1 | 4 | W0: the clone cost and PhantomData. K3-11: the listing compiled in CI. |
| A34 | K0-B3 | `0474c83` | 1 | 4 | W0: checked_sub, CachePadded, the model called a model. K3-11: listings in CI. |
| A35 | K0-D0, K0-C14, K0-C16, K0-C9, K0-B4 | `487c54d` `510b408` `81f5d6d` `9d24d45` `a434472` | 5 | 31 | Wave 0 only. |
| A36 | K0-B4 | `510b408` | 1 | 5 | Wave 0 only. |
| A37 | K0-D0, K0-C13 | `4a25a01` `81f5d6d` `e77af25` | 3 | 16 | W0: WASI 0.3 and Wasm 3.0 sentences. K3-4: registered as claims (K3-10's history row absorbed into K1-21). |
| A38 | K0-C36 | `8f2b3cd` | 1 | 3 | Wave 0 only. |
| A39 | K0-C37 | `b566088` | 1 | 3 | Wave 0 only. |
| A40 | K0-C38 | `504b20b` `9ac0a11` | 2 | 6 | Wave 0 only. |
| A41 | K0-C39 | `f65a71a` | 1 | 3 | W0: biased locking. K5-7: ContentionLab labelled a model; K5-9: the contended counter measured on the learner's machine. |
| A42 | K0-C11 | `2821b3e` | 1 | 5 | Wave 0 only. |
| A43 | K0-C14, K0-C15, K0-C16 | `487c54d` `4ef5ae9` `a434472` | 3 | 12 | Wave 0 only. |
| A44 | K0-C40 | `99a376d` | 1 | 4 | W0: real times and the Python tab. K3-4: the times as claims with the machine; K3-11: the listing in CI. |
| A45 | K0-C41, K0-C42, K0-C43 | `038df27` `cec9f9e` `faeda9b` | 3 | 11 | Wave 0 only. |
| A46 | K0-C44 | `e613f4d` | 1 | 5 | Closed by Wave 0 (K0-C44: the real panic text, RwLock named). The Museum key 'BorrowMutError' (museum.ts:30, :39) is not renamed: section 10. |
| A47 | K0-D0, K0-C45 | `38fb0eb` `81f5d6d` | 2 | 22 | W0: the dated Polonius sentence and the r.l4 trace. K3-12: R's status claims; K3-11: the nightly step that sees the flip. |
| A48 | K0-C46 | `2d4e80a` | 1 | 6 | W0: the dead URL, 'coalesces', the R10 promise. K3-6: the weekly link check over labs. |
| A49 | K0-C12 | `20602b8` `d8e43aa` | 2 | 4 | W0: the wrong glossary pairs, README and ticker. K1-8: the glossary rebuilt (L5). |

**How to read it.**

- `K0-D0` repeats in many rows because it created the seven lazy claim group files once, in setup, and every later claim row builds on them. A row that shows only `K0-D0` and another task has one commit that is setup, not a fix of that row.
- A commit count is not a completeness claim. After-wave-0.md's ledger table lists 23 rows where pull request #30's description says the task did less than its row asked: F7/A22, F10, F11/A42, F11/A13, A1 to A3, A11, A12, A14, A30, A35/A43, A43, A40, A44, A46, A48, A49, L1, L3, L6, L6/L11, L11, O15 and A4. Read that table before treating any of those ids as closed.
- Wave 0's closing groups (`K0-CLOSE-A` to `-J` and `K0-CLOSE2-A`, `-B`, `-D` and `-G`), its follow-ups (`K0-E1` to `K0-E11`) and `K0-Z3` and `K0-Z4` have no row in the ledger: they fix faults the reviews found inside rows already listed, and pull request #30's description names them.

## 5. The three first-session lessons on master

The kit in [docs/sessions/newcomer-before/](../sessions/newcomer-before/) watches t0.l1, r.l1 and t2.l1 and the surfaces around them. This is what Wave 0 changed under it, so the observer knows which of the audit's predictions are still the course's own:

| Place | What changed since d478f91 | Does the audit's prediction still stand? |
|---|---|---|
| t0.l1 | Two prose sentences in "How this course works": the track list now names T6 and T7, and "15–35 minutes" is "15–45". The two predict items, the through-line panel, the bandwidth section and the quiz are unchanged. | **L4 stands.** The lesson still opens on "vLLM stores one sequence's KV cache in many fixed-size blocks that can sit anywhere in GPU memory"; "KV cache" and "block" are still not defined on the screen before the question uses them; the opening question is still answered only in the last quiz question's feedback ("That is the opening question of this lesson, answered."). |
| r.l1 | Nothing: the file is identical to d478f91. | The lesson is read as the audit read it. |
| t2.l1 | One through-line pair: the LLM line is now "a slot at the next decode step; the step is a scheduling boundary, not a timeslice", and the breaks line says a decode step ends when its work does rather than when a timer fires. | The panel's wording is corrected; the rest of the lesson is unchanged. It still has no question before the telling, and its first thing to do is the exercise after it, which the audit's D3 finding names. |
| Boot's path step | The serving-first blurb now names the T2 and T4 ideas the path leaves out (page tables and eviction, t2.l4's scheduling lab, t4.l2's memory hierarchy, t4.l7's quantization) and says those lessons stay open. | **O11 is partly met:** the warning the audit asks for is there before the learner meets a hole. t5.l7's "You learned this machine in T2" is unchanged, and the path still does not teach it. |
| Glossary | Ten lines changed: the block-size pair no longer types 16, two waste claims were corrected, and the priority-inversion and lock-free-queue pairs were rewritten. | **L5 stands:** there is still no TTFT headword, no lesson word links to a definition, and no new lookup surface. The external-fragmentation card still pairs the term with reservation waste (after-wave-0.md, row 11). |
| Order, Path and Up Next | The Up Next footer gained an "also next" link (`src/pages/lesson/also-next.ts`, K0-A3 and K0-FIX-LESSON-APP), `src/pages/Lesson.tsx` changed with it, and the Curriculum's Rust-layer note changed (K0-A1 to A3). The lesson order, the Path page's order and the missing path indicator are unchanged. | **L8 stands.** |
| Learner app | The placement skip rule (K0-A1 to A3), the worked-step and item rules (K0-A6, A7), Today's "Keep going" practice rule (K0-A5) and the widget key test (K0-A4) changed. | The held-arrow and Space faults (after-wave-0.md, rows 28 and 29) are still not checked. |
| Still open and left to the owner | `README.md` line 58 ("Nine Rust-to-WASM simulators"), Lab 04's "Run it ten times" against R10's one-thread brief, the home ticker's NVMe figure, and the 71 errata dates. | Unchanged by this record; after-wave-0.md section 3 names each. |

## 6. What this record does not do

- It does not re-read any audit row at its source. The audit calls its tables a worklist, not text to paste; a row that is "fixed" here is a commit that touched it, and the next wave still reads the source before writing.
- It does not close a row whose task did less than asked: after-wave-0.md's ledger table is the record of those, and it wins.
- It does not name a git commit for the live site, which publishes none; it names the build id and the deploy run.
- It does not compare master with the live site as the audit walked it: the audit recorded no build, which is one reason this record exists.
- It does not list the 64 finding ids that Wave 0 did not touch; roadmap.md section 14 names every id and the package that owns it.

## 7. Every file that changed

Generated by `git diff --numstat d478f91 237c1ce`: each line is the insertions, the deletions and the path, in that order. Binary files print `-` for both counts.

```
68  0  docs/audit-2026-11/README.md
160  0  docs/audit-2026-11/advocate.md
306  0  docs/audit-2026-11/after-wave-0.md
109  0  docs/audit-2026-11/critic.md
5442  0  docs/audit-2026-11/packages.json
508  0  docs/audit-2026-11/report.md
652  0  docs/audit-2026-11/roadmap.md
218  0  docs/specs/k0.md
2  0  e2e/boot.spec.ts
111  15  e2e/fleet-time.spec.ts
66  0  e2e/k0-e10-freshness-narrow.spec.ts
10  0  e2e/k0-e7-anchor-alias.spec.ts
74  0  e2e/k0-e9-glossary-a11y.spec.ts
33  0  e2e/k0-z3-search.spec.ts
46  0  e2e/lesson-embed-layout.spec.ts
104  0  e2e/lesson-figures.spec.ts
120  0  e2e/lesson-keys.spec.ts
53  19  e2e/reading-block.spec.ts
1  1  labs/rust-allocator/src/allocator.rs
1104  130  public/claims.json
1  1  public/field-notes.json
-  -  public/labs/rust-allocator.tar.gz
-  -  public/labs/rust-allocator.zip
1  1  public/lessons-md/r.l4.md
7  7  public/lessons-md/r.l8.md
2  2  public/lessons-md/r.l9.md
2  2  public/lessons-md/t0.l1.md
2  2  public/lessons-md/t0.l2.md
10  10  public/lessons-md/t0.l3.md
6  5  public/lessons-md/t0.l4.md
3  3  public/lessons-md/t0.l5.md
8  6  public/lessons-md/t0.l6.md
2  2  public/lessons-md/t1.l2.md
36  23  public/lessons-md/t1.l3.md
7  7  public/lessons-md/t1.l4.md
1  1  public/lessons-md/t1.l5.md
4  4  public/lessons-md/t1.l6.md
2  2  public/lessons-md/t2.l1.md
2  2  public/lessons-md/t2.l2.md
2  2  public/lessons-md/t2.l3.md
5  5  public/lessons-md/t2.l4.md
3  3  public/lessons-md/t2.l5.md
6  6  public/lessons-md/t2.l6.md
28  19  public/lessons-md/t2.l7.md
38  13  public/lessons-md/t3.l2.md
6  5  public/lessons-md/t3.l3.md
56  28  public/lessons-md/t3.l4.md
1  1  public/lessons-md/t3.l5.md
5  5  public/lessons-md/t3.l6.md
2  2  public/lessons-md/t3.l7.md
2  2  public/lessons-md/t4.l1.md
6  6  public/lessons-md/t4.l2.md
2  2  public/lessons-md/t4.l3.md
8  8  public/lessons-md/t4.l4.md
16  11  public/lessons-md/t4.l5.md
2  2  public/lessons-md/t4.l6.md
1  1  public/lessons-md/t4.l7.md
11  7  public/lessons-md/t5.l10.md
2  2  public/lessons-md/t5.l2.md
2  2  public/lessons-md/t5.l3.md
1  1  public/lessons-md/t5.l4.md
14  12  public/lessons-md/t5.l5.md
10  10  public/lessons-md/t5.l6.md
6  6  public/lessons-md/t5.l7.md
7  7  public/lessons-md/t5.l8.md
1  1  public/lessons-md/t5.l9.md
4  4  public/lessons-md/t6.l1.md
18  14  public/lessons-md/t6.l2.md
6  6  public/lessons-md/t6.l3.md
3  3  public/lessons-md/t6.l4.md
2  2  public/lessons-md/t6.l6.md
4  4  public/lessons-md/t6.l8.md
9  9  public/lessons-md/t7.l1.md
8  6  public/lessons-md/t7.l2.md
4  4  public/lessons-md/t7.l3.md
14  12  public/lessons-md/t7.l4.md
4  4  public/lessons-md/t7.l5.md
5  5  public/llms.txt
1  0  scripts/a11y.mjs
75  2  scripts/aquascope/extract.ts
45  11  scripts/build-search-index.ts
129  0  scripts/gen-lesson-claims.ts
10  1  scripts/verify-rust-items.ts
50  17  src/components/ClaimsTable.tsx
2  2  src/components/CommandPalette.tsx
13  1  src/components/blocks/ItemBlock.tsx
2  2  src/components/fleet-ex/session.ts
1  1  src/components/forge/TwinPanel.tsx
2  2  src/components/home/ScrollStory.tsx
1  1  src/components/items/ConstructedAnswer.tsx
5  4  src/components/items/Feedback.tsx
4  3  src/components/items/ItemCard.tsx
76  26  src/components/items/PromptView.tsx
4  12  src/components/learner/ExitTicket.tsx
5  6  src/components/learner/PlacementWalk.tsx
93  4  src/components/learner/anchor-line.ts
37  0  src/components/learner/result-heading.ts
1  1  src/components/play/scheduler/session.ts
11  5  src/components/sims/AllocatorSim.tsx
26  16  src/components/sims/BlockTableExplorer.tsx
10  4  src/components/sims/KvCacheSim.tsx
7  13  src/components/sims/PlaygroundShell.tsx
9  3  src/components/sims/RooflineSim.tsx
13  13  src/components/sims/blockTableExplorer.tasks.ts
1  1  src/components/sims/layoutLab.tasks.ts
3  2  src/components/sims/roofline.tasks.ts
12  12  src/data/aquascope/errors.json
1  1  src/data/aquascope/r.l4.json
4  4  src/data/aquascope/r.l8.json
6  6  src/data/aquascope/r.l9.json
8  1  src/data/claims/all.ts
38  0  src/data/claims/cite.ts
26  22  src/data/claims/engines.ts
25  0  src/data/claims/homes.ts
385  0  src/data/claims/lazy/economics.ts
116  0  src/data/claims/lazy/engines-status.ts
16  16  src/data/claims/lazy/field.ts
48  0  src/data/claims/lazy/gpu-limits.ts
173  0  src/data/claims/lazy/kvpool.ts
124  0  src/data/claims/lazy/landscape-t6.ts
5  5  src/data/claims/lazy/moe.ts
1  1  src/data/claims/lazy/physics.ts
91  0  src/data/claims/lazy/platforms.ts
28  0  src/data/claims/lazy/rust-lang.ts
6  6  src/data/claims/lazy/serving3.ts
1  1  src/data/claims/lazy/tiling.ts
7  6  src/data/claims/lazy/twins.ts
10  9  src/data/claims/models.ts
18  16  src/data/claims/production.ts
34  0  src/data/errata/2026-11-21-dynamo-case-study-70-percent.ts
37  0  src/data/errata/2026-11-21-dynamo-kvbm-removal-v1-7-0.ts
34  0  src/data/errata/2026-11-21-dynamo-tcp-default.ts
37  0  src/data/errata/2026-11-21-paged-waste-not-the-papers-figure.ts
18  0  src/data/errata/2026-11-21-t0-l3-row-column-measured-times.ts
17  0  src/data/errata/2026-11-21-t0-l5-big-kernel-lock-and-python-scheduler.ts
18  0  src/data/errata/2026-11-21-t4-l4-32-byte-transactions.ts
18  0  src/data/errata/2026-11-21-t5-l5-cow-on-a-partial-block.ts
18  0  src/data/errata/2026-11-21-t5-l6-router-fallback.ts
17  0  src/data/errata/2026-11-21-t7-l2-load-generators.ts
37  0  src/data/errata/2026-11-21-vllm-default-block-size-64.ts
18  0  src/data/errata/2026-11-22-labs-r10-checks-one-thread-and-lab01-coalescing.ts
17  0  src/data/errata/2026-11-22-permission-uses-behind-references.ts
16  0  src/data/errata/2026-11-22-r-l4-trace-use-at-line-6.ts
16  0  src/data/errata/2026-11-22-r-l8-refcell-panic-text-and-rwlock.ts
18  0  src/data/errata/2026-11-22-t0-l2-napkin-math-ssd-citation.ts
17  0  src/data/errata/2026-11-22-t0-l4-false-sharing-padding-range.ts
17  0  src/data/errata/2026-11-22-t0-l6-bar-below-is-the-caller.ts
18  0  src/data/errata/2026-11-22-t0-l6-cpu-profiles-miss-parked-threads.ts
16  0  src/data/errata/2026-11-22-t1-l2-jvm-null-check-is-a-fault.ts
36  0  src/data/errata/2026-11-22-t1-l3-toy-allocator-listing.ts
17  0  src/data/errata/2026-11-22-t1-l5-mangling-is-shared-the-stdlib-abi-breaks.ts
16  0  src/data/errata/2026-11-22-t1-l6-rust-catches-temporal-bugs-at-compile-time.ts
18  0  src/data/errata/2026-11-22-t2-l2-walk-cost-and-zgc.ts
16  0  src/data/errata/2026-11-22-t2-l3-postgres-clock-sweep.ts
18  0  src/data/errata/2026-11-22-t2-l4-no-quantum.ts
16  0  src/data/errata/2026-11-22-t2-l5-biased-locking.ts
16  0  src/data/errata/2026-11-22-t2-l6-task-size-and-io-uring.ts
17  0  src/data/errata/2026-11-22-t2-l7-no-quantum.ts
18  0  src/data/errata/2026-11-22-t2-l7-one-kv-manager-and-kernel-cost.ts
18  0  src/data/errata/2026-11-22-t2-l7-paper-figure-and-numbers.ts
16  0  src/data/errata/2026-11-22-t3-l2-clone-ms-and-slab-borrow.ts
13  0  src/data/errata/2026-11-22-t3-l3-admit-and-model.ts
16  0  src/data/errata/2026-11-22-t3-l4-toy-executor-compiles.ts
16  0  src/data/errata/2026-11-22-t3-l5-wasi-typed-interfaces-and-wasm-gc.ts
18  0  src/data/errata/2026-11-22-t3-l7-io-uring-from-rust.ts
16  0  src/data/errata/2026-11-22-t4-l1-64-warps-per-sm.ts
16  0  src/data/errata/2026-11-22-t4-l3-prefill-ai-and-5ms-floor.ts
16  0  src/data/errata/2026-11-22-t4-l4-l7-four-warps-shared-memory.ts
17  0  src/data/errata/2026-11-22-t4-l5-workgroup-dispatch-limit-and-staged-race.ts
17  0  src/data/errata/2026-11-22-t4-l6-flashattention-after-2022.ts
16  0  src/data/errata/2026-11-22-t4-l7-int4-70b-one-gpu-not-four.ts
17  0  src/data/errata/2026-11-22-t4-shared-memory-vs-hbm-and-l2.ts
18  0  src/data/errata/2026-11-22-t5-l10-dynamo-ga-and-nats.ts
18  0  src/data/errata/2026-11-22-t5-l2-bpe-merge-order.ts
17  0  src/data/errata/2026-11-22-t5-l3-itl-reading-speed.ts
16  0  src/data/errata/2026-11-22-t5-l4-bandwidth-wall-fix-not-batching.ts
18  0  src/data/errata/2026-11-22-t5-l5-block-explorer-40-token-prompt.ts
16  0  src/data/errata/2026-11-22-t5-l7-continuous-batching-fig1-and-24x.ts
16  0  src/data/errata/2026-11-22-t5-l8-medusa-removed-from-vllm.ts
16  0  src/data/errata/2026-11-22-t5-l8-mixed-batches-not-default-everywhere.ts
16  0  src/data/errata/2026-11-22-t5-l8-speculative-output-distribution.ts
16  0  src/data/errata/2026-11-22-t6-l1-moe-18x-is-batch-1-and-round-trips.ts
16  0  src/data/errata/2026-11-22-t6-l2-deepep-modes-dated.ts
16  0  src/data/errata/2026-11-22-t6-l2-eplb-not-consistent-hashing.ts
34  0  src/data/errata/2026-11-22-t6-l3-kimi-benchmark-and-mooncake-date.ts
16  0  src/data/errata/2026-11-22-t6-l4-deepseek-decode-no-tp-five-stage.ts
37  0  src/data/errata/2026-11-22-t6-l6-deepseek-production-mtp-1.ts
16  0  src/data/errata/2026-11-22-t7-l1-slo-attribution-and-percentile.ts
16  0  src/data/errata/2026-11-22-t7-l2-knee-and-goodput-peak.ts
16  0  src/data/errata/2026-11-22-t7-l4-napkin-margin-relation.ts
16  0  src/data/errata/2026-11-22-t7-l4-price-fall-and-margin-definition.ts
16  0  src/data/errata/2026-11-23-t2-l1-no-timeslice.ts
16  0  src/data/errata/2026-11-23-t2-l5-aba-head-is-freed-b.ts
17  0  src/data/errata/2026-11-23-t3-l4-task-state-is-its-live-locals.ts
19  0  src/data/errata/2026-11-23-t5-l10-trtllm-pytorch-only.ts
18  0  src/data/errata/2026-11-23-t5-l7-no-quantum.ts
16  0  src/data/errata/2026-11-23-t6-l4-kimi-k2-is-a-benchmark.ts
18  0  src/data/errata/2026-11-23-t6-l8-two-shapes-and-first-character-mask.ts
18  0  src/data/errata/2026-11-23-t7-l2-knee-and-step-32.ts
19  0  src/data/errata/2026-11-23-t7-l3-frontier-is-downward-sloping.ts
18  0  src/data/errata/2026-11-23-t7-l5-spiral-item-fits-the-gpu.ts
18  0  src/data/errata/2026-11-23-t7-l5-two-schools-of-autoscaling.ts
5  5  src/data/glossary.ts
1  1  src/data/kc/t0.ts
1  1  src/data/kc/t2.ts
1  1  src/data/kc/t6.ts
2  2  src/data/labs.ts
316  0  src/data/lessons/claims.generated.ts
48  0  src/data/lessons/claims.ts
1  1  src/data/lessons/index.ts
60  0  src/data/lessons/pagedMix.ts
2  1  src/data/lessons/r/borrowing-and-slices.ts
10  10  src/data/lessons/r/interior-mutability.ts
3  2  src/data/lessons/r/practical-lifetimes.ts
10  9  src/data/lessons/t0/aos-vs-soa.ts
15  13  src/data/lessons/t0/flame-graphs.ts
2  2  src/data/lessons/t0/memory-hierarchy.ts
12  12  src/data/lessons/t0/row-vs-column.ts
2  2  src/data/lessons/t0/why-systems.ts
7  7  src/data/lessons/t0/your-runtime.ts
2  2  src/data/lessons/t1/compile-link-abi.ts
28  9  src/data/lessons/t1/fragmentation.ts
5  4  src/data/lessons/t1/pointers.ts
7  6  src/data/lessons/t1/rust-ownership-intro.ts
50  37  src/data/lessons/t1/toy-allocator.ts
9  9  src/data/lessons/t2/async-io.ts
7  7  src/data/lessons/t2/concurrency-primitives.ts
53  28  src/data/lessons/t2/exam-pagedattention.ts
2  2  src/data/lessons/t2/processes-threads.ts
13  8  src/data/lessons/t2/scheduling.ts
3  3  src/data/lessons/t2/swapping-eviction.ts
2  2  src/data/lessons/t2/virtual-memory.ts
10  5  src/data/lessons/t3/dynamo-case-study.ts
7  6  src/data/lessons/t3/rust-concurrency.ts
3  2  src/data/lessons/t3/rust-wasm.ts
9  6  src/data/lessons/t3/rust-zig-c-decision.ts
58  30  src/data/lessons/t3/toy-executor.ts
39  14  src/data/lessons/t3/zero-copy.ts
4  3  src/data/lessons/t4/cpu-vs-gpu.ts
9  9  src/data/lessons/t4/gpu-memory.ts
2  2  src/data/lessons/t4/matmul-tiling.ts
22  22  src/data/lessons/t4/occupancy-coalescing.ts
6  6  src/data/lessons/t4/quantization.ts
4  4  src/data/lessons/t4/roofline.ts
19  14  src/data/lessons/t4/wgsl-playground.ts
23  18  src/data/lessons/t5/continuous-batching.ts
1  1  src/data/lessons/t5/distributed-serving.ts
2  2  src/data/lessons/t5/kv-cache-math.ts
52  27  src/data/lessons/t5/pagedattention-deep-dive.ts
2  2  src/data/lessons/t5/prefill-vs-decode.ts
24  15  src/data/lessons/t5/prefix-caching.ts
15  10  src/data/lessons/t5/production-stack.ts
26  17  src/data/lessons/t5/speculative-chunked.ts
2  2  src/data/lessons/t5/tokenization.ts
6  6  src/data/lessons/t6/agents-structured.ts
9  8  src/data/lessons/t6/epd-disaggregation.ts
57  32  src/data/lessons/t6/moe-anatomy.ts
6  6  src/data/lessons/t6/parallelism-zoo.ts
5  5  src/data/lessons/t6/security-boundaries.ts
3  2  src/data/lessons/t6/speculative-production.ts
28  23  src/data/lessons/t6/wide-ep.ts
23  11  src/data/lessons/t7/autoscaling-planner.ts
13  10  src/data/lessons/t7/benchmarking.ts
12  11  src/data/lessons/t7/objective-function.ts
8  8  src/data/lessons/t7/pareto.ts
70  17  src/data/lessons/t7/unit-economics.ts
1  1  src/data/plays.ts
1  1  src/data/rust-items/bank/borrows.json
3  3  src/data/rust-items/museum.json
8  8  src/data/rust-items/snippets/borrows.ts
524  463  src/data/search-index.json
6  4  src/data/twins/batching-scheduler.ts
3  3  src/data/twins/radix-cache.ts
1  1  src/lib/capstone/steps.ts
40  1  src/lib/items/core.ts
17  6  src/lib/items/families/frag.ts
65  18  src/lib/items/families/goodput.ts
2  4  src/lib/items/families/lazy/step-calibrated.ts
3  5  src/lib/items/families/roofline.ts
3  5  src/lib/items/families/step.ts
3  5  src/lib/items/families/tiling.ts
114  0  src/lib/items/play.ts
30  2  src/lib/learner/composer.ts
33  2  src/lib/learner/placement.ts
23  0  src/lib/learner/ticket-rule.ts
51  0  src/lib/search.ts
47  0  src/lib/sims/host.ts
21  12  src/lib/sims/models/blocks.ts
14  0  src/lib/sims/models/kv.ts
4  2  src/lib/sims/models/roofline.ts
9  0  src/lib/typography.ts
1  1  src/lib/world/fleet-ex/knee.ts
6  10  src/pages/Curriculum.tsx
32  28  src/pages/Glossary.tsx
2  2  src/pages/Home.tsx
19  7  src/pages/Lesson.tsx
9  3  src/pages/Today.tsx
1  1  src/pages/boot/You.tsx
4  3  src/pages/changes/ErrataTab.tsx
17  0  src/pages/lesson/also-next.ts
38  0  src/pages/lesson/anchor-aliases.ts
6  0  src/pages/lesson/markdown.tsx
31  0  src/pages/lesson/prose.tsx
42  0  tests/changes/k0-e10-curly-quotes.test.ts
46  0  tests/claims/cite.test.ts
96  0  tests/claims/k0-c25-moe-arithmetic.test.ts
69  0  tests/claims/k0-c29-decode-ceiling.test.ts
132  0  tests/claims/k0-c3-unit-economics.test.ts
62  0  tests/claims/k0-c34-resident-warps.test.ts
79  0  tests/claims/k0-e2-cli.test.ts
35  0  tests/claims/k0-e2-imports.test.ts
31  0  tests/claims/k0-fix-registry.test.ts
22  0  tests/claims/k0-fix2-registry.test.ts
48  0  tests/claims/kvpool.test.ts
8  1  tests/claims/lazy.test.ts
78  0  tests/claims/lesson-claims.test.ts
1  1  tests/claims/physics.test.ts
25  2  tests/claims/pin.test.ts
4  2  tests/claims/wave3.test.ts
53  0  tests/content/k0-b2.test.ts
27  0  tests/content/k0-b3.test.ts
34  0  tests/content/k0-b4.test.ts
39  0  tests/content/k0-b9.test.ts
37  0  tests/content/k0-c10.test.ts
34  0  tests/content/k0-c30.test.ts
18  0  tests/content/k0-c31.test.ts
55  0  tests/content/k0-c33.test.ts
43  0  tests/content/k0-c35.test.ts
77  0  tests/content/k0-c9-dynamo-transport.test.ts
207  0  tests/content/k0-close-a.test.ts
99  0  tests/content/k0-close-c.test.ts
28  0  tests/content/k0-e3-mix.test.ts
58  0  tests/content/k0-e4.test.ts
76  0  tests/content/k0-e5.test.ts
47  0  tests/content/k0-e6.test.ts
33  0  tests/content/k0-e8.test.ts
94  0  tests/content/k0-fix-t3.test.ts
93  0  tests/content/k0-fix-t4.test.ts
57  0  tests/content/k0-fix2-browser.test.ts
94  0  tests/content/k0-fix2-t4.test.ts
229  0  tests/content/k0-fix3.test.ts
89  0  tests/content/k0-fix3b.test.ts
184  0  tests/content/k0-fix4.test.ts
35  0  tests/content/paged-waste-sources.test.ts
536  0  tests/content/vllm-block-size.test.ts
45  0  tests/errata/k0-fix2-t1.test.ts
3  3  tests/fixtures/items/hashes/compile.json
5  5  tests/fixtures/items/hashes/frag.json
5  5  tests/fixtures/items/hashes/goodput.json
6  6  tests/fixtures/items/hashes/roofline.json
6  6  tests/fixtures/items/hashes/step.json
5  5  tests/fixtures/items/hashes/tiling.json
4  0  tests/fixtures/lesson-claims/clean.ts
6  0  tests/fixtures/lesson-claims/helper.ts
4  0  tests/fixtures/lesson-claims/lesson-like.ts
361  0  tests/fixtures/lesson-headings/slugs.json
6  4  tests/fleet-ex/panel.test.ts
34  7  tests/forge/field-labs.test.ts
92  0  tests/forge/k0-c46-lab-urls.test.ts
13  11  tests/forge/twin.test.ts
27  6  tests/forge/twins-content.test.ts
6  2  tests/items/chips.test.ts
292  0  tests/items/feedback-dedupe.test.ts
24  3  tests/items/frag.test.ts
21  0  tests/items/goodput.test.ts
51  0  tests/items/k0-fix-t7-knee-rows.test.ts
7  3  tests/items/play.test.ts
10  6  tests/items/reading-invariance.test.ts
6  1  tests/items/roofline.test.ts
75  0  tests/items/step-list.test.ts
19  2  tests/items/step.test.ts
108  0  tests/items/worked-leak.test.ts
165  10  tests/learner/anchor-line.test.ts
59  1  tests/learner/composer.test.ts
16  0  tests/learner/item-block-cold.test.ts
90  0  tests/learner/placement.test.ts
92  0  tests/learner/result-heading.test.ts
24  0  tests/learner/ticket.test.ts
48  0  tests/lesson/also-next.test.ts
38  0  tests/lesson/prose-fence.test.ts
1  1  tests/lesson/work-analogue.test.ts
270  0  tests/lessons/diagram-fit.test.ts
41  0  tests/lessons/k0-a19-paper-link.test.ts
46  0  tests/lessons/k0-b10-knee-definition.test.ts
56  0  tests/lessons/k0-c12-glossary-vs-errata.test.ts
26  0  tests/lessons/k0-c16-no-all-of-the-above.test.ts
43  0  tests/lessons/k0-c2-loadgen-status.test.ts
16  0  tests/lessons/k0-c21.test.ts
75  0  tests/lessons/k0-c23.test.ts
37  0  tests/lessons/k0-c24.test.ts
43  0  tests/lessons/k0-c27-percentile-rule.test.ts
46  0  tests/lessons/k0-c28-frontier-slope.test.ts
35  0  tests/lessons/k0-c4.test.ts
22  0  tests/lessons/k0-c40-python-tab.test.ts
22  0  tests/lessons/k0-c43-no-t2-bkl.test.ts
53  0  tests/lessons/k0-c44-refcell-panic.test.ts
39  0  tests/lessons/k0-c5.test.ts
71  0  tests/lessons/k0-c6.test.ts
49  0  tests/lessons/k0-c8b.test.ts
132  0  tests/lessons/k0-close-b.test.ts
63  0  tests/lessons/k0-close-d.test.ts
67  0  tests/lessons/k0-close-i.test.ts
91  0  tests/lessons/k0-close-j.test.ts
25  0  tests/lessons/k0-close2-d.test.ts
70  0  tests/lessons/k0-e7-anchor-aliases.test.ts
61  0  tests/lessons/k0-fix-glossary.test.ts
33  0  tests/lessons/k0-fix-rust-polonius.test.ts
140  0  tests/lessons/k0-fix-t0.test.ts
106  0  tests/lessons/k0-fix-t1.test.ts
59  0  tests/lessons/k0-fix-t2.test.ts
71  0  tests/lessons/k0-fix-t5-blocks.test.ts
59  0  tests/lessons/k0-fix-t5.test.ts
128  0  tests/lessons/k0-fix-t6.test.ts
26  0  tests/lessons/k0-fix-t7-lane.test.ts
34  0  tests/lessons/k0-fix2-glossary.test.ts
75  0  tests/lessons/k0-fix2-learner.test.ts
106  0  tests/lessons/k0-fix2-rules.test.ts
21  0  tests/lessons/k0-fix2-t2.test.ts
34  0  tests/lessons/k0-fix2-t5.test.ts
63  0  tests/lessons/k0-fix2-t7.test.ts
89  0  tests/lessons/k0-fix4-t5.test.ts
31  0  tests/lessons/no-raw-fences.test.ts
189  0  tests/lessons/signposts.test.ts
20  0  tests/lessons/t0-l6-direction.test.ts
64  0  tests/lessons/t1-l4-block-claims.test.ts
107  0  tests/lessons/t2-l4-scheduling.test.ts
26  0  tests/lessons/t2-l7-block-claims.test.ts
49  0  tests/lessons/t2-l7-paper-refs.test.ts
63  0  tests/lessons/t5-l5-block-claims.test.ts
45  0  tests/lessons/t5-l5-cow.test.ts
50  0  tests/lessons/t5-l6-block-claims.test.ts
82  0  tests/lib/keys.test.ts
3  1  tests/plays/eplb.test.ts
1  1  tests/plays/play.test.ts
84  0  tests/rust/k0-fix-rust-trace-uses.test.ts
97  0  tests/rust/k0-fix2-rust-museum-focus.test.ts
8  5  tests/search/index.test.ts
67  0  tests/search/k0-z3-encoding.test.ts
25  0  tests/search/k0-z4-rust-lang.test.ts
2  2  tests/search/palette-v2.test.ts
66  19  tests/sims/block-table.test.ts
3  0  tests/sims/kv.test.ts
11  2  tests/sims/roofline.test.ts
1  1  tests/world/season0.test.ts
```
