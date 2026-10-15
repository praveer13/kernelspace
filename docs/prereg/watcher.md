# Pre-registration: the landscape watcher backtest

**Status:** signed by the owner on 2026-10-14 (the end of this file); drafted by task 2a-20 (docs/specs/wave-2.md §18). **Nothing is scored until the owner signs this file**: `scripts/landscape/score.ts` refuses to write a report while the `Signed:` line below is empty.

## The question

PLAN-100X S4 holds the weekly landscape watcher (a digest of about 20 repositories' releases that maps release-note lines to the lessons and claims they could change) until a backtest shows its precision and recall justify the hours. The planning backtest read three repos, was rated by the person who proposed the keywords, and missed llm-d's `fs-connector` deprecation. This backtest fixes each of those: all 20 repos, a fixed window, an independent rater.

The decision it informs (made at the start of Wave 3): **keep** the watcher as a weekly digest feeding local triage, or **drop** it and keep scanning release notes by hand.

## What is fixed before any rating

| Item | Value |
|---|---|
| Repos | the 20 in `scripts/landscape/watchlist.ts`: vllm, sglang, dynamo (Dynamo), llm-d, TensorRT-LLM, flashinfer, flash-attention, DeepEP, DeepGEMM, Mooncake, LMCache, verl, slime, AReaL, mistral.rs, candle, burn, cudarc, InferenceX, gateway-api-inference-extension |
| Window | 2026-08-01 to 2026-09-30 inclusive, UTC (61 days, 8.7 weeks; holds Dynamo v1.5.0's KVBM deprecation of 2026-09-21 and llm-d v0.10.0's fs-connector deprecation) |
| Snapshot | `docs/backtest/snapshot.json`, every published release in the window, fetched once; sha256 `ad25b58d6a27507e9589f80dbb7fa6bfa56be7501e702e752039e15187fca0d7` (181 releases, 9,960 distinct lines) |
| Matcher | `scripts/landscape/match.ts` as committed with this file: the dossier's keyword rule (deprecat*, remov*, default*, renam*, and GA) AND a term tag (KC titles, lesson H2 heads, claim ids' last segment, the dossier's KVBM, InferenceMAX and NIXL) or, failing a tag, a lesson that names the repo |
| Flagged set | `docs/backtest/candidates.json`, written by that matcher from that snapshot: 617 candidates (171 by term, 446 by repo anchor), 71 a week |
| Unit | a **distinct release-note line**: each line of each release's title and body at its first appearance in the repo within the window (a nightly or rc that repeats an earlier release's notes adds nothing) |
| Truth | a line the rater says should change a lesson or a claim (below) |

The matcher, the snapshot and `candidates.json` are frozen at the commit that merges this file. **No change to `match.ts`, `watchlist.ts` or the keyword rule after the owner signs, and none after a rating exists, counts toward this decision.** A better matcher is a new matcher: it is scored on a new window, rated again, under a new pre-registration.

## Independent rating

- The rater is the owner, or a fresh agent given **only** `docs/backtest/snapshot.json` and the lesson list (`bun scripts/landscape/match.ts --lessons`: id, title, hook). The rater must not read `candidates.json`, `match.ts` or `report.json`.
- The rater labels every distinct release-note line in the snapshot that should change a lesson or a claim: a statement that something the course teaches as current has been deprecated, removed, renamed, had its default changed, reached GA, or otherwise stopped being true. Marketing, new features the course does not teach, fixes and dependency bumps are not true lines.
- The rater writes `docs/backtest/ratings.json` (format in the header of `scripts/landscape/score.ts`): `repo`, the `line` copied from the snapshot, and optionally `shouldChange` with the lesson and claim ids it should change.
- `score.ts` refuses a file that carries a matcher-only field (`id`, `keywords`, `via`, `terms`, `lessons`, `claims`, `candidates`, ...), whose `sawMatcherOutput` is not `false`, whose lines are exactly the flagged set, or that rates a line the snapshot does not contain.
- Optional: a second rater on a random 10 % of lines; agreement below kappa 0.6 is reported beside the score and the owner decides whether the rating can be trusted.

## Scoring

Per repo and pooled, written to `docs/backtest/report.json` with Wilson 95 % intervals:

- precision = flagged and true, divided by flagged;
- recall = flagged and true, divided by true.

Also reported, and not part of the bar: precision and recall by route (term, repo anchor), how often a true line's candidate names a lesson or claim the rater also named, every missed true line, and repos with at least 3 true lines and none flagged.

## The keep bar

The watcher is **kept** only if all five hold on the pooled numbers:

1. **Recall at least 0.80.** A watcher that misses one true change in five does not replace the manual scan, because the manual scan would still have to run.
2. **Precision at least 0.25.** At most three flags in four may be noise, because every flag costs a read.
3. **At most 90 flags a week** (the 8.7-week window gives a cap of about 784). The weekly triage budget is 1.5 h (PLAN-100X section 8.2) at about a minute a flag.
4. **Both known deprecations are caught.** If the rater marks the KVBM deprecation (dynamo v1.5.0) or the llm-d fs-connector deprecation (llm-d v0.10.0) true, the matcher must have flagged it. These are the two events the planning backtest was built around.
5. **At least 20 lines rated true.** With fewer, the intervals are too wide to decide on: the outcome is **underpowered**, the watcher is not kept, and the backtest is repeated on a second 8-week window before Wave 3 decides.

Outcomes: `keep` (all five), `drop` (a bar missed with enough evidence: manual scan stays, which costs the weekly triage the plan already budgets), `underpowered` (bar 5). There is no partial keep and no relaxing a threshold after the numbers are known. The two numeric thresholds are mirrored as `KEEP_BAR` in `scripts/landscape/score.ts`, and a test holds this file to those constants.

## Owner sign-off

The owner signs by replacing the pending text on the next line with a name and an ISO date (for example `Signed: P. Naigaonkar 2026-10-12`). `score.ts` reads that line.

Signed: Praveer Naigaonkar 2026-10-14
