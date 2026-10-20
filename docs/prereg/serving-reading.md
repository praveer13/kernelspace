# Pre-registration: can serving-first learners read the Rust?

**Status:** DRAFT for the owner to sign. Drafted by task SR-08 (`docs/specs/serving-reading.md` §8 M2, SR-D15, SR-D28). **The drafter has not signed or dated it**, and nothing below is read until the owner signs it (section 7): `scripts/partner-report.ts` does not call `selectServingReading` while this file is unsigned, and prints "NOT READ: docs/prereg/serving-reading.md is not signed" in its text and in `--json`. The owner signs it before the release that ships the reading blocks (SR-06; owner question Q11). Nothing changes after the signature except by a dated amendment at the end of this file.
**Feature:** serving-first Rust reading items. A `reading` lesson block (`src/data/lessons/types.ts`) shows compile-bank `verdict` and `fix` items on four R KCs inside seven T5 and T6 lessons: t5.l2, t5.l5, t5.l6, t5.l7, t5.l10, t6.l8 and t6.l9 (`docs/specs/serving-reading.md` §5.3, blocks B1 to B7).
**Rule it implements:** PLAN-100X.md:209 promises the serving-first path that "Rust arrives as compile-bank reading items". PLAN-100X.md:753 asks that "Thresholds and non-inferiority margins are pre-registered in `docs/prereg/<feature>.md` before any data arrives." PLAN §9's keep/kill table has no row for these items; section 4 proposes one for the owner to add.

## 1. Question

After the seven blocks, can a learner on the serving-first path, who skipped Rust Zero, read short serving-shaped Rust well enough to follow it? Reading here means saying what the code does with absence and failure (`Option`, `Result`, `?`), when an iterator chain runs and what it borrows, what a closure captures, and what `Arc` and `Rc` cost and allow. Those are the four R KCs that the path's T5 and T6 KCs require: `r.enums-option-result`, `r.iterators-ownership`, `r.closures-collections` and `r.smart-pointers`.

The blocks cost about 15 to 18 minutes on the path (16 correct answers), and the four reading pools are 36 authored snippets to keep correct. They exist to keep a promise of the plan. A think-aloud can show whether the promise holds for a reader. The ledger can show whether learners meet the items, finish the blocks and find them neither trivial nor hopeless.

## 2. Design

**The decision instrument is a think-aloud read.** It fits the sample the plan expects: OD10 (PLAN-100X.md:826) recruits at least 8 design partners, of whom at least 2 are ML engineers.

- **Who.** At least 2 ML-engineer partners whose working path is `serving-first`.
- **When.** After the partner has passed t6.l9 (an ok `quiz` on `lesson:t6.l9`), so every block lies behind them.
- **Material.** Two unseen Rust files of 40 to 60 lines each, written for the study. One is shaped like a block manager, the other like an admission scheduler. Neither is copied from any project, from the reading pools or from a lesson. Both compile with rustc 1.96.0, edition 2024, the bank's pin (`scripts/build-rust-items.ts`). The files and the line each question points at are fixed before the first session, and their sha256 is added here as a dated amendment before then (section 6, item 2).
- **Session.** 15 minutes. The partner reads the files aloud and answers the six questions below in order, without running the code, a compiler or a search. The partner may scroll both files at any time.
- **Rubric.** Six questions, one point each, scored against the guide below. The letter names the KC each question reads: E for enums, I for iterators, C for closures, S for smart pointers.
  1. What does `alloc` return on an empty pool, and who decides what happens next? (E)
  2. Here `?` fails on the second call. What is undone? (E)
  3. When does this iterator chain run, and what does it borrow? (I)
  4. What does this closure capture, and why must it be `FnMut`? (C)
  5. What does `Arc::clone` cost here? (S)
  6. Why `Arc` and not `Rc` for this handle? (S)

**Scoring guide.** A point needs every part of its line. No half points.

1. `alloc` returns `None`, the `Option`'s empty case, and does not decide anything itself: the caller does, either by passing the `None` on with `?` or by matching on it (to preempt, say).
2. `?` returns the error from the function at once, and undoes nothing by itself. Values the function built before the failing line are dropped on the way out, so the only clean-up is what their `Drop` does. Anything already moved out of shared state (a block taken from the pool) stays taken unless such a `Drop` puts it back.
3. Adapters such as `filter` and `map` do no work. The chain runs when a consumer pulls it: `collect`, `sum`, `max_by_key` or a `for` loop. `.iter()` lends the collection for reading, and that borrow lasts as long as the chain does.
4. The closure borrows the variable it changes as mutable (a variable it only reads is borrowed shared, and a `move` closure takes ownership). Changing a capture is what makes it `FnMut`: a call site that asks for `Fn` rejects it, and calling it needs a `mut` binding.
5. `Arc::clone` copies a pointer and bumps the shared count; the data behind it is not copied. Both handles point at the same allocation.
6. The handle crosses to another thread. `Rc` is never `Send`, because its count is not updated atomically, and moving one into `thread::spawn` does not compile. `Arc`'s count is atomic, so an `Arc<T>` may cross when `T` is `Send` and `Sync`.

**Who scores.** The owner scores each answer during the session or from its notes, against this guide, before reading any ledger figure of that partner.

**The ledger descriptives.** The partner report computes the figures of section 3 from donated ledgers and full exports. They inform the decision and never decide it (section 4).

## 3. Outcome

**Primary:** each partner's think-aloud score, 0 to 6, by the guide of section 2.

**Secondary, from the ledger (`selectServingReading` in `src/lib/learner/outcomes.ts`, printed by `scripts/partner-report.ts`).** These are descriptives with pre-registered thresholds.

**Eligible learners.** One rule covers both kinds of file. A learner is eligible with at least one ok `quiz` whose ref is a host lesson (`lesson:t5.l2`, `lesson:t5.l5`, `lesson:t5.l6`, `lesson:t5.l7`, `lesson:t5.l10`, `lesson:t6.l8` or `lesson:t6.l9`), plus one condition that depends on the file.

- **A full export** also needs `boot:path` = `serving-first`. The report keeps that working record through `stripFreeText` (`KEPT_WORKING` holds `boot:path`, a path id and never free text). A serving-first export with no ok host quiz is counted and printed as "not yet at a host", and is left out of every figure. An export on another path is counted and left out.
- **A donation** keeps no working path (`src/lib/learner/redact.ts`), so it uses an off-R proxy instead: no event whose ref starts with `lesson:r.`. A donation with an R lesson event, or with no ok host quiz, is counted and left out.

The two kinds are reported separately and pooled.

**Reading answers** are `item` events whose ref is one of the eight reading refs (`gen:compile/verdict.<kc>` and `gen:compile/fix.<kc>` for the four KCs, without the `r.` prefix) and whose `data.src` is `lesson`. No other surface writes them: the reading variants are block-only.

| Figure | Definition | Threshold |
|---|---|---|
| Reach | the share of eligible learners with at least 1 reading answer | ≥ 0.80 |
| Completion | the share of reading `grp`s (a `grp` with at least one reading answer) that hold at least the block's `count` correct answers of provenance `unseen`. A full export reads `count` from the host block its answers' `data.lessonId` names. A donation keeps no `lessonId`, so its `grp`s use 2, the smallest count; that figure is labelled "≥ 2 correct" and reported beside the full-export one, never pooled with it. | ≥ 0.60 |
| Difficulty band | per variant (KC and kind, read from the ref): each learner's first `unseen` answer on it, as k of n with a Wilson 95 % interval | a pool is flagged when its point estimate is outside 0.35 to 0.85 and n ≥ 20 |
| Later vs first | `grp`s are ordered by their first event in ledger order (`at`, then `id`), never by the `grp` string. For each learner and KC with 2 or more `grp`s, d = ok of the first answer on that KC in the last `grp` − ok of the first answer on that KC in the first `grp`. The figure is the mean of d over learners, each learner's KCs averaged first. | "not enough data" below 8 learners |
| Time | the median `ms` per reading answer, per kind | verdict ≤ 60 s, fix ≤ 90 s |
| Clone lure | the share of fix answers that record `r.clone-to-silence`, **full exports only**: a donation keeps a `miss` only for `confuse.` ids, so donations are left out, and the report says so | reported |

## 4. Decision rule

**The think-aloud decides.** Read when at least 2 ML-engineer partners have a score:

- **Go:** every partner scores at least 4 of 6. The blocks stay as built.
- **Revise:** more than half of the partners score 2 of 6 or less (with 2 partners, both). The pools and the leads are rewritten first, starting from the questions most partners missed; removing the blocks is the owner's call.
- **Otherwise:** report the scores and keep the blocks.

**If underpowered** (fewer than 2 ML-engineer partners reach t6.l9), **the default is to keep.** The items are content only, are optional, and keep a promise of the plan.

**The ledger figures never decide.** A figure that misses its threshold is reported beside the scores, and leads to a defect to fix, not to a removal:
- reach below 0.80: the blocks are hard to find or easy to skip; the leads and placement are reviewed;
- completion below 0.60: the blocks ask too much; the counts and pools are reviewed;
- a flagged pool: that pool is rewritten. A verdict pool flagged above 0.85 first loses the code legend from its verdict stems, which keep it on fixes (`docs/specs/serving-reading.md` §11);
- a median time over its bar: the snippets of that kind are shortened.

**Proposed PLAN §9 keep/kill row** (the owner adds it; agents never edit PLAN): "Serving-first reading items: think-aloud ≥ 4/6 per ML-engineer partner. Default if underpowered: keep."

## 5. Data and limits

- **Source.** The think-aloud notes, kept by the owner; the partners' own ledgers, donated privately (`docs/specs/wave-2.md` §20: day offsets and no free text) or exported in full and stripped of free text by the report. Nothing is sent to a server by this feature.
- **Sample size.** Two partners cannot estimate an effect, and the rule does not ask them to. It asks whether two people the path is built for can read the Rust it promised them. A Go from two partners is a reading, not a proof.
- **Self-selection.** Partners are not a random sample of learners. Figures are reported as "among n partners", with no claim beyond them.
- **Prior Rust.** A partner who already reads Rust would pass without the blocks. The owner asks each partner before the session whether they had read or written Rust before kernelspace (never, a little, regularly), and reports the answer beside the score.
- **Think-aloud reactivity.** Reading aloud slows a reader and can change what they notice. The session has no time pressure beyond its 15 minutes, and the score reads only the answers.
- **The proxy.** A donation from a full-ramp learner who has not yet reached an R lesson but has passed a host lesson passes the off-R proxy. The full exports are reported separately so the two can be compared.
- **Completion on donations.** Two is the smallest block count, so the donation figure ("≥ 2 correct") is at least as high as the full-export rule would give for the same answers.
- **Stopping.** No interim decision. The ledger figures may be read at any time once this file is signed; they decide nothing.

## 6. Choices this draft makes for the owner

1. **The scoring guide** (section 2) is the draft's: one point a question, every part of its line, no half points. Strike a part to make a question easier to earn.
2. **The material is fixed before the first session**, with its sha256 added as a dated amendment, so the files cannot be tuned to the partners after the fact.
3. **The owner scores alone.** A second rater would make the score sturdier and doubles the owner time; add one by amendment before the first session.
4. **Prior Rust is asked and reported**, never used to drop a partner.
5. **Completion is not pooled** across the two kinds of file, because they read different counts.
6. **A missed ledger threshold leads to a defect, never to a removal** (section 4). The design (SR-D15) says the figures inform and never kill; this draft names what each miss leads to.

## 7. Sign-off

The owner signs in either of two ways, and either one alone is a signature: replace the pending text on the next line with a name and an ISO date (`Signed: <name> YYYY-MM-DD`, as in `fleet-daily.md` and `watcher.md`), or fill the table's Owner cell with a name and its Date signed cell with an ISO date (as in `hint-ladders.md`). Doing both is fine. Anything that reads this file for its signature (`isPreregSigned` in `src/lib/learner/outcomes.ts`, as for the sibling files) treats it as signed as soon as one form is complete, and as unsigned while neither is: a `Signed:` line without a date, an Owner cell without a Date signed, or a date without a name does not count.

Signed: (pending owner)

| | |
|---|---|
| Owner | |
| Date signed | |
| Amendments | none |

Amendments are appended below this line with their date. Nothing above it is edited after signature.
