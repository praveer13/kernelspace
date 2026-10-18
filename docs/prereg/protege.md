# Pre-registration: protégé blocks against reading the same correction

**Status:** DRAFT for the owner to sign. Drafted by task 3s-11 (`docs/specs/wave-3.md` §16.9, stretch). **The drafter has not signed or dated it**, and nothing below is analysed, selected or randomized until the owner signs (section 7). Nothing changes after the signature except by a dated amendment at the end of this file.
**Feature:** P4 protégé blocks, `src/components/blocks/ProtegeBlock.tsx` (block type `protege`, `src/data/lessons/types.ts`); the nine blocks, one per track, are task 3s-12.
**Rule it implements:** PLAN-100X §9, "P4: 30-day discrimination favours it. Decide by Wave 3 + 60 days. Default if underpowered: one per track", and the plan's own metric for P4 (§5.3): "grows to 25 only if a within-learner comparison favours it". The comparison is the one §9 names: "P4 vs reading the same correction".

## 1. Question

Does a learner tell a misconception from the right idea better, 30 days later, for the KCs where they worked a protégé block (find the false sentence, tag the mistaken idea, pick the repair) than for the KCs where they only read the same passage with the same correction?

The protégé block costs a few minutes a block and an authored passage, three questions and their whys. The plan builds one per track (nine) and grows to 25 only if the comparison favours it. The evidence for the idea is thin: Kucharavy et al. (BEA 2025) report +0.72 points on a 1-6 scale for students who diagnosed an LLM prompted to hold a misconception, which the authors call preliminary, is correlational, and states no sample size (`docs/100x-evidence/research/ai-tutoring.md:145`). **No effect size is borrowed from it.** The power calculation in section 4 uses an effect we would act on, not theirs.

## 2. Design

**Within-learner, per block, randomized at the point of use.** Each learner who reaches a protégé block is assigned one of two arms for that block.

- **Protégé arm.** The block as built: Sam's 4 to 6 numbered sentences, the find, tag and fix questions in order (a why for every option), the false line struck through and tagged "false" once found, the corrected sentence under it once fixed.
- **Reading arm ("the same correction").** The same passage with the false line already struck through and tagged "false", the corrected sentence under it, the misconception the tag question names written out, and the whys of the three questions' key options as plain text. No question, no choice, no answer to give. It holds every fact the protégé arm teaches; it lacks only the finding, tagging and fixing done by the learner.

**Assignment.** The recipe of `docs/prereg/hint-ladders.md` §2: `armFor('protege', '<lessonId>.protege.<n>', expSeed)` of `src/lib/learner/experiments.ts`, the lowest bit of `fmix32(hash32(experiment + ':' + unit + ':' + expSeed))`, with `exp:seed` the learner's own working record, drawn only after the ledger has loaded. It is deterministic, so a block shows the same arm on every visit and needs no server. The block's number `n` is the one in its ledger refs (`item:<lessonId>.protege.<n>.<step>`).

**Recording.** The arm is recorded when the learner first sees the block, and analysis uses the **recorded** arm and never recomputes it, so a second device's own seed cannot corrupt the data. A block with both arms recorded for one learner is dropped from the primary analysis and counted in the report. How the arm is written (a field on the first event of the protégé arm, an acknowledgement event for the reading arm) is decided by the task that builds the assignment and is added here as a dated amendment before the first learner sees an assigned block.

**Eligible blocks.** A protégé block whose KCs have a generator family that serves at least one item with a lure for the block's misconception (task 3s-12 names that item per block). A block whose KCs have none has no outcome and is not analysed; it still ships, always as the protégé arm.

**What the learner sees.** The reading arm's note says that the assignment is random, why, and where this file is. No learner is told which arm is "better".

### Build status at the time of drafting

Task 3s-11 builds the block, its pool and this file. **It does not build the reading arm, the assignment or the recording**, because each of them randomizes learners and this file is unsigned. Until the owner signs and a later task builds them, every protégé block shows the protégé arm to everyone, no arm is recorded, and nothing a learner does on one is data for this comparison. If the owner declines the comparison, the blocks stay as they are and this file is withdrawn.

## 3. Outcome

**Primary:** accuracy on the first **cold check** of the block's KCs taken 25 to 45 days after the learner first saw the block, on fresh generated items of the eligible family (a `probe` event graded `ok` or not; `data.sinceDays` gives the gap), as in `hint-ladders.md` §3. The item is a choice that sets the right idea against the lure of the block's misconception, so a hit is a discrimination: the learner chose the right idea over the one Sam held.

**Unit of analysis:** the learner. For each learner with at least one analysable block in each arm, *d* = (accuracy on protégé-arm blocks' KCs) - (accuracy on reading-arm blocks' KCs), each averaged over that learner's blocks.

**Analysis population (intention to treat):** a block counts from its first recorded appearance in either arm, whether or not the learner finished it, so an arm that is harder to finish is not flattered by the learners who dropped out of it.

**Secondary outcomes, reported and not decisive:**
- the pooled accuracy of each arm with its Wilson 95 % interval and n, and a table per block (the nine differ in difficulty, and the primary comparison does not adjust for that);
- **time on the block per arm** (the visible minutes, `ms` as in `docs/specs/wave-3.md` D59): the protégé arm takes longer, and a result may reflect the time on task and not the finding; it is reported so a reader can see the price, and it is not adjusted away, because the minutes are part of what the feature costs;
- completion: the share of protégé-arm blocks that reach the fix, and the first-try accuracy of the find, tag and fix questions;
- **intrusion** (the plan's risk, "the false line sticks"): among wrong cold-check answers on the eligible items, the share that picked the lure of the block's misconception, per arm. A protégé-arm share more than 5 points above the reading arm's is a harm signal, reported beside the primary result and handled as a defect in how the struck line is shown, not as a reason to wait for the decision.

## 4. Decision rule

**Effect of interest:** 5 percentage points. *Favours it* is read as: the lower bound of the one-sided 97.5 % confidence interval for the mean of *d* is above 0, with at least the learners with an outcome that the power calculation below needs. (The interval is a bootstrap over learners, 10,000 resamples with a fixed seed so the report reproduces; the point estimate and both bounds are reported.)

**Power.** For a true difference of 5 points, one-sided alpha 0.025, power 80 % and a standard deviation of *d* of 30 points, the learners with an outcome needed are ((1.960 + 0.842) x 30 / 5)^2 = 282.6, so **283**. The standard deviation is an assumption: a learner meets at most nine protégé blocks, so each arm's mean rests on four or five blocks and *d* is noisier than the Daily's (25 points in `fleet-daily.md` §4). It is replaced by the observed value in an amendment dated before any outcome is read, and the required n is recomputed then.

**Outcomes** (all read at the same time, by the rule above):
- **grow:** the protégé arm favours it (above) and 283 learners (or the recomputed n) have an outcome. The owner may then author blocks beyond one per track, up to the plan's 25.
- **cut to reading:** the upper bound of the interval is below 0, so the protégé arm is clearly worse. The nine blocks keep their passage and correction as read-only text and their questions leave the `protege` pool.
- **stay at one per track** (the default): anything else, which includes every result with fewer learners than the required n. No block is added and none is removed.

**Decide by:** Wave 3 + 60 days (PLAN-100X §9), so after the wave. **This date will probably pass underpowered.** 283 learners with a block seen and a cold check taken 25 to 45 days later is far above the partner donations the plan expects, and the cold check cannot start before a learner has seen a block. In that case the default applies, and the plan's fallback is a qualitative judgement from think-alouds, run by the owner.

## 5. Data and limits

- **Source.** The learner's own ledger, donated privately by partners (`docs/specs/wave-2.md` §20, day offsets and no free text) and the opt-in aggregates. Nothing is sent to a server by this feature.
- **Self-selection.** Donors are not a random sample of learners. Results are reported as "among n donors", with no causal claim beyond the randomization within them.
- **Time on task.** The arms differ in time as well as in the finding; see section 3. This file does not try to separate the two.
- **Carry-over and order.** A learner who finds the false line in one block may read the next more carefully. Randomization is per block within learner, which absorbs a constant carry-over; the report prints the arm by the block's position in the learner's order, to show if it is not constant.
- **Contamination.** A learner can look the correction up elsewhere. The analysis is by the recorded arm, which is what the learner was shown.
- **Prior knowledge.** A learner who already holds the right idea gains nothing from either arm. Randomization balances this across arms, and it lowers the effect we can see.
- **Stopping.** No interim looks at the outcome. Completion and time counts, and the intrusion share, may be read for safety.

## 6. Choices this draft makes for the owner

1. **"Favours it"** is made precise as a lower bound above 0 at an effect of interest of 5 points. PLAN-100X §9 gives no number. Strike the effect of interest to require only the interval above 0 at any size, and the required n then depends on the observed standard deviation.
2. **The cut rule** (upper bound below 0 turns the nine into read-only text) is the draft's, mirrored from `hint-ladders.md` §4's "if the packet arm is clearly better". The plan names only "grow" and the default; strike the rule to keep the nine whatever the result.
3. **The standard deviation of 30 points** is assumed, as the siblings' were.
4. **The reading arm carries the whys.** A reading arm with the correction and no explanation would compare the protégé block with a weaker text, and the comparison would then favour it for the explanation alone.
5. **The date cannot be met with data.** The draft says so (section 4) and leaves the default in force.

## 7. Sign-off

The owner signs in either of two ways, and either one alone is a signature: replace the pending text on the next line with a name and an ISO date (`Signed: <name> YYYY-MM-DD`, as in `fleet-daily.md` and `watcher.md`), or fill the table's Owner cell with a name and its Date signed cell with an ISO date (as in `hint-ladders.md`). Doing both is fine. Anything that reads this file for its signature (`isPreregSigned` in `src/lib/learner/outcomes.ts`, as for the sibling files) treats it as signed as soon as one form is complete, and as unsigned while neither is: a `Signed:` line without a date, an Owner cell without a Date signed, or a date without a name does not count.

Signed: (pending owner)

| | |
|---|---|
| Owner | |
| Date signed | |
| Amendments | none |

Amendments are appended below this line with their date. Nothing above it is edited after signature.
