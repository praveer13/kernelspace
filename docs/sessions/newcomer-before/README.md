# The first-session kit: five newcomers on t0.l1, r.l1 and t2.l1

This folder holds what the owner needs to run the audit's first step ("Before anything", report.md section 7) before Wave 1's rewrites of the first lessons merge. The method, the prompts and the way the sheets are read are fixed in the unsigned draft [`../../prereg/newcomer-before.md`](../../prereg/newcomer-before.md); nothing here is run, scored or treated as data until the owner signs that file, and at the roadmap's default the build runs no session.

## Files

- [`script.md`](script.md): what the observer says and does, one numbered step per screen or decision, with the prompt to read and what to watch for. Steps 1 to 3 set up the session; 4 to 27 run it (the start, the three lessons and the closing probes); 28 to 30 file the notes.
- [`sheet.md`](sheet.md): the blank sheet for one learner, with a row per step and a column per prediction. The cohort table at the end is filled once the five sheets exist.
- [`fixture-export.json`](fixture-export.json): a synthetic progress export, made from the repository's own export builder. It is not a learner's data: its device name says `newcomer-kit-fixture` and every event is a fixture. It exists so the report's format is known before the first real export.
- [`report-fixture.txt`](report-fixture.txt): exactly what the Wave 1 partner report prints over that fixture. A test fails if the two drift apart.
- [`../../audit-2026-11/master-vs-d478f91.md`](../../audit-2026-11/master-vs-d478f91.md): what master already changed after the audit, so the observer knows which predictions Wave 0 has touched, and the build the live site served when this kit was written.

## Running the fixture

```
bun scripts/partner-report.ts --wave1 docs/sessions/newcomer-before/fixture-export.json
```

The output must equal `report-fixture.txt`. The fixture shows what the ledger part can and cannot say: its Today session gives G7 a median (8.0 minutes), while G1, G2 and G3 stay empty because a think-aloud of three lessons is not the block-placement loop. The per-step minutes are the observer's, on the sheet; the ledger gives session minutes only.

## Running a real session

Read the prereg, then `script.md`. Write on the sheet the build id from `/sw.js` (`BUILD.id`) and the entry asset from the page's HTML before the learner starts. Keep filled sheets and any recording outside the repository. If the learner exports progress, run the report as above with their file; attach its text to their sheet.

## What is not here

No learner's name, contact or employer; no recording; no filled sheet; no score. A committed change to this folder may add counts and quotes the learner allowed, and nothing else.
