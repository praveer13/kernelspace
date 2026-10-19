# The S5 gate protocol: Fleet physics v2

Status: adopted by the build on 2026-10-18, unsigned. The owner signs it (F2); the build does not wait.

**Date:** 2026-10-18. **Version:** 1, recorded with this file's sha256 in `docs/physics/protocol-history.json`. **Spec:** `docs/specs/s5.md` §5.1 (S5-D2, S5-D46, S5-D63); the owner questions this file settles take their defaults (S5-D27): O1 (b), O2 yes, O11 "F only".
**Pre-registered.** This file is committed before any task runs `fit-physics` on the snapshot in the repo. Nothing below changes except by a dated amendment (section 10), and no parameter, bound, grid, filter, split or threshold is re-tuned after it. `report.json` records this file's sha256 and the block's `version`, and `verify:physics` fails when they disagree with the last history entry (S5-D63).
**The block is what runs.** Section 11's `s5-protocol` block is the single source of every constant the replay, the fit, the gate and the decision tables read (S5-D46). `scripts/physics-protocol.ts` parses it (`readProtocol()`), and no script copies a constant out of it. Sections 1–9 explain the block; if the prose and the block ever disagree, the block is what the harness runs, and the disagreement is fixed by an amendment.

## 1. Purpose

PLAN-100X.md:706 (the Wave 4 table) sets S5's gate and default:

> S5 physics v2 → step-time exercises, Device Mesh, Throughput Factory | η fitted on a subset of published points; leave-one-out error ≤15% per hardware row (SGLang's ~6% simulator is vendor-reported precedent only) | 2027-10 | v1 + generators

The owner opened S5 early, on 2026-10-18; the default stays "v1 + generators" whatever this gate says. This protocol turns "leave-one-out error ≤15% per hardware row" into five gates, G1–G5 (section 6):

- **"Hardware row"** is a chip × engine release × weight precision on the Llama-3-70B architecture with FP8 KV (section 4).
- **"Fitted on a subset"** is the fit subset F; the held-out subset H is never fitted (section 3).
- **"Leave-one-out error ≤15%"** is G1: TPOT leave-one-out over F with mean ≤ 10 % **and** p90 ≤ 15 %. G2 holds the shipped table to the same bar on H. G3 decides TTFT eligibility only. G4 rejects non-physical parameters and G5 too little coverage.

Only the card's predictions are validated, never its split into terms (S5-D5): no η, fixed cost, per-sequence cost, link bandwidth or harness term is graded or taught as a hardware fact.

## 2. The snapshot

- **Source.** One InferenceX sweep of Llama-3.3-70B-Instruct, the pinned query `https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true`. Fetched 2026-10-18: 681 rows, 1,026,817 bytes, sha256 `d2ce48fdbd84936994d68bb28413f0e842da3b01a2c7a0958e4041699dc19792`. Row ids are JSON strings; `mean_tpot` and `median_ttft` (seconds) sit under each row's `metrics`.
- **Harness.** The open, Apache-2.0 repository `SemiAnalysisAI/InferenceX` at commit `9596d23d74e9e1e4f4bcdb27572c87cafb746a02`. The rows carry `"image": null`; the release is known from that commit's `.github/workflows/70b-tmpl.yml`, which runs the H100 FP8, B200 FP8 and B200 FP4 vLLM jobs on `vllm/vllm-openai:v0.10.2`.
- **Client** (the `benchmark_serving.py` call of the runner and Slurm scripts, from `kimbochen/bench_serving`; `full-sweep-tmpl.yml` passes the range ratio): `--dataset-name random`, `--random-range-ratio 0.8`, `--num-prompts` 10·c, `--max-concurrency` c, `--request-rate inf`, `--ignore-eos`. `benchmark-tmpl.yml`'s default concurrency list is [4, 8, 16, 32, 64]. The loop is closed and `--ignore-eos` fixes every request's output length, so the step schedule does not depend on step durations.
- **Server** (`benchmarks/70b_fp8_h100_*.sh`, `70b_fp8_b200_docker.sh`, `70b_fp4_b200_docker.sh`): `kv-cache-dtype: fp8`, `async-scheduling: true`, `no-enable-prefix-caching: true`, `max-num-batched-tokens: 8192`, `--gpu-memory-utilization` 0.9, no `--enforce-eager` (the B200 scripts set `"cudagraph_mode": "FULL_DECODE_ONLY"`). `--max-num-seqs` is c in the H100 scripts and 512 in the B200 scripts; on both, the client keeps at most c requests in flight, so at most c sequences run, which is what the replay's `maxNumSeqs = c` reproduces.
- **Controls** (`70b_fp8_mi325x_*.sh`, `70b_fp8_mi355x_*.sh`): the ROCm vLLM 0.10.1 image, `--max-num-batched-tokens=131072`, `--max-num-seqs=$CONC`, `--gpu-memory-utilization=0.94`. They are replayed at their own budget (the block's `controls`) and never fitted for the gate.
- **The extract.** S5-04 writes the selected fields of the 165 selected rows and the 120 control rows to `src/data/physics/points/inferencex-l70-2025-10-29.json` from a response whose sha256 equals the one above. The extract's own sha256 is recorded by the dataset claim and `report.json`, since the extract is written after this file.
- **Age.** The sweep describes vLLM 0.10.2 as of 2025-10-29. Every v2 label names it ("vLLM 0.10.2 · InferenceX 2025-10-29"), and the dataset claim is stale from 2027-04-16. A refit on a newer sweep is a new physics id under a new dated amendment.

## 3. Selection, filters and split

**Selection.** `framework == 'vllm' && spec_method == 'none' && !disagg && !is_multinode` (the block's `select`), on the hardware and precision of a row in section 4: **165 rows**, H100 FP8 45, B200 FP8 60, B200 FP4 60. The control rows (MI325X FP8 60, MI355X FP8 60) pass the same `select` and are never part of a fit row.

**Physical filters**, declared here and set with the snapshot in view (section 9). W and kv come from the model byte claims of section 4; HBM from the row's capacity claim; `gpuMemUtil` = 0.9.

- **KV rule:** drop a point if `conc × (isl + osl) > ⌊(gpuMemUtil × HBM × TP − W) ÷ kv⌋`, the KV tokens the pool can hold. Every shape needs at most 64 × (1,024 + 8,192) = 589,824 tokens.
  - H100 FP8 TP 2: ⌊(0.9 × 80e9 × 2 − 70.55e9) ÷ 163,840⌋ = 448,303 < 589,824, so the two c = 64 points with an 8k side drop: **41507** (1k/8k) and **42070** (8k/1k).
  - B200 FP8 TP 1: ⌊(0.9 × 180e9 − 70.55e9) ÷ 163,840⌋ = 558,166 < 589,824: **42140** (1k/8k) and **40752** (8k/1k).
  - B200 NVFP4 TP 1: ⌊(0.9 × 180e9 − 39.684375e9) ÷ 163,840⌋ = 746,555 ≥ 589,824: nothing drops. Every larger TP has more room.
- **Preemption rule:** drop a point if its `median_ttft` ≥ 3 s. That drops **44119** (H100 FP8 TP 2, c 32, 8k/1k, 4.19 s); 41507 (8.47 s), 42070 (57.89 s) and 40752 (5.56 s) fail it too.
- **Exactly five ids drop:** 40752, 41507, 42070, 42140, 44119 (the block's `filters.expectDropped`). A run that drops any other set stops. **Kept: 160** (H100 FP8 42, B200 FP8 58, B200 NVFP4 60).

**Split** (O11, S5-D7). F = concurrency {4, 16, 64} fits the shipped table; H = {8, 32} is never fitted and scores it. Per row, F / H = 25 / 17 (H100 FP8), 34 / 24 (B200 FP8), 36 / 24 (B200 NVFP4). `frontier`'s options use F's concurrencies only. S5-06's test asserts the five drops, the kept 42 / 58 / 60 and these F / H counts (S5-D52).

## 4. Rows, peaks and boxes

A row is chip × engine release × weight precision on the Llama-3-70B architecture with FP8 KV (O2's default, S5-D6). Every other chip stays v1 + generators.

| Row key | Chip · release · weights | Fit TPs | Box TPs | Bandwidth | Dense peak at the weight precision | Capacity | Weight bytes W |
|---|---|---|---|---|---|---|---|
| `h100-vllm-0-10-2-fp8` | H100 SXM · vLLM 0.10.2 · FP8 | 2, 4, 8 | 2, 4, 8 | `hw.h100-sxm.hbm-bw` (3.35 TB/s) | `hw.h100-sxm.fp8-dense` (1,979 TFLOPS) | `hw.h100-sxm.hbm-capacity` (80 GB) | `model.llama3-70b.weight-bytes-fp8` |
| `b200-vllm-0-10-2-fp8` | B200 · vLLM 0.10.2 · FP8 | 1, 2, 4, 8 | 1, 2, 4, 8 | `hw.b200.hbm-bw` (8 TB/s) | `hw.b200.fp8-dense` | `hw.b200.hbm-capacity` (180 GB) | `model.llama3-70b.weight-bytes-fp8` |
| `b200-vllm-0-10-2-nvfp4` | B200 · vLLM 0.10.2 · NVFP4 | 1, 2, 4, 8 | 1, 2, 4 | `hw.b200.hbm-bw` | `hw.b200.fp4-dense` | `hw.b200.hbm-capacity` | `model.llama3-70b.weight-bytes-nvfp4` |

- **Claims at the base and to register.** The values in brackets are the registry's at the base of this protocol. S5-03 registers `hw.b200.fp8-dense` and `hw.b200.fp4-dense` (derived from the HGX B200 system figures ÷ 8 GPUs ÷ 2 for sparsity, as `hw.b200.bf16-dense` is; §3.3 of the spec expects 4,500 and 9,000 TFLOPS, with its stated fallback of 2× and 4× `hw.b200.bf16-dense`), the model byte claims `model.llama3-70b.weight-bytes-fp8` (params × 1 B), `model.llama3-70b.weight-bytes-nvfp4` (params × 4.5 ÷ 8 B) and `model.llama3-70b.kv-bytes-per-token-fp8` (2 × layers × kv-heads × head-dim × 1 B = 2 × 80 × 8 × 128 = 163,840 B), and the harness claims `status.inferencex.harness.batch-tokens` (8,192) and `status.vllm-0-10-2.block-size` (16). The model shape reads `model.llama3-70b.params` (70.55 B), `.layers` (80) and `.hidden-size` (8,192). A wrong peak rescales η only.
- **The replay's settings are the harness's**, never today's production defaults (S5-D34): the token budget reads `status.inferencex.harness.batch-tokens`, the block size `status.vllm-0-10-2.block-size`. If the block-size quote cannot be fetched, a dated amendment points `replay.blockSize` to `production.vllm.block-size`, citing both releases.
- **Box** (configuration level, per row; `inBox` in the generated table): the Llama-3-70B architecture; the row's weights with FP8 KV; `tp` in the row's box TPs; `maxNumSeqs` ≤ 64; shape ∈ {1k/1k, 1k/8k, 8k/1k} nominal at range ratio 0.8; a token budget of 8,192; prefix caching off; `c × (isl + osl)` within the KV room of section 3. NVFP4 is fitted on TP 1–8 and boxed to TP 1–4. Out of box, `EngineV2` runs only in labelled exploration, which nothing in S5 shows learners.
- **Envelope** (step level, per row, from the replay logs of F ∪ H): the maximum per step of `tokens`, decoding sequences, `kvTokens ÷ tp` and `attnPairs ÷ tp`. A step above any of them is out of envelope; an exercise band rejects any seed with one.

## 5. The card and the fit

**The card** (S5-D4; spec §3.2), per engine step, with `+ − × ÷`, one `Math.max` and one `Math.round`, in this order:

```
memBytes  = (W + kv·K) / tp                                   W = model.weightBytes, kv = model.kvBytesPerToken
flops     = (2·params·T + 4·layers·hidden·A) / tp
linkBytes = tp > 1 ? (2·layers·T·hidden·2·2·(tp − 1)) / tp : 0
memS      = memBytes / (etaMem · bwBps)
flopS     = flops / (etaFlop · peakFlops)
linkS     = linkGBs === null || tp === 1 ? 0 : linkBytes / (linkGBs · 1e9)
fixedS    = (layers · layerUs + seqs · seqUs) / 1e6
stepS     = fixedS + linkS + Math.max(memS, flopS)
us        = Math.round(stepS · 1e6)                           bound = memS ≥ flopS ? 'mem' : 'flop'
```

T, K, A and `seqs` are the step's tokens, KV entries read or written, causal attention token pairs and sequences, summed over the batch. Five parameters per row are fitted: η_m (`etaMem`), η_f (`etaFlop`), t_layer (`layerUs`), t_seq (`seqUs`) and β (`linkGBs`, entering as 1/β). The harness term h, a fitted TTFT residual, is not physics and stays outside the engine (S5-D11): it is added only when an engine TTFT is compared with a published one.

**Fit bounds.** η_m ∈ [0.30, 1.00]; η_f ∈ [0.10, 1.00]; t_layer, t_seq, 1/β ≥ 0 (non-negative least squares); h ≥ 0. G4 then checks narrower physical ranges.

**Grid** (S5-D35): η_m from 0.30 to 1.00 by 0.01 (71 values) and η_f from 0.10 to 1.00 by 0.02 (46 values), searched exhaustively. Grid values are computed as an integer ÷ 100 (η_m = k ÷ 100 for k = 30, 31, …, 100; η_f = k ÷ 100 for k = 10, 12, …, 100), never by repeated addition, so every run sees the same doubles.

**Replay** (S5-D9; the block's `replay`). For each kept point, 10·c requests are queued at t = 0 in id order; prompt and output lengths are drawn uniformly on the integers [⌊0.8·L⌋, L] with the seed `hash32('ix:' + id)`; `maxNumSeqs` = c; FCFS; token budget 8,192; block size 16; `numBlocks` = ⌊(0.9 × HBM × TP − W) ÷ (kv × 16)⌋. TTFT is stamped from admission to the end of the step that completes the request's prefill. The replay records, through `EngineV2`'s step hook and card override (S5-D53), each step's load and which requests decoded, completed prefill or were admitted in it. One replay per point serves every parameter set.

**Observations.** A request's TPOT is (last token µs − first token µs) ÷ (osl_r − 1); a point's mean TPOT is the mean over its requests, so a TPOT prediction is Σ_s w_s · stepS_s(θ) with the fixed weight w_s = Σ over the requests r decoding in step s of 1 ÷ ((osl_r − 1) × R), R the number of requests. A point's median TTFT is not a fixed-weight sum: each request's admission-to-first-token window is summed per parameter set θ and the median is then taken by the `stats.median` rule (n = 10·c is even, so the mean of the two middle values). TTFT adds h only when compared with the published value.

**Procedure** (`fit.ts`, pure and numeric-linted, in a fixed order):

1. Start at η_f = 0.60. For each η_m on the grid, (t_layer, t_seq, 1/β) come from non-negative least squares on the relative TPOT error over the fit points, enumerating every active set; the best η_m wins (the block's `fit.objective`).
2. Three rounds of: (a) for each η_f on the grid, h in closed form (weighted least squares on (engine TTFT + h) ÷ measured − 1, clipped at 0) and the TTFT error over every fit point's median TTFT, keeping the best η_f; (b) step 1 again at that η_f.
3. The max inside the card is taken per step; no closed form is assumed. Each point's weighted kernel Σ_s w_s · max(memS_s, flopS_s) depends only on (η_m, η_f) and is memoised per row, shared by the fit and every LOO, LOTPO and LOSO refit.

**Leave-one-out** (spec §5.5). Each point i of F is predicted by the whole procedure above refitted on F \ {i}, with the same replay logs; i's own log is used only for its prediction (TPOT, and TTFT if its ISL is 8,192). **Held-out:** the fit on all of F predicts every point of H. **LOTPO and LOSO** (printed): refit without every point of one TP, or of one shape, and predict them.

## 6. The gates

Per row and metric, over this one snapshot (O1 (b), S5-D3):

| Gate | Rule | Kind |
|---|---|---|
| **G1** | TPOT leave-one-out over F: mean ≤ 10 % **and** p90 ≤ 15 % | build gate: a row cannot be `calibrated` without it |
| **G2** | The table fitted on all of F, scored on H: TPOT mean ≤ 10 % **and** p90 ≤ 15 % | build gate |
| **G3** | Median-TTFT leave-one-out over F's points with ISL 8,192, h added: mean ≤ 15 % | decides TTFT eligibility only |
| **G4** | 0.50 ≤ η_m ≤ 0.95; 0.20 ≤ η_f ≤ 0.90; t_layer ≤ 200 µs; t_seq ≤ 200 µs; β ≤ 900 GB/s; h ≤ 100 ms. A parameter at a fit bound is flagged, not failed | build gate |
| **G5** | n_F ≥ 20; ≥ 2 TP values; ≥ 3 concurrencies; ≥ 2 shapes, 8k/1k among them | build gate |
| R1 | max; the worst three points with `run_url`; LOTPO; LOSO | printed, on the tab |
| R2 | the NIM 1.8.0 cross-harness panel; the MI325X/MI355X control at budget 131,072; the frozen-form report on any newer snapshot | printed nightly, never failing; on the tab as derived claims |

A row is **calibrated** when G1, G2, G4 and G5 pass; it is **TTFT-eligible** when G3 passes too. Max, LOTPO, LOSO, NIM and the controls are never gated.

**Statistics** (the block's `stats`): a point's error is |pred ÷ meas − 1|; the mean is arithmetic; p90 is the nearest rank `sorted[⌈0.9·n⌉ − 1]`; max is the largest. A median over requests is the mean of `sorted[n/2 − 1]` and `sorted[n/2]` for even n (numpy's `np.median`, which the harness client's `benchmark_serving.py` uses for `median_ttft`) and `sorted[(n − 1)/2]` for odd n, per parameter set; `EngineV2.stats()` uses the same rule.

**The gate scores the engine** (S5-D14; the block's `consistency`). On 3 configurations per row (its smallest TP at c 4, 1k/1k; its largest TP at c 64, 1k/1k; its smallest TP at c 4, 8k/1k) `EngineV2`, run with the written table and its integer-µs clock, matches the fit's weighted-sum prediction summed in float `stepS`: |Δ mean TPOT| ≤ 0.5 µs and |Δ median TTFT| ≤ 0.5 µs × the number of steps in the median windows. If that bound cannot be met, the build stops before the verdict.

## 7. Decisions that follow

- **A failing row stays visible:** in the generated table with `status: 'failed'` and its numbers, and on the tab with its gate table. `EngineV2` refuses it in calibrated mode (`NotCalibrated(row, metric)`), and any v2 exercise def or calibrated `step` variant naming it fails `verify:physics` until it drops the row.
- **Both FP8 rows fail:** S5 closes with its default. Level 1 ships (the η = 1 card pinned to Boot, `kv.ts` and roofline; the four η-free `step` variants; the three errata; the physics tab as "why the Fleet's clock stays flat"); Level 2 is cancelled; the Device Mesh and the Throughput Factory stay gated. A retry needs a newer same-date H100 + B200 sweep, an amendment and a new physics id.
- **One FP8 row fails:** v2 runs on the other only; `frontier`'s classes shrink to that row and its fairness is re-measured under section 8's kill rules.
- **NVFP4 fails:** `step/quant-speedup` and the FP8 → NVFP4 finding drop.
- **A metric fails:** a row can be TPOT-calibrated and TTFT-ineligible; no consumer may use an ineligible metric.
- **Decide-by point** (O8): S5-07's merge. If S5-07 has not merged by 2027-02-28, S5 closes with its default.
- **On a later refresh** (a claim's TTL lapses or its value changes) `verify:physics` fails the refreshing PR ("re-fit needed", never a silent re-grade). Stored exercise outcomes are history and are never re-derived.
- **The fit is unsigned until F1:** `report.json`'s `fitStatus` and the generated table's `FIT_STATUS` read "adopted by the build on 2026-10-18, unsigned" (S5-D64). An owner refusal is a dated amendment followed by a re-run of the verdict.

## 8. Exercises

**Honesty** (spec §7.0; the block's `h1`):

- **H1, decision-level**, binds decisions graded against measured values, which in S5 is `frontier` alone. A graded quantity is validated as itself on published configurations, each side predicted by a leave-one-out refit. Tolerance (numeric): max(15 %, the p90 of the quantity's LOO error), rounded up to a whole percent. Separation (choice): the measured winner beats the runner-up by ≥ 1 ÷ (1 − δ_sep), δ_sep the p90 of the LOO error of the winner-to-runner-up ratio over the row's published option pairs. Membership: every option's tok/s/user is at least δ_mem from the floor, relatively, δ_mem the row's TPOT LOO p90 over F. Agreement: the answer from LOO predictions equals the answer from measured values. A `step` item grades the card's arithmetic with the parameters its stem gives, at the family tolerance (2 % relative), and carries H4 labels only (S5-D57).
- **H2, measured agreement:** where every option is a published point, the engine's answer equals the answer from the measured values; otherwise the seed is out of band.
- **H3, box and envelope:** graded and unlabelled only in box; any out-of-envelope step puts the seed out of band.
- **H4, labels per metric** (S5-D58): every v2 number names the chip, vLLM 0.10.2, the precision, the fit size, InferenceX 2025-10-29, the metric's leave-one-out p90 ("9 in 10 within …"; none on a ratio) and the physics id.

**Fairness** (wave-3 D39 as D70 applies it; the block's `fairness`): the scene is shown before the prediction; done = 3 right in a row on fresh seeds with at least 2 distinct answers; no answer right on more than 29 % of banded seeds; the best scene-ignoring guesser finishes within 10 rounds at most 14 % of the time and within 30 at most 40 %; a scene reader finishes within 10 rounds more than 90 % of the time. For free numbers the best constant's chance of 3 in a row within 10 has the same 14 % bound.

**`step` items** (the block's `items`): over 2,000 instances the best constant answer is within the family tolerance on at most 10 %, and absolute answers span at least 10×. Ratio variants have no span bound, only the constant-cover bound measured at the family tolerance; a variant that fails is cut.

**`frontier`** (spec §7.1; the block's `frontier`). Options are the row's box TPs × c ∈ {4, 16, 64}; the answer code is 100·TP + c. Truth comes from one closed-loop replay per (shape, c), seeded `hash32('ix-frontier:' + isl + '/' + osl + ':' + c)` and shared across TPs and rows (S5-D60). Scenes are sampled flattened (O12): a gradeable (row, answer) class uniformly, then a shape and a floor uniformly within that class's floor intervals, floors from 15.0 to 120.0 tok/s/user in steps of 0.1; a class is gradeable when it passes measured H1 and LOO agreement on a floor interval at least 3.0 tok/s/user wide. **Kill rules** (O7): `frontier` is not registered if, in the repo,

- **Rule 1:** fewer than 6 distinct answer codes (across rows) survive decision-level H1, H2 and the width rule (`frontier.classesMin`, `frontier.classesCount`);
- **Rule 1b:** under flattened sampling any answer code is right on more than 29 % of banded seeds (`fairness.answerShareMax`);
- **Rule 2:** the flattened scene-blind bound exceeds 14 % within 10 or 40 % within 30 (`fairness.blindWithin10Max`, `fairness.blindWithin30Max`);
- **Rule 3:** the reader check fails after its fallback (`fairness.readerWithin10Min`);
- **Rule 4:** the heaviest sweep exceeds 2.5 s on the dev host (`frontier.sweepMaxMs`).

S5-08 computes rules 1, 1b, 2 and 3 into `docs/physics/decisions.json`; S5-13 measures rule 4 and rule 1b on the registered sampling (S5-D45). If a rule trips, S5 closes with zero graded engine exercises.

## 9. Selection disclosure

> The card form (layers·t_layer + seqs·t_seq + linkBytes ÷ β + max(memBytes ÷ (η_m·BW), FLOPs ÷ (η_f·F))) was chosen among about ten candidate forms on this same 2025-10-29 snapshot by the S5 design work. Three prototype fits (the "minimal", "faithful" and "learner" designs) had already been scored on this snapshot before this protocol was written, and the gate statistic was chosen after those scores were seen. On rows no design looked at (MI325X and MI355X, vLLM FP8, in the same snapshot) the frozen card form fails G1's p90 bar on MI325X (19.1 % in the prototype). The in-sample margins are therefore optimistic. The physical filters, the fit/held-out split and the held-out points were also seen by the prototype fits; G2 is held out from the in-repo fit, not from the choice of form. The nightly out-of-sample control and the frozen-form report on the next snapshot are the prospective tests, and the physics tab prints both.

## 10. Amendments

None. A later change is a dated `### <date>` entry here that says what changed and why, a new entry in `docs/physics/protocol-history.json` with this file's new sha256 and the block's new `version`, and a re-run of the verdict (S5-07).

## 11. The machine block

The block below is §5.1's of `docs/specs/s5.md`, byte for byte. `tests/physics/protocol.test.ts` holds it there.

```json s5-protocol
{
  "id": "s5-physics-gate",
  "version": 1,
  "date": "2026-10-18",
  "status": "adopted by the build on 2026-10-18, unsigned",
  "snapshot": {
    "url": "https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true",
    "rawSha256": "d2ce48fdbd84936994d68bb28413f0e842da3b01a2c7a0958e4041699dc19792",
    "rawBytes": 1026817,
    "rawRows": 681,
    "fetched": "2026-10-18",
    "harness": { "repo": "SemiAnalysisAI/InferenceX", "ref": "9596d23d74e9e1e4f4bcdb27572c87cafb746a02" }
  },
  "select": { "framework": "vllm", "spec_method": "none", "disagg": false, "is_multinode": false },
  "model": {
    "params": "model.llama3-70b.params",
    "layers": "model.llama3-70b.layers",
    "hidden": "model.llama3-70b.hidden-size",
    "kvBytesPerToken": "model.llama3-70b.kv-bytes-per-token-fp8"
  },
  "rows": [
    { "key": "h100-vllm-0-10-2-fp8", "hardware": "h100", "precision": "fp8", "fitTp": [2, 4, 8], "boxTp": [2, 4, 8],
      "bw": "hw.h100-sxm.hbm-bw", "peak": "hw.h100-sxm.fp8-dense", "hbm": "hw.h100-sxm.hbm-capacity",
      "weightBytes": "model.llama3-70b.weight-bytes-fp8" },
    { "key": "b200-vllm-0-10-2-fp8", "hardware": "b200", "precision": "fp8", "fitTp": [1, 2, 4, 8], "boxTp": [1, 2, 4, 8],
      "bw": "hw.b200.hbm-bw", "peak": "hw.b200.fp8-dense", "hbm": "hw.b200.hbm-capacity",
      "weightBytes": "model.llama3-70b.weight-bytes-fp8" },
    { "key": "b200-vllm-0-10-2-nvfp4", "hardware": "b200", "precision": "fp4", "fitTp": [1, 2, 4, 8], "boxTp": [1, 2, 4],
      "bw": "hw.b200.hbm-bw", "peak": "hw.b200.fp4-dense", "hbm": "hw.b200.hbm-capacity",
      "weightBytes": "model.llama3-70b.weight-bytes-nvfp4" }
  ],
  "controls": [
    { "hardware": "mi325x", "precision": "fp8", "batchTokens": 131072 },
    { "hardware": "mi355x", "precision": "fp8", "batchTokens": 131072 }
  ],
  "filters": {
    "gpuMemUtil": 0.9,
    "kvRule": "drop if conc * (isl + osl) > floor((gpuMemUtil * HBM * TP - W) / kv)",
    "ttftMaxSeconds": 3,
    "expectDropped": ["40752", "41507", "42070", "42140", "44119"]
  },
  "split": { "fitConc": [4, 16, 64], "heldOutConc": [8, 32] },
  "replay": {
    "promptsPerConc": 10,
    "rangeRatio": 0.8,
    "batchTokens": "status.inferencex.harness.batch-tokens",
    "blockSize": "status.vllm-0-10-2.block-size",
    "seed": "hash32('ix:' + id)",
    "order": "all 10*c requests queued at t = 0 in id order; maxNumSeqs = c; FCFS; TTFT stamped from admission"
  },
  "fit": {
    "etaMem": { "from": 0.30, "to": 1.00, "step": 0.01 },
    "etaFlop": { "from": 0.10, "to": 1.00, "step": 0.02 },
    "etaFlopStart": 0.60,
    "linear": ["layerUs", "seqUs", "invLinkGBs"],
    "objective": "sum over fit points of (predTpot / measTpot - 1)^2, by NNLS with every active set enumerated",
    "ttftRounds": 3,
    "ttftPoints": "every fit point's median TTFT",
    "harness": "closed-form weighted least squares on (engine TTFT + h) / meas - 1, clipped at 0",
    "memo": "the per-point weighted kernel is memoised by (etaMem, etaFlop) per row and shared by the fit and every LOO, LOTPO and LOSO refit"
  },
  "stats": { "error": "abs(pred / meas - 1)", "mean": "arithmetic", "p90": "sorted[ceil(0.9 * n) - 1]", "max": "largest",
    "median": "mean of sorted[n/2 - 1] and sorted[n/2] for even n (np.median), sorted[(n - 1)/2] for odd; over requests, per parameter set" },
  "gates": {
    "G1": { "metric": "tpot", "population": "leave-one-out over the fit subset", "meanMax": 0.10, "p90Max": 0.15 },
    "G2": { "metric": "tpot", "population": "held-out subset, scored by the fit on the whole fit subset", "meanMax": 0.10, "p90Max": 0.15 },
    "G3": { "metric": "ttft-median", "population": "leave-one-out over fit-subset points with isl 8192, harness term added", "meanMax": 0.15, "decides": "TTFT eligibility only" },
    "G4": { "etaMem": [0.50, 0.95], "etaFlop": [0.20, 0.90], "layerUsMax": 200, "seqUsMax": 200, "linkGBsMax": 900, "harnessMsMax": 100 },
    "G5": { "fitPointsMin": 20, "tpValuesMin": 2, "concValuesMin": 3, "shapesMin": 2, "shapeRequired": [8192, 1024] }
  },
  "printed": ["max", "worst three points with run_url", "LOTPO", "LOSO", "NIM cross-harness", "MI325X/MI355X control", "frozen-form report on newer snapshots"],
  "consistency": { "configsPerRow": 3, "sum": "float stepS, as the fit uses", "tpotMaxAbsUs": 0.5, "ttftMaxAbsUs": "0.5 * steps in the median windows" },
  "h1": {
    "scope": "decisions graded against measured values (frontier); step items are graded at the family tolerance and carry H4 labels only",
    "tolerance": "max(0.15, p90 of the quantity's LOO error), rounded up to a whole percent",
    "separation": "measured winner / runner-up >= 1 / (1 - deltaSep); deltaSep = p90 of the LOO error of the winner-to-runner-up ratio over published option pairs of the row",
    "membership": "every option's tok/s/user at least deltaMem from the floor, relatively; deltaMem = the row's TPOT LOO p90 over F",
    "agreement": "the answer from LOO predictions equals the answer from measured values"
  },
  "fairness": {
    "doneRule": "3 right in a row on fresh seeds with at least 2 distinct answers",
    "answerShareMax": 0.29,
    "blindWithin10Max": 0.14,
    "blindWithin30Max": 0.40,
    "readerWithin10Min": 0.90
  },
  "frontier": {
    "concs": [4, 16, 64],
    "floorFrom": 15.0,
    "floorTo": 120.0,
    "floorStep": 0.1,
    "classWidthMin": 3.0,
    "classesMin": 6,
    "sampling": "a class uniformly, then a shape and a floor uniformly within the class's gradeable intervals",
    "replaySeed": "hash32('ix-frontier:' + isl + '/' + osl + ':' + c)",
    "replays": "one per (shape, c), shared across TPs and rows",
    "classesCount": "distinct answer codes (100 * TP + c) across rows",
    "sweepMaxMs": 2500
  },
  "items": { "instances": 2000, "constantCoverMax": 0.10, "answerSpanMin": 10,
    "ratioRule": "ratio variants: no span bound; constantCoverMax measured at the family tolerance" }
}
```
