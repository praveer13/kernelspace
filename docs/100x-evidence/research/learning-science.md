# Learning science for adult technical learners: evidence-ranked map for kernelspace (2026-10)

Scope: what the evidence says about how working engineers learn hard technical material, and how each finding should change kernelspace (lesson blocks, sims, Forge, Fleet, progress store). Every number has a source. **[unverified]** means I could not confirm it from a primary source in this session.

---

## 1. Executive summary

kernelspace is already strong on the high-yield *doing* side: simulators, Rust labs graded in the browser, Fleet incidents. Its weakest layer is **memory consolidation and assessment**:

- Each lesson ends with one multiple-choice quiz that is never shown again.
- That quiz is gameable. Of 266 single-answer questions, 230 have the answer at index 1, **252 (94.7%) have the longest option as the answer**, and options are never shuffled (measured in-repo).
- "Mark complete" pays 100 XP for reading. That is 2.5× the quiz reward and rewards the least effective activity.

The best-supported techniques are retrieval practice (g≈0.50–0.61), spacing, and successive relearning. Applied together through a local, FSRS-scheduled review queue with confidence ratings, they are the single biggest learning-per-effort upgrade, and they need no server.

Next in impact:
1. Predict-first / pretest blocks (prequestion effect g=0.54 on tested content).
2. Making the OS≡LLM isomorphism an active comparison task (case comparison d=0.50).
3. Productive-failure openers before key mechanisms (g=0.36; 0.37–0.58 when done faithfully).
4. Fading worked examples for the "numbers that must be reflexive".

Gamification and 3D help only when they carry the learning task itself. Decoration costs learning: seductive details hurt learning (g=−0.33 [unverified]), and in one N=52 study immersive VR gave more presence but less learning (a 35-study meta-analysis finds a small *positive* VR effect, ES=0.24, so immersion is conditional rather than harmful) [fixed].

---

## 2. Findings

**Effect-size calibration first.** Kraft (2020) put ~750 education RCTs on a single scale. The median effect on standardized achievement was ~0.10 SD, and ≥0.20 counts as "large" for field interventions ([Kraft 2020](https://doi.org/10.3102/0013189X20912798)). The lab-style meta-analytic effects below (0.4–0.8) are measured on aligned, researcher-made tests. Expect smaller real-world gains and never promise "2 sigma".

### 2.1 Memory and consolidation

**F1. Retrieval practice (testing effect).** The strongest, most replicated technique.
- **Evidence:**
  - Adesope et al. 2017: g = 0.61 vs. all non-testing conditions, but **g = 0.51 vs. restudy and g = 0.93 vs. filler/no activity**; similar in lab and classroom. Unlike Rowland, Adesope found retrieval practice **similarly beneficial with or without feedback**, and hybrid (mixed-format) practice tests were most effective ([RER](https://doi.org/10.3102/0034654316689306); the Learning Scientists summary states the feedback and hybrid-format findings but gives no g values) [fixed]. Counts of 272 effect sizes / 118 articles **[unverified]** (not in the abstract; the Learning Scientists post says "217 studies").
  - Rowland 2014: 159 effect sizes, g = 0.50 vs. restudy. By initial-test type, *cued* recall gave g = 0.61, but free recall (0.29) was no better than recognition (0.29) [fixed]. Feedback raised the effect to g≈0.73, vs. 0.39 without feedback ([Psych Bull](https://doi.org/10.1037/a0037559); feedback split via [EPFL copy](https://courseware.epfl.ch/assets/courseware/v1/fdde2f0aa590bf3b1324077a6bf1540c/asset-v1%3AEPFL%2BDEMO%2B2020%2Btype%40asset%2Bblock/Rowland2014-meta-analysis.pdf)).
  - Yang et al. 2021, classroom only: 222 studies, 48,478 students, g = 0.499. Moderated by feedback, number of repetitions, and format match ([Psych Bull](https://scholars.hkbu.edu.hk/en/publications/testing-quizzing-boosts-classroom-learning-a-systematic-and-meta-/)).
  - Transfer: Pan & Rickard 2018, d = 0.40 to new contexts. Transfer is strongest to application and inference questions and with *elaborated* retrieval. After publication-bias correction there is often no transfer unless those moderators are present ([Psych Bull](https://doi.org/10.1037/bul0000151)).
- **Boundary conditions:**
  - Cued recall beats recognition; free recall did not in Rowland [fixed].
  - Feedback roughly doubles the effect in Rowland (0.73 vs. 0.39), but Adesope found no reliable feedback advantage; treat feedback as important for correcting errors (and preventing MC-lure learning, see Gaps), not as a guaranteed 2× multiplier [fixed].
  - The testing effect shrinks or can disappear for very high element-interactivity material (van Gog & Sweller 2015 special issue; disputed by Karpicke & Aue 2015). Serving maths is exactly that kind of material, so pair retrieval with worked examples (F7) [fixed].
  - A single test is weaker than repeated tests.
  - Transfer to novel problems needs application-level items, not definitional ones.
- **kernelspace:** the current `quiz` block is recognition-only, runs once, sits at the end of the lesson, and is never revisited. That is the weakest form of the strongest technique.
  - Add recall-type items to `QuizQuestion` (src/components/QuizBlock.tsx): numeric with tolerance (KV bytes/token, ridge point, $/Mtok), cloze, ordering (e.g. a PagedAttention block-table walk), and "spot the bug" on Rust snippets.
  - Make application items ("given this trace, which knob?") the majority.

**F2. Spacing and optimal gaps.**
- **Evidence:**
  - Cepeda et al. 2006: 839 assessments in 317 experiments. The best inter-study interval grows with the retention interval ([Psych Bull](https://doi.org/10.1037/0033-2909.132.3.354)).
  - Cepeda et al. 2008, more than 1,350 learners: the optimal gap is ~20–40% of a 1-week retention interval but only ~5–10% of a 1-year interval ([Psych Sci](https://doi.org/10.1111/j.1467-9280.2008.02209.x)).
- **Boundary conditions:**
  - Gaps that are too long cost little compared with gaps that are too short; the curve rises steeply and then declines slowly.
  - Mostly shown with verbal and factual material.
- **kernelspace:** the target is "remember this at your next job interview or incident", i.e. 6–12 months. That implies reviews several weeks apart, not a reread the next day. The PLAN.md 3.6 idea of "arithmetic drills" was never shipped; build it as a scheduler-driven queue (I1).

**F3. Successive relearning.** Practise to a correct criterion, then re-practise to criterion in later spaced sessions.
- **Evidence:** across more than a dozen studies (vocabulary, psychology/statistics terms, probability), even one relearning session raises recall substantially ([Rawson & Dunlosky 2022, CDPS](https://doi.org/10.1177/09637214221100484)). The authors argue that time-on-task should be an *outcome*, tailored per student.
- **Boundary condition:** most evidence is for declarative and conceptual knowledge.
- **kernelspace:** a review item graduates only after it has been correct in ~3 separate sessions. "Mastered" should mean *relearned*, not *passed once at 80%*.

**F4. Interleaving, and when it fails.**
- **Evidence:**
  - Brunmair & Richter 2019: 59 studies, 238 effects, overall g = 0.42. Paintings g = 0.67, maths g = 0.34, but **words g = −0.39, where blocking wins**. Interleaving is stronger when categories are *similar to each other* and items within a category are *dissimilar*, and for complex material. Use caution with expository texts ([Psych Bull](https://doi.org/10.1037/bul0000209); numbers via [search abstract](https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf)).
  - Rohrer et al. 2019/2020 preregistered cluster RCT, 54 classes: 61% vs. 38% on a surprise test one month later, d = 0.83 ([JEP](https://doi.org/10.1037/edu0000367)).
  - Kornell & Bjork 2008: learners rated massed study as more effective *even after* their own test showed the opposite ([Psych Sci](https://doi.org/10.1111/j.1467-9280.2008.02127.x)).
- **Boundary conditions:**
  - It helps *discrimination*, i.e. choosing which strategy applies.
  - It hurts or does nothing for unrelated or verbal items and for first exposure.
  - Math Academy deliberately spaces *similar* new topics apart to avoid associative interference during acquisition, and interleaves them in review ([Math Academy](https://mathacademy.com/how-our-ai-works)).
- **kernelspace:** good candidates are mixed-review sets that force discrimination between confusable mechanisms:
  - paging vs. PagedAttention vs. radix/prefix cache
  - continuous vs. chunked-prefill vs. disaggregated batching
  - TP vs. EP vs. PP
  - mutex vs. lock-free MPMC
  
  Do not interleave the first exposure inside a lesson.

**F5. Pretesting / prequestions.**
- **Evidence:**
  - St. Hilaire et al. 2023, preregistered meta-analysis: **g = 0.54 for prequestioned content (k=97), but g = 0.04 for non-prequestioned content (k=91)** ([PB&R](https://doi.org/10.3758/s13423-023-02353-8); figures via search abstract).
  - Classroom replications exist ([Educ Psych Rev 2023](https://link.springer.com/10.1007/s10648-023-09805-6)).
  - Learners underestimate the benefit.
- **Boundary conditions:** in the meta-analysis it mostly helps the content that was asked about, so prequestions must target the lesson's core ideas. (The 2023 classroom study did find benefits for *non-pretested related* material too, so the "specific only" rule is a lab average, not an absolute [fixed].) Wrong guesses are fine if corrective study follows.
- **kernelspace:** a new `predict` block at the top of a lesson or before a sim run. For example: "Before reading: doubling batch size from 32→64 on an H100 decode step changes ITL by roughly …?" Store the guess and show it next to the answer later.

**F6. Generation effect.**
- **Evidence:** 86 studies, 445 effects, d = 0.40 for generating vs. reading ([Bertsch et al. 2007](https://pubmed.ncbi.nlm.nih.gov/17645161/)).
- **Boundary condition:** large variability by moderator.
- **kernelspace:** ask learners to *produce* things the lesson currently states: the bytes/token formula, the next block-table state, the missing line of the Rust example. This supports F1 and F5.

### 2.2 Designing initial learning

**F7. Worked examples, fading, expertise reversal, and element interactivity.**
- **Evidence:**
  - Worked examples beat unguided problem solving for novices. A meta-analysis of more than 100 maths studies found positive effects, including from studying *incorrect* examples ([Barbieri et al. 2023, EPR](https://oaks.kent.edu/hcri/meta-analysis-worked-examples-effect-mathematics-performance); pooled effect size **[unverified]**).
  - The advantage *reverses* as expertise grows ([Kalyuga et al. 2003](https://doi.org/10.1207/s15326985ep3801_4)).
  - Backward fading (remove the last step first) and *adaptive* fading beat fixed fading ([Renkl/Atkinson line of work; Salden et al.](https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/Exp_Rev_LI06.pdf)).
  - Load depends on *element interactivity*: how many elements must be held in working memory together ([Sweller 2010](https://doi.org/10.1007/s10648-010-9128-5)).
- **Boundary condition:** high-interactivity material is exactly where examples help most. Once learners have the schemas, examples become redundant.
- **kernelspace:** serving maths (KV sizing with GQA/MLA, roofline, parallelism memory budgets, $/Mtok) is high element-interactivity.
  - Build an `example-chain` block: full example → one step blank → two steps blank → full problem, with new numbers each time.
  - Skip ahead when the learner gets two right in a row (adaptive fading).
  - Use the existing placement check (Curriculum.tsx, 8 questions) to route experienced engineers straight to problems.

**F8. Productive failure and invention with contrasting cases.**
- **Evidence:**
  - Sinha & Kapur 2021: 53 studies, 166 comparisons. Problem solving before instruction beat instruction first, **g = 0.36 [0.20, 0.51]**, rising to g = 0.37–0.58 when the design followed productive-failure principles faithfully. After bias correction the estimate was g = 0.87 (an unusual upward correction; treat with caution). The 0.36 is for **conceptual knowledge and transfer only; for procedural knowledge the pooled effect was g = −0.03 [−0.20, 0.15], i.e. no advantage** [fixed]. Effects favoured instruction-first for younger learners (grades 2–5) and for domain-general skills ([RER](https://doi.org/10.3102/00346543211019105)).
  - Schwartz et al. 2011: inventing a formula from contrasting cases, *then* being told, gave equal procedural skill and better transfer of deep structure than tell-then-practise ([JEP](https://doi.org/10.1037/a0025140); see also [Schwartz & Bransford 1998, "A Time for Telling"](https://doi.org/10.1207/s1532690xci1604_4)).
  - Kapur 2016 frames direct instruction as possibly an "unproductive success" ([Ed Psych](https://doi.org/10.1080/00461520.2016.1155457)).
- **Boundary conditions:**
  - The problem must be solvable in multiple ways using prior knowledge.
  - It must be followed by consolidation that compares the student's attempts with the canonical solution.
  - It fails without needed prerequisites, and for domain-general skills.
- **kernelspace:** a natural fit for the "invent the mechanism" moments in T5/T6:
  - Allocate KV for variable-length requests before seeing PagedAttention.
  - Schedule mixed prefill/decode before seeing chunked prefill.
  - Route to share prefixes before seeing the radix cache.
  
  Run these in BatchingSim, KvCacheSim, or a Fleet sandbox. Then consolidate: "your design vs. vLLM's: which failure mode did yours hit?"

**F9. Self-explanation and elaborative interrogation.**
- **Evidence:**
  - Prompted self-explanation: 69 effect sizes from 64 research reports, g = .55 (abstract-confirmed); "~5,917 learners" and "holding when time-on-task was controlled" **[unverified]** ([Bisra et al. 2018](https://doi.org/10.1007/s10648-018-9434-x); g via [summary](https://idtips.substack.com/p/self-explanation-the-evidence-behind)).
  - Dunlosky et al. 2013 rated self-explanation and elaborative interrogation as "moderate utility" ([PSPI](https://www.psychologicalscience.org/?p=82014)).
- **Boundary condition:** quality depends on the prompt; free-form "explain" without a target is weaker.
- **kernelspace:** in `diagram` step-throughs and `code` blocks, add targeted prompts such as "Why must this be `Release` not `Relaxed`?". Learners can check their own answer against a rubric, or send it to their agent via AgentActions with the rubric pre-filled.

**F10. ICAP and the "doer effect".**
- **Evidence:**
  - Chi & Wylie 2014: Interactive > Constructive > Active > Passive ([Ed Psych](https://doi.org/10.1080/00461520.2014.965823)).
  - Koedinger et al. 2015, MOOC data with causal-inference controls: one more SD of *doing* activities was associated with **more than 6×** the learning benefit of one more SD of reading or watching ([L@S 2015](https://doi.org/10.1145/2724660.2724681)).
  - Freeman et al. 2014, 225 STEM studies: active learning +0.47 SD, and lecture students were 1.5× more likely to fail ([PNAS](https://doi.org/10.1073/pnas.1319030111)).
- **kernelspace:** prose is "passive". The economy (progress.ts XP: lesson 100 > quiz 40) pays most for the passive mode. Rebalance so XP follows constructive acts.

**F11. Analogical encoding / case comparison.** The scientific basis of the OS≡LLM isomorphism.
- **Evidence:**
  - Alfieri et al. 2013: 57 experiments, 336 tests, **d = .50 [.44, .56]** for comparing cases vs. sequential or single cases. Moderators: asking learners to find *similarities*; giving the principle *after* the comparison; perceptual content ([Ed Psych](https://doi.org/10.1080/00461520.2013.775712)).
  - Gentner, Loewenstein & Thompson 2003: comparing two cases strongly beat studying the same two cases separately. Transfer rose with more comparison support ([JEP](https://doi.org/10.1037/0022-0663.95.2.393)). In the companion MBA study, **almost twice as many** comparison-trained negotiators formed the target contract (40% vs. 22–23% for separate-case and baseline groups), not "nearly three times" ([Loewenstein, Thompson & Gentner 2003, AMLE](https://loewenstein.web.illinois.edu/papers/Loewensteinetal%20AMLE03.pdf)) [fixed].
- **Boundary condition:** passive side-by-side display is much weaker than *active* alignment.
- **kernelspace:** the `isomorphism` block (19 instances) currently *shows* the mapping. Turn it into a task:
  1. The learner aligns elements (drag "page table" → "block table", "TLB miss" → ?).
  2. The learner names where the analogy *breaks* (e.g. KV blocks are append-only and immutable once full; pages are not).
  3. The principle is revealed after the comparison.
  
  This is the signature pedagogy, and the evidence says the active form is the one that transfers.

**F12. Concreteness fading.**
- **Evidence:** Fyfe et al. 2014 systematic review: start concrete, then fade explicitly to the abstract. It beats concrete-only or abstract-only for transfer ([EPR](https://pc.cogs.indiana.edu/?p=885)).
- **kernelspace:** most sims already have a concrete view. Add an explicit three-stage sequence:
  1. Animated tokens/blocks in KvCacheSim.
  2. A schematic table.
  3. The symbolic formula / Rust struct.
  
  Retire the concrete layer as the learner progresses.

**F13. Predict-Observe-Explain.**
- **Evidence:** Crouch et al. 2004: students who *passively watched* demos understood no better than students who saw no demo; students who *predicted first* understood significantly better ([AJP](https://doi.org/10.1119/1.1707018)).
- **kernelspace:** every sim exercise checklist (3–5 tasks) should open with a recorded prediction and close with "explain the gap". This is cheap and maps onto the existing `exercise` + sim task infrastructure (`*.tasks.ts`).

**F14. Multimedia principles and seductive details.**
- **Evidence:**
  - Mayer's 2024 review lists 15 evidence-based principles: coherence, signalling, segmenting, pre-training, and others ([EPR](https://doi.org/10.1007/s10648-023-09842-1)).
  - Seductive details, meaning interesting but irrelevant material, hinder learning, moderated by delivery format, learner pacing, image type and more ([Sundararajan & Adesope 2020](https://doi.org/10.1007/s10648-020-09522-4)). The specific values g = −0.33 overall and ≈−0.70 in some formats are **[unverified]**: the abstract gives no numbers and the cited e-teaching page is bibliographic only.
  - Makransky et al. 2019, a **single N=52 study**: immersive VR in a science lab simulation produced more presence (d = 1.30) but less learning (d = 0.80) and higher EEG-measured load ([L&I](https://doi.org/10.1016/j.learninstruc.2017.12.007)). A 35-study meta-analysis found head-mounted VR *beat* less immersive instruction by a small ES = 0.24, mostly for K-12 learners and when compared with lectures ([Wu, Yu & Gu 2020, BJET](https://doi.org/10.1111/bjet.13023)). So the evidence says immersion is small and conditional, not reliably harmful [fixed].
- **kernelspace:**
  - 3D earns its place only where the *spatial structure is the concept*: the memory hierarchy as distance, the GPU SM/warp/tile hierarchy, 3D-parallel sharding cubes (TP×PP×DP/EP), NVLink/RDMA topologies.
  - Keep it schematic, learner-paced, and manipulable.
  - Audit decorative motion (home ParticleField is fine outside lessons) and "cool but irrelevant" analogies inside lessons.

### 2.3 Feedback, errors, metacognition

**F15. Feedback content matters more than feedback presence.**
- **Evidence:**
  - Wisniewski, Zierer & Hattie 2020: 435 studies, 994 effects, d = 0.48 overall. By type: **high-information feedback d = 0.99** vs. corrective d = 0.46 vs. reward/punishment d = 0.24. Motivational outcomes d = 0.33. Timing (immediate vs. delayed) was **not coded** as a moderator because of insufficient data, so this meta-analysis says nothing about timing [fixed] ([Front Psych](https://doi.org/10.3389/fpsyg.2019.03087)).
  - Hattie & Timperley 2007: task / process / self-regulation / self levels ([RER](https://doi.org/10.3102/003465430298487)).
  - Shute 2008: formative feedback should be specific, non-evaluative, and timely, and it interacts with learner and task ([RER](https://doi.org/10.3102/0034654307313795)).
- **kernelspace:** XP toasts are reward-type feedback, the weakest kind. Quiz `explanation` is optional. Make explanations mandatory and *per distractor* ("you chose X: that is the behaviour under static batching; here is why"). For Forge labs, test failures should name the misconception, not only the assertion.

**F16. Hypercorrection and confidence-weighted answering.**
- **Evidence:**
  - High-confidence errors are *more* likely to be corrected after feedback than low-confidence errors ([Butterfield & Metcalfe 2001, JEP:LMC](https://doi.org/10.1037/0278-7393.27.6.1491); the "G=.36" figure is **[unverified]**). The PMC link is not a review but an experimental replication, Metcalfe & Finn 2011, which found γ = .40 between error confidence and later correction in Exp. 1 ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3079415)) [fixed].
  - Errorful learning followed by corrective feedback, especially with analysis of the reasoning, is beneficial ([Metcalfe 2017, Annu Rev Psych](https://doi.org/10.1146/annurev-psych-010416-044022)).
- **kernelspace:**
  - Add a 3-level confidence tap (guess / think so / sure) to every quiz and review item.
  - "Sure but wrong" items get a highlighted explanation and are rescheduled sooner.
  - Show a calibration curve (stated confidence vs. accuracy) on /progress.
  - Production engineers live on calibrated judgement during incidents, so this is a professional skill in its own right.

**F17. Fluency illusions, calibration, and desirable difficulties.**
- **Evidence:**
  - Deslauriers et al. 2019: students in active physics classes learned more but *felt* they learned less ([PNAS](https://doi.org/10.1073/pnas.1821936116)).
  - Massed study feels better and works worse (Kornell & Bjork 2008, F4).
  - Overconfident learners stop studying early and retain less ([Dunlosky & Rawson 2012, L&I](https://doi.org/10.1016/j.learninstruc.2011.08.003); title-level claim; details **[unverified]**).
  - Learners also mis-predict the pretesting benefit (F5).
- **kernelspace:**
  - Tell learners up front, in onboarding and the Progress page, that effortful retrieval will feel worse and work better. Deslauriers et al. recommend this kind of early framing.
  - Never use "how confident do you feel" as a proxy for learning.
  - Measure learning with delayed retention checks instead.

### 2.4 Systems: mastery, tutoring, adaptivity

**F18. Mastery learning and Bloom's 2-sigma, deflated.**
- **Evidence:**
  - Bloom's 2σ came from studies that combined tutoring with mastery testing at an 80–90% criterion, corrective feedback, narrow outcome tests, and about an hour more instructional time per week [fixed]. It was never replicated. Later meta-analyses put tutoring at ~0.33–0.37 SD, and 0.27 on broad standardized tests ([von Hippel 2024, Education Next](https://www.educationnext.org/two-sigma-tutoring-separating-science-fiction-from-science-fact/)).
  - Nickow et al. 2020: tutoring 0.37 SD ([NBER](https://www.nber.org/papers/w27476)).
  - Kulik et al. 1990, 108 evaluations: mastery learning has positive effects, stronger for weaker students, **but self-paced mastery programs often reduce completion rates** ([RER](https://doi.org/10.3102/00346543060002265)).
- **kernelspace:** keep mastery gating *soft*. Show "not yet solid" and route to review, but never hard-lock content for self-paced adults; Kulik's completion finding is a direct warning. Exam lessons (quiz ≥80% to complete) are fine as checkpoints, but should be retakeable with *different* items drawn from a pool.

**F19. Intelligent tutoring and AI tutors.**
- **Evidence:**
  - VanLehn 2011: human tutoring d = 0.79, step-based ITS d = 0.76, answer-based systems lower; finer granularity did not keep improving results ([Ed Psych](https://doi.org/10.1080/00461520.2011.611369)).
  - Kulik & Fletcher 2016: median ITS effect 0.66 SD over 50 evaluations, but much smaller on standardized tests than on locally aligned tests ([RER](https://doi.org/10.3102/0034654315581420)).
  - LLM tutors:
    - Kestin et al. 2025 RCT, N=194 Harvard physics: the AI tutor beat in-class active learning, 0.63 SD by OLS and 0.73–1.3 SD by quantile regression. Median 49 min vs. ~60 min in class. The tutor was given **pre-written step-by-step solutions** and kept to a fixed sequence through each problem ([Sci Rep](https://doi.org/10.1038/s41598-025-97652-6); [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)).
    - Bastani et al. 2025, ~1,000 students: unrestricted GPT-4 raised practice scores by 48% but **cut later unassisted exam scores by 17%**. A guardrailed tutor raised practice scores by 127% and largely removed the harm ([PNAS](https://doi.org/10.1073/pnas.2422633122)).
- **kernelspace:** the agent-native approach (AGENTS.md "never write the solution") is directionally right. Two upgrades follow:
  1. Ship each lab's and lesson's *canonical step-by-step solution path plus a misconception list* inside the agent context (lessons-md and the lab zip), marked "for the tutor, never reveal". This is Kestin's key design element. Do it in a way the student's agent can use without the student reading it, which is hard; offer a sealed "tutor pack".
  2. Prefer step-based help ("which assertion fails, what invariant does it check") over answer-based help.

**F20. Knowledge tracing and spaced-repetition schedulers.**
- **Evidence:**
  - BKT, Corbett & Anderson 1995 ([UMUAI](https://doi.org/10.1007/BF01099821)).
  - DKT's advantage disappears when BKT is given forgetting, individual ability, and skill-similarity extensions ([Khajah et al. 2016](https://arxiv.org/abs/1604.02416)). Simple, interpretable models are enough.
  - FSRS models difficulty, stability, and retrievability. Its precursor work, the SSP-MMC scheduler (a stochastic-shortest-path optimiser over a Markov memory model, deployed in MaiMemo), reported a 12.6% improvement over prior methods on 220M MaiMemo logs ([Ye et al. KDD 2022](https://doi.org/10.1145/3534678.3539081)). That result is for SSP-MMC, not for the FSRS scheduler shipped in Anki, which schedules to a desired-retention target [fixed].
  - The open benchmark covers 10k Anki users and ~727M reviews. As of 2026-10-03, "FSRS-7 recency" scores log-loss 0.336 and AUC 0.724 (no same-day reviews). Neural models (RWKV, GRU, LSTM) rank above every FSRS variant on this benchmark, so FSRS is the best *lightweight, client-side* choice rather than the most accurate model ([srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark)) [fixed].
  - FSRS has been in Anki since 23.10 ([summary](https://concepts.dsebastien.net/concept/fsrs/)).
  - Math Academy's FIRe extends spacing to a *knowledge graph*. Success on an advanced topic gives fractional implicit credit to its prerequisites; failure sends penalties *up* to dependent topics; reviews are chosen so one review "knocks out" others; speed is calibrated per student per topic ([Skycak](https://justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/); [Math Academy](https://mathacademy.com/how-our-ai-works)). Its quizzes are tuned so students score ~80% on average.
  - Koedinger et al. 2023, 1.3M observations from 6,946 learners across 27 datasets: learners start at ~65% accuracy after instruction (median intercept 0.638 log-odds) and improve at a strikingly *uniform* median 0.09 log-odds (~2.5 percentage points) per practice opportunity. Learners differ mainly in prior knowledge, not learning rate ([PNAS](https://doi.org/10.1073/pnas.2221311120); [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10068755/)) [fixed].
    - The paper's own figure is a median of **7.24 opportunities** to reach 80% mastery ("about seven" in the abstract), which matches the back-of-envelope (logit 0.80 − logit 0.65)/0.1 ≈ 7.7 [fixed].
    - kernelspace offers ~4 MC items per concept, once.
- **kernelspace:**
  - Model ~200–300 knowledge components (KCs) with prerequisite edges. Lessons, quiz items, sim tasks, and lab tests are tagged to KCs.
  - Run FSRS per item, all client-side in zustand.
  - Apply FIRe-style implicit credit: passing Forge lab 02 (kv-block-manager) credits the "block table", "free list", and "ref-count / copy-on-write" KCs.
  - The data stays in localStorage and the JSON export, so there are no privacy issues.

**F21. Deliberate practice, with caveats.**
- **Evidence:** deliberate practice explains 26% of performance variance in games, 21% in music, 18% in sports, **4% in education, and under 1% in professions** ([Macnamara et al. 2014](https://doi.org/10.1177/0956797614535810)).
- **kernelspace:** keep its useful core (targeted reps at the edge of ability with immediate feedback: kernel and scheduler speedruns, incident drills) without "10,000 hours" rhetoric. Prior knowledge (F20) and good instruction matter as much.

### 2.5 Motivation, games, retention

**F22. Self-determination theory and rewards.**
- **Evidence:** Deci, Koestner & Ryan 1999, 128 studies:
  - Expected tangible rewards undermine free-choice intrinsic motivation: engagement-contingent d = −0.40, completion-contingent −0.36, performance-contingent −0.28.
  - **Positive informational feedback enhances it (d = +0.33).**
  - Tangible rewards hurt children more than college students ([Psych Bull](https://doi.org/10.1037/0033-2909.125.6.627)).
- **kernelspace:** XP for "mark complete" is a completion-contingent reward. With adults the harm is smaller, but it teaches the wrong proxy. Shift toward *informational* signals of competence: "you can now size KV for MLA models", calibration gains, retained-after-30-days counts. Autonomy means choice of path. Relatedness is the missing piece, because there are no social features.

**F23. Expectancy-value, utility value, and interest development.**
- **Evidence:**
  - A relevance intervention (students write how the material connects to their lives) raised interest and grades **for low-expectancy students** ([Hulleman & Harackiewicz 2009, Science](https://doi.org/10.1126/science.1177067); theory: [Eccles & Wigfield 2020](https://doi.org/10.1016/j.cedpsych.2020.101859)).
  - Interest develops in four phases, from triggered situational interest to well-developed individual interest ([Hidi & Renninger 2006](https://doi.org/10.1207/s15326985ep4102_4)).
- **kernelspace:** the audience is Java/Python backend engineers. Add a 2-minute "where this bites you at work" reflection prompt per track: "what in your current service is a ring buffer / a scheduler / a cache eviction policy?" The answer is stored locally and can be exported. The Field Notes and real traces trigger situational interest; Fleet Week sustains it.

**F24. Gamification and games: what actually works.**
- **Evidence:**
  - Sailer & Homner 2020: gamification has small effects on cognitive (g = .49), motivational (g = .36), and behavioural (g = .25) outcomes. Only the cognitive effect survived the high-rigour subsplit. **Game fiction and competition combined with collaboration** moderated the behavioural effects ([EPR](https://doi.org/10.1007/s10648-019-09498-w)).
  - Clark et al. 2016: digital games vs. non-game g = 0.33. *Augmented* game designs vs. standard g = 0.34, i.e. design matters beyond the medium ([RER](https://doi.org/10.3102/0034654315582065)).
  - Wouters et al. 2013: serious games beat conventional instruction on learning (d = 0.29) and retention (d = 0.36) but were **not more motivating** (d = 0.26, ns). They were better when supplemented with other instruction, played over multiple sessions, and played in groups ([JEP](https://doi.org/10.1037/a0031311)).
  - Simulation-based learning in higher education: **g = 0.85** over 145 studies. Learners with high prior knowledge benefit more from reflection phases, novices from examples ([Chernikova et al. 2020, RER](https://doi.org/10.3102/0034654320933544)).
- **kernelspace:** simulation *is* the high-evidence game form, and the Fleet / Fleet Week already exists. "Game-ify" by:
  - adding scenario fiction and stakes (you are on call at a lab serving model X; trace Y hits);
  - scaffolding (examples for novices, reflection prompts for experts);
  - multi-session campaigns.
  
  Points and badges are not the lever. Engine-level 3D (Unity/Unreal-style worlds) has no learning evidence for this content and pays a seductive-details tax; three.js/R3F schematic scenes inside existing sims are the ceiling.

**F25. Streaks and loss aversion.**
- **Evidence:**
  - Silverman & Barasch 2022/23, seven studies: highlighting *intact* streaks raises later engagement relative to highlighting *broken* ones. Learners treat streaks as goals in themselves. The drop after a break is larger when learners blame themselves and **attenuated when the streak can be "repaired"** ([JCR](https://doi.org/10.1093/jcr/ucac029)).
  - A 60k-student RCT in Peru with **4th–6th grade children**: streak-highlighting messages increased platform use and maths achievement. It is an IDB working paper, not peer reviewed, and transfer to adult professionals is untested ([IDB 2024](https://doi.org/10.18235/0012912)) [fixed].
- **kernelspace:** streakDays is an array of active dates.
  - Add repair or freezes and weekly targets ("3 sessions/week" suits working professionals better than daily).
  - Never show "streak lost: 0" prominently.
  - Make a *review session* count toward the streak; that couples the habit to retrieval.

**F26. MOOC completion and retention.**
- **Evidence:**
  - Reich & Ruipérez-Valiente 2019, 5.63M learners, 12.67M registrations: completion was **3.13% in 2017–18** (the 5.63M / 12.67M / 3.13% figures are **[unverified]**: the paper is paywalled and the MIT TSL page gives no numbers). Primary-confirmed: completion did not improve over 6 years, and the vast majority of learners never returned after their first year ([Science](https://doi.org/10.1126/science.aav7958); figures via [search abstract](https://tsl.mit.edu/research/the-mooc-pivot/)).
  - Kulik 1990: self-paced mastery lowers completion (F18).
- **kernelspace:** a self-paced, 68-lesson, account-free course is structurally a MOOC. The levers with evidence are:
  - short sessions with a clear next action (a "today: 12 reviews + 1 lesson" queue);
  - visible competence gains;
  - optional cohorts/commitment devices (a study-plan file, GitHub-based cohort repos);
  - re-entry ramps after breaks (review instead of "you are 14 days behind").

### 2.6 Myths and low-utility techniques to avoid

- **Learning styles (meshing).** Pashler et al. 2008 found almost no adequately designed tests, and the few they found contradicted meshing ([PSPI](https://digitalcommons.usf.edu/psy_facpub/1765/)). Do not add a "visual learner mode". Multimedia helps *everyone* (F14).
- **Low utility (Dunlosky et al. 2013):** highlighting/underlining, rereading, summarisation, keyword mnemonics, imagery for text. **High utility:** practice testing and distributed practice ([PSPI summary](https://www.psychologicalscience.org/?p=82014)). Do not build highlighters or "reread" buttons as learning features.
- **"2-sigma AI tutor" claims.** See F18.
- **"10,000 hours."** See F21.
- **"Learners know what works for them."** See F17. Satisfaction and feeling of learning are not evidence of learning.

---

## 3. Concrete ideas for kernelspace, ranked by expected learning impact ÷ build effort

Impact and effort are on a 1–5 scale. Effort assumes one maintainer plus AI agents.

| # | Idea | Evidence | Touches | Impact | Effort | Zero-server |
|---|---|---|---|---|---|---|
| I0 | **Quiz integrity fix.** Shuffle options per render with a seeded per-attempt shuffle; rewrite the 252 "longest = correct" items so distractors are equal-length and plausible (drawn from real misconceptions); CI lint that fails on answer-index skew >40% or longest-option skew >35%. | F1, F15; measured defect | QuizBlock.tsx, src/data/lessons/**, scripts/ lint, CI | 4 (every assessment is currently invalid) | 1–2 | yes |
| I1 | **Review queue ("daily warm-up").** FSRS-scheduled retrieval over all quiz items plus new recall items; successive-relearning graduation (correct in ≥3 sessions); entry from Home and Progress; counts toward the streak. | F1–F3, F20, F25 | new src/lib/review.ts (FSRS; the open-source ts-fsrs package, v5.4.2 on npm as of 2026-10-03 [fixed]), progress.ts state + migration, new /review page | 5 | 2–3 | yes (localStorage + JSON export) |
| I2 | **Confidence tap + hypercorrection + calibration chart.** 3-level confidence on every item; sure-and-wrong items rescheduled sooner with emphasised explanation; Brier/calibration curve on /progress. | F16, F17 | QuizBlock, review.ts, Progress.tsx | 4 | 1–2 | yes |
| I3 | **Recall item types.** Numeric with tolerance and units, cloze, ordering, Rust "spot the bug", trace-reading ("which knob?"). Mandatory per-distractor explanations. | F1 (recall > recognition), F15 | types.ts `QuizQuestion` union, QuizBlock | 4 | 2 | yes |
| I4 | **`predict` block + POE in every sim exercise.** Commit a numeric or choice prediction before reading or running; reveal with the gap; "explain the gap" self-explanation prompt; predictions stored and shown later. | F5, F13, F9 | types.ts new block, blocks.tsx, `*.tasks.ts`, Lab.tsx | 4 | 2 | yes |
| I5 | **XP economy rebalance.** Lesson completion requires a 3-item exit retrieval (not a button); XP moves from reading to retrieval, sims, labs, and *retention* (bonus when an item is still recalled after 30+ days); show competence statements, not just points. | F10, F22 | progress.ts XP, Lesson.tsx complete() | 3 | 1 | yes |
| I6 | **Active isomorphism.** Convert the 19 `isomorphism` panels into align-then-reveal tasks: drag-match OS↔LLM elements, name the break point, principle shown after. Generate "which mechanism is this?" interleaved discrimination items from the pairs and the glossary. | F11, F4 | isomorphism block renderer, Glossary.tsx, review pool | 4 | 2–3 | yes |
| I7 | **Fading example chains** for the reflexive numbers (KV bytes/token for MHA/GQA/MLA, ridge point, TP/EP memory, $/Mtok, Little's law). Adaptive fading; experts skip via placement. | F7 | new `example-chain` block, Curriculum placement | 4 | 2–3 | yes |
| I8 | **Productive-failure openers (5–8 lessons).** "Invent the mechanism" in a sim sandbox before the lesson (KV allocation, mixed prefill/decode scheduling, prefix routing, expert placement), then a consolidation block that contrasts typical student designs with the canonical one. | F8, F11 | T5/T6 lessons, BatchingSim/KvCacheSim/Fleet sandbox | 4 | 3–4 | yes |
| I9 | **Tutor pack for agents.** Per lesson/lab: canonical step path, misconception list, hint ladder (step-level), and a rule to check the student's own explanation against the rubric. Keep "never write the solution". | F19 (Kestin design; Bastani guardrails) | public/lessons-md, labs/*/AGENTS.md, AgentActions.tsx | 3–4 | 2 | with-caveat (relies on the learner's external LLM; nothing hosted) |
| I10 | **Knowledge-component graph + mastery map.** ~250 KCs with prerequisites; every item, sim task, and lab test tagged; FIRe-style implicit credit and failure propagation; soft gating ("not yet solid → review") rather than locks. | F18, F20 | new src/data/kc-graph.ts, review.ts, Track/Progress pages | 4 | 4 | yes |
| I11 | **Delayed "cold checks".** 7- and 30-day surprise retention probes per completed lesson; the learner sees their own forgetting curve. This is also the only honest local measure of whether kernelspace works. | F17, F2 | review.ts, Progress.tsx | 3 | 1 | yes |
| I12 | **Streak redesign.** Weekly goal, repair/freeze tokens, review sessions count, no prominent broken-streak display. | F25, F26 | progress.ts streakDays, Progress/Home | 2 | 1 | yes |
| I13 | **Scenario campaigns in Fleet.** On-call fiction, multi-session arcs, reflection prompts after each incident (experts) and worked incident examples (novices). | F24 (Chernikova scaffolding; Wouters multi-session) | Fleet/FleetWeek pages, fleet-model scenarios | 3–4 | 3 | yes |
| I14 | **Schematic 3D only where space is the concept.** Memory-hierarchy "distance" walk, SM/warp/tile nesting, TP×PP×EP sharding cube, cluster topology; learner-paced and manipulable; no immersive world. | F14 (coherence; Makransky), F12 | new R3F components inside existing sims (three/R3F already deps) | 2–3 | 3 | yes |
| I15 | **Utility-value reflections.** One prompt per track ("where does this show up in your service?"), local and exportable. | F23 | track intro blocks | 2 | 1 | yes |
| I16 | **Self-explanation prompts** in diagram steps and code blocks, with a rubric reveal and an optional "send to my agent". | F9 | diagram/code renderers, AgentActions | 3 | 1–2 | yes |
| I17 | **Cohort kits.** GitHub template repo + Discussions for study groups; "explain to a peer" prompts (ICAP interactive); collaborative plus competitive team leaderboards. | F10, F24 (competition + collaboration) | docs, Leaderboard | 2–3 | 2 | with-caveat (third-party GitHub features; no own server) |
| I18 | **Learning-science onboarding card.** "Why this will feel harder" framing at first visit and on the first review queue. | F17 | Home/Curriculum | 2 | 1 | yes |

Recommended order: I0 → I5 → I2/I3 → I1 → I4 → I6 → I11 → I7 → I9 → I12. Then I8, I10, I13, and I14 as larger waves. I0 to I5 alone convert the course from "read and pass once" into "retrieve, space, calibrate".

---

## 4. Anti-patterns and risks

**Current conflicts with the evidence:**
1. **Gameable MC.** 230/266 answers are B and 94.7% of answers are the longest option, with no shuffling. Every quiz score, the ≥80% exam gate, and placement all measure test-wiseness, not knowledge. This is the first fix.
2. **Single end-of-lesson quiz, never revisited.** It throws away spacing and successive relearning (F2, F3), and with only ~4 items per lesson it offers far fewer practice opportunities than Koedinger's learning-rate data implies are needed (F20).
3. **XP for reading.** "Mark complete" pays 100 XP vs. 40 for passing the quiz. That is a completion-contingent reward for the passive ICAP mode (F10, F22).
4. **Recognition-only items.** No recall or numeric answers, despite the course's own emphasis on "numbers that must be reflexive" (F1).
5. **Isomorphisms shown, not compared.** Learners get the passive form of analogical encoding (F11).
6. **Optional, single explanation.** Quiz feedback is corrective-level, not high-information (F15).

**Design risks for the new features:**
- **Over-gating.** Hard mastery locks lower completion in self-paced settings (Kulik 1990). Use soft routing.
- **Interleaving misuse.** Interleave only confusable mechanisms and only in review. Do not interleave first exposure or unrelated facts (Brunmair: words g = −0.39).
- **Productive failure without prerequisites.** It reverses for domain-general skills and unprepared learners (Sinha & Kapur). Gate PF openers on prerequisite KCs and always follow with consolidation.
- **Expertise reversal.** Forcing senior engineers through worked examples wastes time and can hurt learning. Use the placement check to skip ahead.
- **AI tutor as a crutch.** Bastani's −17% result. Never ship a "solve it" button, and keep tutor packs step-level.
- **Streak anxiety.** Daily streaks punish professionals with on-call weeks. Broken-streak framing reduces re-engagement unless repair exists.
- **Seductive 3D.** Immersion without a task lowers learning (Makransky). Reject a game-engine "datacenter world" unless every interaction is a learning action.
- **Points-only gamification.** Motivational effects are fragile under rigour (Sailer & Homner). Fiction, collaboration, and scaffolding carry the effect.
- **Evaluating by feel.** Deslauriers: active methods feel worse. With no telemetry, the only honest outcome metric is the learner's own delayed-retention data (I11), surfaced locally. An opt-in, aggregate-only "retention report" PR, like the leaderboard, is possible but must be strictly voluntary.
- **Inflated promises.** Do not market "2-sigma" or "100x" learning. Realistic stacked gains are tenths of an SD on aligned tests (Kraft benchmarks).
- **Review debt.** FSRS queues can balloon. Cap new items per day and allow a "desired retention" setting; FIRe-style compression reduces load.
- **Maintenance cost.** Every new item needs a sourced explanation and misconception-based distractors. Use an agent-assisted authoring checklist plus the CI lint from I0.

---

## 5. Sources

| # | Source | Date | URL |
|---|---|---|---|
| 1 | Adesope, Trevisan & Sundararajan, Rethinking the Use of Tests: A Meta-Analysis of Practice Testing, RER | 2017 | https://doi.org/10.3102/0034654316689306 |
| 2 | Learning Scientists, New meta-analysis of 217 retrieval practice studies (Adesope g=0.61) | 2017-02 | https://www.learningscientists.org/blog/2017/2/9-1 |
| 3 | Rowland, Effect of testing versus restudy on retention, Psych Bull | 2014 | https://doi.org/10.1037/a0037559 |
| 4 | Rowland 2014 PDF (feedback moderator) | 2014 | https://courseware.epfl.ch/assets/courseware/v1/fdde2f0aa590bf3b1324077a6bf1540c/asset-v1%3AEPFL%2BDEMO%2B2020%2Btype%40asset%2Bblock/Rowland2014-meta-analysis.pdf |
| 5 | Yang et al., Testing (quizzing) boosts classroom learning, Psych Bull 147(4) | 2021 | https://scholars.hkbu.edu.hk/en/publications/testing-quizzing-boosts-classroom-learning-a-systematic-and-meta-/ |
| 6 | Pan & Rickard, Transfer of test-enhanced learning, Psych Bull | 2018 | https://doi.org/10.1037/bul0000151 |
| 7 | Cepeda et al., Distributed practice in verbal recall tasks, Psych Bull | 2006 | https://doi.org/10.1037/0033-2909.132.3.354 |
| 8 | Cepeda et al., Spacing effects in learning: a temporal ridgeline, Psych Sci | 2008 | https://doi.org/10.1111/j.1467-9280.2008.02209.x |
| 9 | Rawson & Dunlosky, Successive Relearning, CDPS | 2022 | https://doi.org/10.1177/09637214221100484 |
| 10 | Brunmair & Richter, Similarity matters: interleaved learning meta-analysis, Psych Bull | 2019 | https://doi.org/10.1037/bul0000209 |
| 11 | Rohrer, Dedrick, Hartwig & Cheung, RCT of interleaved mathematics practice, JEP | 2019/2020 | https://doi.org/10.1037/edu0000367 |
| 12 | Kornell & Bjork, Learning concepts and categories, Psych Sci | 2008 | https://doi.org/10.1111/j.1467-9280.2008.02127.x |
| 13 | St. Hilaire et al., Guessing as a learning intervention: prequestion meta-analysis, PB&R | 2023-08 | https://doi.org/10.3758/s13423-023-02353-8 |
| 14 | Pretesting Enhances Learning in the Classroom, Educ Psych Rev | 2023 | https://link.springer.com/10.1007/s10648-023-09805-6 |
| 15 | Bertsch et al., The generation effect: a meta-analytic review, Mem & Cog | 2007 | https://pubmed.ncbi.nlm.nih.gov/17645161/ |
| 16 | Barbieri et al., Meta-analysis of the worked examples effect on mathematics performance, EPR | 2023 | https://oaks.kent.edu/hcri/meta-analysis-worked-examples-effect-mathematics-performance |
| 17 | Kalyuga, Ayres, Chandler & Sweller, The Expertise Reversal Effect, Ed Psych | 2003 | https://doi.org/10.1207/s15326985ep3801_4 |
| 18 | Salden/Renkl et al., expertise reversal and fading in tutored problem solving (PDF) | 2010 | https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/Exp_Rev_LI06.pdf |
| 19 | Sweller, Element interactivity and intrinsic, extraneous, germane load, EPR | 2010 | https://doi.org/10.1007/s10648-010-9128-5 |
| 20 | Sinha & Kapur, When problem solving followed by instruction works, RER | 2021 | https://doi.org/10.3102/00346543211019105 |
| 21 | Kapur, Productive failure, productive success…, Ed Psych | 2016 | https://doi.org/10.1080/00461520.2016.1155457 |
| 22 | Schwartz, Chase, Oppezzo & Chin, Practicing versus inventing with contrasting cases, JEP | 2011 | https://doi.org/10.1037/a0025140 |
| 23 | Schwartz & Bransford, A Time for Telling, Cognition & Instruction | 1998 | https://doi.org/10.1207/s1532690xci1604_4 |
| 24 | Bisra et al., Inducing Self-Explanation: a Meta-Analysis, EPR | 2018 | https://doi.org/10.1007/s10648-018-9434-x |
| 25 | Self-explanation evidence summary (g=.55) | n.d. | https://idtips.substack.com/p/self-explanation-the-evidence-behind |
| 26 | Dunlosky et al., Improving students' learning with effective learning techniques, PSPI (APS summary) | 2013-01 | https://www.psychologicalscience.org/?p=82014 |
| 27 | Chi & Wylie, The ICAP Framework, Ed Psych | 2014 | https://doi.org/10.1080/00461520.2014.965823 |
| 28 | Koedinger et al., Learning is Not a Spectator Sport, L@S | 2015 | https://doi.org/10.1145/2724660.2724681 |
| 29 | Freeman et al., Active learning increases student performance in STEM, PNAS | 2014 | https://doi.org/10.1073/pnas.1319030111 |
| 30 | Alfieri, Nokes-Malach & Schunn, Learning Through Case Comparisons, Ed Psych | 2013 | https://doi.org/10.1080/00461520.2013.775712 |
| 31 | Gentner, Loewenstein & Thompson, Learning and transfer: analogical encoding, JEP | 2003 | https://doi.org/10.1037/0022-0663.95.2.393 |
| 32 | Loewenstein, Thompson & Gentner, Analogical learning in negotiation teams, AMLE | 2003 | https://business.illinois.edu/loewenstein/papers/Loewensteinetal%20AMLE03.pdf |
| 33 | Fyfe, McNeil, Son & Goldstone, Concreteness fading: systematic review, EPR | 2014 | https://pc.cogs.indiana.edu/?p=885 |
| 34 | Crouch, Fagen, Callan & Mazur, Classroom demonstrations: learning tools or entertainment?, AJP | 2004 | https://doi.org/10.1119/1.1707018 |
| 35 | Mayer, Past, present, future of the cognitive theory of multimedia learning, EPR | 2024 | https://doi.org/10.1007/s10648-023-09842-1 |
| 36 | Sundararajan & Adesope, Keep it Coherent: seductive details meta-analysis, EPR | 2020 | https://doi.org/10.1007/s10648-020-09522-4 |
| 37 | e-teaching.org summary of Sundararajan & Adesope | n.d. | https://www.e-teaching.org/materialien/literatur/sundararajan-adesope-2020 |
| 38 | Makransky, Terkildsen & Mayer, Immersive VR: more presence but less learning, L&I | 2019 | https://doi.org/10.1016/j.learninstruc.2017.12.007 |
| 39 | Wisniewski, Zierer & Hattie, The Power of Feedback Revisited, Front Psych | 2020-01 | https://doi.org/10.3389/fpsyg.2019.03087 |
| 40 | Hattie & Timperley, The Power of Feedback, RER | 2007 | https://doi.org/10.3102/003465430298487 |
| 41 | Shute, Focus on Formative Feedback, RER | 2008 | https://doi.org/10.3102/0034654307313795 |
| 42 | Metcalfe & Finn, People's hypercorrection of high confidence errors: did they know it all along?, JEP:LMC (experimental paper, not a review) [fixed] | 2011 | https://pmc.ncbi.nlm.nih.gov/articles/PMC3079415 |
| 43 | Metcalfe, Learning from Errors, Annu Rev Psych | 2017 | https://doi.org/10.1146/annurev-psych-010416-044022 |
| 44 | Deslauriers et al., Measuring actual learning versus feeling of learning, PNAS | 2019 | https://doi.org/10.1073/pnas.1821936116 |
| 45 | Dunlosky & Rawson, Overconfidence produces underachievement, L&I | 2012 | https://doi.org/10.1016/j.learninstruc.2011.08.003 |
| 46 | von Hippel, Two-Sigma Tutoring: Separating Science Fiction from Science Fact, Education Next | 2024 | https://www.educationnext.org/two-sigma-tutoring-separating-science-fiction-from-science-fact/ |
| 47 | Nickow, Oreopoulos & Quan, Transformative potential of tutoring, NBER w27476 | 2020 | https://www.nber.org/papers/w27476 |
| 48 | Kulik, Kulik & Bangert-Drowns, Effectiveness of Mastery Learning Programs, RER | 1990 | https://doi.org/10.3102/00346543060002265 |
| 49 | VanLehn, Relative effectiveness of human tutoring, ITS…, Ed Psych | 2011 | https://doi.org/10.1080/00461520.2011.611369 |
| 50 | Kulik & Fletcher, Effectiveness of Intelligent Tutoring Systems, RER | 2016 | https://doi.org/10.3102/0034654315581420 |
| 51 | Kestin et al., AI tutoring outperforms in-class active learning (RCT), Sci Rep | 2025-06 | https://doi.org/10.1038/s41598-025-97652-6 (full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/) |
| 52 | Bastani et al., Generative AI without guardrails can harm learning, PNAS 122(26) | 2025 | https://doi.org/10.1073/pnas.2422633122 |
| 53 | Corbett & Anderson, Knowledge tracing, UMUAI | 1995 | https://doi.org/10.1007/BF01099821 |
| 54 | Khajah, Lindsey & Mozer, How Deep is Knowledge Tracing? (EDM best paper) | 2016 | https://arxiv.org/abs/1604.02416 |
| 55 | Ye, Su & Cao, A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling (SSP-MMC, MaiMemo; FSRS precursor), KDD [fixed] | 2022 | https://doi.org/10.1145/3534678.3539081 |
| 56 | open-spaced-repetition/srs-benchmark (FSRS-7 results) | accessed 2026-10-03 | https://github.com/open-spaced-repetition/srs-benchmark |
| 57 | FSRS concept summary (Anki 23.10 integration) | n.d. | https://concepts.dsebastien.net/concept/fsrs/ |
| 58 | Skycak, Optimized, Individualized Spaced Repetition in Hierarchical Knowledge Structures (FIRe) | n.d. | https://justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/ |
| 59 | Math Academy, How our AI works | accessed 2026-10-03 | https://mathacademy.com/how-our-ai-works |
| 60 | Koedinger et al., An astonishing regularity in student learning rate, PNAS | 2023 | https://doi.org/10.1073/pnas.2221311120 |
| 61 | Macnamara, Hambrick & Oswald, Deliberate practice and performance: meta-analysis, Psych Sci | 2014 | https://doi.org/10.1177/0956797614535810 |
| 62 | Deci, Koestner & Ryan, Meta-analytic review of extrinsic rewards on intrinsic motivation, Psych Bull | 1999 | https://doi.org/10.1037/0033-2909.125.6.627 |
| 63 | Hulleman & Harackiewicz, Promoting interest and performance in high school science, Science | 2009 | https://doi.org/10.1126/science.1177067 |
| 64 | Eccles & Wigfield, From expectancy-value theory to situated EVT, CEP | 2020 | https://doi.org/10.1016/j.cedpsych.2020.101859 |
| 65 | Hidi & Renninger, The Four-Phase Model of Interest Development, Ed Psych | 2006 | https://doi.org/10.1207/s15326985ep4102_4 |
| 66 | Sailer & Homner, The Gamification of Learning: a Meta-analysis, EPR 32(1) | 2020 | https://doi.org/10.1007/s10648-019-09498-w |
| 67 | Clark, Tanner-Smith & Killingsworth, Digital Games, Design, and Learning, RER | 2016 | https://doi.org/10.3102/0034654315582065 |
| 68 | Wouters et al., Cognitive and motivational effects of serious games, JEP | 2013 | https://doi.org/10.1037/a0031311 |
| 69 | Chernikova et al., Simulation-Based Learning in Higher Education: A Meta-Analysis, RER | 2020 | https://doi.org/10.3102/0034654320933544 |
| 70 | Silverman & Barasch, On or Off Track: How (Broken) Streaks Affect Consumer Decisions, JCR | 2022/2023 | https://doi.org/10.1093/jcr/ucac029 |
| 71 | Streaking to Success: highlighting streaks on student effort and achievement (Peru RCT), IDB | 2024 | https://doi.org/10.18235/0012912 |
| 72 | Reich & Ruipérez-Valiente, The MOOC Pivot, Science | 2019-01 | https://doi.org/10.1126/science.aav7958 |
| 73 | MIT TSL page / search abstract for MOOC Pivot (3.13%) | 2019 | https://tsl.mit.edu/research/the-mooc-pivot/ |
| 74 | Pashler, McDaniel, Rohrer & Bjork, Learning Styles: Concepts and Evidence, PSPI | 2008 | https://digitalcommons.usf.edu/psy_facpub/1765/ |
| 75 | Kraft, Interpreting Effect Sizes of Education Interventions, Ed Researcher | 2020 | https://doi.org/10.3102/0013189X20912798 |

**In-repo measurements (2026-10-03):**
- `grep "correct: [n]"` over src/data/lessons: 230× index 1, 26× index 2, 10× index 0.
- Node script over 266 single-answer items: the correct option is the longest in 252 (94.7%).
- QuizBlock.tsx has no shuffle.
- progress.ts XP: lesson 100, quiz 40, exercise 60, lab 200.
- Lesson.tsx "Mark complete · +100 XP" button.
- 19 `isomorphism` blocks; 28 `exercise` blocks; 8-question placement in Curriculum.tsx.

---

## Verification log

Adversarial check, 2026-10-03. Sources were abstracts (OpenAlex, Europe PMC, ERIC, Semantic Scholar), full-text PDFs where reachable, and in-repo measurement. Verdicts: confirmed / corrected / unverified / refuted.

| Claim | Verdict | Evidence URL |
|---|---|---|
| Rowland 2014: g=0.50 vs restudy, k=159, feedback 0.73 vs 0.39 | confirmed (k = 104+36+19 = 159; CI [0.42, 0.58]) | https://courseware.epfl.ch/assets/courseware/v1/fdde2f0aa590bf3b1324077a6bf1540c/asset-v1%3AEPFL%2BDEMO%2B2020%2Btype%40asset%2Bblock/Rowland2014-meta-analysis.pdf |
| Rowland: recall-type tests beat recognition | corrected: cued recall 0.61, but free recall 0.29 = recognition 0.29 | same PDF (initial test type table) |
| "Feedback roughly doubles the effect" | corrected: true in Rowland only; Adesope 2017 found similar benefit with or without feedback | https://www.learningscientists.org/blog/2017/2/9-1 ; https://api.semanticscholar.org/graph/v1/paper/DOI:10.3102/0034654316689306/citations |
| Adesope 2017: g=0.61 overall | confirmed; vs restudy g=0.51, vs no activity g=0.93 added. Counts (272/118) unverified | https://doi.org/10.3102/0034654316689306 |
| Yang et al. 2021: 222 studies, 48,478 students, g=0.499 | confirmed | https://scholars.hkbu.edu.hk/en/publications/testing-quizzing-boosts-classroom-learning-a-systematic-and-meta-/ |
| Pan & Rickard 2018: transfer d=0.40; no transfer without moderators after bias correction | confirmed (192 ES, 122 experiments, N=10,382) | https://doi.org/10.1037/bul0000151 |
| Cepeda 2008: >1,350 learners; optimal gap 20–40% of 1-week, 5–10% of 1-year delay | confirmed (abstract) | https://doi.org/10.1111/j.1467-9280.2008.02209.x |
| Brunmair & Richter 2019: g=0.42; paintings 0.67, maths 0.34, words −0.39; similarity moderators | confirmed (words rests on k=13) | https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf |
| Rohrer et al.: 54 classes, 61% vs 38%, d=0.83 | confirmed (7th-grade; JEP 2020 112(1)) | https://doi.org/10.1037/edu0000367 |
| St. Hilaire 2023 prequestions: g=0.54 (k=97) vs 0.04 (k=91), preregistered | confirmed (abstract) | https://doi.org/10.3758/s13423-023-02353-8 |
| "Prequestions only help asked-about content" | corrected: 2023 classroom study found benefit for non-pretested related material too | https://doi.org/10.1007/s10648-023-09805-6 |
| Sinha & Kapur 2021: g=0.36 [0.20,0.51]; 0.37–0.58 high-fidelity PF; 0.87 bias-corrected | confirmed (full text) | https://doi.org/10.3929/ethz-b-000490417 |
| Sinha & Kapur: scope of the effect | corrected: conceptual/transfer only; procedural knowledge g=−0.03 | same (ETH full text) |
| Alfieri 2013: d=.50 [.44,.56], 57 experiments, 336 tests; similarities + principle-after | confirmed (also: immediate testing larger, perceptual content) | https://doi.org/10.1080/00461520.2013.775712 |
| Gentner/Loewenstein "nearly 3×" transfer | corrected: cited AMLE paper says "almost twice as many" (40% vs 22–23%) | https://loewenstein.web.illinois.edu/papers/Loewensteinetal%20AMLE03.pdf |
| Wisniewski 2020: d=0.48; high-info 0.99, corrective 0.46, reward/punishment 0.24; motivational 0.33 | confirmed | https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.03087/full |
| Wisniewski: "timing not a significant moderator" | refuted: timing was not coded (insufficient data) | same |
| Bloom 2σ bundle; tutoring 0.33/0.37, 0.27 standardized | confirmed (plus ~1 extra hour/week of instruction) | https://www.educationnext.org/two-sigma-tutoring-separating-science-fiction-from-science-fact/ |
| Kulik 1990: 108 evaluations; self-paced mastery often reduces completion | confirmed (abstract, college classes) | https://api.crossref.org/works/10.3102/00346543060002265 |
| Kestin 2025: N=194, 0.63 OLS / 0.73–1.3 SD quantile, median 49 min, pre-written step-by-step answers | confirmed (Sci Rep, 2025-06-03) | https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/ |
| Bastani 2025: ~1,000 students; +48% / +127% practice; −17% exam for GPT Base; Tutor harm "essentially eradicated" | confirmed (Tutor: no significant gain either) | https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/ |
| Sailer & Homner 2020: g=.49/.36/.25; only cognitive stable; fiction + competition-with-collaboration | confirmed (small k: 19/16/9) | https://doi.org/10.1007/s10648-019-09498-w |
| Chernikova 2020: g=0.85, 145 studies; prior-knowledge × scaffolding | confirmed | https://doi.org/10.3102/0034654320933544 |
| Seductive details g=−0.33 (−0.70 some formats) | unverified (abstract has no numbers; cited summary page is bibliographic only) | https://eric.ed.gov/?q=%22Keep+It+Coherent%22 |
| Makransky 2019: more presence, less learning | confirmed but overgeneralized: single N=52 study; meta-analysis ES=+0.24 for HMD VR | https://doi.org/10.1016/j.learninstruc.2017.12.007 ; https://doi.org/10.1111/bjet.13023 |
| Koedinger 2023: ~65% start, ~0.1 log-odds (~2.5%) per opportunity, 1.3M obs | confirmed (median 0.09 log-odds; 7.24 opportunities to 80%) | https://pmc.ncbi.nlm.nih.gov/articles/PMC10068755/ |
| Repo: 230/266 at index 1; 252/266 longest; no shuffle | confirmed (re-measured: 230/26/10 by index; 252 longest, 251 uniquely longest; QuizBlock.tsx has no shuffle/random) | in-repo: src/data/lessons/**, src/components/QuizBlock.tsx |
| Repo: XP lesson 100 / quiz 40 / exercise 60 / lab 200; 19 isomorphism, 28 exercise, 8-item placement | confirmed | src/lib/progress.ts, src/pages/Lesson.tsx:809, src/pages/Curriculum.tsx |
| Kraft 2020: ~750 RCTs, median 0.10 SD, ≥0.20 large | confirmed (1,942 ES from 747 RCTs; <0.05 small, 0.05–<0.20 medium) | https://www.edworkingpapers.com/sites/default/files/Interpreting%20Effect%20Sizes%20-%20August%2019%20FINAL_0.pdf |
| Deci et al. 1999: −0.40 / −0.36 / −0.28; positive feedback +0.33 | confirmed | https://doi.org/10.1037/0033-2909.125.6.627 |
| Freeman 2014: 225 studies, +0.47 SD, 1.5× failure | confirmed | https://doi.org/10.1073/pnas.1319030111 |
| Macnamara 2014: 26/21/18/4/<1% variance | confirmed | https://doi.org/10.1177/0956797614535810 |
| VanLehn 2011: human 0.79, ITS 0.76 | confirmed | https://doi.org/10.1080/00461520.2011.611369 |
| Kulik & Fletcher: 50 evaluations, median 0.66 SD, smaller on standardized tests | confirmed | https://doi.org/10.3102/0034654315581420 |
| Wouters 2013: learning d=0.29, retention 0.36, motivation 0.26 ns | confirmed | https://doi.org/10.1037/a0031311 |
| Clark et al.: games g=0.33; augmented designs g=0.34 | confirmed (K-16) | https://doi.org/10.3102/0034654315582065 |
| Koedinger 2015 doer effect >6× | confirmed (single psychology MOOC, correlational with causal-inference methods) | https://doi.org/10.1145/2724660.2724681 |
| Bisra 2018 g=.55 | confirmed (69 ES / 64 reports); N and time-on-task claim unverified | https://eric.ed.gov/?q=%22Inducing+Self-Explanation%22 |
| Mayer 2024: 15 principles | confirmed | https://doi.org/10.1007/s10648-023-09842-1 |
| Crouch 2004 POE; Deslauriers 2019 feeling-of-learning | confirmed | https://doi.org/10.1119/1.1707018 ; https://doi.org/10.1073/pnas.1821936116 |
| Butterfield & Metcalfe G=.36; "PMC review" | corrected label (PMC3079415 = Metcalfe & Finn 2011 experiment, γ=.40); G=.36 unverified | https://pmc.ncbi.nlm.nih.gov/articles/PMC3079415 |
| FSRS KDD 2022: 12.6% gain, 220M logs | corrected attribution: result is for SSP-MMC (MaiMemo), not Anki's FSRS | https://doi.org/10.1145/3534678.3539081 |
| srs-benchmark: 10k users, ~727M reviews, FSRS-7 recency 0.337 / 0.722 | corrected: now 0.336 / 0.724; neural models outrank FSRS | https://github.com/open-spaced-repetition/srs-benchmark |
| FSRS integrated in Anki 23.10 | confirmed | https://github.com/ankitects/anki/releases/tag/23.10 |
| ts-fsrs version | corrected: v5.4.2 (npm, 2026-10-03) | https://www.npmjs.com/package/ts-fsrs |
| Math Academy targets ~80% quiz scores; spaces similar topics during acquisition | confirmed | https://mathacademy.com/how-our-ai-works |
| Silverman & Barasch: 7 studies; repair attenuates broken-streak drop | confirmed | https://doi.org/10.1093/jcr/ucac029 |
| Peru streak RCT 60k students | corrected: grades 4–6 children; IDB working paper (not peer reviewed) | https://doi.org/10.18235/0012912 |
| Reich & Ruipérez-Valiente: 3.13%, 5.63M, 12.67M | unverified (paywalled; landing pages give no numbers); "not improved over 6 years" confirmed | https://tsl.mit.edu/research/the-mooc-pivot/ |

## Gaps the author missed

1. **MC tests can teach the lures.** Reading more MC distractors reduced the testing benefit and increased intrusions of lures as "facts" on a later test ([Roediger & Marsh 2005, JEP:LMC](https://doi.org/10.1037/0278-7393.31.5.1155)). Plausible misconception-based distractors (I0) are only safe with **immediate corrective feedback on every item** and with recall items in the mix. Otherwise the fix for the "longest answer" cue can create false knowledge.
2. **Item-writing guidelines already cover the defect.** The validated taxonomy of 31 MC item-writing rules includes keeping options homogeneous (length included) and balancing key position ([Haladyna, Downing & Rodriguez 2002](https://doi.org/10.1207/S15324818AME1503_5)). Butler's review concludes that the best MC practice for assessment and for learning largely coincide: simple formats, items students usually get right, and items aimed at specific cognitive processes ([Butler 2018, JARMAC](https://doi.org/10.1016/j.jarmac.2018.07.002)). The I0 CI lint should encode these rules, not only skew thresholds.
3. **Testing effect versus element interactivity.** The testing effect may shrink or vanish for high element-interactivity material ([van Gog & Sweller 2015](https://doi.org/10.1007/s10648-015-9310-x)), contested by [Karpicke & Aue 2015](https://doi.org/10.1007/s10648-015-9309-3). KV/roofline/parallelism maths is high-interactivity, so build retrieval items on top of worked-example chains (I7) and measure with cold checks (I11) rather than assuming lab effect sizes.
4. **Productive failure does not help procedures.** PS-I showed no advantage for procedural knowledge (g = −0.03) ([Sinha & Kapur 2021](https://doi.org/10.3929/ethz-b-000490417)). Reserve PF openers (I8) for conceptual "why this design" moments. Teach procedural skills (sizing arithmetic, Rust idioms) with worked examples and practice.
5. **CS-specific evidence is missing.** Subgoal-labelled worked examples improved novice programming performance and transfer ([Margulieux, Guzdial & Catrambone 2012](https://doi.org/10.1145/2361276.2361291)). Parsons problems with distractors took significantly less time than fixing or writing equivalent code, with no significant difference in learning or one-week retention ([Ericson, Margulieux & Rick 2017](https://doi.org/10.1145/3141880.3141895)). Both fit the Rust labs and "spot the bug" items directly and are cheaper to author than full labs.
6. **Immersive 3D is small and conditional, not simply harmful.** Head-mounted VR beat less-immersive instruction by ES = 0.24 across 35 studies, with larger effects for K-12 and against lectures ([Wu, Yu & Gu 2020, BJET](https://doi.org/10.1111/bjet.13023)). The plan's "no game-engine world" call still stands on cost and seductive-detail grounds, but should not cite VR as proven harmful from one N=52 study.
7. **AI-tutor evidence is short-horizon and population-specific.** Kestin measured one-session gains for Harvard physics students. Bastani's guardrailed tutor removed the harm but produced **no significant exam gain** ([PMC12232635](https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/)). A tutor pack (I9) should therefore be justified as harm reduction plus engagement, not as a source of learning gains, until delayed-retention data exist.
8. **Most effect sizes come from children or undergraduates.** Kraft's benchmarks, the Rohrer RCT, Bastani, and the Peru streak RCT are all K-12, and Sinha & Kapur's reversal concerns young learners ([Kraft 2020](https://doi.org/10.3102/0013189X20912798)). No meta-analysis cited here targets working engineers. The plan should label every adult-transfer assumption, and treat the local cold-check data (I11) as the real validation signal.
