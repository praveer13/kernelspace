# Community, social learning, assessment, credentials and learning measurement under a zero-server constraint

Research dossier for kernelspace, compiled 2026-10-03. Scope: what the evidence says about social learning, commitment, assessment and credentials, and which of those mechanisms can run on GitHub Pages, Actions and PRs alone. I did not modify any repo file. Repo facts below come from reading `src/components/QuizBlock.tsx`, `src/lib/progress.ts`, `.github/workflows/*` and the four plan docs.

Tags: **[V]** means verified in this session against the linked source. **[repo]** means read from the kernelspace repo. **[unverified]** means I could not confirm it this session.

---

## 1. Executive summary

The cheapest large improvement is assessment hygiene, ahead of any social feature. **[repo, V]** 230 of 266 quiz questions have `correct: [1]` and none use index 3. `QuizBlock` does not shuffle options, and it stores only one aggregate `quizScore` per lesson. The quizzes therefore measure test-wiseness. They also throw away the per-item and confidence data that would let a learner see their own calibration.

Retrieval practice (g = 0.61) and mastery learning (ES = 0.52) are the most robust effects available. Both are fully local.

Social mechanisms help when they are structured: peer instruction, explaining to others, and calibrated peer review. Light-touch nudges shrink by an order of magnitude at scale. A commitment device can help (+40% completion in a single RCT), but announcing an identity goal in public can reduce effort.

GitHub can carry discussion (Giscus), seasons (scheduled Actions plus Discussions), structured submissions (issue forms with URL prefill) and signed credentials (Open Badges 3.0 VCs plus `actions/attest` Sigstore provenance) with no owned server.

Two warnings for planning. **GitHub Classroom was decommissioned on 2026-08-28.** Peer-to-peer co-op over public relays works, but it is unreliable without TURN.

Relaxing zero-server mainly buys three things: tutoring and vivas without the learner bringing their own key (BYOK), credentials that resist copying (hidden tests), and anonymous outcome data that needs no GitHub account.

---

## 2. Findings

Each finding is written as claim, then evidence, then boundary conditions, then the implication for kernelspace.

### 2.1 Assessment hygiene: the quiz layer is currently gameable, and that comes first

- **Claim.** Answer-position and option-length cues let test-wise learners pass without understanding. Item-writing guidelines require keys spread across positions and options of roughly equal length.
- **Evidence.**
  - **[repo, V]** `grep correct:` over `src/data/lessons` gives `[1]` × 230, `[2]` × 26, `[0]` × 10, `[3]` × 0.
  - **[repo]** `QuizBlock.tsx` renders `options` in authored order with letters A–E and no shuffle.
  - **[repo]** `recordQuizScore(lessonId, score)` keeps only a 0..1 aggregate.
  - **[V]** Haladyna, Downing & Rodriguez (2002, *Applied Measurement in Education* 15:309) validated a 31-rule taxonomy. Two of its rules: place the key "logically and varied in position", and make choices "roughly equal in length" (https://bookdown.org/stefanmosjos/manualesitems/_book/haladyna-2002.html).
- **Boundary.** Shuffling removes the position cue but not the length or qualification cue. "All of the above" and ordered numeric options need fixed order.
- **Implication.**
  1. Shuffle options with a per-attempt seed in `QuizBlock.tsx`. Keep a `fixedOrder?: true` opt-out on `QuizQuestion`.
  2. Add a CI lint, for example `scripts/lint-quizzes.ts`. It should fail on key-position chi-square imbalance per track and flag items whose key is the longest option by more than 30% [threshold is a design choice].
  3. Rewrite distractors so each one encodes a named misconception, such as "GQA reduces FLOPs" or "paging = swapping". This is a content pass that an agent can do with a rubric.
  4. Persist per-question records `{qid, chosen, correct, confidence, ts}` in `progress.ts`. Every later idea in this dossier (calibration, retention probes, spaced review, outcome reports) depends on that record.

### 2.2 Retrieval practice and mastery: the most robust effects, and they run locally

- **Claim.** Practice tests beat restudying and other comparison conditions. Mastery-gated progression raises exam performance, most of all for weaker students.
- **Evidence.**
  - **[V]** Adesope, Trevisan & Sundararajan (2017, *Review of Educational Research*) meta-analysed 118 articles, 272 effect sizes and 15,427 participants [fixed]. Practice tests beat comparison conditions by **g = 0.61** under a fixed-effects model (random-effects g = 0.70; mixed-format practice tests g = 0.80) [fixed] (RER 87:659–701, https://doi.org/10.3102/0034654316689306; the original WSU PDF URL now redirects to a login page, archived copy: https://web.archive.org/web/2023id_/https://education.wsu.edu/documents/2018/01/rethinking-use-tests.pdf/).
  - **[V]** Kulik, Kulik & Bangert-Drowns (1990, *RER* 60:265–299) reviewed 108 controlled evaluations of mastery learning and found **ES = 0.52** [ES value not visible in the abstract; unverified this session]. Effects were stronger for weaker students, and mastery programs "may increase student time on instructional tasks". **The same abstract warns that "self-paced mastery programs often reduce the completion rates in college classes"**, which matters directly for a self-paced course [fixed] (correct DOI https://doi.org/10.3102/00346543060002265; the previously cited DOI 10.2190/FG7X-7Q9V-JX8M-RDJP is a different paper, Kulik & Kulik 1987, "Mastery Testing and Student Learning", J. Educ. Technol. Systems [fixed]).
- **Boundary.** Mastery effects vary with the procedure, and the 1990 data come from classroom programmes. Retrieval effects need retrieval that takes effort, plus feedback. Recognition-only MCQ with guessable keys (§2.1) erodes both.
- **Implication.**
  - The existing ">= 80% pass" rule is a mastery gate, but a weak one, because it can be retried immediately against the same items in the same order.
  - Mastery should be shown on varied items. Give each quiz block an item pool (2–3 isomorphic variants per concept). A retry draws a fresh variant.
  - Add a `numeric` question type for the course's back-of-envelope numbers, such as KV bytes/token, ridge points and $/Mtok. Free recall of numbers is effortful retrieval that cannot be guessed.
  - All of this is zero-server.

### 2.3 Confidence ratings and calibration: cheap, local, and they change what learners attend to

- **Claim.** Asking for confidence alongside each answer improves self-monitoring. Errors made with high confidence are corrected *more* reliably after feedback (the hypercorrection effect).
- **Evidence.**
  - **[V]** Butterfield & Metcalfe (2001): errors committed with high confidence were more likely to be corrected on a retest after feedback than low-confidence errors. The proposed mechanism is attention driven by the surprise (https://pmc.ncbi.nlm.nih.gov/articles/PMC4084803).
  - **[V]** Certainty-based marking (Gardner-Medwin, UCL) scores C = 1/2/3 as +1/+2/+3 when right and 0/−2/−6 when wrong. "Practised students become well calibrated." The method is used at 30+ UK universities [unverified: UCL page returned 403 on re-check] and is built into Moodle (https://www.ucl.ac.uk/lapt/REAP_CBM.htm; https://docs.moodle.org/500/en/Using_certainty-based_marking).
- **Boundary.** Negative marking can raise anxiety. Confidence scoring rewards calibration, so it should feed feedback and not gate XP heavily. Effects are largest when feedback follows quickly.
- **Implication.**
  - Add a three-button confidence row (guess / fairly sure / certain) to each question in `QuizBlock`.
  - After submission, sort the explanations so **high-confidence errors come first**, with a "you were certain — here's the misconception" treatment. That treatment can reuse the `segfault` callout styling.
  - Add a **calibration curve** on `/progress`: % correct per confidence bin across all quizzes. Show it with a Brier score, built with recharts. This is the "learning measurement without telemetry" the learner can actually use.
  - Zero-server: yes.

### 2.4 Peer instruction: structure matters more than the "peer"

- **Claim.** The sequence vote individually → discuss → revote → instructor explanation produces real conceptual learning. It is more than copying.
- **Evidence.**
  - **[V]** Crouch & Mazur (2001, *Am. J. Phys.* 69:970) report normalized FCI gains over 10 years at Harvard that were "regularly twice as large" as with traditional lecture (https://pmc.ncbi.nlm.nih.gov/articles/PMC4353089).
  - **[V]** Smith et al. (2009, *Science* 323:122) checked transfer with an isomorphic second question (Q2). Of the students who were wrong on Q1 and right after discussion, **77% answered Q2 correctly**. Discussion helped even when nobody in the group knew the answer at first.
  - **[V]** Smith et al. (2011): peer discussion **combined with** instructor explanation gave significantly larger gains than either alone.
  - **[V]** Discussion works best when 35–70% are correct on the individual vote.
  - **[V]** High-stakes grading of clicker answers increased "conversation bias" (James 2006, p = 0.008).
  - All per the CBE-LSE review (https://pmc.ncbi.nlm.nih.gov/articles/PMC4353089).
- **Boundary.** The evidence is synchronous and in the classroom. Asynchronous online analogues are less studied. The gains need questions that are actually conceptual and in the 35–70% difficulty band.
- **Implication (asynchronous peer instruction without a server).**
  - Add a `two-stage` quiz mode:
    1. Commit an answer, a confidence rating and a one-sentence rationale.
    2. See 2–3 anonymised rationales for different options. Seed these from authored "student voices", and later from rationales harvested out of Giscus threads with consent.
    3. Revote.
    4. Read the expert explanation.
    5. Answer an isomorphic Q2 (the Smith design) as the real check.
  - The "peer" can also be an agent persona through `AgentActions.tsx` deep links: "argue for option C with me". The lesson markdown in `public/lessons-md` would carry a Socratic peer prompt.
  - Keep the two-stage items low-stakes, XP for participation and not correctness, per James 2006.
  - Zero-server: yes.

### 2.5 Learning by teaching and the protégé effect: real but modest, best with actual explaining

- **Claim.** Explaining to someone else, real or simulated, increases effort and deeper processing. Merely *expecting* to teach gives smaller, shorter-lived benefits.
- **Evidence.**
  - **[V]** Chase, Chin, Oppezzo & Schwartz (2009, *J. Sci. Educ. Technol.* 18:334): students worked harder to learn for a teachable agent than for themselves. Same software, different framing, more time on task and more learning (https://purl.stanford.edu/zm369yx3532).
  - **[V]** Fiorella & Mayer (2013): preparing to teach helped essential processing in the short term. Actually teaching fostered generative processing that matters for long-term learning (https://alexandria.ucsb.edu/lib/ark:/48907/f3ms3qvb).
  - **[V]** Sobering number: the Ribosa & Duran (2022) meta-analysis of *creating teaching materials* found **g = 0.17** (95% CI 0.04–0.31) across 23 studies, as cited by Kobayashi (2023) (https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1095285/full).
- **Boundary.** The effect depends on generative explaining to an audience that asks questions back. Writing a static explainer is weaker.
- **Implication.**
  - Add a "Teach the intern" exercise kind. The learner explains a mechanism, for example why paged KV removes external fragmentation, to an agent persona.
  - The agent is instructed to be a confused JVM/Python engineer with *seeded misconceptions*. It asks follow-ups and may not accept hand-waving.
  - Ship it as an extra prompt in `public/lessons-md/*.md` and as an AGENTS.md rule in lab zips. Do not make it a built-in tutor, which would breach the zero-server rule unless the learner brings a key.
  - The output is an "explanation transcript" saved locally and optionally attached to the portfolio.
  - Zero-server: yes (deep link), or with-caveat (BYOK in page).

### 2.6 Cohort vs self-paced completion: the famous numbers are mostly selection effects

- **Claim.** Cohorts and commitment correlate with far higher completion. The widely quoted "85–95% vs 3%" comparison is not causal evidence.
- **Evidence.**
  - **[V]** Reich & Ruipérez-Valiente (2019, *Science*) covered edX MIT/Harvard courses from 2012–2018: 5.63 M learners and 12.67 M registrations. Completion was **3.13% in 2017–18** (the 2017–18 rate, not a 2012–2018 overall figure; it was ~6% in 2014–15) [fixed]. Among **verified (paid) learners it was 46%** in 2017–18, down from 56% in 2016–17. Only **12%** of 2015–16 first-timers took another MOOC in 2016–17, and the return rate fell to **7% for 2016–17 first-timers** (from 38% for 2012–13) [fixed] (https://www.insidehighered.com/node/7744; paper is *Science* 363(6423), Jan 2019).
  - **[V]** The "cohort courses complete at 85–95%" figures come from vendor and marketing sources, for example learnopoly and HBS Online claims (https://learnopoly.com/cohort-based-learning-statistics/). They compare self-selected, paying, small cohorts with free open enrolment.
- **Boundary.** Paying, intending to finish, and being employer-sponsored all confound the comparison. No RCT isolates "cohort" as a cause in this search [I found none; my web-search budget ran out before a targeted search for instructor-paced vs self-paced RCTs].
- **Implication.**
  - Do not justify cohorts with the 85% figure.
  - The defensible mechanisms are synchronised deadlines, social presence and commitment. kernelspace can supply those as optional "Seasons" (§3) without making the course cohort-only, which would hurt working professionals.

### 2.7 Commitment devices work; light nudges fade at scale; public identity claims can backfire

- **Claim.** A commitment device chosen by the learner can raise completion. Short "plan-making" nudges barely survive scaling. Announcing an identity goal can substitute for doing the work.
- **Evidence.**
  - **[V]** Patterson (2018, *JEBO*), a Stanford MOOC RCT with n = 657: a commitment device (pre-committing to limits on distracting websites) gave **+24% course time, +0.29 SD grade, and a 40% higher completion likelihood**. Reminder and blocking tools had no significant effect (https://www.gwern.net/doc/psychology/personality/conscientiousness/2018-patterson.pdf). Selection caveat from the paper: n = 657 is about 165 per arm, drawn from an 18% participation rate, participants were paid $12, and they were 68% more likely than other enrolees to hold a PhD/MD.
  - **[V]** Kizilcec & Cohen (2017, *PNAS*), mental contrasting with implementation intentions: completion rose from 5.52% to 7.28% (+32%) in experiment 1 and from 25.7% to 29.5% in experiment 2, **only in individualist countries** (https://pmc.ncbi.nlm.nih.gov/articles/PMC5410783).
  - **[V]** Kizilcec et al. (2020, *PNAS*): 269,169 students in 247 courses. Plan-making fell from +3.9 pp in earlier studies to **+0.19 pp / −0.23 pp at scale**, about 20× smaller. It raised early-week engagement but not completion. "Scaling … can reduce their average effectiveness by an order-of-magnitude" (https://pmc.ncbi.nlm.nih.gov/articles/PMC7334459).
  - **[V]** Gollwitzer et al. (2009, *Psych. Sci.* 20:612): identity-related intentions that others noticed were acted on *less*, giving a "premature sense of possessing the aspired-to identity" (https://pubmed.ncbi.nlm.nih.gov/19389130/). Boundary: in Study 3 the effect held only among participants with *strong* commitment to the identity goal, not weak [fixed].
- **Boundary.** Patterson's device bound *behaviour* (time limits), not announcements. The 2020 null shows one-shot prompts are not enough. Support has to recur.
- **Implication.**
  - Build a **behavioural** commitment: a local "study contract" on `/progress`, with weekly minutes, days, a fallback plan ("if I miss Tuesday, then Sunday 9am") and a lab deadline.
  - Re-surface the contract weekly through the existing streak UI and an `.ics` calendar file download, which needs no server.
  - Keep public sharing optional, and phrase it around *artifacts shipped* ("my scheduler passes 6/6 checks"), never identity ("I'm becoming an inference engineer"). This reflects the Gollwitzer finding.

### 2.8 Peer review: usable only with calibration, bias correction and a rubric

- **Claim.** Raw peer grades are noisy. Calibrating graders against exemplars and correcting each grader's bias makes them usable for formative feedback.
- **Evidence.**
  - **[V]** Piech et al. (2013), with 63,199 peer grades from Coursera HCI. Bias and reliability modelling cut RMSE by **33%** (7.95 → 5.30) and **31%** (6.43 → 4.73). The share of grades within 10 pp of staff grades rose from **81% to 95%** and from **88% to 97%**. Bias correction alone gave about 95% of the gain (https://ar5iv.labs.arxiv.org/html/1307.2579).
  - Calibrated Peer Review (Russell 2004) gates reviewers on scoring calibration essays before they review peers (cited via the same search; https://api.crossref.org/works/10.1145%2F3190645.3190684 context). Numbers were not verified this session. [unverified: the cited Crossref DOI is a 2018 ACM paper, not a primary CPR source]
  - **[V]** PeerWise (students author and answer MCQs): active use correlated with exam performance. Authoring helped, and commenting and discussion helped further. The evidence is correlational (https://eprints.gla.ac.uk/35787; https://journals.gre.ac.uk/index.php/msor/article/view/1309).
- **Boundary.** It needs enough reviewers per artifact (Piech used several). Small self-paced populations may not reach that. Correlational PeerWise data carry self-selection bias.
- **Implication.**
  - Fleet Week Act 3's design doc (`FleetWeekProgress.docText`) is the natural object for peer review.
  - Calibration step: the learner scores 3 maintainer-scored exemplar docs and must land within ±1 rubric point before reviewing.
  - Review exchange: a Season-scoped GitHub Discussions category or a `reviews/` directory via PR. An Action computes per-reviewer bias offsets, the Piech PG1-bias model, from overlap with exemplars.
  - **Fallback when peers are scarce:** an AI reviewer with the same rubric, plus the learner's own self-review compared against it, which is another calibration signal.
  - **Learnersourcing:** let learners PR new distractor-rich quiz items, PeerWise-style. CI lints them (§2.1) and the maintainer merges. This also scales the item pools.

### 2.9 AI-conducted oral exams and vivas: feasible and cheap, validity not yet established

- **Claim.** Voice or chat AI examiners can run personalised orals at scale. Grading by a council of several LLMs reaches high inter-rater agreement *among the models*.
- **Evidence.**
  - **[V]** Ipeirotis & Rizakos (NYU Stern, arXiv 2603.18221). The figures below are from **v1 (2026-03-18)**. v1 ran 36 students with a mean of 22 min (9–41 min), and total cost was **$15 ($0.42 per student)**.
  - In v1, grading used a 3-LLM council (Claude, Gemini, GPT-5). Krippendorff's α rose from **0.52 before deliberation to 0.86 after**. 70% of students said the exam "tested my actual understanding", **83% found it more stressful** than written exams, and only 33% found the questions clear.
  - **Update [fixed]:** v3 (2026-07-26) is the author's version of a *Communications of the ACM* paper and adds a second cohort of 37 students (Spring 2026). Post-deliberation α is reported as **0.83 (Fall 2025) and 0.95 (Spring 2026)**. Per-exam grading cost was **$0.29–$0.96** within a voice subscription and about $3.40 above it. After engineering fixes, the share finding it more stressful fell to **63%** and the share finding questions clear rose to **78%**. Gemini stayed about 2–3 points more lenient on a 0–20 scale after deliberation, and a human audit is triggered on about 3% of exams (https://arxiv.org/abs/2603.18221; https://arxiv.org/html/2603.18221v3).
  - Limits the authors state: reliability is shown but validity against blinded expert re-grading is not, there is no subgroup fairness analysis, and accessibility concerns for non-native speakers remain. v1 also noted that students with anxiety accommodations found the format *less* stressful (https://arxiv.org/html/2603.18221v1).
- **Boundary.** Agreement between models is not validity. Stress and accessibility matter. The exam is unproctored when run by the learner's own agent.
- **Implication.**
  - Add a **"Defend your lab" viva** to every Forge lab. AGENTS.md in the zip gets a `/viva` mode in which the agent reads the student's `TODO(you)` diff and asks 5 questions about invariants, failure modes, complexity and the OS≡LLM isomorphism. It scores against a published rubric and emits a signed-off transcript block.
  - Make it **text-first, voice optional**, low-stakes, formative and retryable.
  - Its credential value is "self-attested + transcript", unless D1 or D2 below are taken.
  - Zero-server: yes (learner's agent), or with-caveat (BYOK).

### 2.10 Zero-server social infrastructure: what works in 2026

| Mechanism | Status (verified) | Fit for kernelspace | Caveats |
|---|---|---|---|
| **Giscus** (GitHub Discussions comments) | **[V]** Free; "no tracking, no ads"; data lives in Discussions; mapping by pathname, term or number with strict matching; lazy-load option; self-hostable (https://giscus.app/) | Per-lesson threads at the bottom of `Lesson.tsx`; Discussions doubles as the Q&A forum | Loads a third-party iframe from giscus.app and needs GitHub OAuth to post. Under the no-telemetry rule, render it **click-to-load**. The maintainers say "may break". |
| **GitHub Discussions + scheduled Actions** | Standard GitHub features [V for issue forms; Discussions API via giscus] | Seasons: a cron workflow opens weekly threads and posts summaries | GitHub account required; moderation load on a solo maintainer |
| **Issue forms + URL prefill** | **[V]** YAML forms in `.github/ISSUE_TEMPLATE`; fields prefillable through URL query params; `required` validation only in public repos; GitHub labels the form schema "public preview and subject to change" (https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms; https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue) | "Submit my outcome", "Join Season", "Report a content bug" buttons that prefill from localStorage. **[repo]** The repo has no ISSUE_TEMPLATE today. | Public issues are not anonymous |
| **GitHub Actions as grader** | **[repo]** Already shipped: `validate-leaderboard-submission.yml` runs a trusted-base validator against PR wasm as data | Extend to vivas (transcript schema check), credentials and peer-review aggregation | Proves reproducibility, not originality (NEXT.md §3) |
| **GitHub Classroom** | **[V] Decommissioned 2026-08-28**; sign-ups closed 2026-05-26 (https://github.blog/changelog/2026-08-27-github-classroom-deprecated/) | Do **not** plan on it. NEXT.md §5's file-based classroom becomes the only path, alongside "Classroom 50" (named as an OSS alternative [unverified]) | Instructor adoption needs a "cohort kit" template repo |
| **Zulip / Discord** | **[V]** Zulip sponsors free Cloud Standard for "hundreds of worthy organizations", including OSS projects [fixed: the "1,500+" figure came from a third-party mirror, and Zulip's own page says "hundreds"] (https://zulip.com/help/support-zulip-project) | Zulip web-public streams are searchable and linkable, which suits agent-readable Q&A. Discord is where GPU MODE lives (PLAN.md). | Third-party data, moderation, and not "own server", but still a dependency |
| **Bluesky intent links** | **[V]** `https://bsky.app/intent/compose?text=…`, 300-grapheme limit, user confirms the post (https://www.docs.bsky.app/docs/advanced-guides/intent-links) | "Share artifact" button on lab completion / Fleet Week | Pure client link, no telemetry. Mind §2.7 on identity claims. |
| **Trystero WebRTC P2P** | **[V]** Default matchmaking over public Nostr relays; also BitTorrent, MQTT, IPFS, Supabase, Firebase; session descriptions encrypted with app+room key, optional password; React-friendly; **TURN recommended for peers that cannot connect directly** (https://github.com/dmotz/trystero) | Co-op incident drill: two learners share one deterministic Fleet seed and exchange actions only (`fleet-model.ts` is deterministic, so state syncs as an action log) | Public relays are best-effort. Some NATs fail without TURN, which means a metered or hosted service (decision D3). Peers see each other's IPs. |
| **Yjs y-webrtc** | **[V]** Default public signaling servers reported down or unmaintained in community threads (https://discuss.yjs.dev/t/is-the-public-signaling-server-that-ships-by-default-with-y-webrtc-still-working/1979) | Shared design-doc editing for Act 3 pairs | Prefer Trystero transport + Yjs doc, or skip; CRDTs are overkill for action-log sync |

### 2.11 Credentials: Open Badges 3.0 VCs and Sigstore attestations can be issued from Actions

- **Claim.** Standards-conformant, cryptographically verifiable credentials can be minted by a GitHub Actions workflow and verified offline, with no issuer server.
- **Evidence.**
  - **[V]** W3C **Verifiable Credentials Data Model 2.0 became a W3C Recommendation on 15 May 2025** (https://www.w3.org/TR/vc-data-model-2.0/).
  - **[V]** The **Open Badges 3.0** final spec (document v1.4.5, 2026-06-29) defines badge assertions as VCs. It allows JWT ("VC-JWT") and Linked Data (Data Integrity) proof formats (https://www.imsglobal.org/spec/ob/v3p0/).
  - **[V]** **`actions/attest@v4`** signs in-toto attestations through Sigstore. It supports **custom `predicate-type` + `predicate` JSON**, is available for public repos on all current plans, and needs `id-token: write`, `attestations: write` and `artifact-metadata: write` (https://github.com/actions/attest).
  - **[V]** Public repos use the Sigstore **Public Good** instance, which writes to a public transparency log. Verify with `gh attestation verify` (https://docs.github.com/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds; https://docs.github.com/en/actions/concepts/security/artifact-attestations).
- **Boundary.**
  - An Actions-issued credential certifies "this wasm hash reproduced this score under this validator commit". It does **not** certify authorship, because the public trace is overfittable (NEXT.md §3).
  - OB3 issuer keys would live in Actions secrets, so a solo maintainer must handle rotation.
  - DID-method choice (`did:web` on the Pages domain vs `did:key`) and conformance certification are [unverified] details.
  - Revocation can be a static status-list file on Pages [design inference, not verified against spec].
- **Implication.**
  - Two layers on the existing leaderboard pipeline:
    1. `publish-leaderboard.yml` additionally runs `actions/attest` with predicate `{lab, checks, fleetScore, validatorSha, wasmSha256}` over the submitted wasm. That gives a provenance record on a public log that anyone can check.
    2. A later job signs an **OB3 VC** ("kernelspace Forge: KV Block Manager — CI-verified") with an Ed25519 key from secrets, commits it to `public/credentials/<handle>/<lab>.json`, and adds a static `/verify` page that checks the signature in the browser.
  - Name each credential for what it proves ("CI-verified reproducible"), never "certified expert".
  - Zero-server: yes.

### 2.12 Measuring learning without telemetry

- **Claim.** A learner can be shown real learning evidence (gain, retention, calibration) computed locally. Aggregate course-level evidence needs opt-in submission, and privacy-preserving designs exist.
- **Evidence.**
  - **[V]** Normalized gain g = (post − pre)/(100% − pre) is the physics-education standard used by Crouch & Mazur (https://derekbruff.org/2009/10/23/article-crouch-mazur-2001).
  - **[V]** RAPPOR (Erlingsson, Pihur & Korolova 2014) applies randomized response so each report is ε-differentially private while population frequencies stay estimable (https://arxiv.org/pdf/1407.6981).
  - Retention testing follows from the testing-effect literature (§2.2).
- **Boundary.** Local pre/post with the same items inflates gains because the items are re-exposed, so use parallel forms. Opt-in samples are self-selected. Randomized response needs large n before aggregates are useful, likely hundreds of reports.
- **Implication.**
  1. **Track probes.** At track start, give a 6–8 item, 4-minute pre-probe drawn from form A of the track's item bank. At track end, give form B. 21–30 days later, a "retention ping" (local reminder at next visit) gives form C. `/progress` shows per-track normalized gain and a retention bar.
  2. **Calibration curve** (§2.3).
  3. **Opt-in outcome report.** One button opens a prefilled issue form with *bucketed* values (gain band, retention band, hours/week band, track). Optionally each field passes through randomized response before prefill, with ε stated on the form. A nightly Action parses the issues into `public/outcomes.json` and an `/outcomes` page.
  4. Be explicit on the page that a GitHub issue is **not anonymous**. Anonymity without accounts needs a server or relay (decision D4).

### 2.13 Career conversion: an OSS ladder and interview drills

- **Claim.** Real OSS contributions and public, verifiable artifacts are the hiring signals that kernelspace learners can produce. Newcomer-labelled issues in the target projects exist, but there are not many of them.
- **Evidence.**
  - **[V, gh CLI 2026-10-03]** Open `good first issue` counts: **vllm-project/vllm 21, sgl-project/sglang 49, ai-dynamo/dynamo 7, llm-d/llm-d 1, NVIDIA/TensorRT-LLM 0, huggingface/candle 0** (`gh issue list -l "good first issue" --state open`).
  - The plan docs record that Decart job posts cite GPU MODE KernelBot submissions and that GPU MODE has ~400K submissions (PLAN-WORLDCLASS.md Appendix A; not re-verified here).
- **Boundary.**
  - Good-first-issue (GFI) queues are small and contested. A hundred learners swarming 21 vLLM issues would harm the upstream projects.
  - A Python-heavy vLLM/SGLang codebase sits uneasily with a Rust-native course. Rust upstreams are fewer: candle, mistral.rs, and Rust components in Dynamo/llm-d [unverified per-repo].
- **Implication.**
  - Build an **OSS ladder page** (`/ladder`) in five rungs:
    - R0: reproduce a reported bug locally and write it up.
    - R1: improve docs or an example.
    - R2: add a test or benchmark.
    - R3: claim a GFI.
    - R4: a non-trivial fix in the area of your strongest lab.
  - A weekly scheduled Action refreshes `public/oss-ladder.json` from the GitHub API, filtered by labels and mapped to lessons (for example SGLang radix-cache issues map to the radix-cache lab).
  - Add etiquette rules: comment before claiming, one at a time, no AI-generated drive-by PRs.
  - **Interview drills:** timed system-design prompts that use the Fleet and the T7 calculators, such as "serve a 70B MoE at p99 TTFT < 800 ms for 2k RPS on a fixed budget". A rubric plus an AI interviewer deep link, run in mock-interview mode.
  - Zero-server: yes.

---

## 3. Concrete ideas, ranked by expected learning impact ÷ build effort

Impact and effort are rough estimates (S = days, M = 1–2 weeks agent-assisted, L = more than 2 weeks).

| # | Idea | Touches | Evidence basis | Impact | Effort | Zero-server |
|---|---|---|---|---|---|---|
| 1 | **Quiz integrity pass**: seeded option shuffle, quiz lint in CI (key balance, length cue), distractor rewrite to named misconceptions, per-item records in store | `QuizBlock.tsx`, `progress.ts`, new `scripts/lint-quizzes.ts`, all `src/data/lessons/**` | §2.1, §2.2 | High (unblocks all measurement) | S + content M | yes |
| 2 | **Confidence buttons + calibration curve + hypercorrection-first feedback** | `QuizBlock.tsx`, `Progress.tsx` (recharts) | §2.3 | High | S | yes |
| 3 | **Item pools + `numeric` question type; mastery retry draws a fresh variant** | `types.ts` (`QuizQuestion.variants`, `type: 'numeric'`), QuizBlock | §2.2 | High | M (content-heavy, agent-authorable) | yes |
| 4 | **Track pre/post/retention probes with normalized gain on /progress** | new `src/data/probes/*.ts`, `Progress.tsx`, `Track.tsx` | §2.12 | High (makes learning visible) | M | yes |
| 5 | **Two-stage "vote → rationales → revote → Q2" quiz mode** (async peer instruction; agent or authored peers) | QuizBlock variant, lessons-md prompts | §2.4 | Med-High | M | yes |
| 6 | **"Defend your lab" viva mode** in lab AGENTS.md + rubric + transcript schema; optional attach to leaderboard PR | `labs/*/AGENTS.md`, `pack-labs.py`, `ForgeLab.tsx` | §2.9 | Med-High | S–M | yes / with-caveat (BYOK) |
| 7 | **"Teach the intern" exercise kind** (protégé agent with seeded misconceptions) | `ExerciseKind`, lessons-md, `AgentActions.tsx` | §2.5 | Medium | S | yes |
| 8 | **Study contract (behavioural commitment) + `.ics` export + weekly check-in** | `Progress.tsx`, `progress.ts` | §2.7 | Medium | S | yes |
| 9 | **Seasons via GitHub**: quarterly Season milestone; "Join Season" issue form; cron Action opens weekly Discussions threads, posts anonymised progress digests from opt-in check-ins; Season ends with Fleet Week | `.github/ISSUE_TEMPLATE/*.yml`, new `season.yml` workflow, `/season` page reading `public/season.json` | §2.6, §2.7, §2.10 | Medium | M | yes (GitHub account) |
| 10 | **Giscus per-lesson discussion, click-to-load** | `Lesson.tsx` footer | §2.10 | Medium (Q&A, misconceptions surface) | S | with-caveat (third-party iframe, GitHub OAuth) |
| 11 | **CI-attested results + OB3 credentials + `/verify` page** | `publish-leaderboard.yml`, `public/credentials/`, new `Verify.tsx` | §2.11 | Medium (career) | M | yes |
| 12 | **OSS ladder page fed by a weekly Action** | new workflow, `public/oss-ladder.json`, `/ladder` | §2.13 | Medium (career) | S–M | yes |
| 13 | **Interview drill mode** (timed design prompts on Fleet + T7, rubric, AI interviewer link) | `FleetWeek.tsx` or new `/drills` | §2.13 | Medium | M | yes |
| 14 | **Calibrated peer review of Act 3 docs** (exemplar calibration, then PR-based reviews, bias-corrected by Action; AI fallback) | `FleetWeek.tsx`, `reviews/` dir, workflow | §2.8 | Medium (needs volume) | M–L | yes (GitHub account) |
| 15 | **Learnersourced quiz items via PR** (PeerWise-style; lint + maintainer merge) | CONTRIBUTING, quiz lint | §2.8 | Low-Med (scales item pools) | S once #1 exists | yes |
| 16 | **Opt-in outcome report** (bucketed, optional randomized response) → `public/outcomes.json` | issue form + Action + `/outcomes` | §2.12 | Low for the learner, high for course honesty | S–M | with-caveat (not anonymous) |
| 17 | **Cohort kit for instructors** (template repo: roster CSV, Action that ingests progress exports, class dashboard) replacing GitHub Classroom | new template repo; NEXT.md §5 viewer | §2.10 | Low-Med (institutional reach) | M | yes |
| 18 | **Share-to-Bluesky / portfolio README generator** (artifact-framed) | lab completion modal | §2.7 | Low | S | yes |
| 19 | **Co-op incident drill over Trystero** (action-log sync on a deterministic Fleet seed) | `fleet-model.ts`, new co-op wrapper | §2.4, §2.10 | Med (novel, fun) | L | with-caveat (public relays, NAT; TURN = server) |

Sequencing logic: items 1–4 form one bundle, the "assessment substrate". Without per-item records, every later measurement, peer and credential feature is built on noise. Items 6, 11 and 12 form the career bundle on top of the existing leaderboard pipeline.

---

## 4. Anti-patterns and risks

- **Gameable gates feeding XP.** Today a "B, B, B, B" strategy passes most quizzes and earns quiz XP of 40. Rewarding the gate rewards the cue (§2.1). Fix the items before adding any more incentives.
- **Citing marketing completion numbers.** "85–95% cohort completion" is selection bias (§2.6). Use the 46% figure for verified edX learners as the honest comparison for committed learners.
- **One-shot nudges as strategy.** Effects fall about 20× at scale (Kizilcec 2020). Anything motivational must recur (weekly contract and Season rhythm), not be a single onboarding modal.
- **Public identity announcements.** "I'm becoming an inference engineer" share cards can substitute for effort (Gollwitzer 2009). Share shipped artifacts instead.
- **High-stakes social correctness.** Grading peer-discussion answers on correctness biases the conversation (James 2006). Keep two-stage and peer activities participation-scored.
- **Uncalibrated peer grading.** Raw peer grades are only about 81–88% within 10 pp of staff. Without exemplar calibration and bias correction, peer review misinforms (Piech 2013).
- **AI-viva overclaiming.** Model-to-model α of 0.83–0.95 after deliberation is not validity [fixed]. 63–83% of students across two cohorts found the viva more stressful [fixed], and there are accessibility gaps. Keep vivas formative, text-first and retryable, and never the sole basis of a credential.
- **Credential inflation.** An Actions-signed badge proves reproducibility on a public trace, not authorship or skill. Name it accordingly. Use hidden tests (decision D2) before any "certified" wording.
- **Privacy leaks through "zero-server" tools.** Giscus loads a third-party iframe, Trystero exposes peer IPs, and GitHub issues are public and tied to an identity. Each needs explicit click-to-enable consent copy to stay true to "no telemetry, no accounts".
- **Swarming upstream GFIs.** There are 21 vLLM and 7 Dynamo good-first-issues. A course funnel can burn goodwill with maintainers. Enforce claim etiquette and use the R0–R2 rungs first.
- **Building on decommissioned platforms.** GitHub Classroom is gone (2026-08-28). y-webrtc public signaling is unreliable. Giscus warns that its API may break. Treat every third-party social layer as optional and replaceable.
- **Solo-maintainer moderation load.** Discussions, Seasons and peer review create moderation work. Gate posting categories, use issue-form validation and keep Seasons to at most quarterly.
- **Leaderboard demotivation.** Rank-only public boards can discourage the long tail [general finding; not re-verified here]. Keep personal-best and "beat the reference" as the default view, as PLAN.md already decided.

---

## 5. Decision points where relaxing zero-server would unlock value (for the owner; not decided here)

| ID | Relaxation | Unlocks | Cost / risk | Zero-server alternative and what it loses |
|---|---|---|---|---|
| **D1** | Hosted LLM proxy (owner-paid key, rate-limited) for tutor / viva / teach-back | Keyless tutoring and vivas for everyone; consistent model and rubric; council grading (§2.9; about $0.29–$0.96 per exam for grading within a voice subscription in the NYU study, and about $3.40 above it [fixed]) | Variable spend, abuse, prompt logs, privacy policy, and accounts or quotas needed to stop abuse | Deep links + BYOK (current): reach is limited to learners with a subscription or key, and grading is inconsistent |
| **D2** | Hidden-test grading box (PLAN.md's €7/mo VPS design) | Credentials that resist overfitting and copying ("verified" vs "reproduced"); stronger hiring signal | Running untrusted code in a sandbox, uptime, security patching | Actions + public trace: proves reproducibility only |
| **D3** | TURN relay (for example Cloudflare TURN) or own signaling for co-op | Reliable P2P co-op drills and pair debugging across NATs | Metered bandwidth, abuse, a service to keep alive | Trystero over public Nostr relays: best-effort; some pairs can't connect |
| **D4** | Anonymous outcome-collection endpoint (serverless function + randomized response/DP) | Account-free, larger-n honest outcome stats (gain, retention, completion) | Tiny cost, but it breaks the "no backend" purity and needs a privacy note | GitHub-issue reports: not anonymous, low n |
| **D5** | Hosted community (Zulip Cloud sponsored, or Discord) as official channel | Real-time help, social presence, GPU MODE-style culture | Third-party data, moderation, fragmentation from GitHub Discussions | Discussions + Giscus only: asynchronous, lower social presence |
| **D6** | Human time instead of servers: live Season office hours or cohort kickoffs | The synchronous peer-instruction conditions the evidence actually comes from (§2.4) | Solo-maintainer bandwidth | Asynchronous two-stage questions + AI peers |
| **D7** | Accounts (even OAuth via GitHub) for cross-device progress | Sync, cohort membership, credential-to-person binding | Breaks "no accounts" | JSON export/import (current); credentials bound to a GitHub handle via PR |

---

## 6. Sources

| URL | Title | Date |
|---|---|---|
| https://pmc.ncbi.nlm.nih.gov/articles/PMC4353089 | Vickrey et al., Research-Based Implementation of Peer Instruction: A Literature Review (CBE-LSE) | 2015 |
| https://derekbruff.org/2009/10/23/article-crouch-mazur-2001 | Summary of Crouch & Mazur, Peer Instruction: Ten years of experience and results (AJP 69:970) | 2001 / 2009 |
| https://tipsforteachers.substack.com/p/research-bite-73-why-peer-discussion | Smith et al., Why peer discussion improves student performance… (Science 323:122), summary | 2009 |
| https://purl.stanford.edu/zm369yx3532 | Chase, Chin, Oppezzo, Schwartz, Teachable Agents and the Protégé Effect | 2009 |
| https://alexandria.ucsb.edu/lib/ark:/48907/f3ms3qvb | Fiorella, The Cognitive Benefits of Learning by Teaching and Teaching Expectancy | 2013 |
| https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1095285/full | Kobayashi, opinion on Ribosa & Duran (2022) meta-analysis (g = 0.17) | 2023 |
| https://www.insidehighered.com/node/7744 | Report on Reich & Ruipérez-Valiente, The MOOC Pivot (Science) | 2019 |
| https://tsl.mit.edu/research/the-mooc-pivot/ | MIT TSL, The MOOC Pivot | 2019 |
| https://learnopoly.com/cohort-based-learning-statistics/ | Cohort Based Learning Statistics (marketing source; cited as anti-evidence) | 2023 |
| https://www.gwern.net/doc/psychology/personality/conscientiousness/2018-patterson.pdf | Patterson, Can behavioral tools improve online student outcomes? (JEBO) | 2018 |
| https://pmc.ncbi.nlm.nih.gov/articles/PMC5410783 | Kizilcec & Cohen, Eight-minute self-regulation intervention… (PNAS) | 2017 |
| https://pmc.ncbi.nlm.nih.gov/articles/PMC7334459 | Kizilcec et al., Scaling up behavioral science interventions in online education (PNAS) | 2020 |
| https://pubmed.ncbi.nlm.nih.gov/19389130/ | Gollwitzer et al., When intentions go public (Psych. Sci.) | 2009 |
| https://ar5iv.labs.arxiv.org/html/1307.2579 | Piech et al., Tuned Models of Peer Assessment in MOOCs | 2013 |
| https://eprints.gla.ac.uk/35787 | PeerWise study (Glasgow) | n.d. |
| https://journals.gre.ac.uk/index.php/msor/article/view/1309 | PeerWise: Students creating questions for their peers | n.d. |
| https://arxiv.org/html/2603.18221v1 ; https://arxiv.org/html/2603.18221v3 | Ipeirotis & Rizakos, Scalable and Personalized Oral Assessments Using Voice AI (v3 = author version of CACM paper) [fixed] | 2026-03 / 2026-07 |
| https://doi.org/10.3102/00346543060002265 | Kulik, Kulik, Bangert-Drowns, Effectiveness of Mastery Learning Programs (RER 60:265) [fixed: previous DOI pointed to a different 1987 paper] | 1990 |
| https://education.wsu.edu/documents/2018/01/rethinking-use-tests.pdf/ | Adesope et al., Rethinking the Use of Tests: A Meta-Analysis of Practice Testing (RER) | 2017 |
| https://pmc.ncbi.nlm.nih.gov/articles/PMC4084803 | Fazio & Marsh, Correcting False Memories (summarises Butterfield & Metcalfe 2001, JEP:LMC 27:1491, https://doi.org/10.1037/0278-7393.27.6.1491) [fixed] | 2010 |
| https://www.ucl.ac.uk/lapt/REAP_CBM.htm | Gardner-Medwin, Certainty-based marking | n.d. |
| https://docs.moodle.org/500/en/Using_certainty-based_marking | Moodle docs, Using certainty-based marking | 2025 |
| https://bookdown.org/stefanmosjos/manualesitems/_book/haladyna-2002.html | Haladyna, Downing & Rodriguez (2002) item-writing guidelines | 2002 |
| https://digitalcommons.unf.edu/unf_faculty_publications/1812 | Umapathy & Ritzhaupt, Meta-analysis of pair programming (ACM TOCE 17(4)) | 2017 |
| https://giscus.app/ | giscus | 2026 (live) |
| https://github.blog/changelog/2026-08-27-github-classroom-deprecated/ | GitHub Classroom deprecated | 2026-08-27 |
| https://github.blog/changelog/2026-05-26-github-classroom-sign-ups-are-no-longer-available/ | GitHub Classroom sign-ups no longer available | 2026-05-26 |
| https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms | Syntax for issue forms | live |
| https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue | Creating an issue (URL query prefill) | live |
| https://github.com/dmotz/trystero | Trystero README | live |
| https://discuss.yjs.dev/t/is-the-public-signaling-server-that-ships-by-default-with-y-webrtc-still-working/1979 | Yjs forum: is the public y-webrtc signaling server working? | n.d. |
| https://www.docs.bsky.app/docs/advanced-guides/intent-links | Bluesky Action Intent Links | live |
| https://zulip.com/help/support-zulip-project | Zulip sponsorship (official help center) [fixed] | live |
| https://www.w3.org/TR/vc-data-model-2.0/ | W3C Verifiable Credentials Data Model v2.0 (Recommendation) | 2025-05-15 |
| https://www.imsglobal.org/spec/ob/v3p0/ | 1EdTech Open Badges Specification v3.0 (doc v1.4.5) | 2026-06-29 |
| https://github.com/actions/attest | actions/attest (v4) | live |
| https://docs.github.com/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds | Using artifact attestations to establish provenance | live |
| https://docs.github.com/en/actions/concepts/security/artifact-attestations | Artifact attestations (concepts) | live |
| https://arxiv.org/pdf/1407.6981 | Erlingsson, Pihur, Korolova, RAPPOR | 2014 |
| gh CLI, `gh issue list -l "good first issue" --state open` on vllm-project/vllm, sgl-project/sglang, ai-dynamo/dynamo, llm-d/llm-d, NVIDIA/TensorRT-LLM, huggingface/candle | Live GFI counts | 2026-10-03 |
| Repo: `src/components/QuizBlock.tsx`, `src/lib/progress.ts`, `.github/workflows/validate-leaderboard-submission.yml`, `NEXT.md`, `PLAN.md`, `PLAN-WORLDCLASS.md` | kernelspace internals and prior decisions | 2026-10-03 |

Unverified items flagged in text: the Hake (1998) gains (not used), Classroom 50 details, OB3 DID-method and status-list specifics, per-repo Rust upstream GFI counts, the leaderboard-demotivation general claim, the GPU MODE hiring claims (taken from PLAN-WORLDCLASS.md), and the absence of an RCT isolating cohort effects (my web-search budget ran out before a targeted search).

---

## Verification log

Adversarial fact-check, 2026-10-03. Verdicts: confirmed / corrected / unverified / refuted.

| # | Claim | Verdict | Evidence URL |
|---|---|---|---|
| 1 | 230 of 266 quiz keys are `[1]`, 26 `[2]`, 10 `[0]`, 0 `[3]`; no shuffle; only aggregate `quizScore` (best-of) stored | confirmed (re-grepped; `recordQuizScore` keeps `Math.max(prev, score)`) | repo: `src/data/lessons`, `src/components/QuizBlock.tsx`, `src/lib/progress.ts` |
| 2 | Adesope et al. 2017: g = 0.61, 118 articles, 272 ES, 15,472 participants | corrected: 15,427 participants; 0.61 is fixed-effects (random-effects 0.70); original URL now redirects to a login page | https://web.archive.org/web/2023id_/https://education.wsu.edu/documents/2018/01/rethinking-use-tests.pdf/ ; https://doi.org/10.3102/0034654316689306 |
| 3 | Kulik et al. 1990: 108 evaluations, ES 0.52, stronger for weaker students | corrected: cited DOI is a different 1987 Kulik & Kulik paper; 108 and weaker-student claims confirmed; 0.52 not visible in abstract; omitted caveat that self-paced mastery programs often reduce completion | https://api.crossref.org/works/10.3102/00346543060002265 ; https://api.crossref.org/works/10.2190/FG7X-7Q9V-JX8M-RDJP |
| 4 | Peer instruction: 77% Q2 transfer; 35–70% band; PI + instructor explanation best; James 2006 p = 0.008; Crouch & Mazur "twice as large" | confirmed | https://pmc.ncbi.nlm.nih.gov/articles/PMC4353089 ; https://doi.org/10.1126/science.1165919 |
| 5 | edX 2012–18: 3.13% overall completion; 46% verified; 7% of 2015–16 first-timers returned | corrected: 3.13% is the 2017–18 rate; 12% of 2015–16 first-timers returned; 7% applies to 2016–17 first-timers | https://www.insidehighered.com/node/7744 |
| 6 | Patterson 2018: +24% time, +0.29 SD, +40% completion, n = 657 | confirmed (JEBO 153:293–321); added selection caveats (18% participation, paid, PhD/MD-heavy) | https://www.gwern.net/doc/psychology/personality/conscientiousness/2018-patterson.pdf |
| 7 | Kizilcec et al. 2020: 269,169 students, 247 courses; plan-making +3.9 pp → +0.19 / −0.23 pp; order-of-magnitude quote; early engagement only | confirmed | https://pmc.ncbi.nlm.nih.gov/articles/PMC7334459 |
| 8 | Piech et al. 2013: RMSE −33% / −31%; within-10pp 81→95%, 88→97%; bias ≈ 95% of gain; 63,199 grades | confirmed (EDM 2013) | https://ar5iv.labs.arxiv.org/html/1307.2579 |
| 9 | AI oral exam: 36 students, 22 min, $0.42, α 0.52→0.86, 83% more stressful, no human validation | corrected/outdated: v1 figures accurate, but v3 (2026-07-26, CACM) adds a 37-student cohort with α 0.83 / 0.95, 63% stressed, 78% clear, $0.29–$0.96 per exam; validity vs blinded expert re-grading is still unproven | https://arxiv.org/abs/2603.18221 ; https://arxiv.org/html/2603.18221v3 |
| 10 | GitHub Classroom decommissioned 2026-08-28; sign-ups closed 2026-05-26 | confirmed; some Classroom data (assignment names, tests outside repos, LTI rosters) permanently deleted | https://github.blog/changelog/2026-08-27-github-classroom-deprecated/ ; https://github.blog/changelog/2026-05-26-github-classroom-sign-ups-are-no-longer-available/ |
| 11 | VC DM 2.0 Rec 2025-05-15; OB 3.0 doc v1.4.5 2026-06-29, JWT + Linked Data proofs | confirmed (OB3 aligns with VC DM 2.0 and accepts v1.1 via compatibility schemas) | https://www.w3.org/TR/vc-data-model-2.0/ ; https://www.imsglobal.org/spec/ob/v3p0/ |
| 12 | actions/attest@v4: custom predicate-type/predicate, public repos on all plans, Sigstore Public Good with transparency log | confirmed; private repos need GHEC and use GitHub's instance with no transparency log; GHES unsupported | https://github.com/actions/attest ; https://docs.github.com/en/actions/concepts/security/artifact-attestations |
| 13 | Giscus: no tracking, Discussions storage, lazy load, GitHub OAuth to comment, "may break" warning | confirmed (the warning is about giscus and the Discussions API both still evolving) | https://giscus.app/ |
| 14 | Trystero defaults to Nostr; TURN when pairs can't connect | confirmed; also offers a self-hosted WebSocket relay strategy; IPs exchanged during signaling | https://github.com/dmotz/trystero |
| 15 | Gollwitzer 2009: noticed identity intentions acted on less; premature identity | confirmed; boundary added (effect held only for strongly committed participants, Study 3) | https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=19389130&rettype=abstract&retmode=text |
| 16 | Kizilcec & Cohen 2017: 5.52→7.28% (+32%) and 25.7→29.5%, individualist countries only | confirmed (exp 2 relative +15%) | https://pmc.ncbi.nlm.nih.gov/articles/PMC5410783 |
| 17 | Ribosa & Duran 2022: g = 0.17 (0.04–0.31), 23 studies | confirmed (62 comparisons; Educ. Res. Rev. 37:100475; Kobayashi piece is an opinion article) | https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1095285/full |
| 18 | Butterfield & Metcalfe 2001 hypercorrection; surprise/attention mechanism | confirmed (source page is Fazio & Marsh 2010, not a 2014 summary) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4084803 ; https://doi.org/10.1037/0278-7393.27.6.1491 |
| 19 | Bluesky intent compose URL, 300-grapheme limit, user confirms | confirmed (docs.bsky.app has a TLS cert issue at time of check; verified from the docs repo source) | https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/intent-links.md |
| 20 | Issue forms prefill via URL; `required` only in public repos | confirmed; the form schema is still "public preview and subject to change" | https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema ; https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue |
| 21 | Zulip sponsors Cloud Standard for 1,500+ orgs | corrected: Zulip's own page says "hundreds"; the 1,500+ came from a third-party mirror | https://zulip.com/help/support-zulip-project |
| 22 | Open GFI counts: vLLM 21, SGLang 49, Dynamo 7, llm-d 1, TRT-LLM 0, candle 0 | confirmed (re-run `gh issue list`, 2026-10-03) | gh CLI |
| 23 | Chase et al. 2009 J Sci Educ Technol 18:334; Haladyna et al. 2002 31 rules; Smith 2009 Science 323:122 | confirmed (bibliographic metadata) | https://doi.org/10.1007/s10956-009-9180-4 ; https://doi.org/10.1207/s15324818ame1503_5 |
| 24 | Calibrated Peer Review (Russell 2004) gating | unverified (cited Crossref DOI is not a CPR primary source) | — |
| 25 | CBM scoring +1/+2/+3, 0/−2/−6; 30+ UK universities | unverified (UCL page returned 403 this session; scoring scheme matches Moodle CBM docs from memory only) | https://www.ucl.ac.uk/lapt/REAP_CBM.htm |

## Gaps the author missed

1. **Self-paced mastery gating can lower completion.** Kulik et al.'s (1990) own abstract says "self-paced mastery programs often reduce the completion rates in college classes." kernelspace is self-paced and already has an 80% gate. Item pools and re-gating need a completion guardrail: soft gates, "continue anyway" paths, and tracking drop-off at gates. Source: https://doi.org/10.3102/00346543060002265 (ERIC EJ415887).
2. **Unguarded AI help harms learning, and guardrailed AI tutors can help.** Bastani et al. (2025, *PNAS*) ran a field experiment with about 1,000 students. Unrestricted GPT-4 practice access left students 17% worse once access was removed, and a tutor prompt with guardrails largely removed that harm. Every agent deep link ("Teach the intern", viva, AGENTS.md in labs) needs explicit no-answer-giving guardrails. Source: https://doi.org/10.1073/pnas.2422633122.
3. **Positive RCT for pedagogically designed AI tutors.** Kestin et al. (2025, *Scientific Reports*) found that students learned significantly more, in less time, from an AI tutor built on the same active-learning best practices as the in-class lessons than from the in-class active-learning sessions themselves. This supports investing in carefully scripted tutor prompts over generic chat. Source: https://doi.org/10.1038/s41598-025-97652-6 (PMC12179260).
4. **The viva paper's engineering lessons apply directly to `/viva` design.** v3 of the NYU oral-exam paper gives five lessons:
   - Keep randomization in code; never delegate it to the LLM. Case selection had concentrated at 86% on one option.
   - Validate turns in code. Multi-question turns fell from 31% to 11%.
   - Use a separate agent for each exam phase.
   - Expect model leniency offsets (Gemini scored about 2–3 points of 20 higher).
   - Make a human audit on disagreement (about 3% of exams) a core step.
   
   Source: https://arxiv.org/html/2603.18221v3.
5. **The intervention that survived scaling was value-relevance, not plan-making.** In Kizilcec et al. (2020), a value-relevance writing prompt raised completion by 2.79 pp (year 1) and 2.74 pp (year 2) for learners from less-developed countries in courses with a global achievement gap. Predictive models for targeting interventions did only marginally better than chance. A "why does this matter to your job" prompt is a better-evidenced onboarding item than a one-shot plan. Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC7334459.
6. **The commitment-device evidence does not transfer directly to a "study contract".** Patterson's device committed learners to daily *limits on distracting internet use*. Its sample was self-selected (18% participation, paid, PhD/MD-heavy, about 165 per arm). A weekly-minutes pledge plus `.ics` reminders is an untested analogue, and Patterson's reminder (alert) arm showed no effect. Treat the study contract as an experiment, not an evidence-backed feature. Source: https://www.gwern.net/doc/psychology/personality/conscientiousness/2018-patterson.pdf.
7. **Platform fragility in the GitHub-only stack.**
   - The issue-form schema is still "public preview and subject to change", and `required` works only in public repos.
   - Classroom's shutdown permanently deleted assignment names, tests defined outside repos and LTI rosters. Instructors migrating need their own export in the cohort kit.
   - Artifact attestations are "not a guarantee that an artifact is secure". Private repos get no transparency log and need GHEC, so the credential pipeline must stay in a public repo.
   
   Sources: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema ; https://github.blog/changelog/2026-08-27-github-classroom-deprecated/ ; https://docs.github.com/en/actions/concepts/security/artifact-attestations.
8. **MCQ practice is not the weak link; feedback and format mix are.** In Adesope et al., mixed-format practice tests (MCQ plus short answer) gave the largest effect (g = 0.80), and the random-effects overall was g = 0.70. This supports the dossier's plan to add `numeric` items *alongside* repaired MCQ rather than replacing MCQ. Source: archived PDF https://web.archive.org/web/2023id_/https://education.wsu.edu/documents/2018/01/rethinking-use-tests.pdf/.
