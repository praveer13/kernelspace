# Serving-first Rust reading items: spec (PR sr)

**Status:** draft for owner review. The build proceeds on the defaults in "Owner questions" (SR-D19). Nothing here is signed. SR-D25 to SR-D29 apply the verified critique of the first draft (477542b).
**Drafted:** 2026-10-19.
**Picked up.** The owner picked up serving-first Rust reading items on 2026-10-19, a Wave 3 leftover. PR #16 (`fix/path-descriptions`) removed the claim because nothing delivered it. It is not a new wave, and every other item keeps its gate and date.
**Base:** `wave-hk` at `2e0d2ce`: PR #23's housekeeping on top of PR #22 (`wave-s5b`), with `master` (PRs #20 and #21) merged in (SR-D20). The design read the code at `00d0c0a`, the same tree without #20's files. So `file:line` cites hold there. In `outcomes.ts`, `partner-report.ts`, `redact.ts` and the other files #20 touched, the symbol is the anchor, and line numbers are only hints.
**Sources.** This spec is written from a design synthesised from three candidate designs, an adversarial judgement and four reader maps:
- the bank;
- delivery;
- the path's content;
- the promises.

They live in the orchestrator's scratchpad and are not committed: `sr/design.md`, `sr/judge.md`, `sr/read-*.md`.

The design's evidence lives in `sr/rustc-final/`:
- the 36 snippets in the bank's own format (`snippets/reading-*.ts`);
- their banks (`bank/reading-*.json`), built by `scripts/build-rust-items.ts` with rustc 1.96.0, edition 2024;
- a prototype tree (`proto/`), with `proto-code.diff` as the reference code diff;
- the check scripts and their outputs.

Numbers marked **[proto]** were measured on that prototype. The tasks re-measure every one in the repo.
**Nothing but this file is committed with the spec.**

Section numbers below are cited by the task DAG (§10) and by the snippet files' headers (§4, §4.1).

---

## Decisions (read first)

SR-D1 to SR-D18 are the design's decisions. SR-D19 onward are the orchestrator's.

| # | Decision | Why | Where |
|---|---|---|---|
| SR-D1 | A **reading item** is a `compile` family `verdict` or `fix` item. It is drawn from a reader-voice snippet, on a block-only variant of a reading KC, and shown in a `reading` lesson block. There is no `permission` kind. | It is the plan's own item (PLAN-100X.md:209, :430) and reuses a gated generator. `permission` presumes R3's Read/Write/Own model and belongs to `r.permissions` alone (`compile.ts:180`). | §3.1 |
| SR-D2 | **Four KCs** gain `gen: ['compile']`: `r.enums-option-result`, `r.iterators-ownership`, `r.closures-collections` and `r.smart-pointers` (`src/data/kc/r.ts:139, 162, 172, 184`). `r.bindings-expressions` is deferred (Q3). `r.error-propagation` gets no generator, because `?` items live under enums. | These are the R KCs that the path's T5/T6 KCs require directly (`kc/t5.ts:46, 57, 173, 184, 267`; `kc/t6.ts:228`). The bindings edge (`kc/t0.ts:57`) sits in t0.l2, which has no Rust on the page. | §3.3 |
| SR-D3 | **Host rule (narrow).** A block in lesson L may teach R KC r only if r ∈ D(L) ∪ ON_PAGE(L). D(L) is the set of R KCs required directly by L's KCs, or by a T5–T7 KC reachable from them through T5–T7 edges. ON_PAGE = {t5.l6: `r.closures-collections`}, cited to `prefix-caching.ts:158-169`. **Coverage rule:** every direct edge L.kcs → R KC on the path is covered by a block in L, except deferred ones. | This rejects 8-hop paths through T2 (t5.l7 reaches closures only through four T2 KCs). The one on-page clause is justified by content: `prefix_router.rs`'s closures capture `guard` and `workers` on the page itself. | §3.3, §5.3 |
| SR-D4 | A new **`reading` lesson block type**, rendered by `ItemBlock`. It is not an `item` block. | The item-block gates stay true as written. That covers the hands-on rule ("a variant KC is a lesson KC", `tests/kc/hands-on.test.ts:127-141`) and the T6/T7 one-item-block pins (`tests/kc/t6b-content.test.ts:110-115`, `tests/kc/t7-content.test.ts:110-114`). | §5.2 |
| SR-D5 | **Block-only isolation.** `VariantSpec.blockOnly?: true` (`src/lib/items/types.ts:142-148`) and a `blockOnlyFor(gen, kc)` helper in `core.ts`. The filter sites of §3.4 honour them. Today, extra, cold checks, tickets, the placement walk, forms, the Museum and variant-less draws skip reading variants. | This keeps every other metric true. [proto]: forms 9/9 identical; Today and ticket pools identical; Museum draws 0 of 1,260 changed. It also keeps H3's signed analysis identical (SR-D16). | §3.4 |
| SR-D6 | A **`types` cluster**: E0004, E0277 and E0308 join `ERROR_CODES` (`constants.ts:38, 45-67`). A `types` code is a verdict distractor only for a key whose clusters include `types` (one clause at `compile.ts:224`). | `Option`, `?`, `Send` and `f64: Ord` are type errors, so reading items need these codes. A legacy unit's `clusters` never holds `types`, so its code list and rng draws are unchanged. [proto]: 15/15 legacy hash rows identical. | §3.2 |
| SR-D7 | A **legend** on reading stems. A verdict stem ends "Codes: E0004 is …; E0308 is …" for the codes among its options. A fix stem says "rustc rejects this with E0308 (a value of one type where the code expects another)". | The items test reading, not memorised codes. The gloss is the same `ERROR_CODES[c].means` that a wrong pick's why already uses (`compile.ts:240`). The cue gate reads options and stem. [proto]: the worst reading-verdict strategy is 25.8 % against 25.0 % chance. | §3.2 |
| SR-D8 | The **Error Museum excludes the reading groups**. `museumEntries` filters reading snippets (`src/lib/rust/museum.ts:160`), and `practiceInstance` filters reading units (`compile.ts:341`). | `museum.json` stays byte-identical [proto]. There is no new exhibit, trace, `TAUGHT_IN` or `LESSON_TITLES` work. | §3.4 |
| SR-D9 | **Reader-voice content, no retags, no labels.** New groups only. They list reading KCs only and carry no `permission` or `focus`. A test rejects R/W/O vocabulary. Rule 4: no fix calls `.clone()` on an `Rc`, `Arc` or `Weak`. | 403 of 658 legacy whys use R/W/O vocabulary, which a learner who skipped R3 never met. A legacy pool never moves, because no reading snippet lists a legacy KC. | §4.1 |
| SR-D10 | **Pool floors.** Per reading KC: at least 24 verdict units and 16 fix units; 20–27 % "compiles"; every fix pool's worst blind strategy at most chance + 10 points. `Gen.bank.units` stays 16 (`compile.ts:380`). | 16 keeps the distinct-instance gate as strong as today (`scripts/verify-generators.ts:328-333`). [proto]: verdict 45/40/33/38; fix 25/19/18/21; compiles 24.4/25.0/24.2/23.7 %; worst fix strategy +5.8/+6.7/+8.6/+6.9. | §3.5 |
| SR-D11 | **`ItemBlock` fixes:** plan under `settle`; the `broken` stage gains "Try again"; `more` takes a visit token; compile copy ("Another snippet"); an off-path collapse; `data-block="reading"`. | A cold load is broken today (`ItemBlock.tsx:90-92`, `item-block.ts:207-217`). Reproduced: a cold `planItem` returns null, and under `settle` it returns the warm plan. | §5.2 |
| SR-D12 | **No `VERSION` bump.** `compile.json` gains 8 rows and keeps its 15. | A bump would change every recorded `rev` (`core.ts:103-121`) when no legacy instance moved. | §7 |
| SR-D13 | **Minutes unchanged.** 785 stays. The spec reports reading time (about 15–18 min) separately. | The item-block precedent (`1f3d15f`) added a block without a `minutes` line. | §5.1 |
| SR-D14 | **Copy:** the Boot blurb, the `paths.ts` header, a path-aware placement anchor line and three stale comments. No persona name appears in learner copy. A test ties the blurb to the blocks. | PR #16's failure mode was copy drifting away from content. | §5.5 |
| SR-D15 | **Measurement.** M0 is invariance in CI. M1 is coverage and phone e2e. M2 is a pre-registered think-aloud (the decision) plus donation-compatible ledger descriptives. | Donations count, through the off-R proxy and `grp` order. | §8 |
| SR-D16 | **H3 stays as signed.** No edit to `selectHintArms` or `docs/prereg/hint-ladders.md`. A test proves the outcome identical. Opening Today to the reading pools later needs a dated amendment first. | H3's outcome is the first cold `probe` with a `gen:` ref on a wanted KC (`outcomes.ts` `selectHintArms`; hint-ladders.md:34). Reading blocks write `item` events, and Today cannot draw block-only variants, so no outcome can appear. | §6.4, §8 |
| SR-D17 | **No reading card origin and no Today spacing in v1.** Spacing comes from re-exposure: enums in 5 blocks, iterators in 3, closures and smart pointers in 2 each. | A card origin changes Today for every path, and H3 with it (SR-D16). | §5.4 |
| SR-D18 | **Process.** Every task names its base sha and checks `git merge-base --is-ancestor`. One branch per task, integrated into `wave-sr`. Derived bank files are regenerated, never hand-merged. Every task runs lint, build, `bun run test` and every `bun run verify:*` except `verify:seeds`, bare (wave-2.md:1507). | Memory: agent worktrees start at master unless told otherwise. | §10 |
| SR-D19 | **Defaults are what we build.** Each owner question's default (Q1–Q12) is built and recorded. An answer that arrives after its task merges becomes a dated amendment. | The owner's standing instruction: keep building unless blocked, and the owner merges PRs later. | Owner questions |
| SR-D20 | **Base `2e0d2ce`.** PR #22 merged into `wave-s5a` after #21 had landed, so s5b never reached `master`. The orchestrator merged `master` into `wave-hk` (no conflicts; full gate and e2e run there) and retargeted PR #23 to `master`. `wave-sr` stacks on `wave-hk`, so SR-08 can edit #20's `outcomes.ts` and `partner-report.ts` without a cross-PR conflict. | Keeps one linear stack: #23 then this PR. | — |
| SR-D21 | **The parallel-task restriction is lifted.** The design kept `on-demand.ts`, `registry.ts` and `step.ts` off limits while HK2 was in flight. HK2 merged at `00d0c0a`. SR-04 updates one comment in `on-demand.ts` (`MAX_RUNS`: "the bank has four groups" becomes eight). No other edit to those three files. | The comment would otherwise be stale. `MAX_RUNS = 8` still holds, because one run collects every group a plan wants (§5.2). | §5.2 |
| SR-D22 | **A stable block object.** The `reading` renderer passes `ItemBlock` an item spec derived once per `ReadingBlock` object (a module-level `WeakMap`), never an inline literal. | `ItemBlock`'s load effect keys on `block` identity (`ItemBlock.tsx`, effect deps `[at, block, attempt]`). A fresh object on each render would reload forever. | §5.2 |
| SR-D23 | **M0 also covers #20's secondary analyses.** `selectHintSecondary` and `selectDailySecondary` give identical output with and without reading-block events. | They read `probe gen:` events (hint-secondary) and Daily events. Reading blocks write neither, and the test keeps it that way. | §8 |
| SR-D24 | **The snippets are ported verbatim, except for the edits SR-D25 and SR-D26 name.** SR-04 copies `sr/rustc-final/snippets/reading-*.ts` byte for byte, then makes exactly those edits. Any edit re-runs `build-rust-items`, `verify:rust-items` and `verify:generators --family compile`, and the PR lists each edit. | Fix pools sit 5.8–8.6 points above chance. A one-word change can move a cue (§11). | §4 |
| SR-D25 | **One code per failure (content rule 9).** A failing variant, and every wrong fix, makes rustc report exactly one distinct error code. Three [proto] variants break the rule:<br>• `alloc-option-admit/ret-vec` reports E0277 then E0308. It is replaced by `ok-or-q`: line 13 becomes `got.push(p.alloc().ok_or(0u32)?);`, which gives E0277 alone, and the ok fix restores `got.push(p.alloc()?);`.<br>• `admit-two-pins/option-ret` reports E0277 then E0308. It is replaced by the variant `ok-q`: line 13 becomes `let a = pin(free, 4).ok()?;`, which gives E0277 alone, and the ok fix restores `let a = pin(free, 4)?;`. The old wrong fix `ok-q` is dropped, because it is now the variant itself.<br>• `admissible-count/count-late` reports E0502 and E0382. It is dropped.<br>SR-04 sweeps every reading variant and fix through rustc and reports each one's distinct codes. | A second code is a true answer to "Which error does rustc report", and the verdict would still mark it wrong. In the three-code `types` cluster every other code is drawn as a distractor, so the second code is always on screen. | §4.1, §4.2 |
| SR-D26 | **Corrected Rust explanations.** In `router-choose`, the filter can never leave no worker: `min()?` has already returned for an empty fleet, and the least-loaded worker always passes `w.load <= min + 4`. `max_by_key` returns an `Option` because of its signature: a chain may yield nothing. The base why, the `unwrap-or` fix's why and B3's lead say so (§4.2, §5.3). B4's lead no longer calls t5.l7's step 2 admission: step 2 is the capacity check that preempts, and the Headroom dial admits. | The first draft taught a false reason, and contradicted the numbered list above the block. | §4.2, §5.3 |
| SR-D27 | **The test suite's own pools follow the filters.** `tests/learner/ledger-gen.ts` (`makePool.families`, a simulated Today used by about 20 test files) drops a family that is block-only for the KC (`blockOnlyFor`), as `today.ts` does. `tests/learner/on-kc.test.ts`'s `offered` skips block-only variants. `scripts/verify-kc.ts`'s `genCovers` counts a family for a KC only through a variant that is not block-only. | Without the first two, SR-04 fails `bun run test` (`reentry.test.ts`, `on-kc.test.ts`; measured on the full suite on the prototype). Without the third, `verify:kc` would accept an R KC with no servable item, and Today could strand its card. | §3.4, §7, §10 |
| SR-D28 | **M2 follows the repo's prereg rules.** `docs/prereg/serving-reading.md` is a draft in the form of `docs/prereg/protege.md`. Its status reads "DRAFT for the owner to sign … The drafter has not signed or dated it", and section 7 is a `Signed: (pending owner)` line plus an Owner / Date signed / Amendments table. The report prints "NOT READ" until `isPreregSigned` is true. `KEPT_WORKING` gains `'boot:path'` (a path id, never free text), so the population can include full exports. One eligibility rule covers both inputs. | Every other prereg selector waits for the signature (PLAN:753). Without `boot:path`, `stripFreeText` drops the path, and the full-export population is always empty. | §8 |
| SR-D29 | **Carded learners on other paths.** A reading answer on an R KC that already has a card reviews that card: its due day, the optimism offset and the recent-item window move. If the answer comes 30 or more days after the card was created, it counts as a VRK30 check, as every item block's answers do. No new draw comes from it. | The first draft said these figures do not move on other paths, and they do. | §5.4, §6.1, §6.4 |

---

## Owner questions

The build proceeds on these defaults (SR-D19). Each row names the task it should be answered before.

| # | Question | Default we build | Answer before |
|---|---|---|---|
| Q1 | Add E0004, E0277 and E0308 to the bank in a `types` cluster, with distractors filtered so legacy items stay identical? | **Yes** (0 legacy drift [proto]) | SR-03 |
| Q2 | Keep the reading groups out of the Error Museum in v1 (21 exhibits, no new traces)? | **Yes**; a v2 can add three hand-drawn exhibits | SR-03 |
| Q3 | Defer `r.bindings-expressions` (t0.l2 has no Rust on the page)? | **Defer**, named in the coverage test | SR-06 |
| Q4 | Keep the reading pools block-only in v1 (no Today, no reading card origin)? | **Yes**; revisit after M2, and only with a dated H3 amendment | SR-03 |
| Q5 | Full-ramp and rust-systems learners see a collapsed line at the hosts? | **Yes** | SR-05 |
| Q6 | Leave `minutes` and the path's 785 unchanged? | **Yes**; the spec reports about 15–18 min of reading | SR-06 |
| Q7 | Do reading answers count toward /me competence lines? | **Yes**, the rule every item block follows | SR-06 |
| Q8 | Retag legacy snippets into the reading pools? | **No** (reader voice) | SR-04 |
| Q9 | Bump the compile `VERSION`? | **No** | SR-04 |
| Q10 | Accept the t5.l6 on-page clause (closures) and the t5.l10 host? | **Yes**; closures and smart pointers then meet two blocks each | SR-06 |
| Q11 | Sign `docs/prereg/serving-reading.md`, with the think-aloud as the decision read, before the release that ships SR-06? | **Yes**; the sessions are an owner step | release |
| Q12 | Add a dated note to `hint-ladders.md`? | **No**: the outcome is identical by construction and pinned by M0, and this spec records why | — |

---

## 0. Summary

1. **The promise.** PLAN-100X.md:209 says "Rust arrives as compile-bank reading items, and the labs are optional". wave-1.md:797 says "R appears only as reading items". Today nothing delivers either (`src/lib/learner/paths.ts:17-19`, `src/pages/boot/You.tsx:14`).
2. **The items** are the compile family's own `verdict` and `fix` items, on the four R KCs that the path's KCs require. They are drawn from **36 new snippets** written in a reader's voice for someone who skipped Rust Zero. All 144 variants and 229 fixes are confirmed by rustc 1.96.0 through the bank's own builder [proto].
3. **Type errors join the bank:** E0004, E0277 and E0308, in a `types` cluster. A distractor filter keeps every legacy item byte-identical. Reading stems carry a one-line legend that glosses each code on screen.
4. **Block-only isolation.** Only a lesson block draws a reading variant. Today, tickets, the placement walk, forms, the Error Museum, H3's signed analysis, VRK30 and the 15 existing hash rows do not move, and `VERSION` stays 2.
5. **Delivery.** A new `reading` lesson block appears in **seven** path lessons, at the point of use and after every index-keyed block. The hosts are t5.l2, t5.l5, t5.l6, t5.l7, t5.l10, t6.l8 and t6.l9. Finishing them takes 16 correct answers, about 15–18 minutes. Steps, plan and the 785 minutes do not change.
6. **The `ItemBlock` cold-load defect is fixed.** Today a compile block renders "no question to show right now" on a cold load.
7. **Other paths:** full-ramp and rust-systems learners who open a host see one collapsed line, and nothing is written unless they open it.
8. **Measurement.** M0 and M1 in CI and e2e. M2 is a pre-registered two-partner think-aloud (the decision instrument, OD10, PLAN-100X.md:826), informed by donation-compatible ledger figures.
9. **Cost:** 9 tasks, 39 review hours. The core that ships the promise (SR-01 to SR-07) is 32 h. The content risk is already retired: the snippets are written, confirmed by rustc and cue-gated [proto].

---

## 1. Goal, non-goals, invariants

**Goal.** A serving-first learner meets graded, rustc-confirmed Rust reading items inside the lessons on that path. The items cover the R knowledge those lessons' own KCs require, at the point where the lesson needs it. Boot, `paths.ts` and the placement result then tell the truth about it, and a test keeps them truthful.

**Non-goals** (the owner question, where one exists, in brackets):
- No R lesson becomes a step. No path, plan, minutes, braid or K3 change.
- No new KC. No `Lesson.kcs`, `Kc.lessons` or `requires` edit. `r.bindings-expressions` is deferred (Q3).
- Today, tickets, the placement walk, forms and the Error Museum do not serve the reading pools in v1 (Q2, Q4).
- No new card origin, Up Next kind, ledger or schema change, or `ItemSrc`.
- No retags of legacy snippets (Q8). No `permission` items. No `VERSION` bump (Q9).
- No edit to `PLAN-100X.md`, `docs/specs/wave-1.md` or the signed `docs/prereg/hint-ladders.md`.

**Invariants** (each pinned by a test in §8):
- I1. The 15 legacy rows of `tests/fixtures/items/hashes/compile.json` are identical, and `VERSION === 2`.
- I2. All 9 form blueprints are identical.
- I3. `museum.json` is byte-identical, and every Museum practice draw is identical.
- I4. Today's, extra's and tickets' family lists are empty for each reading KC.
- I5. H3's primary outcome, `selectHintSecondary` and `selectDailySecondary` are identical with and without reading-block events.
- I6. `pathPlan('serving-first')` keeps 29 steps and 785 minutes, and K3 is untouched.
- I7. The entry chunk grows by 0 B (raw bytes, S5-D50), and `/boot` and `/today` stay within 200 KB.

---

## 2. The promise, quoted, and what ships today

| Source | Text |
|---|---|
| PLAN-100X.md:209 | "**Wei, ML engineer, serving-first:** Boot, t0.l1–l2, t4.l3, then T5–T7, 755 declared minutes [measured]. Rust arrives as compile-bank reading items, and the labs are optional." |
| PLAN-100X.md:430 | "**(a) Compile bank (M).** ~150 snippets (~600 variants), compiled in CI against a pinned rustc. The learner names the code, the missing Read/Write/Own permission and the fix; `.clone()` is the lure. Snippets use serving domain objects and work on a phone." |
| PLAN-100X.md:753 | "Thresholds and non-inferiority margins are pre-registered in `docs/prereg/<feature>.md` before any data arrives." |
| docs/specs/wave-1.md:797 | "**`serving-first`:** t0.l1, t0.l2, t4.l3, t5.l1–t5.l10, T6, T7 (755 declared minutes, PLAN §4 Wei). R appears only as reading items; labs are optional." |
| docs/specs/wave-2.md:1202 | "Items serve Today (R KCs gain `gen: ['compile']`, pending in 2a-06), the Error Museum, and R lessons' practice." |
| `src/lib/learner/paths.ts:17-19` (today) | "R is not on this path, and nothing serves its lessons as reading items either (PR 16 found none): they stay open in the Curriculum, as Boot's blurb says." |
| `src/pages/boot/You.tsx:14` (today) | "… (T5 to T7). Rust Zero is not on this path; its lessons stay open in the Curriculum." Pinned by `tests/learner/recommend.test.ts:502-507`, which forbids "Rust arrives as short reading items". |

**Bookkeeping.**
- The path has 785 declared minutes (`tests/learner/paths.test.ts:243`), where PLAN and wave-1 say 755. This spec records the difference and leaves both files alone.
- **Deviation from wave-2.md:1202:** the four KCs gain `gen: ['compile']` but do not serve Today in v1 (SR-D5, Q4).
- **The plan's item names a permission.** PLAN:430's "names … the missing Read/Write/Own permission" describes the legacy bank. Reading items have no permission kind (SR-D1), because a serving-first learner never took R3.

---

## 3. The items

### 3.1 Kinds, as the learner sees them

These were rendered through `planItem` on the prototype:

```
Which error does rustc report for this code, if any?
  fn ready(buf: &[u8]) -> &str {
      match from_utf8(buf) {
          Ok(s) => Some(s), …
Codes: E0004 is a `match` that leaves a case uncovered; E0277 is a type that lacks a trait the code needs
(Send, Ord, a `?` conversion); E0308 is a value of one type where the code expects another.
  ( ) E0004   ( ) E0277   (x) E0308   ( ) compiles with 0 errors

rustc rejects this with E0507 (a move out of a place behind a reference). Which one-line change makes it
compile without changing what it does?
  fn share(b: &Arc<Block>) -> Arc<Block> {
      let s = Arc::new(**b); …
  (x) line 9: let s = Arc::clone(b);
  ( ) line 9: let s = Arc::new(Arc::clone(b));
  ( ) line 9: let s = Arc::new((**b).clone());
```

- **Verdict items** have four sorted options: the key, "compiles with 0 errors", and codes from the key's cluster (`compile.ts:215-231`). A wrong pick's why reads "E0277 is … Here rustc reports E0308 at line 7. …" (`compile.ts:240`).
- **Fix items** have three or four authored one-line fixes, exactly one of them `ok` (`scripts/verify-rust-items.ts:169-191`).
  - A `.clone()` pick records `r.clone-to-silence` (`compile.ts:306`).
  - Every compiling wrong fix is a labelled lure, and its why says what it changes.

### 3.2 Codes, the `types` cluster, the legend

**Constants** (`src/data/rust-items/constants.ts`):
- `CodeCluster` (:38) gains `'types'`.
- `ERROR_CODES` (:45-67) gains:
  - `E0004: 'a \`match\` that leaves a case uncovered'`
  - `E0277: 'a type that lacks a trait the code needs (Send, Ord, a \`?\` conversion)'`
  - `E0308: 'a value of one type where the code expects another'`
- The charter comment (:40-44) gains one clause: "and the type errors serving-first reading items need (serving-reading.md SR-D6)".
- `PERMISSION_CODES` is unchanged. Type errors take no label.
- `READING_KCS` and `isReadingSnippet` are exported here. This is a light table with no bank import, so `museum.ts` and the family can share it.

**The family** (`src/lib/items/families/compile.ts`):
- **:224, the distractor filter:** `BANK_CODES.filter((c) => !isPanic(c) && !chosen.includes(c) && (ERROR_CODES[c]?.cluster !== 'types' || clusters.has('types')))`.
- **:243-254 and :299-314, the legend:** `makeVerdict` and `makeFix` take `legend = spec.blockOnly === true`. `make` passes it; `practiceInstance` never does.
- `src/components/rust/ErrorEntry.tsx:44`: `KIND_LABEL` gains `types: 'types'`. It only completes the type, since the Museum shows no `types` exhibit (SR-D8).

### 3.3 KCs and hosts

| KC (`r.ts` line) | "can" (quoted) | Direct edges from the path (the coverage rule) | Hosts (D(L) or ON_PAGE) |
|---|---|---|---|
| `r.enums-option-result` (:139) | "model absence with Option and failure with Result, and match on both" | t5.tokenizer-bytes (`t5.ts:46`), t5.block-tables (`:173`), t5.admission-headroom (`:267`) | t5.l2, t5.l5, t5.l6, t5.l7, t6.l9 |
| `r.iterators-ownership` (:162) | "choose iter, iter_mut or into_iter by what the loop must own, and say when lazy adapters run" | t5.block-tables (`t5.ts:173`), t6.grammar-masks (`t6.ts:228`) | t5.l5, t5.l6, t6.l8 |
| `r.closures-collections` (:172) | "say what a closure captures and why, and build maps and counters with HashMap::entry" | t5.bpe-merges (`t5.ts:57`) | t5.l2; t5.l6 (ON_PAGE) |
| `r.smart-pointers` (:184) | "choose Box, Rc or Arc, and know that cloning one copies a handle and bumps a count, not the data" | t5.block-refcounts (`t5.ts:184`) | t5.l5, t5.l10 |

Under the narrow rule, t5.l7 reaches only enums. D(t5.l10) is {enums, iterators, smart pointers}, and D(t6.l9) is {enums, iterators}.

### 3.4 Block-only isolation: every site

| Site (line at `00d0c0a`) | Change | What it keeps true ([proto] unless noted) |
|---|---|---|
| `src/lib/items/types.ts:142-148` | `blockOnly?: true` on `VariantSpec` | the flag is not part of an instance, so no hash row moves |
| `src/lib/items/core.ts:92` (`resolveVariant` with no variant) | `offered` skips block-only variants | variant-less draws (none in `src` today, so this is defensive) |
| `src/lib/items/core.ts` (new) | `blockOnlyFor(gen, kc)`: true when every variant teaching `kc` is block-only and there is at least one | a family that lists a KC with no variant behaves as before |
| `src/lib/learner/today.ts:284` (`servableLevel`) and `:299` (`makeInstance`) | skip block-only | Today items, cold checks and VRK30 inputs: pools identical |
| `src/lib/learner/today.ts:309` (`buildPool.families`) | drop a family when `blockOnlyFor` | `composeExtra`'s order (`composer.ts:360-361`): `families(reading KC)` is `[]` |
| `src/lib/learner/ticket.ts:94, :98` (`makeGenPool`) | the same two filters | tickets, spirals and the placement walk are identical |
| `src/lib/learner/forms.ts:166` (`optionsOf`) | skip block-only | 9/9 track blueprints identical, and `r.lifetimes` stays in the R form |
| `src/lib/items/families/compile.ts:341` (`practiceInstance`) | drop reading units from `refs` | Museum draws: 0 of 1,260 (21 codes × 60 seeds) changed, `rev` included |
| `src/lib/rust/museum.ts:160` (`museumEntries`) | drop reading snippets | `museum.json` byte-identical; 21 exhibits (`tests/rust/museum.test.ts:145`) |
| `scripts/verify-kc.ts:270` (`genCovers`) | a family covers a KC only through a variant that is not block-only | an R KC whose only variants are block-only still needs 2 tagged items, so Today never strands its card (SR-D27) |
| `tests/learner/ledger-gen.ts:74` (`makePool.families`, the simulated Today) | drop a family when `blockOnlyFor(gen, kc)` | every `simulate()` ledger stays identical to the base; `tests/learner/reentry.test.ts:217` stays green (SR-D27) |
| `tests/learner/on-kc.test.ts:109, :130` (`offered`) | skip block-only variants | the test checks what Today and tickets serve; a reading link serves null from both pools by design (SR-D27) |

Blocks are served through `item-block.ts:56` (`variantsOf`) and `:208` (`makeAt`), which read the variants by id, so blocks can draw them. `src/lib/kc/resolve.ts:123` only resolves events, and the `data.kcs` written at write time wins.

### 3.5 Pools ([proto], from `probe-out.txt` and `vg-proto.txt`)

| Pool | Snippets | Verdict units | "compiles" | Fix units | Worst verdict strategy | Worst fix strategy |
|---|---|---|---|---|---|---|
| `r.enums-option-result` | 11 | 45 | 11 (24.4 %) | 25 | 2nd-longest 25.2 % / 25.0 % | most-words 39.1 % / 33.3 % (+5.8) |
| `r.iterators-ownership` | 10 | 40 | 10 (25.0 %) | 19 | 2nd-longest 25.1 % / 25.0 % | fewest-words 39.6 % / 32.9 % (+6.7) |
| `r.closures-collections` | 8 | 33 | 8 (24.2 %) | 18 | 2nd-longest 25.4 % / 25.0 % | most-words 41.9 % / 33.3 % (+8.6) |
| `r.smart-pointers` | 10 | 38 | 9 (23.7 %) | 21 | stem-overlap 25.8 % / 25.0 % | 2nd-longest 40.2 % / 33.3 % (+6.9) |

- These rows count three dual-tagged snippets in both of their pools: `parent-upgrade` (E+S), `router-choose` (I+E) and `box-next-block` (S+E).
- For comparison, the tightest legacy fix pool is `fix.slices` at +10.3, and the gate is +15 (`item-cues.ts:23`).

---

## 4. Content: the four reading groups

The groups are `reading-enums`, `reading-iter`, `reading-closures` and `reading-pointers`, in `src/data/rust-items/snippets/`. Their source is `sr/rustc-final/snippets/` in the orchestrator's scratchpad, ported verbatim (SR-D24).

### 4.1 Content rules (reader voice)

1. List reading KCs only. A legacy KC would add units to a legacy pool and drift its row.
2. Use no `permission` or `focus` labels (`compile.ts:170` would join the shared pool).
3. Write the whys in plain words: owns, lends, moves, hands back, handle, count. No R/W/O vocabulary.
4. **No fix calls `.clone()` on an `Rc`, `Arc` or `Weak`.** There it is a correct handle copy, and the clone lure (`constants.ts:97`) would mislabel it. Handle copies are written `Rc::clone(&x)`.
5. Exactly one fix compiles and keeps behaviour. Every other compiling fix is a labelled lure whose why says what changes. If a variant's fixes would admit a second right answer, it stays verdict-only. Example: `request-state-held/new-state`, where `_ => 0` keeps behaviour.
6. No wrong fix may fail without an error code. rustc's codeless "lifetime may not live long enough" would print "rustc reports none".
7. Every serving object comes from a host lesson. Make no claim about a named project unless the host lesson makes it.
8. Balance fix texts against the cue gate (`scripts/item-cues.ts:23, 211-238`).
   - No option may be the only one with, or the only one without, a semicolon, a parenthesis, 2 or more commas, an absolute word (`None` counts) or an acronym (`MAX` counts).
   - Key length ranks should be roughly even. The key may be strictly longest in at most 30 % of instances (`scripts/verify-generators.ts:50`).
9. **One code per failure** (SR-D25). A failing variant, and every wrong fix, makes rustc report exactly one distinct error code. A second code would be a true answer that the verdict marks wrong.

### 4.2 The snippet plan (36 snippets; every one confirmed by rustc 1.96.0, edition 2024 [proto])

**How to read the table.**
- Every variant is a **verdict** unit in the pool of each of its snippet's KCs.
- A variant in **bold** also carries a **fix** set, which counts as one fix unit per KC. The brackets name the ok fix, then the wrong fixes with rustc's outcome. `(other)` and `(clone)` mark labelled lures.
- Outcomes are rustc's recorded `code@line`.
- KC letters: E = enums-option-result, I = iterators-ownership, C = closures-collections, S = smart-pointers.

| # | id (group) | KC | Serving context | Rust point | Variants: rustc 1.96.0 outcome [fix set] |
|---|---|---|---|---|---|
| 1 | `alloc-option-admit` (enums) | E | BlockPool: t5.l5 `block_manager.py`, where `alloc` raises `OutOfBlocks` | `Option` for an empty pool; `?` returns `None` early | base compiles; **no-q E0308@15** [ok question; unwrap(other) compiles, some-q E0277]; **ok-or-q E0277@13** (replaces `ret-vec`, SR-D25) [ok question; wrong fixes authored by SR-04, each failing with one code or a labelled lure]; **shared-self E0596@5** [ok mut-self; clone-pop(clone) compiles, none(other) compiles] |
| 2 | `translate-get-match` (enums) | E | KvBlockTable: t5.l5 block tables; lab 02 `translate` | `get` returns `Option`; `match` must cover `None` | base compiles; **drop-none E0004@2** [ok none-max; none-zero(other) compiles, some-max E0004]; **index E0308@3** [ok get; ref-index E0308, some-index E0614]; no-deref E0308@3 |
| 3 | `request-state-held` (enums) | E | Request: t5.l7 request states (waiting, running, preempted) | an `enum` state; exhaustive `match` | base compiles; new-state E0004@8; **no-deref E0308@9** [ok deref; one(other) compiles, tuple E0164]; dup-arm E0004@8 |
| 4 | `push-hands-back` (enums) | E | AdmissionQueue: t5.l7 admission, a full queue | `Option` hands ownership back to the caller | base compiles; **use-moved E0382@13** [ok bind-back; fake-id(other) compiles, none-r E0004]; **drop-none E0004@11** [ok none; wild(other) compiles, none-b E0425]; bool-ret E0308@5 |
| 5 | `sync-channel-offer` (enums) | E | AdmissionQueue: t5.l10 full-channel spiral; t5.l7 admission | `try_send`'s error carries the request back; every case named | base compiles; **use-moved E0382@10** [ok bind-back; drop-it(other) compiles, fresh E0382]; **drop-disc E0004@8** [ok disc-back; err-any(other) compiles, disc-r E0382]; blocking E0308@10 |
| 6 | `admit-two-pins` (enums) | E | Lease: t6.l9 `unified_pager.rs` `admit` | `Result` + `?`: an early return, not a rollback | base compiles; **ok-q E0277@13** (replaces `option-ret`, SR-D25) [ok question; wrong fixes authored by SR-04, each failing with one code or a labelled lure]; **string-err E0277@13** [ok pressure-err; unwrap E0277, box-err E0277]; **no-q E0308@15** [ok question; ok-a E0308, pin-ref E0308] |
| 7 | `slot-take` (enums) | E | Scheduler: t5.l7 preemption, evicting a slot | `Option::take` through `&mut` | base compiles; **move-out E0507@8** [ok take; clone(clone) E0599, ref E0308]; **shared E0596@8** [ok mut; none(other) compiles, take-spelled E0596]; as-ref E0308@8 |
| 8 | `utf8-ready` (enums) | E | Tokenizer: t5.l2 streaming detokenization callout | `from_utf8` returns `Result`; arms give one type | base compiles; **ok-raw E0308@7** [ok some; owned E0308, q E0308]; **drop-err E0004@6** [ok err-none; empty(other) compiles, ok-none E0308]; str-ret E0308@7; **owned-from E0308@6** [ok str-from; to-vec E0308, deref E0308] |
| 9 | `parent-upgrade` (enums) | E+S | PrefixCache: t5.l6 radix tree, a node's parent | `Weak::upgrade` is an `Option`; data behind `Rc` is shared | base compiles; **no-upgrade E0308@10** [ok upgrade; get E0599, some-weak E0609]; **drop-none E0004@9** [ok none-zero; wild-one(other) compiles, none-len E0425]; **move-out E0507@10** [ok len; clone-ids(clone) compiles, drain E0596] |
| 10 | `router-choose` (enums) | I+E | Router: t5.l6 `prefix_router.rs` | `min()?`; a lazy chain that `max_by_key` runs; its `Option` comes from the signature (SR-D26) | base compiles; **unwrap-tail E0308@9** [ok keep-option; unwrap-or E0308, some-and E0308]; **worker-out E0308@9** [ok index; hit(other) compiles, deref E0308]; own-workers E0308@9 |
| 11 | `free-list-sum` (iter) | I | BlockPool: t5.l5 free queue; lab 02 conservation check | `for b in &v` lends; `for b in v` moves | base compiles; **into-iter E0507@8** [ok borrow; clone(clone) compiles, mut-ref E0277]; **drain E0596@8** [ok borrow; mut-pool(other) compiles, mut-ref E0277]; sort-first E0596@7 |
| 12 | `batch-ids-loop` (iter) | I | Batch: t5.l7 batch bookkeeping | a loop that consumes vs one that lends | base compiles; **by-value E0382@10** [ok borrow-loop; drain E0596, clone-loop(clone) E0599, mut-ref E0596]; iter-mut E0596@7; **push-ref E0308@10** [ok push-id; push-ref-ref E0308, push-deref E0308] |
| 13 | `live-ids-chain` (iter) | I | Batch: t5.l7 / t6.l8 running set | adapters are lazy until `collect` | base compiles; **lazy-rev E0308@7** [ok collect; rev-collect(other) compiles, collect-refs E0277]; **owned-items E0277@10** [ok id; ref-id E0277, same E0277]; iter-mut E0596@7 |
| 14 | `reap-finished` (iter) | I | Scheduler: t5.l7 loop step 4, freeing the finished | no `retain` while `iter()` still lends the list | base compiles; retain-in-loop E0502@7; **extend-move E0507@7** [ok extend-ref; clone(clone) compiles, append E0596]; **into-run E0382@10** [ok iter; drain(other) compiles, deref E0507] |
| 15 | `matcher-step` (iter) | I | Sampler: t6.l8 grammar matchers per token | `iter_mut` to advance; a clone advances a copy | base compiles; **iter E0596@14** [ok iter-mut; clone-step(clone) compiles, cloned-iter(other) compiles]; **shared-slice E0596@13** [ok mut-slice; iter E0596, to-vec(other) compiles]; move-out E0507@14 |
| 16 | `admissible-count` (iter) | I | Batch: t5.l7 admission count | a `filter` chain borrows until it runs; `&&u32` items | base compiles; push-early E0502@3 (`count-late` dropped, SR-D25); **no-deref E0308@2** [ok deref-twice; deref-once E0308, strict(other) compiles] |
| 17 | `batch-drain` (iter) | I | Batch: t5.l7 waiting queue to batch | `drain(..k)` moves the head out; indexing cannot | base compiles; **index-move E0507@8** [ok drain; ref E0308, split-off(other) compiles]; **shared E0596@8** [ok mut-queue; take-refs E0277, mut-binding E0596]; owned E0596@8 |
| 18 | `decode-step` (iter) | I | Batch: t5.l7 one decode step | `iter_mut`, then `retain` after the loop | base compiles; **iter-shared E0594@7** [ok iter-mut; no-step(other) compiles, mut-binding E0594]; **by-value E0382@9** [ok iter-mut; shared E0594, drain(other) compiles]; retain-inside E0499@7 |
| 19 | `prune-finished` (iter) | I | AdmissionQueue: t5.l7 admission queue | `into_iter` moves items; `iter` lends them | base compiles; **iter-refs E0277@9** [ok into-iter; drain E0596, iter-mut E0277]; count E0308@7; **borrow-q E0277@9** [ok owned; mut-ref E0277, slice E0277] |
| 20 | `pair-counts-entry` (closures) | C | Tokenizer: t5.l2 `bpe.py` pair counts | a `HashMap::entry().or_insert()` counter | base compiles; **no-mut E0596@9** [ok mut-map; insert-one E0596, ref E0308]; **ref-return E0308@11** [ok owned-return; static-ref E0308, mut-ref E0308]; key-ref E0308@9 |
| 21 | `bump-closure` (closures) | C | Tokenizer: t5.l2 token tally | a closure holds `&mut` of what it changes while it lives | base compiles; peek-in-head E0502@8; **not-mut E0596@9** [ok mut-bump; move-bump E0596, ref-call E0596]; **len-in-loop E0502@9** [ok call-only; clone-map(clone) E0502, drop-bump E0382]; **move-closure E0382@11** [ok borrow; move-no-mut E0596, take-back E0382] |
| 22 | `admit-policy-fnmut` (closures) | C | Scheduler: t5.l7 / lab 06 policy `F: FnMut` | a closure that spends a budget is `FnMut` | base compiles; **fn-bound E0594@11** [ok fnmut; fnonce E0382, no-spend(other) compiles]; **no-mut-param E0596@3** [ok mut-f; fn-f E0594, fnonce E0382]; **no-mut-budget E0594@11** [ok mut-budget; no-spend(other) compiles, deref E0614] |
| 23 | `sort-by-team` (closures) | C | Scheduler: t5.l7 waiting-queue order | comparator closures are lent the items | base compiles; **key-owned E0507@7** [ok cmp; clone-key(clone) compiles, by-id(other) compiles]; **shared-vec E0596@7** [ok mut-vec; slice E0596, mut-binding E0596]; owned-vec E0596@7 |
| 24 | `hit-scorer` (closures) | C | Router: t5.l6 router scoring by cached hits | a closure borrows the map until its last use; `move` | base compiles; score-after E0502@11; **move-closure E0382@11** [ok borrow; clone-map(clone) compiles, move-sum E0382]; **shared-map E0596@11** [ok mut-map; mut-binding E0596, clone-insert(clone) compiles] |
| 25 | `spawn-sum-batch` (closures) | C | Worker: a worker thread for a batch | a `move` closure to a thread; `JoinHandle` is not the value | base compiles; **no-move E0373@4** [ok move; clone-sum(clone) E0373, ref-closure E0373]; use-after E0382@7; **handle-tail E0308@7** [ok join; join-ok E0308, thread E0308] |
| 26 | `p99-sort-floats` (closures) | C | Metrics: latency window p99 (T7 SLOs) | a comparator closure; `f64` has no total order | base compiles; **plain-sort E0277@2** [ok total-cmp; key E0277, reverse(other) compiles]; sort-key E0277@2; **partial E0308@2** [ok total; partial-q E0277, reverse(other) compiles] |
| 27 | `tenant-usage` (closures) | C | Scheduler: t5.l2 token economics, tokens per tenant | a map keyed by `&str` borrows; `entry` | base compiles; **key-owned E0308@11** [ok as-str; clone-key(clone) E0515, by-len E0308]; **no-mut E0596@8** [ok mut; ref E0308, mut-r E0596]; ret-owned E0308@11 |
| 28 | `arc-block-share` (pointers) | S | BlockPool: t5.l5 `share()`, a refcounted prefix block | `Arc::clone` bumps a count; shared data is read-only | base compiles; **bump-field E0594@10** [ok arc-count; mut-handle E0594, get-mut E0596]; **deep-copy E0507@9** [ok handle; arc-of-arc E0308, deep(clone) E0599]; own-param E0308@9 |
| 29 | `prefix-node-share` (pointers) | S | PrefixCache: t5.l6 radix nodes share KV | `Rc::clone` makes a second handle | base compiles; **move-twice E0382@11** [ok rc-clone; fresh(other) compiles, deref E0507]; **deref-copy E0507@10** [ok rc-clone; rc-of-rc E0308, borrow E0308]; write-shared E0594@11 |
| 30 | `plan-to-worker` (pointers) | S | Worker: t5.l10 a Rust data plane | `Rc` is not `Send`; `Arc` is; `move` | base compiles; **rc E0277@8** [ok arc; ref E0521, rc-arc E0277]; **no-move E0373@8** [ok move; const(other) compiles, typed E0373]; ref-plan E0521@8 |
| 31 | `pool-handle-thread` (pointers) | S | BlockPool: a worker's handle to the block pool | `Arc<Mutex<_>>`: one handle per thread | base compiles; **rc E0277@8** [ok arc; box E0277, rc-vec E0599]; **no-clone E0521@8** [ok handle; borrow E0597, guard E0599]; no-move E0373@8 |
| 32 | `cow-block-table` (pointers) | S | KvBlockTable: t5.l5 copy-on-write after a fork | `Rc::make_mut` copies on first write | base compiles; **push-shared E0596@12** [ok make-mut; to-vec(other) compiles, deref E0596]; **move-out E0507@8** [ok rc-clone; empty(other) compiles, deref-clone E0308]; shared-grow E0596@12 |
| 33 | `weights-to-workers` (pointers) | S | ModelWeights: one copy of the weights for N workers | one `Arc::clone` per worker | base compiles; **move-arc E0382@10** [ok arc-clone; downgrade E0609, into-inner E0609]; **no-move E0373@11** [ok move; ref E0373, plus-zero E0373]; ref-weights E0308@10 |
| 34 | `lease-returns-blocks` (pointers) | S | Lease: t6.l9 / lab 02 lease | `Drop` with `&mut self`: append, not move | base compiles; **extend-move E0507@11** [ok append; clone(clone) compiles, push E0308]; **no-mut-guard E0596@11** [ok mut-guard; expect E0596, no-unwrap E0599] |
| 35 | `fork-block-handles` (pointers) | S | KvBlockTable: t5.l5 beam fork shares every block | `map(Rc::clone)`: handles, not blocks | **owned-blocks E0277@8** [ok handles; move-blocks E0507, borrowed E0277]; **by-ref E0277@8** [ok map-clone; rc-new E0507, downgrade E0277]; deref-block E0277@8 |
| 36 | `box-next-block` (pointers) | S+E | KvBlockTable: a chained block table | `Option<Box<_>>` behind `&`: `as_ref` | base compiles; **move-next E0507@7** [ok as-ref; unwrap-deref(other) compiles, clone-ref(clone) E0277]; unbox E0507@7; **take-next E0596@7** [ok as-ref; mut-block(other) compiles, deref E0507] |

**Totals [proto], before SR-D25's edits** (SR-04 re-measures them: one verdict unit fewer in `r.iterators-ownership`, and the two replacement variants keep E0277 and their fix sets).
- 36 snippets, 144 variants and 229 fixes. 35 bases compile. `fork-block-handles` has no compiling base, following the precedent of the lifetimes group's header (`snippets/lifetimes.ts:12-15`).
- Snippets per new code: E0004 6, E0277 8, E0308 20, against a floor of 3 (`museum.ts:27`).
- The bank after: 198 snippets, 802 variants (280 labelled, 261 with fixes) and 24 codes. The quota is 198/802 = **24.7 %**, inside the 20–30 % band (`verify-rust-items.ts:37`).

**Teaching points the content must get right:**
- `admit-two-pins`' base why says what the code does: "Each `?` hands a `Pressure` to the caller at once. If the second pin fails, `a` is dropped on the way out, and `Lease` has no `Drop`, so its 4 pages stay taken: `?` returns early, it does not undo."
- `router-choose` (SR-D26):
  - Its base why ends: "`min()` gives `None` for an empty fleet, and `?` returns it at once. The chain does nothing until `max_by_key` pulls it through. `max_by_key` answers with an `Option` because a chain may yield nothing; here the least-loaded worker always passes the guard, so it is `Some`."
  - The `unwrap-or` fix's why reads: "That gives a plain `usize`, and the function promises an `Option<usize>`."
  - SR-04 re-checks the cue balance of that fix pool after the edit.

---

## 5. Delivery to serving-first learners

### 5.1 The path (unchanged steps; blocks inside them)

`pathPlan('serving-first')` keeps 29 steps and 785 declared minutes (`paths.ts:292-295`; `tests/learner/paths.test.ts:236-246` stays untouched).

| Step | Lesson (minutes; cumulative) | Block |
|---|---|---|
| 5 of 29 | t5.l2 Tokenization & BPE (20; 125) | B1 |
| 8 | t5.l5 PagedAttention Deep Dive (25; 195) | B2 |
| 9 | t5.l6 Prefix Caching (30; 225) | B3 |
| 10 | t5.l7 Continuous Batching (25; 250) | B4 |
| 13 | t5.l10 The Production Stack (35; 340) | B5 |
| 21 | t6.l8 Agents, Structured Output, and Cache Locality (25; 565) | B6 |
| 22 | t6.l9 Multi-LoRA Serving (30; 595) | B7 |

The estimate for finishing every block:
- The seven blocks together take 16 correct answers (2 + 3 + 3 + 2 + 2 + 2 + 2).
- At the nominal 30 s per verdict and 45 s per fix (`compile.ts:57`), plus reading and misses, that is about 15–18 minutes.
- No `minutes` field changes (SR-D13).

### 5.2 The `reading` block and `ItemBlock`

**The block type** goes in `src/data/lessons/types.ts`, after `ItemBlock`, and joins the block union:

```ts
/** Serving-first Rust reading (docs/specs/serving-reading.md): compile-bank items on R KCs this lesson needs. */
export interface ReadingBlock {
  type: 'reading'
  /** "Read it in Rust: the block manager" */
  title: string
  /** One to three sentences (Markdown) tying the block to the code or idea above it. */
  lead: string
  /** Block-only compile variants, kinds interleaved; the first `count` cover every KC the host's direct edges name. */
  variants: string[]
  /** Correct answers on distinct fresh seeds that finish the block. */
  count: number
}
```

**The renderer.** `src/pages/lesson/blocks.tsx` gains `case 'reading'` next to `case 'item'`.
- It renders `lead` with the prose renderer, then the lazy `ItemBlock`.
- `ItemBlock` gets `block` = the derived item spec `{ type: 'item', title, family: 'compile', variants, count, predict: false }`, `blockIndex={lesson.blocks.indexOf(block)}` and `reading`.
- The item spec is derived once per `ReadingBlock` object, through a module-level `WeakMap` (SR-D22).
- `predict: false`, because a choice item's prediction is just its first pick (`item-block.ts:251-312`).
- `item-block.ts` itself is unchanged.

**`src/components/blocks/ItemBlock.tsx`** imports `settle` from `on-demand.ts` and changes as follows.
1. **Cold load.** `nextStage` becomes async. It takes the draw number before awaiting (`const d = draw.current; draw.current += 1`), then plans with `await settle(() => planItem(g, block, evs, sessionSeed, d))`. The restore branch also runs under `settle`.
   - The draw counter moves once per plan, outside the rerun work, so a plan stays a pure function of `(sessionSeed, draw)`.
   - It works because `want` records the load before `makeAt` swallows the throw (`on-demand.ts` `want`; `item-block.ts:212-216`). One run collects the groups that all of `planItem`'s seed tries (at most 32) want, so a block settles in two runs.
   - The same fix covers a future item block on `step`, whose calibrated part also loads through `want` (S5-D79).
2. **Retry.** The `broken` stage gains the "Try again" button that the `error` stage has.
3. **Visit token.** `more` becomes async with a visit token, so a slow load can never overwrite a newer stage. The load effect awaits under its `live` guard.
4. **Compile copy** applies only when `block.family === 'compile'`. Other families keep their copy.
   - The eyebrow reads "another snippet · n/m".
   - `nextLabel` and the buttons read "Another snippet".
   - The idle line reads "{count} read right on new code. Done. There are always more."
5. **Off-path collapse.** When `reading` is set and the block is fresh (no answer yet), the effect reads `pathOf(deps.working['boot:path'])` (`paths.ts` `pathOf`, which falls back to `DEFAULT_PATH`). If the path is not `serving-first`:
   - the block starts in a new `offpath` stage: "Rust Zero covers this on your path. Practice anyway?", with a "Practice anyway" button that calls `more`;
   - nothing is written until the learner opens it;
   - the header's status stays empty in `offpath`, as it does in `expert`, so the collapsed block is one line;
   - this check comes before the existing expert collapse.
6. **Attribute.** `data-block` is `reading` for reading blocks and `item` otherwise, so the e2e selectors (`e2e/item-block.spec.ts:8`) stay unambiguous.

**Export.** `scripts/export-lessons-md.ts` gains `case 'reading'` beside `'item'`:

```
**Rust reading: <title>**

<lead>

_Read short Rust in the lesson: name rustc's verdict or the one-line fix._
```

This regenerates seven `public/lessons-md` files. `llms.txt` is unchanged, because no title or hook changes.

### 5.3 The seven blocks

**Positions.** Each block goes after every index-keyed block of its host and before the quiz. The index-keyed blocks are:
- diagram predictions (`dia:` refs, `src/lib/kc/resolve.ts:114`);
- item blocks (`grp` = `lessonId#blockIndex`);
- Fleet exercises (keyed by block index; sim exercises key on task ids).

Protégé and isomorphism blocks key on their ordinal, not their index (`protege.ts:44`, `iso.ts:38-50`).

| Block | Host @ index (keyed blocks before it) | Title | Variants (count) | First `count` draws cover | Lead (exact text) |
|---|---|---|---|---|---|
| B1 | t5.l2 @3, right after `bpe.py` at 2 (none keyed) | Read it in Rust: the pair counter | `verdict.closures-collections`, `fix.enums-option-result`, `fix.closures-collections`, `verdict.enums-option-result` (2) | C verdict, E fix | "The pair counter above, in Rust: a `HashMap` keyed by the pair, where `entry(p).or_insert(0)` finds or adds a count and lends it for changing. A tokenizer's bytes can also stop mid-character, and Rust says so with a `Result`." |
| B2 | t5.l5 @6, right after `block_manager.py` at 5 (diagram 3) | Read it in Rust: the block manager | `verdict.enums-option-result`, `fix.smart-pointers`, `verdict.iterators-ownership`, `fix.enums-option-result`, `verdict.smart-pointers`, `fix.iterators-ownership` (3) | E verdict, S fix, I verdict | "`alloc` above raises `OutOfBlocks`; a Rust manager returns an `Option` instead: `None` is an empty pool, and `?` hands it to the caller, which can preempt. `share` becomes a second handle to the block (`Arc::clone`), which bumps a count and copies no KV." |
| B3 | t5.l6 @8, right after `prefix_router.rs` at 7 (diagram 4) | Read it in Rust: the router | `verdict.iterators-ownership`, `fix.closures-collections`, `verdict.enums-option-result`, `fix.iterators-ownership`, `verdict.closures-collections`, `fix.enums-option-result` (3) | I verdict, C fix, E verdict | "`choose_worker`'s main chain is one expression. `enumerate` and `filter` only describe the work; `max_by_key` runs it and answers with an `Option`, since a chain may yield nothing, and `unwrap_or_else` runs its fallback only on `None`. The closures borrow what they read (`guard`, `workers`)." |
| B4 | t5.l7 @5, after the scheduler-loop prose at 4 (play 2, diagram 3) | Read it in Rust: admission | `verdict.enums-option-result`, `fix.enums-option-result` (2) | E verdict, E fix | "The headroom dial above admits a request only when free blocks cover its prompt plus room to decode. In Rust that answer has a type: an allocator returns `Some(block)` or `None`, a full queue hands the request back inside `Some`, and every `match` must say what each case means before the code compiles." |
| B5 | t5.l10 @7, after the comparison table at 6 (none keyed) | Read it in Rust: the data plane | `verdict.smart-pointers`, `fix.smart-pointers` (2) | S verdict, S fix | "The table lists Dynamo's core as Rust. A data plane hands shared state to worker threads, and its types say what may cross: an `Arc` handle may, an `Rc` may not, and `Arc::clone` copies a handle, never the data behind it." |
| B6 | t6.l8 @4, after "The token mask is not a string mask" at 3 (item 2) | Read it in Rust: the mask walk | `verdict.iterators-ownership`, `fix.iterators-ownership` (2) | I verdict, I fix | "A mask walks the vocabulary and asks each grammar matcher about every token. How the walk borrows decides what it may do: `iter` lends each item for reading, `iter_mut` for changing, and a chain of adapters does nothing until something like `collect` runs it." |
| B7 | t6.l9 @8, right after `unified_pager.rs` at 7 (item 4) | Read it in Rust: admit | `fix.enums-option-result`, `verdict.enums-option-result` (2) | E fix, E verdict | "`admit` returns `Result<Lease, Pressure>` and uses `?` twice. Each `?` hands a `Pressure` back at once; if the second fails, the adapter pinned on the line before is dropped on the way out, and whether its pages return depends on that drop, which the code does not show." |

**A block draws from its KC's whole pool.** Its items are not limited to the code above it, so an early host can show a `Weak` or `Box` snippet before B2 teaches smart pointers (accepted, §11). The leads therefore describe the Rust idea at that point of the page. They never say the items below are "this code".

**Checks the task makes:**
- The index columns are the design's reading at `00d0c0a`. SR-06 re-reads each host and keeps the rule (after every keyed block, before the quiz). If a host changed, it records the actual index.
- Every lead's claim about the page above it is checked against that page. B3 follows `prefix-caching.ts:158-169`, and B7 follows `multi-lora-serving.ts:132-142`.
- Variant order interleaves the kinds, so wherever a block teaches more than one draw, its first `count` draws reach a fix (round-robin at `item-block.ts:227`).

### 5.4 Today, Up Next, Boot, placement, /me

**Today:** unchanged by design (SR-D5, SR-D17). A serving-first learner has no R cards (`cards.ts:382-389`), and reading variants are invisible to the composer.

**Up Next:** unchanged. There is no new `RecommendationKind`, because the hosts are already steps.

**Boot:**
- The blurb changes (§5.5).
- The first-lesson line is unchanged, and its pins stand: `tests/boot/you-path.test.ts:42-50` and `e2e/boot.spec.ts:236-263`.

**Placement result:** the anchor line becomes path-aware for serving-first (§5.5). Today it tells that learner that R lessons are braided in or offered as test-outs, and neither is true on this path.

**/me:** reading answers are fresh `gen:` items with provenance `unseen`.
- They count toward the R KC's competence line under the existing rule (Q7).
- For a serving-first learner, no card, VRK30 check or cold check comes from them.
- On the other paths, an answer on an R KC that already has a card reviews that card, as every item block does (`cards.ts:375-379`; SR-D29, §6.1).

### 5.5 Copy (exact strings)

| File | Now | New |
|---|---|---|
| `src/pages/boot/You.tsx:14` | "Two Track 0 lessons and the roofline (T4.L3), then batching, the KV cache and engines (T5 to T7). Rust Zero is not on this path; its lessons stay open in the Curriculum." | "Two Track 0 lessons and the roofline (T4.L3), then batching, the KV cache and engines (T5 to T7). Rust Zero is not on this path: Rust arrives as short reading items inside the T5 and T6 lessons that use it, and Rust Zero stays open in the Curriculum." |
| `tests/learner/recommend.test.ts:502-507` | forbids "Rust arrives as short reading items" | moves it to `said` and keeps "Rust Zero is not on this path". Adds an assertion that `readingCoverage()` (exported by `tests/kc/reading-blocks.test.ts`) passes and that every host is a T5 or T6 lesson, so the blurb and the blocks cannot drift apart. |
| `src/lib/learner/paths.ts:17-20` (header comment) | "… R is not on this path, and nothing serves its lessons as reading items either (PR 16 found none) …" | "`serving-first`: t0.l1, t0.l2, t4.l3, T5, T6, T7 (785 declared minutes). R lessons are not steps: Rust arrives as compile-bank reading items, `reading` blocks inside t5.l2, t5.l5, t5.l6, t5.l7, t5.l10, t6.l8 and t6.l9 (docs/specs/serving-reading.md). Labs are optional, so they are not steps. A registered play is a step after its host lesson (the scheduler play after t5.l7), on every path that has the host." |
| `src/components/learner/PlacementWalk.tsx` (`ANCHOR_LINE`; `Result` already receives `path`) | path-blind | `anchorLine(rustAnchor, path)`. On serving-first: **solid** "Rust reading: solid. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6."; **missed** "Rust reading: not yet. That is fine on this path: short reading items inside T5 and T6 cover the Rust those lessons use, and Rust Zero stays open in the Curriculum."; **skipped** "Rust reading: not asked. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6." Other paths keep today's lines. |
| `src/lib/learner/placement.ts:86`, `src/lib/learner/recommend.ts:208-209`, `src/components/learner/PlacementWalk.tsx:10` (comments) | "R arrives as reading items only" | "R arrives as `reading` blocks inside T5 and T6 lessons, never as R lessons (serving-reading.md)" |

No learner copy names a persona.

---

## 6. Effects on other paths, KCs, the ledger and metrics

### 6.1 The other two paths

| Surface | Full ramp | Rust systems |
|---|---|---|
| Plan, steps, minutes, braid, test-outs | none: no `requires`, `Lesson.kcs` or `Kc.lessons` edit, so `needEdge` sees the same graph | none |
| The 7 host lessons | one collapsed line each; nothing written unless opened | not on the path; the same collapsed line if opened from the Curriculum |
| If opened | items like any item block: `src: 'lesson'`, staircase per (R KC, compile), competence evidence, and a card review if an R card exists | same |
| Today, extra, cold checks, VRK30, tickets, spirals, walk, forms, Museum | no new draws (I2–I4). A reading answer on a KC that already has a card reviews it: its due day, the optimism offset and the recent-item window move, as with any item block. It counts as a VRK30 check when it falls 30 or more days after the card's creation (SR-D29). | same |
| K3 ("nobody placed lands on R.L1") | none: items write no `lesson:` ref | none |

### 6.2 KCs

- The four KCs gain `gen: ['compile']`, and `COMPILE_KCS` (`compile.ts:64`) gains `...READING_KCS`.
  - `verify:kc`'s agreement check holds (`scripts/verify-kc.ts:316-323`).
  - The compile family then covers 12 KCs.
- There are still 155 KCs. No KC, title or `##` heading is added, so the ⌘K index is unchanged.
- A serving-first learner's state on the four KCs is a staircase level and competence evidence only. There is no card, so there is no Today, VRK30 or cold check.

### 6.3 Ledger

- A reading block writes `item` events:
  - the ref is `gen:compile/<verdict|fix>.<kc without the r. prefix>` (`compileVariantId`), for example `gen:compile/verdict.enums-option-result`;
  - the data is `{ src: 'lesson', lessonId, grp: '<lessonId>#<blockIndex>', kcs: ['r.…'], level, variant }` (`item-block.ts:320-329`).
- Provenance is `unseen` on a fresh seed. There is no `predict` event.
- There is no new `ItemSrc`, no new ref grammar and no schema bump (`SCHEMA_VERSION` stays 6).

### 6.4 Metrics

| Metric | Effect | How it is held |
|---|---|---|
| H3 hint ladders (signed) and #20's hint and Daily secondary outputs | none | SR-D16, SR-D23; M0 |
| The R form blueprint, and the parallelism of forms A/B/C | none | the `optionsOf` filter; I2 |
| VRK30, cold checks, the Today mix, "Keep going" order | no new draws; reading answers on carded R KCs count as reviews and checks, as every item block's do (SR-D29) | SR-D5; I4 |
| Error Museum exhibits and practice draws | none | SR-D8; I3 |
| The compile hash fixture | 15 rows identical, 8 new | SR-D6, SR-D12; I1 |
| K3 | none | no `lesson:` refs |
| /me competence lines for R KCs | can appear for serving-first learners (new, intended) | Q7 |
| XP and the week bar | each answer adds its `nsec` (`fold.ts:174-186`) | as every item block |

---

## 7. Gates and budgets

Each row gives the base (measured at `00d0c0a`) and the expected figure after ([proto] unless marked projected).

| Gate | Base | After | Rule |
|---|---|---|---|
| `verify:rust-items` | 4 groups, 162 snippets, 658 variants, 21 codes, 0 problems; quota 24.8 % | 8 groups, 198 snippets, 802 variants (280 labelled, 261 with fixes), 24 codes, **0 problems**; quota **24.7 %** | 20–30 % |
| per-KC "compiles" | max 27.3 % (`r.analyzer-limits`) | new pools 23.7–25.0 %; legacy unchanged | at most 30 % |
| per-code floor | four codes at 3 | E0004 6, E0277 8, E0308 20; no legacy code loses a snippet | at least 3 |
| phone limits | — | 0 violations over 144 variants and 229 fixes | 16 lines × 44 columns, ASCII |
| `build-rust-items --check` (CI `labs.yml`) | 2.2 s | 8 groups, 198 snippets, **2.7 s**, ok | rustc 1.96.0, edition 2024 |
| `verify:generators --family compile` | 15 variants, 0 problems | **23 variants, 0 problems**; 15 legacy rows identical; 8 new rows | hash, cue ≤ chance + 15 (content target + 10), V1 ≤ 30 %, odd-one-out 0, distinct |
| `Gen.bank.units` | 16 | **16** | each reading pool ≥ 16 |
| `museum.json` | 21 exhibits | **byte-identical** | SR-D8 |
| `verify:kc` | 155 KCs | 155; `Gen.kcs` equals `Kc.gen` | — |
| `verify:items` | lessons pool 1.81 of 2.0; primm 39.3 % of 40 % | unchanged (projected): a `reading` block is in no authored pool | — |
| `verify:search-index` | 19.7 KB | byte-identical (projected): no `##` heading, KC or title | 20 KiB |
| bundle: entry | 349,812 B raw | **+0 B raw** | S5-D50 |
| bundle: `/boot`, `/today`, `/errors` | 170.8 / 190.1 / 160.9 KB | unchanged; `/boot` about +0.05 KB with the blurb (projected) | at most 200 KB, gated |
| bundle: compile family | 6.0 KB | **6.8 KB** (manifest + legend) | 8 KB report, not gated |
| bundle: bank data | 72.9 KB in 4 chunks | **96.1 KB in 8 chunks** (reading-enums 7.3, -pointers 5.5, -iter 5.2, -closures 5.2 KB) | 30 KB figure: a warning, not gated. "No chunk holds bank data" stays gated and passes. |
| bundle: lesson chunks, `ItemBlock` | — | about +0.3 KB per host; `ItemBlock` about +0.4 KB (projected) | not gated |
| SW precache | — | +4 group chunks; the build id changes | `tests/sw/manifest.test.ts` passes as written |
| determinism | — | `settle` reruns are deterministic; the draw counter moves outside them | `verify:determinism` |
| a11y | — | `/lesson/t5.l5`, `/lesson/t6.l9` and `/boot` at 360, 320 and 1280 px | 0 serious, no sideways scroll, targets ≥ 44 px |

**Tests whose pins move.** On a 21-file run of the prototype, 7 tests failed and 752 passed. The full suite on the prototype also fails `tests/learner/on-kc.test.ts:101-120` and `tests/learner/reentry.test.ts:187-218` (the latter through `tests/learner/ledger-gen.ts:74`) until SR-D27's filters land. SR-04 runs the whole suite, not a subset.
- `tests/items/compile.test.ts:143-153`: the seed group covers every compile KC except `r.permissions` **and `READING_KCS`**.
- `tests/items/compile.test.ts:155-161`: legacy groups serve verdict, permission and fix; **reading groups serve verdict and fix**.
- `tests/kc/graph.test.ts:248-270` and `tests/kc/verify.test.ts:80-88`: the compile list gains the four KCs.
- `tests/rust/museum.test.ts:153-154, 221-227, 230-231`: "codes the bank holds" becomes the Museum's units (non-reading). The 21 at `:145` holds.
- `tests/fixtures/items/hashes/compile.json`: +8 rows.
- `tests/learner/recommend.test.ts:502-507` (§5.5).
- `tests/learner/on-kc.test.ts:109, :130`: `offered` gains `&& !v.blockOnly`, matching `makeInstance` and `makeGenPool`. Do not loosen the `today.ts` or `ticket.ts` filters to make it pass.
- `tests/learner/ledger-gen.ts:74`: `makePool.families` applies `blockOnlyFor` (SR-D27). `reentry.test.ts` then passes unchanged.

**Tests that must not move:**
- `tests/learner/paths.test.ts:236-246` (785 minutes);
- `tests/learner/placement-r1.test.ts` and `tests/learner/placement.test.ts:782-796` (K3);
- `tests/kc/hands-on.test.ts:127-141`, `tests/kc/t6b-content.test.ts:110-115` and `tests/kc/t7-content.test.ts:110-114`;
- `tests/boot/you-path.test.ts:42-50`, `e2e/boot.spec.ts:236-263` and `e2e/item-block.spec.ts`.

---

## 8. Measurement

### M0. Nothing else moved (CI; written at the base, so it is green before any change)

`tests/items/reading-invariance.test.ts` checks the following.
1. The 15 legacy rows of `compile.json`, as literals, and `VERSION === 2`.
2. All 9 form blueprints, against `tests/fixtures/forms/blueprints.json`, captured at the base with `formBlueprint`.
3. Museum practice draws, against `tests/fixtures/items/museum-practice.json`.
   - The fixture holds `${variant}|${unit}|${rev}` for every `museum.json` code × 60 seeds, captured at the base.
   - The test also checks a sha256 literal of `museum.json`.
4. For each of the four reading KCs, `buildPool(...).families(kc)` and `makeGenPool(...).families(kc)` are `[]`. The test writes the four ids as a literal, because `READING_KCS` lands with SR-03, and SR-03 asserts that the literal equals `READING_KCS`. At the base, where the KCs have no `gen`, this holds trivially. SR-04's merge makes it bite.
5. H3. The fixture ledger holds:
   - a `rust-allocator` all-green `lab-check`;
   - armed `hint:` or `packet:` acks on `rust-allocator/boot` and on one check whose KC already has a generator. SR-04 grows `rust-allocator/boot`'s covered set from ∅ to {r.enums-option-result} (`labs.ts:509`; `covered` comes from `Kc.gen` in `selectHintArms` and `hint-secondary.ts`);
   - Today cold `probe`s in the 25–45-day window, one of which resolves to the legacy KC;
   - reading-block `item` events on `r.enums-option-result` in the same window.
   `selectHintArms`, `selectHintSecondary` and `selectDailySecondary` over this ledger equal literals captured at the base, with at least one arm non-empty. They also equal their own output with the reading events removed (SR-D23).

### M1. The items are where the promise says (CI and e2e)

1. **`tests/kc/reading-blocks.test.ts`** exports `readingCoverage()` and checks:
   - every direct edge of a path lesson is covered by a block in that lesson, except `DEFERRED = ['r.bindings-expressions']`, which cites Q3;
   - every block KC is in D(L) ∪ ON_PAGE(L);
   - every variant is a declared block-only compile variant;
   - the first `count` draws cover the direct-edge KCs and include both kinds;
   - every block comes after every index-keyed block and before the quiz;
   - the keyed-block indices of the seven hosts equal a frozen map;
   - the hosts are exactly B1–B7.
2. **`tests/rust/reading-groups.test.ts`** checks:
   - reading groups list reading KCs only and carry no labels;
   - no why matches `/\b(R|W|O)\b|permission/`;
   - each reading pool has at least 24 verdict units and 16 fix units, and at most 27 % "compiles";
   - `bank.units === 16`;
   - `museumEntries` and `practiceInstance` never return a reading unit.
   Rule 4 (no `.clone()` on a handle) is checked by the Opus implementer of SR-04, by reading, not by regex.
3. **`tests/learner/item-block-cold.test.ts`** checks:
   - with `forgetGroups()` (`groups.ts:122`), `planItem` alone returns null, and under `settle` it equals the warm plan;
   - a DOM test: a full-ramp working record yields the `offpath` stage and writes nothing;
   - a DOM test: the parent `RenderBlock` re-renders with the same `ReadingBlock` object after an answer is written. The `ItemBlock` load effect runs once (spy on `loadFamily`, or count `loading` stages), and the stage never returns to `loading` (SR-D22).
4. **`e2e/reading-block.spec.ts`**, at 360 and 320 px:
   - with a stored serving-first path and a cold cache, `/lesson/t5.l5` shows a Rust item, never "no question";
   - with a verdict item and then a fix item on screen, there is no sideways scroll and axe reports nothing serious;
   - the learner answers a verdict and a fix by keyboard, and the verdict is announced in `aria-live`;
   - there is no sideways scroll, and axe reports nothing serious;
   - with a stored full-ramp path, the learner sees the collapsed line, and no `gen:compile/` event is written until "Practice anyway".
   This is PLAN's F3 phone metric ("a graded Rust item on a phone").

### M2. Field: can serving-first learners read the Rust?

M2 is pre-registered in `docs/prereg/serving-reading.md`, in the draft form of `docs/prereg/protege.md` (SR-D28).
- Its Status line reads "DRAFT for the owner to sign … The drafter has not signed or dated it".
- It has sections 1–7: Question, Design, Outcome, Decision rule, Data and limits, Choices this draft makes for the owner, and Sign-off.
- Section 7 holds both signature forms: `Signed: (pending owner)`, and the Owner / Date signed / Amendments table (`protege.md:79-87`).
- The owner signs it before the release that ships SR-06 (Q11). Until `isPreregSigned` finds a signature, the report prints "NOT READ: docs/prereg/serving-reading.md is not signed" for this section, in text and in `--json`.

**The decision instrument is a think-aloud read.** It is realistic for OD10's n: PLAN-100X.md:826 says "≥8 [partners], including … ≥2 ML engineers".
- **Who and when:** at least 2 ML-engineer partners on serving-first, after t6.l9.
- **Material:** two unseen Rust files of 40–60 lines, written for the study and shaped like a block manager and an admission scheduler. Neither is copied from any project.
- **Session:** 15 minutes of think-aloud.
- **Rubric (6 questions):**
  1. What does `alloc` return on an empty pool, and who decides what happens next? (E)
  2. Here `?` fails on the second call. What is undone? (E)
  3. When does this iterator chain run, and what does it borrow? (I)
  4. What does this closure capture, and why must it be `FnMut`? (C)
  5. What does `Arc::clone` cost here? (S)
  6. Why `Arc` and not `Rc` for this handle? (S)
- **Go:** each partner scores at least 4/6.
- **Revise:** more than half of the partners score 2/6 or less (with 2 partners, both). Rewrite the pools and leads first; removal is the owner's call.
- **Otherwise:** report.

**Ledger descriptives.** Their thresholds are pre-registered too. They inform the decision and never kill anything automatically.
- **Where the code lives:**
  - The selector `selectServingReading(ledgers)` lives in `src/lib/learner/outcomes.ts`, and `scripts/partner-report.ts` prints it.
  - `outcomes.ts` holds its own literals `SERVING_READING_KCS` (the four ids) and `SERVING_READING_HOSTS` (the seven lesson ids). It imports nothing from SR-03's files. `tests/kc/reading-blocks.test.ts` (SR-06) asserts they equal `READING_KCS` and the mounted hosts.
- **Eligible learners.** One definition covers both inputs: at least one ok `quiz` whose ref is a host `lesson:` ref (`lesson:t5.l2`, `lesson:t5.l5`, `lesson:t5.l6`, `lesson:t5.l7`, `lesson:t5.l10`, `lesson:t6.l8`, `lesson:t6.l9`), plus one more condition per input.
  - **Full exports** also need `boot:path` = `serving-first`.
    - `PartnerLedger` gains `path?: LearningPath`.
    - `KEPT_WORKING` gains `'boot:path'`, which holds a path id and never free text, and the doc comments of `KEPT_WORKING` and `stripFreeText` say so.
    - `partner-report.ts` sets `path: pathOf(record('boot:path'))` next to `plan` and `placement`.
  - **Donations** keep no working path, so they use the off-R proxy instead: no event whose ref starts with `lesson:r.`. Donations keep `ref`, `ok`, `provenance`, `ms` (rounded to seconds), `dayOffset`, data `src`, `kcs` and `variant`, and a first-appearance `grp` (`src/lib/learner/redact.ts`).
  - The two inputs are reported separately and pooled under this one definition.
  - Serving-first full exports with no ok host quiz are counted and printed as "not yet at a host", and are left out of every figure.
- **Reading answers** are `item` events whose ref is one of the 8 reading refs (built with `compileVariantId`, §6.3) and whose `data.src` is `'lesson'`. No other surface can produce them.
- **Figures:**

  | Figure | Definition | Threshold |
  |---|---|---|
  | Reach | share of eligible learners with at least 1 reading answer | ≥ 0.80 |
  | Completion | share of reading `grp`s (a `grp` with at least one reading answer) that hold at least the block's `count` correct answers of provenance `unseen`. A full export reads `count` from the host block named by the answer's `data.lessonId`. A donation keeps no `lessonId`, so its `grp`s use 2, the smallest count; that figure is labelled "≥ 2 correct" and reported beside the full-export one. | ≥ 0.60 |
  | Difficulty band | per variant (KC × kind, read from the ref): each learner's first `unseen` answer on it, as k/n with `wilson(k, n)` | a pool is flagged for a rewrite when the point estimate is outside 0.35–0.85 and n ≥ 20 |
  | Later vs first | `grp`s are ordered by their first event in ledger order (`at`, then `id`), never by the `grp` string. For each learner and KC with 2 or more `grp`s, d = ok of the first answer on that KC in the last `grp` − ok of the first answer on that KC in the first `grp`. Report the mean of d over learners (each learner's KCs averaged first). | "not enough data" below 8 learners |
  | Time | median `ms` per answer | verdict ≤ 60 s, fix ≤ 90 s |
  | Clone lure | `r.clone-to-silence` rate among fix answers, **full exports only** (a donation keeps `miss` only for `confuse.` ids, so donations are left out, and the report says so) | reported |

- **If underpowered, the default is to keep.** The items are content only and fulfil a plan promise.
- **Proposed PLAN §9 keep/kill row** (the owner adds it; agents never edit PLAN): "Serving-first reading items: think-aloud ≥ 4/6 per ML-engineer partner. Default if underpowered: keep."

---

## 9. Exit

### 9.1 Build gates (CI; the owning task proves each)

| # | Gate | Owner task |
|---|---|---|
| B1 | M0 green at the base and at the tip; I1–I5 hold | SR-02, then every task |
| B2 | `build-rust-items --check`, `verify:rust-items` and `verify:generators --family compile` at 0 problems, with the pools of §3.5 | SR-04 |
| B3 | `readingCoverage()` green; B1–B7 mounted at their indices | SR-06 |
| B4 | the cold-load and off-path tests green; e2e `reading-block.spec.ts` passes 3 runs in a built tree | SR-05, SR-06 |
| B5 | the copy of §5.5, tied to the blocks by a test | SR-07 |
| B6 | entry +0 B raw; `/boot` and `/today` within 200 KB; the bundle report matches §7 within 0.5 KB per figure | SR-03 to SR-07 |
| B7 | a11y clean on `/lesson/t5.l5`, `/lesson/t6.l9` and `/boot` at 360, 320 and 1280 px | SR-06, SR-07 |
| B8 | the prereg file present, and `isPreregSigned` false on it; the report prints NOT READ; the selector's fixture figures exact when it is called directly | SR-08 |

### 9.2 Field and owner steps (never build acceptance)

- F1. The owner samples 10 snippets (precedent: wave-2.md:1224).
- F2. The owner signs `docs/prereg/serving-reading.md` (Q11), and adds the PLAN §9 row if they agree.
- F3. The think-aloud sessions (M2).

---

## 10. Task DAG

**Conventions.**
- The base is `wave-sr` at this spec's commit, which is `wave-hk` `2e0d2ce` plus this file. Every task names that sha and checks it with `git merge-base --is-ancestor`.
- Each task has its own branch `sr/<id>`, integrated level by level into `wave-sr`.
- Every task runs `bun run lint`, `bun run build`, `bun run test` and every `bun run verify:*` except `verify:seeds`, bare and never piped.
- Hours are review hours (PLAN-100X.md:674).

| ID | Title | Model | Hours | Depends | Files (all, tests included) | Acceptance |
|---|---|---|---|---|---|---|
| SR-01 | Spec | Opus (orchestrator) | 3 | — | `docs/specs/serving-reading.md` | This file. |
| SR-02 | Invariance fixtures at the base | Sonnet | 3 | SR-01 | `tests/items/reading-invariance.test.ts`, `tests/fixtures/forms/blueprints.json`, `tests/fixtures/items/museum-practice.json` (all new) | Green at the base. Flipping any fixture value fails it (shown in a scratch copy). Nothing in `src/` is touched. Covers M0 items 1–5, including SR-D23. The four reading KCs are a literal (M0 item 4). The H3 fixture follows item 5 exactly, and its literals are captured at the base. |
| SR-03 | Family, constants, block-only, legend, Museum filter (no KC links yet) | Sonnet | 6 | SR-02 | `src/data/rust-items/constants.ts`, `src/lib/items/types.ts`, `src/lib/items/core.ts`, `src/lib/learner/today.ts`, `src/lib/learner/ticket.ts`, `src/lib/learner/forms.ts`, `src/lib/items/families/compile.ts`, `src/lib/rust/museum.ts`, `src/components/rust/ErrorEntry.tsx`, `scripts/verify-kc.ts` (`genCovers` only, SR-D27), `tests/items/block-only.test.ts` (new), `tests/items/reading-invariance.test.ts` (one assertion: its literal equals `READING_KCS`) | The reference is `sr/rustc-final/proto-code.diff`, minus its `COMPILE_KCS` and `r.ts` hunks, which belong to SR-04. No behaviour moves. A synthetic block-only variant is skipped by Today, `composeExtra`, tickets, the walk, forms and `resolveVariant`, and served by `planItem`. The distractor filter and legend are scoped exactly as §3.2 says. `genCovers` ignores block-only variants, with a case in `block-only.test.ts`. SR-02 green. `compile.json` unchanged. Entry +0 B. |
| SR-04 | The four reading groups and their KC links | **Opus** | 6 | SR-03 | `src/data/kc/r.ts` (the four KCs' `gen`), `src/lib/items/families/compile.ts` (`COMPILE_KCS` only); `src/data/rust-items/snippets/reading-{enums,iter,closures,pointers}.ts` (verbatim, SR-D24); regenerated `bank/reading-*.json`, `served/reading-*.ts`, `manifest.json` (`museum.json` unchanged); `src/lib/items/on-demand.ts` (the `MAX_RUNS` comment only, SR-D21); `tests/fixtures/items/hashes/compile.json` (+8); `tests/items/compile.test.ts`; `tests/kc/graph.test.ts`; `tests/kc/verify.test.ts`; `tests/rust/museum.test.ts`; `tests/learner/on-kc.test.ts` and `tests/learner/ledger-gen.ts` (SR-D27); `tests/rust/reading-groups.test.ts` (new) | `build-rust-items --check` ok. `verify-rust-items` at 0 problems, with 198 snippets and 801 variants (the prototype's 802 minus `count-late`, SR-D25). `verify-generators --family compile` at 0 problems, with 15 legacy rows identical and 8 new ones. Pools and quotas as in §3.5, adjusted by SR-D25 and re-measured. `museum.json` byte-identical. SR-02 green, now biting on item 4. It makes SR-D25's and SR-D26's edits. It sweeps every reading variant and fix through rustc 1.96.0 (`--error-format=json`) and reports each one's distinct codes, re-editing any that break rule 9. It reads every why for rule 3 and every fix for rule 4. Its notes list each content edit, with the re-run gates, and anything it would flag. `bun run test` over all of `./tests` is green. |
| SR-05 | The `reading` block type, the renderer and `ItemBlock` | Sonnet | 6 | SR-01 | `src/data/lessons/types.ts`, `src/pages/lesson/blocks.tsx`, `src/components/blocks/ItemBlock.tsx`, `scripts/export-lessons-md.ts`, `tests/learner/item-block-cold.test.ts` (new) | A cold `planItem` is null, and under `settle` it equals the warm plan (legacy variants suffice). `broken` shows "Try again". A stale `more` never overwrites a newer stage. The compile copy shows only for `family === 'compile'`. The `offpath` DOM test writes nothing. The two-render test loads once (SR-D22). No lesson content changes, and `lessons-md` is unchanged. Entry +0 B. `e2e/item-block.spec.ts` passes in a built tree. |
| SR-06 | Mount B1–B7; coverage and e2e | Sonnet | 5 | SR-04, SR-05 | `src/data/lessons/t5/{tokenization,pagedattention-deep-dive,prefix-caching,continuous-batching,production-stack}.ts`, `src/data/lessons/t6/{agents-structured,multi-lora-serving}.ts` (the files that hold those lessons, whatever their names), `tests/kc/reading-blocks.test.ts` (new), `e2e/reading-block.spec.ts` (new), regenerated `public/lessons-md/{t5.l2,t5.l5,t5.l6,t5.l7,t5.l10,t6.l8,t6.l9}.md` | M1 items 1–4 green; e2e 3 runs in a built tree. Keyed indices unchanged. `paths.test.ts`'s 785 and the K3 tests untouched and green. `npm run a11y` on `/lesson/t5.l5` and `/lesson/t6.l9` at 360, 320 and 1280 px is clean. The search index is byte-identical. Export freshness clean. Every lead checked against its host page (§5.3). `reading-blocks.test.ts` asserts that `SERVING_READING_HOSTS` equals the hosts of the mounted `reading` blocks and that `SERVING_READING_KCS` equals `READING_KCS`. `npm run a11y` with no stored path audits the collapsed state; the open item is audited by `reading-block.spec.ts` at 360 and 320 px. |
| SR-07 | Copy that tells the truth | Sonnet | 3 | SR-06 | `src/pages/boot/You.tsx`, `src/lib/learner/paths.ts` (header comment only), `src/components/learner/PlacementWalk.tsx`, `src/lib/learner/placement.ts` (comment), `src/lib/learner/recommend.ts` (comment), `tests/learner/recommend.test.ts`, `tests/learner/anchor-line.test.ts` (new) | The strings of §5.5. The blurb assertion runs `readingCoverage()`. The serving-first anchor lines never promise R lessons or test-outs, and other paths keep theirs. `e2e/boot.spec.ts` green. `/boot` within 200 KB. |
| SR-08 | Measurement: the prereg and the selector | **Opus** | 5 | SR-01 | `docs/prereg/serving-reading.md` (new), `src/lib/learner/outcomes.ts` (`KEPT_WORKING` += `'boot:path'`, `PartnerLedger.path?`, `SERVING_READING_KCS`, `SERVING_READING_HOSTS`, `selectServingReading`), `scripts/partner-report.ts`, `tests/learner/serving-reading.test.ts` (new) | The prereg holds §8 M2 in the draft form of SR-D28. The test checks that the committed file reads as unsigned, and that either signature form reads as signed. `partner-report.ts` adds `servingReading: isPreregSigned(repoText('docs/prereg/serving-reading.md'))` next to `hintLadders` and `fleetDaily`, and calls `selectServingReading` only when that is true. Otherwise it prints "NOT READ: docs/prereg/serving-reading.md is not signed", in text and in `--json`. Fixture ledgers give known reach, completion, band and time figures when the selector is called directly: one full export that goes through `stripFreeText` (not hand-built), one donation, one R learner, and one serving-first learner with no host quiz ("not yet at a host"). `boot:value` is still removed. "Not enough data" below 8 learners. It imports nothing from SR-03's files. |
| SR-09 | Final review | Opus | 2 | SR-07, SR-08 | none (review only) | Full suite and every `verify:*` green at the tip. The bundle report matches §7. A walk of the path at 360 px meets all seven blocks. |

**Levels** (no two tasks in a level share a file):
- L0: SR-02 ∥ SR-05 ∥ SR-08.
- L1: SR-03.
- L2: SR-04.
- L3: SR-06.
- L4: SR-07.
- Then SR-09.

**Total:** 39 h. The core that ships the promise is SR-01 to SR-07, 32 h.

**Cut order**, if the owner caps the work:
1. SR-08's selector and report code. The prereg text and the think-aloud stay.
2. B5 (t5.l10). Smart pointers then has one block.
3. The off-path collapse. Blocks then open for everyone, and nothing else changes.

Never cut the `settle` fix in SR-05. Without it every reading block is broken on a cold load.

---

## 11. Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| A content edit during the port breaks cue balance (fix pools sit at +5.8 to +8.6) | medium / blocks the merge | port verbatim (SR-D24); run `verify-generators --family compile` after any edit; `sr/rustc-final/cues.ts` and `markers.ts` show the exact unit |
| The legend makes verdicts too easy | medium / weak signal | M2's difficulty band; if first-answer verdict accuracy is above 0.85, drop the legend from verdict stems and keep it on fixes |
| Learners skip the optional blocks | medium / reach | M2 reach ≥ 0.80; the blocks sit at the point of use; nothing locks |
| The enums competence line overclaims "model absence … and match on both" | low / an overclaim | Q7; fix items do test the choosing; the owner may exclude reading answers from competence (one filter) |
| An insertion shifts a keyed block's index | certain if misplaced | the frozen index map in M1 |
| An early host draws a `Weak`, `Box` or iterator snippet before the block that teaches it (B1's E pools include `parent-upgrade`, `box-next-block` and `router-choose`) | certain, low impact | accepted: each item's why explains its own code, and the leads frame the idea rather than promise "this code" (§5.3) |
| rustc pin drift | low | the pin is unchanged; `--check` runs in CI |
