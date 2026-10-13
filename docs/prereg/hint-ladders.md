# Pre-registration: hint ladders against packet-only help

**Status:** DRAFT, not signed. The owner signs this before the release that ships packets (task 2c-06, `docs/specs/wave-2.md` §14.4 and Q4). No data is analysed before the signature, and nothing below changes after it except by a dated amendment at the end of this file.
**Feature:** H3 authored hint ladders, `src/components/forge/HintLadder.tsx`; H2 context packets, `src/lib/mentor/packet.ts`.
**Rule it implements:** PLAN-100X §9, "Hint ladders: 30-day accuracy non-inferior (5 pts) to packet-only help. Decide by the Wave 3 exit. Default if underpowered: R0 to R2 only."

## 1. Question

Does a learner who gets the full hint ladder (R0 to R4, then the bottom-out walkthrough) for a failing check remember what the check teaches as well, 30 days later, as a learner who gets only R0 and a context packet for their own agent?

The ladder is the expensive feature (five authored rungs per check, a walkthrough per lab). The packet is the cheap alternative. We keep the full ladder only if it is **not worse** than packet-only help by more than the margin below.

## 2. Design

**Within-learner, per check, randomized at the point of use.** Each red check of labs 01 to 03 (`rust-allocator`, `kv-block-manager`, `bpe-tokenizer`) is assigned one of two arms for each learner.

- **Ladder arm.** R0 (write a teach-back, compare it with three ideas) then R1 to R4 as today, then the bottom-out. The packet button appears once R2 is open.
- **Packet arm.** R0 stays, because the teach-back is the explanation gate. R1 to R4 and the bottom-out stay closed. The packet button shows at once. "Ask a human" is available in both arms, and the page says so.

**Assignment.** `armFor(experiment, unit, expSeed)` in `src/lib/learner/experiments.ts`:

- `experiment` is `hint-ladders`; `unit` is `<labId>/<checkId>`; `expSeed` is the working record `exp:seed`, a uint32 drawn once from `Math.random` the first time a randomized lab shows help and only after the ledger has loaded.
- The arm is the lowest bit of `fmix32(hash32(experiment + ':' + unit + ':' + expSeed))`, 0 for the ladder arm and 1 for the packet arm. The spec's formula is `hash32(...) % 2`; `hash32` is FNV-1a, whose lowest bit is only the parity of the odd bytes, so that formula would give every learner the same arm for the same check (up to one global flip) and confound the arm with the check. `fmix32` (MurmurHash3's finalizer) removes the pattern. `tests/mentor/experiments.test.ts` checks balance (within 4 points of one half), independence between two checks of the same learner, and pins five outputs.
- The assignment is deterministic, so it is the same on every visit and needs no server.

**Recording.** Every hint ack of a randomized check carries `data.arm`, and every `packet:` ack carries `data.arm`, `via` (`claude`, `chatgpt` or `copy`) and `chars`. Analysis uses the **recorded** arm and never recomputes it. A learner who made a second `exp:seed` on another device before the ledgers synced can therefore not corrupt the data; a check with both arms recorded for the same learner is dropped from the primary analysis and counted in the report.

**What the learner sees.** The packet-arm note on the ladder says that the assignment is random, why, and where this file is. No learner is told which arm is "better".

**If the owner declines Q4.** The packet appears after R2 everywhere, no arm is recorded, and this file is withdrawn.

## 3. Outcome

**Primary:** accuracy on the first **cold check** of the check's KCs taken 25 to 45 days after the check's first green run, on fresh generated items (a `probe` event, graded `ok` or not; `data.sinceDays` gives the gap). The check's KCs are the `kcs` of its entry in `src/data/labs.ts`. A KC with no generator family has no outcome and is not analysed.

**Unit of analysis:** the learner. For each learner with at least one analysable check in each arm, the difference *d* = (accuracy on ladder-arm checks) - (accuracy on packet-arm checks), each averaged over that learner's checks.

**Analysis population:** checks where the learner asked for help at least once (any `hint:` or `packet:` ack for the check), because the arm changes nothing for a check that went green without help. Secondary: every check that was ever red (intention to treat).

**Secondary outcomes, reported and not decisive:** attempts to green; the unseen-seed gap; minutes to green; the share of red checks with any help; packet use per red check by arm; rungs reached; bottom-outs and the 24 h "assisted" windows they open; Prove-it attempt rate.

## 4. Decision rule

**Margin:** 5 percentage points. Keep the full ladder if the lower bound of the one-sided 97.5 % confidence interval for the mean of *d* is above -5 points. (The interval is a bootstrap over learners, 10,000 resamples; the point estimate and both bounds are reported.)

**Power.** For a true difference of 0, one-sided alpha 0.025, power 80 % and a standard deviation of *d* of 20 points, 126 learners with an outcome are needed. The 20-point standard deviation is an assumption (nothing in Wave 1 measures it); it is replaced by the observed value in an amendment dated before any outcome is read, and the required n is recomputed then.

**Decide by:** the Wave 3 exit.

**Default if underpowered** (fewer learners with an outcome than the recomputed n at the decision date): R0 to R2 only, and the decision is a qualitative judgement from think-alouds, as PLAN-100X §9 says. R3, R4 and the bottom-out walkthrough then move behind "ask a human".

**If the packet arm is clearly better** (the upper bound of the interval for *d* is below 0): the ladder is cut to R0 to R2 as well.

## 5. Data and limits

- **Source.** The learner's own ledger, donated privately by partners (`docs/specs/wave-2.md` §20, day offsets and no free text) and the opt-in aggregates. Nothing is sent to a server by this feature; the packet ack records how a packet left and how long it was, never its content.
- **Self-selection.** Donors are not a random sample of learners. Results are reported as "among n donors", with no causal claim beyond the randomization within them.
- **Contamination.** Any learner can paste a check's message into an agent without using a packet, and a ladder-arm learner can use the packet after R2. The analysis is by the recorded arm of the **check**, which is what the learner was shown, not by what they then did. Packet use per arm is reported so that contamination is visible.
- **Carry-over.** Checks of one lab share a lesson, so help on one check can help on another. The randomization is per check within learner and the learner is the unit, which absorbs a constant carry-over; a lab-by-arm table is reported to show if it is not constant.
- **Staggered rollout.** "Ladders ship lab by lab" (PLAN-100X §9): a lab enters the analysis from the day its ladder and packet are both live. The order of release is reported descriptively and not used as an instrument.
- **Not randomized.** Labs 04 and later, sim tasks and lessons: the ladder (where one exists) is whole, the packet appears after R2, and no arm is recorded.
- **Stopping.** No interim looks at outcomes. Help-seeking counts (how often each arm's help is used) may be read for safety, for example if the packet arm turns out to leave learners stuck, and a harm signal there is handled as a bug.

## 6. Changes from the spec

1. The arm is taken from `fmix32(hash32(...))`, not `hash32(...) % 2` (section 2).
2. The packet arm keeps R0 but does not require the teach-back before the packet button shows: R1 is the only rung the teach-back gates, and R1 is closed in that arm. Requiring a teach-back for a packet is a different intervention and is not tested here.
3. A rung opened before the arm was known (no seed yet, or a check helped before this release) stays open, and its ack carries no arm; such checks are excluded from the primary analysis.

## 7. Sign-off

| | |
|---|---|
| Owner | |
| Date signed | |
| Amendments | none |

Amendments are appended below this line with their date. Nothing above it is edited after signature.
