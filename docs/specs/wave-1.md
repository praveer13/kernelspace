# Wave 1, the first complete loop: spec (PRs 1b and 1c)

**Status:** draft for owner review. **Date:** 2026-10-04. **Base:** `wave-1a` @ 31468b1 (= `master`, Waves 0a and 0b merged).
**Implements:** PLAN-100X §8 Wave 1, except the quiz rewrite (Wave 1a, running in parallel): V4, K1, K2, the K3 slice, V5 for T0–T2, P1 for T0–T1, P2 for three sims, W1 with the block-placement play, F1, F2/H3/H4 v1 for lab 01, H1, the Capstone sandbox and CSP, giscus, and the Wave 0b follow-ups listed in §15.
**Types committed with this spec** (types and two id tables only; no behaviour changes):
- new: `src/lib/kc/types.ts`, `src/data/kc/ids.ts`, `src/lib/items/types.ts`, `src/lib/learner/types.ts`, `src/lib/sims/types.ts`, `src/lib/world/types.ts`, `src/lib/forge/types.ts`;
- extended: `src/lib/ledger/types.ts` (Wave 1 refs, item data, event data, working keys, `LedgerFacadeActionsV31`), `src/data/lessons/types.ts` (`Lesson.kcs`, `Lesson.ticket`, `DiagramBlock.predictAt`, `PredictBlock`, `PlayBlock`, `ExerciseBlock.taskIds/config`), `QuizQuestion.kcs` (`src/components/QuizBlock.tsx`), `ForgeLabCheck.kcs/stage` (`src/data/labs.ts`).

`tsc -b` and `eslint` pass on this commit. Section numbers below are cited by those files.

---

## Decisions (read first)

| # | Decision | Where |
|---|---|---|
| D1 | **FSRS-6 is implemented in-house** (~150 lines) with reference vectors generated once from ts-fsrs 5.4.2, which never enters `package.json`. | ADR-2, §6.1 |
| D2 | **No new event kinds for V5.** An exit ticket, spiral checkpoint or test-out is a `quiz` event with `data.form`; any `ok` quiz passes the lesson through the existing `quiz-pass:<id>` fact. `play` and `prove` get typed events (they were reserved). | §3, §8 |
| D3 | **`SCHEMA_VERSION` 3 → 4** and **`AGGREGATE_VERSION` 1 → 2.** A Wave 0b tab goes read-only rather than misreading Wave 1 data. A v1 snapshot is upgraded in place at hydrate, so the first Wave 1 load never paints empty. | §3.1 |
| D4 | **V5 is read-time and migration-free.** Nothing stored is rewritten. A Wave 0b `complete lesson:` without `via` reads as *read, not passed*; XP v2 re-prices old facts on read. | §8.7 |
| D5 | **XP = nominal graded minutes**, one table, with a 30-minute daily cap on item minutes. Ranks become rings derived from the ledger; RING 2 is implemented, the others are defined later. | §8.4–8.5 |
| D6 | **A lesson has four states:** unstarted, reading, *read* (finished without passing) and *done* (passed). Resume skips *read*; completion percentages count *done* only. | §8.3 |
| D7 | **The forge ABI v2 is a line protocol on `ks_run`** (`v 2`, `list`, `only <id>`, `seed <u32>`), plus `ks_abi_version`, `ks_panic_msg`, `ks_trace_drain`, and `probe` on `ks_invoke`. A prototype ran this end to end in the scratchpad (§12.1). | §12 |
| D8 | **Lab 01 does not test coalescing today** (measured: a non-coalescing allocator passes all six checks). F1's pilot repairs `coalesce` and `fragmentation` and adds a private mutant matrix. | §12.5 |
| D9 | **SimHost is a React context**, not an iframe. Sims read config through it, and only `/lab/*` writes `?cfg=`. | §10 |
| D10 | **The entry chunk goes on a diet first.** framer-motion and fuse.js leave it. `/boot` sits at 197.9 of 200 KB today, so nothing in Wave 1 fits without this. | §6.9, §16.1 |
| D11 | **QR handoff is deferred to Wave 2.** A file-based delta handoff ships, reusing export v3 and merge import. | §6.6 |
| D12 | **Two PRs on one foundation.** PR 1b's level 0 (ledger contract, scaffold, entry diet, claims) merges into `wave-1b` first. `wave-1c` branches from that commit, so the two PRs never edit the same file. | §18 |

### Owner answers (2026-10-05). These take precedence over §19 and any conflicting text.

| # | Question (§19) | Decision |
|---|---|---|
| O1 | Reference solutions for F1 calibration and the mutant matrices | **Agents write them locally** under `labs/_solutions/`, which is gitignored and never committed or packed. Only calibration results (`calibration.json`) are committed. The zip audit in `pack-labs.py` must keep failing on any `_solutions` path. |
| O2 | giscus | **Done 2026-10-05.** The giscus app is installed and Discussions are enabled. The API cannot create categories, so the defaults are used, and they are the right types. C16 writes these ids into `src/data/community.ts`: `repo: 'praveer13/kernelspace'`, `repoId: 'R_kgDOTc8vQw'`; lessons go to category **Announcements** (`DIC_kwDOTc8vQ84DHETD`, Announcement type, so only maintainers and giscus open threads), and labs go to **Q&A** (`DIC_kwDOTc8vQ84DHETF`, answerable). The owner may rename these in the GitHub UI; ids do not change. Keep the code path that hides the button when ids are empty. |
| O3 | XP v2 table (§8.4) | **Approved as specified**, to be revisited at the Wave 2 exit with partner data. |
| O4 | "Read, not passed" | **Navigation only.** Track percentages, badges, achievements and RING 2 count *done* lessons only. |
| O5 | Does a checkpoint pass of ≥ 80% count as passed for R and T3–T7 before their tickets exist? | **Yes.** The Wave 1a rewrite makes those items valid evidence. |
| O6 | Returning learners | **No redirect from `/`.** For returning learners, Home's hero becomes a "Today · N items · ~M min" card, and Today is first in the nav and the bottom tabs. |
| O7 | Test-out bar | The ticket's rule (≥ 2 of 3, including the non-MCQ) **plus** the day-7 confirmation. |
| O8 | Seeded R drills | **Accepted.** New checks run on random inputs per seed; RING 2 requires a template-v2 rebuild. |
| O9 | Sandbox fallback | **Accepted.** Where an opaque-origin iframe cannot host a Blob worker, fall back to worker-only isolation, labelled "sandbox: worker only". |

**Item-validity rule for all new items (from Wave 1a):** every learner-facing multiple-choice item added in Wave 1 must pass `bun run verify:items` with the generalized blind-strategy gates. That covers prequestions, exit-ticket MCQs, generator MCQs, errata items, Act IV and play debrief checks, and the gates are: length ranks, lexical cues, the surface-feature family, and no lesson with p ≥ 0.5. Every such item also needs a why for each option.

---

## 0. Summary

Wave 0 made the instruments valid and the evidence durable. Wave 1 closes the loop on one concept chain, block placement and fragmentation, end to end:

**prequestions (P1) → the T1.L4 block-placement play against a hidden ghost (W1) → lab 01 in PRIMM stages with per-check results, hints and Prove-it (F1, F2, H3, H4) → an unseen-seed pass (V6) → Today's FSRS reviews with fresh generated numbers (K1, K2).**

Every graded step writes ledger evidence that moves completion, XP, rings and Up Next (V5, K3).

Around that chain, Wave 1 builds the shared machinery the later waves reuse:
- the KC graph (V4);
- the generator framework (K1);
- SimHost and one task registry (P2);
- the lockstep play runner (W1);
- template v2 across all 18 crates (F1);
- the guardrail kit in every zip (H1);
- the Capstone sandbox (§7.3).

**Out of scope** (later waves): the quiz rewrite (1a); the scheduler play and Compose for T5.L7 (W1, Wave 2); Daily incidents (W3); `/me` and VRK₃₀ (K5); tickets for T3–T7 (Wave 2); the remaining 7 mirrors and 17 sims' outcome tasks (Waves 2–3); Prove-it v2 (`proved`); context packets (H2); the compile bank (F3); QR handoff; streak freezes and repair; RING 1, RING 0 and ROOT criteria.

---

## 1. Scope, base, invariants

**Base and branches.**
- PR **1b** (`wave-1b`) and PR **1c** (`wave-1c`) start from `wave-1a` **after Wave 1a's content tasks have merged into it**. 1a rewrites quiz items in R and T3–T7 (`src/data/lessons/{r,t3..t7}/*`, `src/lib/fleet-week.ts`, `scripts/verify-items.ts` and its baseline). Wave 1b/1c tasks touch those files only after 1a is in.
- `wave-1c` branches from `wave-1b` once 1b's level 0 (B0–B3, §18) has merged. **1b merges to `master` first**; 1c then retargets to `master`.

**Invariants** (each has a test or a CI check; §16).

| # | Invariant |
|---|---|
| W1 | **Evidence, not clicks.** No completion, XP, ring or recommendation reads a non-graded event as evidence. A `complete` event alone is *read*, never *done*. |
| W2 | **Derived, never stored.** Card states, due dates, XP, rings, Up Next and placement eligibility are pure functions of the ledger, static content and the clock. The only stored derivations are the working records named in §3.5. |
| W3 | **Generators are pure and deterministic.** The same `(family, version, seed, level, variant)` gives a deep-equal `Instance` in Bun, Chrome, Firefox and Safari. No `Math.random`, `Date`, DOM or network in `make`/`grade`/`solution`. |
| W4 | **Constants come from claims.** No real-world number appears as a literal in a generator, a sim task or a play; it comes through `claimNumber`/`atlasRow`. Scenario numbers are declared synthetic. |
| W5 | **Zero imports.** Every lab module instantiates with `{}`. Tracing is pulled (`ks_trace_drain`), never pushed. |
| W6 | **Untrusted code never runs on the main thread.** Learner wasm (Forge, Fleet, leaderboard) and Capstone JS run in workers with a time budget. Capstone JS also runs in an opaque-origin frame. |
| W7 | **No new runtime dependency.** ADR-1 (ledger spec §14) stands, extended by ADR-2 (§6.1). |
| W8 | **Nothing locks.** Tickets, checkpoints, placement and rings never gate navigation. A miss always offers new numbers *and* "continue anyway". |
| W9 | **Validation before writers.** Every new ref (§3.2) is accepted by `refs.ts` and the codec before its first writer merges. Otherwise the outbox flush drops the events as invalid (ledger spec §4.9, `engine.ts:350–364`). |

---

## 2. Architecture and module map

```
                         static content (CI-verified)
   lessons (+kcs, ticket, predict/play blocks) · src/data/kc/* (graph) · claims/atlas · labs.ts · sim registry
                                         │
 ledger events ──▶ src/lib/kc/resolve.ts (event → KCs) ──┐
 (IndexedDB)                                             ▼
        │            src/lib/learner/{fsrs,cards,composer,planner,recommend,placement,ticket}.ts   [pure]
        │                                                │
        ▼                                                ▼
 façade (useProgress, entry)          /today · ExitTicket · TestOut · PlacementWalk · UpNextCard   [lazy UI]
   aggregate v2 → XP v2, rings        ItemPlayer (src/components/items/*) ◀── src/lib/items/{core,families/*}
        │
   Navbar/StatusBar: snapshot only (ledger spec §8.1; PLAN §7.3)

 SimHost (context) ─▶ sims ─▶ Observations ─▶ TaskPanel (predict → run → explain) ─▶ recordSimOutcome
 world/{heap,placement,play,policy}.ts ─▶ block-placement play · AllocatorSim · lab 01 PRIMM reference run
 labs/kit v2 ─▶ lab.worker (fresh instance per check, 2 s each) ─▶ ForgeLab v2 ─▶ recordLabRun
 fleet.worker sessions ─▶ /fleet panels, leaderboard harness                capstone-sandbox.html ▶ worker
```

**New modules.**

| Path | Contents | Task |
|---|---|---|
| `src/data/kc/{index,ids,r,t0,t1,t2,t4,t5,notional,migrations,ref-map}.ts` | the graph (`ids.ts` committed here) | B4 |
| `src/lib/kc/{graph,resolve}.ts` | DAG utilities, read-time event→KC resolution | B4 |
| `src/lib/items/{core,grade,staircase,registry,units}.ts`, `families/{frag,kv,roofline}.ts` | generator framework and families | B5, B9–B11 |
| `src/lib/learner/{fsrs,cards,composer,planner,reentry,recommend,paths,placement,ticket,ics,handoff}.ts` | learner model (pure) | B6, B12, B19, B21, B22, B18 |
| `src/lib/economy.ts` (v2), `src/lib/economy-table.ts` | XP minutes, rings | B7 |
| `src/components/items/*` | the item player | B13 |
| `src/pages/Today.tsx`, `src/pages/today/*` | Today | B18 |
| `src/components/learner/{ExitTicket,TestOut,PlacementWalk,UpNextCard,WeekSheet}.tsx` | V5 and K3 UI | B19, B21, B22, B18 |
| `src/components/sims/{SimHost,TaskPanel,SimMirror,PhoneOutcome}.tsx`, `src/lib/sims/{host,registry}.ts` | P2 | C2 |
| `src/lib/world/{heap,placement,policy,play,traces}.ts` | W1 core | C3 |
| `src/components/play/block-placement/*`, `src/pages/Play.tsx` | the play | C11 |
| `src/lib/forge/{abi,run}.ts` | F1 host | C1 |
| `src/data/forge/rust-allocator/{primm,ladder,prove}.ts` | F2/H3/H4 content | C13–C15 |
| `labs/agent-kit/*` | H1 guardrails | C6 |
| `public/capstone-sandbox.html`, `src/workers/capstone.worker.ts`, `src/lib/capstone/{steps,sandbox}.ts` | sandbox | C5 |
| `src/workers/fleet.worker.ts`, `src/lib/fleet-session.ts` | Fleet watchdog | C4 |

---

## 3. Ledger contract v3.1 (task B0)

### 3.1 Versions and the upgrade path

- **`SCHEMA_VERSION = 4`.** Wave 1 adds refs, data shapes and lesson semantics. A Wave 0b bundle opening the v4 database, or seeing a v4 snapshot or `hello`, goes read-only through the existing guard (ledger spec §9.3). Its banner tells the learner to reload.
- **Exports** carry `schemaVersion: 4`. Import accepts schema versions ≤ 4. A Wave 0b bundle refuses a v4 file with `newer-schema`.
- **`AGGREGATE_VERSION = 2`.** `upgradeAggregate(v1): Aggregate` adds the new fields empty (§3.4). `hydrate()` (`progress.ts:252`) uses it for a version-1 snapshot instead of discarding it, and boots the engine immediately rather than on idle. First paint shows the old numbers; the engine's full derive replaces them in about 300 ms.
- **`IDB_VERSION` is unchanged.** No store or index changes.

### 3.2 Refs and item data

Grammar additions in `refs.ts` (types in `types.ts`):

| Ref | Kinds | Example | Written by |
|---|---|---|---|
| `gen:<family>/<variant>` | `item`, `probe` | `gen:kv/bytes-per-token` | Today, tickets, test-out, placement, practice |
| `pre:<lessonId>#<i>` | `item`, `predict` | `pre:t1.l4#0` | prequestions (P1) |
| `dia:<lessonId>#<blockIndex>` | `item` | `dia:t1.l3#5` | diagram `predictAt` (P1) |
| `cr:<lessonId>#<i>` | `item` | `cr:t0.l4#0` | constructed responses (tickets) |
| `item:<id>` | `item`, `probe` | `item:r.anchor.e0502-1` | placement anchors, spiral items, lab 01 PRIMM items, Prove-it follow-ups |
| `play:<playId>` | `play` | `play:block-placement` | W1 |
| `prove:<labId>` | `prove` | `prove:rust-allocator` | H4 v1 |
| `hint:<labId>/<checkId>#<rung>` | `ack` | `hint:rust-allocator/coalesce#R2` | H3 |
| `placement` | `complete` | `placement` | K3 |

- **Each ref must not contain `__proto__` segments** (existing codec rule).
- `play` and `prove` move out of `ReservedGradedEvent`, keeping their graded checks; their `data` shapes are `PlayData` and `ProveData`.
- **Codec.**
  - `ITEM_SRCS` gains `today, ticket, testout, placement, pre, diagram, practice`.
  - `checkData('predict')` accepts `src ∈ {boot, lesson, pre, diagram, placement}`.
  - `checkData('play')` requires `phase ∈ {play, compose}`, plus numeric `turns`, `survived` and `ghostSurvived`.
  - `checkData('prove')` requires equal-length `qids: string[]` and `self: number[]`.
  - `checkData('lab-check')` additionally validates, when present: `abi ∈ {1,2}`; `checks[]` with `id` and `status ∈ {pass, fail, trap, timeout}`; and `seeds ∈ {fresh, default}`.
  - Every other new field is optional and preserved unvalidated (forward compatibility, ledger spec §4.9).
- **`ItemData` gains optional fields** (types §Events): `kcs, picks, level, variant, unit, lo, hi, hit, truth, miss, ideas, nsec, slot, of, form, reason`.
  - The codec checks only that `kcs` is a string array (≤ 6), that `nsec ∈ [0, 600]`, and that `lo ≤ hi` when both are present.

### 3.3 New façade actions (`LedgerFacadeActionsV31`, merged into `ProgressState`)

| Action | Events | Skip rule |
|---|---|---|
| `recordTicket(a)` | n × `item` (refs as served, `data.src` = `ticket` or `testout`, `data.form`, `data.grp`, `data.slot/of`, `data.kcs`); one `quiz lesson:<id>` with `score = correct/n`, `ok = a.ok`, `data {grp, n, form, nonMcqOk, kcs}`; and when `ok`, `complete lesson:<id>` with `data {via: form === 'testout' ? 'testout' : 'ticket', grp}` | never (every attempt is evidence) |
| `completeLesson(id, 'read')` | `complete lesson:<id>` with `data {via: 'read'}` | `L.read` or `L.passedAt` already set |
| `recordSimOutcome(simId, o)` | `sim-task sim:<simId>/<o.taskId>` with `o.data` (v 2) | an earlier `ok` outcome on the same task |
| `recordLabRun(r)` | `lab-check lab:<labId>` with `data {passed, total, abi, checks, seeds, stage}` and `provenance` | never |
| `recordPlay(r)` | `play play:<playId>` | never |
| `recordProve(r)` | `prove prove:<labId>` | never |
| `completePlacement(json)` | `complete placement` + working `placement:result` | never (a new walk replaces the result) |
| `recordQuizAttempt` (existing) | unchanged, plus `data.kcs` on each item from `QuizQuestion.kcs` | — |

`recordLabResult` (v1) stays for v1 modules and existing callers.

### 3.4 Aggregate v2 and the view

**New aggregate fields** (all order-insensitive folds: max, min, union, sum of distinct events):

| Field | Fold |
|---|---|
| `lessons[id].passedAt` | min `at` of an `ok` `quiz lesson:<id>` |
| `lessons[id].passVia` | `form` of that earliest pass (`checkpoint` when absent). On equal `at`, the lexically smaller form wins |
| `lessons[id].read` | a `complete lesson:<id>` whose `data.via` is `read` or absent |
| `sims[s].outcomes[t]` | an `ok` `sim-task` with `data.outcome === true` |
| `labs[l].unseen[c]` | from `lab-check` events with `provenance: 'unseen'`: each `checks[i]` with `status: 'pass'` and (`fresh` or no `seed`) |
| `labs[l].assistedUntil` | max `at` + 24 h over `ack hint:<l>/<check>#bottom` events (H3 bottom-out, §13.2) |
| `plays[id]` | `{done: ok on phase play, composed: ok on phase compose, best: max score}` |
| `proves[labId]` | min `at` of an `ok` `prove` |
| `itemSec[day]` | Σ over distinct graded `item`/`probe`/`predict` events of `clamp(data.nsec ?? 30, 0, 600)` |
| `completions['placement']` | min `at` (existing map) |
| `facts` | new prefixes `simo:<s>/<t>`, `labc:<l>/<c>` (first pass of a required check in any run), `play:<id>`, `prove:<lab>`, `boot`, `placement` |

**View** (`toProgressData`):
- `status = passedAt ? 'done' : read ? 'read' : 'reading'`. `LessonStatus` gains `'read'`.
- `completedAt = passedAt ?? (read ? earliest complete at : undefined)`. Change cards keep reading completion times, so a learner who only read a lesson still gets its cards.
- `xp` is computed by `economy.ts` v2 (§8.4).

**Migration-free reading of Wave 0b events** (§8.7):
- a `complete lesson:` without `via` → `read`;
- an `ok` `quiz` without `form` → a checkpoint pass;
- `sim-task` without `data.outcome` → legacy (display only).

### 3.5 Working keys

| Key | Value | Writer | Broadcast |
|---|---|---|---|
| `placement:result` | `PlacementResult` | `completePlacement` | yes |
| `queue:laptop` | `{simId, taskId, at}[]` (≤ 20, oldest dropped) | phone mode "queue for laptop" | yes |
| `handoff:last` | `{at, events}` | delta export (§6.6) | yes |
| `today:prefs` | `{phoneMode?: boolean, sessionMinutes?: number}` | Today settings | yes |
| `boot:week` | `WeekPlan` (existing key) | Boot and Today's week sheet | yes |

The **week plan keeps its Wave 0b key.** One key, two editors, last writer wins.

### 3.6 Tests (B0)

Extend `tests/ledger/`:
- P6/P7 (order-insensitivity, optimistic agreement) over generated sequences that include every Wave 1 action;
- codec round-trip of every new shape;
- outbox flush keeps every new event;
- `upgradeAggregate(derive_v1(L))` deep-equals `derive_v2(L)` restricted to v1 fields;
- schema guard at 4 vs 3;
- the four lesson states;
- a Wave 0b fixture ledger (one click-complete, one checkpoint pass) reads as `read` and `done`.

---

## 4. V4: the KC graph v1

### 4.1 Schema

`src/lib/kc/types.ts` defines:
- **`Kc`** with `id`, `title`, `can`, `track`, `kind`, `lessons`, `requires`, `contains`, `confusable`, `threshold`, `gen`, `claims`, `labs` and `since`;
- **`KcMigration`**;
- **`NotionalMachine`**;
- **`KcGraph`**.

Semantics:
- **`requires`** is the prerequisite DAG. Today, the braid and the ticket order read it.
- **`contains`** is stored for FIRe-style implicit credit and is **never used for credit in Wave 1**. PLAN §7.2 calls implicit credit untested; it waits for cold-check evidence.
- **`confusable`** is symmetric. Today interleaves only inside these sets (§6.3).
- **`threshold`** is `core` (six KCs) or `anchor` (one: Rust reading).
- **Cap: 200 KCs overall.** v1 targets ~70.

### 4.2 Ids and the contract table

- **Format:** `^(r|t[0-7])\.[a-z0-9]+(-[a-z0-9]+)*$`.
- **Stability:** an id never changes in place; renames and splits are `KcMigration` rows.
- **Contract table:** `src/data/kc/ids.ts` (committed) fixes the 21 ids that other tasks depend on:
  - the six threshold KCs and the Rust anchor (placement);
  - the KCs of the three generator families;
  - the KCs of the AllocatorSim, RooflineSim and KvCacheSim tasks;
  - the KCs of the block-placement play and lab 01's checks.
- B4 must define every one of them and may add others.

### 4.3 Seeding from lesson data

`scripts/kc/seed-candidates.ts` (B4; not run in CI) prints a review worksheet per lesson. The counts below were measured in this branch for R, T0, T1 and T2.

| Source | R + T0–T2 count | Becomes |
|---|---|---|
| H2 headings | 86 (R 21, T0 20, T1 20, T2 25) | one candidate concept per H2. Merge siblings until a lesson has 2–3 KCs |
| statline chips | 29 (T0 13, T1 4, T2 12) | `fact` KCs, one per chip *row* (e.g. `t0.latency-ladder`), never one per chip |
| isomorphism pairs | 29 (T0 6, T1 7, T2 16) | concept KCs on the LLM side, plus `confusable` candidates (paging ↔ PagedAttention) |
| lesson cross-references | 197 course-wide (141 backward; the content audit's count); 21 with both ends inside R + T0–T2 | candidate `requires` edges between the two lessons' primary KCs |
| lab readiness | `rust-allocator ← r.l1–r.l5` (`labs.ts:489`) | lab 01's check KCs `require` the R1–R5 KCs |
| checkpoint items | 109 (R 30, T0 24, T1 26, T2 29) | tagged 1–3 KCs each; every KC needs ≥ 2 items or a generator |

**The braid needs edges that do not exist yet.** No T lesson references an R lesson today; the audit found in-degree 0 for all 10. B4 authors at least one `requires` edge from a T0–T2 KC into each R lesson's KCs. These are the edges §7.3's braid pairs on, e.g. `t1.ownership-answer` requires `r.ownership-moves`, and `t0.cache-lines` (Rust `layout.rs`) requires `r.bindings-expressions`. verify-kc fails if an R lesson has no T-side dependant.

### 4.4 Threshold KCs and the anchor

| KC | Introduced | Why threshold | Placement items from |
|---|---|---|---|
| `t0.locality` | t0.l2 | every later cost model (cache lines, HBM, KV reads) | authored (t0.l2–l4 checkpoint items) |
| `t1.external-frag` | t1.l4 | the fixed-block maneuver behind PagedAttention | `frag` generator |
| `t2.address-translation` | t2.l2 | block tables are page tables | authored (t2.l2, t2.l7) |
| `t2.admission-scheduling` | t2.l4 | continuous batching is admission control | authored (t2.l4) |
| `t4.bound-classification` | t4.l3 (Boot) | decode is bandwidth-bound | `roofline` generator |
| `t5.kv-bytes-per-token` | t5.l4 (Boot) | KV sizing drives capacity and price | `kv` generator |
| `r.borrow-rules` (anchor) | r.l4 | predicts E0499/E0502; decides whether R is skipped | authored anchors `item:r.anchor.*` (4) |

### 4.5 Tagging

- **Checkpoint items:** `QuizQuestion.kcs` inline, 1–3 ids, primary first. Required in T0–T2 and R.
- **Lessons:** `Lesson.kcs` (2–3, primary first) on every lesson of T0–T2 and R.
- **Sim tasks:** registry `SimTaskDef.kcs`.
- **Lab checks:** `ForgeLabCheck.kcs` (lab 01 in Wave 1).
- **Generators:** `Gen.kcs`, per variant.
- **Authored items:** `ConstructedPrompt.kcs`, `AuthoredItem.kcs`, `Prequestion.kcs`, `DiagramPredict.kcs`.
- **Refs with no authored home** go in `src/data/kc/ref-map.ts`, keyed by ref:
  - `boot:faded-decode` → `t4.decode-bandwidth`;
  - `boot:ridge` → `t4.ridge-point`;
  - `boot:kv-tokens` → `t5.kv-capacity`;
  - `boot:why-batching` → `t5.batching-throughput`;
  - `boot:guess-1user` → `t4.decode-bandwidth`.

Lab 01's check tags:

| Check | KCs |
|---|---|
| `boot` | `t1.allocator-contract`, `r.enums-option-result` |
| `align` | `t1.alignment` |
| `no_overlap` | `t1.allocator-contract` |
| `coalesce` | `t1.split-coalesce` |
| `reuse` | `t1.allocator-contract` |
| `fragmentation` | `t1.external-frag`, `t1.placement-policy` |

### 4.6 Read-time resolution (`src/lib/kc/resolve.ts`)

`kcsOfEvent(e, content)` returns the KCs an event is evidence for. The first matching rule applies:
1. **Rev-matched current tag.** For `quiz:`, `pre:`, `dia:` and `cr:` refs, use the item's *current* `kcs` when the event's `rev` equals the item's current fingerprint. A retag of an unchanged item therefore applies retroactively.
2. **Write-time tag.** `e.data.kcs`, when present.
3. **Static ref map.** `ref-map.ts`, then `Gen.kcs` for `gen:` refs.
4. **Migrations.** Apply `KcMigration` to the result: renames map 1→1, splits 1→n, chains are resolved. Return de-duplicated.

An event with no KCs still counts for streak, XP and exposure. It just does not update any card.

### 4.7 verify-kc (`scripts/verify-kc.ts`, fast gate)

It fails on:
- **Ids:** malformed, duplicate, more than 200, or any id from `ids.ts` missing.
- **References:** a dangling id in `requires`/`contains`/`confusable`/`gen`/`claims`/`labs`, or an unknown lesson.
- **Graph shape:**
  - a cycle in `requires`, or in `requires ∪ contains`;
  - an asymmetric `confusable` set, or one with more than 3 entries;
  - a threshold count other than 6 core plus 1 anchor.
- **Coverage:**
  - an untagged checkpoint item in any lesson that sets `Lesson.kcs`. Lessons opt in as their content task lands; B25's `tests/kc/scope.test.ts` then requires all 29 R and T0–T2 lessons;
  - a KC with fewer than 2 items and no generator;
  - an R lesson with no T-side dependant (§4.3);
  - a migration whose `from` still exists or whose `to` is unknown.

It warns (never fails) on:
- a `requires` edge pointing to a KC introduced later in the full-ramp order;
- a lesson whose KCs have no `requires` at all.

### 4.8 Notional-machine cards

`src/data/kc/notional.ts` holds four cards: T0 (the memory hierarchy machine), T1 (bytes, frames and a heap with a free list), T2 (the OS: processes, page tables, a run queue) and R (the ownership machine: owners, borrows, drops). Each has 3–6 rules and 2–4 "what it ignores" lines.

They render on the track page above the lesson list (Track.tsx, task B25) and as a ⌘K entry.

### 4.9 Indicative v1 list (B4 refines it; ids in `ids.ts` are fixed)

| Track | KCs (≈) | Examples |
|---|---|---|
| R | 13 | `r.bindings-expressions`, `r.control-flow-match`, `r.ownership-moves`, `r.borrow-rules`, `r.slices`, `r.enums-option-result`, `r.iterators-ownership`, `r.smart-pointers`, `r.interior-mutability`, `r.lifetimes`, `r.atomics-ordering` |
| T0 | 10 | `t0.latency-ladder` (fact), `t0.locality`, `t0.stride-traversal`, `t0.cache-lines`, `t0.false-sharing`, `t0.runtime-costs`, `t0.flame-graphs`, `t0.idea-reuse` |
| T1 | 14 | `t1.stack-frames`, `t1.stack-vs-heap`, `t1.pointers`, `t1.allocator-contract`, `t1.split-coalesce`, `t1.placement-policy`, `t1.internal-frag`, `t1.external-frag`, `t1.fixed-blocks`, `t1.alignment` (lab-only), `t1.compile-link`, `t1.abi`, `t1.ownership-answer` |
| T2 | 15 | `t2.context-switch`, `t2.address-translation`, `t2.tlb`, `t2.page-faults`, `t2.eviction-policies`, `t2.thrashing`, `t2.admission-scheduling`, `t2.sched-policies`, `t2.priority-inversion`, `t2.mutex-atomics`, `t2.aba`, `t2.async-io`, `t2.pagedattention-as-paging` |
| T4/T5 (Boot and generators) | 8 | `t4.ridge-point`, `t4.bound-classification`, `t4.decode-bandwidth`, `t4.tiling-intensity`, `t5.kv-bytes-per-token`, `t5.kv-capacity`, `t5.gqa-kv-heads`, `t5.batching-throughput` |

Total ≈ 60–70. Confusable sets to author first:
- {`t2.address-translation`, `t2.pagedattention-as-paging`};
- {`t1.internal-frag`, `t1.external-frag`};
- {`r.ownership-moves`, `r.borrow-rules`};
- {`r.smart-pointers`, `r.interior-mutability`};
- {`t2.mutex-atomics`, `r.atomics-ordering`};
- {`t0.cache-lines`, `t0.false-sharing`};
- {`t4.ridge-point`, `t4.decode-bandwidth`}.

---

## 5. K1: the generator framework and three families

### 5.1 The contract

`src/lib/items/types.ts`:
- **`Gen`:** `{id, version, title, kcs, variants, ratioRules, make(seed, level, variant?), grade(inst, response), solution(inst), pins}`;
- **`Instance`:** `{family, version, variant, seed, level, params, kcs, prompt, answer, claims, rev, nsec}`;
- **`Response`**, **`Grade`** and **`Diagnosis`**;
- **`PlayableItem`**, which wraps generated, checkpoint, constructed-response and authored items for one player.

`src/lib/items/core.ts` (B5):
- `rev` = `rev32(stableStringify({family, version, variant, level, params, claims}))`, reusing the ledger's `stable.ts`;
- `claims` lists `id@verifiedAt`, so a claim update yields new fingerprints and S1 "re-check" flags apply;
- **`registry.ts`** maps family id → a lazy `import()` (discovered with `import.meta.glob('./families/*.ts')`), so Today and tickets load only the families they serve. Each family is its own chunk, outside the `/today` first-load closure. Bun does not implement `import.meta.glob`, so scripts and tests discover families with `readdir` plus `import()`, as `verify-errata` does;
- **`seedFor(base, i)`** = `splitmix32u(base ^ Math.imul(i + 1, 0x9e3779b9))()`. A session or ticket seed drives every item seed, and every item seed is drawn fresh at serve time: that is what makes it `unseen`.

### 5.2 Answers and grading (`grade.ts`)

| Answer | ok | score | Stored |
|---|---|---|---|
| `numeric` | within `tolerance` (rel or abs) after unit conversion | 1 / 0 | `value, unit, truth, miss?` |
| `estimate` | `|log10(x/t)| ≤ log10(okWithinFactor)` | `max(0, 1 − |log10(x/t)| / log10(5·okWithinFactor))` | `value, truth, lo?, hi?, hit?` |
| `choice` | picked ids = correct ids | 1 / 0 | `picks, miss?` (the lure's `miss`) |

**Ratio diagnosis.**
- When a numeric or estimate answer is not ok, compute `r = x / t`. Walk the family's `ratioRules` in order; the first rule whose ratio `ρ` (fixed or computed from the instance) satisfies `|r/ρ − 1| ≤ tol` (default 0.02) yields `Diagnosis {id, ratio, message}`.
- **Shared rules** (`grade.ts`), tried after the family's own:
  - `unit.kilo` (×1000 or ÷1000);
  - `unit.kibi` (×1024 or ÷1024);
  - `unit.kibi-vs-kilo` (×1.024 or ÷1.024);
  - `unit.bits-bytes` (×8 or ÷8).
- The message names the slip ("You priced FP16: this cache is FP8, 1 byte per value.") and the item returns with new numbers. That is Priya's "you priced FP16" moment (PLAN §4.A).

**90 % intervals.** When `answer.interval` is set the player asks for `lo` and `hi`:
- `hit = lo ≤ t ≤ hi`;
- `interval.score` = the Winkler interval score in log10 space with α = 0.1: `(Lhi − Llo) + 20·max(0, Llo − Lt) + 20·max(0, Lt − Lhi)`;
- `/progress` reports the hit rate against 0.9 once n ≥ 20, next to the V2 calibration line.

### 5.3 Levels and fading (`staircase.ts`)

- **Levels:**
  - 0: a worked example where the learner completes the last step;
  - 1: one middle step blanked;
  - 2: independent;
  - 3: transfer (two KCs, or a changed surface: a different unit, hardware row or dtype).
- **Rule:** per (KC, family), a **3-up/1-down staircase** over the learner's ledger history. Three consecutive correct answers raise the level; one miss lowers it. It converges near 79 % expected accuracy, the plan's "~80 %".
- **Start level:** 1 on the first exposure after a lesson. Level 2 for placement and test-out (they measure; they do not teach).
- **Pure:** `levelFor(events, kc, family) → Level`.

### 5.4 Constants and determinism

- **Real-world numbers:** only through `claimNumber`/`atlasRow` (W4). Scenario numbers (layer counts of a hypothetical model, a trace's request sizes) are declared in a `SYNTHETIC` object per family, and the prompt says "a hypothetical model with…".
- **Definitional constants** live in `units.ts`: bytes per dtype (2, 1, 0.5), `KiB = 1024`, K and V = 2.
- **verify-generators lints family sources.** A numeric literal outside `SYNTHETIC`, `units.ts` or the allow-list {0, 1, 2, 10, 100} fails, unless it carries `// gen-literal-ok: <reason>`.
- **`make` is integer and rational arithmetic plus `Math.sqrt`, which is correctly rounded.** `Math.log10` and friends are allowed only in `grade.ts` and `staircase.ts`, never in instance construction.
- The determinism lint (§16.3) enforces both rules.

### 5.5 The first three families

Each family ships variants at levels 0–3, its own `ratioRules`, `solution` steps and **pins**: lesson and Boot worked examples it must reproduce exactly, with CI failing on drift.

**`frag`: block placement and fragmentation** (KCs `t1.internal-frag`, `t1.external-frag`, `t1.fixed-blocks`, `t1.placement-policy`).

| Variant | Asks | Answer |
|---|---|---|
| `internal-waste` | requests of sizes {…} into fixed B-byte (or 16-token) blocks: wasted bytes, or the waste % | numeric |
| `largest-fit` | a heap of free runs {…}: the largest request that succeeds | numeric |
| `frag-metric` | `1 − largestFree/totalFree` for a heap | numeric (%) |
| `fit-choice` | first-, best- and next-fit on a 4-op trace: which offset each picks, or which fails first | choice |
| `kv-block-waste` | sequences of lengths {…} with block size B: slots wasted, and why PagedAttention keeps waste under one block per sequence | numeric |

- **Diagnoses:** `frag.counted-full-blocks` (counts whole blocks as waste); `frag.used-total-free` (answered `totalFree` instead of `largestFree`); `frag.forgot-last-partial` (ρ = 1 − 1/n); `frag.percent-vs-fraction` (×100).
- **Pins:** t1.l4 fig 1, "same free bytes, different usability", and its chip "<4 % vLLM KV waste" as a `kv-block-waste` instance.

**`kv`: KV bytes and capacity** (KCs `t5.kv-bytes-per-token`, `t5.kv-capacity`, `t5.gqa-kv-heads`).

| Variant | Asks | Answer |
|---|---|---|
| `bytes-per-token` | `2 × L × H_kv × d × bytes(dtype)` for a model (claim-backed or synthetic) | numeric (B, KiB) |
| `seq-bytes` | KV for one sequence of T tokens | numeric (MB, GB) |
| `capacity-tokens` | tokens that fit in (HBM − weights) | estimate + interval |
| `capacity-chats` | chats of T tokens that fit | estimate + interval |

- **Diagnoses:**
  - `kv.priced-fp16`: ρ = 2 when the dtype is FP8, 4 when FP4;
  - `kv.forgot-k-and-v`: ρ = 0.5;
  - `kv.query-heads`: ρ = H_q/H_kv (used attention heads, not KV heads, the GQA mistake);
  - `kv.one-layer`: ρ = 1/L;
  - shared unit slips.
- **Models:** Llama-3-8B (existing claims) plus the configs added by B3 (§18): Llama-3-70B, Qwen3-0.6B and Mixtral-8x7B, each `layers`, `kv-heads`, `attn-heads`, `head-dim` with `config.json` quotes.
- **Pins:**
  - Llama-3-8B BF16 = 131,072 B/token (`model.llama3-8b.kv-bytes-per-token`);
  - Boot's 487,823 tokens and 119.1 chats on an H100 (`src/lib/boot/model.ts` values, same bands as `tests/boot/model.test.ts`).

**`roofline`** (KCs `t4.ridge-point`, `t4.bound-classification`, `t4.decode-bandwidth`, `t4.tiling-intensity`).

| Variant | Asks | Answer |
|---|---|---|
| `ridge` | peak ÷ bandwidth for an atlas row, at BF16 or FP8 | numeric (FLOP/B) |
| `bound` | a kernel with AI = a on hardware h: bandwidth- or compute-bound | choice |
| `attainable` | `min(peak, bw × AI)` | numeric (TFLOP/s) |
| `decode-b1` | batch-1 decode tok/s ≈ bw ÷ weight bytes | estimate + interval |
| `batch-to-ridge` | the batch at which decode AI (≈ batch at BF16) reaches the ridge | estimate |
| `tile-ai` | matmul tile T at FP16: AI = T/2 (errata #7) | numeric |

- **Diagnoses:** `roofline.inverted-ridge` (answered bw/peak); `roofline.sparse-flops` (ρ = 2, used the sparse datasheet figure); `roofline.tb-vs-gb` (×1000); `roofline.bits-bytes`.
- **Pins:** H100 ridge 295.2, decode 208.6 tok/s and math busy 0.34 % (Boot), and B200 ridge from the atlas.
- **Hardware:** only atlas rows with both bandwidth and peak (H100, B200, A100, RTX 4090, T4, TPU7x).

### 5.6 verify-generators (`scripts/verify-generators.ts`, fast gate, < 30 s)

For every family, variant and level, over **1,000 seeds**:
- **Determinism:** `make` twice gives deep equality; the instance survives a JSON round-trip; the same rev.
- **Validity:**
  - truth finite and > 0;
  - no `NaN`, `Infinity` or `undefined` in rendered prompt text;
  - choice options distinct, ≥ 2, each with a `why`, and the correct ids among them;
  - for choice variants over the 1,000 seeds, the correct option is strictly longest in ≤ 30 % (the V1 lint).
- **Self-consistency:**
  - `grade(inst, solution)` is ok with score 1;
  - each applicable ratio rule's answer (`truth × ρ`) grades not-ok with that diagnosis id;
  - `grade` never throws on a response at ±1e9 × truth.
- **Non-degeneracy:** ≥ 50 % distinct truths per (variant, level); level-0 instances use round numbers.
- **Pins:** every `Pin` reproduces within its tolerance.
- **Speed:** p95 of `make` + `grade` < 1 ms.

`bun test` runs the same suite at 100 seeds (`tests/items/*.test.ts`), so `bun run test` stays fast.

---

## 6. K2: Today

### 6.1 ADR-2: FSRS-6 in-house, not ts-fsrs

**Context.**
- The plan names ts-fsrs (PLAN §5.1 V3, §7.2); the owner prefers no new dependencies unless justified (ADR-1).
- **Measured** (scratchpad, 2026-10-04): ts-fsrs 5.4.2, minimal `fsrs()` + `createEmptyCard()` + `next()`, bundles to **21.4 KB minified / 6.8 KB gzip**.
- **`/today` has about 17 KB of headroom before the entry diet** (§16.1).
- Kernelspace uses only the memory model: one card per KC, whole local days, no learning steps, no fuzz.

**Decision.** `src/lib/learner/fsrs.ts` implements the FSRS-6 memory model:
- **The 21 default weights**, `w = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]`.
- **Retrievability:** `R(t, S) = (1 + F·t/S)^(−w20)`, with `F = 0.9^(−1/w20) − 1`.
- **Initial stability:** `S0(G) = max(w[G−1], 0.1)`.
- **Initial difficulty:** `D0(G) = w4 − e^{w5(G−1)} + 1`.
- **Difficulty update:** linear damping (`ΔD·(10 − D)/9`) and mean reversion to `D0(Easy)` with `w7`, clamped to [1, 10].
- **Stability after recall:** `S·(1 + e^{w8}·(11 − D)·S^{−w9}·(e^{w10(1−R)} − 1)·hard·easy)`, with `hard = w15` and `easy = w16`.
- **Stability after a lapse:** `min(w11·D^{−w12}·((S+1)^{w13} − 1)·e^{w14(1−R)}, S/e^{w17·w18})`.
- **Same-day review:** `S·sinc`, with `sinc = S^(−w19)·e^(w17·(G−3+w18))`, floored at 1 when G ≥ 2.
- **Interval** for a target retention ρ: `S·(ρ^(−1/w20) − 1)/F`, rounded to whole days, at least 1.
- **Rounding:** `roundTo(x, 8)` at the same points as ts-fsrs. The formulas transcribe ts-fsrs 5.4.2 `FSRSAlgorithm.next_state`.

**Tests.**
- `tests/fixtures/fsrs/vectors.json`: 2,000 random `(t, G)` sequences of length 1–12, generated **once** by a script that runs ts-fsrs 5.4.2 in a scratch directory and is committed beside the fixture with the version and command.
- `tests/learner/fsrs.test.ts` matches `{S, D, R, interval}` within 1e-8.
- ts-fsrs is never added to `package.json` (W7).

**Consequences.**
- ~1.5 KB gzip instead of 6.8.
- Replays are deterministic up to engine `Math.pow`/`Math.exp` ulps. Due dates are whole days, so a 1-ulp difference cannot move a due day except exactly on a boundary. That is accepted: card state is derived per device, never graded.
- Revisit if FSRS-7 (34 parameters) becomes the default worth adopting.

### 6.2 Cards (`src/lib/learner/cards.ts`)

**One card per KC.** `deriveCards(events, content, now, plan): CardSet` replays the ledger in `(at, id)` order.

**Creation rule.** A KC earns a card on:
- a lesson pass (any `ok` `quiz` event: ticket, spiral, or the checkpoint of an R lesson, which has no ticket in Wave 1) whose lesson lists it in `Lesson.kcs` (origin `ticket`). T3–T7 lessons have no `kcs` in Wave 1, so they create no cards;
- an `ok` test-out (origin `testout`);
- a placement walk that found it solid (origin `placement`);
- Boot completion, for Boot's four KCs (origin `boot`).

Cards are **created by a token bucket of 1.2 per local day, burst 3** (PLAN K2: "card creation, not lesson access, capped at ≤1.2/day").
- Earned-but-waiting KCs sit in `pending`, ordered threshold first, then by full-ramp order.
- Creation **pauses** while debt mode holds (§6.4).
- Test-out and placement cards get `confirmDay = createdDay + 7`. That review is the "day-7 check" (K3).

**Reviews.**
- Every graded event whose KCs (§4.6) include a carded KC, and which happens after the card's creation, is a review of that card.
- **Elapsed `t`** = whole local days between the event's `day` and the card's last review day (0 = same day, short-term formula).
- **Ratings from `ok` and `conf`** (V2, ledger spec §12.1):

  | Outcome | Rating |
  |---|---|
  | wrong | Again (1); `sure` also sets `priority` |
  | right, `guess` | Hard (2) |
  | right, `think` or unrated | Good (3) |
  | right, `sure`, and `ms` ≤ the item's `nsec` | Easy (4) |

  Self-checked constructed responses never rate Easy.
- **A multi-KC item rates every KC it carries.** No fractional credit: implicit credit is untested (PLAN §7.2).

**The scheduling target and the optimism offset.**
- `target = slo + offset`, where `slo` is the week plan's 0.85 or 0.90.
- `offset = clamp(mean(R_pred) − mean(observed), 0, 0.08)` over the learner's first reviews (n ≥ 20; before that, 0.02).
- **Interval** at `target`; `dueDay = lastReviewDay + interval`.
- This is the plan's "one optimism offset", learned on the device.

**First-review calibration** (`selectFirstReviewCalibration`) reports `meanPredicted` against `observed`, with a Wilson interval: the Wave 1 exit gate (§17).

### 6.3 The composer (`src/lib/learner/composer.ts`)

`composeSession(cards, content, now, prefs, seed) → SessionPlan`, pure. The time budget is `min(12, prefs.sessionMinutes ?? 12)` minutes of nominal item time.

1. **Order:**
   1. `priority` cards (sure-and-wrong since the last success);
   2. due **threshold** cards;
   3. `confirm` cards (day 7);
   4. other due cards by lowest `R(now)`.
2. **Item choice per KC:**
   - a generator family covering the KC, at the staircase level, on a fresh seed;
   - else an authored item tagged with the KC that the learner has not seen in its last 3 reviews;
   - else the KC's constructed response;
   - else skip the KC and log `needs-content` in dev. verify-kc prevents this in CI.
3. **Interleaving only inside confusable sets.** After ordering, any two due KCs in one confusable set are placed adjacent. If both have ≥ 2 items in the plan they alternate (A B A B). Unrelated KCs are never shuffled together, because random interleaving of dissimilar material does not help (Brunmair & Richter 2019: words −0.39).
4. **Cold checks:** at most 2 per session. A probe slot is a KC whose last exposure is ≥ 7 days ago and which is not due. It is served as a `probe` event, **still a review**, and measured separately (§17).
5. **"Keep going":** after the plan, the learner may take 5-item `extra` sets of generated practice on introduced KCs. They pay XP under the daily cap and still update cards.
6. **Budget line:** `allowed = floor((1 − slo) × cards)` and `belowSlo = #cards with R < slo`. It renders "recall SLO 0.90 · error budget 4 cards · refresh due". The overdue count is never shown.

### 6.4 Debt mode and re-entry (`reentry.ts`)

- **Debt mode:** when the due-item time exceeds **two sessions**, new-card creation pauses (`CardSet.paused`).
  - Today shows "Catch-up mode: new topics wait until your queue is back under two sessions."
  - Exit restores creation; pending KCs resume in priority order.
- **Re-entry:** when the last graded event is ≥ 7 local days old, the next session is **welcome-back**:
  - a 12-minute set: threshold KCs first, then the highest-stability cards most at risk;
  - every other overdue card gets a virtual due day spread uniformly over the next 14 days, by rank order of (priority, threshold, R, KC id);
  - the spread is derived from the gap's first post-gap event (deterministic, no storage);
  - copy never shows an overdue count.

### 6.5 The planner and *Set your week* (`planner.ts`, `ics.ts`)

- **Week plan:** `WeekPlan` from `boot:week`, defaulting to 180 min/week, 25-min sessions and SLO 0.90.
- **Day kinds:** `laptopDays`, `phoneDays`, other days `rest`. A day with no plan infers from the viewport (< 640 px: phone).
- **Targets:** `weekStatus(events, plan, now) → WeekStatus` gives per-day targets of `minutesPerWeek / plannedDays`.
  - `doneMinutes` = that day's XP minutes (§8.4).
  - `met` = `doneMinutes ≥ targetMinutes` at week end.
  - This feeds the persistence lever, "own weekly target met in ≥ 8 of 12 weeks".
- **Today's plan line:** "10 min review + continue T1.L4 (20 min)". On laptop days the second half prefers labs and plays (`recommend`, §7.3).
- **Week sheet:** edits the plan outside Boot. It writes `boot:week`.
- **`.ics` export:** one weekly `RRULE` event per planned weekday at a learner-chosen time, `SUMMARY:kernelspace: <n> min (Today + <kind>)`, generated client-side and downloaded. No server, no reminders sent.

### 6.6 Handoff between devices (`handoff.ts`)

- **Ships: file delta.** "Send to my other device" downloads `kernelspace-delta-<date>.json`, an **export v3** containing only the events and working records changed since `handoff:last.at` (or everything, the first time). It then writes `handoff:last`.
  - The other device imports it with **merge** (existing preview and undo).
  - Today shows "12 events not yet handed off" when the device has events newer than `handoff:last` and `lastExport`.
- **Deferred to Wave 2: QR.**
  - A QR code needs an encoder: a dependency, or ~400 lines in-house.
  - The largest QR (version 40-L) holds 2,953 bytes, about a dozen events at ~250 B each. A day's delta (~50 events) needs chunked multi-code scanning.
  - That is not cheap, so it is deferred.

### 6.7 Where Today's state lives

| State | Lives in | Notes |
|---|---|---|
| answers | `item`/`probe`/`predict` events, `src: 'today'`, `grp` = session id, `slot`/`of`, `reason`, `kcs`, `level`, `nsec`, `seed` | evidence; provenance `unseen` for generated items on fresh seeds, else `practice` |
| cards, due days, offset, debt, re-entry | derived (§6.2–6.4) | nothing stored (W2) |
| week plan | working `boot:week` | |
| phone mode, session length | working `today:prefs` | |
| laptop queue | working `queue:laptop` | |
| handoff marker | working `handoff:last` | |
| session completion | derived: a `grp` whose `slot` reached `of − 1` | XP and planner minutes come from `itemSec` (§3.4) |

### 6.8 The session at 360 px

`/today` is a lazy page with a ≤ 200 KB gzip first-load closure (§16.1). It renders top to bottom:

1. **Header:**
   - "Today · Sat 4 Oct";
   - the SLO line (§6.3);
   - the week bar ("95 / 180 min this week");
   - the ring chip;
   - the welcome-back or catch-up banner when it applies.
2. **Warm cache.** One item card at a time, full width:
   - stem with claim chips, givens as a definition list, worked steps (levels 0–1);
   - the answer control:
     - numeric field with `inputmode="decimal"` and a unit select when `units` exist;
     - estimate field, plus optional *lo*/*hi* fields behind "add a 90 % range";
     - options as ≥ 44 px buttons, letters A–D;
     - constructed response: a textarea, then the reveal and three idea checkboxes;
   - the confidence row (optional, keys 1–3);
   - **Submit** (Enter).
   - After submit:
     - the verdict in an `aria-live="polite"` region;
     - the `why` of the pick or the diagnosis;
     - "show the steps" (`solution`), collapsed;
     - **Next**, which receives focus.
   - Progress: "item 3 of 9 · ~7 min left".
   - Keys: A–D pick, 1–3 confidence, Enter submit/next, Escape closes the steps.
3. **Done card:**
   - "9 items · 11 min · due cards 7/9 right";
   - the first-review line once n ≥ 20 ("predicted 88 %, observed 84 %");
   - "Keep going" (extra set);
   - **Up next** (`UpNextCard`, §7.3);
   - **Changes**: "N things you learned have changed" (existing `ChangeCards`, mounted lazily);
   - "Hand off to my other device".
4. **Empty state** (no cards yet):
   - "Nothing to refresh yet. Pass an exit ticket and its ideas start coming back here.";
   - Up Next;
   - "Practice with new numbers" on Boot's KCs.

**Accessibility:**
- every control is reachable by keyboard and has a visible focus ring;
- no drag;
- reduced motion: no transitions on item change;
- the item card is a `<form>`;
- chips carry their text, never colour alone;
- tested by axe at 360 and 1280 px (§16.2).

### 6.9 How Today is reached: Today / Path / Build / Me, and the entry diet

**Navbar** (B26) replaces the eight links (`Navbar.tsx:10–19`) with four primary destinations plus ⌘K (PLAN §4.D):

| Destination | Route | Holds |
|---|---|---|
| **Today** | `/today` | review, Up Next, changes, the week |
| **Path** | `/curriculum` | tracks, lessons, glossary; the placement walk |
| **Build** | `/forge` | a menu: Forge, Sims (`/lab`), Fleet, Fleet Week, Capstone, Leaderboard |
| **Me** | `/progress` | rings, XP, calibration, data ownership. `/me` replaces it in Wave 2 (K5) |

- **Below `lg`:** a fixed bottom tab bar (56 px plus safe area) carries the four destinations. The hamburger keeps only secondary links.
- **The ring chip** replaces the XP rank chip (§8.5).
- **Changes** (`/freshness`) is reachable from Today's done card, the footer and ⌘K.

**Home** (B26). Returning learners (Boot completed or any graded event) get the hero CTA **"Today · 9 items · ~10 min"**, with Resume as the secondary. First visits keep "Start with Boot". `/` never auto-redirects (Addendum A3 kept it that way; a redirect to Today is owner question 1).

**Boot's last step** ("You") ends on **"Go to Today"**.

**Entry diet first** (B2). The entry chunk is **158.9 KB gzip** today. Attributing it by source map (this branch, `vite build --sourcemap`):
- framer-motion plus motion-dom ≈ 42 KB gzip;
- fuse.js ≈ 9.8 KB;
- CommandPalette ≈ 2.4 KB;
- (each gzipped separately, so approximate).

They are there only because Navbar, StatusBar, ProgressRing (used by Navbar) and CommandPalette import them. The diet:
- **Navbar, StatusBar and ProgressRing** animate with CSS transitions;
- **CommandPalette** becomes a lazy chunk opened by a 30-line key listener left in the entry;
- **`<MotionConfig reducedMotion="user">`** (PLAN §7.3, unimplemented today) wraps each lazy page that imports framer-motion, through a 10-line `MotionScope`;
- **a test** asserts no entry module imports `framer-motion` or `fuse.js`.

Expected entry ≈ 110–120 KB gzip, which leaves `/boot` and `/today` ~40 KB of headroom each.

### 6.10 The service worker (B23)

Today is "phone-first and offline" (PLAN K2). The ledger spec deferred the worker to Wave 1 (§9.7, Addendum A3 Q2). B23 ships it under those four rules:
1. **Kill switch:** a deployed `sw.js` whose install/activate handlers unregister it and clear caches. App code unregisters on `?nosw=1`.
2. **Caching:** network-first `index.html` with a 3 s timeout; hashed assets cache-first.
3. **Schema handshake:** pages post `{t: 'hello', schemaVersion}`; the worker never serves a cached shell older than the newest schema it has seen.
4. **Never** caches `kernelspace:*` storage or IndexedDB.

- **Precache:** the `/today` and `/boot` closures, the three family chunks, `claims.json`, and the generated search index (§7.4), from `dist/.vite/manifest.json` via `scripts/build-sw-manifest.ts`.
- **Registration:** in `main.tsx` after first paint, only in production builds and secure contexts.

---

## 7. K3 slice: placement, test-out, Up Next, ⌘K

### 7.1 The placement walk (`placement.ts`, `PlacementWalk.tsx`)

The walk replaces the 8-item modal (`Curriculum.tsx:45–113`; 7 of its 8 keys were B).
- **At most 20 items and about 15 minutes.**
- **Opened from:** Path (`/curriculum?placement=1`), Boot's optional link, and Up Next for learners with no lessons done.

The walk:
1. **Probes in curriculum order:** `THRESHOLD_KCS` (`ids.ts`), then the Rust anchor, unless the path is `serving-first`, where the anchor is optional and last.
2. **Per KC:**
   - one level-2 item;
   - if right with confidence ≥ *think* (or unrated), one level-3 confirmation;
   - two right → **solid**;
   - a wrong answer, or a right *guess* followed by a wrong confirmation → **missed**;
   - a *guess*-right then right → solid.
   - At most 3 items per KC.
3. **Items:**
   - generated where a family covers the KC (`t1.external-frag`, `t4.bound-classification`, `t5.kv-bytes-per-token`);
   - otherwise checkpoint items tagged with the KC and not yet seen;
   - the anchor uses `item:r.anchor.*` ("which error does rustc give: E0499, E0502, E0382, or it compiles?"). A Java tab shows the familiar analogue after the answer, not before.
4. **Misconceptions:** any lure carrying `miss` is recorded. For example, the EEVDF erratum's lure `t2.cfs-current` catches "CFS still schedules Linux" (PLAN §4.C).
5. **`entryTrack`:** the track of the first **missed** core KC in curriculum order. If every core KC is solid: T5.
6. **R skip:** `rustAnchor: solid` means R lessons are offered as test-outs, not lessons.
7. **Persistence:** `completePlacement(PlacementResult)` writes `complete placement` plus working `placement:result`. Solid KCs get cards with `confirmDay` (§6.2).

The **day-7 confirmation** rate (solid KCs right at their confirm review) is the K3 metric "≥ 85 % confirmed at day 7".

### 7.2 Test-out (`TestOut.tsx`)

- **Offered on** a lesson that is not done: "Already know this? Test out: 3 items, about 3 minutes."
- **Items:** 3 fresh items on `Lesson.kcs`. Generated where possible; otherwise checkpoint items the learner has not answered, with the constructed response as the non-MCQ.
- **Pass rule:** the ticket's, ≥ 2 of 3 with the non-MCQ right.
- **Records:** `recordTicket` with `form: 'testout'`. A pass marks the lesson done (`passVia: testout`) and creates cards with `confirmDay`.
- **A miss** offers the lesson, never a lock.
- **Limit:** one test-out per lesson per local day (honest measurement, not a lock: the lesson stays open).

### 7.3 `recommend()`: one Up Next with a why (`recommend.ts`, `paths.ts`, `UpNextCard.tsx`)

`recommend(state, content, now, device) → Recommendation`, pure. The first rule that applies wins:

| # | When | Up Next | Why line (≤ 90 chars) |
|---|---|---|---|
| 1 | no Boot and no lessons | Boot | "10 minutes: how fast is one GPU for one user?" |
| 2 | Today has due or priority cards and today's session is not done | Today | "9 cards are near your recall SLO (~10 min)" |
| 3 | a lesson in state *reading*, visited in the last 14 days | resume it | "You were 60 % through T1.L4" |
| 4 | laptop day and a lab whose host lesson is done and whose next stage is open | the lab stage | "Lab 01 stage 1 is a 2-minute win" |
| 5 | otherwise | the next lesson in the **path plan** that is not done or read, after the entry track; if its `requires` are unmet, the prerequisite instead | "T1.L4 needs split and coalesce from T1.L3 first" |
| 6 | everything done | Today extra practice | "Keep your cache warm" |

**Paths** (`paths.ts`, `pathPlan(path, graph, placement)`):
- **`full-ramp` (braided):** T0 → T1 → T2 → …, with each R lesson inserted immediately before the first T lesson whose KCs `require` one of its KCs. This uses the pairing edges from §4.3.
  - **Never more than 2 consecutive R lessons.** If more are due before one T lesson, the extras slide after it.
  - Labs follow their host lesson once readiness lessons are done.
  - Expected shape (PLAN §4.D): `r.l1 ⇄ t0.l1`, `r.l2–3 ⇄ t0.l2–4`, …
- **`serving-first`:** t0.l1, t0.l2, t4.l3, t5.l1–t5.l10, T6, T7 (755 declared minutes, PLAN §4 Wei). R appears only as reading items; labs are optional.
- **`rust-systems`:** R.L1–R.L5 → T1 (lab 01 after t1.l3) → R.L6–R.L10 → T2 (lab 04 after t2.l5) → T3 (lab 05 after t3.l4).
- **Placement:**
  - lessons before `entryTrack` are skipped unless a missed KC lives there;
  - placed learners are never sent to `r.l1` unless the anchor was missed and the path includes R. This is the K3 metric "nobody placed lands on R.L1".

**Mounted on:** Today's done card, the lesson footer (replacing `nextLesson()`, task B25), Home's Resume, Curriculum's "current" marker (`Curriculum.tsx:357–360`), and Progress's UpNext (`Progress.tsx:1167`), which loses its hard-coded `~12min`.

### 7.4 ⌘K over a build-time index (`scripts/build-search-index.ts`, B24)

- **Content:** a compact JSON (`src/data/search-index.json`, committed; CI regenerates and diffs it like `public/lessons-md`) with:
  - lessons: id, title, hook, H2s, track;
  - glossary entries;
  - KCs: title, `can`, lessons;
  - claims: label, value, unit;
  - the pages, tracks and sims already indexed (`CommandPalette.tsx:18–49`).
- **Loading:** the lazy palette (§6.9) imports it on first open. Fuse runs in that chunk. Target ≤ 15 KB gzip.
- **Groups:** Lessons, Concepts, Numbers (claims), Glossary, Pages, Tracks, Sims.
- **Destinations:** a KC opens its introducing lesson at the H2; a claim opens `/freshness?tab=claims#<id>`. B24 gives `ClaimsTable` row ids for that anchor.

---

## 8. V5 for T0–T2: exit tickets, honest XP, RING 2

### 8.1 Exit tickets (`ticket.ts`, `ExitTicket.tsx`)

A lesson with `ticket` renders its `quiz` block as the **exit ticket** (blocks.tsx routes `quiz` to `ExitTicketBlock` when `lesson.ticket` exists; scaffold B1). All 19 T0–T2 lessons get one. T3–T7 and R keep the checkpoint until Wave 2.

`planTicket(lesson, content, events, seed) → TicketPlan`:
- **3 items on `Lesson.kcs`:**
  - **item 1 (non-MCQ):** a generated numeric or estimate item if a family covers a lesson KC, at level 2 on a fresh seed (t1.l3, t1.l4 and t2.l7's spiral use `frag`). Otherwise the lesson's constructed response (`ticket.cr`, rotating on retries);
  - **items 2–3:** checkpoint questions from the lesson's `quiz` block, preferring KCs not covered by item 1 and questions not answered correctly in the learner's last attempt.
- **Pass rule:** ≥ 2 of 3 correct **and** the non-MCQ correct. For a constructed response, "correct" means ≥ 2 of its 3 ideas ticked: self-assessed, practice weight (V6).
- **Item order:** item 1 is shown last, so the MCQs warm up recall.
- **On submit:**
  - `recordTicket`;
  - pass → lesson **done** ("passed"), with cards created per §6.2;
  - miss → two equal buttons: **New numbers** (a fresh seed and the other checkpoint questions) and **Continue anyway** (`completeLesson(id, 'read')`, *read, not passed*). Nothing locks (W8).
- **Feedback:** the item `why`s and diagnoses, as in Today.
- **Keyboard:** the same as Today.

### 8.2 `m` and Mark complete

- `m` already only navigates (`Lesson.tsx:635–656`). Its target becomes the exit ticket's first unanswered control, or Up Next when the lesson is done.
- **Mark complete:**
  - **T0–T2:** the right-rail button and sticky bar (`Lesson.tsx:842–874`) become **"Exit ticket · 3 items"** and scroll to the ticket;
  - **T3–T7 and R:** **"Finish: pass the checkpoint"**, with a secondary **"Continue anyway (read)"** → `completeLesson(id, 'read')`;
  - **a checkpoint pass (≥ 80 %)** completes those lessons with no click (`passVia: checkpoint`).
- **The `+100 XP` toast and label go.** The toast after a pass reads "Passed · +3 min · RING 2: 11/19 tickets".
- **The exam gate on t2.l7 goes** (`Lesson.tsx:507`). Its quiz becomes the spiral checkpoint (§8.6).

### 8.3 Lesson states

| State | Means | Resume, Up Next | Track %, badges, track achievement | RING 2 |
|---|---|---|---|---|
| unstarted | no event | — | — | — |
| reading | visited | resumes it | no | no |
| **read** | finished without passing | skips it (offers the ticket later as review) | no | no |
| **done** | passed: ticket, spiral, checkpoint or test-out | skips it | yes | yes (T0–T2) |

`LessonRow` shows *read* as a hollow check, labelled "read, ticket not passed". The track-complete modal and the `track-<id>` achievement need every lesson *done*.

### 8.4 XP = nominal graded minutes (`economy.ts` v2, `economy-table.ts`)

- **What XP counts:** minutes of graded work at nominal durations, **1 XP = 1 minute**, each fact paid once. Reading, clicks and state toggles pay nothing.

| Fact | Minutes | Source of the number |
|---|---|---|
| `quiz-pass:<lesson>` (ticket, spiral, checkpoint, test-out) | 3 (spiral 8) | nominal |
| `labc:<lab>/<check>`, first pass of a required check | `lab.minutes ÷ requiredChecks` | `labs.ts` (lab 01: 90 ÷ 6 = 15) |
| `simo:<sim>/<task>`, an outcome-graded task | 3 | nominal |
| `play:<id>` debriefed | `PlayDef.minutes` (block placement: 15) | play def |
| `prove:<lab>` | 5 | nominal |
| `fw:<act>` | 30 (incident 20) | nominal [estimated] |
| `cap:<step>` | the step's `minutes` (`Capstone.tsx` STEPS) | Capstone data |
| `boot` | 10 | Boot |
| `placement` | 10 | nominal |
| graded items (any `item`/`probe`/`predict`) | Σ `nsec`/60 per local day, **capped at 30 per day** | `itemSec` (§3.4) |
| `lesson:`, `exercise:`, legacy `sim:` | 0 | clicks and toggles |

- **The table is generated** into `src/lib/economy-table.ts` (lab minutes and required-check counts, capstone step minutes, act minutes, T0–T2 lesson ids, R1–R5 lab ids). It stays tiny because it is in the entry chunk. A test asserts it equals `labs.ts` and Capstone's STEPS.
- **`XP` stays exported** with the same keys, holding v2 nominal values (`lesson: 0`, `quiz: 3`, `lab: 90`, `capstoneStep: 20`, `fleetWeekAct: 30`, `exercise: 0`). Existing labels compile while their pages migrate to `labXp(id)` and friends.
- **Expected mix:** labs are worth ~1,320 nominal minutes and practice 12–50 h a year (PLAN §1), against ~200 for tickets, so "≥ 70 % of XP from labs and practice" holds by construction. B7's tests report the split on a synthetic year.

### 8.5 Rings (`selectRings(agg)`, light and sync, entry-safe)

**Ranks stop being XP thresholds** (`economy.ts:22–28`). `rank = highest ring earned`, else RING 3.

**RING 2 = all of** (V5 table):
1. **R1–R5 on unseen seeds:** for each of `rust-zero-r1` … `rust-zero-r5`, every required check id is in `labs[id].unseen`.
2. **Lab 01 on unseen seeds:** every required check of `rust-allocator` is in `labs['rust-allocator'].unseen`.
3. **T0–T2 exit tickets:** all 19 lessons are *done*.

**Ticket provenance.** Tickets count for RING 2 at any provenance: most T0–T2 lessons have no generator in Wave 1, so their tickets are authored items. Ticket items on fresh generator seeds still carry `unseen` for VRK₃₀ later.

**Display:**
- the Navbar chip shows the ring name;
- `/progress` shows the RING 2 checklist ("R drills 3/5 · lab 01 · tickets 11/19") with links.

**Never revoked, never gating.**
- **Amber** when the mean predicted recall over the ring's KCs is below 0.8 (computed on `/progress` and Today, never in the Navbar).
- RING 1, RING 0 and ROOT keep their names and show "criteria arrive in Wave 2–3".

### 8.6 The T2 spiral checkpoint (t2.l7)

t2.l7 (`exam: true`) gets `ticket.form: 'spiral'`. It draws 8 items:
- 4 on t2.l7's own KCs (its checkpoint questions plus its constructed response);
- 4 spiral items on earlier T0–T2 KCs, chosen by lowest predicted recall among the learner's carded KCs, else by curriculum order. They come from `ticket.spiral` (authored, `item:` refs) and the `frag` generator. At least 2 of the 8 are non-MCQ.

- **Pass:** ≥ 6 of 8 with at least one non-MCQ correct.
- **A miss:** new numbers or continue anyway.
- **"Exam" copy:** the chip becomes "spiral checkpoint". `Track.tsx:233`'s double-XP claim is already gone (Wave 0a).

### 8.7 The start-fresh rule, without a migration

OD1 started the ledger empty on 2026-10-04 and nothing is migrated. V5 continues that rule. Every change in this section is a **read-time** rule over events that already exist:

| Wave 0b event | Reads in Wave 1 as |
|---|---|
| `complete lesson:<id>` with no `via` | **read** |
| `quiz lesson:<id>`, `ok`, no `form` | checkpoint **pass** → done (T0–T2 too: it was graded evidence) |
| `sim-task` with no `data.outcome` | legacy: the task shows as seen, 0 XP |
| `lab-check` with no `abi` | v1 run: `lab-green`, no unseen credit |
| XP facts `lesson:`/`quiz-pass:`/`sim:`/`lab:` | re-priced by the v2 table on every derive |

- No event is rewritten, no badge is frozen and no Recertify is needed.
- Learners see one line on `/freshness` → Changes: "XP now counts minutes of graded work; a clicked-through lesson shows as *read* until its ticket is passed."

---

## 9. P1 for T0–T1: prequestions and `predictAt`

### 9.1 Prequestions (`PredictBlock`, `src/components/blocks/Prequestions.tsx`)

- **Where:** every T0 and T1 lesson (12) opens with a `predict` block holding two `Prequestion`s.
  - Choice prequestions have `why`s.
  - Numeric ones have a unit, a claim-backed `truth` and `okWithinFactor`.
- **Answering:** before reading, the learner answers with optional confidence. **No verdict yet.** The card collapses to "Your guesses are saved; the answers appear as you read."
- **The reveal:**
  - when the H2 named by `revealAt` scrolls out of view upward, an inline reveal appears at that section's end: "You said X. It is Y, because…", with the `why`;
  - an unrevealed prequestion is revealed at the exit ticket.
- **Events:** at answer time, `item pre:<lesson>#<i>` (choice) or `predict pre:<lesson>#<i>` (numeric), `src: 'pre'`, with the authored rev, `kcs` and `nsec: 20`. Each is graded at answer time but shown later.
- **Expert skip:** when every prequestion KC has a card with R ≥ 0.9 or is placement-solid, the block starts collapsed: "You know this. Skip, or answer anyway." Skipping writes nothing.
- **Content:** 24 prequestions (B14, B15). They ask about the lesson's core mechanism, never trivia (St. Hilaire 2023: the effect is mostly on the asked content).

### 9.2 `DiagramBlock.predictAt`

- **Gate:** before step `predictAt.step`, the step control shows the prompt and 2–4 shuffled options. Captions of that step and later steps stay hidden until a choice is committed.
- **Records:** `item dia:<lesson>#<blockIndex>` (`src: 'diagram'`), then the `why`.
- **Applies to:** the six T0–T1 diagrams: t0.l2, t0.l4, t0.l6, t1.l1, t1.l3 and t1.l4.
- **Keyboard:** options are buttons; arrow keys keep stepping only after the commit.
- **Expert skip:** the same rule as §9.1.

**Metric:** every T0–T1 lesson with a diagram or sim records a prediction (`predict`/`pre`/`dia` event) on first visit. A test checks every such lesson carries a `predict` block or `predictAt`.

---

## 10. P2: SimHost, one registry, phone mode, mirrors

### 10.1 SimHost (`SimHost.tsx`, `src/lib/sims/host.ts`)

`<SimHost simId machine mode config taskIds lessonId>` provides `SimHostContextValue` (types §SimHost).

- **`PlaygroundShell` hooks read the context instead of the URL:** `useInitialCfg`, `useWriteCfg` (`PlaygroundShell.tsx:157–181`), and a new `useSimMachine`.
  - In **lab** mode they behave exactly as today (`?cfg=`, `?machine=`).
  - In **embed** and **phone** mode they never touch the URL, so an inline sim cannot rewrite the host lesson's query string (PLAN §7.3).
- **Pages:** `/lab/:simId` (`Playground.tsx`) wraps each sim in `<SimHost mode="lab">`.
- **Lessons:** `ExerciseView` (moved to `src/pages/lesson/exercise.tsx` by B1) mounts `<SimHost mode="embed">` inline, lazily, when the block has `taskIds`. Otherwise it keeps today's link card. The `?embed=1` URL mode stays for compatibility.
- **No iframes**, which would boot a second store.
- **Migration:** sims migrate from `useSearchParams` to the context **one at a time**. Wave 1 migrates the three P2 sims and LatencyWalk/LayoutLab (for mirrors). An unmigrated sim still works in lab mode only.

### 10.2 One task registry (`src/lib/sims/registry.ts`)

- **Holds:** every `SimTaskDef`, imported per sim from `src/components/sims/*.tasks.ts` (existing files plus `roofline.tasks.ts`, `kvCache.tasks.ts`, `allocator.tasks.ts`).
- **Legacy tasks:** existing state-detected tasks become `kind: 'legacy'` entries with their old ids. They still mark `sims[s].tasks[t]` but pay 0 XP (§8.4).
- **Lesson task lists:** an exercise block with `taskIds` renders those registry tasks with real completion state, which fixes the audit's "two parallel task lists that disagree" for these lessons.
- **"What just happened"** (`note`) is hidden until the task completes, which fixes `blocks.tsx:652–680` spoiling the discovery.

**Contract ids** (the lesson content tasks reference these):

| Sim | Outcome tasks (id → KC) | Replaces |
|---|---|---|
| `sim-roofline` | `roof.ridge` → `t4.ridge-point`; `roof.decode-bound` → `t4.bound-classification`; `roof.batch-to-ridge` → `t4.decode-bandwidth`; `roof.tile-ai` → `t4.tiling-intensity`; `roof.flash-ai` → `t4.tiling-intensity`; `roof.fp8-ridge` → `t4.ridge-point` | `t-roof-b200-ridge`, `t-decode`, `t-batch`, `t-roof-tile`, `t-roof-flash`, `t-roof-dtype` |
| `sim-kv` (calc) | `kv.bytes-per-token` → `t5.kv-bytes-per-token`; `kv.oom-context` → `t5.kv-capacity`; `kv.fp8-rescue` → `t5.kv-bytes-per-token`; `kv.gqa` → `t5.gqa-kv-heads`; `kv.max-batch` → `t5.kv-capacity` | `kv-oom`, `kv-rescue`, `kv-batch` |
| `sim-allocator` | `alloc.frag-first-fit` → `t1.external-frag`; `alloc.coalesce-recover` → `t1.split-coalesce`; `alloc.fixed-block-waste` → `t1.fixed-blocks`; `alloc.policy-race` → `t1.placement-policy` | `t-frag`, `t-coalesce`, `t-paged`, `t-quiz`, `t-trace-lab` |

The other Roofline tasks (occupancy, coalescing, banks, tiers, PCIe, CPU/GPU, the B200 worksheet rows) and `t-double-free` stay legacy until Wave 3's "remaining P2".

### 10.3 Outcome-graded tasks: predict → run → explain (`TaskPanel.tsx`)

1. **Predict.** The task's `predict` (numeric with unit, or choice) and optional confidence. The run controls stay usable; the prediction is locked once committed.
2. **Run.** The learner sets up and runs; the sim calls `observe({key, value, unit, configHash})`. The panel grades the **first observation of the task's `observe` key after the commit**:
   - numeric: within tolerance, or `|log10(pred/actual)| ≤ log10(2)` for `log: true`;
   - choice: equal.
3. **Explain.** A one-line explanation of ≥ 8 words unlocks the model answer and its three ideas; the learner ticks those covered.
   - The task completes when the explanation is written, whatever the prediction's verdict: the prediction is graded, the task is about doing the cycle.
   - The ledger gets `recordSimOutcome` with `score` = prediction score and `ok` = prediction correct. `data` carries `v: 2`, `predict`, `actual`, `logErr`, `explain` (≤ 280 characters, on the device only) and `ideas`.
4. Then **"What just happened"** opens.

**Metric:** 0 tasks complete without a prediction. The registry test checks every `outcome` task has `predict`, `observe` and `explain`; the TaskPanel test checks completion requires a committed prediction.

### 10.4 Phone mode (`PhoneOutcome.tsx`)

- **When:** below 640 px or on a coarse pointer, an inline sim opens in phone mode unless `today:prefs.phoneMode === false`.
- **What it does:**
  1. the learner predicts;
  2. then sees the **canonical outcome** as an SVG chart plus a DOM table, computed by the sim's pure model (`src/lib/sims/models/{roofline,kv,allocator}.ts`, extracted by C7–C9) for the task's canonical config;
  3. the prediction is graded and recorded (`data.phone: true`);
  4. "Queue the hands-on run for my laptop" appends to `queue:laptop`, which Up Next surfaces on the next laptop day.
- **Full completion** still needs the run on a laptop. Forge and Fleet are labelled laptop-only.

### 10.5 DOM mirrors for three canvases (`SimMirror.tsx`)

- **Which:** RooflineSim (`RooflineSim.tsx:1279`), LatencyWalk and LayoutLab. They are the three canvases on every path's first weeks (Boot → t4.l3; t0.l2; t0.l4).
- **Mirror:** a visually hidden table (with a "Show data table" toggle that makes it visible) with the plotted series and current points. The `<canvas role="img">` points to it with `aria-describedby`.
- **Live region:** announces discrete results only ("decode at batch 32 is bandwidth-bound: 64 FLOP/B, ridge 295"), never per frame, at most once per second.
- **Checked by `verify-plays`:** every file in `src/components/sims` that renders a `<canvas>` either renders `<SimMirror` or carries the waiver comment `// a11y-mirror-pending: wave 2`. The waiver lives in the sim's own file, so each task removes its own: C2 adds it to all nine canvas sims, and C7 and C10 remove it from theirs. `verify-plays` prints the waiver list; the wave exits with 6 (BatchingSim, ContentionLab, MatrixBench, QuantizerSim, SchedulerLab, WgslSim).
- **Out of the check's scope:** canvases outside `src/components/sims`. The `Lab.tsx` gallery previews sit inside an `aria-hidden` wrapper, and Home's two canvases are labelled `role="img"` previews.

---

## 11. W1: Play → Compose → Code, block placement first

### 11.1 The loop in T1.L4

T1.L4 (fragmentation) carries a `play` block after its first H2, inserted by content task B15:
1. **Play** ("I placed the blocks");
2. **Debrief** against the hidden ghost;
3. **Compose** (four dials);
4. **In-production card**;
5. **"Build this: lab 01, stage 1 is a 2-minute win"**.

The same play opens full screen at `/play/block-placement` for phones and Up Next. It is the bridge from T1.L4 to T2.L7: Compose's fixed-block spec *is* the PagedAttention move.

### 11.2 The play (`src/lib/world/{heap,placement,play,traces}.ts`; UI `src/components/play/block-placement/*`)

**The heap.**
- 64 cells of 16 B (1 KiB, the scale of AllocatorSim's heap), drawn as a 4 × 16 grid. At 360 px a cell is about 20 px wide, too small to tap.
- **Tap targets are the free-run chips listed under the grid** (full-width rows, ≥ 44 px tall). The grid is the picture; the chip list is the control and the DOM mirror. On wide screens the grid's runs are clickable as well.
- Engine: `heap.ts`, pure, eager coalescing in the play.

**The trace.**
- `makePlacementTrace(seed)` (`traces.ts`): about 40 ops. Sizes are bimodal (1–2 and 6–10 cells), with frees that punch holes.
- **Practice seed:** the lesson embed uses the fixed `PLAY_PRACTICE_SEED`, so everyone shares the story.
- **"Play again with new numbers":** draws a fresh seed through rejection sampling, as S3 does (`graded-seed.ts`). A seed is in band when:
  1. the ghost survives every op;
  2. a worst-fit placer fails before 80 % of the ops;
  3. the 4-cell fixed-block spec survives every op with internal waste in [15 %, 40 %].
- Fresh-seed plays carry provenance `unseen`.

**Turns.**
- Each `alloc` asks the learner to tap a free run that fits; runs that do not fit are disabled and say why. The allocation lands at the run's start.
- `free` ops apply automatically, one per turn, with the freed run flashing (static under reduced motion).
- **The play ends** at the first request that fits nowhere ("fragmentation stopped you: 9 cells free, largest run 4"), at the trace's end, or at the 60-turn cap.
- **Expert skip:** after 5 turns, "skip to debrief" lets the ghost's policy finish the learner's run (`skipped: true`).
- **Keyboard:** Tab and arrow keys cycle the fitting run chips, Enter places.
- **DOM mirror:** the run list (start, size, free or used), with an `aria-live` line per turn ("Placed 3 cells at cell 12. Largest free run: 9 cells.").

**The ghost.**
- **Best-fit with eager coalescing, address-ordered tie-break** (`placement.ts` `bestFit`).
- It runs in lockstep on its own heap and stays hidden: no ghost cells, no ghost score until the debrief.
- Best-fit, not lab 01's first-fit: the play's question is *where* to place, and "the smallest hole that fits" is the clean reference. The In-production card names both and why real allocators mix them.

**The debrief** (`play.ts`, generic lockstep runner; types §Lockstep) stops at the **first divergence**:
- **Outcome:** the op where the learner failed and the ghost did not.
- **Decision**, the root cause: the earliest learner placement after which the learner's largest free run fell below the ghost's at the same op and never again reached the size of the request that later failed.
- It names that op in one sentence ("At op 12 you put 2 cells in the 9-cell run; the reference used the 2-cell gap at cell 30. Your largest run fell to 7, and op 31 needed 8."), then shows both heaps side by side at that op (mirrored).
- **Whether this root-cause rule reads well on real traces is task C3's first Opus check** (§18).

**Ledger.** `recordPlay` with phase `play`:
- `score = min(1, survived / ghostSurvived)`;
- `ok` = the debrief was reached;
- `data {turns, survived, ghostSurvived, divergenceOp, skipped, kcs}`.

### 11.3 Compose (`policy.ts`)

- **The dials** (`PolicySpec`): fit (first, next, best, worst), coalesce (eager, none), minimum split (1, 2, 3 cells; a smaller remainder is given away as internal waste), size classes (none, powers of two, fixed 2 or 4 cells).
- **`compilePolicy(spec)`** returns a `PlacementDriver` plus engine options. The learner runs the spec on the same trace and on 5 fresh seeds, and gets a table: survived ops, external fragmentation `1 − largest/free`, internal waste, and a ghost row.
- **Equivalence test:** `{fit: best, coalesce: eager, minSplit: 1, classes: none}` places every op identically to the ghost on 1,000 seeds. This is W1's "a test proves the spec ≡ the reference"; Wave 2's scheduler Compose proves `{sjf, 2000, 48, none}` the same way.
- **The fixed-block insight:** `classes: {fixed: 4}` survives every op with 0 % external fragmentation and 15–40 % internal waste. The panel says so ("this is the PagedAttention move: T2.L7").
- **Ledger:** `recordPlay` with phase `compose`; `ok` when the learner reproduced the ghost or ran the fixed-block spec; `data.spec`, `data.equivalent`.

### 11.4 The In-production card

The card lists, as claims with sources and TTLs (added by B3; the owner verifies each quote):
- vLLM's KV block size default (16 tokens) and V1's recompute preemption;
- glibc malloc's size-class bins and its `mmap` threshold;
- jemalloc's size classes.

It says which dial each setting corresponds to. Every number on it is a claim chip (W4).

### 11.5 The seven-test gate (PLAN §5.4.0)

| Test | How the play passes it |
|---|---|
| intrinsic | placing *is* the concept |
| ≥ 3 axes | size, position, order in time |
| model-backed | `heap.ts`, the same engine as AllocatorSim and lab 01's in-browser reference run |
| recurs in ≥ 3 sessions | `frag` items in Today |
| schematic | cells, not hardware |
| low load | turn-based, pausable, DOM mirror, reduced motion |
| debriefed | first divergence, then Compose |

`verify-plays` fails a play without a mirror component, a debrief, KCs, or claims that exist. It also fails any `View3D` outside `GATE_3D`.

---

## 12. F1: template v2, the per-check ABI

### 12.1 The wire contract (prototype-validated)

A prototype of everything below ran in the scratchpad on 2026-10-04: kit v2, a rust-allocator-shaped crate, a Bun host.

| Export | Signature | Notes |
|---|---|---|
| `memory` | — | as v1 |
| `ks_abi_version` | `() → u32` | `2`. Absent means v1 |
| `ks_alloc`, `ks_free` | as v1 | |
| `ks_run` | `(in_ptr, in_len) → u64` (`ptr << 32 \| len`) | input lines: `v 2`, `list`, `only <id>`, `seed <u32>`. **Empty input = v1 semantics** (every check, default seeds), so v1 hosts and `cargo test` keep working |
| `ks_panic_msg` | `() → u64` | the last panic's text (≤ 500 chars), readable **after a trap on the same instance** |
| `ks_trace_drain` | `() → u64` | returns and clears the 16 KiB trace buffer (`kslab::trace!`); pulled, never pushed (W5) |
| `ks_invoke` (systems labs) | as v1, plus verb `probe <seed>` | `probe` replies with one deterministic summary line of the learner's component on a seeded mini-scenario |

**Replies.**
- `list` → `{lab, version, abi: 2, checks: [{id, label, stage, seeded}]}`, and **runs no student code**.
- `only <id>` → `{lab, version, abi: 2, checks: [{id, label, pass, msg, seed}]}`.

**Identity.** A crate built with `--features reference` reports `lab: "<id>@reference"`; its `LAB_ID` constant is `cfg`-gated.

**What the prototype showed:**
- 0 imports;
- `list` works on a template whose `todo!()` traps;
- every check runs in a fresh instance of one `WebAssembly.compile`d module;
- after a trap, `ks_panic_msg()` returned `panicked at src/allocator.rs:3:140: not yet implemented: construct your allocator`;
- 3 checks took about 3 ms in total;
- a seeded churn run took about 0.7 ms including instantiation;
- empty input reproduced v1 behaviour;
- `@reference` builds were identified by `list`.

### 12.2 `kslab` v2 (`labs/kit/src/lib.rs`)

```rust
pub const ABI_VERSION: u32 = 2;
pub struct Ctx { pub seed: u32, pub fresh: bool }
pub struct CheckDef {
    pub id: &'static str, pub label: &'static str,
    pub stage: u8, pub seeded: bool, pub default_seed: u32,
    pub run: fn(&Ctx) -> Check,
}
pub struct Lab { pub id: &'static str, pub version: u32, pub checks: &'static [CheckDef] }
pub fn run(input: &[u8], lab: &Lab) -> u64;            // the ks_run body: parses the lines, installs the panic hook
pub unsafe fn input<'a>(ptr: u32, len: u32) -> &'a [u8];
pub fn trace(line: &str);                               // + macro trace!(...)
pub struct Rng;                                         // Rng::seeded(u32): splitmix64-scrambled xorshift64*
pub fn emit_str(s: &str) -> u64;                        // kept for ks_invoke
// exported by the kit: ks_abi_version, ks_alloc, ks_free, ks_panic_msg, ks_trace_drain
```

**Each crate's `lib.rs`** (PLAN F1's `kslab::run(input, &CHECKS)`, with the checks wrapped in a `Lab` so the lab id travels with them):
- declares `static CHECKS: [CheckDef; N]` and `static LAB: Lab`;
- `ks_run` is one line, `kslab::run(unsafe { kslab::input(p, l) }, &LAB)`;
- seeded checks build `Rng::seeded(ctx.seed)` instead of `Rng(0xA11C)`, and the old constant becomes `default_seed`.

**Tests.**
- `tests/*_tests.rs` keep one `#[test]` per check on the default seed.
- They add one test that runs every seeded check on 32 fixed extra seeds, so a solution that passes in the terminal also passes the browser's fresh seeds.

### 12.3 The host (`src/lib/forge/{abi,run}.ts`; `lab.worker.ts`, `lab-protocol.ts`, `lab-worker.ts`)

**Detecting the ABI.** `runLab(bytes, {seeds: 'fresh' | 'default'})` in the lab worker compiles the module once. `abi = ks_abi_version?.() ?? 1`.
- **v1:** today's path, unchanged: one instance, `ks_run(0, 0)`; a trap marks every check `trap`, as now.
- **v2:**
  1. `list` in a fresh instance;
  2. per check, a fresh instance with input `v 2\nonly <id>\nseed <s>\n` (the seed line only for fresh seeded checks);
  3. on a trap, read `ks_panic_msg()` and `ks_trace_drain()` from that instance;
  4. post `check-start` and `check-done` to the main thread.

**Budget.**
- `lab-worker.ts` starts a **2 s timer per check** at `check-start`.
- On expiry it terminates the worker, marks that check `timeout`, respawns, recompiles, and continues with the next check.
- The run's worst case is `2 s × checks` plus startup.
- `LabTimeoutError` now names the check.

**Compatibility table** (`abi.ts`, `AbiCompat`):

| ABI | perCheck | seeds | trace | probe | best provenance | note |
|---|---|---|---|---|---|---|
| 1 | no | no | no | no | `lab-green` | "built from the v1 template: rebuild for per-check results" |
| 2 | yes | yes | yes | systems labs | `unseen` | — |
| > 2 | refused | | | | | "built with a newer template than this page: reload" |

**Credit** (`creditFor(report, history)`):
- **`@reference`** → none, everywhere: ForgeLab shows the run with "reference module: no credit" and writes nothing; `validateModule` and the leaderboard reject it.
- **`unseen`** when `abi = 2`, `seeds = fresh`, and every required check has passed with `fresh` or unseeded status in this run or an earlier unseen run. The fold keeps that per-check union (`labs[l].unseen`, §3.4).
- **`assisted`** inside an H3 bottom-out window (§13.2).
- **Otherwise `lab-green`.**

**Fleet admission** (`validateLabInWorker`) runs v2 modules per check (all green required) before the `ks_invoke` probe, keeping today's 2 s probe budget.

**`instantiateLab` and `LabModule` keep their v1 signatures** (additive changes only), so the Fleet worker task (C4) can proceed in parallel.

### 12.4 Seeds and calibration

- **Fresh seeds** are drawn by the host (`freshSeed()`, crypto) per seeded check at grade time: unseen, not secret (V6).
- **Every seeded check must pass the reference on every seed.** This is established offline, because the reference solutions are private (`labs/_solutions/`, gitignored):
  - `scripts/calibrate-lab-seeds.ts <lab> <solution.wasm> [--mutants <dir>] [--n 10000]` (owner or agent, locally) writes `labs/<lab>/calibration.json`: `{commit, date, checks: {id: {seeded, n, referencePassRate, mutants: {name: failRate}}}}`;
  - **CI** (`verify:labs`) requires the file for every v2 lab, `referencePassRate = 1` for each seeded check, and each listed mutant failing at least one required check at a rate ≥ 0.99;
  - **a seeded check that cannot reach 1.0** either rejects and redraws inside the harness (deterministic from the seed) or is declared `seeded: false`.
- **Speed:** calibration costs ~0.7 ms per seed per check in Bun (prototype), so 10,000 seeds per check take seconds.

### 12.5 The lab 01 finding, and its repair

**Measured on this branch** (a scratch copy of `labs/rust-allocator`, native `cargo test`):

| Allocator | boot | align | no_overlap | coalesce | reuse | fragmentation |
|---|---|---|---|---|---|---|
| first-fit + split + coalesce (the intended design) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| the same **without coalescing** | ✓ | ✓ | ✓ | **✓** | ✓ | **✓** |
| bump | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |

**Why coalescing goes untested:**
- `coalesce` frees 16 × 4 KiB at the heap's start and asks for 64 KiB, but 960 KiB of never-touched tail serves the request.
- `fragmentation` (≈ 45 % occupancy, 64–2,048 B) never needs coalescing either: the prototype's non-coalescing allocator passed 5,000 of 5,000 random seeds.

The lab's stated lesson ("Neighboring free spans must coalesce, or check 4 and 6 will eat you", `allocator.rs` header; the `labs.ts` brief "A coalescing free-list walks through. That gap is why real allocators coalesce") is therefore not assessed. This is the lab analogue of the Capstone one-token mutant (F7).

**Repair** (C1's pilot crate; check ids unchanged):
- **`coalesce`:** first exhaust the tail with a guard allocation, then free 16 adjacent 4 KiB blocks and request 64 KiB. Add a three-way merge case: free left, then right, then the middle block.
- **`fragmentation`:** re-tune occupancy and the size mix (for example ~75 % occupancy with bimodal sizes and periodic large requests) until calibration shows the reference at 1.0 and the non-coalescing mutant failing ≥ 99 % of seeds.
- **Private mutant matrix** (`labs/_solutions/rust-allocator/mutants/{nocoal,bump,nosplit,misalign,overlap}.rs`): each must fail ≥ 1 required check, on default seeds and on 1,000 fresh seeds; recorded in `calibration.json`.
- **Copy:** `allocator.rs`'s header and the `labs.ts` brief say which check catches which mistake.

### 12.6 Migrating all 18 crates

| Group | Work |
|---|---|
| kit + lab 01 (C1) | kit v2; lab 01 `CHECKS`; the repair (§12.5); `probe` on a new `ks_invoke` (`probe <seed>` → `ops=200 live=… largest_free=… frag=…`); stages 1–4 (§13.1) |
| R1–R5, R6–R10 (C12a, C12b) | Today each check uses one literal input (`r1-bindings/src/lib.rs:8–15`, "returning the literal passes"). v2: each check draws 8 inputs from the seed and compares with the harness's own expected value (a different, simple construction), so a returned literal fails. One stage per check, in order. Calibration, plus a "returns the default-seed literal" mutant |
| labs 02–04 (C12c) | seeds into the existing gauntlets (`kv-block-manager` 2,000-op churn, `mpmc-queue`, `bpe-tokenizer` round-trip corpus); add `probe` to bpe; kv and mpmc already have `ks_invoke` |
| labs 05–08 (C12d) | seeds where a gauntlet exists; `batching-scheduler`'s calibrated replay traces stay `seeded: false` (their floors are calibrated tables, labs/README "Lab 06 trace calibration"), while its synthetic overload scenario gains a seeded twin with calibration; add `probe` to executor, radix and xgrammar |

**Every crate also:**
- passes `verify-wasm-lab … expect-trap` (each required check traps individually on the template) and `expect-reference`;
- keeps check ids identical to `labs.ts`, and its `stage` values must match `labs.ts`.

### 12.7 Amendments to PLAN-WORLDCLASS §10 and verify-wasm-lab

**PLAN-WORLDCLASS §10, first bullet**, replaced by C1:

> Template crate compiles clean with zero wasm imports. Under ABI v2 each required check reports `trap` ("not implemented yet" plus the panic text) **individually**; the run is never one whole-module trap. The reference solution is N/N green in `cargo test` on default seeds and on 32 extra seeds, and calibrated (`labs/<lab>/calibration.json`) on fresh seeds. A `--features reference` build reports `<id>@reference` and earns no credit. Check ids and stages match `src/data/labs.ts` and the module's `list` reply verbatim. `bun scripts/verify-wasm-lab.ts <wasm> expect-pass|expect-trap|expect-timeout|expect-reference [--seeds default|fresh|<n>] [--check <id>=pass|fail|trap|timeout]…`. `python3 scripts/pack-labs.py` ships templates and the agent kit only; audit every zip for `_solutions`/`target/` leakage.

**verify-wasm-lab modes.**
- `expect-trap`: for v1, as today; for v2, `list` succeeds and every required check traps individually.
- `expect-pass`: all required checks pass on default seeds; with `--seeds <n>`, also on n fresh seeds each.
- `expect-reference`: the lab id ends with `@reference` and `creditFor` is none.
- `--check` asserts per-check statuses.

**CI.** The `labs` job (reserved by B1, filled by C1) runs `bun run verify:labs`:
- for all 18 crates: build the template (`expect-trap`) and the `--features reference` build (`expect-reference`);
- assert zero imports, `list` ids equal to `labs.ts`, and a calibration file;
- assert zips are fresh (C18).
- Rust 1.96 and `wasm32-unknown-unknown`, pinned, with cargo caching; under 6 minutes.
- **Not part of the deploy fast gate** (< 3 min); it blocks PRs that touch `labs/` or `src/lib/forge/`.

---

## 13. Lab 01 with PRIMM, hints and Prove-it; guardrails in every zip

### 13.1 F2: PRIMM stages for lab 01 (`src/data/forge/rust-allocator/primm.ts`, `StagePanel.tsx`)

ForgeLab for `rust-allocator` gains a stage panel above the drop zone:

| Step | The learner | Evidence |
|---|---|---|
| **Predict** | before downloading: "A bump allocator runs check 6's churn: how many ops before it fails?" (estimate) and "which check fails first?" (choice) | `item item:lab01.primm.p1–p2` |
| **Run** | runs the **in-browser reference**: `world/heap` first-fit + coalesce on a churn of the same shape as check 6 (same occupancy and size range, its own seeded trace, labelled so). A live strip shows live bytes and the largest free run | `item` with the observed value |
| **Investigate** | 3–5 items on the harness: which check a non-coalescing allocator now fails (after the repair); `align_up(13, 8)`; why `coalesce` exhausts the tail first | `item item:lab01.primm.i1–i5` |
| **Modify** | changes one parameter of the reference run (occupancy 45 → 75 %, or first-fit → worst-fit), predicts the result, runs it | `item item:lab01.primm.m1` (`value`, `truth`) |
| **Make** | the TODO file in stages (below), each green in the browser before the next | `lab-check` events with `stage` |

**Stage markers in `allocator.rs`** (comments only; the signatures do not change):

| Stage | Size | Checks | Content |
|---|---|---|---|
| 1 | ≈ 2 min | `boot` | `new` plus a bump `alloc`. The two-minute win |
| 2 | ≈ 10 min | `align`, `no_overlap` | `align_up` and spans |
| 3 | ≈ 20 min | `reuse` | an address-ordered free list with first-fit and split |
| 4 | ≈ 25 min | `coalesce`, `fragmentation` | merge on free |

Every stage is ≤ 25 min (PLAN §5.0).

**Tiers:**
- **correct:** stages 1–4 green;
- **efficient:** the `profile` question, answered and recorded as an `item`;
- **survives:** the unseen-seed pass.

**Metric:** attempts-to-green per stage (the count of `lab-check` events until the stage is green), descriptive only.

### 13.2 H3: the authored hint ladder for lab 01 (`ladder.ts`, `HintLadder.tsx`, `scripts/lint-mentor.ts`)

Each required check id gets five rungs, unlocked in order:

| Rung | Content | Opens |
|---|---|---|
| R0 prompt-and-compare | "In two sentences: what does this check do to your allocator, and what did yours do?" Then three authored ideas to tick. Self-assessment, never credit | always first |
| R1 concept | ≤ 60 words, linked to the lesson H2 | any good-faith teach-back of ≥ 12 words in R0 |
| R2 where to look | ≤ 40 words: the check's message, the `lib.rs` lines | another red run or 2 minutes |
| R3 fragment | ≤ 3 lines of pseudo-code, never compilable Rust | R2 plus one more run |
| R4 design | ≤ 80 words of prose: data structure and invariants | explicit request |

**Bottom-out**, after R4 and 2 more red runs on that check:
- a **walkthrough to the first divergence**: the check's op sequence replayed with the in-browser reference beside the learner's last trace, using `ks_trace_drain` lines when the learner's code emits them;
- then "re-implement after a break". The H3 rule is "re-implement after ≥ 24 h, credited `assisted` until an unseen-seed pass":
  - runs inside the next 24 h are `assisted`;
  - an unseen-seed pass after that restores full credit.

**Ledger:**
- each rung opened: `ack hint:rust-allocator/<check>#R<n>`;
- the bottom-out: `ack …#bottom`.

**"Ask a human"** opens a prefilled GitHub Discussions post: category `labs`; title "[lab 01] <check id>: <first line of the failing message>"; the body carries the message and the learner's R0 text, **never their code**. The URL stays under 2 KB.

**`lint-mentor`** (`verify:mentor`, fast gate) checks:
- every required check of lab 01 has R0–R4 and three R0 ideas;
- the word limits;
- R3 is ≤ 3 lines with no `fn `, `impl `, `pub ` or `;`-terminated Rust statements;
- no rung quotes a `_solutions` file.

No hearts, no delays (PLAN §10).

### 13.3 H4 v1: Prove it, no AI (`prove.ts`, `ProveIt.tsx`)

- **When:** after all required checks are green.
- **What:** "Close your agent: 3 questions about your code." Three of six authored questions. For example:
  - "What does your `free` do when the span touches both neighbours?"
  - "Can your `align_up` overflow here, and why not?"
  - "What does your allocator do when a request is larger than every free run?"
- **Each question:**
  1. the learner writes ≥ 12 words;
  2. the model answer appears;
  3. the learner self-grades "got it" or "not yet".
- **Ledger:** `recordProve` with `score` = fraction "got it", `ok` = all answered, provenance `practice`.
  - Prove-it v1 counts toward neither rings nor VRK₃₀ (V6).
  - XP 5 minutes.
- **Later:**
  - one question returns as a Today item 30 days later (`item:lab01.prove.<qid>`, a constructed response);
  - retries use fresh questions after 24 h.
- **Metric:** ≥ 60 % of greens attempted (PLAN §9).

### 13.4 H1: the guardrail kit in every lab zip (`labs/agent-kit/*`, `pack-labs.py`, `verify-guardrails`)

`pack-labs.py` generates these files into **all 18 zips**:
- **`.claude/settings.json`:**
  - `permissions.deny` rules naming the crate's `TODO(you)` file (Edit, Write, MultiEdit, NotebookEdit);
  - a `PreToolUse` hook with matcher `Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__.*` running `sh .claude/hooks/ks-guard.sh` with a 10 s timeout;
  - `"outputStyle": "kernelspace-socratic"`.
  - The exact rule syntax is checked against the Claude Code docs (hooks, permissions, output styles) when C6 is built.
- **`.claude/hooks/ks-guard.sh`** (POSIX sh, no `jq`), which **fails closed**:
  - it reads the hook JSON from stdin;
  - `KS_SOLO=0` → allow;
  - an edit tool whose `file_path` ends with the protected file → exit 2;
  - `Bash` whose command mentions the protected file's basename, unless it matches a read-only allow-list (`cat`, `head`, `tail`, `less`, `grep`, `rg`, `wc`, `git diff|log|show|status`, `cargo test|build|check|clippy`) → exit 2;
  - an `mcp__*` tool whose input mentions the basename → exit 2;
  - an unparseable payload → exit 2.
  - The message: "kernelspace: <file> is yours to write. Ask about the failing check instead: name it, its invariant and your hypothesis. Set KS_SOLO=0 to turn this guard off."
  - **If the hook cannot run at all** (no `sh`), Claude Code treats that as non-blocking; the deny rules still stop Edit and Write. "Friction, not DRM" (PLAN H1).
- **`.claude/output-styles/kernelspace-socratic.md`:** Socratic rules, the explanation gate, never writing the TODO file, fragments of ≤ 3 lines.
- **`AGENTS.md`**, generated per lab from `AGENTS.template.md`:
  - the lab, its TODO file and **its real check ids with labels**, which replace today's generic "six checks" (`labs/AGENTS.md:9,14`; R drills and lab 02 differ);
  - **the explanation gate**: "before any hint, have the student state the failing check id, the invariant it tests and their hypothesis";
  - the ladder order;
  - the **AI-use card**, labelled "hypotheses from a small preprint (N=52; groups n=2–7; speed-incentivised)";
  - an explanation of the guard.
- **`CLAUDE.md`** = `@AGENTS.md`.

**`verify-guardrails`** (fast gate) unzips each of `public/labs/*.zip` and checks:
- all five files are present;
- `settings.json` names that zip's TODO file;
- `AGENTS.md` lists exactly the lab's required check ids;
- the hook passes a fixture matrix under `sh`:
  - deny an Edit of the file;
  - deny `sed -i … allocator.rs`;
  - allow `cargo test`;
  - allow an Edit of `README.md`;
  - deny an unparseable payload;
  - allow with `KS_SOLO=0`.

**Metric:** 18/18 zips compliant.

---

## 14. Capstone Zero sandbox, meta CSP, giscus

### 14.1 The sandbox (`public/capstone-sandbox.html`, `src/workers/capstone.worker.ts`, `src/lib/capstone/{steps,sandbox}.ts`)

**Today.** Learner JS runs through `new Function` on the main thread (`Capstone.tsx:84–89`) with the page's origin. An infinite loop hangs the tab, and the code can read the ledger's IndexedDB and post to `kernelspace:ledger`.

**Design** (PLAN §7.3):
- `Capstone.tsx` mounts `<iframe sandbox="allow-scripts" src="/capstone-sandbox.html">` with **no `allow-same-origin`**. The frame has an opaque origin: no app storage, IndexedDB, BroadcastChannel or cookies.
- The frame's classic script (`/capstone-sandbox.js`, same-site) receives the worker source **as a string** from the parent: the parent fetches the Vite-built `capstone.worker` chunk by its `?url`. The frame creates a Blob-URL worker from it and relays jobs.
- **It terminates and respawns the worker when a job exceeds 2 s.** The parent also drops and recreates the frame if a job gets no answer within 4 s.
- **Messages:**
  - the parent accepts only from `iframe.contentWindow`, with a per-job nonce;
  - the frame accepts only from `window.parent`;
  - payloads are structured-clone data only (code string, step id → check results and metrics).
- **The worker bundle** holds `engine-core`, `capstone-checks` and the step check definitions. Those move out of `Capstone.tsx`'s `STEPS` into `src/lib/capstone/steps.ts`, a pure module the page also imports for labels.
- **Learner code runs** through `new Function` inside the worker. Step 5's speedup is measured there, from the learner's own code (F7 kept).
- **`verify-capstone`** keeps running every step's checks under Bun against the reference and the mutants. A protocol test round-trips a job through a fake frame.

**Opus spike first** (C5, §18):
- confirm Blob-URL workers and `new Function` inside a sandboxed opaque-origin frame on Chrome, Firefox and Safari, desktop and iOS;
- confirm `'self'` script loading from an opaque-origin document.
- **Documented fallback** if a browser refuses: a parent-created dedicated worker that deletes `indexedDB`, `caches`, `BroadcastChannel` and `fetch` from its global scope before running learner code. This is weaker and labelled so.

### 14.2 Meta CSP

Injected into `index.html` **at build time only** (a small `transformIndexHtml` plugin with `apply: 'build'`, because Vite's dev server needs inline scripts):

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' https://giscus.app;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https:;
connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co;
worker-src 'self' blob:;
frame-src 'self' https://giscus.app;
object-src 'none'; base-uri 'self'; form-action 'self'
```

- **No `'unsafe-eval'`:** the Capstone's `new Function` moved to the sandbox. `'wasm-unsafe-eval'` covers Forge, Fleet and the real engine.
- **`'unsafe-inline'` for styles** stays, for Radix and React style injection: low risk, and needed.
- **Meta CSP does not govern workers.** `gen-worker.js` imports transformers.js from jsdelivr inside its own worker. `frame-ancestors` cannot be set by a meta tag.
- **Disclosed third parties** (PLAN §7.3): Google Fonts, the transformers.js CDN, giscus and GitHub.
- **Acceptance:** a manual matrix (Chrome, Firefox, Safari) loads the routes listed in §16.2 plus the real-engine panel with **zero CSP violations** in the console, recorded in the PR.

### 14.3 giscus, click to load (`src/components/community/Discussion.tsx`, `src/data/community.ts`)

- **Where:** "Discuss on GitHub" sits at each lesson's end, mounted by B25 from a stub B1 creates, and on ForgeLab (C17).
- **Before the click:** a button, **"Load the discussion (GitHub via giscus, a third party)"**. **No request goes to giscus.app or GitHub before the click.**
- **On click**, the giscus script is injected with:
  - `data-repo="praveer13/kernelspace"`, `data-repo-id` and `data-category-id` from `community.ts`;
  - `data-mapping="specific"`, `data-term="lesson:<id>"` (or `lab:<id>`), `data-strict="1"`;
  - reactions off, `data-loading="lazy"`, the theme matched.
- **"Always load on this device"** is remembered in `localStorage` (`ks:giscus`), never in the ledger.

**Owner actions:**
1. enable Discussions on `praveer13/kernelspace`;
2. install the giscus GitHub App on the repository;
3. create categories **Lessons** (Announcements type, so only maintainers and giscus open threads) and **Labs** (Q&A, the H3 "Ask a human" target);
4. copy the repository id and the category ids from giscus.app into `src/data/community.ts`;
5. confirm moderation: maintainer only, inside the weekly ≤ 1.5 h triage (PLAN §8.2).

---

## 15. Wave 0b follow-ups that land here

### 15.1 Admitted learner wasm on /fleet and the leaderboard harness (C4)

**Today:** after a module passes admission in the lab worker, the Fleet panels instantiate it **on the main thread** and drive it every 60 ms (`EnginePanel.tsx:93–95,165`; `ClusterPanel.tsx:67–72`; `EpdPanel.tsx:71–75`; pool mode `Fleet.tsx:199–318`). `verifyAndScoreScheduler` does the same (`leaderboard.ts:448–468`). A module that spins after admission hangs the tab.

**Design:** `src/workers/fleet.worker.ts`, `fleet-protocol.ts` and `src/lib/fleet-session.ts`.
- **A session holds one `Engine`, `Cluster` or `EpdCluster`** with its drivers. Learner modules are instantiated **inside the worker** from slot bytes; JS reference drivers live there too.
- **Commands**, each structured-clone data:
  - `open {mode, slots, traffic, cfg}` → `ready`;
  - `step {ticks}` → `{tick, mine, reference, dump, divergence?, violations, done}`;
  - `pool {ops}` (pool-mode conformance) → per-op results;
  - `close`.
- **Watchdog:**
  - every command has a budget: `open` 5 s including instantiation; `step` 2 s per batch;
  - on expiry the client terminates the worker and rejects with `FleetTimeoutError` ("your scheduler stopped responding at tick 412");
  - the panel offers "reset with reference drivers".
- **The panels keep their UI and cadence** and call `await session.step(n)` instead of `engine.step()`.
- **The leaderboard harness** runs as a one-shot job in the same worker with a 10 s budget. `scripts/build-leaderboard.ts` calls it through the worker under Bun.
- **`validateModule`** also rejects `@reference` modules.

**Tests:** client timeout and respawn with an injected fake worker; session determinism (a session's `step` sequence equals a direct `Engine` run on the same inputs).

### 15.2 QuizBlock restores its submitted state after a reload (B8)

**Restore on mount.**
- QuizBlock reads the lesson's latest attempt group, its `quiz` event plus the matching `item` events (`LedgerClient.events({kinds: ['item', 'quiz']})`, filtered by lesson and `grp`).
- **When every item's `rev` matches the current question,** it renders that attempt submitted: option order from the attempt's `seed`, picks from `data.pick`, the confidence, the verdicts and the whys.
- **When any rev differs,** it starts fresh with "this checkpoint changed since your last attempt".
- **Retry** works as today.

**Data:** item events also write `data.kcs` from `QuizQuestion.kcs`.

### 15.3 The Submit → Retry focus drop (B8)

- **The bug:** Submit unmounts, so focus falls to `<body>`.
- **After Submit:**
  - focus moves to the result header (`tabIndex={-1}`);
  - an `aria-live` region announces "3 of 4 right, pass" (or "retry");
  - the next Tab reaches Retry.
- **After Retry,** focus moves to the first question's first option.
- **The same rule** applies in ExitTicket, TestOut and Today.

---

## 16. Budgets, accessibility, determinism, tests

### 16.1 Budgets (gzip; `verify:bundle` walks the build manifest, ledger spec §12.4)

| Gate | Measured at 31468b1 | Wave 1 budget | Enforced by |
|---|---|---|---|
| entry chunk | **158.9 KB** | ≤ 250 KB; **target ≤ 125 KB after B2** | `verify:bundle` (fails) |
| `/boot` first-load closure (JS + CSS) | **197.9 KB** (+ 8.1 KB on demand) | ≤ 200 KB | `verify:bundle` (fails) |
| `/today` first-load closure | — | ≤ 200 KB | `verify:bundle` (fails; B2 adds the route) |
| `/play/block-placement` closure | — | ≤ 220 KB | `verify:bundle` (reported, not gated, in Wave 1) |
| each generator family chunk | — | ≤ 8 KB | reported |
| search index chunk | — | ≤ 15 KB | reported |
| FSRS + cards + composer (inside `/today`) | — | ≤ 6 KB | reported |
| ledger engine (lazy) | — | ≤ 30 KB | as in the ledger spec |

- **TTI ≤ 3 s** for `/boot` and `/today` on a mid-range phone at Fast 4G. Measured with Lighthouse's mobile profile and recorded in the B18 and B26 PRs.
- **The entry diet is a prerequisite**, not an optimisation. Without it, Today's whole UI must fit in ~17 KB.

### 16.2 Accessibility (WCAG 2.2 AA)

- **axe:** 0 serious or critical violations at 360 and 1280 px on the 12 routes of PLAN §7.3, plus `/play/block-placement` and `/forge/rust-allocator`.
  - Each UI PR attaches axe DevTools results for the routes it touches.
  - Playwright automation stays the plan's later step (§7.4).
- **WCAG 2.2 specifics:**
  - 2.5.8 target size: ≥ 24 px everywhere, 44 px for touch controls;
  - 2.4.11 focus not obscured: `scroll-padding` for sticky bars and the bottom tab bar;
  - 2.5.7 dragging: no drag-only interaction; the play is tap or keyboard;
  - 3.2.6 consistent help: the hint-ladder button sits in the same place on every check;
  - 3.3.7 redundant entry: tickets never re-ask what the learner just entered.
- **Feedback:** every graded result is announced through `aria-live`, and focus moves to the next control (§15.3).
- **Reduced motion:** `MotionScope` on every page that uses framer-motion, adopted by each page's owning task; CSS transitions honour `prefers-reduced-motion`.
- **Mirrors:** three canvases and the play (`verify-plays`).
- **Screen readers:** a VoiceOver (iOS) and NVDA (Windows) pass at the wave exit, over Boot → Today → T1.L4 (prequestions, play, ticket) → `/forge/rust-allocator`.

### 16.3 Determinism

`scripts/verify-determinism.ts` (B1, fast gate):
- **Scope:** `src/lib/items/families/**`, `src/lib/items/core.ts`, `src/lib/world/**`, `src/lib/fleet-*.ts` and `src/lib/learner/{composer,placement,ticket,paths,recommend}.ts`.
- **Forbidden there:** `Math.random`, `Date.now`, `new Date(` (time arrives as a parameter), `performance.now` and `crypto.getRandomValues`.
- **Also forbidden in `families/**` and `world/**`:** `Math.exp`, `log`, `log2`, `log10`, `pow`, `sin`, `cos`, `tan`, `atan2`, `cbrt` and `hypot`.
- **Exempt:** grading and statistics files (`grade.ts`, `staircase.ts`, `fsrs.ts`, `calibration.ts`), by path.
- **Hash fixture:** generator outputs for 100 seeds per family and variant are hashed into `tests/fixtures/items/hashes.json` and compared under Bun. Cross-browser comparison joins the nightly lane when Playwright lands (PLAN §7.4).

### 16.4 Tests and verify scripts

- **`bun run test` (fast gate) gains:**
  - `tests/ledger/contract-v31.test.ts`;
  - `tests/kc/*`;
  - `tests/items/*` (100 seeds per family);
  - `tests/learner/{fsrs,cards,composer,reentry,planner,ics,handoff,placement,recommend,paths,ticket,prequestions,today,outcomes}.test.ts`;
  - `tests/economy/*`;
  - `tests/world/*`;
  - `tests/sims/*`;
  - `tests/plays/*`;
  - `tests/forge/{abi,run,credit}.test.ts` (fake module objects; no wasm needed);
  - `tests/capstone/sandbox-protocol.test.ts`;
  - `tests/fleet/session.test.ts`;
  - `tests/guardrails/hook.test.ts`;
  - `tests/kc/scope.test.ts`.
- **Fast-gate verify scripts** (reserved by B1, filled by their owners):
  - `verify:kc`, `verify:generators`, `verify:determinism`, `verify:plays`, `verify:guardrails`, `verify:mentor`, `verify:search-index` (regenerate and diff);
  - `verify:bundle` (+ `/today`);
  - existing: `verify:items`, `-claims`, `-errata`, `-capstone`, `-traces`, `-leaderboard`, `-field-notes`.
- **`labs` workflow** (`.github/workflows/labs.yml`, path-filtered, < 6 min): `verify:labs` (§12.7).
- **Nightly:** `verify:generators --seeds 10000`, plus the existing `verify:seeds`.
- **Every task** runs `npm run lint`, `npm run build`, `bun run test` and every `verify:*` that exists. Never pipe them: piping masks exit codes (PLAN-WORLDCLASS §10).

---

## 17. Wave 1 exit criteria as checkable gates

PLAN §8's Wave 1 exit, restated so each line has a measurement.

| Gate | PLAN wording | Check |
|---|---|---|
| G1 | ≥ 5 partners complete the block-placement loop: prequestions → play → lab 01 stages → unseen-seed pass → Today | `selectLoopCompletion(events)` (C19). In time order:<br>1. a `pre:t1.l4#*` event;<br>2. an `ok` `play:block-placement` (phase play);<br>3. `lab-check` events reaching stage 4;<br>4. every lab 01 required check in `labs['rust-allocator'].unseen`;<br>5. a Today session containing a `frag`-family KC after the unseen pass.<br>`scripts/partner-report.ts <exports…>` prints the count over donated exports |
| G2 | first-review recall within ±10 pts of predicted | pooled `selectFirstReviewCalibration`: \|meanPredicted − observed\| ≤ 0.10 with n ≥ 100 first reviews, interval reported |
| G3 | a 7-day cold check | pooled accuracy of Today `probe` slots with `sinceDays ≥ 7`, n ≥ 50, with a Wilson interval. Reported; the pre-registered bar comes in Wave 2 |
| G4 | blind strategies ≤ 5/68 | `verify:items` blind-strategy simulation over all tracks after 1a: no strategy passes more than 5 lessons in expectation |
| G5 | per-check results | `verify:labs`: 18/18 templates list their checks and report every required check individually (`expect-trap`) |
| G6 | reference modules earn 0 | `verify:labs` `expect-reference` on 18/18, plus `tests/forge/credit.test.ts` (ForgeLab, `validateModule` and the leaderboard all deny) |
| G7 | median Today ≤ 12 min | the median over partner Today sessions of (last item `at` − first item `at` + last `ms`) |
| G8 | budgets (§7.3) | entry ≤ 250, `/boot` ≤ 200, `/today` ≤ 200 KB gzip, in CI |
| G9 | accessibility (§7.3) | 0 serious axe violations on the routes of §16.2; VoiceOver and NVDA passes recorded |
| G10 | queue gating (§8) | Wave 1's review queue < 10 h before Wave 2 starts |

**Partners** (PLAN OD10, 6 h of the wave) donate exports privately, with week-level dates and no free text. `partner-report` strips `explain`, `boot:value` and constructed-response text before counting.

---

## 18. Task DAG for Sonnet implementers

### 18.1 How the two PRs fit together

- **One PR per task** into its wave branch. **Within a level, tasks never touch the same file.** A task may create a file another task later owns: that is a sequential hand-off, never parallel editing.
- **Branches:**
  - `wave-1b` branches from `wave-1a` once 1a's content has merged.
  - `wave-1c` branches from `wave-1b` once **1b level 0 (B0–B3)** has merged.
  - 1c may merge `wave-1b` forward later; it never merges the other way. C17 and C19 do so for B7 and B12.
  - **1b merges to `master` first.**
- **Checks for every task:** `npm run lint`, `npm run build`, `bun run test` and every existing `bun run verify:*`, run bare (not piped). UI tasks also attach axe results at 360 and 1280 px, and the keyboard path.
- **Opus first** marks a task whose design needs an Opus decision, prototype or review before (or while) a Sonnet implementer builds it.

```
        tasks in a level run in parallel (∥); * = Opus first; → = must follow
1b  L0: B0 ∥ B1 ∥ B2 ∥ B3                              ← wave-1c branches here
    L1: B4* ∥ B5 ∥ B6 ∥ B7 ∥ B8
    L2: B9 ∥ B10 ∥ B11 ∥ B12 ∥ B13 ∥ B14 ∥ B15 ∥ B16 ∥ B17   (B14–B17 after B4's Opus review)
    L3: B18 ∥ B19 ∥ B20 ∥ B22* ∥ B23 ∥ B24
    L4: B21 ∥ B25 ∥ B26
1c  L0: C1* ∥ C2 ∥ C3* ∥ C4 ∥ C5* ∥ C6
    L1: C7 ∥ C8 ∥ C9 ∥ C10 ∥ C11 ∥ (C12a → C12b) ∥ C12c ∥ C12d ∥ C13 ∥ C14 ∥ C15 ∥ C16
    L2: C17 ∥ C18 ∥ C19
```

### 18.2 PR 1b: the learning engine (V4, K1, K2, K3, V5 tickets and RING 2, P1)

**Level 0**

**B0 · Ledger contract v3.1.** M. Depends: this spec.
- **Files:**
  - `src/lib/ledger/{constants,refs,codec,fold,view,engine,client}.ts`;
  - `src/lib/ledger/types.ts`: merge `LedgerFacadeActionsV31` into `LedgerFacadeActions`; Aggregate v2; `QuizResponse.kcs?`; `exportV3({sinceAt?})`;
  - `src/lib/progress.ts`: the new actions, `LessonStatus` `'read'`, `upgradeAggregate` at hydrate, immediate engine boot after an upgrade;
  - `tests/ledger/{contract-v31.test.ts (new), gen.ts, fold.test.ts, codec.test.ts, facade.test.ts}`.
- **Accept:**
  - §3 as specified;
  - the existing property suite passes at 100 seeds × 40 ops with every Wave 1 action added to the op generator;
  - the outbox keeps every new event shape;
  - a v1 snapshot hydrates through `upgradeAggregate`, with no empty first paint;
  - the Wave 0b fixture reads as `read` and `done` (§3.6);
  - entry growth ≤ 2 KB gzip, reported.
- **Note:** XP stays v1 until B7.

**B1 · Scaffold.** M. Depends: this spec.
- **Files:**
  - `src/pages/lesson/blocks.tsx`: move `DiagramView` → `src/pages/lesson/diagram.tsx` and `ExerciseView` → `src/pages/lesson/exercise.tsx`. `RenderBlock` routes `predict`, `play`, and `quiz`-with-`ticket` to lazy stubs;
  - new stubs, each exporting its final props type and rendering a placeholder:
    - `src/components/blocks/{Prequestions,PlayBlock}.tsx`;
    - `src/components/learner/ExitTicketBlock.tsx`;
    - `src/components/community/Discussion.tsx`;
    - `src/pages/{Today,Play}.tsx`;
  - `src/App.tsx`: `/today` and `/play/:playId`;
  - `scripts/prepare-pages.mjs`: `today`, `play/block-placement`;
  - `package.json`: `verify:kc`, `-generators`, `-determinism`, `-plays`, `-guardrails`, `-mentor`, `-labs`, `-search-index`;
  - stub scripts `scripts/verify-{kc,generators,plays,guardrails,labs,search-index}.ts`, `scripts/lint-mentor.ts` and `scripts/build-sw-manifest.ts`, each exiting 0 with "pending: <task id>";
  - the **real** `scripts/verify-determinism.ts` (§16.3);
  - `.github/workflows/{ci,deploy}.yml`: fast-gate steps, plus the sw-manifest step after build in deploy;
  - new `.github/workflows/labs.yml`: pinned Rust 1.96 + `wasm32-unknown-unknown` + Bun, `bun run verify:labs`, with a path filter;
  - `scripts/export-lessons-md.ts`: `predict` and `play` cases, answers withheld.
- **Accept:**
  - the build is green and existing routes render as before;
  - `/today` and `/play/block-placement` render placeholders;
  - the exporter output is byte-identical for today's lessons;
  - `verify:determinism` passes on current code.

**B2 · Entry diet and bundle gates.** S–M. Depends: this spec.
- **Files:**
  - `src/components/{Layout,Navbar,StatusBar,ProgressRing,CommandPalette}.tsx`;
  - new `src/components/CommandPaletteHost.tsx` (key listener plus lazy mount, prefetched on idle);
  - new `src/lib/motion.tsx` (`MotionScope`);
  - `scripts/verify-bundle.ts`: the `/today` budget; reports for families, the index and the play;
  - `tests/boot/imports.test.ts`: no entry module imports `framer-motion` or `fuse.js`.
- **Accept:**
  - entry ≤ 125 KB gzip and `/boot` ≤ 165 KB gzip, both printed in the PR;
  - the nav and status bar look the same, with CSS transitions;
  - ⌘K, Ctrl+K and `/` open the palette, in ≤ 300 ms on a cold first open.

**B3 · Wave 1 claims.** S, plus owner time to verify sources. Depends: this spec.
- **Files:**
  - `src/data/claims/models.ts`: Llama-3-70B, Qwen3-0.6B and Mixtral-8x7B `layers`, `kv-heads`, `attn-heads`, `head-dim`, quoted from `config.json`;
  - new `src/data/claims/production.ts`: vLLM's default KV block size and V1 recompute preemption; glibc malloc's bins and `mmap` threshold; jemalloc's size classes;
  - `src/data/claims/index.ts`;
  - `public/claims.json`, if `verify:claims` requires it.
- **Accept:** `verify:claims` passes; every claim has a URL, a quote and `verifiedAt`; the owner signs off the quotes.

**Level 1** (after B0–B3)

**B4 · KC graph v1.** M, plus content. **Opus first:** review the drafted list (granularity, thresholds, confusable sets, R-pairing edges) before B14–B17 start tagging. Depends: B0.
- **Files:**
  - `src/data/kc/{index,r,t0,t1,t2,t4,t5,notional,migrations,ref-map}.ts`;
  - `src/lib/kc/{graph,resolve}.ts`;
  - `scripts/kc/seed-candidates.ts`;
  - `scripts/verify-kc.ts`;
  - `tests/kc/{graph,resolve,verify}.test.ts`.
- **Accept:**
  - §4.1–4.8;
  - every id in `ids.ts` is defined;
  - coverage is enforced for each lesson that sets `Lesson.kcs` (lessons opt in; B25's scope test requires all 29);
  - resolve covers the rev-matched tag, the write-time fallback and migrations.

**B5 · Generator framework.** M. Depends: B0.
- **Files:**
  - `src/lib/items/{core,grade,staircase,registry,units}.ts`, where `registry` discovers families with `import.meta.glob('./families/*.ts')`, so families never edit it;
  - `scripts/verify-generators.ts`;
  - `tests/items/{core,grade,staircase}.test.ts`.
- **Accept:**
  - §5.1–5.4 and §5.6, running over whatever families exist (zero at first);
  - Winkler and ratio-rule unit tests;
  - the staircase converges to 0.79 ± 0.03 on a simulated learner.

**B6 · FSRS-6 core.** S. Depends: this spec.
- **Files:** `src/lib/learner/fsrs.ts`; `tests/learner/fsrs.test.ts`; `tests/fixtures/fsrs/{vectors.json,generate.ts,README.md}`. The generator runs ts-fsrs 5.4.2 from a scratch directory.
- **Accept:** ADR-2; 2,000 vectors within 1e-8; `package.json` unchanged.

**B7 · Economy v2 and rings.** M. Depends: B0.
- **Files:**
  - `src/lib/economy.ts`;
  - new `src/lib/economy-table.ts`;
  - `src/lib/ledger/{constants,view}.ts`: XP through economy v2;
  - `tests/economy/{xp,rings,table}.test.ts`.
- **Accept:**
  - §8.4–8.5;
  - the table equals `labs.ts` (required checks, minutes);
  - XP is order-insensitive, with the daily cap;
  - the `XP` export keys are preserved;
  - RING 2 fixtures pass;
  - a synthetic year prints its XP split by source.

**B8 · QuizBlock follow-ups.** S. Depends: B0.
- **Files:** `src/components/QuizBlock.tsx`.
- **Accept:**
  - §15.2–15.3;
  - a reload after Submit shows the submitted attempt;
  - after Submit, focus lands on the result header;
  - item events carry `data.kcs`.

**Level 2**

**B9, B10, B11 · The `frag`, `kv` and `roofline` families.** S–M each. Depend: B5 (B10 also B3).
- **Files:** `src/lib/items/families/<family>.ts`; `tests/items/<family>.test.ts`; that family's rows in `tests/fixtures/items/hashes.json`. Hash rows are keyed per family, so the three tasks merge independently: each adds its own rows.
- **Accept:**
  - §5.5: every variant at levels 0–3, the ratio rules, the pins;
  - `verify:generators` passes at 1,000 seeds;
  - the chunk is ≤ 8 KB gzip.

**B12 · Cards, composer, planner, re-entry, handoff.** M. Depends: B6, B5; B4's `resolve` (injected, so this task can start against a stub).
- **Files:** `src/lib/learner/{cards,composer,planner,reentry,ics,handoff}.ts`; `tests/learner/{cards,composer,planner,reentry,ics,handoff}.test.ts`.
- **Accept:**
  - §6.2–6.6;
  - properties on generated ledgers: due before not-due; priority first; threshold before other due cards; confusable adjacency only; debt pauses creation; re-entry spreads over 14 days and exposes no overdue count;
  - the cap never exceeds 1.2 cards/day averaged over any 30-day window;
  - deterministic per seed.

**B13 · The item player.** M. Depends: B5.
- **Files:**
  - `src/components/items/{ItemCard,ChoiceAnswer,NumericAnswer,EstimateAnswer,ConstructedAnswer,Feedback,PromptView}.tsx`;
  - `src/lib/items/play.ts` (adapters for `quiz`, `cr` and `item` sources);
  - `tests/items/play.test.ts`.
- **Accept:**
  - every `PlayableItem` source renders and grades;
  - keys A–D, 1–3, Enter and Escape;
  - `aria-live` verdicts;
  - 44 px targets;
  - no horizontal scroll at 360 px.

**B14, B15, B16, B17 · Content for T0, T1, T2 and R.** S–M each, mostly owner content time. Depend: B4 (after its Opus review).
- **Files:**
  - B14: `src/data/lessons/t0/*.ts`; B15: `t1/*.ts`; B16: `t2/*.ts`; B17: `r/*.ts` plus new `src/data/placement/anchors.ts`;
  - the matching `public/lessons-md/*.md`.
- **Each task:**
  - `QuizQuestion.kcs` on every item;
  - `Lesson.kcs`.
- **Track-specific:**
  - T0, T1 and T2: `ticket` (`cr` ≥ 1).
  - T2 only: t2.l7 gets `form: 'spiral'` with ≥ 4 `spiral` items.
  - T0 and T1: a `predict` block (2 prequestions) and `predictAt` on their diagrams (t0.l2, t0.l4, t0.l6, t1.l1, t1.l3, t1.l4).
  - B15 adds the `play` block to t1.l4 and the allocator exercise `taskIds` from §10.2 (t1.l3, t1.l4).
  - B17 adds 4 Rust anchors.
- **Accept:**
  - `verify:kc` and `verify:items` pass;
  - the exporter is fresh;
  - the owner reviews every prequestion, constructed response and anchor.

**Level 3**

**B18 · Today.** M–L. Depends: B12, B13, B9–B11, B7.
- **Files:**
  - `src/pages/Today.tsx` (replaces the stub);
  - `src/pages/today/{Header,Session,DoneCard,EmptyState,WeekSheet,HandoffButton}.tsx`;
  - `src/lib/learner/today.ts`;
  - `tests/learner/today.test.ts`.
- **Accept:**
  - §6.3–6.8;
  - the `/today` closure ≤ 200 KB, printed;
  - a stopwatch session ≤ 12 min, recorded;
  - axe at 360 and 1280 px;
  - `MotionScope` where motion is used.

**B19 · Exit tickets, the spiral checkpoint, test-out.** M. Depends: B13, B9, B0.
- **Files:** `src/lib/learner/ticket.ts`; `src/components/learner/{ExitTicket,ExitTicketBlock,TestOut}.tsx`; `tests/learner/ticket.test.ts`.
- **Accept:**
  - §7.2 and §8.1–8.2;
  - pass rules unit-tested;
  - "new numbers" and "continue anyway" are both always offered;
  - a miss never locks;
  - one test-out per lesson per day.

**B20 · Prequestions and `predictAt`.** S–M. Depends: B13, B1.
- **Files:** `src/components/blocks/Prequestions.tsx`; `src/pages/lesson/diagram.tsx`; `src/lib/learner/prequestions.ts`; `tests/learner/prequestions.test.ts`.
- **Accept:**
  - §9;
  - the reveal at `revealAt` or the ticket;
  - captions hidden until the commit;
  - the expert skip.

**B22 · `recommend()`, paths and the braid.** M. **Opus first:** approve the generated full-ramp braid for R + T0–T2 (printed by a test) before the UI uses it. Depends: B4, B12, B7.
- **Files:** `src/lib/learner/{recommend,paths}.ts`; `src/components/learner/UpNextCard.tsx`; `tests/learner/{recommend,paths}.test.ts`.
- **Accept:**
  - §7.3;
  - never more than 2 consecutive R lessons;
  - every R lesson sits immediately before its first dependant;
  - placed learners never get `r.l1` unless the anchor was missed;
  - the why line is ≤ 90 characters.

**B23 · The service worker.** M. Depends: B1.
- **Files:** `public/sw.js`; `scripts/build-sw-manifest.ts` (replaces the stub); `src/main.tsx` (registration, `?nosw=1`); `tests/sw/manifest.test.ts`.
- **Accept:**
  - the four rules of §6.10;
  - Today works offline after one visit (manual: airplane mode on Android Chrome and iOS Safari);
  - the kill switch is verified by deploying it to a preview.

**B24 · ⌘K index.** S–M. Depends: B2, B4, B14–B17.
- **Files:** `scripts/build-search-index.ts`; `src/data/search-index.json`; `src/components/CommandPalette.tsx`; `src/components/ClaimsTable.tsx` (row ids); `scripts/verify-search-index.ts`.
- **Accept:**
  - §7.4;
  - "PagedAttention", "KV cache" and "ridge" find lessons, KCs and claims;
  - the index chunk ≤ 15 KB gzip;
  - CI fails on a stale index.

**Level 4**

**B21 · The placement walk.** M. Depends: B13, B4, B9–B11, B17, B22.
- **Files:**
  - `src/lib/learner/placement.ts`;
  - `src/components/learner/PlacementWalk.tsx`;
  - `src/pages/Curriculum.tsx`: replaces `PlacementModal`; the "current" marker from `paths`; the *read* state;
  - `tests/learner/placement.test.ts`.
- **Accept:**
  - §7.1;
  - ≤ 20 items;
  - deterministic per seed;
  - an always-B or always-longest learner places no further than T0;
  - the result is stored and its cards carry `confirmDay`.

**B25 · Lesson page v2.** M. Depends: B19, B20, B22, B7.
- **Files:**
  - `src/pages/Lesson.tsx`: `m`, the ticket CTA, the toast, Up Next, test-out, `Discussion`, `MotionScope`;
  - `src/pages/lesson/LessonRow.tsx`;
  - `src/pages/Track.tsx`: lesson states, notional card;
  - `tests/kc/scope.test.ts`: all 29 R and T0–T2 lessons have `kcs`; T0–T2 have `ticket`; T0–T1 have a `predict` block.
- **Accept:** §8.2–8.3, plus the scope test.

**B26 · IA, Home, Progress.** M. Depends: B2, B7, B18, B22.
- **Files:**
  - `src/components/{Navbar,StatusBar,Layout}.tsx`;
  - new `src/components/BottomTabs.tsx`;
  - `src/pages/Home.tsx`;
  - `src/pages/Progress.tsx`: the RING 2 checklist, an XP explainer, first-review calibration, the week, handoff;
  - `src/pages/boot/You.tsx`: "Go to Today";
  - `MotionScope` in `src/pages/{Glossary,Lab,Changes,FleetWeek}.tsx`.
- **Accept:**
  - §6.9 and §8.5;
  - Navbar and StatusBar read only the snapshot (the imports test);
  - the `/boot` closure is still ≤ 200 KB.

### 18.3 PR 1c: play and forge (SimHost, P2, phone mode, mirrors, W1, F1, F2/H3/H4/H1 for lab 01, Capstone sandbox and CSP, giscus)

**Level 0** (from `wave-1b` after B0–B3)

**C1 · Template v2: kit, host and lab 01 pilot.** L. **Opus first:** sign off the lab 01 repair and the seed-calibration policy once the mutant matrix has run (§12.4–12.5). Depends: B0.
- **Files:**
  - `labs/kit/{Cargo.toml,src/lib.rs}`;
  - `labs/rust-allocator/{src/lib.rs,tests/allocator_tests.rs,calibration.json}`;
  - `src/lib/forge/{abi,run}.ts`;
  - `src/lib/{wasm-lab,lab-worker}.ts`;
  - `src/workers/{lab.worker,lab-protocol}.ts`;
  - `scripts/{verify-wasm-lab,verify-labs,calibrate-lab-seeds}.ts`;
  - `tests/forge/{abi,run,credit}.test.ts`;
  - `PLAN-WORLDCLASS.md` (the §10 bullet);
  - `labs/README.md`.
- **Accept:**
  - §12.1–12.5 and §12.7;
  - the prototype's behaviours, as tests;
  - `runLabInWorker` and `instantiateLab` keep their v1 signatures;
  - lab 01's mutants fail as specified;
  - the `labs` workflow passes for the pilot crate (the other crates run in v1 mode until C12).

**C2 · SimHost, the registry, TaskPanel, embed, phone mode, SimMirror.** L. Depends: B0, B1.
- **Files:**
  - `src/components/sims/{SimHost,TaskPanel,SimMirror,PhoneOutcome}.tsx`;
  - `src/lib/sims/{host,registry}.ts`, where `registry` discovers `*.tasks.ts` with `import.meta.glob`;
  - `src/components/sims/PlaygroundShell.tsx`;
  - `src/pages/Playground.tsx`;
  - `src/pages/lesson/exercise.tsx`;
  - `scripts/verify-plays.ts`: the canvas-mirror check of §10.5 (C11 adds the play checks later);
  - the waiver comment in the nine canvas sims' files (`src/components/sims/{RooflineSim,LatencyWalk,LayoutLab,BatchingSim,ContentionLab,MatrixBench,QuantizerSim,SchedulerLab,WgslSim}.tsx`);
  - `tests/sims/{registry,host,taskpanel}.test.ts`.
- **Accept:**
  - §10.1–10.4;
  - lab mode is byte-for-byte today's URL behaviour;
  - embed mode never writes the URL (tested);
  - completion requires a committed prediction.

**C3 · World core.** M. **Opus first:** run the root-cause rule (§11.2) on 50 banded seeds and approve the debrief sentences before C11 builds the UI. Depends: this spec.
- **Files:** `src/lib/world/{heap,placement,policy,play,traces}.ts`; `tests/world/*.test.ts`.
- **Accept:**
  - §11.2–11.3;
  - the equivalence test on 1,000 seeds;
  - the band's acceptance rate is reported;
  - deterministic.

**C4 · Fleet and leaderboard worker sessions.** M. Depends: this spec.
- **Files:**
  - `src/workers/{fleet.worker,fleet-protocol}.ts`;
  - `src/lib/fleet-session.ts`;
  - `src/pages/fleet/{EnginePanel,ClusterPanel,EpdPanel}.tsx` and `src/pages/fleet/drivers.ts`;
  - `src/pages/{Fleet,Leaderboard}.tsx`;
  - `src/lib/leaderboard.ts`;
  - `scripts/build-leaderboard.ts`;
  - `tests/fleet/session.test.ts`.
- **Accept:**
  - §15.1;
  - a spinning module in the browser leaves the page responsive and reports the tick;
  - leaderboard scores are identical to today's for the reference.

**C5 · Capstone sandbox and CSP.** M. **Opus first:** the cross-browser spike (§14.1). Depends: this spec.
- **Files:**
  - `public/capstone-sandbox.{html,js}`;
  - `src/workers/capstone.worker.ts`;
  - `src/lib/capstone/{steps,sandbox}.ts`;
  - `src/pages/Capstone.tsx`;
  - `src/lib/capstone-checks.ts`;
  - `scripts/verify-capstone.ts`;
  - `vite.config.ts` (the CSP plugin, build only);
  - `tests/capstone/sandbox-protocol.test.ts`;
  - `tests/economy/capstone-table.test.ts` (step minutes equal `economy-table`).
- **Accept:**
  - §14.1–14.2;
  - a `while(true){}` in a step ends within 2.5 s with the page responsive;
  - learner code cannot see `indexedDB` (tested in the sandbox);
  - zero CSP violations in the manual matrix.

**C6 · H1 guardrail kit.** S–M. Depends: this spec.
- **Files:**
  - `labs/agent-kit/{settings.template.json,hooks/ks-guard.sh,output-styles/kernelspace-socratic.md,AGENTS.template.md}`;
  - `labs/{AGENTS,CLAUDE}.md`;
  - `scripts/pack-labs.py`, which reads check ids through `bun scripts/dump-labs.ts`;
  - new `scripts/dump-labs.ts`;
  - `scripts/verify-guardrails.ts`;
  - `tests/guardrails/hook.test.ts`.
- **Accept:** §13.4, with the hook matrix passing under `sh`. Zips are repacked in C18.

**Level 1**

**C7 · Roofline outcome tasks and mirror.** M. Depends: C2.
- **Files:**
  - `src/components/sims/RooflineSim.tsx`;
  - new `src/components/sims/roofline.tasks.ts`;
  - new `src/lib/sims/models/roofline.ts`;
  - `src/data/lessons/t4/{cpu-vs-gpu,roofline,gpu-memory,occupancy-coalescing,matmul-tiling}.ts` (`taskIds`, `config`);
  - their `public/lessons-md`;
  - `tests/sims/roofline.test.ts`.
- **Accept:** §10.2–10.5; the six outcome tasks; the mirror, replacing the file's waiver; phone mode.

**C8 · KvCache outcome tasks.** M. Depends: C2, B3.
- **Files:**
  - `src/components/sims/KvCacheSim.tsx` (presets come from claims);
  - new `kvCache.tasks.ts`;
  - new `src/lib/sims/models/kv.ts`;
  - `src/data/lessons/t5/{kv-cache-math,pagedattention-deep-dive}.ts`;
  - their md;
  - tests.
- **Accept:** §10.2–10.4; no unsourced model numbers left in the sim.

**C9 · Allocator outcome tasks.** M. Depends: C2, C3.
- **Files:** `src/components/sims/AllocatorSim.tsx` (on `world/heap`); new `allocator.tasks.ts`; new `src/lib/sims/models/allocator.ts`; tests.
- **Accept:** §10.2–10.4; existing behaviour is preserved on the engine swap (snapshot tests on 3 traces).

**C10 · LatencyWalk and LayoutLab mirrors.** S. Depends: C2.
- **Files:** `src/components/sims/{LatencyWalk,LayoutLab}.tsx`.
- **Accept:** §10.5; both files render `SimMirror` and drop their waiver.

**C11 · The block-placement play.** M–L. Depends: C3, C2, B3.
- **Files:**
  - `src/components/play/block-placement/{Play,Grid,Debrief,Compose,ProductionCard,Mirror}.tsx`;
  - `src/components/blocks/PlayBlock.tsx`;
  - `src/pages/Play.tsx`;
  - new `src/data/plays.ts`;
  - `scripts/verify-plays.ts` (adds the play checks of §11.5 to C2's canvas check);
  - `tests/plays/*.test.ts`.
- **Accept:**
  - §11;
  - playable at 360 px by tap and by keyboard;
  - the ghost is hidden until the debrief;
  - `recordPlay` for play and compose;
  - `verify:plays` passes;
  - the closure is printed.

**C12a · F1 crates R1–R5 and the R harness.** M. Depends: C1. Files: `labs/rust-zero/{harness,r1-bindings,r2-control-flow,r3-ownership,r4-borrowing,r5-modeling}/**` plus their `calibration.json`.

**C12b · F1 crates R6–R10.** M. Depends: C12a. Files: `labs/rust-zero/{r6..r10}/**`.

**C12c · F1 labs 02–04.** M. Depends: C1. Files: `labs/{kv-block-manager,bpe-tokenizer,mpmc-queue}/**`.

**C12d · F1 labs 05–08.** M. Depends: C1. Files: `labs/{toy-executor,batching-scheduler,radix-cache,xgrammar-lite}/**`.

**Accept (all four):**
- §12.6;
- `expect-trap` and `expect-reference` per crate;
- calibrated;
- the solution passes in `cargo test` and in the browser on 32 seeds;
- a probe on every systems lab.

**C13 · F2 PRIMM for lab 01.** M. Depends: C1, C3.
- **Files:**
  - `labs/rust-allocator/src/allocator.rs` (stage markers, header);
  - `src/data/labs.ts` (rust-allocator: `stage`, `kcs`, brief);
  - new `src/data/forge/rust-allocator/primm.ts`;
  - `src/components/forge/{StagePanel,PrimmPanel,ReferenceRun}.tsx`;
  - tests.
- **Accept:** §13.1; stage 1 goes green in ≤ 2 min for the implementer, timed.

**C14 · H3 hint ladder for lab 01.** S–M. Depends: C1.
- **Files:** `src/data/forge/rust-allocator/ladder.ts`; `src/components/forge/HintLadder.tsx`; `scripts/lint-mentor.ts`; tests.
- **Accept:** §13.2; `verify:mentor` passes.

**C15 · H4 v1 Prove-it for lab 01.** S.
- **Files:** `src/data/forge/rust-allocator/prove.ts`; `src/components/forge/ProveIt.tsx`; tests.
- **Accept:** §13.3.

**C16 · giscus, click to load.** S. Depends: C5.
- **Files:** `src/components/community/Discussion.tsx`; new `src/data/community.ts`.
- **Accept:** §14.3; no network request before the click (verified in DevTools).

**Level 2**

**C17 · ForgeLab v2.** M. Depends: C1, C13–C16, plus B7 (merge `wave-1b` forward).
- **Files:** `src/pages/{ForgeLab,Forge}.tsx`.
- **Accept:**
  - per-check results with panic text and trace;
  - stages;
  - the ladder, Prove-it and discussion mounted;
  - `unseen` / `lab-green` / `assisted` provenance;
  - "reference module: no credit";
  - XP labels from `labXp`;
  - `MotionScope`.

**C18 · Repack the zips.** S. Depends: C6, C12a–d, C13.
- **Files:** `public/labs/*.zip`; the zip-freshness check in `scripts/verify-labs.ts`.
- **Accept:** `verify:guardrails` and `verify:labs` pass on all 18; no `_solutions`, `target` or `.wasm` in any zip.

**C19 · Exit instrumentation.** S. Depends: B12 (merge forward), C11, C17.
- **Files:** `src/lib/learner/outcomes.ts`; `scripts/partner-report.ts`; `tests/learner/outcomes.test.ts`.
- **Accept:** §17's G1–G3 and G7 selectors, on fixture ledgers.

### 18.4 Budget reconciliation and cut order

**Budget.** PLAN §8 allocates 75 h to 1b's pillars (V4 13, K1 17, K2 18, K3 6, V5 11, P1 10) and 88 h to 1c's (F1 20, Capstone 4, SimHost and P2 18, W1 12, F2/H3/H4 26, H1 4, giscus 4), plus 6 h of partner time. Three tasks have no line in that allocation: B0, B1 and B2 (≈ 9 h of review). If the review queue saturates, cut in this order; each cut rolls into Wave 2.
1. C10: two of the three mirrors (Roofline's stays);
2. B24: the ⌘K index (the palette keeps its current groups);
3. C16: giscus;
4. C12d: labs 05–08 stay v1 (`lab-green` only);
5. B23: the service worker (Today online-only).

---

## 19. Open questions for the owner

Each has a proposed default; the spec builds the default unless told otherwise.

1. **Returning learners and `/`.** Auto-redirect returning learners from `/` to `/today` (PLAN §4.D "returning visits land on Today")?
   **Default:** no redirect, as for Boot (Addendum A3 Q6). Home's hero becomes a Today card for returning learners, and the PWA start URL is `/today`.
2. **XP v2.** Approve the table in §8.4: 1 XP per nominal graded minute; labs per check; tickets 3; the 30-minute daily cap on item minutes; 0 for reading and toggles.
   **Default:** approve; revisit at the Wave 2 exit with partner data.
3. **What *read, not passed* counts for.**
   **Default:** it counts for navigation only. Resume skips it; track %, badges, track achievements and RING 2 need *done*.
4. **T3–T7 and R before their Wave 2 tickets.** Does a ≥ 80 % checkpoint pass count as *passed*?
   **Default:** yes. It is graded evidence, and 1a makes those items valid.
5. **Reference solutions.** F1 calibration and the mutant matrices need reference solutions for all 18 crates. Do private solutions exist, and may agents write them locally (`labs/_solutions/`, gitignored, never committed)?
   **Default:** yes. The owner keeps the canonical private copy; only `calibration.json` results are committed.
6. **Test-out bar.** The ticket's rule (≥ 2 of 3 with the non-MCQ right, confirmed at day 7), or 3 of 3?
   **Default:** the ticket's rule plus the day-7 confirmation. The plan's false-positive mitigation is the day-7 check.
7. **giscus.** Enable Discussions, install the giscus app, and create "Lessons" (Announcements type) and "Labs" (Q&A); moderation by the maintainer inside the weekly triage.
   **Default:** as listed. If declined, C16 ships the button hidden and H3's "Ask a human" opens a GitHub issue form instead.
8. **Seeded R drills.** R1–R10 checks become random inputs per seed. Existing green modules stay `lab-green`; RING 2 needs a rebuild from the v2 template.
   **Default:** accept.
9. **Capstone fallback.** If a browser refuses Blob workers in an opaque-origin frame (§14.1), accept the weaker worker-only isolation there, labelled?
   **Default:** accept, labelled "sandbox: worker only" in that browser.

---

## Appendix A: measured baselines (this branch, 2026-10-04)

| What | Result | How |
|---|---|---|
| entry chunk | 158.9 KB gzip | `npm run build && bun scripts/verify-bundle.ts` at 31468b1 |
| `/boot` closure | 197.9 KB gzip (+ 8.1 KB on demand; 206.1 KB full flow) | same |
| entry by source (separately gzipped, approximate) | react-dom 56.4 · motion-dom 30.5 · react-router 14.3 · framer-motion 11.3 · fuse.js 9.8 · tailwind-merge 8.0 · progress.ts 4.0 · CommandPalette 2.4 · lucide 2.3 KB | `vite build --sourcemap` into the scratchpad; attribution with `source-map-js` |
| ts-fsrs 5.4.2 | 21.4 KB minified, 6.8 KB gzip (`fsrs` + `createEmptyCard` + `Rating`) | `bun build --minify` in the scratchpad |
| lab 01 with a non-coalescing allocator | 6/6 checks pass | a scratch copy of `labs/rust-allocator`, `cargo test` with a mutant `allocator.rs` |
| lab 01 with a bump allocator | `reuse` and `fragmentation` fail; 4/6 pass | same |
| seeded churn (check 6 shape), first-fit + coalesce and the non-coalescing mutant | 5,000/5,000 seeds pass, for both | F1 prototype, Bun host |
| per-check v2 run | 3 checks ≈ 3 ms including `list`; 0.7 ms per seeded run including instantiation | F1 prototype |
| panic text after a trap | `panicked at src/allocator.rs:3:140: not yet implemented: construct your allocator` | F1 prototype |
| R + T0–T2 seed material | 86 H2s · 29 chips · 29 isomorphism pairs · 109 checkpoint items · 12 diagrams (6 in T0–T1) · 21 in-scope cross-reference edges (198 course-wide by the same regex) | Bun extraction over `LESSONS_BY_TRACK` |

## Appendix B: the core of the `kslab` v2 prototype

The `ks_run` body that the prototype validated. C1 hardens it: bounds checks, a 500-character panic cap, trace-drop counting, and the `Rng` helper.

```rust
pub fn run(input: &[u8], lab: &Lab) -> u64 {
    std::panic::set_hook(Box::new(|info| {
        let msg = info.to_string();
        PANIC.with(|p| if let Ok(mut p) = p.try_borrow_mut() { *p = msg; });
    }));
    let text = std::str::from_utf8(input).unwrap_or("");
    let (mut only, mut seed, mut list) = (None, None, false);
    for line in text.lines() {
        let mut it = line.split_whitespace();
        match (it.next(), it.next()) {
            (Some("only"), Some(id)) => only = Some(id),
            (Some("seed"), Some(s)) => seed = s.parse::<u32>().ok(),
            (Some("list"), _) => list = true,
            _ => {}
        }
    }
    // list → metadata only (no student code runs); otherwise run the selected checks:
    //   ctx.seed = if c.seeded { seed.unwrap_or(c.default_seed) } else { c.default_seed }
    //   ctx.fresh = c.seeded && seed.is_some()
    // and serialize {lab, version, abi: 2, checks: [...]} into the staging buffer.
    /* … */
}

#[no_mangle] pub extern "C" fn ks_abi_version() -> u32 { ABI_VERSION }
#[no_mangle] pub extern "C" fn ks_panic_msg() -> u64 { /* stage PANIC's text */ }
#[no_mangle] pub extern "C" fn ks_trace_drain() -> u64 { /* take and stage TRACE */ }
```

The host calls each check in a fresh instance of one compiled `WebAssembly.Module`. After a trap it reads `ks_panic_msg()` and `ks_trace_drain()` on that same instance, which wasm allows: a trap does not poison the instance's exports.
