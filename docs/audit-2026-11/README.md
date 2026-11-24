# The 2026-11 audit and the roadmap for waves 1 to 5

This folder holds the audit report of the course, the roadmap for the audit's waves 1 to 5, the roadmap's package list, and the two reviews of the roadmap's draft. They were written outside the repository and are published here as written, so that the plan for the waves still to come sits beside the course it describes.

## The files

- [report.md](report.md): the audit report. What is wrong, out of date, out of order or missing in the course at master d478f91, what is best in class and must be kept, and a plan in waves 0 to 5 (its section 7).
- [roadmap.md](roadmap.md): the roadmap for the audit's waves 1 to 5. Packages in waves, the pull requests in review order, the owner questions with the default the build would take if the owner says nothing (section 7), and a ledger of which Wave 0 task or package closes each finding (section 14).
- [packages.json](packages.json): the roadmap's package list, 120 rows, one per package, with the fields the roadmap's "Files:" list describes.
- [advocate.md](advocate.md): a review of the roadmap's draft by a reviewer asked to argue the owner's side (the "owner's advocate"). It is not the owner's own text. The roadmap's section 9 says how each of its findings was applied.
- [critic.md](critic.md): the critic's review of the roadmap's draft. The roadmap's section 15 says how each of its findings was applied.
- [after-wave-0.md](after-wave-0.md): what Wave 0 changed for this plan. It is written separately, after these files.

Each Markdown file has a short note under its title saying where it comes from. packages.json cannot carry one, so this is its note: it is the roadmap's package list as written on 2026-11-21 from the audit of master at d478f91, before Wave 0 was finished; it is a plan, not a record; after-wave-0.md says what has changed since.

## Reading order

1. report.md: section 1 (the verdict) and section 7 (the plan), then the findings as needed.
2. roadmap.md: sections 1 to 3 (size, order, what runs side by side), then section 7 (owner questions).
3. after-wave-0.md, for what Wave 0 has since changed in that plan.
4. advocate.md and critic.md, for why the roadmap is as it is. Both read an earlier draft, so their counts and question names differ from the roadmap's.
5. packages.json, for one package's full brief.

## Dates

- 2026-11-18: the audit finished. It describes master at d478f91 (exported 2026-10-30) and the live site as it was walked then.
- 2026-11-21: the roadmap, the advocate's review and the critic's review were written, before Wave 0 was finished.
- Wave 0 ("what harms a learner today") was then built and merged: pull request #29 on 2026-11-22 and pull request #30 on 2026-11-24 (UTC). Its record is [docs/specs/k0.md](../specs/k0.md).

## Status

Only Wave 0 is built. Waves 1 to 5 are a plan: nothing of them is built, and their scope and order are the owner's open decision. The roadmap's owner questions (its section 7, Q1 to Q32) are unanswered; the defaults it names are what the build would take if the owner says nothing, not choices anyone has made. Nothing in this folder records an approval.

## How the roadmap counts its size

In its section 1, the roadmap counts 110 packages at their defaults, 390.25 agent-days (the planners' estimates of build time, not calendar time) and 680 hours of owner review (an estimate, which it calls the binding cost), plus 9 packages built only on the owner's yes (59.5 agent-days, 84 hours), or 449.75 agent-days and about 764 review hours with everything.

## What publishing changed

Nothing in the text was reworded, corrected or brought up to date, even where Wave 0 has made it stale; corrections belong in after-wave-0.md. The only changes are the notes under the titles, references to files that are not in the repository (replaced by the repository path of the published copy or by a plain description), and, in packages.json, two paths inside the private reference solutions (replaced by "the private reference solutions"). Line numbers that roadmap.md cites in report.md count from the original, which had no note: in report.md each is two lines lower.

## Not in the repository

- Wave 0's plan and task list. Its record in the repository is docs/specs/k0.md.
- The planners' per-wave package files, and the scripts that built packages.json and wrote the roadmap's tables, ledger and touch matrix.
- The audit's notes (the examiners' track, currency, labs and pedagogy notes) and its scripts.
- The build's reports.

## Not the same waves as docs/specs/wave-1.md to wave-3.md

Those three files are specs written from 2026-10-04 to 2026-10-14 for waves 1 to 3 of PLAN-100X.md's own build plan (its section 8). That is an older, different numbering: their Wave 1 is not the audit's Wave 1.
