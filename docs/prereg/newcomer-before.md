# Pre-registration: five newcomers on the first three lessons

**Status:** DRAFT for the owner to sign. Drafted by Wave 1 stage 0, task K1-0 (the audit's section 7, "Before anything"; roadmap Q2 (i)). **The drafter has not signed or dated it**, and nothing below is run, scored or reported as data until the owner signs it (section 7). Nothing changes after the signature except by a dated amendment at the end of this file.
**Feature:** the first-session kit, `docs/sessions/newcomer-before/`: the task script, the observation sheet, and a fixture run of the Wave 1 partner report.
**Rule it implements:** the audit's first step before any wave ("Before anything", report.md section 7): "Watch five newcomers on t0.l1, r.l1 and t2.l1. It is the cheapest test of this report and the owner's own unmet gate ('≥5 partners complete the block-placement loop'); it should precede the months of work, not accompany them." The gate is PLAN-100X.md:689.

## 1. Question

Where do five newcomers first get lost in the course as it stands today, and do the audit's predictions about the first three lessons happen to them?

The three lessons are the ones the audit puts first: t0.l1 (the first screen), r.l1 (the first Rust lesson) and t2.l1 (the first systems lesson on the full ramp). The predictions are the audit's, not this kit's: L4 (the first screen is written for someone who already knows half of it), L5 (there is nowhere to look a word up), L8 (two orders on screen and no path) and O11 (the serving-first path leaves holes that its lessons assume). The kit does not test teaching quality, and it does not score a learner.

## 2. Design

**The decision instrument is a think-aloud session, observed by hand.**

- **Who.** Five newcomers who match the learner the course names: a backend engineer working in Java or Python, able to serve an API, with no systems background. Not the owner and nobody who has read the course. If fewer than five can be recruited, the session still runs and the report states its n; nothing is inferred from fewer than five.
- **When.** Before the three held Wave 1 pull requests merge: PR-009 (K1-7, t0.l1), PR-015 (K1-14, t2.l1's primer) and PR-029 (K1-6, the lesson read right after t0.l1). They are built and held until the sessions have run or the owner answers Q2 (i). r.l1 is not rewritten in Wave 1 (it changes in Wave 5), so the session reads it as it stands. The session reads the site as it stands on its day: the kit names the build it observed (docs/audit-2026-11/master-vs-d478f91.md records the build id and the assets the site served when it was written, and the observer writes down the same two values on the sheet).
- **Material.** Today's t0.l1, r.l1 and t2.l1, Boot's path step, the Curriculum (Path) page, Up Next, the find-a-word surfaces (the glossary and ⌘K), and one serving-first lesson's closing paragraph and its Rust reading block (t5.l7). Nothing Wave 1 will build is part of the session.
- **Session.** About 50 minutes, one learner at a time, remote or in person, with the learner's own browser in a private window. The learner thinks aloud; the observer does not teach, point at an answer, or explain a term. The only prompts are the script's step prompts, plus these four generic follow-ups: "keep going", "what are you looking at?", "what would you do next?", "what does that word mean to you?". The observer may not ask a content question the script does not contain. If a learner is stuck for five minutes, the observer reads the next script prompt and moves on.
- **Recording.** The observer writes verbatim quotes and elapsed minutes per step on the sheet while the session runs. A screen recording is optional and needs the learner's consent; it is kept outside the repository. The repository holds no learner's name, contact, employer, voice or screen. Learners are `L1` to `L5`, and a quote is used only with that learner's consent.
- **The steps.** `script.md` gives one numbered step per screen or decision in each lesson, with the prompt to read and what to watch for. `sheet.md` is the blank form the observer fills: one row per step, with start and end minutes, help given, the quote, and the prediction it bears on.
- **The ledger part.** After the session, a learner may export progress from `/me`. `bun scripts/partner-report.ts --wave1 <export>` prints the Wave 1 report over it. The session is a think-aloud of three lessons, not the block-placement loop, so G1, G2 and G3 will usually be empty; G7 measures Today sessions only if the learner used Today. The ledger figures support the session's notes and never replace them. `report-fixture.txt` is one run over the synthetic export `fixture-export.json`, kept so the format is known before the first real export; it contains no learner's data.
- **Who scores.** The owner, or a person the owner names, reads each sheet against section 4 before reading any other learner's sheet. The build does not rate the learners, and no score is computed for a learner.

## 3. Outcome

**Primary: the first step at which the learner needs help, per session, and the minutes from the lesson's first screen to its first answer.** Both come from the sheet.

**Secondary: each prediction, as a count over the five sessions.** The sheet asks them in a fixed form so the count is mechanical:

| Prediction | What the sheet records | A prediction that happens |
|---|---|---|
| L4 | What the learner says "KV cache" means at t0.l1's first question, before answering it; whether they find where the lesson answers its own opening question | The learner reads the KV cache as a cache they know (Redis, a dictionary) and the opening question is found only in a quiz's feedback |
| L5 | Whether the learner looks a word up at all; whether TTFT, block table or prefill has a definition they reach; the time it takes | No lesson word links to a definition, the glossary has no TTFT entry, and ⌘K does not find lesson prose |
| L8 | What the learner says comes next after each lesson; where they click to find it; what the course's hours are when asked | Next, previous, the Curriculum and Up Next disagree; the learner cannot say which path they are on |
| O11 | Whether the learner notices a term a serving-first lesson assumes; whether Boot's path choice named the holes before they met one | The learner meets T2 or T4 vocabulary in t5.l7 with no notice and no link |

**Also recorded, without a prediction:** every place the learner asks "what does this word mean?", every link they open, and every time they leave the lesson and come back. The last is the audit's L2, which Wave 0 partly met; the sheet does not score it.

## 4. Decision rule

**The session reports; the owner decides.** This file fixes only how the session is read, so the reading cannot drift after the fact.

- **A confirmed prediction** is one that happens in at least 3 of the sessions counted for it (five for L4, L5 and L8; the serving-first sessions for O11). Its Wave 1 fixes are already planned: K1-7 and K1-6 for L4; K1-8 for L5; K1-9, K1-10 and K1-11 for L8; and K1-12, K1-5, K1-9 and K1-6 for O11. The roadmap's ledger names the later packages (K1-29, K4-17 and others). Confirmation changes no scope: it tells the owner the package is aimed at a real stall.
- **A refuted prediction** (fewer than 3 of 5) is reported with its quotes. It does not cancel a package by itself; the owner may drop or re-aim it, and until then the package's brief stands. **O11 is counted over the serving-first sessions only:** with fewer than three of those, O11 is underpowered and is not called refuted.
- **A stall the audit did not predict** is reported under "what surprised us", with the step, the minutes and the quote. It is a candidate for a fix the owner adds; it does not silently become a task.
- **Underpowered** (fewer than 5 sessions): report n and the individual sheets, infer nothing about the population, and change nothing.
- **Nothing here gates a merge.** The three held pull requests wait for the owner's Q2 (i) answer, not for a score. If the owner answers "no sessions", this file stays an unsigned draft and the wave's report says the wave was not checked against a learner.

## 5. What the kit is not

- Not a usability certification: five people in one hour can find a first stall, not prove a lesson works.
- Not learner research stored in the repository: counts and consented quotes only, never a name or a contact.
- Not a grading study, and not a measurement of learning: the course's declared minutes stay declared, and no threshold here moves a budget, a ring or a wave.
- Not the block-placement gate: G1 is read from real exports when the owner has partners' exports; the three think-aloud lessons are not that loop.

## 6. What waits on this file

`docs/sessions/newcomer-before/` is complete and needs no signature to merge, so the owner can run the sessions whenever they choose. At the default, the build runs no session; PR-009, PR-015 and PR-029 stay unmerged; every other Wave 1 pull request goes ahead and its description says it was not checked against a learner. The kit is reused, with its own lesson lists, by K1-29 (five newcomers on the new first hour), K4-18's item 3 (timed learners on the Rust ramp and labs) and K5-26 (learners on the rebuilt t2.l1 and the queueing lesson).

## 7. Owner sign-off

The owner signs in either of two ways, and either one alone is a signature: replace the pending text on the next line with a name and an ISO date (`Signed: <name> YYYY-MM-DD`, as in `fleet-daily.md` and `watcher.md`), or fill the table's Owner cell with a name and its Date signed cell with an ISO date (as in `hint-ladders.md`). Doing both is fine. Anything that reads this file for its signature (`isPreregSigned` in `src/lib/learner/outcomes.ts`, as for the sibling files) treats it as signed as soon as one form is complete, and as unsigned while neither is: a `Signed:` line without a date does not count, and an Owner cell without a Date signed does not count. The table form checks only that the Owner cell is not empty and that the Date signed cell holds a date; it does not check that the Owner text is a name.

Signed: (pending owner)

| | |
|---|---|
| Owner | |
| Date signed | |
| Amendments | none |

Amendments are appended below this line with their date. Nothing above it is edited after signature.
