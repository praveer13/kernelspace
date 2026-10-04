# Evidence Ledger v3: spec (Wave 0b, part 2)

**Status:** draft for owner review. **Date:** 2026-10-04. **Base:** `wave-0b-1` @ dde10a7.
**Implements:** PLAN-100X §5.1 V3, §7.1, and the part-2 items V2 (confidence), S4 (change cards), baseline cold checks (§1) and K4 (Boot, §4.A).
**Types:** `src/lib/ledger/types.ts` (types only, committed with this spec). Section numbers below are cited from that file.

**Owner decisions recorded (2026-10-04).** OD1 is decided: **start fresh**. kernelspace is new, so there is no legacy cohort to migrate. Addendum A below takes precedence over every section it names.

---

## Addendum A: owner decisions, 2026-10-04 (read first; supersedes conflicting text)

**A1. Start fresh (PLAN-100X OD1).**
- v3 never reads or writes `kernelspace:v1`. The first v3 load starts with an empty ledger.
- There are no legacy ids, no legacy projection, no `LegacyPolicy` or `LEGACY_POLICY` switch, no pre-v3 badge, no What-changed screen, no Recertify and no pre-migration backup.
- `reset()` clears v3 state only: the `kernelspace:v2` snapshot, the IndexedDB database and the outbox.
- Import accepts **export version 3 only**. An older file gets a clear message: "this export is from an earlier version of kernelspace and can't be imported".
- **Superseded:** §6.4–6.5; §9.1, §9.2, §9.5; the legacy steps of §9.6 and §9.8; §10.2 for v1/v2 detection; §10.6; all of §11; Appendix A; and every property, fixture or acceptance item that exists only for migration (double-migrate, stale *pre-v3* tab, golden v1 fixture).
- **Kept:**
  - the ledger, fold, merge and codec, plus the outbox;
  - the `kernelspace:v2` snapshot for first paint;
  - the BroadcastChannel sync and the schema guard (§9.3–9.4), for a stale tab running an *older v3* bundle;
  - export v3 / import with merge or replace and undo, and the backup nudge after 30 days without an export;
  - the double-import, two-device merge, stale-v3-tab write and 12-month round-trip properties.

**A2. Baseline cold checks (§12.3)** are dropped from Wave 0b. They were for learners carrying v2 history. Cold checks arrive with K2/K5 in Wave 1.

**A3. Answers to §17:**
- Q2: the service worker is deferred to Wave 1, so Boot is not offline-capable in Wave 0b. Accepted.
- Q3: confidence is **optional** and never gates Submit. Unrated answers are excluded from calibration.
- Q4: the mapping `{guess: 0.33, think: 0.67, sure: 0.95}` is accepted.
- Q5: `Erratum.items` is approved (at most 2 retrieval items per erratum).
- Q6: the Home hero CTA points to `/boot`. There is **no** auto-redirect from `/`.
- Q7: Boot paying 0 XP is fine; XP becomes graded minutes with V5 in Wave 1.
- Q9: manual matrix plus dev self-test. Add `fake-indexeddb` only if a bug class slips through.
- Q1, Q8 and Q10–Q12 are moot under A1.

**A4. Revised tasks (§16).** Order: **{L1 ∥ L2} → L3 → {L4 ∥ L5 ∥ L6} → {L7 ∥ L8}.**
- **L1, ledger core:** without `legacy.ts`, `tests/ledger/legacy.test.ts` and the `v1-*` fixtures. `progress.ts` re-exports `XP`, `RANKS`, `rankForXp`, `nextRank` and `localDateKey`; no migration helpers.
- **L2, storage, outbox and sync:** without `backup.ts` and its test.
- **L3, engine and façade:** no migration or re-projection, and no backup claim. The manual matrix is: first load (empty ledger), reload, two tabs, an older v3 bundle in a stale tab (schema guard → read-only), and a private window. No consumer file changes, and the same bundle budgets.
- **L4, data ownership on /progress:** export v3, import preview (merge or replace) with undo, the storage line, the backup nudge and reset copy. An older export shows the unsupported message. There is no pre-v3 record link.
- **L5, V2 confidence:** as §16, with optional picks.
- **L6, ledger notices (was "Legacy UX"):** the read-only banner (schema guard), the storage notices from §9.8 that still apply (memory-backend fallback), and passing the Forge module's `wasmSha256` to `recordLabResult`. No WhatChanged, PreV3Badge, RecertifyList, BaselineCheck or cold-check modules.
- **L7, S4 change cards:** a card shows when an erratum's `date` is later than the learner's completion event for an affected lesson. There is no pre-v3 seeding. Test fixture: a ledger with a t6 lesson completed before the KVBM erratum's date shows that card. A learner who completed it after the fix does not.
- **L8, K4 Boot:** as §16, with the CTA only (A3).

---

## 0. Summary

- **Truth moves to IndexedDB.** Progress becomes an append-only event ledger in the `kernelspace` database. The old localStorage key `kernelspace:v1` (zustand persist, state `version: 2`, persist `version: 3`) becomes read-only legacy input.
- **No consumer changes.** `useProgress` keeps its exact shape. Its data is an order-insensitive fold of the ledger (the *aggregate*). The store hydrates synchronously from a derived snapshot under a new key, `kernelspace:v2`. After first paint, a lazily loaded engine rebuilds the aggregate from IndexedDB.
- **Merges converge by construction.** Events are a grow-only set keyed by id, with one deterministic conflict rule. Working state (scroll position, drafts, settings) is last-writer-wins. Double-migrate, double-import, stale-tab writes and two-device merges therefore converge. `bun test` checks this with seeded random sequences.
- **No new dependencies** (ADR-1, §14).
- **Eight tasks** (§16): two parallel foundations, the façade, then five feature tasks with disjoint files.

---

## 1. Scope, non-goals, invariants

**In scope (Wave 0b, 41 h of the 80 h wave):**
- V3 ledger, migration and "What changed" (20 h)
- S4 change cards (4 h)
- V2 confidence (4 h)
- K4 Boot (11 h)
- baseline cold checks (2 h)

**Not in scope** (the ledger keeps the data these need; their logic lands later):
- the KC graph and its ref→kc map (V4, Wave 1)
- FSRS scheduling and Today (K2, Wave 1)
- XP as nominal graded minutes, exit tickets and rings (V5, Wave 1)
- `/me` (K5)
- the service worker (deferred, §9.7)
- QR delta handoff
- redacted partner exports
- writers for the `components` store (W4)

**Invariants.** Every one is tested (§13).

| # | Invariant |
|---|---|
| I1 | **Append-only.** Stored events are never edited. They are deleted only by explicit replace-import, undo or reset, each of which writes an undo checkpoint first. |
| I2 | **Identity.** An event is identified by `id`. Two records with the same id describe the same fact. If their content differs, the canonical rule (§4.8) picks one. |
| I3 | **Order-insensitive.** The aggregate depends only on the *set* of events and working records, never on insertion order. |
| I4 | **Pure legacy projection.** `projectLegacy(state, clock)` is a pure function. Event ids depend only on kernelspace:v1 content. |
| I5 | **Read-only legacy.** The new bundle never writes `kernelspace:v1`. The one exception: reset deletes it (§10.8). |
| I6 | **Schema guard.** A bundle never writes the database or the snapshot when either carries a newer `schemaVersion` than its own. |
| I7 | **Optimistic agreement.** `fold(derive(L), e)` deep-equals `derive(L ∪ {e})` for every new event `e`. |
| I8 | **No consumer changes.** Every existing import from `@/lib/progress` compiles unchanged and behaves the same. The one exception is the policy-defined live XP (§6.4). |
| I9 | **Durable first.** An action's events reach localStorage synchronously (the outbox, §8.6) before the asynchronous IndexedDB commit. |

---

## 2. Architecture

```
consumers (unchanged) ──useProgress──▶ façade  src/lib/progress.ts           [entry chunk]
                                         │ aggregate: fold() / toProgressData()      (sync)
                                         │ hydrate: kernelspace:v2 snapshot, else project(kernelspace:v1)
                                         │ action → events → outbox (sync) → engine.append
                                         ▼
                     engine  src/lib/ledger/engine.ts                          [lazy chunk]
                       ├─ LedgerStore: IdbStore (browser) | MemoryStore (tests, fallback)
                       ├─ migration and re-projection of kernelspace:v1 (Web Lock)
                       ├─ export v3 / import (merge | replace) / undo / reset
                       └─ BroadcastChannel 'kernelspace:ledger' + storage events
                                         ▼
                 IndexedDB 'kernelspace': events · working · components · meta · checkpoints
```

**The aggregate is the snapshot (§6).**
- The façade folds new events into it synchronously. That keeps today's behaviour: `Lesson.tsx` calls `markLessonStatus`, then immediately reads `getState().xp` for its toast.
- The engine computes the same aggregate from the whole ledger with `derive()` and replaces the optimistic one.
- Both paths call the same `fold`, so they agree by construction (I7).

**Module map.**

| File | Contents | Task |
|---|---|---|
| `src/lib/ledger/types.ts` | shared types | this commit |
| `src/lib/ledger/constants.ts` | `SCHEMA_VERSION = 3`, `AGGREGATE_VERSION = 1`, `XP_UNITS`, `LEGACY_POLICY = 'freeze'`, `IMPORT_MAX_BYTES` (20 MB) | L1 |
| `src/lib/ledger/names.ts` | `DB_NAME = 'kernelspace'`, `IDB_VERSION = 1`, store and index names, `LEGACY_KEY = 'kernelspace:v1'`, `SNAPSHOT_KEY = 'kernelspace:v2'`, `OUTBOX_PREFIX = 'kernelspace:v2:outbox:'`, `CHANNEL_NAME = 'kernelspace:ledger'`, `LOCK_NAME = 'kernelspace:migrate'` | L2 |
| `src/lib/ledger/stable.ts` | `stableStringify` (sorted keys), `sha256Hex` (async, `crypto.subtle`), `rev32` (sync, `hash32` from `rng.ts`, base36) | L1 |
| `src/lib/ledger/time.ts` | `dayOf(at, tz)`, `systemClock` | L1 |
| `src/lib/ledger/ids.ts` | `legacyId(kind, ref, stamp)`, `uuidFactory` | L1 |
| `src/lib/ledger/refs.ts` | `canonicalRef()` with the read-time ref-migration table (empty in 0b) | L1 |
| `src/lib/ledger/legacy.ts` | `normalizeLegacy()`, `projectLegacy()`, `projectLegacyWorking()`; the existing persist migrations (`migrateProgress`, `migrateT5LessonIds`, `removeRetiredSimTasks`) move here | L1 |
| `src/lib/ledger/fold.ts` | `emptyAggregate`, `fold`, `derive` | L1 |
| `src/lib/ledger/view.ts` | `toProgressData`, `legacyBadge`, `summary` | L1 |
| `src/lib/ledger/merge.ts` | `canonicalEvent`, `lwwWorking`, `mergeLedgers` | L1 |
| `src/lib/ledger/codec.ts` | export v3 builder, import detection and validation, preview math | L1 |
| `src/lib/ledger/changes.ts` | `selectChangeCards`, `selectSeen` | L1 |
| `src/lib/economy.ts` | `XP`, `RANKS`, `rankForXp`, `nextRank`, `localDateKey` (moved; `progress.ts` re-exports) | L1 |
| `src/data/errata/index.ts` | `ERRATA` (eager `import.meta.glob` of `[0-9]*.ts`) | L1 |
| `src/lib/ledger/memory-store.ts`, `idb-store.ts`, `store-conformance.ts` | the `LedgerStore` adapters and their shared test suite | L2 |
| `src/lib/ledger/outbox.ts`, `channel.ts`, `guard.ts`, `backup.ts` | outbox; BroadcastChannel wrapper; schema guard as a pure check that takes the bundle's `SCHEMA_VERSION` as an argument; backup file builder (takes a normalized `LegacyStateV2`) and download | L2 |
| `src/lib/ledger/engine.ts`, `client.ts` | engine; lazy client (`LedgerClient`) | L3 |
| `src/lib/progress.ts` | façade (rewritten) | L3 |

---

## 3. IndexedDB schema

Database `kernelspace`, IndexedDB version `IDB_VERSION = 1`.

| Store | keyPath | Indexes | Record | Notes |
|---|---|---|---|---|
| `events` | `id` | `by_at` on `at`; `by_kind_ref` on `['kind','ref']` (both non-unique) | `LedgerEvent` | Legacy events with `at: null` are absent from `by_at`, because IndexedDB skips invalid keys. That is intended. |
| `working` | `key` | — | `WorkingRecord` | Last-writer-wins (§5) |
| `components` | `sha256` | `by_lab` on `labId` | `ComponentRecord` | No writer in Wave 0b; import may add records (W4 groundwork). |
| `meta` | `key` | — | `{ key: MetaKey, value: MetaRecords[key] }` | `schema`, `device`, `migration`, `legacy`, `legacyRaw`, `backup`, `lastExport`, `persist` |
| `checkpoints` | `id` | — | `Checkpoint` | One record, `id: 'undo'` (§10.4) |

**Versioning: three independent numbers.**
- `SCHEMA_VERSION` (logical; currently `3`, the third progress data model after v1 and state v2). It is written to `meta.schema.version`, the snapshot and exports. Bump it when event semantics or required fields change. Older bundles then go read-only (§9.3).
- `IDB_VERSION` (physical). Bump it only when stores or indexes change. `onupgradeneeded` creates whatever is missing, switching on `oldVersion`. An older bundle opening a newer database gets `VersionError` and goes read-only.
- Per-event `v`. Bump it when one kind's shape changes. `fold` upcasts old `v` values on read and never rewrites stored events.

**Expected size (§15):** ~3–8k events per active year for a typical learner, ≤25k for a heavy one, at ~250 B each.

---

## 4. Event model

### 4.1 Envelope

`{id, v, at, tz, day, kind, ref, rev?, dev}` plus, on graded kinds, `{score, ok, provenance, conf?, seed?, ms?, wasmSha256?}`. These are the V3 fields plus `dev`. The types are in `types.ts` §Events.

| Field | Rule |
|---|---|
| `id` | v3: `crypto.randomUUID()` (injected `IdFactory` in tests). Legacy: `legacy:<kind>:<ref>:<stamp>` (§9.1). |
| `v` | `1` |
| `at` | UTC ISO instant from the clock. `null` only on legacy events whose time kernelspace:v1 never stored. |
| `tz` | `-new Date(at).getTimezoneOffset()`, i.e. minutes east of UTC at that instant |
| `day` | `dayOf(at, tz)` = the UTC calendar date of `at + tz` minutes, which equals `localDateKey` at write time. Frozen, so travel never rewrites history. Streaks and heatmaps read `day`. |
| `dev` | device id from `meta.device` (random per browser profile). `'legacy'` on projected events. |
| `rev` | content fingerprint the event was graded against (§4.5). Required on `item`, `probe` and `predict`. |
| `score` / `ok` | `score ∈ [0,1]`. `ok` is the pass verdict. |
| `provenance` | §4.4. Required on graded kinds. Trace kinds carry only `provenance: 'legacy'`, and only when legacy. |
| `conf` | `'guess' \| 'think' \| 'sure'` (V2), stored categorically. The probability mapping is applied at read time (§12.1). |
| `seed` | uint32: the quiz attempt's shuffle seed, a generator seed, or a run seed |
| `ms` | time on task |
| `wasmSha256` | lowercase hex SHA-256 of the learner's module |

### 4.2 Kinds

| Kind | Graded | Ref | Wave 0b writer | XP fact (§6.3) | Streak day |
|---|---|---|---|---|---|
| `item` | yes | `quiz:<lessonId>#<qi>`, `boot:<step>`, `card:<erratumId>#<i>` | QuizBlock (`recordQuizAttempt`), Boot, change cards | — | yes |
| `probe` | yes | same as `item` | baseline cold check | — | yes |
| `quiz` | yes | `lesson:<id>` | QuizBlock (one per submit); legacy best score | `quiz-pass:<id>` when `ok` | yes |
| `predict` | yes | `boot:<step>` | Boot | — | yes |
| `sim-task` | yes | `sim:<simId>/<taskId>` | `recordSimTask` | `sim:<simId>/<taskId>` | yes |
| `lab-check` | yes | `lab:<labId>` (run), `lab:<labId>/<checkId>` (legacy check) | `recordLabResult` | `lab:<labId>` when `ok` | yes, if `passed.length > 0` |
| `fleet-act` | yes | `fw:<actId>` | `completeFleetWeekAct` | `fw:<actId>` when `ok` | yes |
| `capstone-step` | yes | `cap:<stepId>` | `completeCapstoneStep` | `cap:<stepId>` | yes |
| `play`, `incident`, `fleet-run`, `prove` | yes | — | reserved (W1, W3, W4, H4) | — | yes |
| `visit` | no | `lesson:<id>`, `sim:<simId>`, `boot` | `markLessonStatus(…,'reading')`, `recordSimVisit`, Boot | — | no |
| `complete` | no | `lesson:<id>`, `boot` | `markLessonStatus(…,'done')`, Boot | `lesson:<id>` | no |
| `exercise` | no | `lesson:<id>` | `markExerciseDone` (no caller today) | `exercise:<id>` | no |
| `achievement` | no | `ach:<id>` | `unlockAchievement`, Fleet Week all-acts | — | no |
| `ack` | no | `erratum:<id>`, `screen:<id>` | change cards, What-changed screen | — | no |
| `day` | no | `day:<YYYY-MM-DD>` | legacy only | — | (is a day) |
| `scalar` | no | `scalar:xp`, `scalar:capstone-step`, `scalar:sim-visits:<simId>` | legacy only | — | no |

A click never earns credit. `complete` stays a trace kind, so KC credit (V4 and later) can only come from graded kinds. XP keeps today's table until V5.

### 4.3 Ref grammar

The template-literal types are in `types.ts` §Refs.
- Lesson ids are canonical ids (`t5.l4`), never slugs.
- `qi` is the authored question index. It is not the display position, because options and questions are shuffled per attempt.
- When V1 adds stable item ids, new events use `item:<id>`. `refs.ts` then maps old `quiz:<lesson>#<qi>` refs to the new ids at read time.

### 4.4 Provenance in Wave 0b

| Writer | Provenance |
|---|---|
| quiz items, quiz summaries, Boot, change-card items, cold checks, sim tasks, Fleet Week acts, Capstone steps | `practice` |
| Forge runs | `lab-green` (v1 modules ignore seeds) |
| everything projected from kernelspace:v1 or a v1/v2 export | `legacy` |
| — | `unseen` (S3 seeds drawn at grade time), `proved` (H4 v2), `assisted` (H3 bottom-out) and `field` (F8) are reserved; their writers come later |

Credit weights (V6: w=1.0 for `proved`/`unseen`, ≤0.3 for `lab-green`/`practice`/`assisted`, 0 for `legacy`) are applied at read time and never stored.

For V4/K2 consumers, legacy evidence maps to KC states as follows (§7.1.1):
- a legacy `complete` → *introduced*;
- a legacy `quiz` with `ok` → *practiced*;
- nothing legacy is ever *credited*.

### 4.5 `rev` (content fingerprints)

- **Quiz item:** `rev32(stableStringify({q, options, correct}))` of the authored question. QuizBlock computes it at submit.
- **Boot step:** `rev32` of `{step, truth (rounded to 3 significant figures), claims: ['<id>@<verifiedAt>', …]}`.
- **Change-card item:** `rev32` of `{erratumId, i, q, options, correct}`.
- **Legacy events:** no `rev`.
- **Use (S1 "re-check"):** if the latest item event on a ref has a `rev` that differs from the item's current fingerprint, the item changed after it was graded. The UI flags it "re-check" and never deducts.

### 4.6 Time

- The clock is injectable: `LedgerClock = {nowIso, tzOffsetMinutes}`. Tests pin both, so `day` never depends on the test host's timezone.
- **Legacy events with a known instant** (`completedAt`, `lastVisitedAt`) get `tz` from the projecting device at that instant. If two devices in different timezones project the same v1 state, they produce the same ids but different `tz`/`day`. §4.8 resolves that deterministically.

### 4.7 Ids

v3 ids are random UUIDs. Legacy ids are deterministic (§9.1). No id is ever parsed: refs and kinds live in their own fields.

### 4.8 Canonical conflict rule

If two records share an id but differ, keep the one whose `stableStringify` is lexicographically smaller.
- The rule is commutative, associative and idempotent, so ledger merge is a join-semilattice.
- `at` is the first key in sorted order, so when only the times differ, the earliest `at` wins.
- It is used by the stores' `commit` (injected as `ConflictResolvers.event`) and by `mergeLedgers`.

### 4.9 Validation

`codec.ts` validates every event that enters from outside (imports and outboxes). It checks:
- the kind is known for its `v`;
- the ref prefix matches the kind;
- `score ∈ [0,1]`;
- `provenance` is valid;
- `at`/`tz`/`day` are null only when `provenance === 'legacy'`;
- `id` is non-empty and ≤200 characters.

Unknown extra fields are preserved (forward compatibility within one schema version). An import whose `schemaVersion` is newer than the bundle's is refused with `newer-schema`.

---

## 5. Working state

Working state is mutable and carries no evidence. Each key holds one `WorkingRecord {key, value, at, dev}`.
- **Merge:** last writer wins by `at`, then `dev`, then the larger canonical JSON (`ConflictResolvers.working`).
- **Not evidence:** it never affects XP, streaks or status.

| Key | Replaces (kernelspace:v1 field) | Written by | Broadcast |
|---|---|---|---|
| `scroll:<lessonId>` | `lessons[id].scrollPct` | `setLessonScroll` (only when the lesson already has a record, as today) | no (device-local; commits debounced to 2 s) |
| `sim-config:<simId>` | `sims[id].lastConfig` | `setSimConfig` | yes |
| `fw:doc` | `fleetWeek.docText` | `setFleetWeekDoc` | yes |
| `fw:evidence:<actId>` | `fleetWeek.measurementEvidence[act]` | `setFleetWeekEvidence` (shallow-merged patch) | yes |
| `capstone:metrics` | `capstone.metrics` | `setCapstoneMetrics` | yes |
| `settings:<field>` | `settings.<field>` | `updateSettings`, one record per field | yes |
| `boot:path` / `boot:week` / `boot:value` / `boot:install-dismissed` | new | Boot (§12.4) | yes |

`boot:value` is free text and stays on the device. It is included in the learner's own exports but never in the redacted partner exports planned for later.

---

## 6. Aggregate, selectors and the OD1 policy

### 6.1 Fold rules

`fold(agg, e)` first applies `canonicalRef(e.ref)`. It then increments `agg.events` and sets `agg.hasLegacy` when `e.provenance === 'legacy'`.

Definitions used in the table:
- **L(id)** is `agg.lessons[id]`, created on first touch.
- **"legacy?"** means `e.provenance === 'legacy'`.
- **facts\*** means `facts.legacy` when the event is legacy, otherwise `facts.v3`.
- **max / min** compare ISO strings and ignore `null`.

| Event | Effect |
|---|---|
| `visit lesson:<id>` | L.lastAt = max |
| `visit sim:<s>` | non-legacy only: `sims[s].visitsV3 += 1` |
| `visit boot` | none |
| `complete lesson:<id>` | `L.done`; non-legacy: `L.doneV3`. If `at`: `L.completedAt = min`, `L.lastAt = max`; else `L.doneAtUnknown`. `facts*['lesson:<id>']`. |
| `complete boot` | `completions['boot'] = min(at)`. A time-less legacy one gives `null`. |
| `exercise lesson:<id>` | `L.exercise`; `facts*['exercise:<id>']`; `L.lastAt = max` |
| `quiz lesson:<id>` | `L.quizBest = max(score)`; `L.lastAt = max`; if `ok`: `facts*['quiz-pass:<id>']` |
| `item` / `probe` on `quiz:<id>#<qi>` | `L(id).lastAt = max` (exposure). Nothing else; the `quiz` summary carries the score. |
| `item` / `probe` / `predict` on `boot:*` / `card:*` | none beyond the streak day |
| `sim-task sim:<s>/<t>` | `sims[s].tasks[t]`; `facts*['sim:<s>/<t>']` |
| `lab-check lab:<l>` | `labs[l].checks ∪= data.passed`; `labs[l].total = max`. If `ok`: `labs[l].done`, `completedAt = min(at)`, `facts*['lab:<l>']`. |
| `lab-check lab:<l>/<c>` (legacy) | `labs[l].checks[c]` |
| `fleet-act fw:<a>` | `fleetWeek.scores[a] = max(score)`; if `ok`: `acts[a]`, `facts*['fw:<a>']` |
| `capstone-step cap:<s>` | `capstone.steps[s]`; `capstone.step = max(step, data.index + 1)`; `facts*['cap:<s>']` |
| `achievement ach:<id>` | legacy: `achievements.legacy[id]`; else `achievements.v3[id] = min(at)` |
| `ack <ref>` | `acks[ref] = min(at)` |
| `day day:<d>` | `days[d]` |
| `scalar scalar:xp` | `legacyXp = max` |
| `scalar scalar:capstone-step` | `capstone.step = max` |
| `scalar scalar:sim-visits:<s>` | `sims[s].visitsLegacy = max` |
| **Streak (all kinds)** | every non-legacy graded event with `day` sets `days[day]`, except a `lab-check` with no passed checks. This is today's Wave 0a rule: quiz, sim task, lab check with ≥1 pass, Fleet Week act, Capstone step, plus the new graded kinds. |

`derive(events, working?)` folds a de-duplicated set into `emptyAggregate()`. Every rule is a max, min, union, OR or count of distinct events, so `derive` is order-insensitive (I3). `agg.events` counts distinct ids, so double-folding is a bug the engine prevents by keying its in-memory ledger by id.

### 6.2 Consumer view (`toProgressData`)

`toProgressData(agg, working, policy)` returns today's `ProgressData`. Arrays built from sets are sorted lexically. No consumer depends on insertion order: they use `includes`, `length` and `Set`.

| Field | Derivation |
|---|---|
| `version` | `2` |
| `lessons[id]` | `status: done ? 'done' : 'reading'`, `completedAt`, `lastVisitedAt: lastAt ?? ''`, `quizScore: quizBest`, `exerciseDone: exercise`, `scrollPct: working['scroll:<id>']`. Status never goes backwards. |
| `sims[s]` | `visits: visitsV3 + visitsLegacy`, `tasksDone: sorted(tasks)`, `lastConfig: working['sim-config:<s>']`; a record exists if any of these do |
| `labs[l]` | `done: !!done`, `checksDone: sorted(checks)`, `completedAt` |
| `fleetWeek` | `actsDone: sorted(acts)`, `scores`, `docText: working['fw:doc']`, `measurementEvidence` assembled from `fw:evidence:*` |
| `capstone` | `step`, `stepsDone: sorted(steps)`, `metrics: working['capstone:metrics']` |
| `xp` | §6.4 |
| `streakDays` | `sorted(days)`. `selectStreak` is unchanged and still reads it. |
| `achievements` | §6.4 |
| `settings` | assembled from `settings:*` |

The existing selectors keep working unchanged over this data: `selectDoneLessons`, `selectOverallPct`, `selectTrackPct`, `selectTrackDone`, `selectNextLesson`, `selectStreak` and `selectActivityMap`.

### 6.3 XP facts

A fact pays its unit once, however many events or devices assert it. The units are today's `XP` constants:

| Fact | Unit | Fact | Unit |
|---|---|---|---|
| `lesson:<id>` | `XP.lesson` (100) | `lab:<id>` | `XP.lab` (200) |
| `quiz-pass:<id>` | `XP.quiz` (40) | `fw:<act>` | `XP.fleetWeekAct` (250) |
| `exercise:<id>` | `XP.exercise` (60) | `cap:<step>` | `XP.capstoneStep` (150) |
| `sim:<s>/<t>` | `XP.exercise` (60, as `recordSimTask` pays today) | | |

`item`, `probe` and `predict` pay 0 until V5 replaces this table with nominal graded minutes (Wave 1).

### 6.4 OD1 as a read-time policy

| | (a) `freeze` (default; owner not yet confirmed) | (b) `recompute` | (c) `live` |
|---|---|---|---|
| live `xp` | Σ unit(`facts.v3`) | Σ unit(`facts.v3 ∪ facts.legacy`) under the current table | `legacyXp` + Σ unit(`facts.v3 \ facts.legacy`) |
| rank (`rankForXp(xp)`) | restarts from evidence earned from now on | follows the recompute; drops further when V5 stops paying for clicks | continues; keeps click-earned ROOT |
| `achievements` (latched) | sorted v3 ids | sorted v3 ∪ legacy ids | sorted v3 ∪ legacy ids |
| `legacy` badge | `LegacyBadge` (§6.5) | `null` | `null` |
| What-changed copy | "frozen, not deleted" + Recertify | "recomputed from your evidence" | "kept; new XP is honest from today" |
| Recertify | the way back to live rank | optional (credit for rings later) | optional |

The policy does not affect lesson status, sims, labs, Fleet Week, Capstone, streak days or settings. Legacy facts stay visible, so nobody is sent back to R.L1.

**Visible consequence of (a) with no consumer changes.** `Progress.tsx` lights an achievement when it is latched *or* `derived(state)`. `state` includes legacy completions, so completion-derived achievements stay lit. What freezes is XP and rank. A catalog that requires v3 evidence is a `Progress.tsx` change that belongs with V5's achievement rewrite.

### 6.5 Legacy badge

The badge exists only under `freeze` and only when `hasLegacy`. Its fields:
- `xp = legacyXp` and `rank = rankForXp(legacyXp).name`;
- `achievements = sorted(achievements.legacy)`;
- counts of `facts.legacy` by prefix: `lesson:`, `quiz-pass:`, `sim:`, `lab:`, `fw:` and `cap:`.

### 6.6 Light selectors (pure, sync, over the aggregate)

- `selectSeen(agg)`: `lessonId → {learnedAt: IsoInstant | null}` for every completed lesson. `null` means a pre-v3 completion at an unknown time. This is Wave 0b's `seenClaims` (§12.2).
- `selectChangeCards(agg, errata)`: §12.2.
- `summary(agg, policy)`: `ProgressSummary`, used by the import preview.

Heavier selectors read full events through `LedgerClient.events()`:
- `selectCalibration` (§12.1, L5)
- `planColdCheck` (§12.3, L6)
- `selectBootOutcome` (§12.4, L8)

---

## 7. Storage adapter

Interface: `LedgerStore` (`types.ts` §Storage adapter).

| Method | Contract |
|---|---|
| `open()` | Opens or creates the database and reports `schemaVersion` (null when fresh). A `VersionError` resolves `{readOnly: true, reason: 'newer-idb'}`. Any other open failure rejects; the engine catches it and falls back to `backend: 'memory'`, which is not read-only (§9.8). |
| `readAll()` | All events, working records, component metadata and meta records |
| `commit(tx, resolvers)` | Atomic: one IndexedDB `readwrite` transaction over the stores it touches. Order: `clear` → deletes → puts. `putEvents`: absent → put; present → put `resolvers.event(existing, incoming)` if that differs from `existing`. `putWorking`: the same with `resolvers.working`. The `*IfAbsent` variants never overwrite. Returns changed ids/keys and the meta keys it claimed. |
| `readCheckpoint()` / `readComponentBytes()` | point reads |
| `onVersionChange(cb)` | IndexedDB `versionchange`: close the connection, then `cb` |

**Implementation notes**
- **No policy in the adapters.** Merge rules are injected, so the stores never import L1.
- **IdbStore:** run get-then-put inside a single transaction with request callbacks, never `await` between requests (the transaction auto-commits when idle). Use default durability; the outbox covers the crash window (I9).
- **MemoryStore** is the reference implementation. It applies `structuredClone` on every read and write, so aliasing bugs show up in tests.
- **Conformance:** `store-conformance.ts` exports `runStoreConformance(makeStore, assert)`. It covers idempotent puts, canonical conflicts, last-writer-wins, `IfAbsent` claims, atomicity (a throwing resolver leaves no partial write) and clear+put replace.
  - `bun test` runs it against MemoryStore.
  - `selfTestIdb()` runs it against IdbStore on a throwaway database, `kernelspace-selftest`, with a console harness.
  - In the Vite dev server: `(await import('/src/lib/ledger/store-conformance.ts')).selfTestIdb()`.
  - L3 also exposes it as `window.__ledgerSelfTest()` in dev builds (ADR-1).

---

## 8. The `useProgress` façade

### 8.1 Construction

- `progress.ts` exports `createProgressStore(env: FacadeEnv)` and the default `useProgress = createProgressStore(browserEnv())`. `FacadeEnv` = storage, clock, `newId`, `tabId`, policy, `loadEngine` (`types.ts`).
- The `persist` middleware is removed. The façade never writes `kernelspace:v1`.
- `progress.ts` keeps exporting, with unchanged signatures:
  - the types;
  - `XP`, `RANKS`, `rankForXp`, `nextRank`, `localDateKey` (re-exported from `economy.ts`) and `TOTAL_LESSONS`;
  - every selector;
  - `getProgress`, `migrateProgress`, `migrateT5LessonIds` (re-exported from `ledger/legacy.ts`);
  - `exportProgress()`: deprecated and kept for compatibility. It returns the v2-shaped JSON of current data. L4 moves `Progress.tsx` to `LedgerClient.exportV3()`.
- **Entry-chunk cost** (fold, view, legacy projection, outbox writer): ≤ +8 KB gz. IndexedDB, codec, migration and channel code load lazily.
- **§7.3 is satisfied:** Navbar and StatusBar read only the snapshot-backed store, never the ledger engine.
- `useProgress` stays a zustand hook. `getState`, `setState` and `subscribe` are unchanged, and so is `ReturnType<typeof useProgress.getState>` (used by `FleetWeek.tsx`).

### 8.2 Hydration (synchronous, at module init)

1. **Snapshot.** Read `kernelspace:v2` (`SnapshotV2`).
   - If `schemaVersion ≤ SCHEMA_VERSION` and `aggregateVersion` matches, hydrate from it.
   - If `schemaVersion` is newer, hydrate read-only (`reason: 'snapshot-newer'`).
2. **Legacy fallback.** Else read `kernelspace:v1`. Run `normalizeLegacy` (the existing persist migrations, by persist version), then `projectLegacy` and `derive`, and hydrate. This is the first v3 load, before IndexedDB opens.
3. **Empty.** Else start empty.
4. **Engine.** Schedule it with `requestIdleCallback` (2 s timeout; `setTimeout(0)` fallback) or on the first write.

### 8.3 Existing actions

Every existing action keeps its signature, synchronous state update and skip rules.

| Action | Events (non-legacy) | Working | Skip (no write) when |
|---|---|---|---|
| `markLessonStatus(id,'reading')` | `visit lesson:id` | — | `L.lastAt` falls on today's local day (one visit per lesson per day) |
| `markLessonStatus(id,'done')` | `complete lesson:id` | — | `L.done` (legacy or v3) |
| `markLessonStatus(id,'unstarted')` | — | — | always (status never regresses; no caller today) |
| `setLessonScroll(id,pct)` | — | `scroll:id` | no lesson record (as today) |
| `recordQuizScore(id,score)` | `quiz lesson:id {score, ok: score ≥ 0.8}` | — | never. Compatibility path; QuizBlock moves to `recordQuizAttempt`. |
| `markExerciseDone(id)` | `exercise lesson:id` | — | `L.exercise` |
| `recordSimVisit(s)` | `visit sim:s` | — | never |
| `recordSimTask(s,t)` | `sim-task sim:s/t {score: 1, ok: true}` | — | the task is already done |
| `setSimConfig(s,cfg)` | — | `sim-config:s` | — |
| `recordLabResult(l, passed, total, meta?)` | `lab-check lab:l {passed, total, score: passed/total (0 if total = 0), ok: done after this run, cumulative as today}` with `provenance: meta.provenance ?? 'lab-green'` | — | never: every run is evidence. The optional 4th argument `LabRunMeta` is additive. |
| `completeFleetWeekAct(a,score)` | `fleet-act fw:a {score, ok: true}`; plus `achievement ach:fleet-week` when all four acts are done and it is not yet latched | — | never |
| `setFleetWeekDoc` / `setFleetWeekEvidence` | — | `fw:doc` / `fw:evidence:a` | — |
| `completeCapstoneStep(s,i)` | `capstone-step cap:s {data: {index: i}}` | — | the step is already done |
| `setCapstoneMetrics(m)` | — | `capstone:metrics` | — |
| `unlockAchievement(id)` | `achievement ach:id` | — | latched in v3 |
| `updateSettings(patch)` | — | `settings:<field>` for each key | — |
| `importProgress(json): boolean` | validates synchronously; the engine then applies `replace` with an undo checkpoint (today's semantics plus undo) | | returns `false` on invalid input |
| `resetProgress()` | engine `reset()` (§10.8) | | |

Every graded write sets `provenance` (§4.4) and `seed`/`ms` where the caller has them.

### 8.4 New actions (additive; `LedgerFacadeActions`)

| Action | Writes |
|---|---|
| `recordQuizAttempt({lessonId, seed, ms, responses})` | One `item` per response (`ref quiz:<lessonId>#<qi>`, `rev`, `score: ok ? 1 : 0`, `conf`, `seed`, `data {src: 'quiz', pick, grp, lessonId}`), plus one `quiz` (`score = correct/n`, `ok = score ≥ 0.8`, `seed`, `ms`, `data {grp, n}`). `grp` is a fresh UUID. |
| `recordItems(items)` | `item` / `probe` / `predict` events. Provenance defaults to `practice`. |
| `acknowledge(ref)` | `ack`; skipped if already acked |
| `completeRef('boot', data)` | `complete boot` (always; `completions.boot` keeps the earliest) |
| `recordVisit(ref)` | `visit` (lessons de-duplicated per day, as above) |
| `setWorking(key, value)` | working record |

**Additive state** (`LedgerFacadeState`): `ledger` (status), `legacy` (badge), `acks`, `completions`, `working` (all working values, for Boot and new UI). Consumers that select whole state, such as `Achievements` (`useProgress()`), re-render as before.

### 8.5 Write path

For each action, in order:
1. Build the events and working records (clock and id factory from env).
2. Append them to this tab's outbox (§8.6) synchronously.
3. Run `set(toProgressData(fold(agg, …)))` synchronously.
4. Schedule a snapshot write (debounced 250 ms, and on `pagehide`).
5. Call `engine.append(…)`. If the engine is not loaded, import it now; it flushes outboxes on boot.

After `engine.append` commits:
- the engine removes the entries from this tab's outbox;
- it broadcasts `{t: 'append', events, working}`, except `scroll:*`;
- `engine.onAggregate` replaces the aggregate with the engine's (identical by I7, except for events merged from other tabs).

### 8.6 Outbox (write-ahead for the write-ahead log)

- **Where:** `kernelspace:v2:outbox:<tabId>` → `Outbox`.
- **Flush:** at boot the engine commits every outbox key it finds. It deletes a *foreign* key only when that key's `updatedAt` is over 24 h old, which guards against racing a live tab. Each tab removes its own committed entries.
- **Quota errors** are caught. The action still proceeds and the commit still happens.
- **IndexedDB unavailable** (§9.8): the outbox *is* the store, and it keeps growing until IndexedDB returns.

### 8.7 Read-only mode

Set by the schema guard (§9.3).
- Actions are no-ops.
- `ledger.readOnly` and `reason` are set; L6's `ReadOnlyBanner` reads "A newer version of kernelspace is open in another tab. Reload to keep saving."
- Nothing is written: no snapshot, outbox or IndexedDB commit.
- A write already queued when the guard latches (a `hello` can land between an action and its commit) is not committed. Its entries stay in the outbox (§8.6), and the newer bundle commits them when it boots.

### 8.8 Consumers (unchanged)

These files read the store or its selectors and are untouched by L3:
- pages: `Home.tsx`, `Curriculum.tsx`, `Lab.tsx`, `Lesson.tsx`, `lesson/LessonRow.tsx`, `lesson/blocks.tsx` (`settings.codeLang`), `Track.tsx`, `Forge.tsx`, `ForgeLab.tsx`, `FleetWeek.tsx`, `Capstone.tsx`, `Progress.tsx`;
- components: `TrackCard.tsx`, `QuizBlock.tsx`, `Navbar.tsx`, `StatusBar.tsx`;
- sims: `PlaygroundShell.tsx` (`completeSimTask`), `QuantizerSim.tsx`, `KvCacheSim.tsx`, `WgslSim.tsx`, `ToyEngineSim.tsx`.

L4–L8 change some of them on purpose (§16).

---

## 9. Migration from kernelspace:v1 (§7.1, points 1–7)

### 9.1 Deterministic legacy ids

`projectLegacy(state: LegacyStateV2, clock)` emits `legacy:<kind>:<ref>:<stamp>` with `dev: 'legacy'` and `provenance: 'legacy'`.
- `stamp` is the record's `completedAt` when it has one, the value for max-merged facts, and `-` otherwise.
- Values are formatted with `String(n)`. Scores are stored exactly, and the stamp uses the same string.

| kernelspace:v1 | Event | `stamp` | `at` | Payload |
|---|---|---|---|---|
| `lessons[id]` (any record) | `visit lesson:<id>` | `-` | `lastVisitedAt ?? null` | — |
| `lessons[id].status === 'done'` | `complete lesson:<id>` | `completedAt ?? '-'` | `completedAt ?? null` | — |
| `lessons[id].quizScore` (number) | `quiz lesson:<id>` | `String(score)` | `null` | `score`, `ok: score ≥ 0.8` |
| `lessons[id].exerciseDone` | `exercise lesson:<id>` | `-` | `null` | — |
| `sims[s].tasksDone[t]` | `sim-task sim:<s>/<t>` | `-` | `null` | `score: 1, ok: true` |
| `sims[s].visits > 0` | `scalar scalar:sim-visits:<s>` | `String(visits)` | `null` | `{value: visits}` |
| `labs[l].checksDone[c]` | `lab-check lab:<l>/<c>` | `-` | `null` | `score: 1, ok: true, passed: [c]` |
| `labs[l].done` | `lab-check lab:<l>` | `completedAt ?? '-'` | `completedAt ?? null` | `score: 1, ok: true, passed: checksDone` |
| `fleetWeek.scores[a]` | `fleet-act fw:<a>` | `String(score)` | `null` | `score`, `ok: actsDone.includes(a)` |
| `fleetWeek.actsDone[a]` with no score | `fleet-act fw:<a>` | `-` | `null` | `score: 0, ok: true` |
| `capstone.stepsDone[s]` | `capstone-step cap:<s>` | `-` | `null` | `score: 1, ok: true` |
| `capstone.step > 0` | `scalar scalar:capstone-step` | `String(step)` | `null` | `{value: step}` |
| `xp > 0` | `scalar scalar:xp` | `String(xp)` | `null` | `{value: xp}` (legacyXp is the max across devices) |
| `streakDays[d]` | `day day:<d>` | `-` | `null` | `day: d` |
| `achievements[a]` | `achievement ach:<a>` | `-` | `null` | — |
| `scrollPct`, `lastConfig`, `docText`, `measurementEvidence`, `capstone.metrics`, `settings` | working records (§5), via `projectLegacyWorking` | | | |

**Why a changed record still projects correctly.**
- A record that only grows (tasks, checks, acts, steps, days, achievements, done lessons) gets one event per element.
- A max-merged value (quiz best, Fleet Week score, xp, visits, capstone step) carries its value in the id.
- So a changed kernelspace:v1 state yields *new* ids, never a conflicting rewrite.

The projection rules are **frozen once shipped**. A golden fixture test (§13, P2) pins the exact ids for a fixed v1 state.

### 9.2 Read-only old key, re-projected idempotently on change

- **When it runs:** `reproject()` runs at engine boot and on every `storage` event for `kernelspace:v1`. Only a stale pre-v3 tab can write that key.
  1. `raw = localStorage['kernelspace:v1']`; `h = sha256(raw)`.
  2. If `meta.legacy.lastHash === h`, stop. If `raw` is null, stop.
  3. Normalize and project.
     - **First migration** (`meta.migration` absent): `putEvents`, `putWorkingIfAbsent(projectLegacyWorking(state))` and `putMetaIfAbsent({migration, legacyRaw})`, all in one commit, with the backup claim (§9.5). The backup download follows the commit; `kernelspace:v1` itself is never touched.
     - **Later change:** `putEvents`, plus `putWorking` for the working keys whose projected value changed between `meta.legacy.lastRaw` and `raw`, stamped `at = now`.
  4. `putMeta({legacy: {lastHash: h, lastRaw: raw, at}})`, then broadcast `reload` with reason `migration` or `legacy-reproject`.
- **Unparseable v1:** record the hash and continue without legacy.
- **Concurrency:** all of this runs under `navigator.locks.request('kernelspace:migrate', …)`. Where Web Locks are missing it runs unlocked, which is safe because every write is idempotent.
- **Churn:** a pre-v3 tab rewrites the key on every state change, including scroll saves every 500 ms. `storage`-triggered re-projection is therefore debounced (2 s trailing). It broadcasts `reload` only when the commit changed events or broadcastable working keys, never for `scroll:*` alone.

**Known, accepted behaviour.**
- Work done in a stale pre-v3 tab after migration is projected as `legacy`: it is uncredited under (a). Pre-v3 code records no seeds, items or confidence.
- A reset or import done in a stale tab is not propagated. Union cannot express removal.

### 9.3 New snapshot key and schema guard

- **Why a new key.** The snapshot lives under `kernelspace:v2`, never `kernelspace:v1`. zustand 5.0.14 runs `migrate` on any version mismatch, including downgrades. A pre-v3 tab reading a key written by a newer bundle would therefore "migrate" it, so each generation gets its own key.
- **The guard.** A bundle goes read-only (§8.7) when any of these holds:
  1. `meta.schema.version > SCHEMA_VERSION` (`newer-schema`);
  2. the database open fails with `VersionError` (`newer-idb`);
  3. its connection receives `versionchange` (`versionchange`);
  4. the snapshot's `schemaVersion` is newer (`snapshot-newer`);
  5. a channel `hello` announces a newer `schemaVersion`.
- **What a newer bundle does.** It upgrades on open, writes `meta.schema`, then announces `hello`.
- **Rollback.** Redeploying a pre-v3 bundle is safe. It reads `kernelspace:v1` as frozen at migration, plus any stale-tab writes. v3 progress stays in IndexedDB, invisible to the old bundle and never lost. It reappears when v3 is redeployed.

### 9.4 Cross-tab sync

BroadcastChannel `kernelspace:ledger` carries `ChannelMessage`:
- `append` (after commit; carries the events and working records): receivers whose engine is loaded add unseen ids to their in-memory ledger, fold them in and `set`. Receivers still on the snapshot mark themselves dirty and rebuild when their engine loads.
- `reload` (import, undo, reset, migration, re-projection): receivers re-read IndexedDB and rebuild.
- `hello` carries the sender's `schemaVersion`.

A `storage` event on `kernelspace:v2` is a fallback trigger for `reload`. Only the writing tab writes the snapshot; receivers just update memory.

### 9.5 Pre-migration backup (downloads automatically)

On the first migration of a non-empty v1 state (any lesson, task, check, act, step, day, achievement or xp > 0):
1. **Copy into IndexedDB.** Store `raw` in `meta.legacyRaw` inside the migration transaction.
2. **Claim the download.** Claim `meta.backup` with `putMetaIfAbsent`, so exactly one tab downloads.
3. **Download.** Build `kernelspace-pre-v3-backup-<YYYY-MM-DD>.json` as an **export v2** (`{version: 2, …LegacyStateV2, exportedAt, note}`), which both old and new bundles can import, and download it with no user gesture.

Some browsers may block or prompt for a download without a user gesture (iOS Safari [unverified]). The What-changed screen therefore also offers "Download your pre-v3 backup" (`LedgerClient.downloadLegacyBackup()`).

### 9.6 Engine boot sequence

1. `store.open()` → guard.
2. Fresh database: write `meta.schema` and `meta.device` (UUID).
3. Flush outboxes.
4. `reproject()` (§9.2).
5. `readAll()` → in-memory `Map<id, event>` → `derive` → `set`, unless it deep-equals the current aggregate → write the snapshot.
6. Subscribe to the channel, the `storage` event and `versionchange`.
7. Send `hello`.
8. Check durability: `navigator.storage.persisted()` (never prompts). After the session's first graded event, if not persisted, call `persist()` at most once per 30 days and record `meta.persist`. Firefox may show a permission prompt here.

### 9.7 Service worker: deferred to Wave 1

Wave 0b ships no service worker. Boot works online, and §7.3's "offline after the first visit" moves to Wave 1 with Today (owner question 2). When it ships, it must follow these rules:
1. **Kill switch.** A deployed `sw.js` whose `install`/`activate` handlers unregister it and delete every cache is the off switch. App code also unregisters when `?nosw=1` is present.
2. **Network-first `index.html`**, with a 3 s timeout before falling back to cache. Hashed assets are cache-first.
3. **Schema handshake.** Pages post `{t: 'hello', schemaVersion}`. The SW records the highest it has seen and never serves a cached shell whose build `schemaVersion` is lower when a newer shell is cached. The guard (§9.3) remains the correctness backstop.
4. **Scope.** It never caches `kernelspace:*` storage or IndexedDB (out of scope by design).

### 9.8 Failure modes

| Condition | Behaviour |
|---|---|
| IndexedDB open fails (private mode on some engines, disk full) | `backend: 'memory'`. Events persist only in the outbox (localStorage). A banner: "Storage is limited here: export your progress regularly." |
| localStorage throws (quota, blocked) | Snapshot and outbox writes are skipped. IndexedDB still commits, and the next boot derives from IndexedDB. |
| Snapshot corrupt or wrong `aggregateVersion` | Ignore it, hydrate from v1 or empty, and let the engine rebuild |
| kernelspace:v1 unparseable | No legacy. `meta.legacy.lastHash` is still recorded. |
| IndexedDB opens fresh (`schemaVersion: null`) while the snapshot reports non-legacy events (the browser evicted IndexedDB but not localStorage) | Before overwriting, copy the snapshot to `kernelspace:v2:orphaned:<date>`. Then derive as usual and show a notice: "This browser cleared your saved progress. Restore it from your last export." The notice links to import. |

---

## 10. Export v3 and import

### 10.1 Export v3 (`ExportV3`)

- **Content:** all events sorted by (`at ?? ''`, `id`), working records sorted by key, component metadata (bytes only if the learner opts in), `extras` and `legacy`.
  - `extras` holds the Capstone drafts (`kernelspace:capstone:draft:*`), the Capstone flags and the leaderboard personal best. None of them were exported before.
  - `legacy` is the migrated v1 string with its hash.
- **File:** `kernelspace-progress-<YYYY-MM-DD>.json`. Exporting records `meta.lastExport`.
- **Size:** a heavy 12-month ledger is ~6–8 MB [estimated, checked by P8].

### 10.2 Detection (import accepts versions 1–3)

| Input shape | Format | Path |
|---|---|---|
| `{format: 'kernelspace-progress', version: 3, schemaVersion: n}` | `export-v3` | validate (§4.9); refused if `n > SCHEMA_VERSION` |
| `{version: 2, lessons: {…}, xp: number}` | `export-v2` | `removeRetiredSimTasks` → project as legacy |
| `{version: 1, lessons: {…}, xp: number}` | `export-v1` | `removeRetiredSimTasks` → `migrateT5LessonIds` → project as legacy |
| `{state: {…}, version: n}` (a copied localStorage value) | `persist-envelope` | `migrateProgress(state, n)` → project as legacy |
| anything else, over 20 MB, or invalid JSON | error | `unknown-format` / `too-large` / `parse` |

Legacy ids are deterministic, so importing a v2 export on the device that produced it is a no-op, and importing it twice changes nothing.

### 10.3 Merge or replace

- **merge** (default):
  - events: union (canonical rule on id conflicts);
  - working: last writer wins;
  - components: union;
  - extras: Capstone drafts fill only missing steps; flags are OR-ed; the leaderboard personal best keeps the higher `overallGoodput` when `benchmarkVersion` matches.
- **replace:** clear `events` and `working`, then put the file's contents (components are kept). Extras are overwritten.

### 10.4 Undo

Before any import or reset, the engine writes `Checkpoint {reason, at, events, working, fileEventIds, fileWorkingKeys}`, replacing the previous one (one level of undo).

`undo()` restores:
- **events:** `checkpoint.events ∪ (current − fileEventIds)`. This keeps local events created after the import, under both merge and replace.
- **working:** for each key in either set, keep the current record if this device wrote it after the checkpoint (`dev` = this device and `at > checkpoint.at`). Otherwise restore the checkpoint's record, deleting keys the checkpoint lacks. `fileWorkingKeys` feeds the preview counts only.

It then deletes the checkpoint and broadcasts `reload`. The undo survives reloads until the next import or reset.

### 10.5 Preview

`previewImport(text, mode)` derives in memory without writing. It returns:
- the format;
- the file's event count;
- new events (those not in the ledger, for merge) or all file events (for replace);
- working changes;
- `before` and `after` summaries (lessons done, XP under the active policy, active days, labs done, events);
- warnings, such as "file has no events newer than 2026-08-01" or "replace drops N events made on this device".

### 10.6 Backward compatibility

- Pre-v3 bundles reject v3 files. That is acceptable, because such bundles only survive in stale tabs.
- The automatic backup (§9.5) is v2, so a rollback can always restore it.

### 10.7 Snapshot after import

Import, undo and reset all end with `derive` → `set` → snapshot write → broadcast `reload`.

### 10.8 Reset

`reset()` runs these steps:
1. Write a checkpoint (`reason: 'reset'`; `fileEventIds` and `fileWorkingKeys` empty).
2. Clear `events` and `working`.
3. Remove `kernelspace:v1` (the one exception to I5, so the next boot cannot resurrect it) and set `meta.legacy` to the hash of `''`. `meta.legacyRaw` and `components` are kept.

`Progress.tsx`'s copy changes from "Irreversible" to "Undo is available until your next import or reset" (L4). A pre-v3 tab still open can rewrite `kernelspace:v1`, which re-projects (documented).

---

## 11. What learners see under OD1 (a)

### 11.1 "What changed and why" (one-time screen)

- **When it opens:** a dialog mounted lazily by `Layout`. It opens once when the engine is `ready`, `hasLegacy` is set, `acks['screen:whats-changed-v3']` is absent and the route is not `/boot`. `?whats-changed=1` reopens it.
- **Closing it** by any means writes `ack screen:whats-changed-v3`. The ack is in the ledger, so a second device stops showing the dialog after a merge.

Contents, in order:
1. **Your progress now lives in an evidence ledger on this device.**
2. **Why.** The old checkpoint could be passed by always picking the longest option (58 of 68 lessons). *Mark complete* paid 100 XP against 40 for passing a quiz. So old XP measured clicking as much as learning.
3. **Your pre-v3 record** (`PreV3Badge`): rank, XP, achievements and counts. "Frozen, not deleted."
4. **What still counts.** Completed lessons stay completed. Your streak continues.
5. **From today, XP comes only from evidence:** quizzes, sim tasks, Forge runs, Fleet Week acts and Capstone steps.
6. **"N things you learned have changed"** (from `selectChangeCards`) → `/freshness?tab=errata`.
7. **Recertify** (§11.3).
8. **Backup.** "We saved your old progress as `kernelspace-pre-v3-backup-….json`", with a re-download button.

### 11.2 Pre-v3 badge

`PreV3Badge` renders `LegacyBadge`. It appears in the dialog, and `Progress.tsx` links to it as "your pre-v3 record" (`?whats-changed=1`).

### 11.3 Recertify (Wave 0b scope)

`RecertifyList` lists, per track, the lessons and labs that are done only by legacy evidence:

| Item | Action | Earns (live XP under (a)) |
|---|---|---|
| a legacy-done lesson with no v3 `quiz-pass` | "take its checkpoint again" → `/lesson/<id>` | `quiz-pass` fact (+40) |
| a legacy-done lab with no v3 `lab:<id>` fact | "re-drop your module" → `/forge/<id>` | `lab-green` run (+200) |
| ≥3 eligible lessons | "baseline cold check, 5 minutes" (§12.3) | evidence only |

A lesson touched by an unacked change card is badged "changed since you learned it".

**Deferred:** the template-v2 rebuild on unseen seeds (needs F1) and the generated 15-minute item sweep per track (needs K1). Both are Wave 1.

---

## 12. Part-2 features

### 12.1 V2: confidence and calibration (task L5)

**UI** (`QuizBlock.tsx`, after w0b/q-why-ui lands):
- After each option choice, three toggles appear: *guess · think so · sure* (`ConfidencePicker`, ≥44 px targets).
- Keys `1`, `2` and `3` set the confidence of the question that holds focus (the lesson page binds none of them).
- Submit needs an option **and** a confidence for every question (owner question 3).
- QuizBlock calls `recordQuizAttempt` with `rev` per question.

**Feedback.** Sure-and-wrong answers come first:
- a "Confident misses" summary at the top of the results links to those questions, and their per-option *why* opens expanded;
- the DOM order stays stable for screen readers.

**Calibration** (`src/lib/learner/calibration.ts`):
- **Input:** `selectCalibration(events, {since?})` over non-legacy `item`/`probe`/`predict` events with `conf`.
- **Mapping v1:** `{guess: 0.33, think: 0.67, sure: 0.95}`.
- **Per bin:** `n`, correct, accuracy and its Wilson 95% interval.
- **Brier and its decomposition:** `brier = mean((p − ok)²)`, `reliability = Σ (n_k/N)(p_k − ō_k)²`, `resolution = Σ (n_k/N)(ō_k − ō)²`, `uncertainty = ō(1 − ō)`. The identity `brier = REL − RES + UNC` is exact, because `p` is constant within each bin. Tested.
- **Also reported:** `bias = mean(p) − mean(ok)` and `sureWrong`.
- **Display:** once `n ≥ 20`, QuizBlock may show one line, e.g. "Your *sure* answers: 18/20 right".

**FSRS (K2, Wave 1)** will read `conf`. Sure-and-wrong → *Again*, with priority. Guess-and-right → *Hard*. It never gates.

### 12.2 S4: change cards (task L7)

**Data.**
- `src/data/errata/index.ts` exports `ERRATA` (eager glob).
- L7 adds an optional `Erratum.items?: QuizQuestion[]` (≤2, each with `why`) and authors items for the Wave 0b errata where a retrieval item fits.
- `verify-errata` lints the items: at most 2, a `why` parallel to the options, and a key that is not strictly the longest option.

**Selector** `selectChangeCards(agg, errata)`:
- For each erratum `E`, let `affected = E.lessons` filtered to lessons where `L.done && (L.doneAtUnknown || L.completedAt ≤ E.date + 'T23:59:59.999Z')`.
- If `affected` is non-empty, emit `{erratum, lessonIds: affected, learnedAt, acked: !!acks['erratum:' + E.id]}`. `learnedAt` is `null` when any affected lesson has `doneAtUnknown`; otherwise it is the earliest `completedAt` among them.
- Sort: unacked first, then `E.date` descending, then id.
- A completion on the fix day itself counts as before it (conservative).

**`seenClaims`.** Wave 0b's exposure record is `selectSeen(agg)` (lesson → first learned). The legacy projection seeds it for pre-v3 completions: time-less legacy completions count as *before every erratum*, which is how pre-v3 T6 finishers get the KVBM card. Two Wave 1 changes extend it to claims:
- once lessons cite claims by id (S2 v1), `seenClaims(claimId)` = min `learnedAt` over the lessons citing it;
- a value change ships as an Erratum of kind `changed` with a proposed `claims?: string[]` field.

One pipeline, no second store.

**Card anatomy:** kind badge and date; title; the struck *before* (`<del>`); the *after*; the ≤40-word *why*; the source link; links to the affected lessons; 1–2 items. Answering an item:
- shows its *why* immediately;
- writes `item card:<id>#<i>` with `conf`.

"Got it", or answering every item, writes `ack erratum:<id>`.

**Surfaces:**
- a "For you: N things you learned have changed" section at the top of `/freshness` → Errata (shown only when cards exist);
- the count in the What-changed dialog;
- Today in Wave 1.

### 12.3 Baseline cold checks (task L6)

**Purpose (§1, Baseline).** Partners who used v2 take cold checks on the lessons they completed. The flow is offered to every pre-v3 learner with ≥3 eligible lessons.

**Plan** (`src/lib/learner/cold-check.ts`, pure: `planColdCheck(agg, lessons, now, seed)`):
- **Eligible lessons:** `L.done` and (`L.lastAt` ≤ now − 7 days, or no known `lastAt`). Probes update `lastAt`, so a lesson is re-checked at most weekly.
- **Order:** oldest exposure first (unknown first).
- **Selection:** ≤2 questions per lesson, round-robin across tracks, ≤10 items per session.
- **Seeds:** question choice and option order are seeded from the session seed (`shuffledOrder`).

**Flow** (`BaselineCheck`):
- One item per screen, with confidence required and no feedback until the end.
- The end screen shows the score with a Wilson 95% interval and a per-track split, then the review with sure-and-wrong items first.
- No XP. It is graded work, so it counts toward the streak.

**Events:** `probe quiz:<lessonId>#<qi>` with `rev`, `conf`, `seed`, `provenance: 'practice'`, and `data {src: 'cold', pick, grp: sessionId, lessonId, sinceDays}`. `sinceDays` is absent for time-less legacy completions. Partners share results by sending their export privately. There is no telemetry.

### 12.4 K4: Boot (task L8)

**Route.**
- `/boot`, a lazy page (`src/pages/Boot.tsx`, `src/pages/boot/*`, model in `src/lib/boot/model.ts`).
- It is added to `App.tsx` and to `staticRoutes` in `scripts/prepare-pages.mjs`.
- On `Home.tsx`, visitors with no `completions.boot` and no lesson records get the hero CTA "Start with Boot: 10 minutes, any device" → `/boot`. Returning learners keep *Resume*. Whether to auto-redirect is owner question 6.

**Budget: ≤200 KB gzip** for the JS + CSS closure of `/boot`: the entry chunk, the Boot chunk and their static imports. Dynamic imports, such as the ledger engine, are excluded.
- **Measurement:** `vite.config.ts` gets `build.manifest: true`. `scripts/verify-bundle.ts` (from w0b/p1-lazy-routes) walks `dist/.vite/manifest.json`, following `imports` but not `dynamicImports`, gzips each file and fails over budget.
- **Forbidden static imports:** `@/data/lessons`, sims, recharts, three and the ledger engine.
- **If the shared shell alone pushes the closure over budget**, Boot renders outside `Layout` behind its own minimal shell. Record the decision and the numbers in the PR.

**Claims.** Every number comes from `src/data/claims` (w0b/s2-claims-atlas) through `claimNumber()`. Each one renders as a tappable chip (label, value, source, `verifiedAt`, "stale since"). Derived numbers carry a *[derived]* marker with their formula.

| Claim id | Value |
|---|---|
| `hw.h100-sxm.hbm-bw` | 3.35 TB/s |
| `hw.h100-sxm.hbm-capacity` | 80 GB |
| `hw.h100-sxm.bf16-dense` | 989 TFLOPS |
| `model.llama3-8b.params` | 8.03 B |
| `model.llama3-8b.kv-bytes-per-token` | 131,072 B |

**Scenario constants (labelled, not claims):** 2 bytes per BF16 weight; chats of 4,096 tokens.

**Derivations** (`src/lib/boot/model.ts`). The story's numbers come out as [derived] in the plan's §4.A:

| Quantity | Formula | Value | Copy |
|---|---|---|---|
| weights | params × 2 B | 16.06 GB | "16 GB" |
| batch-1 decode | bw ÷ weights | 208.6 tok/s | "≈209 tok/s" |
| math busy at batch 1 | 2·params·tok/s ÷ flops | 0.34% | "≈0.3%" |
| ridge | flops ÷ bw | 295.2 FLOP/B | "≈295" |
| KV tokens that fit | (80 GB − weights) ÷ 131,072 | 487,823 | "≈488k" |
| chats of 4k | ÷ 4,096 | 119.1 | "about 120" |
| bytes per step | weights + 119 × 4,096 × 131,072 | 79.9 GB | "≈80 GB" |
| step time | ÷ bw | 23.9 ms | "≈24 ms" |
| aggregate tok/s | 119 ÷ step time | 4,986 | "≈5,000" |
| math idle at that batch | 1 − 2·params·tok/s ÷ flops | 91.9% | "~90%" |

`tests/boot/model.test.ts` holds each value inside a band that matches its copy (for example, decode ∈ [205, 212]). A claim update that moves a number out of its band fails CI instead of drifting silently.

**Steps and the events they write:**

| # | Step | Interaction | Event |
|---|---|---|---|
| 0 | Intro | "10 minutes, any device" | `visit boot` |
| 1 | Guess | "One user, Llama-3-8B, one H100: tokens per second?" A log slider (10–100,000) plus a number field, and confidence | `predict boot:guess-1user {value, unit: 'tok/s', truth: 208.6}`; `ok = abs(log2(v/truth)) ≤ 1`; `score = max(0, 1 − abs(log10(v/truth)))` |
| 2 | Faded example | 16.06 GB per token at 3.35 TB/s; the learner fills in tok/s | `item boot:faded-decode {value}`, ok within ±5% |
| 3 | Roofline | Its own SVG roofline with a batch stepper (WCAG 2.5.7) and a slider; no embedded sim; commit at the ridge | `item boot:ridge {value}`, ok within ±10% of 295 |
| 4 | The catch | "64 GB left at 128 KiB per token: how many tokens?"; then reveal ≈120 chats, ≈80 GB in ≈24 ms, ~90% idle | `item boot:kv-tokens {value}`, ok within ±10% |
| 5 | The reveal | "≈5,000 tok/s is what the GPU delivers across ~120 users, not to one." If the guess was within 2× of 4,986: "Right number, wrong reason." Then one MCQ with whys: why batching raises throughput but not per-user speed | `item boot:why-batching {pick}` + `conf` |
| 6 | You | Value prompt (job and no-job variants) → `boot:value`; path (full ramp / serving-first / Rust systems) → `boot:path`; *Set your week* (`WeekPlan`) → `boot:week`; optional placement → `/curriculum?placement=1`; iOS install prompt (iOS Safari, not standalone; dismiss → `boot:install-dismissed`); the 30-second "this will feel harder, here is why" card | working records; then `complete boot {totalMs, firstSuccessMs, correct, graded}` |

**Every step records `ms`.**

**Outcomes** (`src/lib/boot/outcomes.ts`). `selectBootOutcome(events)` returns `BootOutcome`. It measures the activation lever: "finish Boot with ≥3 correct (of 5 graded) and return for a second graded session within 7 days". It also reports `firstSuccessMs`, for the K4 metric "every partner's first-success time, median ≤4 min".

**Mobile and accessibility:**
- 360 px with no horizontal scroll and ≥44 px targets;
- a stepper for every slider;
- everything keyboard-operable;
- results announced through `aria-live`;
- `prefers-reduced-motion` respected;
- every chart mirrored by a DOM table.

**XP.** Boot pays 0 XP until V5 (owner question 7).

---

## 13. Property-test plan (`bun test`)

**Location and tooling.**
- Tests live under `tests/` (outside `src`), so `tsc -b` never sees `bun:test` and no type package is needed. They import modules by relative path, like `scripts/*.ts`. Bun resolves the `@/` alias from the root `tsconfig.json`.
- `package.json` gains `"test": "bun test ./tests"`. The path filter keeps Bun out of `.claude/worktrees/`, which in the main checkout holds other worktrees' test files.
- `ci.yml` and `deploy.yml` run `bun run test` in the fast gate.
- Bun does not type-check, so keep test code simple. `npm run lint` still lints it.

**Harness** (`tests/ledger/gen.ts`):
- **Randomness:** `splitmix32(seed)` from `src/lib/rng.ts` drives every choice.
- **Fixed pools** keep tests independent of content edits. Lessons `t0.l1–t0.l6` and `t5.l1–t5.l4`; sim `sim-kv` with tasks `a–c`; labs `lab-a` (checks `c1–c4`, total 4) and `lab-b`; acts `engine`, `fleet`, `business`, `incident`; steps `s1–s7`.
- **Clock:** a fake clock starting `2026-09-01T08:00:00Z`. Each op advances it 1–3,000 minutes.
- **Devices:** each has its own `tz` from {−420, 0, 330, 540} and its own UUID factory.
- **Ops:** façade actions (§8.3–8.4) plus, for legacy states, a **frozen copy of the pre-v3 reducers** at `tests/ledger/fixtures/v1-reducers.ts`. It is the action bodies of `src/lib/progress.ts` at dde10a7 with the clock injected.
- **Iterations:** `LEDGER_SEEDS` (default 100) × `LEDGER_OPS` (default 40).
- **On failure:** print the seed and the op trace. `LEDGER_SEED=<n>` replays one seed.

**"Identical ledgers"** means equal `stableStringify` of the events sorted by id, the working records sorted by key, and the derived aggregate.

| # | Property |
|---|---|
| P1 | **Double-migrate.** For a random v1 state `S`: `migrate(migrate(∅, S), S)` is identical to `migrate(∅, S)`, including `meta.migration` and the working records. |
| P2 | **Projection determinism.** `projectLegacy(S)` twice gives the same output, and ids do not depend on `tz`. A golden fixture (`tests/ledger/fixtures/v1-golden.json` → expected ids) freezes the rules. |
| P3 | **Double-import.** For v1, v2 and v3 export files `F` built from random histories: `import(import(L, F, merge), F, merge)` equals `import(L, F, merge)`, and replace twice equals replace once. |
| P4 | **Stale-tab write.** `L0 = migrate(S0)`; random v3 ops give `L1`; frozen v1 reducers turn `S0` into `S1`; `reproject(S1)` gives `L2`. Then: events(L2) ⊇ events(L1); every fact in `S1` shows in `view(L2)` (done lessons, tasks, checks, acts and steps; scores ≥); reprojecting `S1` again changes nothing; reprojecting before or after the v3 ops gives the same ledger. |
| P5 | **Two-device merge.** Devices A and B start from the same `S0` and run different random ops. After exchanging exports with `merge` in both directions, A equals B. Also `merge(A,B) = merge(B,A)`, `merge(A, merge(A,B)) = merge(A,B)`, and three devices converge under any pairwise schedule. |
| P6 | **Order-insensitivity.** `derive(shuffle(L))` equals `derive(L)`. |
| P7 | **Optimistic agreement (I7).** After every op through `createProgressStore(memoryEnv)`, façade data equals `toProgressData(derive(store events))`. |
| P8 | **12-month round-trip.** A synthetic year (seeded; a light profile ≈10 events per active day and a heavy one ≈60) goes export v3 → `JSON.stringify` → parse → import (replace) into an empty store, and comes back identical. The test reports JSON size and event count and fails above the 20 MB import cap. |
| P9 | **Undo.** Import (merge or replace), then local ops, then `undo()`, gives `checkpoint ∪ local-after-import` (§10.4). Reset, then `undo()`, restores everything. |
| P10 | **Schema guard.** With `meta.schema.version = SCHEMA_VERSION + 1`, the engine is read-only and actions cause zero store or outbox writes. A snapshot with a newer `schemaVersion` hydrates read-only. |
| P11 | **Policy.** For each `LegacyPolicy`, `xp`, `achievements` and `legacy` follow §6.4, and every other field of the view is identical across the three policies. |
| P12 | **Legacy formats.** A v1 export (pre-T5 ids) imports with the T5 shift applied. Persist envelopes v0–v3 normalise exactly as today's `migrateProgress`. |
| P13 | **Store conformance.** `runStoreConformance(() => new MemoryStore())` passes (§7). |
| P14 | **Change cards.** Completed before the erratum date → card; after → none; time-less legacy → card; acked → `acked: true`; a merge carries acks across devices. |

The feature tasks add unit tests:
- calibration identities and Wilson intervals (L5);
- cold-check eligibility, caps and determinism (L6);
- Boot derivation bands and `selectBootOutcome` (L8).

---

## 14. ADR-1: no new dependencies

- **Context.** The owner prefers no new dependencies, and the ledger needs IndexedDB access, tests, ids and validation.
- **Decision.** Use the platform and what is already installed:
  - raw IndexedDB behind `LedgerStore`;
  - `crypto.randomUUID` and `crypto.subtle` for ids and hashes;
  - BroadcastChannel and Web Locks for cross-tab coordination;
  - `splitmix32` (`rng.ts`) for seeded property sequences;
  - hand-written type guards for validation.

**Rejected alternatives:**

| Package | Why not |
|---|---|
| `idb` | The adapter is ~150 lines of callback transactions. |
| `fake-indexeddb` | All logic sits above `LedgerStore` and runs against MemoryStore under the same conformance suite. |
| `fast-check` | Seeded sequences replay by seed; shrinking is a nicety. |
| `ts-fsrs` | Not needed until K2. |
| `uuid` | `crypto.randomUUID` covers it. |
| `zod` | Already a dependency and allowed, but hand-written guards keep the lazy chunk smaller. |

**Consequence.** IdbStore has no automated test in CI. Mitigations:
- a dev-only `window.__ledgerSelfTest()` runs the conformance suite on a real browser's IndexedDB;
- a manual matrix runs in the L2 and L3 PRs (Chrome, Firefox, Safari macOS, iOS Safari, Android Chrome);
- Playwright (planned in §7.4) can run the self-test in CI later.

**Revisit** (owner question 9) if the manual matrix finds a defect class the memory suite cannot express. The fix then is `fake-indexeddb` as a devDependency only.

---

## 15. Budgets, risks, rollout

**Budgets.**

| Item | Budget |
|---|---|
| Entry chunk added by the façade | ≤ +8 KB gz |
| Ledger engine (lazy) | ≤30 KB gz |
| `/boot` closure | ≤200 KB gz |
| Snapshot | ≤100 KB |
| Synchronous hydrate | ≤5 ms (desktop) |
| Engine ready after idle start, 20k events on a mid-range phone | ≤300 ms [estimated; L3 logs it in dev] |
| Snapshot write | debounced 250 ms |

**Risks.**

| Risk | Mitigation |
|---|---|
| Veterans' visible rank drops under (a) | What-changed screen, badge and Recertify; the policy switch; release only with L4 + L6 (below) |
| Storage eviction (Safari's 2026 policy is [unverified]) | `persist()`, a backup nudge after 30 days without export (L4), the automatic pre-migration backup, the iOS install prompt in Boot |
| Lost writes on crash | outbox (I9) |
| Stale tabs | re-projection plus the schema guard |
| Rollback to a pre-v3 bundle | v3 progress hidden, never lost (§9.3) |
| Clock skew between devices | affects only last-writer-wins for working state; events are a union |
| Ledger growth beyond ~50k events | full loads stay acceptable through Wave 1; the `by_at` index allows incremental loads later |

**Rollout.**
- All tasks merge into `wave-0b-1`. The wave reaches `master` only after **L4 and L6**, because L3 alone would freeze veterans' XP without telling them why.
- **Release check:**
  1. Copy the owner's real `kernelspace:v1` value into a fixture and run P1–P4 on it.
  2. Run the manual matrix above.
  3. Test a stale tab: serve the master build with `vite preview`, open a tab, then rebuild with v3 on the same port and open a second tab.

---

## 16. Task breakdown (Sonnet implementers)

**Shape.** One PR per task. Within a level, tasks never touch the same file.

**Order:** **{L1 ∥ L2} → L3 → {L4 ∥ L5} → {L6 ∥ L7 ∥ L8}.** L4 needs only L3, so it can also run alongside the last level.

**Part-1 branches that must merge into `wave-0b-1` first:**
- `p1-lazy-routes` and `ch-changes` (they edit `package.json`, both workflows, `App.tsx` and `prepare-pages.mjs`);
- `q-why-ui` (`QuizBlock.tsx`);
- `p2-lab-worker` (`ForgeLab.tsx`);
- `s2-claims-atlas` (`src/data/claims`);
- the errata branches (`d-t0`, `d-t1`, `d-t2`, `e-*`).

**Checks for every task:** `npm run lint`, `npm run build` (runs `tsc -b`), `bun run test` (from L1 on), and every `bun run verify:*` that exists.

**L1: Ledger core (pure).** M, ~6 h review. Depends on: this spec; p1 and ch-changes merged.
- **Files (new):**
  - `src/lib/ledger/{constants,stable,time,ids,refs,legacy,fold,view,merge,codec,changes}.ts`
  - `src/lib/economy.ts`
  - `src/data/errata/index.ts`
  - `tests/ledger/{gen.ts,legacy,fold,merge,codec,changes,properties}.test.ts`
  - `tests/ledger/fixtures/{v1-reducers.ts,v1-golden.json,…}`
- **Files (edited):**
  - `src/lib/progress.ts`: replace the `XP`/`RANKS`/`rankForXp`/`nextRank`/`localDateKey` bodies and the migration helpers with re-exports. No behaviour change.
  - `package.json` (`"test": "bun test ./tests"`)
  - `.github/workflows/{ci,deploy}.yml` (`bun run test` step)
- **Accept:**
  - §4, §6, §9.1 and §10.2 implemented as specified;
  - P1–P6, P8, P11, P12 and P14 pass at 100 seeds × 40 ops in under 60 s on CI (P3 and P5 use a pure in-memory ledger built from `mergeLedgers`, P8 the codec alone);
  - the golden fixture is committed;
  - L1's modules use no DOM, IndexedDB, localStorage or zustand (they run under Bun with no browser globals).

**L2: Storage, outbox and sync primitives.** M, ~4 h. Depends on: this spec (`types.ts` only). Runs parallel to L1.
- **Files (new):**
  - `src/lib/ledger/{names,memory-store,idb-store,store-conformance,outbox,channel,guard,backup}.ts`
  - `tests/ledger/{store,outbox,guard,backup}.test.ts`
- **Accept:**
  - `LedgerStore` contract (§7), with resolvers injected; nothing imports L1's files;
  - P13 passes on MemoryStore;
  - `selfTestIdb()` passes from the Vite dev console in Chrome and Firefox (paste the output in the PR);
  - the outbox's foreign-key rule (§8.6);
  - guard reasons (§9.3) unit-tested with fakes;
  - `backup.ts` builds an export-v2 file from a `LegacyStateV2` that today's `importProgress` would accept. The once-only `meta.backup` claim is the engine's and is tested in L3.

**L3: Engine and façade.** L, ~6 h. Depends on: L1, L2.
- **Files:**
  - `src/lib/ledger/{engine,client}.ts`
  - `src/lib/progress.ts` (rewrite: `createProgressStore`, hydrate §8.2, actions §8.3–8.4, read-only, `persist()` §9.6, dev-only `window.__ledgerSelfTest`)
  - `tests/ledger/{engine,facade}.test.ts`
- **Accept:**
  - P7, P9 and P10 pass, and P3/P5 also pass end-to-end through the engine with MemoryStore;
  - the backup is claimed and downloaded exactly once when two engines boot on one store;
  - no file outside the listed ones changes;
  - the only code that mutates `kernelspace:v1` is `reset()` (`removeItem`);
  - the orphaned-snapshot notice state (§9.8) is exposed on `ledger` status for L6 to render;
  - the entry-chunk growth (from p1's `verify:bundle` output) is ≤8 KB gz and the engine chunk ≤30 KB gz, both reported in the PR;
  - the manual matrix in a real browser: first load with a real v1 value, reload, two tabs, stale old-bundle tab, private window.
- **Merges into `wave-0b-1` only, never `master`, until L4 and L6 land.**

**L4: Data ownership on /progress.** S–M, ~3 h. Depends on: L3.
- **Files:** `src/pages/Progress.tsx` (export v3, import preview with merge/replace and undo, storage line from `storageEstimate()` replacing the raw `kernelspace:v1` read, backup nudge, reset copy, "your pre-v3 record" link); `src/components/ledger/ImportPreview.tsx` (new).
- **Accept:**
  - importing this device's export (merge) adds 0 events;
  - a v2 file previews correct before/after numbers;
  - replace then undo restores the prior ledger;
  - read-only disables the buttons with a reason;
  - the achievements catalog is unchanged.

**L5: V2 confidence.** S, ~4 h. Depends on: L3; q-why-ui merged.
- **Files:**
  - `src/components/QuizBlock.tsx`
  - `src/components/learner/ConfidencePicker.tsx` (new)
  - `src/lib/learner/calibration.ts` (new)
  - `tests/learner/calibration.test.ts`
- **Accept:**
  - every submit writes n `item` + 1 `quiz` event with `conf`, `rev`, `seed` and authored `pick`;
  - keys 1–3 work;
  - confident misses are summarised first;
  - `brier = REL − RES + UNC` to 1e-12 on random inputs;
  - Wilson intervals match reference values;
  - `verify:items` still passes.

**L6: Legacy UX.** M, ~5 h. Depends on: L3, L5 (`ConfidencePicker`); p2-lab-worker merged.
- **Scope:** the What-changed screen, pre-v3 badge, Recertify, baseline cold check, read-only banner and Forge hash.
- **Files:**
  - `src/components/Layout.tsx` (lazy mount of `LedgerNotices`)
  - new: `src/components/ledger/{LedgerNotices,WhatChanged,PreV3Badge,RecertifyList,ReadOnlyBanner}.tsx`
  - new: `src/components/learner/BaselineCheck.tsx`
  - new: `src/lib/learner/cold-check.ts` and `tests/learner/cold-check.test.ts`
  - `src/pages/ForgeLab.tsx` (pass `{wasmSha256}` to `recordLabResult`)
- **Accept:**
  - the dialog shows once per ledger, the ack syncs, and `?whats-changed=1` reopens it;
  - it is never shown to learners without legacy;
  - the cold-check plan is deterministic per seed, honours caps and eligibility, and writes `probe` events;
  - the storage notices from §9.8 (memory backend, orphaned snapshot) render in `LedgerNotices`;
  - the entry chunk does not grow beyond the lazy-mount stub (≤1 KB gz);
  - the dialog uses Radix Dialog with a focus trap. An axe DevTools run with it open on `/` and `/progress` shows no serious violations (screenshot in the PR; CI axe arrives with Playwright).

**L7: S4 change cards.** S–M, ~4 h. Depends on: L3, L5; ch-changes and every errata branch merged.
- **Files:**
  - `src/data/errata/schema.ts` (`items?`)
  - the Wave 0b errata modules (author items)
  - `scripts/verify-errata.ts` (lint the items)
  - `src/pages/changes/ErrataTab.tsx` (use `ERRATA`; mount the "For you" section)
  - `src/components/changes/ChangeCards.tsx` (new)
- **Accept:**
  - with a fixture ledger whose t6 lessons were completed pre-v3, the KVBM card appears with its items;
  - answering writes `item card:*` and acks;
  - new learners see no section;
  - `verify:errata` passes.

**L8: K4 Boot.** M–L, ~11 h. Depends on: L3, L5; s2-claims-atlas, p1-lazy-routes and ch-changes merged.
- **Files:**
  - `src/pages/Boot.tsx` and `src/pages/boot/*` (new)
  - `src/lib/boot/{model,outcomes}.ts` and `tests/boot/{model,outcomes}.test.ts` (new)
  - `src/App.tsx` (route)
  - `scripts/prepare-pages.mjs` (`boot`)
  - `src/pages/Home.tsx` (CTA)
  - `vite.config.ts` (`build.manifest`)
  - `scripts/verify-bundle.ts` (route closure ≤200 KB gz for `/boot`)
- **Accept:**
  - §12.4 steps, events and copy bands;
  - `verify:bundle` passes with the `/boot` closure printed;
  - the page has no horizontal scroll at 360 px and is fully keyboard-operable; an axe DevTools run shows no serious violations (screenshot in the PR);
  - a stopwatch run by the implementer finishes in ≤10 min (first success ≤4 min), recorded in the PR.

---

## 17. Open questions for the owner

1. **OD1.** Confirm (a): frozen pre-v3 badge plus Recertify. The code defaults to `LEGACY_POLICY = 'freeze'`. Under (b) and (c), only `xp`, `achievements`, the badge and the What-changed copy differ (§6.4), and the data is identical.
2. **Service worker.** It is deferred to Wave 1, so Boot is not offline after the first visit in Wave 0b (§7.3 asks for that). Acceptable?
3. **V2 confidence.** Required before Submit (one extra tap per question, keys 1–3), or optional with missing confidence simply not calibrated?
4. **Confidence mapping v1.** `{guess: 0.33, think: 0.67, sure: 0.95}` for Brier reliability. Acceptable?
5. **Erratum items.** Approve the optional `Erratum.items` (≤2 retrieval items per erratum) and the authoring of ~15–20 items, reviewed under S4's 4 h.
6. **Boot entry.** Swap the Home CTA only, or also auto-redirect first visits from `/` to `/boot` ("first visits land on Boot")?
7. **Boot XP.** It pays 0 XP until V5 (XP = graded minutes). Is it fine that a new learner finishes Boot at 0 XP?
8. **Automatic backup.** It is attempted without a user gesture, with a manual button as fallback (iOS behaviour [unverified]). Acceptable?
9. **IdbStore tests.** Manual matrix plus the dev self-test for now. Add `fake-indexeddb` (devDependency) only if a bug class slips through?
10. **Reset** deletes `kernelspace:v1`, the one exception to read-only, so that a reset sticks. OK?
11. **Stale tabs.** Work done in a stale pre-v3 tab after migration is recorded as `legacy`, which is uncredited under (a). OK?
12. **Recertify XP.** Under (a), re-dropping a pre-v3 lab module earns live XP (+200), and re-passing a checkpoint earns +40. Intended?

---

## Appendix A: worked legacy projection

A kernelspace:v1 value (persist version 3):

```json
{"state":{"version":2,"lessons":{"t2.l4":{"status":"done","quizScore":0.75,"completedAt":"2026-08-20T17:02:11.000Z","lastVisitedAt":"2026-08-20T17:02:11.000Z","scrollPct":96}},
 "sims":{"sim-batching":{"visits":3,"tasksDone":["sched-rr"]}},"labs":{},"fleetWeek":{"actsDone":[],"scores":{}},
 "capstone":{"step":0,"stepsDone":[]},"xp":160,"streakDays":["2026-08-20"],"achievements":[],"settings":{"codeLang":"java"}},"version":3}
```

It projects to (tz −420 on the projecting device):

```
legacy:visit:lesson:t2.l4:-                         at 2026-08-20T17:02:11.000Z  day 2026-08-20
legacy:complete:lesson:t2.l4:2026-08-20T17:02:11.000Z  at 2026-08-20T17:02:11.000Z  day 2026-08-20
legacy:quiz:lesson:t2.l4:0.75                       at null  score 0.75 ok false
legacy:sim-task:sim:sim-batching/sched-rr:-         at null  score 1 ok true
legacy:scalar:scalar:sim-visits:sim-batching:3      at null  value 3
legacy:scalar:scalar:xp:160                         at null  value 160
legacy:day:day:2026-08-20:-                         at null  day 2026-08-20
working: scroll:t2.l4 = 96, settings:codeLang = "java"
```

**Under (a):** `xp` = 0 and the badge shows 160 XP, RING 3. t2.l4 stays done. The streak includes 2026-08-20. The EEVDF erratum (2026-10-04, t2.l4) yields a change card, because 2026-08-20 is before the fix.

**A stale tab** later passes the quiz at 1.0. The new key `legacy:quiz:lesson:t2.l4:1` is added, and `quizBest` becomes 1.0.

## Appendix B: consumer inventory (wave-0b-1 @ dde10a7)

| File | Reads | Calls |
|---|---|---|
| `components/Navbar.tsx` | `xp`, `selectOverallPct` | — |
| `components/StatusBar.tsx` | `xp`, `lessons`, `selectDoneLessons`, `selectStreak` | — |
| `components/TrackCard.tsx` | `selectTrackDone` | — |
| `components/QuizBlock.tsx` | — | `recordQuizScore` → `recordQuizAttempt` (L5) |
| `components/sims/PlaygroundShell.tsx` | `sims[simId]` | `recordSimVisit`, `recordSimTask` (through `completeSimTask`) |
| `components/sims/{Quantizer,KvCache,Wgsl}Sim.tsx` | `getState().sims` | `recordSimTask` |
| `components/sims/ToyEngineSim.tsx` | — | `recordSimVisit`, `recordSimTask` |
| `pages/Home.tsx` | `lessons`, `xp`, `capstone.stepsDone`, `selectDoneLessons` | — |
| `pages/Curriculum.tsx` | `lessons`, `xp`, `selectStreak` | — |
| `pages/Track.tsx` | `lessons`, `selectTrackPct` | — |
| `pages/Lesson.tsx` | `lessons[id]`, `getState().xp` | `markLessonStatus`, `setLessonScroll`, `unlockAchievement` |
| `pages/lesson/LessonRow.tsx` | `lessons[id].status` | — |
| `pages/lesson/blocks.tsx` | `settings.codeLang` | — |
| `pages/Lab.tsx` | `sims` | — |
| `pages/Forge.tsx` | `labs` | — |
| `pages/ForgeLab.tsx` | `labs[id]` | `recordLabResult`, `unlockAchievement` |
| `pages/FleetWeek.tsx` | `fleetWeek.*` (and the type of `measurementEvidence`) | `completeFleetWeekAct`, `setFleetWeekEvidence`, `setFleetWeekDoc` |
| `pages/Capstone.tsx` | `capstone.metrics`, `capstone.stepsDone` | `completeCapstoneStep`, `setCapstoneMetrics`, `unlockAchievement` |
| `pages/Progress.tsx` | whole state, `streakDays`, `lessons`, `sims`, `xp` | `importProgress`, `resetProgress`, `exportProgress`; raw `kernelspace:v1` read at :793 (L4 replaces it) |
