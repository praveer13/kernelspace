# Attribution for the physics points snapshot

Checked 2026-10-18 (docs/specs/s5.md §4.6, S5-D30). The files here are tooling data for the fleet physics v2 fit and its gate (`docs/physics/protocol.md`). No module under `src/` imports them, and nothing in them ships to a learner's browser.

| File | What it is |
|---|---|
| `inferencex-l70-2025-10-29.json` | 285 rows reduced from the pinned InferenceX response, selected fields only, copied unmodified (see "What the values are") |
| `nim-llm-1.8.0.json` | 478 rows parsed from NVIDIA's NIM LLM benchmarking page, for printed validation only |
| `LICENSE-InferenceX.txt` | The InferenceX repository's `LICENSE` at the harness commit, byte for byte |

## Source

InferenceX by SemiAnalysis, https://inferencex.semianalysis.com. The data is the Llama-3.3-70B-Instruct sweep of 2025-10-29 from its public API, pinned by this query:

`https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true`

On 2026-10-18 it returned 681 rows, 1,026,817 bytes, sha256 `d2ce48fdbd84936994d68bb28413f0e842da3b01a2c7a0958e4041699dc19792`. `bun scripts/fetch-physics-points.ts --online` re-fetches it and compares every kept member byte for byte.

The rows kept here cite three GitHub Actions runs of the InferenceX repository, one per sequence shape:

- 1024 in / 1024 out: https://github.com/SemiAnalysisAI/InferenceX/actions/runs/18924448230/attempts/2
- 1024 in / 8192 out: https://github.com/SemiAnalysisAI/InferenceX/actions/runs/18924543242/attempts/2
- 8192 in / 1024 out: https://github.com/SemiAnalysisAI/InferenceX/actions/runs/18924487526/attempts/3

The harness is the open repository github.com/SemiAnalysisAI/InferenceX (Apache-2.0) at commit `9596d23d74e9e1e4f4bcdb27572c87cafb746a02`. At that commit its README was titled "InferenceMAX™"; the project is now called InferenceX™.

InferenceX™ is a trademark of SemiAnalysis.

## What the values are

They are official InferenceX results as published on 2025-10-29, copied unmodified for the selected fields. Every kept row is a whole row of the response reduced to `id, hardware, framework, precision, spec_method, disagg, is_multinode, decode_tp, conc, isl, osl, mean_tpot, median_ttft, run_url`. Each value is the response's own number, and `--online` checks that each `"name":value` occurs verbatim in that row of the response. The selection is 165 rows of the protocol (H100 FP8, B200 FP8 and B200 NVFP4, vLLM, no speculative decoding, one node, no disaggregation) and 120 control rows (MI325X and MI355X FP8, same filters).

The course's fitted model, its parameters and its predictions are this course's own work. They are not InferenceX results and are never labelled as such.

InferenceX's README asks that results from forks and other repositories be labelled: "Only SemiAnalysisAI/InferenceX repo contains the Official InferenceX™ result, all other forks & repos are Unofficial ... Unofficial must be explicitly labelled as Unofficial." (README of github.com/SemiAnalysisAI/InferenceX, read 2026-10-18.) The values here come from the official API and are not re-run or altered, so they are official results; the course does not publish benchmark runs of its own.

## Which grant the redistribution relies on

- **The data** (the 285 rows of measurements): the answers on InferenceX's about page, https://inferencex.semianalysis.com/about, read 2026-10-18:
  - "Can I use InferenceX data for my own analysis?" Answer: "Yes. All data is freely available. The dashboard lets you filter by chip, model, framework, and date range, and you can export raw CSV data directly from any chart."
  - "Is InferenceX open source?" Answer: "Yes. Code, data, and dashboard are all open-source."
- **Material from the repository** (the licence text kept beside this file, and any harness setting quoted from its workflows and scripts): the Apache License 2.0 of the repository, https://github.com/SemiAnalysisAI/InferenceX/blob/9596d23d74e9e1e4f4bcdb27572c87cafb746a02/LICENSE. `LICENSE-InferenceX.txt` is that file byte for byte (git blob `34b03e8cf3d38011cc0b0f28d88d70b06b2b7a67`, 11,389 bytes), which is what Apache-2.0 section 4(a) asks of a redistribution. The repository has no NOTICE file at that commit (its root holds `.github`, `LICENSE`, `README.md`, `benchmarks`, `runners` and `utils`), so section 4(d) adds nothing. The repository's README (2026-10-18) says "InferenceX™, an open-source, under Apache2 license, automated benchmark".

What this does not settle: the site's footer reads "© 2026 semianalysis.com. All rights reserved.", and the about page is a published answer, not a licence instrument. The build relies on the about page's answer for the data, and the project owner confirms it against the InferenceX terms before this snapshot merges (owner question O6, field gate F3). If the answer is "no", the fallback of spec §4.6 applies: the extract keeps only `id` and `run_url`, and `--online` fetches the values for a full run.

## The NIM panel

`nim-llm-1.8.0.json` is the Llama results tables of NVIDIA's "NIM LLM Benchmarking: Performance" page (document version 1.0.0), https://docs.nvidia.com/nim/benchmarking/llm/1.0.0/performance.html, parsed from its Markdown rendering (`.../performance.md`, 47,226 bytes, sha256 `4fe76cd9ae97afb0848970dbe4da44f61695c3b653bceb210742ad52635afc6e`, fetched 2026-10-18). It holds the 478 table rows with the page's own numbers and units, and is used only for a printed cross-harness check: it is never fitted and never gated (spec §4.4). The page carries a copyright line and states no licence for its tables. That is outside the O6 answer above, so the owner's check (F3) should cover it too. The fallback is to keep only the source URL and the sha256 of this file.
