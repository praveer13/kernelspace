# Pre-registration: the Tiling Cube in 3D against linked 2D views

**Status:** DRAFT for the owner to sign. Drafted by task 3s-02 (`docs/specs/wave-3.md` §16.1, stretch). **The drafter has not signed or dated it**, and the owner signs it **before 3s-02 merges** (spec Q7, §16.1), so that no view data exists before the margin below is registered. Nothing that reads this file runs before the signature: `selectCubeByView` in `src/lib/learner/outcomes.ts` is called by nothing yet, and when a report calls it, it does so only after `isPreregSigned` finds the signature in section 7. Nothing below changes after the signature except by a dated amendment at the end of this file.
**Feature:** the 3D view of the Tiling Cube, `src/components/play/tiling-cube/Cube3D.tsx` behind `src/components/three/View3D.tsx` (task 3s-01, shipped dark), opened by "Show it in 3D" on the levels the assignment below gives it.
**Rule it implements:** PLAN-100X §9, "Cube 3D as default: within-learner non-inferiority (§9), 2027-12, default: opt-in" and §5.4.0's "3D only for the matmul Tiling Cube, opt-in, until it is shown to teach at least as well as linked 2D views". PLAN §9 asks for "cube levels × view, fully counterbalanced"; OD9 puts the same burden of proof on the 3D view as on any seductive detail.

## 1. Question

Does a learner estimate the cube's quantities as well 30 days later, with a margin, on the levels that offered a 3D view as on the levels that offered the 2D faces alone?

The 3D view costs a lazy chunk of about 240 KB gzip (three and R3F) and upkeep, and the evidence is against it by default: a scene that does not carry the concept is a seductive detail (Sundararajan and Adesope 2020, g = -0.33 over 58 papers; `docs/100x-evidence/research/games-3d.md`, F4), realistic visuals teach less than schematic ones (Clark 2016, g = -0.01 against 0.48), and the cube's 2D faces and DOM table already show every number the box would. So **the burden of proof is on the 3D view**, and its default is the 2D faces with 3D opt-in.

## 2. Design

**Randomized within learner, per level.** Each learner's six levels split 3 + 3 between **2D only** and **3D available**, so every learner is compared with themselves and a strong or weak learner contributes to both views.

- **Assignment.** `cubeViewsFor` in `src/lib/learner/cube-views.ts`. The coin of a level is `armOf('cube-view', <level id>, expSeed, 2)` of `src/lib/learner/experiments.ts`: 0 is 2D only, 1 is 3D available, with `exp:seed` the learner's own working record, drawn only after the ledger has loaded (the recipe of `hint-ladders.md` §2). Six independent coins split 3 + 3 only 20 times in 64, so a split that is off is repaired: the levels of the larger side with the smallest tie-break keys (`armOf('cube-view', '<level id>:tie', expSeed, 2^30)`) flip until it is 3 + 3. The coins and the keys treat the six levels alike, so each of the 20 balanced splits is equally likely (a test counts them). It is deterministic, so a learner gets the same split on every visit, and it needs no server. The level ids are `count`, `smem`, `occupancy`, `raster`, `fp8` and `flash`.
- **Counterbalancing.** Which levels carry 3D is random per learner, so level difficulty and position in the sequence are balanced across the two views in expectation, not fixed by a Latin square. The draft prefers the random split to a fixed rotation: six levels allow no balanced Latin square of the views, and a fixed pattern would let a hard level always be a 3D one for half the learners.
- **What the exposure is.** *Availability*, not use. A 3D level shows one more button, "Show it in 3D", under the 2D faces and their table; the 2D faces come first on every level and the box opens only on request. The analysis is by availability (intention to treat), so it answers the product question: does offering the opt-in view help or hurt. It does not say what happens to a learner who opens it, because whether they did is not recorded (the play result has no field for it, and 3s-02 adds no event kind).
- **Recording.** When a level's views open, the view that level was given is fixed and kept for the session, and when the closing debrief is reached `recordPlay` writes it with each level (`PlayData.levels[].view`, `'2d'` or `'3d'`). Analysis uses the **recorded** view and never recomputes it, so a second device with its own seed cannot corrupt the data. A learner with no `exp:seed` yet (the ledger still loading, a read-only tab) is offered no 3D, has no view recorded for those levels, and they are in neither group.
- **What the learner sees.** On a 3D level: "Three of the six levels offer a 3D view, picked at random for you, to find out whether it helps." At the end of the play: the same sentence and a pointer to this file. The 3D view's own note says the 2D faces are the whole picture and the box adds no numbers. No learner is told which view is "better".

**The spatial proxy (opt-in, two items).** Spatial ability moderates learning from visualizations (Höffler 2010, EPR 22(3):245-269; `games-3d.md:407`, the effect sizes were not retrieved), so the analysis is stratified by it. After the closing debrief, a learner in the evaluation is offered two puzzles, "about two minutes, optional, not marked for you":

1. **Count the cubes** (numeric): a solid stack of unit cubes in an isometric drawing, 15 cubes, some of them hidden behind others.
2. **Order the views** (an ordered list of ids, moved with buttons): the top, left and right flat views of another stack, from the one with the fewest squares to the one with the most (6, 8 and 10 squares).

There are **no choice items**, so no distractor pool exists and no `verify:items` strategy applies. The answers are recorded as `item:cube.spatial.1` and `item:cube.spatial.2`, src `practice`, with no KC, and are not credited anywhere (no card, no competence, no VRK30). The learner is not told which were right. A learner who answered both before is not asked again.

## 3. Outcome

**Primary: the 30-day fresh-item error.** For a learner's `tiling` and `roofline/tile-ai` answers, error = min(1, |log10(answer / truth)|), the size of the miss in orders of magnitude, capped at a factor of ten so that one wild entry cannot carry a learner. An answer is eligible when it is:

1. a graded `gen:` item of the cube's levels with a fresh item: `roofline/tile-ai` (level `count`), `tiling/smem-fit` (`smem`), `tiling/ctas-per-sm` (`occupancy`), `tiling/raster-ai` (`raster`), `tiling/fp8-ridge` (`fp8`). `tiling/qblock-ai` (`flash`) is left out because its score-matrix question takes byte units and a donation keeps no unit, as for `selectCubeError30` (F7);
2. on an unseen seed (provenance `unseen`), outside the cube (src not `play`), with `value` and `truth` above zero;
3. answered at least 30 local days after the learner's first cube play that recorded a view;
4. on a level whose recorded view is `2d` or `3d`.

**Unit of analysis:** the learner. For each learner with at least one eligible answer on a 3D level and one on a 2D level, *d* = (mean error on the 3D levels' items) - (mean error on the 2D levels' items). Positive *d* is worse in 3D. Five of the six levels have a fresh item, and a learner's 3D levels number three, so at least two of the five are 2D and at least two are 3D: no learner is structurally missing a view.

**Stratified, reported and not decisive:** *d* within each stratum of the spatial proxy: **high** (both puzzles right), **low** (answered both, fewer than two right) and **none** (did not take both). With two items the strata are coarse and the high and low ones will hold few learners; they say whether one stratum carries the result, and nothing is decided on them.

**Also reported:** the number of eligible answers per view, their pooled mean error, the learners with an answer in only one view, and the learners who played the cube with no view recorded.

## 4. Decision rule

**Margin (non-inferiority):** 0.10 in *d*, which is a factor of 10^0.10 = 1.26 in the size of an estimate's miss. The cube counts a level's opening prediction as right within a factor of 2 (0.301 in log10 units), so the margin is about a third of the tolerance the cube already calls right. The interval is a bootstrap over learners, 10,000 resamples with a fixed seed so the report reproduces; the point estimate and both one-sided 97.5 % bounds (the 2.5th and 97.5th percentiles) are reported.

- **3D is non-inferior** when the **upper** bound of *d* is below +0.10, with at least the learners needed below.
- **3D is inferior** when the **lower** bound of *d* is at or above +0.10: the box makes the miss at least a factor of 1.26 larger.
- **Inconclusive** is anything else with enough learners; **underpowered** is fewer.

**Power.** For a true difference of 0, one-sided alpha 0.025, power 80 % and a standard deviation of *d* of 0.30, the learners with an outcome needed are ((1.960 + 0.842) x 0.30 / 0.10)^2 = 70.7, so **71**. This is the recipe of `hint-ladders.md` §4. The 0.30 is an assumption: a learner's mean error over a view rests on one to three answers, each between 0 and 1, and nothing measures it before the cube has data; it is replaced by the observed value in an amendment dated before any outcome is read, and the required n is recomputed then. `CUBE_VIEW_MARGIN` and `CUBE_VIEW_MIN_LEARNERS` in `src/lib/learner/outcomes.ts` hold 0.10 and 71, and a test holds them to this recipe.

**Minimum before anything is shown:** below 71 learners with an answer in both views the report prints "not enough data (n = ... of 71 learners ...)" and no difference.

**What each result does:**

| Result | What happens |
|---|---|
| non-inferior | 3D stays opt-in. It becomes **eligible** for the Wave 4 gate that may make it the default (2027-12). Non-inferiority on accuracy does not meet that gate's "no time cost" (section 5), so it is not enough alone. |
| inferior | The "Show it in 3D" entry is removed (View3D is set unavailable everywhere) and `Cube3D.tsx` is deleted with its chunk. The 2D faces are the cube. |
| inconclusive | 3D stays opt-in, as before. |
| underpowered | **The default applies: 3D stays opt-in**, on the levels the evaluation gives it. |

**Decide by:** the PLAN's date for the default is 2027-12. **This date will probably pass underpowered.** Seventy-one learners who played the cube with a view recorded, and who then answered a fresh item of a 3D level and of a 2D level 30 or more days later, is far above the partner donations the plan expects. In that case the default applies and nothing changes for learners: 3D stays opt-in.

**Stopping:** no interim look at the outcome. Counts (learners who played the cube with a view recorded, eligible answers per view, spatial puzzles taken) may be read for safety and to plan the donation drive.

## 5. Data and limits

- **Source.** The learner's own ledger, donated privately by partners (`docs/specs/wave-3.md` §15.2: `levels[].view`, `value`, `truth` and day offsets are kept; seeds and free text are not).
- **Self-selection.** Donors are not a random sample of learners. Results are reported "among n donors", with no causal claim beyond the randomization within them.
- **Availability, not use.** See section 2. If few learners open the box, a null result says the opt-in view changed nothing, and nothing about what the box would do if it were everyone's default.
- **Time is not measured.** PLAN §9 asks for "no time cost". The play records the whole play's time and each prediction's and check's time, and **nothing of the time spent in the views of one level**, so the cost of the 3D view in minutes cannot be separated by view. 3s-02 adds no field for it (the schema is not its to change). A move to 3D by default therefore needs a measure of time on the level by view, added by amendment before it is read, whatever this file's result.
- **Fresh items depend on Today.** The outcome exists only for learners whose Today serves an item of a level 30 or more days after the play; the number who have both a 2D and a 3D item is small, and that is why section 4 expects to be underpowered.
- **One exposure.** The levels are teaching, not only measuring: a learner who sees the 3D box on level 3 may understand level 3 better and also the next level, which is not their 3D level. Randomization per level within learner absorbs a constant carry-over and not a view-specific one.
- **Replays.** A second play is a new session with the same views (the coin is fixed by the learner and the level); only the first recorded view of a level counts and the clock starts from the first play with a view.
- **The proxy is a coarse measure.** Two items, no norm, and a learner may skip them; its strata are for reading the result, not for adjusting it.
- **Contamination.** A learner can read about tiling elsewhere. The analysis is by the recorded view, which is what the learner was offered.

## 6. Choices this draft makes for the owner

1. **The margin, 0.10 log10 units of error.** PLAN §9 says "non-inferior" and gives no number. A third of the cube's tolerance for a prediction (a factor of 2) is the draft's reading of "small enough that the learner still calls it right". A larger margin shortens the study and weakens the claim; strike this item and the margin to choose another. The margin and the 71 move together.
2. **The standard deviation of 0.30** is assumed, as the siblings' were (`fleet-daily.md`, `protege.md`).
3. **The cut rule.** The sibling files cut a feature that is clearly worse; here the entry is removed when the lower bound is at or above the margin, not for any harm. A harm smaller than the margin is the cost of the opt-in the plan already accepts. Strike the rule to keep the entry whatever the result.
4. **Intention to treat on availability** (section 2). The alternative, analysing by whether the box was opened, needs a field the play does not have and would break the randomization.
5. **The balanced split.** The draft repairs six coins to 3 + 3 (section 2) rather than letting the split vary, so every learner has both views; a plain coin per level would leave 2 learners in 64 with all six levels on one side (no within-learner contrast at all) and 12 in 64 with a single level on the other.
6. **The proxy in the 2-item form the spec asks for.** A stratum of two items is coarse; the draft keeps the spec's form and says so in section 3.
7. **The date cannot be met with data** (section 4). The draft says so and leaves the default in force.

## 7. Sign-off

The owner signs in either of two ways, and either one alone is a signature: replace the pending text on the next line with a name and an ISO date (`Signed: <name> YYYY-MM-DD`, as in `fleet-daily.md` and `watcher.md`), or fill the table's Owner cell with a name and its Date signed cell with an ISO date (as in `hint-ladders.md`). Doing both is fine. Anything that reads this file for its signature (`isPreregSigned` in `src/lib/learner/outcomes.ts`, as for the sibling files) treats it as signed as soon as one form is complete, and as unsigned while neither is: a `Signed:` line without a date, an Owner cell without a Date signed, or a date without a name does not count.

Signed: (pending owner)

| | |
|---|---|
| Owner | |
| Date signed | |
| Amendments | none |

Amendments are appended below this line with their date. Nothing above it is edited after signature.
