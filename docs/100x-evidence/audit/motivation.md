# kernelspace: motivation, onboarding, navigation, tutoring, community and UX audit

Audited 2026-10-03 against `master` @ 4b578c8 (last commit 2026-08-12). Read-only: no repo file was modified. Every claim below cites file:line or a statistic measured from source with grep or node scripts (scripts kept in the scratchpad).

---

## 0. Verdict

kernelspace has an unusually strong **content and simulation core**: 20 simulators that auto-detect task completion (100 `completeSimTask/recordSimTask` call sites in `src/components/sims`), Forge labs with identical `cargo test` and in-browser checks, and a Fleet and Fleet Week that grade results by actually running them. The **motivation layer around that core is thin, and in places it works against the core**:

1. **The XP economy rewards clicking more than building.** One keypress (`m`, `src/pages/Lesson.tsx:616`) marks a lesson complete for +100 XP with no reading check. ROOT (5,000 XP) is reachable from 50 keypresses. Forge labs, the course's central claim, earn 16% of all available XP.
2. **Assessment can be gamed.** 230/266 single-answer quiz items (86.5%) are correct at index 1 ("B"), none at index 3, and the correct option is the longest in 252/266 (94.7%). Retry shows the correct answers and keeps option order, so the 80% exam gate on the only exam lesson can always be passed on a second try. In the placement check, 7 of 8 answers are "B", so always picking B places a newcomer in T7.
3. **There is no "what next" model beyond "the first undone lesson in global order".** Placement results are never stored. Labs, Fleet and Fleet Week are never recommended. Most lessons that own a Forge lab (6 of 8) never link to it.
4. **Relatedness is zero.** There is no community surface. The leaderboard has 0 entries but sits in the top nav as "Scores".
5. **No return loop exists beyond a streak counter.** The streak uses UTC days, has no freeze, and is never surfaced with intent. There is no review, no spaced retrieval, and no reason to come back tomorrow.

None of these conflicts with the hard constraints (zero servers, local-first, no telemetry, no accounts). All of them are fixable client-side.

---

## 1. Measured baseline

| Metric | Value | Source |
|---|---|---|
| Lessons / total authored minutes | 68 / 1,818 min (30.3 h) | `minutes:` across `src/data/lessons/**` |
| Block mix | 255 prose · 96 callout · 69 quiz · 36 code · 33 statline · 28 exercise · 27 diagram · 20 deepdive · 19 isomorphism · 11 field-note | grep `type: '…'` |
| Lessons with an in-lesson exercise (sim) block | 28/68 (41%) | grep |
| Lessons with an isomorphism panel (the "signature pedagogy") | 19/68 (28%) | grep |
| R + T6 + T7 lessons (25) with an in-browser exercise | **0** (T6/T7: all 15 are `read+quiz`; R: all 10 `code` → local Forge) | grep `exercise:` |
| Quiz questions | 266, all single-answer; `multi: true` count = 0 | grep |
| Correct-answer index distribution | [0]:10 · [1]:230 · [2]:26 · [3]:0 | `grep -rhoE "correct: ?\[[0-9, ]*\]"` |
| Correct option is the longest | 252/266 = 94.7% | scratchpad `quizlen.mjs` |
| Exam lessons (quiz-gated) | 1 (`t2/exam-pagedattention.ts:12`) | grep |
| Sim checklist tasks | 114 in 27 exercise blocks | node count |
| Forge labs | 18 (8 systems + 10 R drills), flat 200 XP each | `src/data/labs.ts`, `progress.ts:335` |
| Public leaderboard entries | 0 | `public/leaderboard.json` |
| Field Notes | 2026-Q3, 8 entries, generated 2026-08-11 (next quarterly due) | `public/field-notes.json` |
| localStorage keys | `kernelspace:v1`, `kernelspace:capstone:flags`, `kernelspace:leaderboard-personal:v1`, plus capstone draft keys | grep |

---

## 2. Self-determination theory lens

### Autonomy: strong on paper, undercut in practice
- **Good:** "Every layer is unlocked — the order is the point" (`Curriculum.tsx:390`). There are three skip-ahead persona cards (`Curriculum.tsx:508-528`), a placement check, a ⌘K palette, and a local-first promise with no account.
- **Undercut 1, placement is not respected.** `recommendFor(score)` (`Curriculum.tsx:112-114`) maps a raw score of 0–8 to T0…T7 linearly. It never recommends R, ignores *which* items were missed, and the result is never persisted. Afterwards, Home's Resume (`Home.tsx:77`), Curriculum's "current" marker (`Curriculum.tsx:357-360`) and Progress's UpNext (`Progress.tsx:1054`) all use "first non-done id in `ORDERED_LESSON_IDS`". A learner placed into T5 who finishes T5.L1 is told to **"Resume: R · Lesson 1"**.
- **Undercut 2, wrong link.** The "Total beginner" card is labelled `T0 · L1 — Why systems` but links to `ORDERED_LESSON_IDS[0]`, which is `r.l1` (`Curriculum.tsx:512-513`).
- **Undercut 3, home-language preference cannot be set.** `settings.codeLang` drives which code tab is shown by default (`src/pages/lesson/blocks.tsx:692-701`), but `updateSettings` is never called anywhere in `src/**/*.tsx`. A Java engineer can never make Java the default comparison language. Same for `settings.reducedMotion`: stored, never written, never read.
- **Missing:** goal setting (target date or weekly hours), choosing a path ("I'm here for vLLM internals" vs "full ramp"), choosing a project, and opting out of gamification.

### Competence: great feedback inside sims and labs, weak everywhere else
- **Good:** sim tasks are auto-detected rather than self-attested (`PlaygroundShell.tsx:99-110`). Forge checks are deterministic, and traps show as "not implemented yet". Fleet Week grades executed outcomes (`FleetWeek.tsx:44-50`). Every quiz item has an explanation (266/266).
- **Broken signal:** because of the answer-position and length bias, quizzes cannot tell competence from test-wiseness. The quiz is the only competence signal in 25 lessons (R in-site, T6, T7).
- **No mastery model:** `quizScore` is stored as `Math.max(prev, score)` (`progress.ts:257`). It never decays and is never resurfaced. "Review" exists only after all 68 lessons are done (`Progress.tsx:1056-1067`).
- **Competence progression is invisible.** There is no skills map or "you can now…" state. Track outcomes are listed (`Track.tsx:185-206`) but never checked off against evidence.

### Relatedness: absent
- Grep finds no Discord, forum, Discussions, study-group, "edit this page" or "report an issue" affordance in `src/**/*.tsx`. The only social surface is the PR-based leaderboard, with 0 entries, shown in top nav as "Scores" (`Navbar.tsx:15`). An empty board is negative social proof.
- The persona voice ("privilege escalations", "RING 0") is charming but solitary. There are no cohorts, no "N people finished this", no mentor or peer review of the Fleet Week design doc, and the agent-tutor deep links are fire-and-forget.

---

## 3. Habit and return loops

- **Streak mechanics** (`progress.ts:131,148-152,455-470`): any store write touches the streak, including opening a lesson (`Lesson.tsx:497` → `markLessonStatus('reading')`) or merely visiting a sim (`recordSimVisit`, `progress.ts:294-301`). So a streak can be kept by page views alone. Days are computed with `toISOString()`, i.e. **UTC**. A learner in UTC−7 studying at 6 pm local is credited to the next day, and a learner studying at 11 pm and then 8 am the next morning can register as two days or one depending on timezone. There is no freeze, no repair, and no at-risk cue.
- **Where the streak is shown:** "UPTIME Nd" in the StatusBar, which is `hidden … lg:block` (`StatusBar.tsx:109`), so it is invisible on phones and tablets. Also "N day uptime" on the Curriculum header (`Curriculum.tsx:447`), the Progress KPI band, and the `week-uptime` achievement (`Progress.tsx:222-229`). Nothing on Home or the lesson page.
- **No reason to return tomorrow.** There is no daily item, no review queue, no new content cadence besides a quarterly feed that is now overdue (Q3 generated 2026-08-11; Q4 should land ~Oct), no notification (correctly, no push server, but a local `.ics` export or a Web Push-free "study plan" is also absent), and no "you left off mid-Forge-lab" resume. The `scrollPct` resume only covers lessons (`Lesson.tsx:503-515`).
- **Fake telemetry:** the StatusBar shows a random "TTFT 0.31s / HBM 71°C" readout re-rolled on every route (`StatusBar.tsx:11-22,96-102`). It is playful, but it sits awkwardly with the "every number sourced" constraint. It is a natural slot for the learner's *real* last Fleet goodput or lab result.

---

## 4. "What should I do next?": guidance and dead ends

| Surface | Next-step logic | Problem |
|---|---|---|
| Home hero (`Home.tsx:77,177-185`) | first undone lesson globally | ignores placement, labs, Fleet Week |
| Lesson footer (`Lesson.tsx:~720-760`) | `nextLesson()` in global order; last lesson → `/capstone` | never offers the lesson's Forge lab or Fleet; T7.L5 sends to the JS "Capstone Zero", not Fleet Week |
| Track complete modal (`Lesson.tsx:370-412`) | "View curriculum" / "Keep reading" | no next-track CTA, no lab CTA, no share; **R completion shows a broken image**: `/badge-r.svg` does not exist (`ls public/badge-*.svg` lists t0–t7 and capstone only) |
| Track page (`Track.tsx:285-331`) | prev/next track; T7 → capstone | no Forge labs listed for the track |
| Progress UpNext (`Progress.tsx:1051-1118`) | raw id (`t5.l4`), hard-coded `~12min` (`:1104`) though `lesson.minutes` exists | label is not human-readable; no lab suggestions |
| Forge lab page | `lab.readiness` → lessons (`ForgeLab.tsx:116-117,185`), `completion.next` text (`:553`) | mostly one-way: **6 of 8 lab-owning non-R lessons (t1.l3, t5.l5, t5.l2, t2.l5, t3.l4, t5.l7) contain zero "forge/cargo" mentions**; only `t5.l6` (1 hit) and `t6.l8` (2 hits) point to their lab |

**Dead ends and hidden doors:**
- `/week` (Fleet Week, the 1,000-XP capstone) is linked only from `Capstone.tsx:1496`, the command palette and `llms.txt`. It is not in the navbar (`Navbar.tsx:10-19`) or the footer (`Footer.tsx:4-10`).
- `/fleet` is mentioned in only one lesson (`t7/objective-function.ts:102`), as plain text: "Open /fleet."
- **Home never mentions Forge, Fleet, Fleet Week, the leaderboard, or that a local Rust toolchain is needed.** Grep of `Home.tsx` for `forge|fleet|cargo|rustup|week` matches only the FAQ word "week". The "Build" step of the method says "Assemble it all into a working toy inference engine" (the JS capstone).
- **The command palette does not index lessons** (`CommandPalette.tsx:11-49`: groups are Pages, Tracks, Simulators). Typing "PagedAttention" or "KV cache" returns no lesson. There are 68 lessons and a 24-pair glossary, yet search covers neither.
- Footer "Method" and "FAQ" are `#method`/`#faq` anchors (`Footer.tsx:14-15`), which work only on `/`.

---

## 5. The first 10 minutes of a brand-new visitor

1. **0:00** Home hero: excellent copy and an interactive MemoryGrid. On desktop only, a decorative particle field loads (`Home.tsx:83-94`, the one use of three.js). The primary CTA "Start at Rust Zero" goes to `/tracks/r` (`Home.tsx:182`). The "Explore the lab" secondary CTA competes with it.
2. **0:30** Track R page: an outcomes list, then "Start track". No time estimate for setup, and no "you will need rustup by L1" warning.
3. **1:00** R.L1 prose is good. Then it links the **R1 Forge drill** (`r/bindings-and-expressions.ts:79`), which needs `rustup` + the `wasm32-unknown-unknown` target + a download/unzip/`cargo test`/`cargo build --release --target …`/drag-drop loop (`labs/README.md` "The loop", 5 steps). There is **no in-browser Rust fallback**: grep for `play.rust-lang|godbolt` in `src` finds nothing. For a Java developer on a locked-down corporate laptop, this is the most likely drop-off point in the whole course.
4. **~5:00** If they don't install anything: scroll to 90%, click "Mark complete +100 XP", go to the next lesson. The toast says "+100 XP — lesson complete · R progress 10% · rank RING 3". Nothing has checked understanding yet.
5. The placement check is never offered on Home. It lives on `/curriculum` ("Not sure where to start?" at the bottom of the page) and as a chip on non-R track pages (`Track.tsx:170-177`).

Net: the first ten minutes show off the visuals well but lead to toolchain friction. There is no early "aha you did yourself" moment like the T0 latency walk or the KV-cache calculator. R lessons have **no** in-browser sim. (The ownership stepper `RustLab.tsx` exists, but it is mounted inside AllocatorSim for T1, `RustLab.tsx:4`, not in R.)

---

## 6. The XP economy: what it actually rewards

`XP` constants: `progress.ts:97-104`. Maximum attainable, computed from content counts:

| Behavior | Unit XP | Count | Max XP | Share | Verification |
|---|---|---|---|---|---|
| Mark lesson complete | 100 | 68 | 6,800 | 31% | **none** (scroll not required; `m` key, `Lesson.tsx:616`) except 1 exam |
| Quiz first ≥80% | 40 | 68 | 2,720 | 12% | gameable (B/longest; retry reveals answers) |
| Sim task (auto-detected) | 60 | 114 | 6,840 | 31% | real, effortful |
| Capstone step (JS) | 150 | 7 | 1,050 | 5% | in-browser harness |
| Forge lab (all checks) | 200 | 18 | 3,600 | 16% | real, *most* effortful; but R1 drill = MPMC lab = 200 |
| Fleet Week act | 250 | 4 | 1,000 | 5% | executed |
| **Total** | | | **~22,010** | | |

- **Ranks top out at 5,000 XP** (`progress.ts:114-120`), which is 23% of attainable XP. After that, 77% of the course gives no rank progress. The StatusBar "CPU %" also caps at 5,000 (`StatusBar.tsx:74`).
- **ROOT by pure clicking:** 50 lessons × 100 = 5,000. A lazy path of lessons plus B-guessing on quizzes yields 9,520 XP, which is 3.4× what all 8 systems labs pay.
- **Dead code:** `markExerciseDone` (`progress.ts:275-292`) is never called, and `LessonProgress.exerciseDone` is never set.
- **False promise:** "the exam lesson requires ≥80% … — double XP" (`Track.tsx:233`), but `complete()` always grants `XP.lesson` (`Lesson.tsx:559-561`).
- **Flat pricing ignores difficulty.** A 6-function syntax drill and the Vyukov MPMC queue with a race fuzzer both pay 200 XP.

---

## 7. Ranks and achievements

- 5 ranks (RING 3 → ROOT) with good flavor text (`Progress.tsx:60-66`). The thresholds 0/500/1,500/3,000/5,000 were tuned when the course had 40 lessons and no labs.
- 23 achievements (`Progress.tsx:122-231`): 7 "warm-up" ones, 9 track completions, `forge-first`, `fleet-week`, `engine-builder`, `no-hints`, `optimizer`, `week-uptime`. **Almost all are completion counters.** None rewards a mastery behavior such as "fixed a borrow error without hints", "beat the reference scheduler by 5 points", "diagnosed an incident in under 5 minutes", "re-passed a quiz after 30 days", or "first PR to vLLM".
- Two achievements read `kernelspace:capstone:flags` (`Progress.tsx:86-96`), a key that is **not exported** by `exportProgress` (`progress.ts:483-493`). Importing on a new device loses `no-hints`/`optimizer` unless they were already latched into `achievements[]`.

---

## 8. Tutor affordances

- **What exists:** `AgentActions` (copy md / ask claude / ask chatgpt) in each lesson header (`Lesson.tsx:~716`). It fetches `/lessons-md/<id>.md` and prefills `md.slice(0, 1800)` (`AgentActions.tsx:28-34`). There is also `llms.txt` with a Socratic preamble, and `labs/AGENTS.md` with four strong "never write the solution" rules (`labs/CLAUDE.md` = `@AGENTS.md`).
- **Truncation:** lesson md averages ~7.6 KB (526,631 B / 69 files; min 2.8 KB). The 1,800-char prefill gives the agent ~24% of an average lesson, usually just the title and intro. The agent gets **no learner state**: no quiz misses, no sim config, no lab check failures, no Fleet telemetry. NEXT.md §4 ("sees the student's current sim state") is unshipped.
- **Answer exposure:** the lesson md prints quiz answers inline ("Answer: B — …", e.g. `public/lessons-md/t5.l4.md` tail). This is fine for tutoring, but it confirms that quiz items carry no retrieval value once the md is copied.
- **AGENTS.md says "six checks"** (`labs/AGENTS.md:9,14`) for every lab. That is generic, and the R drills vary.
- **No in-context "ask about this"** on sims, quiz misses, Forge failures, or Fleet Week incidents, where help is most valuable.

---

## 9. Data ownership

- **Good:** the JSON export/import has a diff preview and a two-step reset confirmation that requires typing RESET (`Progress.tsx:775-1030`). Version migrations exist (`progress.ts:225-230`), and the footer promise is honest (`Footer.tsx:42`).
- **Gaps:** the export omits capstone code drafts (`Capstone.tsx:1093,1107`), capstone flags, and the leaderboard personal best (`Leaderboard.tsx:28,128`). There is no automatic backup nudge such as "you haven't exported in 30 days, and Safari ITP may evict localStorage after 7 days without interaction". There is no `navigator.storage.persist()` request: grep finds none.

---

## 10. Mobile and accessibility

- **Navigation:** desktop nav appears only at `xl` (≥1280px, `Navbar.tsx:90`). Laptops at 1024–1279 get the hamburger. The mobile menu index label renders `0x010` for item 10 (`Navbar.tsx:185`, cosmetic).
- **StatusBar** is `lg` only, so streak and XP are invisible on mobile. The heatmap is forced to `min-w-[640px]` (`Progress.tsx:625`) and the leaderboard table to `min-w-[720px]` (`Leaderboard.tsx:400`).
- **Touch:** only 1 of 31 sim files handles pointer or touch events. Forge is inherently desktop. There is no "send this lab to my laptop" handoff (e.g. a QR code or email-to-self link).
- **Reduced motion:** the global CSS kill-switch exists (`index.css:75-83`), but framer-motion JS animations are not covered by CSS. Only 9 files call `useReducedMotion`, and there is no `<MotionConfig reducedMotion="user">` (grep: none). The in-app `settings.reducedMotion` toggle is dead.
- **Good:** "skip to content" link (`Layout.tsx:31`), 12 `aria-live`/`role=status|alert` regions, 80 `aria-label`s in sims, keyboard shortcuts in lessons (`?` modal), and a quiz section labelled "Checkpoint quiz".
- **Weak:** diagrams and sims have little non-visual equivalent (6 keyboard handlers across all sims). Quiz verdicts are conveyed by color and shake.

---

## 11. Proposed-but-unshipped items (verified in code, 2026-10-03)

| # | Item | Source doc | Status | Evidence |
|---|---|---|---|---|
| 1 | BYOK embedded tutor (browser→API, sees sim state) | NEXT.md §4 | **Unshipped** | grep `apiKey|dangerous-direct-browser|dangerouslyAllowBrowser` → 0 |
| 2 | Local WebLLM tutor fallback | NEXT.md §4 | **Unshipped** | grep `webllm|web-llm` → 0 (transformers.js is used only for the real-engine) |
| 3 | Classroom mode via files (teacher viewer of exports) | NEXT.md §5 | **Unshipped** | grep `classroom|cohort` → 0; `teacher` only in lab prose (`labs.ts:512,554`) |
| 4 | Spaced-repetition arithmetic drills / glossary deck | PLAN.md §3.6 | **Unshipped** | grep `flashcard|leitner|dueAt|spaced` → only "namespaced"/"spacedTokens" |
| 5 | Kernel speedruns (WGSL, % of roofline) | PLAN.md §3.6 | **Unshipped** | grep `speedrun` → 0 |
| 6 | Scheduler speedruns / personal-best arena | PLAN.md §3.6 | **Partial** | lab-06 personal best on `/leaderboard` only |
| 7 | Contribution runway (curated good-first-issues) | PLAN.md Phase 4 | **Unshipped (deferred)** | grep `good-first` → 0 |
| 8 | Compile/grade server (forge API, verified badge) | PLAN.md App. B, §3.1 | **Unshipped (rejected by constraint)** | no `/compile` endpoint; `labs.ts`/`index.ts` hits are prose |
| 9 | In-browser Rust editor (`rust-lab` with editor) | PLAN.md §3.1, PLAN-WC §2.3 v2 | **Unshipped** | Forge is drag-drop only (`ForgeLab.tsx:434,459`) |
| 10 | Zig module / Rust-vs-Zig allocator duel / Zig labs | PLAN.md §3.5 | **Rejected** (replaced by t3.l7) | `ls labs` has no zig; PLAN.md "No Zig code lab" |
| 11 | C-ABI interop lab (Rust + Zig + C) | PLAN.md §3.5 | **Unshipped** | no lab crate |
| 12 | Thread-per-core / io_uring Rust depth lesson | PLAN.md §3.5 | **Partial** (mentions in t2.l6, t3.*) | no dedicated lesson |
| 13 | CUDA-C reading pane | PLAN.md §3.1 | **Unshipped** | grep → 0 |
| 14 | candle/cudarc real-GPU companion path | PLAN.md §3.1 | **Unshipped** | grep `candle` → 0 |
| 15 | Portfolio / hire-me page (evidence pack) | PLAN.md §1, Phase 4 | **Partial** | capstone PNG certificate (`Capstone.tsx:1616-1692`); Fleet Week docText; no aggregated portfolio page |
| 16 | Fleet grows with the curriculum; sims re-skinned as Fleet viewports | PLAN.md §3.2 | **Unshipped** | sims remain separate `/lab/:id` pages |
| 17 | Azure LLM traces (2023/2024), TraceLab agentic, ServeGen | NEXT.md §2 | **Unshipped** | `public/traces/` = burstgpt, kimi, lmsys-shape only |
| 18 | Real engine: batched multi-slot / student block manager on the real model | NEXT.md §1 | **Partial** | `real-engine.ts:5` "one GPU = one generation slot" |
| 19 | Lab 01 attempts-to-green instrumentation | PLAN-WC §2.4 | **Unshipped** | grep `attempts` → 0; `LabProgress` has no attempt count |
| 20 | Optional lab-02 multi-LoRA extension check | PLAN-WC §5b | **Unshipped** | no LoRA check in `labs/kv-block-manager` |
| 21 | Verified-grading badge | PLAN.md App. B | **Unshipped** | — |
| 22 | Speedrun personal bests as portfolio front page | PLAN.md §3.6 | **Unshipped** | — |
| 23 | Q4 Field Notes refresh | PLAN-WC §6c cadence | **Due** | feed `quarter: 2026-Q3` |

Items verified shipped (so they should not be re-proposed): Track R + 10 drills; radix-cache, xgrammar-lite; prefix-caching lesson; trace replay (Kimi/BurstGPT/LMSYS-shape); CI leaderboard; Field Notes + `verifiedAt`; real-engine (single slot); readiness chips; palette entries for Forge/Fleet/Week; the Wave-0 defects (glossary `t2.l8`, `t3.l4` lab link, t6/t7 badges, footer GitHub link, sim-task XP).

---

## 12. The end-to-end learner journey

**Home → (placement?) → R (10 lessons, local Rust drills) → T0 → T1 (+lab 01) → T2 (+lab 04, exam) → T3 (+lab 05) → T4 (WGSL, roofline) → T5 (+labs 02/03/06/07) → T6 (+lab 08, read+quiz only) → T7 (read+quiz) → Capstone Zero (JS) → Fleet (upload wasm) → Fleet Week (4 acts) → Leaderboard PR.**

### Top 10 friction points (ranked by expected drop-off impact)
1. **Toolchain wall at R.L1:** rustup + wasm target + a 5-step loop, with no browser fallback (§5).
2. **Lessons rarely hand off to their Forge lab:** 6/8 lab-owning non-R lessons never mention it, including T1.L3, "the highest-ROI exercise in the course" (§4). Labs are discoverable only via the navbar.
3. **Placement is ignored afterwards,** and Resume sends advanced learners back to R.L1 (§2).
4. **Gameable quizzes,** with an 86.5% "B" rate and 94.7% longest-is-correct. Retry reveals the answers, so mastery cannot be trusted (§1, §6).
5. **T6/T7, the newest material (15 lessons), has no in-lesson interaction.** The Fleet and Fleet Week, which teach exactly this content, are not linked from those lessons.
6. **Fleet Week is hidden** (not in nav or footer; only reachable via Capstone) (§4).
7. **XP/rank saturate at 23% of the course,** so there is no progression signal for the hardest 77% (§6).
8. **No search over lessons or concepts** in ⌘K (§4).
9. **The tutor is blind and truncated:** 1,800 chars, no learner state, not available on sims or labs (§8).
10. **Broken celebration at the first milestone:** the R completion badge 404s (`/badge-r.svg`), the track modal has no next CTA, and Progress UpNext shows the raw id with a fake "~12min".

### Top 10 delight moments (keep and amplify)
1. Hero MemoryGrid plus the latency marquee: instant tactile "the machine is real" (`Home.tsx:208,223-265`).
2. The OS ≡ LLM isomorphism panels and the 24-pair glossary flip cards: the course's intellectual signature.
3. Sims that auto-detect your task completion (20 sims, 100 call sites) and give XP for doing, not claiming.
4. The toy-engine sim KV-cache ratio moment (`ToyEngineSim.tsx:1351`, `ratio >= 5` → task).
5. Forge "a `todo!()` traps → 'not implemented yet'" plus identical `cargo test`/browser checks: trustworthy feedback.
6. Fleet conformance: your wasm block manager runs in lockstep with the reference, and the divergence banner catches off-by-ones at tick 2 (PLAN.md Phase 2).
7. The real-engine mode: your lab-06 scheduler preempting a real Qwen3 generation in a browser tab (`real-engine.ts:1-14`).
8. Fleet Week Act III: the business case is *executed*, not claimed, and Act IV's incident telemetry diagnosis.
9. Privilege-escalation theming (RING 3 → ROOT, "Segmentation fault (core dumped)" 404 `Lesson.tsx:~420`, "nothing allocated yet").
10. Field-note cards and the "last verified" badge, which make freshness visible (`Lesson.tsx:~697-705`).

---

## 13. Upgrade opportunities (concrete, constraint-compatible)

**A. Fix the trust layer first (days)**
1. Quiz rebalance and lint: shuffle option order per attempt (seeded), add a CI check that fails if any correct-index bucket is >35% or longest-is-correct is >40%, and author 1–2 plausible long distractors per item. Retry must re-shuffle and hide the previous verdicts. Fix the placement items the same way.
2. Make "Mark complete" require evidence: quiz attempted, or ≥N% dwell with scroll. Remove the `m` hotkey's XP path, and drop lesson-read XP to ~20.
3. Add `/badge-r.svg`. Fix `Curriculum.tsx:512` and `Track.tsx:233`, the UpNext title and minutes, and the Footer anchors.

**B. A real "next best action" engine (local)**
4. Persist placement as `placement: {score, missedTracks[], entryTrack, at}`. Resume = first undone lesson **at or after the entry track**, plus remediation chips for missed-track items.
5. A unified **Up Next queue** mixing lessons, the lesson's Forge lab (from `labs.ts` `lessonId`), a due review, and Fleet/Fleet Week milestones. Render it on Home, at the lesson footer, and in the track-complete modal.
6. Add a "Build this" card at the end of each lab-owning lesson, auto-generated from `labs.ts`, and a "Run this in the Fleet" card for T5–T7.

**C. Retrieval practice and spacing (the biggest learning-science gap)**
7. A local spaced-repetition deck (FSRS, client-side): seed it from the 266 quiz items, 24 glossary pairs, and the PLAN.md §3.6 "numbers that must be reflexive". Add a daily 5-minute "warm cache" session, which becomes the streak action instead of page visits.
8. Generative items: numeric-entry questions (KV bytes/token, ridge points) with tolerance, ordering and Parsons problems for Rust snippets, and predict-then-run prompts before every sim.
9. Interleaved "mixed review" checkpoints at track boundaries, which become the exam lessons (currently only T2).

**D. Rebuild the XP economy around effort and mastery**
10. Reweight: lab 300–800 by difficulty, sim task 60, quiz mastery (spaced re-pass) 40, lesson read 20, and Fleet Week 500. Extend ranks to ~25k (add e.g. "HYPERVISOR", "FIRMWARE", "SILICON"). Add mastery achievements (beat the reference, no-hint lab, incident under 5 min, 30-day retention).
11. Make the streak use local time, add 1 freeze per week, and show it on Home and mobile.

**E. Zero-server tutor upgrade**
12. BYOK tutor drawer (Anthropic/OpenAI/OpenRouter CORS verified in NEXT.md §4), available on lessons, sims, Forge results and Fleet Week. Context pack = full lesson md + the learner's quiz misses + sim config + failing check messages, with Socratic system rules reused from `labs/AGENTS.md`. Optional local WebLLM/transformers.js hint model, since transformers.js is already loaded for the real-engine.
13. At minimum: lift the 1,800-char truncation by copying the full md to the clipboard plus a short URL prefill, and append "my last quiz misses: …".

**F. Onboarding and the browser Rust gap**
14. A 2-minute "first win" on Home: an embedded latency-walk or KV-calc challenge before any reading.
15. R lessons: add in-browser compile-free Rust practice, e.g. predict-the-borrow-error items, the existing RustLab ownership stepper moved into R.L3/R.L4, and "Open in Rust Playground" deep links (play.rust-lang.org is static-link compatible; no server of ours). Set the toolchain expectation up front ("setup: 10 min, needed from R.L1 drills"), and offer a Codespaces one-click per lab.

**G. Relatedness without servers**
16. A GitHub Discussions link per lesson ("discuss this lesson", prefilled title), a giscus-style embed (GitHub-backed, no kernelspace server), and "edit this page / report an error" links to the TS source.
17. Shareable, verifiable artifacts: a track-completion card and Fleet Week report as a PNG/SVG plus a JSON that includes the wasm hash, and a LinkedIn/GitHub README badge. Seed the leaderboard (the maintainer's and agent reference runs, labelled) or hide "Scores" from the nav until it has ≥5 entries.
18. File-based study groups and classrooms (NEXT.md §5): merge several exports into a cohort view locally.

**H. Mobile and accessibility**
19. A mobile-specific mode: review deck, quizzes, glossary and reading on phone; a "continue on laptop" handoff for labs (QR/URL). Show the streak and XP on mobile.
20. Wrap the app in `<MotionConfig reducedMotion="user">`, wire `settings.reducedMotion` and `settings.codeLang` to a Settings panel, and give sims text descriptions or tables of their state.

**I. Games / 3D where they genuinely help (motivation angle)**
21. Turn Fleet Week Act IV into a replayable **incident roguelite**: seeded failures, timer, escalating difficulty, and local personal bests. This retention mechanic fits the deterministic sim (`fleet-model.ts`) at zero server cost.
22. Use the existing R3F dependency for one *pedagogical* 3D view rather than decoration: a navigable GPU/HBM/NVLink rack where the Fleet's live telemetry lights up (KV-block occupancy per GPU, all-to-all traffic for MoE in T6). Do this only if paired with tasks; decorative 3D adds nothing to learning.
