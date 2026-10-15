# Pre-registration: the Fleet Daily against no Daily

**Status:** signed by the owner on 2026-10-14 (section 7), with the 5-point margin (section 6, item 1). Task 3c-03 (`docs/specs/wave-3.md` §15.1, §18.2 F3) drafts it; the owner signs it **before `selectDailyVsOther` is read**. `scripts/partner-report.ts` does not call the selector while the line at the end of this file is unsigned, and prints "NOT READ" for the Daily. Nothing below changes after the signature except by a dated amendment at the end of this file.
**Feature:** the Fleet Daily, `src/lib/world/daily.ts`, page `/daily`: one seeded incident a local day on the learner's installed components (hypothesis first, probes spend SLO budget, a debrief against an expert's replay).
**Rule it implements:** PLAN-100X §9, "Fleet Daily: Daily KCs' 30-day diagnosis accuracy on unseen seeds ≥ non-Daily KCs'. Decide by the Wave 3 exit. Default if underpowered: weekly; no On-Call." The On-Call shift of PLAN §8 is gated on the same comparison ("Daily KCs' 30-day diagnosis ≥ non-Daily, or favourable think-alouds"), so this file's verdict is that gate's evidence.

## 1. Question

Does a learner remember how to diagnose a fault 30 days later better, or at least not worse by more than the margin below, for the faults whose KC their own Dailies trained than for the faults whose KC they have not met in a Daily?

The Daily is a daily cost: 10 minutes a day of the learner's time, and a seeded incident generator that needs upkeep. We keep it daily only if it does not make learners worse at the diagnosis it exists to teach.

## 2. Design

**Observational, within learner.** This is not a randomized comparison, and the file says so. The Daily draws its fault from the local date (`generateIncident`), so which of the four fault KCs a learner's Dailies have trained depends on the days they played, not on us. Each learner is compared with themselves, so a strong or weak learner contributes to both groups and the difference removes what is constant about them.

- **The KCs.** The four fault KCs the signature (`sig`) family serves besides the diagnosis skill itself: `t5.kv-capacity` (pool-shrink), `t2.admission-scheduling` (drain-stall), `t7.capacity-planning` (node-death) and `t5.prefill-decode-interference` (tenant-burst), the KCs of `kcsFor` in `daily.ts`. `t7.incident-diagnosis` is in every Daily, so it has no contrast and is left out.
- **Daily KC, for one learner at one moment.** A KC that a Daily the learner had already played carried in its event's `kcs`. Playing means an `inc:daily/<date>` event, fixed or not; a rerun of the same date adds nothing new.
- **Other KC.** A fault KC that no earlier Daily of the learner carried.
- **No randomization is added by this file.** Randomizing the first weeks of Dailies over the fault KCs would be a stronger design, and it needs a change to `daily.ts` that no Wave 3 task owns. If the owner wants it, it goes in as an amendment before the signature.

**What the learner sees.** Nothing differs: no arm, no note. The Daily is not told to be "good for" any KC.

## 3. Outcome

**Primary:** accuracy on the learner's eligible checks, **30-day diagnosis accuracy on unseen seeds**. An eligible check is a graded answer to a `sig` item (a ref `gen:sig/<variant>`) that:

1. has provenance `unseen` (a seed the learner had not met) and is not `assisted`;
2. is on one of the four fault KCs above, as the item's KCs resolve (`kcsOfEvent`);
3. is answered at least 30 local days after that KC's card was created (the card replay of `cards.ts`, as for VRK₃₀).

**Unit of analysis:** the learner. For each learner with at least one eligible check on a Daily KC and one on an other KC, *d* = (accuracy on Daily-KC checks) − (accuracy on other-KC checks). An event with several fault KCs counts once for each.

**Secondary, reported and not decisive:** the pooled accuracy of each group with its Wilson interval and n; the number of learners with a check in only one group; the table per fault KC (the four KCs differ in difficulty, and the primary comparison does not adjust for that, so the table is how a reader sees whether one KC carries the result).

## 4. Decision rule

**Margin:** 5 percentage points, the same as the hint-ladder file's. Keep the Daily daily if the lower bound of the one-sided 97.5 % confidence interval for the mean of *d* is above −5 points. The interval is a bootstrap over learners, 10,000 resamples (the seed of the resampling is fixed, so the report reproduces); the point estimate and both bounds are reported.

**Power.** For a true difference of 0, one-sided alpha 0.025, power 80 % and a standard deviation of *d* of 25 points, the learners with an outcome needed are ((1.960 + 0.842) × 25 ÷ 5)² = 196.2, so **197**. This is the recipe of `hint-ladders.md` §4 with a wider standard deviation: a learner's two groups hold only a few checks each, so *d* is noisier than the ladder's. The 25 points are an assumption (nothing measures it before the Daily has data); it is replaced by the observed value in an amendment dated before any outcome is read, and the required n is recomputed then. `DAILY_MIN_LEARNERS` in `src/lib/learner/outcomes.ts` holds 197 and a test holds it to this recipe.

**Minimum before anything is shown:** below 197 learners the report prints "not enough data (n = … of 197 learners …)" and the Daily's verdict is *underpowered*; it prints no difference, so nobody reads a trend into a small n.

**Decide by:** the Wave 3 exit.

**Default if underpowered** (fewer learners with an outcome than 197 at the decision date): the Daily becomes weekly, and the On-Call shift is not built on it; the decision is a qualitative judgement from think-alouds, as PLAN-100X §9 says.

**If the Daily is clearly worse** (powered, and the lower bound is not above −5 points): the same fallback, weekly and no On-Call. A powered result that is inconclusive (the interval holds both 0 and −5 points) is also not a keep, because the Daily is the costly option and the burden is on it.

## 5. Data and limits

- **Source.** The learner's own ledger, donated privately by partners (`docs/specs/wave-3.md` §15.2: `kcs`, provenance and day offsets are kept; seeds, hashes and free text are not).
- **Self-selection.** Donors are not a random sample of learners. Results are reported "among n donors", with no causal claim.
- **Exposure is not assigned.** A learner who plays Dailies is a learner who likes diagnosis, which the within-learner comparison removes only in part: a learner may play a Daily precisely on the days they feel strong. The result says the Daily KCs were not remembered worse; it does not say the Daily made them better.
- **Fault KCs differ in difficulty.** The primary comparison does not adjust for it. It cancels when most learners have met most KCs, and does not when they have met few: the per-KC table in section 3 is the check.
- **Contamination.** A learner can answer a `sig` item in Today after a Daily showed them the same fault. That is the effect under study, not a leak.
- **Sig items outside Today.** A `sig` answer counts wherever it was served (Today, tickets, forms), provided the seed was unseen.
- **Stopping.** No interim looks at the outcome. Counts (learners with a Daily, eligible checks per group) may be read for safety and to plan the donation drive.

## 6. Changes from the plan's wording

1. **A margin.** PLAN says "≥". Read literally, a point estimate of 0 or more is a keep, and a Daily that is exactly as good as no Daily would be killed half the time by noise. The 5-point margin makes it the ladder's non-inferiority test. Strike section 4's margin (and this item) to restore the literal rule: keep when the mean of *d* is 0 or more and 197 learners have an outcome. The owner chooses; the draft proposes the margin. **The owner chose the margin** (2026-10-14).
2. **The diagnosis skill is left out of the comparison** (section 2).
3. **The design is observational** (section 2).

## 7. Sign-off

The owner signs by replacing the pending text on the next line with a name and an ISO date (for example `Signed: P. Naigaonkar 2026-10-14`). `isPreregSigned` in `src/lib/learner/outcomes.ts` reads that line, as `scripts/landscape/score.ts` reads the watcher's.

Signed: Praveer Naigaonkar 2026-10-14

Amendments are appended below this line with their date. Nothing above it is edited after signature.
