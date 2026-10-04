# Research dossier: computing-education research and how systems/performance expertise forms

*For: the kernelspace "100x learning experience" plan. Compiled 2026-10-03. The repo was read but not modified.*
*Convention: every load-bearing number has a source URL (see §5). [unverified] means I could not open a primary source this session. [repo] means I checked it in the kernelspace repo.*

---

## 1. Executive summary (≤200 words)

Computing-education research points to one main lever: **what the learner does with a representation matters more than how good the representation looks.** In the Hundhausen/Stasko meta-study of 24 experiments, how students used algorithm visualizations mattered more than what the visualizations showed. Naps et al. turned that into an engagement ladder: viewing → responding → changing → constructing → presenting. Kernelspace already has excellent "changing"-level sims. The 100x gains come from the levels it lacks:

- **Predict before you run** (responding).
- **Construct and trace your own code's execution** (constructing).
- **Explain and defend** (presenting/articulation).
- **Assessment that measures understanding.** Today 230 of 266 quiz answers sit at option B [repo].

The best-evidenced, cheapest moves for this audience:

- **Rust:** Crichton's permissions model and Aquascope diagrams (d = 0.56), plus "why doesn't this compile?" items, which discriminate best in the Rust Book.
- **Scaffolding:** Parsons problems, subgoal-labelled PRIMM lab briefs, and napkin-math drills scored on a log scale.
- **Incidents:** drills with a probe budget and a hypothesis log, replacing the current multiple-choice diagnosis.

All of these can run with zero servers.

Generative-AI-era research (Bastani PNAS 2025; Anthropic RCT 2026; Prather ICER 2024) is consistent: unguarded AI help raises practice scores and lowers learning. The agent-native tutoring layer needs an **explanation gate** and **no-AI checks**.

---

## 2. Findings

Format: **Claim → Evidence → Boundary conditions → Implication for kernelspace.**

### F1. Engagement beats visual fidelity

- **Claim.** Visualizations teach through the activity they demand, not through polish.
- **Evidence.**
  - Hundhausen, Douglas & Stasko (2002) meta-analysed 24 experimental studies of algorithm visualization (AV). The strongest predictor of effectiveness was the learner's activity (cognitive constructivism), not the representation: "how students use AV technology has a greater impact on effectiveness than what AV technology shows them." On measurement, the paper found all three knowledge measures got "comparable levels of experimental support"; procedural-only tests "still appear to be somewhat more sensitive" than conceptual ones, but the authors call the result inconsistent and only 3 studies measured conceptual knowledge alone [fixed] ([JVLC 13(3):259–290](https://www.academia.edu/15636659/A_Meta_Study_of_Algorithm_Visualization_Effectiveness); [author PDF](https://faculty.cc.gatech.edu/~john.stasko/papers/jvlc02.pdf)).
  - Naps et al. (ITiCSE WG 2002) argue that visualization "is of little educational value unless it engages learners in an active learning activity." They propose the Engagement Taxonomy: no viewing, viewing, responding, changing, constructing, presenting. Their hypothesis is that outcomes rise with each level. The previously cited Springer links were wrong (one 404s, the other is a different DOI); the primary source is ITiCSE-WGR '02, published in SIGCSE Bulletin 35(2), 2003, [ACM 10.1145/960568.782998](https://doi.org/10.1145/960568.782998) ([open PDF](http://www.cs.hut.fi/Research/svg/publications/exploring_role_of_vis_and_engagement_in_cse.pdf)) [fixed]. Note the report's own summary of Hundhausen's earlier analysis counts 21 experiments, of which only 13 showed a significant effect.
  - Sorva, Karavirta & Malmi (TOCE 2013) reviewed three decades of generic program-visualization systems. Evaluations "largely support" program visualization, the trend is toward more engaging interaction, and most systems are short-lived prototypes ([review PDF](https://romisatriawahono.net/lecture/rm/survey/software%20engineering/Software%20Architecture/Sorva%20-%20Generic%20Program%20Visualization%20Systems%20for%20Introductory%20Programming%20-%202013.pdf)).
- **Boundary conditions.**
  - The meta-study is old (2002), and its studies are mostly CS1/CS2 algorithms.
  - A 2026 study of CS2 learners (N = 12; accepted at ICER 2026) found participants "did not use algorithm visualizations effectively"; the "usage barriers ... to learn advanced topics" finding was about GenAI, not visualization [fixed] ([arXiv 2606.02933](https://arxiv.org/abs/2606.02933)).
- **Implication.**
  - Audit every sim and every `diagram` block against the Naps ladder.
    - Today the `diagram` step-through is **viewing**.
    - The 20 sims with task checklists are mostly **changing**.
    - Nothing in the product is **responding** (predict first) or **presenting** (defend an artifact), except Fleet Week Act III.
  - **3D or game-engine work is justified only when it raises the engagement level.** Examples: the learner places expert shards in a 3D rack topology and sees the all-to-all cost. A prettier particle field does not qualify.

### F2. Notional machines: teach the machine you want learners to simulate

- **Claim.** Learners need an explicit, simplified "machine" (a notional machine) to simulate in their heads. Experts choose which aspects of the real machine to attend to.
- **Evidence.**
  - du Boulay coined the term.
  - Sorva (TOCE 13, 2013, 8:1–8:31) defines notional machines as models of runtime behavior specific to a language or paradigm.
  - Fincher et al. (ITiCSE-WGR 2020, pp. 21–50) give definitional characteristics, a systematic review and teacher-sourced examples, framed as "the education of attention" ([Fincher et al. 2020](https://luce.si.usi.ch/publications/2020-06-01-notional-machines.html)).
- **Boundary conditions.** This is mostly a design framework with little effect-size evidence. Its value is in consistency.
- **Implication.**
  - Kernelspace already has implicit notional machines: the latency walk, the block-table explorer, the scheduler tick, the roofline. Make them **explicit and consistent across tracks**. Each track names one machine, with:
    - a fixed visual vocabulary;
    - a short "rules of the machine" card;
    - a stated list of what it deliberately ignores (honesty about simplification fits the course's rigor constraint).
  - The **isomorphism panel is a notional-machine mapping**, from the OS paging machine to the KV block machine. Upgrade it from a text table to a two-pane synchronized step-through, where one action on the left drives the right.

### F3. Program visualization of the learner's *own* code

- **Claim.** Tools that step through the learner's own program's runtime state (Python Tutor style) get adopted widely, and viewing them builds correct mental models.
- **Evidence.** Online Python Tutor (Guo, SIGCSE 2013) had more than 200,000 users in three years. Instructors at "a dozen universities" used it in CS1, and three embedded textbook projects together drew about 16,000 viewers a month [fixed] ([Guo 2013](https://pg.ucsd.edu/publications/Online-Python-Tutor-web-based-program-visualization_SIGCSE-2013.pdf)).
- **Boundary conditions.** Python Tutor visualizes small programs. Rust lab code runs as wasm with no debugger in the browser.
- **Implication.** Kernelspace owns the ABI (`labs/kit`, `src/lib/wasm-lab.ts`), so it can capture an **event trace** without a debugger:
  - Add an optional `ks_trace_event(kind, a, b, c)` import that student or harness code calls on alloc, free, block allocate, evict and schedule decisions.
  - Replay the trace in the existing sims (`BlockTableExplorer`, `SchedulerLab`, `AllocatorSim`) as a scrubbable timeline next to the reference implementation's trace.
  - A check fails → jump to the first tick where the two traces diverge.

  This is **constructing-level** engagement on the student's own artifact. The Fleet's per-tick conformance machinery already computes the divergence.

### F4. Rust ownership has a researched pedagogy: the permissions model

- **Claim.** Ownership is the main barrier in learning Rust. A conceptual model of Read/Write/Own permissions on paths, with visualizations, measurably improves understanding.
- **Evidence.**
  - Crichton, Gray & Krishnamurthi (OOPSLA 2023) built the *Ownership Inventory* from observed misconceptions. Developers struggled to connect static and dynamic semantics, for example why an ill-typed program would or would not have undefined behavior.
  - They model borrow checking as flow-sensitive R/W/O permissions on paths. The Aquascope compiler plugin draws compile-time permission diagrams and run-time memory diagrams.
  - The new Rust Book ownership chapter improved Ownership Inventory scores by **9% on average (N = 342, d = 0.56)** ([project page](https://cel.cs.brown.edu/paper/ownership-conceptual-model/)). The work is a SIGPLAN Research Highlight ([Brown CS 2025](https://awards.cs.brown.edu/2025/03/04/crichton-gray-and-krishnamurthis-work-on-ownership-types-in-rust-has-been-named-a-sigplan-research-highlight/)).
  - Aquascope is open source ([github.com/cognitive-engineering-lab/aquascope](https://github.com/cognitive-engineering-lab/aquascope/)).
  - Crichton's *The Usability of Ownership* (HATRA 2020) argues the borrow checker is **sound but incomplete**. Learners must be taught to tell real ownership violations from analyzer limitations, and workarounds such as `split_at_mut` are "tacit knowledge that ought to be explicitly taught" ([arXiv 2011.06171](https://arxiv.org/abs/2011.06171)).
  - Zhu et al. (ICSE 2022: 100 Stack Overflow questions plus a survey of 101 Rust programmers) categorize difficulty into move and borrow violations and intra- and inter-procedural lifetime computation ([NSF PAR](https://par.nsf.gov/servlets/purl/10321050)).
  - RustViz (VL/HCC 2022) timelines helped students build accurate mental models in a one-week course unit. The evidence is qualitative ([PDF](https://web.eecs.umich.edu/~comar/rustviz-vlhcc22.pdf)).
- **Boundary conditions.**
  - The effect size is from Rust Book readers who self-selected.
  - Aquascope is MIT-licensed and pins `nightly-2026-05-01` in `rust-toolchain.toml` (last push 2026-05-04; not archived). It self-describes as "research software", so pin it in the build-time tooling rather than tracking nightly [fixed] ([GitHub API](https://github.com/cognitive-engineering-lab/aquascope/blob/main/rust-toolchain.toml)).
- **Implication.**
  - Rewrite R3 (`ownership-and-moves.ts`), R4 (`borrowing-and-slices.ts`), R8 (`interior-mutability.ts`) and R9 (`practical-lifetimes.ts`) around the R/W/O vocabulary.
  - Generate permission diagrams **at build time** (run Aquascope locally, commit SVG/JSON) so the zero-server rule holds.
  - Add one "analyzer limitation vs real UB" lesson segment with the `split_at_mut` and two-phase-borrow patterns.
  - These four lessons are the course's equivalent of the Rust Book's Chapter 4 cliff (F5).

### F5. "Profiling" a course: conceptual items discriminate, and targeted rewrites work

- **Claim.** Item-level data from embedded quizzes finds the hardest concepts, and targeted rewrites fix them.
- **Evidence.** Crichton & Krishnamurthi, *Profiling Programming Language Learning* (OOPSLA 2024, Distinguished Paper):
  - 62,526 readers gave 1,140,202 answers over 13 months.
  - Only about 2% of readers reached Chapter 19, and most serious readers did not get past Chapter 4 (ownership).
  - **10 of 12 targeted interventions had significant effects, averaging +20%.**
  - The most discriminative questions test conceptual understanding ("why does this fail to compile?") rather than compile/no-compile tracing.
  - IRT discrimination correlated only 0.56 with classical item–total correlation.

  Source: [arXiv 2401.01257](https://arxiv.org/abs/2401.01257). The Rust Book experiment site shows the delivery: quizzes with retry and explanations, highlights, Aquascope diagrams ([rust-book.cs.brown.edu](https://rust-book.cs.brown.edu/)).
- **Boundary conditions.** Their data came from server logging. Kernelspace forbids telemetry.
- **Implication.**
  - **The quizzes are the course's measuring instrument, and the instrument is broken today.** 230 of 266 single-answer items are keyed to option B, 26 to C, 10 to A and none to D [repo, `grep correct:` over `src/data/lessons`]. The R3 items are recall ("What does Drop provide?") rather than "why does this fail?".
  - Fix: shuffle options at render with a seeded per-learner permutation; balance option length; add a `code` field to quiz items for "does this compile? if not, why?" items.
  - Profiling without telemetry: an **opt-in "donate my quiz log" PR**, reusing the leaderboard PR + Actions pattern. It submits per-item correctness only, no identity beyond the GitHub handle. A quarterly Action computes item difficulty and discrimination into a public JSON file, and the maintainer rewrites the worst items. Tag: with-caveat (opt-in, small N).

### F6. Parsons problems: same learning, less time; adaptive versions help struggling learners

- **Claim.** Ordering mixed-up code blocks gives learning gains equal to writing the code, in much less time.
- **Evidence.**
  - Ericson, Margulieux & Rick (Koli Calling 2017) and Ericson, Foley & Rick (ICER 2018): students solved Parsons problems **significantly faster than fixing or writing equivalent code**, with **no statistically significant difference** in learning performance or one-week retention. That is a null difference, not a demonstrated equivalence [fixed] ([Koli 2017 abstract via OpenAlex](https://api.openalex.org/works?search=Solving%20parsons%20problems%20versus%20fixing%20and%20writing%20code)).
  - Adaptive variants change difficulty within a problem (merge blocks, remove distractors) or between problems ([GT summary](https://hg.gatech.edu/node/603172)).
  - Haynes & Ericson (CHI 2021) looked at efficiency and cognitive load for adaptive Parsons problems versus writing code.
  - CodeTailor (Hou, Wu, Wang, Ericson, L@S 2024, N = 18, within-subjects) generates personalized Parsons puzzles from a learner's *incorrect* code with an LLM. Learners found it more engaging than being handed solutions and carried more of the scaffolded elements into the post-test ([arXiv 2401.12125](https://arxiv.org/abs/2401.12125)).
  - A 2025 think-aloud study (N = 9): Faded Parsons helped with syntax, Pseudocode Parsons with higher-level reasoning. Drag-and-drop time costs were a complaint ([arXiv 2512.22407](https://arxiv.org/abs/2512.22407)).
- **Boundary conditions.**
  - The evidence is from novices. For experienced Java/Python engineers, Parsons problems pay off on **new semantics** (ownership, orderings, lock discipline), not on syntax.
  - Expertise reversal is documented: techniques "highly effective with inexperienced learners can lose their effectiveness and even have negative consequences" with experienced ones (Kalyuga, Ayres, Chandler & Sweller, *Educational Psychologist* 38(1), 2003, [doi:10.1207/S15326985EP3801_4](https://doi.org/10.1207/S15326985EP3801_4)) [fixed]. Fade quickly.
- **Implication.** A new `parsons` ContentBlock with distractor lines, keyboard reordering for accessibility, and optional fading. Kernelspace-specific uses:
  - **Ownership ordering:** order lines so the program compiles. Distractors are the classic E0502/E0499 placements.
  - **Lock and atomic protocols:** order the steps of a SeqLock writer or a CAS retry loop. Distractors put the Release before the data write.
  - **Scheduler tick:** order admit → schedule prefill chunks → decode step → preempt/evict → free blocks. A wrong order produces a visible block-table leak in `BlockTableExplorer`.
  - **Paged-KV lookup:** logical token → block index → physical block → offset.
  - Fully client-side; tag zero-server: yes.

### F7. Reading and tracing come before writing

- **Claim.** Many learners who "can't problem-solve" cannot reliably read and trace code. Tracing and explaining predict writing ability.
- **Evidence.**
  - The Leeds Group (Lister et al., ITiCSE WG 2004) tested **more than 500 students in 7 countries**. Many were weak at predicting code output and worse at choosing the correct completion of near-complete code ([WG report](https://www.cs.auckland.ac.nz/~j-hamer/ITiCSE04-wg.pdf)).
  - Lopez, Whalley, Robbins & Lister (ICER 2008) found that tracing and "explain in plain English" scores correlate with code writing. Stepwise regression suggests a hierarchy: basics → explaining, Parsons and tracing → writing ([UTS](https://opus.lib.uts.edu.au/handle/10453/10806)).
- **Boundary conditions.** CS1 data. The "hierarchy" is correlational.
- **Implication.**
  - Every Forge lab starts on writing (the `TODO(you)` file).
  - Add a **"read the harness" phase**: 3–5 tracing items on the lab's own `src/lib.rs` checks and the reference trace (for example, "check 4 feeds this trace; which request gets preempted first?").
  - This doubles as preparation for reading production code such as vLLM's scheduler.

### F8. PRIMM / Use–Modify–Create structures the move from reading to writing

- **Claim.** A fixed lesson rhythm of Predict → Run → Investigate → Modify → Make lowers the jump to writing from scratch.
- **Evidence.** Sentance, Waite & Kallia (*Computer Science Education* 29(2–3), 2019) evaluated PRIMM in **13 schools with 493 students aged 11–14**, against a control group, over 8–12 weeks ([Glasgow eprint](https://eprints.gla.ac.uk/229013); [Raspberry Pi summary](https://static.raspberrypi.org/files/curriculum/quickreads/11-Pedagogy_Summary_PRIMM_V4_2023.pdf)). The companion paper reports teachers valued the structure and collaboration ([eprint](https://eprints.gla.ac.uk/229012)).
- **Boundary conditions.**
  - K-12 learners.
  - The abstract of *Teaching computer programming with PRIMM: a sociocultural perspective* states "Learners performed better in the post test than the control group"; it gives no effect size, and the design was mixed-methods, not randomized [fixed] ([doi:10.1080/08993408.2019.1608781](https://doi.org/10.1080/08993408.2019.1608781)).
- **Implication.** Restructure each lab README and `/forge/:lab` page as PRIMM:
  1. **Predict** the reference implementation's outcome on a given trace (ties to F7).
  2. **Run** the reference wasm, which ships compiled.
  3. **Investigate** with the event-trace replay (F3).
  4. **Modify** one parameter, such as block size or watermark.
  5. **Make** the `TODO(you)` file.

  This converts the Forge's single cliff into a ramp at the cost of content only. Zero-server: yes.

### F9. Subgoal labels: modest but stable, and strongest for at-risk learners

- **Claim.** Labelling the purpose of each step in worked examples (subgoals) improves problem solving and reduces dropout.
- **Evidence.**
  - Margulieux, Guzdial & Catrambone (2012) and follow-ups found subgoal-oriented instruction improved later problem solving. Results depend on the design of the materials ([GSU](https://scholarworks.gsu.edu/items/530e13c6-feb5-4b72-844f-9184f5ddbe9d)).
  - Morrison, Margulieux & Decker (*CSE* 30(2):127–154, 2020) aggregated three studies and report "a stable effect size" for subgoal labels. Given labels worked best with greater transfer distance; learner-constructed labels worked best with closer transfer ([UNO](https://digitalcommons.unomaha.edu/compscifacpub/76)).
  - Margulieux, Morrison & Decker (*IJ STEM Ed* 2020): in a semester-long course with 265 students, half receiving subgoal-oriented instruction, the subgoal group did better on formative quizzes but not on summative exams. The subgoal group **was less likely to fail or withdraw, with no statistically significant difference in average exam scores** and lower exam-score variance ([doi:10.1186/s40594-020-00222-7](https://doi.org/10.1186/s40594-020-00222-7); [DOAJ record](https://doaj.org/article/9a2c85d66fd54ec9ab019e9a510bbf17)). The exact failure and withdrawal percentages are [unverified].
- **Boundary conditions.** Effects are modest, inconsistent in some replications, and concentrated in struggling learners.
- **Implication.** The kernelspace population is self-studying professionals who drop out silently, which is the population where subgoals help most.
  - Give every lab brief and every `deepdive` worked example explicit subgoal headers. For the allocator: (1) find the candidate block; (2) split; (3) record the header; (4) on free, locate neighbours; (5) coalesce; (6) restore the invariant.
  - **Map each subgoal to a check-id**, so a red check names the failed subgoal.
  - Later labs fade to learner-written labels (for example, the `radix-cache` brief asks the learner to write their own subgoals before coding).
  - Pure content. Zero-server: yes.

### F10. Error messages: enhancement has mixed evidence; borrow errors need a conceptual model

- **Claim.** Rewriting error text alone helps inconsistently. Explanations linked to a model help more.
- **Evidence.**
  - Becker (SIGCSE 2016, the Decaf editor): enhanced javac messages reduced total errors and errors per student ([UCD](https://researchrepository.ucd.ie/entities/publication/d4b1c9ce-e7ff-48e7-b9b9-f0ebe0c15e8e)).
  - Denny, Luxton-Reilly & Carpenter (ITiCSE 2014): enhanced syntax errors "appear ineffectual" ([Auckland](https://researchspace.auckland.ac.nz/handle/2292/43268?show=full)).
  - Becker et al. (ITiCSE-WGR 2019) mapped the contested landscape.
  - Leinonen et al. (SIGCSE 2023): LLM explanations of error messages were novice-friendly and *sometimes* beat the originals in interpretability and actionability ([arXiv 2210.11630](https://arxiv.org/abs/2210.11630)).
- **Boundary conditions.** rustc's messages are already unusually good. The difficulty is conceptual (F4), not wording.
- **Implication.** Build an **"Error Museum"** page or `deepdive` series for the roughly 8 borrow and lifetime errors that the Rust Zero drills trigger (E0382, E0499, E0502, E0505, E0506, E0597, E0716, `RefCell` BorrowMutError).
  - Each entry has the error, an R/W/O permission diagram (F4), the real fix and the tempting wrong fix (`.clone()` everywhere).
  - Add an "ask the agent" template that pastes the error with the rule *explain the violated permission; don't fix it*.
  - Zero-server: yes.

### F11. Explain-in-Plain-English (EiPE), now LLM-gradable

- **Claim.** Explaining code's *purpose* (relational level) is a distinct skill that predicts writing. LLMs make it gradable at scale.
- **Evidence.**
  - EiPE correlates with writing ([Lopez et al. 2008](https://opus.lib.uts.edu.au/handle/10453/10806)).
  - Smith & Zilles (full paper ITiCSE 2024, [doi:10.1145/3649217.3653582](https://doi.org/10.1145/3649217.3653582); a SIGCSE 2024 poster preceded it) [fixed] proposed **code-generation-based grading**: an LLM generates code from the student's explanation, and unit tests run on it. Agreement with human graders was **moderate**, mainly because the method is too lenient on line-by-line descriptions ([arXiv 2311.14903](https://arxiv.org/abs/2311.14903)).
  - Denny et al. (ITiCSE 2024) combine EiPE with prompting: students learn comprehension and prompt-crafting together ([arXiv 2403.06050](https://arxiv.org/abs/2403.06050)).
  - Denny et al.'s *Prompt Problems* (SIGCSE 2024) generalize this ([arXiv 2311.05943](https://arxiv.org/pdf/2311.05943)).
- **Boundary conditions.** Grading needs an LLM, so BYOK or a local model. Leniency toward line-by-line answers must be countered with a rubric that penalizes them.
- **Implication.** A new `explain` block. The learner writes a ≤3-sentence purpose statement for a snippet (vLLM-style `can_allocate`, a radix-tree eviction loop).
  - **Default, zero-server:** self-assessment against a rubric of 3 required ideas plus model answers.
  - **Optional BYOK:** the explanation is turned into **JavaScript** and run against the course's existing JS reference implementations, since kernelspace already keeps JS references for conformance. Tag: with-caveat (needs the learner's key or WebLLM).

### F12. GenAI-era learning: performance rises while learning falls, unless help is gated

- **Claim.** Unrestricted AI help raises task performance and lowers durable learning. Debugging skill suffers most. Guardrails and conceptual-inquiry habits reverse much of the loss.
- **Evidence.**

| Study | Design | Result |
|---|---|---|
| Prather et al. ITiCSE-WGR 2023 | 71-paper review, survey across 20 countries, 22 educator interviews | Field-level map of LLM impact and advice ([arXiv 2310.00658](https://arxiv.org/abs/2310.00658)) |
| Kazemitabaar et al. CHI 2023 | 69 learners aged 10–17, Codex vs none | 1.15x completion and 1.8x scores while authoring; one-week retention not harmed (non-sig. gain); learners with more prior knowledge retained significantly better ([arXiv 2302.07427](https://arxiv.org/abs/2302.07427)) |
| Prather et al. ICER 2024, "Widening Gap" | 21 lab sessions with eye tracking | Strong students accelerate; struggling students get "illusions of competence" and compounded metacognitive difficulties ([arXiv 2405.17739](https://arxiv.org/abs/2405.17739)) |
| Bastani et al. PNAS 2025 | ~1,000 grade 9–11 math students at one Turkish high school, field RCT | Practice +48% (GPT Base) and +127% (GPT Tutor); after access was removed, **−17%** for GPT Base; guardrailed tutor largely mitigated the harm ([CHIBE](https://chibe.upenn.edu/publications/generative-ai-without-guardrails-can-harm-learning-evidence-from-high-school-mathematics)) |
| Anthropic RCT, Jan 2026 (Shen & Tamkin, arXiv preprint, **not peer-reviewed**) [fixed] | 52 mostly junior engineers learning Trio (async Python) | Quiz 50% with AI vs 67% without, **d = 0.738, p = 0.01**; biggest gap on **debugging** questions; AI group was only ~2 min faster, not significant; quiz taken immediately after the task, so long-term retention is untested; high scorers used conceptual inquiry, hybrid code-plus-explanation or generate-then-comprehend, low scorers delegated or debugged with AI ([Anthropic](https://www.anthropic.com/research/AI-assistance-coding-skills); [arXiv 2601.20245](https://arxiv.org/abs/2601.20245)) |
| Sankaranarayanan 2026 (preprint, N = 78) | Manual vs unrestricted AI vs AI with an "Explanation Gate" (teach-back before integrating code) | AI-blackout maintenance task failure 77% (unrestricted) vs 39% (gated); initial task performance similar ([arXiv 2602.20206](https://arxiv.org/abs/2602.20206)) — **not peer-reviewed** |
| Yong, Estey, Nacenta 2026 (N = 12, CS2; accepted ICER 2026) | GenAI vs visualization vs live tutoring | Live tutoring highest learning; GenAI raised self-efficacy more but learning less ([arXiv 2606.02933](https://arxiv.org/abs/2606.02933)) |

- **Boundary conditions.** The populations differ (K-12, novices, juniors). Kernelspace learners are professionals who will use AI at work anyway, and the Anthropic RCT is the closest match. Small N in the 2026 studies.
- **Implication.** Kernelspace's agent-native tutoring (lab-zip `AGENTS.md`/`CLAUDE.md`, "ask claude" links) already says "never write the solution" [repo `labs/AGENTS.md`]. That is necessary but not enough.
  1. **Explanation gate in `AGENTS.md`.** Before giving any hint, the agent asks the student to state which check fails, which invariant it encodes and their current hypothesis. Hints come only after the student articulates. This applies cognitive-apprenticeship "articulation" (F18).
  2. **Blackout check.** After a lab turns green, the lab page asks 3 no-AI questions about the student's *own* uploaded code, generated from the wasm export list and harness metadata. Example: "Your allocator passes check 5 (coalescing). Which neighbour is merged first and why?" These are self-graded against the reference explanation, with XP only for the honest attempt.
  3. **"Debug, don't delegate" framing** on Fleet Week Act IV, since debugging shows the largest AI-induced gap.
  4. Teach **AI interaction patterns as content.** One `callout` per track shows the high-scoring patterns (conceptual inquiry, generate-then-comprehend) against the low-scoring ones (delegation, iterative AI debugging).

### F13. Threshold concepts: find the liminal points and over-invest there

- **Claim.** Some concepts are transformative, irreversible, integrative, bounded and troublesome (Meyer & Land 2003). Learners stall in a "liminal" state and mimic understanding.
- **Evidence.**
  - The characteristics are summarized in [Wikipedia: Threshold knowledge](https://en.wikipedia.org/wiki/Threshold_knowledge).
  - In computing, Boustedt et al. (SIGCSE 2007) asked "Threshold concepts in computer science: do they exist and are they useful?". Object-oriented programming (and pointers [unverified]) were candidates ([ACM](https://unpaywall.org/10.1145%2F1227310.1227366)).
- **Boundary conditions.** Threshold-concept identification is interpretive, with little effect-size evidence. Its use is as a curriculum-design lens.
- **Implication.** Candidate threshold concepts for kernelspace (my analysis), each with a "liminal tell":

| Candidate | Where | Liminal tell (diagnostic item) |
|---|---|---|
| Indirection / virtual addressing (page table ≡ block table) | T1, T2 VM, T5 PagedAttention | Can predict what fragmentation *disappears* and what new cost appears (table lookup, TLB/block-table misses) |
| Bandwidth-bound vs compute-bound (arithmetic intensity) | T0 memory walk, T4 roofline, T5 prefill/decode | Predicts that batching decode raises throughput almost linearly *until* the ridge point, and says why prefill doesn't benefit |
| KV cache **is** memory management | T5 KV math, prefix caching, T6 disaggregation | Treats "context length" as a capacity-planning variable; explains preemption as eviction |
| Queueing: utilization → latency nonlinearity, tail latency | T2 scheduler, T5 batching, T7 SLO | Predicts p99 blowing up near ρ→1 before the mean moves; explains goodput vs throughput |
| Aliasing XOR mutability (ownership) | R3–R4, T3 | Explains *why* a rejected program would be UB, or recognizes analyzer incompleteness (F4) |
| Happens-before (memory ordering) | R10, T2, lab 04 | Rejects "SeqCst makes it immediately visible" (F14) |

  Over-invest at these six points: double the `predict`/`parsons`/napkin density, add spaced revisits in later tracks (for example, the roofline returns in T6 FP4 and T7 cost), and use the liminal-tell items as gates for track badges.

### F14. Documented misconceptions give better distractors

- **Claim.** Multiple-choice items diagnose only when the distractors encode real misconceptions.
- **Evidence.**
  - Mara Bos, *Rust Atomics and Locks* ch. 3 "Common Misconceptions", lists six. Among them: strong ordering makes changes "immediately" visible; disabling optimization or using a non-reordering CPU removes the need to care; Relaxed operations are free; SeqCst is always correct; SeqCst enables a "release-load" ([mara.nl](http://mara.nl/atomics/memory-ordering.html)).
  - The disconnect between static and dynamic semantics in ownership is documented in Crichton et al. 2023 (F4).
  - Classic concurrency preconception studies, for example Kolikant 2001 "Gardeners and cinema tickets", are [unverified this session].
- **Implication.** Rewrite the R10 quiz (`atomics-and-orderings.ts`: today "When is Relaxed sufficient?" and similar) so each distractor is one of Bos's six. The same applies to lab 04 `mpmc-queue` pre-checks. Add a `misconception` tag to `QuizQuestion` so the opt-in item analytics (F5) can report which misconceptions persist.

### F15. Expertise is chunked, perceptual pattern knowledge

- **Claim.** Experts recall and recognize meaningful structure (chunks), not syntax. They organize knowledge by function.
- **Evidence.**
  - McKeithen et al. (1981): experts recalled normally-ordered programs far better than scrambled ones and had programming-semantic knowledge organization. Novices used common-language associations ([UMich](https://deepblue.lib.umich.edu/items/1d548813-cc8c-4d00-bc3b-ef1cbd11ed0d)).
  - Adelson (1981): novices group code by syntax, experts by function (summarized in the same source).
- **Boundary conditions.** Old lab studies on code recall. Transfer to telemetry is my extrapolation.
- **Implication.** Performance experts recognize **signatures**: the sawtooth of KV preemption, head-of-line blocking in TTFT, the flat TPOT plus rising queue delay of an admission-limited system, a memory-bound kernel's position on the roofline. Build a **"Signatures" drill**:
  - a 5–10-second glance at a `TelemetryGrid` sparkline set or flame graph (generated deterministically from `fleet-model.ts`), then name the pathology;
  - interleaved and spaced;
  - fed by the same fault generator as F17.
  - Zero-server: yes.

### F16. Back-of-the-envelope estimation is a trainable skill and should be scored on a log scale

- **Claim.** Systems experts estimate before measuring. Estimates should be judged by order of magnitude.
- **Evidence.**
  - Norvig's "Teach Yourself Programming in Ten Years" timing table: L1 0.5 ns, branch mispredict 5 ns, main memory 100 ns, read 1 MB sequential from memory 250 µs, and so on ([norvig.com](https://norvig.com/21-days.html)).
  - Eskildsen's **napkin-math** collects first-principles techniques plus a newsletter of practice problems. Its numbers are **re-measured with Criterion.rs benchmarks on GCP**: the rows that can be refreshed on a single host were re-measured on `c4-standard-48-lssd` on 2026-03-08, so other rows such as network and cloud were not re-measured on that host. The numbers are "rounded for memorization" and the author finds it "highly unlikely" any is more than "2–3x off", with the goal of being "within an order of magnitude". The March 2026 table gives sequential memory read 20 GiB/s, random 3 GiB/s, sequential SSD 8 GiB/s, random SSD 70 MiB/s ([github.com/sirupsen/napkin-math](https://github.com/sirupsen/napkin-math)).
  - Fermi-problem pedagogy is long-standing in physics education ([arXiv search sample](https://arxiv.org/search/?query=Fermi+estimation+students&searchtype=all)). I did not find an effect-size study this session [unverified].
- **Implication.** A `napkin` ContentBlock plus a `/drills` page:
  - **Prompt:** for example, "KV bytes per token, Llama-3-70B (GQA-8), FP8" or "decode tok/s ceiling on one B200 for a 70B FP8 model at batch 1".
  - **Answer:** a number plus a 90% confidence interval.
  - **Score:** `err = |log10(estimate/true)|`; full marks ≤ 0.15 (≈1.4x), partial ≤ 0.5 (≈3x), zero > 1.0 (10x). **Calibration** = the fraction of true values inside the learner's 90% intervals over time, shown on `/progress`.
  - **Sources:** every "true" value carries a source and a `verified` date, reusing the `field-note` discipline. The anchor deck follows napkin-math's style but with LLM-serving numbers (HBM bandwidth, NVLink, RDMA, FLOPs per token, KV bytes per token).
  - Spaced repetition of anchors in the zustand store. Zero-server: yes.

### F17. Troubleshooting is taught by method and rehearsal, not by recognition

- **Claim.** Expert performance debugging is a *method*: scientific debugging, USE, drill-down. It is rehearsed through role-play on realistic broken systems.
- **Evidence.**
  - USE method: "For every resource, check utilization, saturation, and errors", which Gregg says "solves about 80% of server issues with 5% of the effort". That is his personal estimate ("I find it..."), not a measured figure; do not present it as data ([brendangregg.com](https://www.brendangregg.com/usemethod.html)).
  - Gregg catalogs **anti-methods**: Streetlight, Drunk Man, Random Change, Blame-Someone-Else, Passive Benchmarking, Traffic Light ([methodology](https://www.brendangregg.com/methodology.html)).
  - Zeller's scientific debugging: hypothesis → prediction → experiment → observation → conclusion, kept in a **debugging log**, with "diagnosis before fix" ([debuggingbook.org](https://www.debuggingbook.org/html/Intro_Debugging.html)).
  - Google SRE "Wheel of Misfortune": a game master picks primary and secondary on-call, announces a page, and the team works through mitigation. Also: breaking or fixing *real* systems, on-call learning checklists, and postmortem reading clubs ([SRE book ch. 28](https://sre.google/sre-book/accelerating-sre-on-call/)).
  - SadServers gives learners a broken Linux box to fix ([i-programmer](https://i-programmer.info/news/80-java/15914-sadservers-a-playground-for-sres-admins-and-devops-engineers.html)).
- **Boundary conditions.** Little controlled research on these in education. The evidence is practitioner consensus.
- **Implication.** **Today Act IV is recognition:** 3 incidents, pick the cause and the mitigation from lists [repo `src/pages/FleetWeek.tsx` L382–460]. Upgrade to **Incident Mode 2.0**:
  - **Probe budget.** Each telemetry panel or metric "costs" time from an SLO-burn clock. Learners must choose what to look at, which teaches USE ordering and penalizes Streetlight.
  - **Hypothesis log.** Required before acting, in Zeller format. The log is graded: did the learner's probes test their hypotheses?
  - **Seeded fault generator.** Faults are injected into `fleet-model.ts` (KV thrash, hot expert, prefix-cache poisoning, straggler rank, fragmentation creep, admission misconfiguration), giving unlimited deterministic drills that feed F15 signatures.
  - **Game-master mode for study groups.** One person loads a seed and narrates, the others diagnose, and the seed file is shared. Zero-server: yes.
  - **Postmortem library.** Curated public LLM-serving postmortems as `field-note` cards, as a "postmortem reading club".

### F18. Cognitive apprenticeship and legitimate peripheral participation

- **Claim.** Expertise in a craft is learned by making expert *thinking* visible (modeling), followed by coaching, scaffolding that fades, articulation, reflection and exploration (Collins, Brown & Newman 1989). It is also learned by participating at the periphery of a real community of practice (Lave & Wenger 1991).
- **Evidence.**
  - The six methods are summarized in Collins' own slides ([ISLS](https://www.isls-naples.psy.uni-muenchen.de/intro/all-webinars/collins/cognitive-apprenticeship.pdf)). Lave & Wenger (1991, CUP) is a book, not re-fetched.
  - **OSS on-ramps have shrunk recently.** Across 37 repos and 406k issues (Jul 2021 – Jun 2025), the share of "good first issue" labels fell significantly from Jan 2024, and newcomer GFI PR merge rates fell from **61.9% to 42.2%** (Hoshikawa et al. 2026 preprint, [arXiv 2604.27532](https://arxiv.org/abs/2604.27532)).
  - Expert mentoring on GFIs correlates with successful contributions but *negatively* with newcomer retention (Tan et al., ICSE 2023, 48,402 GFIs in 964 repos, [arXiv 2302.05058](https://arxiv.org/abs/2302.05058)).
- **Implication.**
  - **Modeling:** "Expert replays", scripted step logs of an expert solving a Fleet incident or profiling a lab, annotated with their thinking at each step. These are worked examples with subgoals (F9).
  - **Articulation:** the explanation gate (F12) and EiPE (F11).
  - **Reflection:** after each lab, a side-by-side diff of the learner's event trace against the reference (F3).
  - **Exploration:** Fleet free play with self-set goals.
  - **OSS apprenticeship ladder:**
    1. reproduce a published benchmark;
    2. file a well-evidenced issue;
    3. docs/test PRs;
    4. a good-first-issue PR in vLLM, SGLang, mistral.rs, candle, llm-d or similar;
    5. a feature PR.
  - Given the shrinking GFI supply and falling merge rates, steps 1–3 must carry most of the weight. Keep a quarterly-refreshed `public/oss-ladder.json` via an Actions job against the GitHub API. Tag: with-caveat (rate limits, curation).

### F19. Interactive articles: affordances are real, and most readers skip optional interactivity

- **Claim.** Interactive articles help through five affordances, but interactivity that is optional is often ignored.
- **Evidence.** Hohman, Conlen, Heer & Chau (Distill 2020) name five affordances: connecting people and data, making systems playful, prompting self-reflection, personalizing reading, and reducing cognitive load. They cite evidence for self-explanation prompts and segmenting, an unresolved animation-vs-static debate, and a NYT report that "only a fraction of readers interact" with non-static content ([Distill](https://distill.pub/2020/communicating-with-interactive-articles/)).
- **Implication.**
  - Make the key interactions **inline and gating** (a prediction is required to reveal the next `diagram` step), not "open the simulator" buttons.
  - Prefer **segmented step-through** to continuous animation, which supports the existing `diagram` design.
  - **Personalize** by background: a placement result (Java vs Python vs C) selects which analogies the `callout` blocks show.

---

## 3. Concrete ideas, ranked by expected learning impact ÷ build effort

Effort: S ≈ ≤3 agent-days, M ≈ 1–2 weeks, L ≈ 3+ weeks (solo maintainer plus agents). Impact is my judgement from the evidence above.

| # | Idea | Touches | Evidence | Impact | Effort | Zero-server |
|---|---|---|---|---|---|---|
| 1 | **Quiz integrity pass.** Render-time seeded shuffle; length-balanced options; rewrite items into "why does this fail/slow down?" form with misconception distractors; add `code` and `misconception` fields to `QuizQuestion` | `src/components/QuizBlock.tsx`, all lesson `.ts` files, `types.ts` | F5, F14; 230/266 keyed B [repo] | High (every other metric depends on valid assessment) | S (shuffle) + M (rewrites) | yes |
| 2 | **`predict` block.** Commit a numeric or choice prediction before a `diagram` step or sim run reveals; store calibration | new block in `types.ts`, `blocks.tsx`, `DiagramBlock` | F1 (responding), F19, F7 | High | S–M | yes |
| 3 | **Explanation gate plus blackout check.** Teach-back rules in lab `AGENTS.md`/`CLAUDE.md`; 3 post-green no-AI questions about the learner's own solution | `labs/AGENTS.md`, `labs/CLAUDE.md`, `ForgeLab.tsx`, `wasm-lab.ts` | F12 (d = 0.738 gap; 77% vs 39% preprint) | High | S | yes |
| 4 | **PRIMM plus subgoal-labelled lab briefs.** Predict/Run/Investigate/Modify/Make phases; subgoals mapped 1:1 to check-ids; fade to learner-written subgoals in labs 06–08 | 8 lab READMEs, `src/data/labs.ts`, `ForgeLab.tsx` | F8, F9, F7 | High (targets silent dropout at the Forge cliff) | M (content) | yes |
| 5 | **Permissions-model rewrite of R3/R4/R8/R9** with build-time Aquascope-style diagrams and "analyzer limit vs UB" segment; Error Museum | `src/data/lessons/r/*`, new `deepdive`s | F4 (d = 0.56), F10 | High (the Ch.-4 cliff) | M | yes (build-time tooling) |
| 6 | **`parsons` block**: ownership ordering, CAS/SeqLock protocols, scheduler-tick order, paged-KV lookup; adaptive fading | new block, R-track and T2/T5 lessons | F6 | Med–High | M | yes |
| 7 | **Napkin-math drills.** `napkin` block plus `/drills`; log-error scoring; 90% CI calibration; spaced anchor deck with sourced, dated numbers | new block, `progress.ts`, new page | F16, F13 | High for this audience (the core systems-design skill) | M | yes |
| 8 | **Incident Mode 2.0.** Probe budget; hypothesis log; seeded fault generator in `fleet-model.ts`; GM mode via shared seed file; postmortem `field-note`s | `FleetWeek.tsx`, `fleet-week.ts`, `fleet-model.ts` | F17, F12 (debugging gap) | High | M–L | yes |
| 9 | **Signatures drill.** Glance-and-name telemetry and flame-graph pathologies, interleaved and spaced, using the #8 generator | new drill mode, `TelemetryGrid` | F15 | Med | S–M (after #8) | yes |
| 10 | **Trace your own wasm.** Optional `ks_trace_event` import; replay in BlockTableExplorer, SchedulerLab or AllocatorSim; first-divergence jump vs reference | `labs/kit`, `wasm-lab.ts`, sims | F3, F1 (constructing), F18 (reflection) | High | L | yes |
| 11 | **Threshold-concept spine.** Tag 6 liminal lessons; liminal-tell items gate track badges; spaced revisits in later tracks | `tracks.ts`, achievements, lessons | F13 | Med–High | S–M | yes |
| 12 | **`explain` (EiPE) block.** Self-assessment rubric by default; optional BYOK or WebLLM code-generation grading against existing JS references | new block; reuse BYOK plan in NEXT.md §4 | F11 | Med | M | with-caveat (key or local model) |
| 13 | **Synchronized isomorphism step-through.** One action drives OS-machine and LLM-machine panes | `isomorphism` block upgrade | F2, F1 | Med | M | yes |
| 14 | **Expert replays.** Annotated, step-scrubbable think-aloud logs of an expert diagnosing or profiling | new `replay` block | F18 (modeling), F9 | Med | M (authoring heavy) | yes |
| 15 | **Opt-in learning-profile donation** via PR; quarterly item analysis (difficulty, discrimination, misconception persistence) driving rewrites | Actions workflow, `public/item-stats.json` | F5 (+20% from targeted rewrites) | Med (small N) | M | with-caveat (opt-in, privacy review) |
| 16 | **OSS apprenticeship ladder** with quarterly Action-refreshed curated issues for vLLM, SGLang, mistral.rs, candle and similar | new page, `public/oss-ladder.json` | F18 | Med (high for top ~5% of learners) | M | with-caveat (API limits, curation) |
| 17 | **3D only where spatial structure is the concept.** For example, a rack/NVLink-domain topology where learners *place* experts or shards and see all-to-all cost; a memory-hierarchy "distance" walk | reuse three/r3f deps already present | F1 (engagement > fidelity) | Med if interactive; ~0 if decorative | L | yes |

**Sequencing.**

1. **First, #1–#3.** They are cheap and fix measurement and the AI-crutch risk.
2. **Then #4–#7**, the core pedagogy at the cliffs.
3. **Then #8–#10**, the expert-formation layer.
4. **Then #11–#17.**

---

## 4. Anti-patterns and risks

1. **Decorative 3D or animation as "100x".** The meta-study evidence says use matters more than looks (F1). A 3D fleet view that the learner only watches is "viewing" level. Every 3D feature must involve a learner decision whose consequence is computed by the calibrated model.
2. **Optional interactivity.** Only a fraction of readers interact with optional elements (F19). Gate key interactions inline.
3. **Gameable assessment feeding gamification.** XP and ranks currently reward quiz passes that a position bias can game (230/266 at B). Fix the instrument before adding more rewards. Reward calibrated, spaced mastery, not completion counts.
4. **AI as crutch.** Agent links and BYOK tutoring without an explanation gate reproduce the Bastani (−17%) and Anthropic (50% vs 67%) results. Debugging, the course's capstone skill, showed the biggest gap.
5. **Multiple-choice incident drills train recognition, not diagnosis.** Today's Act IV shows a list of candidate causes. That is the "traffic light" anti-method in disguise. Switch to probe-budget investigation.
6. **Over-scaffolding experts (expertise reversal; Kalyuga et al. 2003, see F6) [fixed].** Parsons problems, worked examples and subgoals are best evidenced for novices. Kernelspace learners are professionals: make scaffolds skippable via placement and fade fast.
7. **LLM grading leniency.** Code-generation grading is too lenient on line-by-line explanations (F11). Never award mastery XP on LLM grades alone, and keep a rubric with required ideas.
8. **Telemetry creep.** The Crichton profiling loop is powerful but depends on logging. Keep it strictly opt-in via PR, aggregate-only and documented. Do not add analytics SDKs.
9. **Stale numbers in napkin drills.** Napkin answers age quickly (B200 → B300 → Rubin). Every "true" value needs a source and a `verified` date, and the quarterly field-notes cycle must cover the drill deck.
10. **Visualization adoption friction at advanced levels.** Advanced learners resisted algorithm visualizations (F1 boundary). Sims must answer a question the learner already has, for example "why did my check 4 fail?" (F3), not be offered generically.
11. **Overclaiming the evidence.** Many findings are CS1, K-12 or small-N. Among the 2026 studies, the Anthropic RCT (arXiv 2601.20245), Sankaranarayanan and Hoshikawa are preprints; only Yong et al. is peer-reviewed (ICER 2026, N = 12) [fixed]. The plan should present effects as directional and measure its own outcomes locally, for example lab attempts-to-green before and after the PRIMM briefs, as PLAN-WORLDCLASS §2.4 already proposes.
12. **OSS ladder disappointment.** Newcomer GFI merge rates fell to 42.2% in the 2026 study. Do not promise contributions. Make reproductions and evidence-quality issues the credentialed rungs.

---

## 5. Sources

| # | Title | URL | Date |
|---|---|---|---|
| 1 | Hundhausen, Douglas, Stasko — A Meta-Study of Algorithm Visualization Effectiveness (JVLC 13(3)) | https://www.academia.edu/15636659/A_Meta_Study_of_Algorithm_Visualization_Effectiveness | 2002 |
| 2 | Naps et al. — Exploring the role of visualization and engagement in CS education (ITiCSE-WGR '02; SIGCSE Bulletin 35(2)) [fixed] | https://doi.org/10.1145/960568.782998 ; open PDF http://www.cs.hut.fi/Research/svg/publications/exploring_role_of_vis_and_engagement_in_cse.pdf | 2002 (pub. 2003) |
| 3 | Sorva, Karavirta, Malmi — A Review of Generic Program Visualization Systems for Introductory Programming Education (TOCE) | https://romisatriawahono.net/lecture/rm/survey/software%20engineering/Software%20Architecture/Sorva%20-%20Generic%20Program%20Visualization%20Systems%20for%20Introductory%20Programming%20-%202013.pdf | 2013 |
| 4 | Fincher et al. — Notional Machines in Computing Education: The Education of Attention (ITiCSE-WGR) | https://luce.si.usi.ch/publications/2020-06-01-notional-machines.html | 2020 |
| 5 | Guo — Online Python Tutor (SIGCSE) | https://pg.ucsd.edu/publications/Online-Python-Tutor-web-based-program-visualization_SIGCSE-2013.pdf | 2013 |
| 6 | Crichton, Gray, Krishnamurthi — A Grounded Conceptual Model for Ownership Types in Rust (OOPSLA) | https://cel.cs.brown.edu/paper/ownership-conceptual-model/ | 2023 |
| 7 | Brown CS — SIGPLAN Research Highlight | https://awards.cs.brown.edu/2025/03/04/crichton-gray-and-krishnamurthis-work-on-ownership-types-in-rust-has-been-named-a-sigplan-research-highlight/ | 2025-03-04 |
| 8 | Aquascope repository | https://github.com/cognitive-engineering-lab/aquascope/ | accessed 2026-10 |
| 9 | Crichton, Krishnamurthi — Profiling Programming Language Learning (OOPSLA, Distinguished Paper) | https://arxiv.org/abs/2401.01257 | 2024 |
| 10 | Experimental Rust Book (Brown CEL) | https://rust-book.cs.brown.edu/ | accessed 2026-10 |
| 11 | Crichton — The Usability of Ownership (HATRA) | https://arxiv.org/abs/2011.06171 | 2020 |
| 12 | Zhu et al. — Learning and Programming Challenges of Rust (ICSE) | https://par.nsf.gov/servlets/purl/10321050 | 2022 |
| 13 | Almeida et al. — RustViz (VL/HCC) | https://web.eecs.umich.edu/~comar/rustviz-vlhcc22.pdf | 2022 |
| 14 | Ericson et al. — Parsons problems efficiency and adaptive Parsons (GT dissertation summary) | https://hg.gatech.edu/node/603172 | 2017–2018 |
| 15 | Hou, Wu, Wang, Ericson — CodeTailor (L@S) | https://arxiv.org/abs/2401.12125 | 2024 |
| 16 | Haynes-Magyar — Exploring Variations of Parsons Problems as Scaffolding | https://arxiv.org/abs/2512.22407 | 2025-12 |
| 17 | Lister et al. — A Multi-National Study of Reading and Tracing Skills (ITiCSE WG) | https://www.cs.auckland.ac.nz/~j-hamer/ITiCSE04-wg.pdf | 2004 |
| 18 | Lopez, Whalley, Robbins, Lister — Relationships between reading, tracing and writing skills (ICER) | https://opus.lib.uts.edu.au/handle/10453/10806 | 2008 |
| 19 | Sentance, Waite, Kallia — Teaching computer programming with PRIMM (CSE 29(2–3)) | https://eprints.gla.ac.uk/229013 ; https://static.raspberrypi.org/files/curriculum/quickreads/11-Pedagogy_Summary_PRIMM_V4_2023.pdf | 2019 |
| 20 | Margulieux, Morrison et al. — subgoal labels (GSU collection) | https://scholarworks.gsu.edu/items/530e13c6-feb5-4b72-844f-9184f5ddbe9d | 2012–2016 |
| 21 | Morrison, Margulieux, Decker — The curious case of loops (CSE 30(2)) | https://digitalcommons.unomaha.edu/compscifacpub/76 | 2020-01 |
| 22 | Margulieux, Morrison, Decker — Reducing withdrawal and failure rates… (IJ STEM Ed) | https://doaj.org/article/9a2c85d66fd54ec9ab019e9a510bbf17 | 2020-05 |
| 23 | Becker — An effective approach to enhancing compiler error messages (SIGCSE) | https://researchrepository.ucd.ie/entities/publication/d4b1c9ce-e7ff-48e7-b9b9-f0ebe0c15e8e | 2016 |
| 24 | Denny, Luxton-Reilly, Carpenter — Enhancing syntax error messages appears ineffectual (ITiCSE) | https://researchspace.auckland.ac.nz/handle/2292/43268?show=full | 2014 |
| 25 | Leinonen et al. — Using LLMs to Enhance Programming Error Messages (SIGCSE) | https://arxiv.org/abs/2210.11630 | 2023 |
| 26 | Smith & Zilles — Code Generation Based Grading for EiPE (ITiCSE; SIGCSE poster) [fixed] | https://arxiv.org/abs/2311.14903 ; https://doi.org/10.1145/3649217.3653582 | 2024 |
| 27 | Denny et al. — Explaining Code with a Purpose (ITiCSE) | https://arxiv.org/abs/2403.06050 | 2024 |
| 28 | Denny et al. — Prompt Problems (SIGCSE) | https://arxiv.org/pdf/2311.05943 | 2024 |
| 29 | Prather et al. — The Robots are Here (ITiCSE-WGR) | https://arxiv.org/abs/2310.00658 | 2023 |
| 30 | Prather et al. — The Widening Gap (ICER) | https://arxiv.org/abs/2405.17739 | 2024 |
| 31 | Kazemitabaar et al. — Studying the effect of AI Code Generators on Supporting Novice Learners (CHI) | https://arxiv.org/abs/2302.07427 | 2023 |
| 32 | Bastani et al. — Generative AI without guardrails can harm learning (PNAS 122) | https://chibe.upenn.edu/publications/generative-ai-without-guardrails-can-harm-learning-evidence-from-high-school-mathematics ; https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html | 2025 |
| 33 | Anthropic — How AI assistance impacts the formation of coding skills (paper: Shen & Tamkin, "How AI Impacts Skill Formation", arXiv preprint) | https://www.anthropic.com/research/AI-assistance-coding-skills ; https://arxiv.org/abs/2601.20245 | 2026-01-29 |
| 34 | Sankaranarayanan — Mitigating "Epistemic Debt"… Metacognitive Scripts (preprint) | https://arxiv.org/abs/2602.20206 | 2026-02/03 |
| 35 | Yong, Estey, Nacenta — CS2 Learning with GenAI, Visualization, and Human Support | https://arxiv.org/abs/2606.02933 | 2026 |
| 36 | Threshold knowledge (Meyer & Land framework summary) | https://en.wikipedia.org/wiki/Threshold_knowledge | accessed 2026-10 |
| 37 | Boustedt et al. — Threshold concepts in computer science: do they exist and are they useful? (SIGCSE) | https://unpaywall.org/10.1145%2F1227310.1227366 | 2007 |
| 38 | Bos — Rust Atomics and Locks, ch. 3 Memory Ordering (Common Misconceptions) | http://mara.nl/atomics/memory-ordering.html | 2023 |
| 39 | McKeithen et al. — Knowledge organization and skill differences in computer programmers | https://deepblue.lib.umich.edu/items/1d548813-cc8c-4d00-bc3b-ef1cbd11ed0d | 1981 |
| 40 | Norvig — Teach Yourself Programming in Ten Years (timing table) | https://norvig.com/21-days.html | 2001–2014 |
| 41 | Eskildsen — napkin-math | https://github.com/sirupsen/napkin-math | numbers 2026-03 |
| 42 | Gregg — The USE Method | https://www.brendangregg.com/usemethod.html | accessed 2026-10 |
| 43 | Gregg — Performance Analysis Methodology (anti-methods) | https://www.brendangregg.com/methodology.html | accessed 2026-10 |
| 44 | Zeller et al. — The Debugging Book, Introduction to Debugging | https://www.debuggingbook.org/html/Intro_Debugging.html | accessed 2026-10 |
| 45 | Google SRE Book ch. 28 — Accelerating SREs to On-Call and Beyond | https://sre.google/sre-book/accelerating-sre-on-call/ | 2016 |
| 46 | SadServers coverage | https://i-programmer.info/news/80-java/15914-sadservers-a-playground-for-sres-admins-and-devops-engineers.html | 2022 |
| 47 | Collins — Cognitive Apprenticeship (slides; Collins, Brown & Newman 1989) | https://www.isls-naples.psy.uni-muenchen.de/intro/all-webinars/collins/cognitive-apprenticeship.pdf | 1989 / n.d. |
| 48 | Hoshikawa et al. — A Longitudinal Analysis of Good First Issue Practices (preprint) | https://arxiv.org/abs/2604.27532 | 2026 |
| 49 | Tan et al. — Is It Enough to Recommend Tasks to Newcomers? | https://arxiv.org/abs/2302.05058 | 2023 |
| 50 | Hohman, Conlen, Heer, Chau — Communicating with Interactive Articles (Distill) | https://distill.pub/2020/communicating-with-interactive-articles/ | 2020 |
| 51 | Becker, Denny et al. — Compiler Error Messages Considered Unhelpful (ITiCSE-WGR) | https://arxiv.org/pdf/2210.11630 (cites); record via https://researchspace.auckland.ac.nz/handle/2292/43268 | 2019 |

*Not re-verified this session (labelled in text): the exact subgoal withdrawal and failure percentages, Kolikant 2001 concurrency preconceptions, Boustedt's specific candidate list beyond OOP, an effect-size study of Fermi-estimation training, Lave & Wenger 1991 (book). The fact-check resolved these: the PRIMM direction, expertise reversal and Aquascope's licence and toolchain (see the Verification log).*

---

## Verification log

*Adversarial fact-check, 2026-10-03. Checked against primary abstracts, full texts and repositories. Verdicts: confirmed / corrected / unverified / refuted.*

| # | Claim | Verdict | Evidence URL |
|---|---|---|---|
| 1 | Hundhausen, Douglas & Stasko 2002: meta-study of 24 experiments; how students use AV matters more than what it shows | confirmed (abstract quoted verbatim) | https://faculty.cc.gatech.edu/~john.stasko/papers/jvlc02.pdf |
| 1b | "Procedural tests more sensitive than conceptual" | corrected: the paper calls the measures comparable and the result inconsistent; procedural only "somewhat more" sensitive, with 3 conceptual-only studies | https://faculty.cc.gatech.edu/~john.stasko/papers/jvlc02.pdf (§5.2.1) |
| 2 | Naps et al. engagement taxonomy (6 levels); "of little educational value unless it engages learners in an active learning activity" | confirmed; the cited source URL was **wrong** (Springer 404 and an unrelated DOI) and is replaced | http://www.cs.hut.fi/Research/svg/publications/exploring_role_of_vis_and_engagement_in_cse.pdf |
| 3 | Crichton, Gray & Krishnamurthi OOPSLA 2023: +9% avg, N = 342, d = 0.56 | confirmed (also SIGPLAN and CACM Research Highlight) | https://cel.cs.brown.edu/paper/ownership-conceptual-model/ ; https://willcrichton.net/ |
| 4 | Profiling PL Learning: 62,526 readers, 1,140,202 answers, 13 months; 10/12 interventions significant, avg +20%; conceptual "why" items better; most triers stop by Ch. 4; 2% (1,220) reach Ch. 19; r–α correlation 0.56; Distinguished Paper | confirmed | https://arxiv.org/html/2401.01257 ; https://willcrichton.net/ |
| 5 | Parsons problems: same gains as fix/write, significantly less time (Ericson 2017; Ericson, Foley, Rick 2018) | corrected (nuance): significantly faster, but "no statistically significant difference" in learning, which is not proven equivalence; 2017 co-authors are Margulieux & Rick; the cited GT page is a 2018 PhD defense notice (secondary) | https://hg.gatech.edu/node/603172 ; https://api.openalex.org/works?search=Solving%20parsons%20problems%20versus%20fixing%20and%20writing%20code |
| 6 | Lister et al. 2004: >500 students, 7 countries, weak at tracing and especially at choosing completions; Lopez et al. 2008 tracing and EiPE correlate with writing | confirmed (N = 556 answered all 12 MCQs) | https://www.cs.auckland.ac.nz/~j-hamer/ITiCSE04-wg.pdf ; https://opus.lib.uts.edu.au/handle/10453/10806 |
| 7 | Subgoals: fewer failures and withdrawals, no exam-mean difference (Margulieux, Morrison, Decker 2020); "stable effect size" (Morrison et al. 2020) | confirmed; added N = 265 and the quiz-vs-exam split; exact percentages still unverified | https://doi.org/10.1186/s40594-020-00222-7 ; https://digitalcommons.unomaha.edu/compscifacpub/76 |
| 8 | Anthropic RCT Jan 29 2026: 52 mostly junior engineers, Trio, 50% vs 67%, d = 0.738, p = 0.01, debugging gap largest, conceptual inquiry scored high | confirmed; added that it is an **arXiv preprint (Shen & Tamkin), not peer-reviewed**, has no significant speed gain and used an immediate quiz only | https://www.anthropic.com/research/AI-assistance-coding-skills ; https://arxiv.org/abs/2601.20245 |
| 9 | Bastani et al. PNAS 2025: ~1,000 students; +48% / +127% on practice; −17% after removal (GPT Base); guardrails largely mitigate | confirmed (Turkey, grades 9–11, one school) | https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635 |
| 10 | Smith & Zilles CGBG: moderate agreement, too lenient on line-by-line | confirmed; **venue corrected** from SIGCSE 2024 to ITiCSE 2024 (SIGCSE 2024 was a poster) | https://arxiv.org/abs/2311.14903 ; https://doi.org/10.1145/3649217.3653582 |
| 11 | napkin-math: Criterion.rs, GCP re-measurement, rounded, ≤2–3x off, order-of-magnitude goal; table values | confirmed; precision added (only single-host rows re-measured, c4-standard-48-lssd, 2026-03-08) | https://github.com/sirupsen/napkin-math |
| 12 | USE method definition; "80% of server issues with 5% of the effort" | confirmed as a quote; it is Gregg's personal estimate ("I find"), not measured | https://www.brendangregg.com/usemethod.html |
| 13 | SRE Wheel of Misfortune (GM, primary and secondary on-call, page announced); postmortem reading clubs | confirmed (ch. 28) | https://sre.google/sre-book/accelerating-sre-on-call/ |
| 14 | GFI labelling declined from Jan 2024; newcomer GFI merge 61.9% → 42.2%; 37 repos; 2021–2025; preprint | confirmed (406,826 issues, 1,117 newcomer PRs; v2 June 2026; still a preprint) | https://arxiv.org/abs/2604.27532 |
| 15 | Quizzes: 230/266 keyed to index 1, 26 to 2, 10 to 0, none to 3 | confirmed by re-running the grep; no shuffle logic in `QuizBlock.tsx` | repo: `grep -rhoE 'correct:\s*\[[0-9, ]+\]' src/data/lessons` |
| 16 | Yong, Estey, Nacenta 2026: visualization hard to adopt for advanced algorithms | corrected: the abstract says AVs were "not used effectively"; the barriers to learning advanced topics were with GenAI; accepted at ICER 2026 | https://arxiv.org/abs/2606.02933 |
| 17 | Guo 2013: >200k users in 3 years, "dozen-plus" universities, ~16k viewers/month | corrected: "a dozen universities"; 16k/month across three textbook projects | https://pg.ucsd.edu/publications/Online-Python-Tutor-web-based-program-visualization_SIGCSE-2013.pdf |
| 18 | Aquascope licence and nightly status (was [unverified]) | corrected: MIT; pinned `nightly-2026-05-01`; last push 2026-05-04 | https://github.com/cognitive-engineering-lab/aquascope |
| 19 | PRIMM quantitative result (was [unverified]) | corrected: the abstract states the experimental group outperformed control on the post-test; no effect size given | https://doi.org/10.1080/08993408.2019.1608781 |
| 20 | Kazemitabaar CHI 2023: 69 learners aged 10–17; 1.15x completion, 1.8x scores; retention not harmed | confirmed | https://arxiv.org/abs/2302.07427 |
| 21 | Prather ITiCSE-WGR 2023: 71 papers, 20 countries, 22 interviews; Prather ICER 2024: 21 sessions with eye tracking | confirmed | https://arxiv.org/abs/2310.00658 ; https://arxiv.org/abs/2405.17739 |
| 22 | Sankaranarayanan 2026: N = 78, 77% vs 39% blackout failure, preprint | confirmed (preprint, rev. 2026-03-31) | https://arxiv.org/abs/2602.20206 |
| 23 | Bos: six misconceptions, as listed | confirmed | http://mara.nl/atomics/memory-ordering.html |
| 24 | Hohman et al.: five affordances; NYT "only a fraction of readers interact" | confirmed | https://distill.pub/2020/communicating-with-interactive-articles/ |
| 25 | Norvig table values (0.5 ns, 5 ns, 100 ns, 250 µs) | confirmed | https://norvig.com/21-days.html |
| 26 | Gregg's six anti-methods | confirmed | https://www.brendangregg.com/methodology.html |
| 27 | CodeTailor L@S 2024, N = 18 | confirmed | https://arxiv.org/abs/2401.12125 |
| 28 | Expertise reversal (was [unverified]) | confirmed with a primary source | https://doi.org/10.1207/S15326985EP3801_4 |
| 29 | Tan et al. 2023: mentoring correlates with success | confirmed; added the omitted negative correlation with retention | https://arxiv.org/abs/2302.05058 |
| 30 | Zhu et al. ICSE 2022: 100 SO questions, 101 surveyed | unverified (venue confirmed via artifact; counts not re-opened) | https://par.nsf.gov/servlets/purl/10321050 |

## Gaps the author missed

1. **Retrieval practice and spacing are the highest-utility techniques in the learning-science literature.** Dunlosky et al. (2013) rate practice testing and distributed practice "high utility" and rereading and highlighting "low". Kernelspace's reading-heavy lessons should treat quizzes as *learning events* with spaced re-tests, not only as end-of-lesson checks. Source: https://doi.org/10.1177/1529100612453266
2. **Productive failure supports "predict before you run" and incident drills directly.** A meta-analysis of 53 studies (166 comparisons) found problem-solving-then-instruction beat instruction-first for conceptual learning, g = 0.36 (0.37–0.58 with high-fidelity PF design). The direction reverses for very young learners and domain-general skills. Source: https://doi.org/10.3102/00346543211019105
3. **ICAP (Chi & Wylie 2014) is the modern, more general successor to the Naps ladder.** Passive < Active < Constructive < Interactive. The plan should classify features by ICAP mode as well as by Naps, because ICAP covers text, labs and AI dialogue, not only visualizations. Source: https://doi.org/10.1080/00461520.2014.965823
4. **Game evidence is modest and depends on design, which matters for the 3D/game-engine question.** Serious games beat conventional instruction on learning (d = 0.29) and retention (d = 0.36) but were *not* more motivating (d = 0.26, n.s.). Gains were larger when games were supplemented with instruction, spread over multiple sessions and played in groups (Wouters et al. 2013). Clark et al. (2016) found g = 0.33 for games vs non-games, and design features moderated effects more than the medium did. Sources: https://doi.org/10.1037/a0031311 ; https://doi.org/10.3102/0034654315582065
5. **The gamification meta-analysis gives a realistic ceiling for XP and ranks.** Effects were g = 0.49 on cognitive outcomes, 0.36 on motivational and 0.25 on behavioral (Sailer & Homner 2020), and only the cognitive effect held up in high-rigor studies. Game fiction and competition combined with collaboration helped behavioral outcomes. The "100x" framing is not supported by any single lever. Source: https://doi.org/10.1007/s10648-019-09498-w
6. **The counter-evidence on AI tutoring should shape the AI tutor's design.** A Harvard physics RCT found students learned significantly more, in less time, from a pedagogically designed AI tutor than from in-class active learning (Kestin et al. 2025). Together with Bastani, this shows that *design* (guardrails, scaffolded prompts) decides the sign of the effect. Source: https://doi.org/10.1038/s41598-025-97652-6
7. **Step-level tutoring nearly matches human tutoring, and "2-sigma" is a myth.** VanLehn (2011) found human tutoring d = 0.79 and step-based ITS d = 0.76, not the believed d = 2.0. This supports investing in step-level feedback, such as per-check and per-subgoal hints in the Forge, over answer-level feedback, and it calibrates "100x" expectations. Source: https://doi.org/10.1080/00461520.2011.611369
8. **Answer-position bias is a documented psychometric problem, which strengthens quiz-integrity item #1.** Test makers hide correct answers in middle positions and test takers seek them there, at ratios up to 3–4:1. Items keyed to a middle position are "easier and less discriminating" (Attali & Bar-Hillel 2003, *J. Educational Measurement*). Kernelspace's 230/266 keys at index 1, a middle position, are the worst case: scores partly measure position-guessing and item discrimination is depressed. Fix it with a render-time seeded permutation and re-baseline any stored scores. Source: https://doi.org/10.1111/j.1745-3984.2003.tb01099.x
