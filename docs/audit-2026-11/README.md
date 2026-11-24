# The 2026-11 audit and the roadmap for waves 1 to 5

This folder holds the audit report of the course, the roadmap for the audit's waves 1 to 5, the roadmap's package list, and the two reviews of the roadmap's draft. They were written outside the repository and are published here as written, so that the plan for the waves still to come sits beside the course it describes.

## The files

- [report.md](report.md): the audit report. What is wrong, out of date, out of order or missing in the course at master d478f91, what the audit says to keep (its section 6), and a plan in waves 0 to 5 (its section 7).
- [roadmap.md](roadmap.md): the roadmap for the audit's waves 1 to 5. Packages in waves, the pull requests in review order, the owner questions with the default the build would take if the owner says nothing (section 7), and a ledger of which Wave 0 task or package closes each finding (section 14).
- [packages.json](packages.json): the roadmap's package list, 120 rows, one per package, with the fields the roadmap's "Files:" list describes. Its main fields: `what` (the brief), `touches` (files and folders it may edit), `done_when`, `deps`, `risk`, `owner_question`, `roadmap_changes`.
- [advocate.md](advocate.md): a review of the roadmap's draft by a reviewer asked to argue the owner's side (the "owner's advocate"). It is not the owner's own text. The roadmap's section 9 says how each of its findings was applied.
- [critic.md](critic.md): the critic's review of the roadmap's draft. The roadmap's section 15 says how each of its findings was applied.
- [after-wave-0.md](after-wave-0.md): what Wave 0 changed for this plan, written after these files: which statements of the roadmap and the packages still hold (section 2; six no longer do: R13, R16, P10, P25, P31, P32), what Wave 0 left open and which package, if any, would meet it (section 3; 42 items no package owns, summed up at the end of the section), the rules and guards a later package must keep (section 4), and the owner decisions waiting (section 5).

Each Markdown file has a short note under its title saying where it comes from. packages.json cannot carry one, so this is its note: it is the roadmap's package list as written on 2026-11-21 from the audit of master at d478f91, before Wave 0 was finished; it is a plan, not a record; its `status` says what the plan would do at the default, not what has happened: "built-merge-held" means to be built and held unmerged until an owner question is answered, "conditional" built only on the owner's yes, "owner-step" a step only the owner takes, "absorbed" merged into another package. No package is built. Its `wave` is the wave a package is built in; `planned_in` the planner's file it came from (w1 to w5), or "roadmap" for a package the roadmap added. after-wave-0.md says what has changed since.

## Reading order

1. report.md: section 1 (the verdict) and section 7 (the plan), then the findings as needed.
2. roadmap.md: sections 1 to 3 (size, order, what runs side by side), section 6 (each wave in brief), then section 7 (owner questions; Group A first).
3. after-wave-0.md, for what Wave 0 has since changed in that plan.
4. advocate.md and critic.md, for why the roadmap is as it is. Both read an earlier draft, so their counts and question names differ from the roadmap's.
5. packages.json, for one package's full brief.

## Dates

- 2026-11-18: the audit finished. It describes master at d478f91 (exported 2026-10-30) and the live site as it was walked then.
- 2026-11-21: the roadmap, the advocate's review and the critic's review were written, before Wave 0 was finished.
- Wave 0 ("what harms a learner today") was then built and merged: pull request #29 on 2026-11-22 and pull request #30 on 2026-11-24 (UTC). Its record is [docs/specs/k0.md](../specs/k0.md).

## Status

Only Wave 0 is built. Waves 1 to 5 are a plan: nothing of them is built, and their scope and order are the owner's open decision. The roadmap's owner questions (its section 7, Q1 to Q32) are unanswered; the defaults it names are what the build would take if the owner says nothing, not choices anyone has made. Nothing in this folder records an approval.

The waves as the roadmap's section 1 names them (its section 6 gives the packages): Wave 1, followable by the stated learner, starting with stage 0 and one structure release; Wave 2, the serving half (T5 to T7); Wave 3, facts that do not decay, beside Wave 2; Wave 4, the Rust ramp and honest labs; Wave 5, depth in the lower tracks. None of it is built.

The roadmap asks Q1 first (review hours and order: its Group A, "ask first"), and puts nine more in its week 1 (section 7, "When to ask": Q2, Q4, Q6, Q10, Q11, Q14, Q16, Q23, Q29). Wave 0's own open items (the ten decisions in #30's description, and its owner questions 1 to 27 and rows A to H) are in after-wave-0.md section 5; all are unanswered.

## How the roadmap counts its size

In its section 1, the roadmap counts 110 packages at their defaults, 390.25 agent-days (the planners' estimates of build time, not calendar time) and 680 hours of owner review (an estimate, which it calls the binding cost), plus 9 packages built only on the owner's yes (59.5 agent-days, 84 hours), or 449.75 agent-days and about 764 review hours with everything. At the plan's 10 review hours a week that is about 68 weeks; the dates in roadmap section 1 are that arithmetic from a start in the week of 2026-12-07, not a schedule anyone has set (Q1).

## Ids used in these files

- Owner questions come in three lists. Q1 to Q32 are the roadmap's (its section 7). "Owner question 1" to "27" and "rows A to H" are Wave 0's ([docs/specs/k0.md](../specs/k0.md) section 6). "Decision 1" to "10" are the decisions #30's description put to the owner under "For the owner" (b), listed in after-wave-0.md section 5. All are unanswered. The advocate's Q-A to Q-H belong to the draft it read.
- PR-001 to PR-104 (with lettered ones such as PR-015a, and PR-H1, PR-H2, PR-O1, PR-O2, PR-C1 to PR-C9) are the roadmap's planned pull requests in review order (its section 4); none is opened. #29 and #30 are GitHub pull requests, Wave 0's.
- Finding ids (F, A, O, L, D, N, M with a number, such as F4, O7, N16) are the audit's, defined in report.md's opening paragraphs.
- Package ids K1-0 to K5-28 (and K5-7b): K, the wave the package was first planned for, and its number. Stage 0 moved K3-1, K3-2, K3-9 and K5-1 into Wave 1 (packages.json `wave`).
- Wave 0's ids: K0-A1 and the like are its tasks, K0-Z-D1 to K0-Z-D17 its decisions, both in docs/specs/k0.md.
- Stage 0 is Wave 1's first eight pull requests (PR-001 to PR-008), tooling before any lesson text moves; "the release" is the one structure release, K1-5 (PR-031) (roadmap section 2, items 1 and 2).
- A lane is a group of packages built side by side (roadmap section 3); Wave 0's lanes are in docs/specs/k0.md section 3.
- Review hours are the owner's estimated review time per pull request (roadmap section 1); "Q2 (i)" is option (i) of Q2.
- R1 to R17 and P1 to P35 in after-wave-0.md are that note's labels for groups of roadmap and package statements; "R10" elsewhere is Rust Zero's R10 exercise.
- Ids such as OD11, P4, S2, "wave-1.md O1" and "wave-3.md D1" belong to the course's own plans (PLAN-100X.md, docs/specs/); wave-1.md's O1 and wave-3.md's D1 are not the audit's O1 and D1.

## What publishing changed

Nothing in the text was reworded, corrected or brought up to date, even where Wave 0 has made it stale; corrections belong in after-wave-0.md. The only changes are the notes under the titles; references to files that are not in the repository (replaced by the repository path of the published copy or by a plain description); and details of where the private reference solutions are kept: paths into them and the place of their only copy, replaced by "the private reference solutions" or a plain phrase (in roadmap.md section 7's Q16 and section 12, advocate.md's K4-1 paragraph, and packages.json's K4-1 and K4-11; a quotation keeps the phrase in square brackets). Line numbers that roadmap.md cites in report.md count from the original, which had no note: in report.md each is two lines lower. Where the original repeats itself (section 4's rows PR-074 to PR-079 print their first sentence twice), the copy does too.

## Not in the repository

- Wave 0's plan and task list. Its record in the repository is docs/specs/k0.md.
- The planners' per-wave package files, and the scripts that built packages.json and wrote the roadmap's tables, ledger and touch matrix.
- The audit's notes (the examiners' track, currency, labs and pedagogy notes) and its scripts.
- The build's reports.

## Not the same waves as docs/specs/wave-1.md to wave-3.md

Those three files are specs written from 2026-10-04 to 2026-10-14 for waves 1 to 3 of PLAN-100X.md's own build plan (its section 8). That is an older, different numbering: their Wave 1 is not the audit's Wave 1.
