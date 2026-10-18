# The On-Call pilot: a think-aloud protocol

**Status:** draft for the owner. Task 3s-08 (`docs/specs/wave-3.md` §16.6) writes it; the owner runs the sessions and keeps the notes. Section 8 holds the one reading the owner must confirm before the first session. It is **not confirmed**, nothing in the repository reads this file, and nothing waits on it to run: the shift page works without it.

**Page:** `/daily?shift=3`. Three incidents in a row, from one seed, on the reference engine, with a handoff note between them and a summary after the third.
**Feeds:** the Wave 4 gate "On-Call shift: Daily KCs' 30-day diagnosis ≥ non-Daily, or favourable think-alouds" (PLAN-100X §8, §9), by way of the de-identified summary in section 9 and nothing else.
**Not:** the On-Call shift itself. The shift is gated in Wave 4 (`wave-3.md` D23); this pilot is the cheap test of whether it is worth building.

## 1. What the pilot can and cannot tell you

It can show how people reason through a chain of three incidents: whether they commit to a suspect before probing, whether their probes separate suspects or look where the light is (Streetlight, `world/incident-spec`), where the page confuses them, and whether the handoff note changes what they do in the next incident.

It cannot show that anyone is better at real on-call, or that the Daily helps 30 days later. That is the other half of the gate, and `docs/prereg/fleet-daily.md` measures it from donated ledgers. The incidents are synthetic scenarios (the page says so: one incident minute is 20 engine ticks, the fleet and its SLO are scenario numbers). The three incidents are independent: each is a new fleet whose fault is drawn separately, not one outage that develops. The handoff note is generated from the debrief just shown; nobody writes it. A think-aloud has a handful of participants and reports what they did, not a rate: **this file claims no statistic from it**.

## 2. Who, how many, how long

- **Who.** People the course is for (engineers learning LLM serving) who have not seen the shift. If you can, include some who have played the Fleet Daily and some who have not, because the gate's own contrast is Daily against non-Daily.
- **How many.** At least five if you can, so the summary is not a description of one or two people. Five is a planning figure, not a power calculation. With fewer than five finished sessions the summary says "too few to read" (section 9) and the gate stays closed.
- **How long.** Book 60 minutes. The estimate (not a measurement): 5 for consent and setup, 5 for the warm-up, about 30 for the shift (each incident is about 8 minutes in the Daily, `DAILY_MINUTES`, and talking aloud slows people), 10 for the interview, the rest as slack. Stop at 60 whatever has been reached; a participant who has not finished is recorded as not finished, which is data.
- **Not a test of them.** Say so, and mean it: the page is being tested.

## 3. Consent

Read this aloud, then ask for a yes, and write down only that you asked and the answer was yes (no signature, no name). Without a yes, stop and thank them.

> I am testing a practice page, not you. You will play three practice incidents on a made-up serving fleet. Please say aloud whatever you are thinking while you play. I will write notes about what you say and do. I will not record audio or video or take screenshots. [If you do want to record, ask for a separate yes, say where the file will live, and delete it once the summary is written.]
>
> Your notes are private to me. They will not go in the project's repository, be shown to anyone else or be given to an AI tool. When I am done I will write a short summary that cannot be traced to you, and I will delete the notes within [say the period you choose here]. The summary will hold counts and themes across everyone: no names, no quotes that identify anyone, no dates finer than the month and nothing that points at one person. It may be public.
>
> You can stop at any moment without giving a reason. Until I write the summary, you can ask me to delete your notes and I will. After that your notes will have been reduced to counts and themes with nothing to link them back, so I will not be able to take them out of the summary.
>
> The page saves your three incidents as practice in the browser we are using, and sends nothing about your play anywhere. I will use a private window, which the browser empties when we close it.
>
> Do you agree to take part?

Before you begin, tell them they will be using a made-up fleet, and that you cannot answer questions about the incident itself.

## 4. Setup

1. Open `/daily?shift=3` in a **private window** (or a new browser profile) on the machine the participant will use. The shift is written to the browser's ledger as practice; browsers empty a private window's storage when it closes, so a participant's play does not stay in your ledger or in a shared machine's.
2. **Mind the date.** The shift is a function of the local date: the same date gives everybody the same three incidents, and the next day gives three new ones. For sessions you want to compare, run them on the same local date. Run the shift yourself first, on that date, so you know the three faults (keep that to yourself) and know the page works. Note the month, never the day, in anything you keep for the summary.
3. Check the page shows "On-call shift", "Incident 1 of 3" and the line "Each one is graded practice". If it shows "Fleet Daily" instead, the address lost its `?shift=3`.
4. Sit beside or behind the participant, not in front of the screen, and keep your notes where they cannot see them.

## 5. Script

**Warm-up (5 minutes, not on the page).** Say: "I want you to think aloud. Say whatever goes through your head, even if it seems small or unfinished. Do not explain it to me, just say it. I will stay quiet; if you go quiet I will say 'keep talking'. Let's practise: how many windows are there in the place where you live? Think aloud as you count." Let them count aloud. Correct only the habit (if they explain or fall silent), never the answer. Repeat once with a second small question if they did not manage.

**The task.** Say: "This is a practice on-call shift: three incidents, one after another. For each, an alert fires that the fleet is missing its latency objective. You read it, pick a suspect before you probe, probe to find out whether you were right, apply a fix, and then there is a debrief. Between incidents there is a handoff note: please read it aloud and tell me anything you will do differently. Keep thinking aloud throughout. You can take as long as you like; there is no clock but the one in the incident." Then say nothing about the faults, the probes or the page.

**While they play.**

| You may say | You may not |
|---|---|
| "Keep talking." | Hint, nod or frown at a choice. |
| "What are you thinking now?" (only after about 10 seconds of silence) | Say whether a suspect, a probe or a fix is right. |
| "Take the time you need." | Explain a probe, a reading, the clock, the score or the expert. |
| "I can't answer that; say what you would guess." (to a question about the incident) | Ask "why did you do that?" mid-incident. Save it for the interview. |

If the page breaks (it will not load, or a button does nothing), that is a defect: write it down, restart the incident from "Replay this incident", and mark the incident "restarted: defect" in the notes. Do not count its numbers.

**Interview (10 minutes, after the third debrief).** Ask, in this order, and write what they say:

1. "Walk me through the second incident: what did you suspect first, and what changed your mind, if anything?"
2. "Which probe do you wish you had not taken, and why?"
3. "Did the handoff note change what you did in the next incident? How?" Then: "Was there anything the note did not say that you wanted?"
4. "What looked unrealistic, or took more time than it should have?"
5. "What would a real on-call shift have that this one does not?"
6. "Would you do this again next week? What would make you stop?" (a self-report, not evidence that they learned anything: write it down and do not count it toward the reading in section 8)

Thank them, and tell them again how the notes will be used.

## 6. What you write down

Per participant, on paper or in a file that is **outside the repository** (for example in a folder in your home directory that no tool is pointed at). Use the code P1, P2, ... and keep the list of who is who nowhere, or on paper.

**Per session:** the code; the month; whether they had played the Fleet Daily before (yes, no, unsure); a coarse background (for example backend, ML, SRE, student), only if you will report it; whether they finished all three incidents inside 60 minutes; every time you spoke beyond "keep talking" and what you said (all of those count as help).

**Per incident (1, 2, 3):**

| Field | What to write |
|---|---|
| Hypothesis | what they said before their first probe: a named suspect, "unsure", or nothing |
| Probes | the order they took them, and the reason they gave aloud for each, in a few words |
| Separating or lit | for each probe, whether the stated reason was about telling suspects apart ("separating"), about the easy or familiar place to look ("lit"), or none |
| Revisions | each change of suspect, and the reading that prompted it, in their words |
| Fix | which fix and the reason they gave |
| Confusion | each moment they stopped, misread a chart or table, or asked a question about the page, with the clock time in the session (mm:ss) and what was on screen |
| Page's numbers | copied from the debrief: named (yes/no), recovered (yes/no), burn-minutes against the expert's, Streetlight probes |
| Defects | anything wrong with the page |

**At each handoff:** whether they read the note aloud; what they said they would change; and, after the next incident, your judgement of whether their behaviour changed (a different first probe, fewer Streetlight probes, a suspect committed earlier): "changed", "no change" or "can't tell".

**After the third debrief,** copy the shift summary from the page. It is not saved anywhere, so it is gone when the window closes.

**Never write:** names, contact details, employer or team, anything they say about a third party, a screenshot, or a quotation longer than a phrase. If they say something identifying aloud, leave it out.

## 7. Where the notes live, and who sees them

- The notes are **private to the owner**. They stay out of the repository, out of continuous integration and out of every AI tool's context (do not paste them into a prompt, an issue or a pull request, and do not point an agent at the folder).
- Delete the notes when the summary is written and you are confident you will not need to re-code it, and in any case within the period you promised participants. State the period in the consent you read out; this file does not choose it for you.
- Nothing from a session is read by any code in the repository. The page's practice events (`inc:team/shift-<k>/<date>`, graded practice) live in the browser's ledger and, in a private window, vanish with it. They are not the evidence; your notes are.

## 8. The reading: when the think-alouds count as favourable

**Draft: the owner confirms or changes this before the first session, and does not change it after seeing any session's notes.** The thresholds below are proposals (estimated), not derived from data. Until the owner has confirmed them, the summary reports the codes and no verdict.

Code each finished participant on three yes/no questions, from the table in section 6:

1. **Reasons from evidence.** In incidents 2 and 3 together, at least half of the participant's probes carry a "separating" reason.
2. **Carries the handoff forward.** For at least one handoff, they said they would change something and you judged the next incident "changed". (A participant who read the note and said nothing is "no".)
3. **Not blocked.** They finished all three incidents within 60 minutes, and you did not help beyond "keep talking" more than twice.

The reading, over the participants who finished (at least five):

- **Favourable** if, for each of the three questions, more than half of the participants answer yes.
- **Unfavourable** if two or more of the three questions fail that majority.
- **Mixed** otherwise.

Only "favourable" counts as the gate's "favourable think-alouds". "Mixed" and "unfavourable" leave the gate at its default (no On-Call shift). The interview's question 6 and any praise are not coded: they are not evidence of learning.

Owner confirmation of section 8 (name and ISO date, written by the owner; left blank here): ______

## 9. The de-identified summary

When the sessions are done, write one file, `docs/oncall/summary.md`, by hand. It is the only thing from the pilot that goes in the repository, and the only thing the gate reads. This task does not write it, and no script reads it.

It holds, and may hold nothing else:

- the number of participants who started and who finished; if fewer than five finished, the line "too few to read" and no verdict;
- the month or months of the sessions;
- the three coded questions of section 8 as counts ("4 of 6 yes"), and the reading they give once section 8 is confirmed;
- the page's own numbers, summed or as medians over participants: how many named, how many recovered, burn-minutes against the expert's, Streetlight probes in incident 1 against incident 3;
- the confusions that more than one participant hit, in your words, and the defects found, each as a sentence about the page;
- any background or "played the Fleet Daily before" split, **only** if every group in it has at least two participants (a group of one is one person);
- what the pilot cannot show (section 1), copied in.

It does not hold names or codes with rows of per-person detail, quotations, session dates finer than the month, or anything from the notes that points at one person. Read it once as a participant would, and ask whether any of them could be picked out.

## 10. After the sessions

The summary joins the Fleet Daily report (`docs/prereg/fleet-daily.md`, section 4: "the decision is a qualitative judgement from think-alouds") as the other half of the Wave 4 gate. The gate has two branches. If the Fleet Daily's comparison is powered and its section 4 rule keeps the Daily, that is the first branch and the think-alouds are not needed; if it is underpowered, this summary is the judgement. Either way the On-Call shift is a Wave 4 task, and this pilot builds nothing toward it but the page you just used.
