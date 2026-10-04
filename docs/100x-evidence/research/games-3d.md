# Research dossier: Games, 3D and explorable explanations for kernelspace

Date: 2026-10-03. Scope: learning-science evidence on games, 3D, immersion and simulations; game and explorable exemplars; how feasible the 2026 web tech is for kernelspace (React 19 + Vite, three@0.185.1, @react-three/fiber@9.6.1, drei@10.7.7, the deterministic `src/lib/fleet-model.ts`, Rust→wasm labs, GitHub Pages only). No repo file was modified.

Labels: **[V]** = checked this session against the source URL given. **[S]** = taken from a secondary source or search abstract, not the primary PDF. **[unverified]** = from memory, not confirmed this session.

---

## 1. Executive summary

In the evidence, game form itself adds a modest amount (d ≈ 0.3). The design choices around it matter far more. Four moderators in the 2013 and 2016 meta-analyses decide whether kernelspace's game layer helps: multi-session play (g 0.44 vs 0.08 for one session), schematic visuals (g 0.48 vs −0.01 for realistic), game rules that *are* the concept (intrinsic integration gave more learning and 7× voluntary time on task), and pairing the game with instruction. Immersion hurts on its own: in VR, presence went up (d = 1.30) and learning went down (d = 0.80), and decorative "seductive details" cost about g = −0.33. Simulations with scaffolding show the largest effect (g = 0.85), and kernelspace already has that asset in the Fleet and its sims.

**Recommendation:** don't build a "kernelspace game". Turn the deterministic engine kernelspace already has into a few intrinsically integrated mechanics: play by hand first, then automate in Rust; Zachtronics-style multi-metric histograms on Forge labs; daily seeded incidents; and **two** genuinely 3D scenes, the matmul iteration-space cube and the parallelism device mesh. Build them on the three + R3F 9 stack already installed, with WebGL2 as the default, WebGPU as an opt-in, a 2D/DOM mirror for every 3D scene, and ≤ 300 KB gzip per lazy 3D chunk. Reject Bevy, Godot and Unity. Their wasm is 13–33 MB raw (a stripped, 2D-only Godot build is still 2.4 MB brotli; a real Bevy 0.19 app is 26–28 MB raw), and their web support is WebGL2-only or experimental WebGPU [fixed].

---

## 2. Findings (claim → evidence → boundary conditions → implication)

### 2.1 Learning science

**F1. Games beat conventional instruction, but only modestly. Session count, visual style and instruction around the game matter more than "being a game."**
- *Evidence.* Wouters et al. 2013 (J. Educ. Psych. 105(2):249–265; learning k = 77 comparisons, N = 5,547; motivation k = 31, N = 2,216) [fixed]: learning d = 0.29, retention d = 0.36. Games were **not** significantly more motivating than conventional instruction (d = 0.26, p > .05). Games did better when supplemented with other instruction, when spread over multiple sessions, and when played in groups. [V-abstract] (https://research-portal.uu.nl/en/publications/a-meta-analysis-of-the-cognitive-and-motivational-effects-of-seri/; abstract via https://api.openalex.org/works/doi:10.1037/a0031311)
- Clark, Tanner-Smith & Killingsworth 2016 (RER 86(1), K-16) [V] (https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/):
  - Game vs non-game: g = 0.33 [0.19, 0.48] (k = 57 studies; peer-reviewed studies 2000–2012; mean participant age ≈ 12–13). Moderator subgroups are small (e.g., schematic k = 12, realistic k = 13; single-session CI [−0.24, 0.39]), so treat the moderator contrasts as directional, not precise.
  - **Multiple sessions** g = 0.44 vs **single session** g = 0.08 (n.s.).
  - **Schematic** visuals g = 0.48, cartoon g = 0.32, **realistic g = −0.01**.
  - Narrative: none g = 0.44, irrelevant g = 0.63, *relevant* g = 0.17.
  - Points/badges-only mechanics g = 0.53 vs more complex mechanics g = 0.25 (the difference was not significant).
  - Enhanced scaffolding (value-added) g = 0.41.
- *Boundary.* The samples are K-16 and mostly short studies. No meta-analysis targets adult professionals learning systems engineering. Motivation effects are weaker than designers usually assume.
- *Implication.* Every kernelspace game element must:
  - recur across sessions (one-shot 3D "wow" scenes do nothing);
  - look schematic (the existing mint/cyan terminal aesthetic is right; photoreal GPU racks are wrong);
  - sit inside a lesson that has `prose` + `quiz` debrief blocks;
  - carry thin narrative (Fleet Week acts should stay incident tickets, not lore).

**F2. Intrinsic integration: when the core mechanic is the learning content, people learn more and play far longer by choice.**
- *Evidence.* Habgood & Ainsworth 2011, J. Learning Sciences 20(2):169–206, "Zombie Division": 58 children aged 7–11, 2 h of play. Under fixed time, children learned more from the intrinsic variant than from the extrinsic variant (maths as a quiz between levels) and a control. In free choice (n = 16), children played the intrinsic version **7× longer**. [V-abstract] (https://shura.shu.ac.uk/3556/)
- *Boundary.* The study used children, maths and small N. The "7×" figure is time on task, not learning. Even so, it is the most-cited design rule in the field.
- *Implication.* The test for every candidate mechanic in §3 is: "if you play well, have you necessarily used the concept?" A badge for finishing a lesson is extrinsic. A scheduler you must outplay to keep p99 TTFT under SLO is intrinsic. Kernelspace's existing XP layer (`src/lib/progress.ts`) is extrinsic. Keep it, but don't count on it for learning.

**F3. Ask what each game *feature* adds (Mayer's value-added approach), not whether games beat lectures.**
- *Evidence.* Mayer 2019, "Computer games in education", Annual Review of Psychology 70:531–549, separates three kinds of research: value-added (which feature improves learning), cognitive consequences (does playing transfer?) and media comparison (game vs conventional). [V for citation] (https://psych.ucsb.edu/node/188). In Clark 2016, value-added comparisons gave g = 0.34 [0.17, 0.51] [S] (https://docs.opendeved.net/lib/YHX5ZVR8). A 2023 STEM meta-analysis (Gui, Cai, Yang, Kong, Fan & Tai, Int. J. STEM Educ. 10) found base game vs base + design element g = 0.301 [0.163, 0.438] (81 effects, 44 studies) and game vs conventional g = 0.624 [0.457, 0.790] (136 effects, 86 studies); design elements aimed at content learning beat those aimed at game experience [V-abstract] (https://doaj.org/api/articles/a86dd0a9b0a443f5806e4501267ccafc).
- *Boundary.* Value-added evidence normally comes from A/B experiments. Kernelspace's no-telemetry, no-accounts constraint rules out in-product A/B tests.
- *Implication.* Measure **locally and opt-in**:
  - each new mechanic ships with a 3-item pre-probe and post-probe (the `quiz` block) whose result stays in localStorage;
  - learners can include a `learningProbes` section in the existing JSON export;
  - the owner runs volunteer "design experiments" by asking learners to attach exports to a GitHub issue or PR (zero-server).

**F4. Seductive details: interesting but irrelevant material reliably reduces learning, and visual/static ones do the most damage.**
- *Evidence.* Sundararajan & Adesope 2020, Educ. Psych. Review 32(3):707–734, 68 effects from 58 papers, N = 7,521: overall g = −0.33 [S]; by test type, retention-only g = −0.37 and retention + transfer g = −0.41 [V via Tislar & Steelman 2021] (https://pmc.ncbi.nlm.nih.gov/articles/PMC8442593/). The "up to g = −0.70 in some conditions (static images, text + image, placement at the end)" figure was not found in any source fetched this session [unverified] (https://www.e-teaching.org/materialien/literatur/sundararajan-adesope-2020 has only the citation). Rey 2012 (39 studies) found seductive details hurt retention (d = 0.30) and transfer (d = 0.48), and seductive *illustrations* hurt far more (retention 0.95, transfer 0.83) than seductive text (0.27, 0.65) [V, as summarised by Tislar & Steelman 2021, Brain and Behavior] [fixed: the PMC8442593 source is Tislar & Steelman, not a primary Rey paper] (https://pmc.ncbi.nlm.nih.gov/articles/PMC8442593/).
- *Boundary.* Some later work finds smaller or inconsistent effects when emotional interest is kept apart from distraction (PMC8442593 above).
- *Implication.* A 3D scene that doesn't encode the concept is a seductive detail. The home-page `ParticleField.tsx` is fine as branding, because it isn't on a learning page. Lesson pages should get **no** decorative 3D, and no "cool GPU model spinning beside the prose". Every 3D pixel must be a data mark.

**F5. More immersion does not mean more learning. HMD VR raises presence and cognitive load and can lower learning.**
- *Evidence.*
  - Makransky, Terkildsen & Mayer 2019, Learning and Instruction 60:225–236 (DOI 10.1016/j.learninstruc.2017.12.007). Science lab simulation, desktop vs HMD, N = 52 university students: presence ↑ (d = 1.30), learning ↓ (d = 0.80), EEG cognitive load ↑ (d = 0.59) [S] (https://imotions.com/blog/adding-immersive-virtual-reality-to-a-science-lab-simulation-causes-more-presence-but-less-learning).
  - Coban, Bolat & Göksu 2022, Educational Research Review (48 studies, 105 results, N = 3,179, studies 2016–Sept 2020): immersive VR overall g = 0.38 against mixed comparators [V-abstract] [fixed: these numbers were misattributed to Wu, Yu & Gu; the cited URL is the Coban et al. record] (https://gcris.artuklu.edu.tr/entities/publication/938a0d60-4ab6-4e76-99c5-3b4a1972092f). The real Wu, Yu & Gu 2020 BJET meta-analysis (35 RCTs, HMD VR vs less-immersive) found a small ES = 0.24 [V-abstract] (https://api.openalex.org/works?search=Effectiveness%20of%20immersive%20virtual%20reality%20using%20head-mounted%20displays%20on%20learning%20performance%20meta-analysis).
  - Parong & Mayer 2018, J. Educ. Psych. 110(6):785–797: in Exp. 1 a desktop slideshow beat immersive VR on the posttest although VR learners reported more interest and motivation; in Exp. 2, segmenting the VR lesson and having learners write a summary after each segment improved learning over continuous VR [V-abstract] [fixed: was unverified] (https://api.openalex.org/works/doi:10.1037/edu0000241).
- *Boundary.* VR helps for genuinely spatial or procedural-motor skills (surgery, assembly). Kernelspace's subject is abstract.
- *Implication.* No WebXR and no "walk through the datacenter". 3D is used only where the *concept's* own geometry has three or more meaningful axes (§2.3). When it is used, pair it with a generative prompt such as "predict the AI of this tile, then rotate to check".

**F6. Animation and dynamic visualisation help when they *represent* change, and help most for procedures.**
- *Evidence.* Höffler & Leutner 2007 (Learning and Instruction), animation vs static pictures: d ≈ 0.37 overall, larger when the animation is representational (not decorative), and largest for procedural-motor knowledge [unverified: the primary source was paywalled this session].
- *Boundary.* Learner control (pause/step) matters. Continuous auto-play of complex animation overloads working memory (Tversky et al. 2002, "Animation: can it facilitate?") [unverified].
- *Implication.* The `diagram` step-through block is the right default. Every 3D scene should use step/scrub control plus `frameloop="demand"` in R3F, not perpetual motion.

**F7. Scaffolded simulations have the largest effect of anything reviewed here, and kernelspace's main asset is a simulator.**
- *Evidence.* Chernikova et al. 2020, RER 90(4), simulation-based learning in higher education, 145 studies: **g = 0.85**. Scaffolding and technology both helped. Low-prior-knowledge learners gained from **examples**; high-prior-knowledge learners gained from **reflection phases** [S] (https://portal.fis.tum.de/en/publications/simulation-based-learning-in-higher-education-a-meta-analysis/, https://epub.ub.uni-muenchen.de/84298/1/0034654320933544.pdf). The PhET group's "implicit scaffolding" (affordances, productive constraints, multiple linked representations, "guiding without students feeling guided") comes from ~10 years of design research [V-abstract] (https://arxiv.org/pdf/1306.6544). D'Angelo et al. 2014 (SRI, K-12) found simulations beat non-simulation instruction, and enhanced simulations beat plain ones [S] (https://www.sri.com/wp-content/uploads/2021/12/simulations-for-stem-learning-full-report.pdf).
- *Boundary.* These studies cover complex-skill domains such as medicine, teacher education and management. g = 0.85 is a pooled average with high heterogeneity.
- *Implication.* The biggest return comes from **scaffolding the sims and the Fleet**, not from new art.
  - Add a "worked example replay" for novices: a ghost of the reference scheduler running beside their own run.
  - Add a "reflection debrief" for experts: after an `exercise` block, "which invariant bound p99 here?"
  - Use productive constraints: lock knobs until the learner has predicted the outcome.

**F8. Problem-solving before instruction ("productive failure") beats instruction-first for conceptual understanding.**
- *Evidence.* Sinha & Kapur 2021, RER 91(5):761–798, 53 studies, 166 comparisons. The observed overall effect is a **moderate g = 0.36 [0.20, 0.51]** favouring problem-solving first (PS-I); with high fidelity to Productive Failure principles g = 0.37–0.58; only the publication-bias-adjusted "true effect" estimate is g = 0.87 [fixed: the plan should quote 0.36 as the headline, 0.87 as a model-based adjustment] [V-abstract] (https://api.semanticscholar.org/graph/v1/paper/DOI:10.3102/00346543211019105?fields=title,abstract; secondary: https://techlearning.com/news/study-productive-failure-a-success-in-education).
- *Boundary.* The benefit is for conceptual understanding and transfer. Effects favoured instruction-first (I-PS) for young learners (grades 2–5) and for **domain-general skills** [V-abstract]. For procedural fluency the two orders are comparable [unverified]. It needs a consolidation phase after the failure.
- *Implication.* This justifies a **"play it by hand first"** opening for selected lessons. The learner manually admits and preempts requests in the Fleet (and fails the SLO), and only then reads `continuous-batching.ts`. This is also the mechanic of The Farmer Was Replaced and Factorio (§2.2).

**F9. Programming puzzles teach new concepts faster than tutorials. Open-ended, multi-metric puzzles keep experts engaged.**
- *Evidence.* Harms, Rowlett & Kelleher, "Enabling Independent Learning of Programming Concepts through Programming Completion Puzzles" (VL/HCC 2015) [fixed: co-author is Noah Rowlett, not Chen], completion puzzles vs tutorials for novice programmers in a novice programming environment: puzzle users did **26% better on transfer** and took **23% less time** to complete the learning materials [V: abstract text extracted from the PDF this session] (https://kharms.infosci.cornell.edu/downloads/harmsk-vlhcc-2015.pdf). Boundary: novice programmers in a novice programming environment, not professionals. A Lightbot study (N = 164) used puzzle play as a lens on program induction (https://arxiv.org/pdf/1807.07134). Zachtronics games give any working solution a pass, then show **three histograms** (cycles, cost, area) placing the player against everyone else. No single solution tops all three, so players choose trade-offs. Solutions also export as looping GIFs [V] (https://en.wikipedia.org/wiki/Opus_Magnum; https://www.engadget.com/2018-07-09-opus-magnum-zachtronics-irl.html).
- *Boundary.* There are no controlled studies of Zachtronics-style histograms on learning. The motivational case comes from community behaviour, such as long-running record tracking (https://biggieblog.com/?p=836).
- *Implication.* Kernelspace's subject *is* trade-offs: throughput vs latency, memory vs recompute, cost vs SLO. A Pareto/histogram display is therefore not decoration; its rules are the concept. See idea #1.

**F10. "Explorable explanation" means reasoning against a live model, not an article with pictures.**
- *Evidence.* Bret Victor's 2011 essay calls for reactive documents, explorable examples and contextual information. His **2024 postscript** says the term has been misread as "articles with interactive pictures" and that he meant "a written argument whose assertions are backed by explorable computational models, whose facts, assumptions, and calculations are all visible and editable". Note that he frames the original goal as readers critically evaluating and rebutting arguments, not pedagogy per se [V] (https://worrydream.com/ExplorableExplanations/). Transformer Explainer (Cho et al., CHI 2026 full paper, arXiv v2 10 Aug 2026; extends the 2-page IEEE VIS 2024 Best Poster) runs live GPT-2 in the browser. A 90-participant user study showed significant advantages in understanding and engagement, and the authors report over 490,000 users (self-reported usage, not an outcome measure) [V] (https://arxiv.org/abs/2408.04619). "How to Scale Your Model" (Austin et al., Google DeepMind, 4 Feb 2025) is built around roofline analysis with *worked problems* in each chapter, not widgets [V] (https://jax-ml.github.io/scaling-book/).
- *Boundary.* Lab studies of explorables are short. Long-term retention evidence is thin.
- *Implication.* Kernelspace already has the model: `fleet-model.ts`, `engine-core.ts`, and real Qwen3-0.6B via WebGPU. Every new visual should be a view onto that same deterministic model, so numbers in prose, sims and 3D always agree. That is Victor's "computational model behind the argument".

**F11. Flow and difficulty calibration matter, but elaborate meta-game mechanics are not where the learning comes from.**
- *Evidence.* In Clark 2016, simple points/badges mechanics (g = 0.53) were not significantly worse than complex game mechanics (g = 0.25) [V] (PMC4748544). Flow theory says challenge should match skill, but evidence specific to learning games here is mostly correlational [unverified].
- *Implication.* Don't build RPG systems, loot or avatars. Put effort into difficulty ramps inside mechanics: seeded traces of increasing burstiness, and SLOs that tighten.

### 2.2 What the exemplar games teach (mechanics analysis)

| Exemplar | Core mechanic | Concept that mechanic *is* | Kernelspace transfer |
|---|---|---|---|
| **Opus Magnum / SHENZHEN I/O / TIS-100 / EXAPUNKS** (Zachtronics) | Any working solution passes; histograms of cycles/cost/area; GIF export | Multi-objective optimisation, Pareto fronts | Forge labs show histograms of goodput, p99 TTFT, wasm bytes, ops/tick (idea #1) |
| **Factorio** | Manual crafting → automation; ratio/throughput puzzles; bottleneck hunting; "the factory must grow" | Throughput = min over stages; Little's law; ratios | Prefill:decode pool ratio, KV transfer links as belts (idea #5) |
| **The Farmer Was Replaced** (Python-like language; 1.0 on 10 Oct 2025; 95% positive of ~4.3k reviews [V] https://store.steampowered.com/app/2060160/) | Write code for a drone; unlock tech; optimise ticks | Automating a manual loop; costs of operations | "Hand-schedule, then write the policy" arc (idea #2) |
| **Turing Complete** (NAND → CPU, your own assembly; 70+ levels; Early Access since 2021, 1.0 expected 2026 [V] https://store.steampowered.com/app/1444480/) / **Nandgame** (https://nandgame.com/) | Build up abstraction layers; each level reuses the last | Layered abstraction | Mirrors the R → T0 → T1 ladder. Lesson: each Forge lab's output should become a *component* later reused, as the Fleet slots already do |
| **Human Resource Machine** (~40 puzzles; inbox/outbox assembly) | Tiny instruction set, visible execution | Machine model, step-execution | The `pointer`/`frame` labs already do this; add instruction-count scoring |
| **Bitburner** (browser, open source, scripts control a hacking incremental [V] https://github.com/bitburner-official/bitburner-src) / **Screeps** (JS MMO, code runs 24/7) | Code is the only input; resources are metered | Resource budgets and scheduling under contention | Screeps-style persistence needs a server, so **reject**. Bitburner's local-only incremental model fits the Fleet's persistent localStorage world |
| **The Deadlock Empire** (Hudeček & Pokorný 2016; *you are the scheduler* and try to break the code [V] https://deadlockempire.github.io/) | Adversarial interleaving | Race conditions, linearisability | Idea #4 for `concurrency-primitives.ts` + the MPMC lab |
| **Mini Metro** | Routes that saturate under growing demand; triage when overloaded | Queueing collapse near ρ → 1; load-shedding | Visual language for overload in the Fleet. Lines that thicken and stall show queueing far better than gauges |
| **Kerbal Space Program** | Physically honest sim; failure is spectacular and diagnostic | Calibrated simulation earns trust | Kernelspace's "every number sourced, sims calibrated" rule is the KSP lesson. Failure replays ("why did node 3 OOM?") are the payoff |

### 2.3 Decision rule: when 3D or game treatment helps and when it hurts

Apply this **gate** to every proposed 3D scene or game mechanic. Each answer must be yes; otherwise use 2D SVG/canvas or plain prose.

1. **Intrinsic test (F2).** If someone wins or plays well, have they necessarily applied the target concept? Is the scoring function a quantity the course teaches (goodput under SLO, arithmetic intensity, bytes moved, $/Mtok)?
2. **Dimensionality test (F4–F6).** Does the concept have **≥ 3 axes the learner must reason about together**, so that a 2D projection hides the key relationship? Examples: the matmul (i, j, k) iteration space, or a TP×PP×DP device mesh. If one or two axes carry the idea (queues, timelines, block tables, rooflines), **use 2D**.
3. **Model-backed test (F10).** Is every visual mark computed from the same deterministic model (`fleet-model.ts`, `engine-core.ts`, or the learner's wasm) that the prose numbers cite? If it is hand-animated, it is decoration.
4. **Recurrence test (F1).** Will the learner come back to it in ≥ 3 sessions: across lessons, through daily seeds, or because their later wasm component changes its behaviour? One-shot → not worth the build.
5. **Schematic test (F1).** Can it be drawn with flat colours, labels and data marks (cartoon/schematic)? Photoreal hardware, PBR materials and bloom fail.
6. **Load test (F5, F6).** Can the learner pause or step it, and is there ≤ 1 new representation at a time? Ship a reduced-motion and 2D/DOM equivalent.
7. **Debrief test (F1, F7).** Is it followed by a `quiz`, a reflection prompt or an `isomorphism` block that names the concept explicitly?

**Scoring heuristic:** expected impact ∝ (intrinsic ? 1 : 0.2) × (sessions reused) × (gap between the 2D and 3D mental model). If any of tests 1, 3 or 7 fails, the build is likely to *hurt* learning, because it becomes a seductive detail.

**Where 3D genuinely passes in kernelspace (only two strong cases):**
- **Matmul iteration space as a cube** (`t4/matmul-tiling.ts`, `roofline.ts`, `sim-roofline`). FLOPs = volume of a tile (i×j×k), and bytes loaded = the areas of its three face projections (A: i×k, B: k×j, C: i×j). Arithmetic intensity is literally volume ÷ surface, so the roofline is a geometry fact. Flash-attention tiling is the same idea on Q/K/V. This is the textbook case where 3D *is* the concept.
- **Device mesh for parallelism** (`t6/parallelism-zoo.ts`, `wide-ep.ts`, `moe-anatomy.ts`). TP×PP×DP(×EP) are mesh axes. Collectives run along an axis, and each axis maps to an interconnect tier (NVLink inside a node vs RDMA across nodes). Placing an axis on the wrong tier is the classic mistake, and it is spatial.

**Borderline (start in 2D, upgrade only if it passes test 2):**
- KV cache tensor [layers × heads × tokens × head_dim] for `kv-cache-math.ts`. The *paging* idea is 2D (block table); per-token bytes are 1D arithmetic.
- Rack/NVL72/fat-tree topology. 2D schematic diagrams usually beat 3D racks.

**Everything else is 2D:** queues, batching, allocators, block tables, radix trees, rooflines, speculative decoding, economics.

---

## 3. Concrete ideas for kernelspace, ranked by expected learning impact ÷ build effort

Effort assumes one maintainer plus AI coding agents. S ≈ 1–3 days, M ≈ 1–2 weeks, L ≈ 3–6 weeks.

| # | Idea | Touches | Impact | Effort | Zero-server |
|---|---|---|---|---|---|
| 1 | **Zachtronics histograms + Pareto on every Forge lab and the Fleet** | `ForgeLab.tsx`, `Leaderboard.tsx`, `src/lib/leaderboard.ts`, `public/leaderboard.json` | High | S–M | yes |
| 2 | **"Hand-schedule, then automate" (productive-failure opener)** | `/fleet` EnginePanel + `fleet-model.ts` `SchedulerDriver`; lessons `continuous-batching.ts`, `scheduling.ts` | Very high | M | yes |
| 3 | **Daily seeded incident ("Fleet Daily")** | `fleet-model.ts` `makeRng(seed)`, `fleet-week.ts` incident drills, `/week` | High (spacing + recurrence) | S–M | yes |
| 4 | **"Be the adversarial scheduler" (Deadlock-Empire mechanic)** | new `sim-interleave` in `src/components/sims/`; `t2/concurrency-primitives.ts`; `mpmc-queue` lab | High | M | yes |
| 5 | **Throughput factory: prefill/decode/KV-link ratio puzzles** | `EpdCluster` in `fleet-model.ts`, `EpdPanel.tsx`; `t6/epd-disaggregation.ts`, `t5/distributed-serving.ts` | High | M | yes |
| 6 | **Speculative decoding "push-your-luck"** | new sim; `t5/speculative-chunked.ts`, `t6/speculative-production.ts` | Med–High | S | yes |
| 7 | **3D Tiling Cube (matmul iteration space)** | new `sim-tiling3d` (R3F) linked from `t4/matmul-tiling.ts`, `roofline.ts`; WGSL playground cross-check | High (the one true 3D concept) | M | yes |
| 8 | **3D Device Mesh (parallelism placement puzzle)** | new `sim-mesh3d`; `t6/parallelism-zoo.ts`, `wide-ep.ts`, `moe-anatomy.ts` | Med–High | M–L | yes |
| 9 | **Fragmentation puzzle (allocator as packing game)** | `AllocatorSim.tsx`, `BlockTableExplorer.tsx`; `rust-allocator`, `kv-block-manager` labs | Medium | S | yes |
| 10 | **Expert placement bin-packing (EPLB)** | new 2D sim; `t6/wide-ep.ts` | Medium | M | yes |
| 11 | **Solution replay GIF/WebM export ("share your engine")** | Fleet + Forge; canvas `captureStream` → WebM download | Low–Med (motivation, social proof) | S | yes |
| 12 | **New block type `scene` and a gate checklist in authoring docs** | `src/data/lessons/types.ts`, `src/pages/lesson/blocks.tsx`, `AGENTS.md` | Enabler | S | yes |
| — | WebXR / VR datacenter walk-through | — | Negative (F5) | L | — reject |
| — | Persistent multiplayer "Screeps for serving" | — | Unknown | L | needs-server — reject |

**Idea #1 — Histograms + Pareto (Opus Magnum transfer).**
- After a lab passes, `ForgeLab.tsx` shows 3–4 histograms. Batching-scheduler: goodput under SLO, p99 TTFT, worst TPOT, `.wasm` bytes. Allocator: ops/s and fragmentation. Each histogram marks the learner's position.
- The distribution comes from the CI-verified submissions already published to `public/leaderboard.json` (extend the schema with per-metric vectors), plus fixed reference points: the reference implementation, a naive FCFS, and an "expert" solution.
- Add a 2D Pareto scatter (goodput vs p99) with the frontier drawn. This *is* the latency/throughput lesson.
- Per-metric personal bests live in localStorage, so no public ranking is required, which fits the 2026-08 "competition is against the reference" decision.
- *Rule = concept:* you can't top every axis, so you learn the trade-off.

**Idea #2 — Hand-schedule, then automate (Factorio / Farmer Was Replaced arc + productive failure).**
- In `/fleet`, a "manual" `SchedulerDriver` takes keyboard/click actions: admit request, preempt, chunk prefill. The engine is deterministic and pauses every N ticks (turn-based, so it is accessible and not a twitch game).
- Trace slices go from calm → BurstGPT burst. The learner *will* violate SLO; the debrief overlays the reference scheduler's ghost run (F7 example scaffolding).
- Then the lesson prose arrives, and later the learner writes the same policy in the `batching-scheduler` lab, where the manual run becomes the baseline their wasm must beat.
- Persistence: the manual run's metrics go into the progress store, so the "before/after" is the learner's own history.
- *Rule = concept:* the moves available are exactly `SchedAction {admit, preempt}`.

**Idea #3 — Fleet Daily.**
- seed = hash(UTC date). A deterministic incident is drawn from the `fleet-week.ts` drill generators: node death, flash crowd, hot expert, prefix-cache stampede.
- Everyone worldwide gets the same puzzle without a server (Wordle model). Result: a share string (plain text, e.g. "KS-Daily 2026-10-03 diag 2/3 · goodput 0.91").
- This gives spaced, interleaved retrieval of diagnosis skills (F1 multiple sessions) and feeds the streak days in `progress.ts`.

**Idea #4 — Adversarial interleaving.**
- The learner controls the thread scheduler and steps two or three threads through a buggy lock-free push/pop (`mpmc-queue` semantics) until an invariant breaks.
- Later levels feed in the learner's own `mpmc-queue` wasm, and they must fail to break it (a property check with exhaustive interleavings for small N).
- *Rule = concept:* the only lever is the interleaving, the same exploit space that `loom`-style model checkers search. The `isomorphism` block can link to scheduler preemption in LLM serving.

**Idea #5 — Throughput factory.**
- On a 2D Factorio-like board, place prefill workers, decode workers and KV-transfer links with RDMA bandwidth, given a target trace (Mooncake/Kimi replay already exists).
- Score: goodput per $. Bottleneck highlighting is computed by `EpdCluster` (which queue is growing).
- *Rule = concept:* the P:D ratio and link bandwidth determine throughput, so learners discover min-over-stages and Little's law.

**Idea #6 — Speculation push-your-luck.**
- Each step the learner picks draft length k. The sim samples acceptances using the draft's acceptance rate α, which can come from published EAGLE/MTP numbers already cited in `speculative-production.ts`.
- Expected tokens per target step = (1 − α^(k+1)) / (1 − α), against verification cost. The learner feels why the optimal k shrinks as α falls.
- Build cost: an afternoon on top of the existing quiz/diagram blocks.

**Idea #7 — 3D Tiling Cube (the flagship 3D scene).**
- An R3F scene shows the (M, N, K) iteration space as an instanced voxel cube. The learner drags (or keyboard-steps) tile sizes (tm, tn, tk) under a shared-memory/SMEM budget slider (H100/B200 numbers from `fp4-blackwell.ts`).
- Live readouts: tile volume = FLOPs, the three face projections lit = bytes loaded, AI = FLOPs/bytes, plotted as a moving dot on the existing `RooflineSim`.
- Loop orders animate as a sweeping tile, with step control (F6). The same tile config can run in `WgslSim` for a measured counterpart.
- **2D mirror (required):** three linked 2D face views (A, B, C matrices) plus a DOM table of the numbers.
- Puzzle levels: "hit AI ≥ X under SMEM ≤ Y". Flash-attention variant: a Q-tile × K/V streaming sweep.
- Passes all 7 gate tests.

**Idea #8 — 3D Device Mesh.**
- A 2×4×8 (or user-sized) cube of GPUs. Learners assign TP/PP/DP/EP to axes and choose which axis stays inside an NVLink domain.
- Collectives animate along axes (all-reduce rings, all-to-all for EP). Per-axis bytes and time come from formulas in `parallelism-zoo.ts`, with sourced bandwidths.
- Win: tokens/s or step time under a memory-per-GPU constraint.
- Risk: correctness of the cost model. It must cite the same formulas as the lesson and the Ultra-Scale Playbook / Scaling Book.
- **2D mirror:** an axis table + a 2D slice view.

**Idea #9 — Fragmentation puzzle.** Allocations arrive as a sequence; place them (first-fit/best-fit are offered as "auto-placers" to beat). External fragmentation ends the run. Then PagedAttention's fixed blocks make the same sequence trivially fit, which is the `exam-pagedattention.ts` aha. Reuses `AllocatorSim` state.

**Idea #10 — Expert placement.** Pack experts with skewed (sourced) routing frequencies onto GPUs, with replication allowed. Score: max GPU load and all-to-all volume. It teaches EPLB hot-expert replication.

**Idea #11 — Replay export.** `canvas.captureStream()` + `MediaRecorder` to WebM, or SVG frames, for a Fleet run or Forge histogram card. Opus Magnum shows that shareable artefacts drive organic reach, at zero server cost.

**Idea #12 — `scene` block + authoring gate.**
- Add a `type: 'scene'` ContentBlock with props `{sceneId, fallback: 'svg'|'table', probes: QuizQuestion[]}`. It lazy-loads the R3F chunk and always renders the 2D/DOM fallback first.
- Add the §2.3 gate to AGENTS.md so AI agents writing lessons can't add decorative 3D.

### 3.1 Recommended engine and stack for THIS codebase

**Verdict: keep three.js + @react-three/fiber 9 + selective drei. Use WebGL2 by default and `WebGPURenderer` only for compute-heavy views. Render 2D mechanics in React + SVG/Canvas2D. All game logic stays in the existing deterministic TS engine plus the learner's Rust wasm. Don't add a game engine.**

Justification (verified facts):

- **three.js:**
  - r186 is the current release (24 Sept 2026; npm `latest` is three@0.186.1 as of 2026-10-03 [fixed: was 0.186.0]). It adds `compileComputeAsync()`, TSL compute stage hooks, SunLight/cascaded shadows and a WebGPU Gaussian-splat renderer [V] (https://github.com/mrdoob/three.js/releases; https://github.com/mrdoob/three.js/releases/tag/r186).
  - `WebGPURenderer` "falls back to a WebGL 2 backend" automatically when WebGPU is missing (`forceWebGL` option) [V] (https://threejs.org/docs/pages/WebGPURenderer.html).
  - The repo pins 0.185.1. Upgrading to r186 is optional and low-risk.
- **R3F:**
  - Stable is 9.8.1 (Sept 24, 2026); v10 is at alpha.5 with "first-class" WebGPU/TSL, a new scheduler and multi-canvas [V] (https://github.com/pmndrs/react-three-fiber/releases).
  - R3F 9's `<Canvas gl={async (props) => { const r = new WebGPURenderer(props); await r.init(); return r }}>` already supports WebGPU, and `frameloop="demand"` exists [V] (https://r3f.docs.pmnd.rs/api/canvas).
  - **Do not adopt v10 alpha.** Revisit it when it goes stable. Its shared-renderer multi-canvas would help pages with several scenes.
- **Bundle (measured locally from node_modules, gzip −9):**
  - `three.core.min.js` 101 KB + `three.module.min.js` 87 KB ≈ **188 KB** (WebGL path).
  - `three.core` + `three.webgpu.min.js` 185 KB ≈ **285 KB** (WebGPU/TSL path).
  - The existing lazy `ParticleField` chunk (three + R3F) is **238 KB gzip** (dist built 2026-07-23). The main `index` chunk is 593 KB gzip and should not grow.
- **Bevy (rejected):**
  - Bevy 0.19 was released 19 June 2026 [V] (https://bevy.org/news/).
  - In one real project, release builds with `wasm-opt -Oz` are **26–28 MB raw** (26,077,179–27,825,976 B) for both WebGL2 and WebGPU targets, and grew 15–20% from 0.18.1 to 0.19.1 [V] (https://github.com/Tristan578/project-forge/pull/10268). Boundary: that project is a feature-heavy engine/editor player (merged 2026-09-26, partly AI-authored), so it is an upper-end data point, not the size of a minimal Bevy scene; no compressed (gzip/brotli) size was given. Minimal-build sizes were not checked this session [unverified].
  - That is ~100× the three.js chunk, and it duplicates React UI, accessibility and routing.
  - The "Rust-native" appeal is already met: the learner's Rust *is* the logic, and the renderer is a thin view.
- **Godot (rejected):**
  - Web export uses only the Compatibility renderer (WebGL 2), has **no WebGPU**, and **C# cannot export to web in Godot 4** (docs for 4.7) [V] (https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html).
  - Default wasm is ~32 MB raw (Godot 4.3-stable). A custom export template brings it to 15 MB raw, 13 MB after wasm-opt, and 3.4 MB gzip / 2.4 MB brotli, but that build **disables the 3D engine** (`disable_3d=yes`), the advanced text server and C# [fixed: the 2.4 MB figure is a 2D-only build, so it does not apply to a 3D scene] [V] (https://amann.dev/blog/2025/godot_web_size/).
  - The single-threaded export has been the default since Godot 4.3; threaded exports need COOP/COEP, and for hosts that cannot set headers (the docs name GitHub Pages) the PWA option adds a service-worker workaround [V] (https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html).
  - It can't share state with React without a bridge.
- **Unity 6 (rejected):** WebGPU is "experimental" in Unity 6.3 LTS [V] (https://docs.unity3d.com/6000.3/Documentation/Manual/WebGPU.html). Heavy runtime, closed toolchain.
- **Babylon.js 9.x / PlayCanvas 2.x:** both are mature and WebGPU-capable (Babylon 9.29.0; PlayCanvas v2.23.0 per their GitHub release pages fetched 2026-10-03 [V] https://github.com/BabylonJS/Babylon.js/releases, https://github.com/playcanvas/engine/releases). Choosing either would add a second 3D runtime with no capability gain over the three/R3F stack already installed. **Not recommended.**
- **WebGPU availability:**
  - Chromium: desktop 113+; Android 121+ (Android 12+, ARM/Qualcomm; Imagination 139+); Linux only Intel Gen12+ (144) and NVIDIA on Wayland (147), others behind a flag; Windows ARM64 behind a flag.
  - Firefox: Windows 141+, Apple-silicon macOS 145/147+; **Linux and Android not shipped**.
  - Safari: 26 on macOS/iOS/iPadOS/visionOS [V] (https://github.com/gpuweb/gpuweb/wiki/Implementation-Status).
  - caniuse shows ~87% global (85.72% full + 1.63% partial) [V] (https://caniuse.com/webgpu). Caveat: caniuse still marks Firefox as "disabled by default" (it doesn't count Firefox 141+ on Windows) and Safari 26 as *partial*. Treat 87% as an approximation, and don't read it as "13% have no GPU path": every one of those browsers has WebGL2.
  - So WebGL2 must be the guaranteed path. Many Linux developers (a core audience) lack WebGPU in Firefox. `real-engine.ts` already has the same constraint.
- **GitHub Pages:** 1 GB site cap, 100 GB/month soft bandwidth [V] (https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). No custom response headers, so no COOP/COEP and no `SharedArrayBuffer`/wasm threads without a service-worker shim. GitHub's Pages-limits page is silent, but Godot's web-export docs name GitHub Pages as a host that can't set these headers [V] (https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html). Multithreaded builds therefore need a COOP/COEP service-worker shim, such as Godot's PWA option or a coi-serviceworker-style script. They aren't strictly impossible, but they add a first-load reload and complexity [fixed: was "Multithreaded Bevy/Godot builds are out"]. Kernelspace's single-thread wasm ABI is compatible.

**Performance and size budget (proposed):**
- Per 3D scene: lazy chunk ≤ **300 KB gzip** including three/R3F (shared across scenes via a common `three-vendor` chunk). Scene-specific code ≤ 40 KB gzip. **No** drei barrel imports (import individual helpers). No textures/HDRIs (schematic look, F1). Fonts: reuse the site font via SDF text only where needed.
- Runtime: ≤ 100 draw calls (use `InstancedMesh` for voxels/GPUs); ≤ 50k instances; `frameloop="demand"`; DPR cap 1.5; time to first frame < 1.5 s on a 2020 mid-range laptop. 60 fps desktop, 30 fps mobile, otherwise auto-switch to the 2D mirror. GPU memory < 200 MB.
- 2D mechanics (ideas 1–6, 9–10): SVG for ≤ 2k marks, Canvas2D above that. Zero new dependencies; recharts is already present for histograms.
- Detection: `navigator.gpu` + `requestAdapter()` for WebGPU; a WebGL2 context test; `prefers-reduced-motion`; `deviceMemory`/`hardwareConcurrency` as hints. Fall back to the 2D mirror on failure.

**Accessibility (WCAG 2.2, published 5 Oct 2023):**
- 2.5.7 Dragging Movements (AA): every drag (tile resize, mesh axis assignment, placement) needs a single-pointer or keyboard alternative such as steppers/selects.
- 2.5.8 Target Size (AA) and 2.4.11 Focus Not Obscured (AA) [V] (https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/).
- Existing criteria: 2.1.1 Keyboard, 2.2.2 Pause/Stop/Hide, and 2.3.3 Animation from Interactions [unverified, from WCAG 2.1 knowledge].
- Canvas is opaque to screen readers. Each scene therefore renders a **DOM mirror**: a table of the model state, plus an `aria-live="polite"` summary on each step ("Tile 64×64×32: 262k FLOPs, 20 KB loaded, AI 12.8 → memory-bound").
- `ScrollStory.tsx` already gates motion on `prefers-reduced-motion` with a static fallback; reuse that pattern.
- Turn-based stepping in idea #2 also avoids timing barriers.

### 3.2 Build-cost estimates and risks

| Item | Effort | Main risk | Mitigation |
|---|---|---|---|
| #1 Histograms/Pareto | S–M | Small-N distributions early on look empty | Seed with reference + naive + expert points; show "n = …" honestly |
| #2 Manual scheduler | M | Tedium; accessibility of a real-time game | Turn-based pause every N ticks; 3-minute cap; skip button |
| #3 Fleet Daily | S–M | Seed exploits / spoiler sharing | Harmless (no stakes); rotate generator params |
| #4 Interleaving | M | Exhaustive interleaving blow-up | Small N (2–3 threads, ≤ 12 steps); bounded DFS |
| #5 Throughput factory | M | Cost model drifts from the lesson | Single source: `EpdCluster`; unit test against lesson statlines |
| #6 Speculation | S | α values unsourced | Use only the α already cited in `speculative-production.ts` field notes |
| #7 Tiling cube | M (≈ 2 weeks w/ agents) | 3D usability; the cost model is simplified (ignores bank conflicts, L2) | Label the simplifications in a `callout`; cross-check with `WgslSim` measured numbers |
| #8 Device mesh | M–L | Collective cost formulas wrong or outdated → violates the honesty constraint | Every bandwidth sourced, `verifiedAt` badge; review against the Scaling Book ch. on sharding |
| R3F v10 migration | — | Alpha churn | Stay on 9.8.x until v10 stable |
| Upgrade three 0.185 → 0.186 | S | Minor API churn in node materials | Pin; smoke test ParticleField |

Cross-cutting risks: (a) the maintainer's time goes into art instead of scaffolding (F7 says scaffolding is where the effect is); (b) no telemetry means value-added can't be measured (§F3, mitigated with local probes and volunteer exports); (c) mobile/low-end GPUs, mitigated with the 2D-first rendering order.

---

## 4. Anti-patterns and risks

1. **Chocolate-covered broccoli.** Wrapping existing multiple-choice quizzes in a game shell (shooting the right answer, XP explosions) is extrinsic integration (F2). Note too that the quiz bank's answer-position bias (86% "B") would make any quiz-game trivially gameable. Fix the bank first: shuffle options at render time and balance lengths.
2. **Decorative 3D on lesson pages.** Spinning GPUs, particle backdrops behind prose, 3D logos. The seductive-detail penalty is g ≈ −0.33 (F4).
3. **Photoreal hardware.** In Clark 2016, realistic visuals gave g ≈ 0 against 0.48 for schematic (F1). Do not model an H100 board.
4. **VR/WebXR "immersion".** It raises presence and load and lowers learning (F5).
5. **Rich narrative.** Relevant narrative gave g = 0.17 vs 0.44 for none (F1). Keep stories to incident tickets.
6. **A separate game engine/runtime.** Bevy/Godot/Unity cost 13–33 MB raw wasm (multi-MB even compressed; the 2.4 MB brotli Godot figure is a 2D-only build) [fixed], break React-level accessibility, bring threading header problems on GitHub Pages, and create a second source of truth for the model.
7. **Hand-animated "simulations".** Any visual not computed from `fleet-model.ts`/`engine-core.ts`/learner wasm breaks Victor's model-backed principle and the course's honesty rule (F10).
8. **Real-time twitch control.** It excludes keyboard and screen-reader users (WCAG 2.1.1/2.2.2) and measures reflexes, not systems reasoning. Use turn-based or pausable play.
9. **Public competitive ranking as the main motivator.** It contradicts the 2026-08 owner decision. Histograms with personal bests give the Zachtronics benefit without a status hierarchy.
10. **One-shot spectacles.** A single-session game shows g ≈ 0.08 (F1). Every mechanic needs a recurrence hook (daily seed, later lab reuse, Fleet persistence).
11. **Overbuilt meta-game.** Complex mechanics are not better than points (F11). Don't add loot, avatars or economies.
12. **WebGPU-only features.** About 13% of browsers lack it, including Firefox on Linux and Android. Always ship the WebGL2 or 2D path.

---

## 5. Sources

| # | Source (URL) | Title | Date |
|---|---|---|---|
| 1 | https://shura.shu.ac.uk/3556/ | Habgood & Ainsworth, "Motivating children to learn effectively: exploring the value of intrinsic integration in educational games", JLS 20(2) | 2011 |
| 2 | https://research-portal.uu.nl/en/publications/a-meta-analysis-of-the-cognitive-and-motivational-effects-of-seri/ | Wouters et al., "A meta-analysis of the cognitive and motivational effects of serious games", J. Educ. Psych. 105(2) | 2013 |
| 3 | https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/ | Clark, Tanner-Smith & Killingsworth, "Digital Games, Design, and Learning: A Systematic Review and Meta-Analysis", RER 86(1) | 2016 |
| 4 | https://psych.ucsb.edu/node/188 | Mayer, "Computer games in education", Annual Review of Psychology 70:531–549 (citation) | 2019 |
| 5 | https://doaj.org/article/a86dd0a9b0a443f5806e4501267ccafc | Meta-analysis of digital game-based STEM learning (g = 0.624; value-added g = 0.301), Int. J. STEM Educ. | 2023 |
| 6 | https://www.e-teaching.org/materialien/literatur/sundararajan-adesope-2020 | Sundararajan & Adesope, "Keep it Coherent: A Meta-Analysis of the Seductive Details Effect", EPR 32(3) | 2020 |
| 7 | https://pmc.ncbi.nlm.nih.gov/articles/PMC8442593/ | Tislar & Steelman, "Inconsistent seduction: Addressing confounds… seductive detail effect", Brain and Behavior (summarises Rey 2012 and Sundararajan & Adesope 2020) [fixed] | 2021 |
| 8 | https://imotions.com/blog/adding-immersive-virtual-reality-to-a-science-lab-simulation-causes-more-presence-but-less-learning | Makransky, Terkildsen & Mayer, "Adding immersive VR to a science lab simulation causes more presence but less learning", Learning & Instruction 60 | 2019 |
| 9 | https://gcris.artuklu.edu.tr/entities/publication/938a0d60-4ab6-4e76-99c5-3b4a1972092f | Coban, Bolat & Göksu, "The potential of immersive virtual reality to enhance learning: A meta-analysis", Educational Research Review (48 studies, g = 0.38) [fixed: was mislabelled as Wu, Yu & Gu] | 2022 |
| 9b | https://api.openalex.org/works?search=Effectiveness%20of%20immersive%20virtual%20reality%20using%20head-mounted%20displays%20on%20learning%20performance%20meta-analysis | Wu, Yu & Gu, "Effectiveness of immersive VR using HMDs on learning performance: A meta-analysis", BJET (35 RCTs, ES = 0.24) | 2020 |
| 10 | https://portal.fis.tum.de/en/publications/simulation-based-learning-in-higher-education-a-meta-analysis/ ; https://epub.ub.uni-muenchen.de/84298/1/0034654320933544.pdf | Chernikova et al., "Simulation-Based Learning in Higher Education: A Meta-Analysis", RER 90(4) | 2020 |
| 11 | https://arxiv.org/pdf/1306.6544 | Podolefsky, Moore & Perkins, "Implicit scaffolding in interactive simulations" (PhET) | 2013 |
| 12 | https://www.sri.com/wp-content/uploads/2021/12/simulations-for-stem-learning-full-report.pdf | D'Angelo et al., "Simulations for STEM Learning: Systematic Review and Meta-Analysis", SRI | 2014 |
| 13 | https://techlearning.com/news/study-productive-failure-a-success-in-education ; https://api.semanticscholar.org/graph/v1/paper/DOI:10.3102/00346543211019105?fields=title,abstract | Sinha & Kapur, "When Problem Solving Followed by Instruction Works", RER 91(5) (overall g = 0.36; bias-adjusted 0.87) [fixed] | 2021 |
| 14 | https://kharms.infosci.cornell.edu/downloads/harmsk-vlhcc-2015.pdf | Harms, Rowlett & Kelleher, "Enabling Independent Learning of Programming Concepts through Programming Completion Puzzles" (VL/HCC) [fixed] | 2015 |
| 15 | https://arxiv.org/pdf/1807.07134 | "Representational efficiency outweighs action efficiency in human program induction" (Lightbot) | 2018 |
| 16 | https://worrydream.com/ExplorableExplanations/ | Bret Victor, "Explorable Explanations" (+ 2024 postscript) | 2011 / 2024 |
| 17 | https://arxiv.org/abs/2408.04619 | Cho et al., "Transformer Explainer" (CHI 2026; 90-participant study; 490k users) | 2024 / 2026 |
| 18 | https://poloclub.github.io/transformer-explainer/ | Transformer Explainer live tool | live |
| 19 | https://bbycroft.net/llm ; https://github.com/bbycroft/llm-viz | Brendan Bycroft, LLM Visualization (3D GPT walk-through, minGPT sort model) | 2023 |
| 20 | https://jax-ml.github.io/scaling-book/ | Austin et al. (Google DeepMind), "How to Scale Your Model" | 2025-02-04 |
| 21 | https://huggingface.co/spaces/nanotron/ultrascale-playbook | Hugging Face, "The Ultra-Scale Playbook" (details such as the experiment count not loaded this session [unverified]) | 2025 |
| 22 | https://ciechanow.ski/archives/ | Bartosz Ciechanowski, interactive 3D articles (Moon 2024-12-17, Airfoil 2024-02-27, Bicycle, GPS, Mechanical Watch…) | 2020–2024 |
| 23 | https://www.redblobgames.com/ | Amit Patel, Red Blob Games (A*, hex grids; read/watch/do philosophy) | live |
| 24 | https://ncase.me/ | Nicky Case explorables (e.g., "The Evolution of Trust") [not fetched this session] | live |
| 25 | https://distill.pub/ | Distill (interactive ML research articles; on hiatus since 2021) [not fetched this session] | 2016–2021 |
| 26 | https://en.wikipedia.org/wiki/Opus_Magnum ; https://www.engadget.com/2018-07-09-opus-magnum-zachtronics-irl.html | Opus Magnum: cycles/cost/area histograms, GIF export | 2017–2018 |
| 27 | https://store.steampowered.com/app/2060160/The_Farmer_Was_Replaced/ | The Farmer Was Replaced (1.0 on 2025-10-10) | 2025 |
| 28 | https://store.steampowered.com/app/1444480/Turing_Complete/ | Turing Complete (Early Access since 2021-10-02) | 2021– |
| 29 | https://nandgame.com/ | Nandgame | live |
| 30 | https://github.com/bitburner-official/bitburner-src | Bitburner (open-source browser programming incremental) | live |
| 31 | https://deadlockempire.github.io/ | The Deadlock Empire (Hudeček & Pokorný, HackCambridge) | 2016 |
| 32 | https://github.com/mrdoob/three.js/releases ; https://github.com/mrdoob/three.js/releases/tag/r186 | three.js r186 release notes | 2026-09 |
| 33 | https://threejs.org/docs/pages/WebGPURenderer.html | three.js WebGPURenderer docs (WebGL 2 fallback, forceWebGL) | live |
| 34 | https://github.com/pmndrs/react-three-fiber/releases | R3F 9.8.1 stable / v10.0.0-alpha.5 | 2026-09 |
| 35 | https://r3f.docs.pmnd.rs/api/canvas | R3F Canvas docs (async `gl` factory for WebGPURenderer; `frameloop="demand"`) | live |
| 36 | https://github.com/gpuweb/gpuweb/wiki/Implementation-Status | WebGPU implementation status by browser/OS | live (fetched 2026-10-03) |
| 37 | https://caniuse.com/webgpu | Can I use: WebGPU (~87% global) | live (fetched 2026-10-03) |
| 38 | https://bevy.org/news/ | Bevy release posts (0.19 on 2026-06-19) | 2026 |
| 39 | https://github.com/Tristan578/project-forge/pull/10268 | Real-world Bevy 0.19 wasm size budget (26–28 MB raw, wasm-opt -Oz) | 2026 |
| 40 | https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html | Godot 4.7 web export docs (WebGL2 only, no C# on web, single-thread default) | live |
| 41 | https://amann.dev/blog/2025/godot_web_size/ | Optimising Godot web size (32 MB → 2.4 MB brotli, 2D-only build with 3D disabled) [fixed] | 2025 |
| 42 | https://docs.unity3d.com/6000.3/Documentation/Manual/WebGPU.html | Unity 6.3 WebGPU (experimental) | live |
| 43 | https://github.com/BabylonJS/Babylon.js/releases ; https://github.com/playcanvas/engine/releases | Babylon.js 9.29.0; PlayCanvas v2.23.0 | fetched 2026-10-03 |
| 44 | https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ | What's new in WCAG 2.2 (2.5.7 Dragging, 2.5.8 Target Size, 2.4.11 Focus Not Obscured) | 2023-10-05 |
| 45 | https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits | GitHub Pages limits (1 GB, 100 GB/mo soft) | live |
| 46 | Local measurement: `node_modules/three/build/*.min.js` gzip −9; `dist/assets/ParticleField-*.js` | three 0.185.1 WebGL path ≈ 188 KB gz; WebGPU path ≈ 285 KB gz; existing 3D chunk 238 KB gz | 2026-10-03 |

---

## Verification log

Adversarial fact-check run 2026-10-03. WebSearch quota was exhausted, so every check below used a direct fetch of the primary page, an abstract API (OpenAlex / Semantic Scholar / DOAJ), or a local command.

| Claim | Verdict | Evidence URL |
|---|---|---|
| Clark et al. 2016: overall g = 0.33 [0.19, 0.48]; multi 0.44 vs single 0.08; schematic 0.48 / cartoon 0.32 / realistic −0.01; narrative none 0.44 / irrelevant 0.63 / relevant 0.17; points 0.53 vs complex 0.25; enhanced scaffolding 0.41; value-added overall 0.34 [0.17, 0.51] | confirmed (added k = 57, ages ≈ 12–13, small moderator k) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/ |
| Wouters et al. 2013: d = 0.29 learning, 0.36 retention, motivation 0.26 n.s.; moderators supplemental instruction / multiple sessions / groups | confirmed; "77 studies" corrected to k = 77 comparisons (motivation k = 31, N = 2,216); pages 249–265 | https://api.openalex.org/works/doi:10.1037/a0031311 |
| Habgood & Ainsworth 2011: 58 children, 2 h, intrinsic > extrinsic/control; 16 children free choice, 7× longer | confirmed (ages 7–11) | https://api.openalex.org/works/doi:10.1080/10508406.2010.508029 ; https://shura.shu.ac.uk/3556/ |
| Makransky, Terkildsen & Mayer 2019: presence d = 1.30, learning ↓ d = 0.80, EEG load d = 0.59, N = 52 | confirmed via secondary (iMotions); primary abstract not retrievable; L&I 60:225–236 | https://imotions.com/blog/adding-immersive-virtual-reality-to-a-science-lab-simulation-causes-more-presence-but-less-learning |
| Sundararajan & Adesope 2020: g = −0.33, 68 effects / 58 studies | partly confirmed: 58 papers, 68 effects, N = 7,521, retention −0.37, retention + transfer −0.41 (secondary); overall −0.33 not seen in a fetched source; "up to −0.70" unverified | https://pmc.ncbi.nlm.nih.gov/articles/PMC8442593/ |
| Chernikova et al. 2020: g = 0.85 [0.69, 1.02], 145 studies; examples for low prior knowledge, reflection for high | confirmed (RER 90(4):499–541) | https://portal.fis.tum.de/en/publications/simulation-based-learning-in-higher-education-a-meta-analysis/ |
| Sinha & Kapur 2021: bias-adjusted g ≈ 0.87 | confirmed but corrected framing: observed overall g = 0.36 [0.20, 0.51]; high-fidelity PF 0.37–0.58; I-PS favoured for grades 2–5 and domain-general skills | https://api.semanticscholar.org/graph/v1/paper/DOI:10.3102/00346543211019105?fields=title,abstract |
| Harms et al. 2015: 26% better transfer, 23% less time | numbers confirmed from PDF text; author list corrected (Harms, Rowlett & Kelleher, not Chen) | https://kharms.infosci.cornell.edu/downloads/harmsk-vlhcc-2015.pdf |
| WebGPU status matrix (Chromium / Firefox / Safari) | confirmed | https://github.com/gpuweb/gpuweb/wiki/Implementation-Status |
| caniuse ≈ 87% (85.72 + 1.63) | confirmed; caveat added (caniuse marks Firefox as disabled and Safari 26 as partial) | https://caniuse.com/webgpu |
| three.js r186 current (Sept 2026), SunLight/CSM, splat renderer, compute hooks | confirmed (r186 tag 24 Sept); npm latest is 0.186.1, not 0.186.0 | https://github.com/mrdoob/three.js/releases/tag/r186 ; https://registry.npmjs.org/three/latest |
| WebGPURenderer auto-falls back to WebGL 2; `forceWebGL` | confirmed | https://threejs.org/docs/pages/WebGPURenderer.html |
| R3F 9.8.1 stable (24 Sept), v10.0.0-alpha.5 with first-class WebGPU/TSL, scheduler, multi-canvas | confirmed (npm dist-tags agree) | https://github.com/pmndrs/react-three-fiber/releases ; https://registry.npmjs.org/@react-three/fiber |
| R3F async `gl` factory and `frameloop="demand"` | confirmed | https://r3f.docs.pmnd.rs/api/canvas |
| Bevy 0.19 released 2026-06-19 | confirmed (0.18 on 2026-01-13) | https://bevy.org/news/ |
| Bevy 0.19 wasm 26–28 MB raw after wasm-opt -Oz; +15–20% vs 0.18 | confirmed for that one feature-heavy project only; boundary added | https://github.com/Tristan578/project-forge/pull/10268 |
| Godot 4.x web: WebGL2/Compatibility only, no WebGPU, no C# on web, single-thread default | confirmed (docs are for 4.7; single-thread default since 4.3) | https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html |
| Godot default wasm ≈ 33 MB; 2.4 MB brotli stripped | corrected: 32 MB (4.3); the 2.4 MB brotli build disables 3D | https://amann.dev/blog/2025/godot_web_size/ |
| Local: three WebGL path ≈ 188 KB gz, WebGPU path ≈ 285 KB gz, ParticleField 238 KB gz, index 593 KB gz | confirmed by re-running gzip −9 (100,867 + 86,590; 100,867 + 184,605; 238,362; 592,756 B); installed three 0.185.1, R3F 9.6.1, drei 10.7.7 | local: node_modules/three/build/*.min.js, dist/assets/ParticleField-D3t1ZksX.js |
| Transformer Explainer: CHI 2026, 90-participant study, > 490,000 users | confirmed (CHI 2026 full paper; usage is self-reported) | https://arxiv.org/abs/2408.04619 |
| WCAG 2.2 published 2023-10-05; 2.5.7, 2.5.8, 2.4.11 at AA | confirmed (also: 4.1.1 Parsing removed) | https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ |
| "Wu, Yu & Gu 2020: 48 studies, N = 3,179, g = 0.38" | refuted / misattributed: those are Coban, Bolat & Göksu 2022 (ERR); Wu et al. 2020 = 35 RCTs, ES = 0.24 | https://gcris.artuklu.edu.tr/entities/publication/938a0d60-4ab6-4e76-99c5-3b4a1972092f |
| Parong & Mayer 2018: VR + generative summarising recovers learning | confirmed (was marked unverified) | https://api.openalex.org/works/doi:10.1037/edu0000241 |
| Gui et al. 2023 STEM meta-analysis g = 0.624 / 0.301 | confirmed; authors and k added | https://doaj.org/api/articles/a86dd0a9b0a443f5806e4501267ccafc |
| Mayer 2019 Annual Review of Psychology 70:531–549 | confirmed | https://psych.ucsb.edu/node/188 |
| Victor 2024 postscript | confirmed; nuance added (aim was critical reading, not pedagogy) | https://worrydream.com/ExplorableExplanations/ |
| Scaling Book (Austin et al., Google DeepMind, 4 Feb 2025), roofline-centred, with problems | confirmed ("each chapter" not explicitly confirmed) | https://jax-ml.github.io/scaling-book/ |
| The Farmer Was Replaced 1.0 on 2025-10-10, 95% of ~4.3k reviews | confirmed (4,275 reviews) | https://store.steampowered.com/app/2060160/ |
| Turing Complete EA since 2021-10-02, 70+ levels, 1.0 expected 2026 | confirmed | https://store.steampowered.com/app/1444480/ |
| Opus Magnum cycles/cost/area + GIF export | confirmed (released 2017-12-08) | https://en.wikipedia.org/wiki/Opus_Magnum |
| Deadlock Empire (Hudeček & Pokorný, HackCambridge 2016) | confirmed | https://deadlockempire.github.io/ |
| Unity 6.3 WebGPU experimental | confirmed | https://docs.unity3d.com/6000.3/Documentation/Manual/WebGPU.html |
| Babylon.js 9.29.0, PlayCanvas v2.23.0 (both released 1 Oct) | confirmed | https://github.com/BabylonJS/Babylon.js/releases ; https://github.com/playcanvas/engine/releases |
| GitHub Pages 1 GB site, 100 GB/month soft bandwidth | confirmed; header limitation corroborated by Godot docs | https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits |
| Ciechanowski Moon 2024-12-17, Airfoil 2024-02-27 | confirmed | https://ciechanow.ski/archives/ |
| Höffler & Leutner 2007: d ≈ 0.37, larger for representational, largest for procedural-motor | unverified (citation confirmed L&I 17:722–738; abstract elided by publisher) | https://api.openalex.org/works/doi:10.1016/j.learninstruc.2007.09.013 |
| D'Angelo et al. 2014 SRI simulation findings | unverified (PDF could not be parsed) | https://www.sri.com/wp-content/uploads/2021/12/simulations-for-stem-learning-full-report.pdf |

## Gaps the author missed

1. **Instructional support inside games is its own meta-analytic finding.** Wouters & van Oostendorp, "A meta-analytic review of the role of instructional support in game-based learning", Computers & Education 60(1):412–425 (2013), studied support such as self-explanation prompts, feedback and modelling directly. This is the closest evidence for idea #2's debrief and ghost run; check the exact effect sizes before quoting them. https://api.openalex.org/works/doi:10.1016/j.compedu.2012.07.018
2. **Gamification is not the same as game-based learning, and kernelspace already has a gamification layer.** Sailer & Homner 2020, EPR 32(1):77–112: cognitive g = .49, motivational g = .36, behavioural g = .25. Game fiction, social interaction and *competition combined with collaboration* moderated the effects, and rigorous studies were less stable. This bears on the XP/streak layer and Fleet Daily, which the dossier treats only through Clark's "points/badges" subgroup. https://api.openalex.org/works/doi:10.1007/s10648-019-09498-w
3. **ICAP (Chi & Wylie 2014, Educational Psychologist 49(4):219–243).** Rotating a 3D cube or clicking through a sim is only *Active*. Learning gains come from *Constructive* (generate predictions or explanations) and *Interactive* (dialogue) modes. The gate in §2.3 should require a constructive output, such as a predict-then-check prompt, and not just manipulation. https://api.openalex.org/works/doi:10.1080/00461520.2014.965823
4. **Expertise reversal (Kalyuga 2007, EPR 19(4):509–539).** Scaffolds that help novices can hurt experienced learners. Kernelspace's audience is mostly professional engineers, so ghost runs, worked examples and locked knobs need to fade, or be skippable based on prior performance. This is consistent with Chernikova's split between examples and reflection. https://api.openalex.org/works/doi:10.1007/s10648-007-9054-3
5. **Spatial ability moderates learning from visualisations (Höffler 2010, EPR 22(3):245–269).** The flagship 3D Tiling Cube and Device Mesh will work differently for low- and high-spatial learners. That is another reason the 2D face views and the DOM table should be first-class, not just fallbacks. Effect sizes were not retrieved this session. https://api.openalex.org/works/doi:10.1007/s10648-010-9126-7
6. **The VR evidence is mixed, not uniformly negative.** Wu, Yu & Gu 2020 (35 RCTs, ES = 0.24) and Coban et al. 2022 (48 studies, g = 0.38) both find small *positive* HMD effects, while Parong & Mayer 2018 and Makransky 2019 find learning losses. The defensible rule is "immersion without generative activity adds load", not "VR lowers learning". https://api.openalex.org/works?search=Effectiveness%20of%20immersive%20virtual%20reality%20using%20head-mounted%20displays%20on%20learning%20performance%20meta-analysis ; https://api.openalex.org/works/doi:10.1037/edu0000241
7. **The inquiry versus direct-instruction debate is unresolved, and the plan should take the combined position.** de Jong et al. 2023, "Let's talk evidence – The case for combining inquiry-based and direct instruction", Educational Research Review, argues for inquiry with personalised guidance and well-timed direct instruction. That is a better framing for the "hand-schedule first" opener than productive failure alone. Sinha & Kapur also found I-PS favoured for domain-general skills. https://api.openalex.org/works/doi:10.1016/j.edurev.2023.100536
8. **Wasm threads on GitHub Pages are possible through a service-worker COOP/COEP shim.** Godot's docs name GitHub Pages and ship a PWA workaround. If any Rust lab or a 3D compute view later wants `SharedArrayBuffer`/threads, that is a path that doesn't need a server. The cost is a one-time reload and service-worker complexity, so the plan should decide this explicitly rather than assume it is impossible. https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
