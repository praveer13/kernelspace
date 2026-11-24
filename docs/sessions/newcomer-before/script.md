# Task script: five newcomers on t0.l1, r.l1 and t2.l1

Read `../../prereg/newcomer-before.md` first: it fixes the session, the prompts and how the sheets are read. This file is what the observer says and does. Fill `sheet.md` as you go, in minutes from the session's start.

## Before the learner arrives

1. Open a private window with no saved progress, at the site's address on the day. On the sheet write the site's build id and its entry asset (`/sw.js` holds `BUILD.id`; the page's HTML names the `assets/index-*.js`), and the date and time.
2. Say: "I am not testing you. I am testing the course. Think aloud: say what you are looking at, what you expect, and what confuses you. I will not answer questions about the material; I will ask the script's questions, and otherwise only what you are looking at or what you would do next."
3. Ask for consent to take notes and, optionally, to record the screen. Notes stay outside the repository, and nothing that identifies the learner goes into it.

## Start (5 minutes)

4. Ask the learner to open the site and start the course the way they would on their own. Do not choose a track for them. Note the minutes to the first decision, what they pick, and what they say the choice means. This is where L8 and Boot are first seen.
5. Ask: "How long do you think this course takes?" Write the answer before they find any page that states one.

## Lesson 1: t0.l1, "Why Systems Thinking Matters for LLM Serving" (15 minutes)

Steps 6 to 11 are one pass through the lesson. If the learner stalls for five minutes, read the step's prompt, note "stalled", and move to the next step.

6. **The predict block, the page's first thing to do.** Before they answer its first item, ask: "What does 'KV cache' mean to you?" Write the answer word for word. Then let them answer both items. L4 predicts the learner reads it as a cache they already know (Redis, a dictionary), and that the reveal's use of "paging" and "block" is not yet defined. Note whether the words are defined on the screen before the question or only later.
7. **The opening prose that follows ("You already know how to serve traffic").** Ask: "Read this and tell me what you think the lesson is asking you to learn." Watch whether the three questions ("Why does adding one more request...?", "Why does the vLLM paper spend three pages...?", "Why did NVIDIA write Dynamo's data plane in Rust...?") read as the lesson's agenda or as decoration.
8. **"The same fifty-year-old ideas".** Ask: "Where would you go to check what a 'block table' is?" Write where they look, and whether they find it without help. This is L5's first probe.
9. **The through-line panel.** Ask: "Does the OS-to-LLM comparison help you or slow you down? Point at the part that does." Watch whether the "breaks" line under each pair is read at all.
10. **"Why decode is bandwidth-bound".** This is the bandwidth section's first number. Ask: "Where did 3.35 TB/s and 5 ms come from?" A learner who says "it says so" is the expected answer today; note it.
11. **The quiz.** Before the last question, ask: "Has the lesson answered its opening question yet — why one more request sometimes doubles throughput and sometimes OOMs? If so, where?" Write the answer. Today the lesson's own feedback says "That is the opening question of this lesson, answered"; L4 predicts the learner does not know that before the quiz.
12. **After the quiz.** Ask: "What would you do next?" Then show nothing and note what the page itself offers. Compare with the order the learner expected and with the Curriculum's next card. This is L8.

## Lesson 2: r.l1, "Bindings, Types & Expressions" (10 minutes)

13. **The first two prose blocks.** At the first, ask: "What does 'a binding is immutable' mean you cannot do?" Before they read the second block ("Bindings are immutable; shadowing is a new binding"), ask: "What do you think `let x = x + 1` does when `x` already exists?" This is a prediction, not a test; the second block answers it. Watch for the Java `final` reading and the Python rebinding reading.
14. **The first code sample.** Ask: "Why `usize` and not `i32`?" and "What is the value of `capacity`?" Note whether the chips under the code are noticed and used.
15. **The analogy callout ("From Java or Python").** Ask: "Is a Rust `let` closer to a Java `final` local or to a Python name? In your words." This is the lesson's own claim; note whether it lands.
16. **The quiz.** Three questions; note the minutes and any question they reread.
17. **Navigation.** Ask them to go to the next lesson using the page, not the browser's back button. Write whether the page names what comes next and whether it matches what they expected from t0.l1's track list.

## Lesson 3: t2.l1, "Processes, Threads & Context Switches" (12 minutes)

18. **The opening.** Ask: "In your serving work, what is a process to you?" Write it before the lesson defines it. Note whether the lesson starts by telling or by asking: today it has no question before the telling, and its first thing to do comes after the telling.
19. **The statline and the diagram.** Ask: "Do you trust these numbers? Where would you check one?" Then ask what the diagram shows before they read its caption. This step is not one of the four predictions.
20. **The through-line panel ("the scheduler you will meet again").** Ask: "Which line marks where this analogy breaks?" The panel's break item keys the state each side saves: a thread switch saves a few registers, while preempting a sequence moves or regenerates megabytes to gigabytes of its KV cache. The second pair's mapping line is the corrected one: a decode step is a scheduling boundary, not a timeslice. Write whether the learner can say why. This panel is not one of the four predictions.
21. **"Context-switch burn".** Ask: "What is this asking you to do?" Note whether the task's target is clear before any input.
22. **The quiz.** Note the minutes and which words they look up.
23. **The vocabulary probe (all three lessons).** Ask the learner to find the definition of **TTFT**. Then **block table**. Then **prefill**. For each: the minutes, where they look (lesson text, a link, the glossary, ⌘K), and whether they reach a definition. Today, TTFT has no glossary pair but appears in one lesson hook (t5.l3), a knowledge-component title and some claims; "Block table" is a glossary pair's LLM side; "prefill" appears inside the "Chunked prefill (SARATHI)" pair; and ⌘K indexes titles, hooks, headings and claims, not lesson prose. Record what the learner reaches for each. L5 predicts that the place a learner looks for a word gives them no definition: no lesson word links to one, and the glossary's pairs are OS-to-LLM comparisons rather than a term index.

## Closing probes (8 minutes)

24. **The order.** Ask: "Which lesson comes after t2.l1? How do you know?" Then open the Curriculum (Path) page and Up Next and compare the learner's answer with both. L8 predicts they disagree.
25. **The hours.** Ask again: "How long does the course take?" Compare with the first answer and with the figures the learner can now find. The audit found four answers.
26. **The holes (only for a learner who chose serving-first at step 4).** Open t5.l7 and ask them to read the paragraph that ends "You learned this machine in T2 — here it is running the world's inference." Then scroll to its Rust reading block, "Read it in Rust: admission". Ask: "What was that machine, and where would you learn it on your path? What does this block assume you know?" O11 predicts the path has not taught it and the sentences do not say so. Note whether Boot's path blurb warned them.
27. **The exit.** Ask: "If you came back tomorrow, what would you open first?" Write it verbatim.

## After the learner leaves

28. Fill the counts in `sheet.md` (section 3 of the prereg). Do not add an interpretation: the counts and the quotes are the record.
29. If the learner agreed to export progress, run `bun scripts/partner-report.ts --wave1 <export>`. Attach its text to the sheet, outside the repository. The fixture in this folder shows the format.
30. File the notes where the owner keeps session material. Nothing from a session is committed to this repository except counts and quotes the learner allowed.
