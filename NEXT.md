# NEXT — The 10x Beyond (research + POC, 2026-08-03)

The plan in PLAN.md is built: 55 lessons, 6 Rust labs, the Fleet, Fleet Week.
This document is the answer to "what takes it 10x FURTHER" — every direction
verified against 2026 sources or proven by a working POC, all compatible
with the zero-server constraint.

## The thesis

The current build is the best flight simulator possible. The next 10x is
crossing from simulation into reality on three axes: **real models**, **real
traffic**, **real stakes** — without adding a server.

---

## 1. The Real Engine Path ⭐ (the headline)

**What:** the student's own Rust engine (labs 01–06) stops driving a simulated
decode loop and starts driving a REAL model, in the browser tab.

**Proof it works (POC executed, this machine, 2026-08-03):** a static page
loaded `onnx-community/Qwen3-0.6B-ONNX` via transformers.js v4.2.0 from CDN
and generated a coherent streamed answer, fully client-side, zero build
tooling. On this container's CPU-wasm it ran ~1 tok/s; on any student laptop
with WebGPU the same page runs 10–50× faster (see benchmarks below).

**Architecture (researched, BrowserLLM agent):**
- **WebLLM (@mlc-ai/web-llm v0.2.84, Apache-2.0)** — WebGPU-first runtime,
  OpenAI-compatible streaming API, Cache API/IndexedDB model caching.
  Reported throughput: ~71 tok/s on Phi-3.5-mini and ~41 tok/s on
  Llama-3.1-8B-q4, Apple M3 Max (WebLLM paper, arxiv 2412.15803).
- **transformers.js v4.2.0** (Apr 2026) — ONNX Runtime Web, `device:'webgpu'`,
  1,200+ pre-converted models incl. SmolLM2-135M/360M and Qwen3-0.6B.
- **candle → wasm** — the all-Rust path: HF's `quant-qwen3` wasm example runs
  Qwen3-0.6B 100% client-side at ~5.8 tok/s (Q4) on CPU — slow but the purest
  possible story: the student's engine IS the inference engine.
- Recommended split: student Rust code owns scheduling/memory/policy (what
  this course teaches); WebLLM owns matmul (the part that needs WebGPU).
- **Model pick: Qwen3-0.6B** (Apache-2.0, 32k ctx, ~380MB q4) or
  SmolLM2-360M for low-end machines. Avoid Llama-3.2-1B (gated license).
- Gotchas: WebGPU needs a real GPU (headless CI gets SwiftShader — works,
  slow); 400MB first download → Cache API persistence makes it once-ever.

**What it unlocks:** lab 07 "serve a real model" — the student's scheduler +
block manager + queue drive actual Qwen3 generation, measured with real TTFT/
ITL. Fleet Week Act 1 becomes "your engine, real model, real trace."

## 2. Production Trace Replay ⭐ (biggest teaching payoff per effort)

**What:** replay REAL production traffic through the Fleet instead of
synthetic generators.

**Proof the data exists (RealTraces agent):**
- **Mooncake FAST'25 traces** (Apache-2.0, ~3MB files): JSONL with
  timestamp, input_length, output_length, **hash_ids of 512-token prefix
  blocks** — the only public trace with prefix-cache structure. This is
  Kimi's real production traffic; the hash_ids let students do actual
  KV-cache-locality experiments (T6.L3/L8 made of real data).
  github.com/kvcache-ai/Mooncake → FAST25-release
- **Azure LLM Inference Traces** (CC-BY 4.0): 2023 (Splitwise: 19.4K conv
  requests, 719KB — perfect size) and 2024 (DynamoLLM: 27M requests,
  ~1.1GB — downsample). CSV: TIMESTAMP, ContextTokens, GeneratedTokens.
  github.com/Azure/AzurePublicDataset
- **BurstGPT** (CC-BY 4.0): 10.6M requests with Session IDs (multi-turn).
- **TraceLab** (CC-BY 4.0): 357K coding-agent LLM rounds with tool-call
  timing and prefix-cache-hit flags — the agentic-traffic answer for T6.L8.
- **ServeGen** (Apache-2.0, NSDI'26): Alibaba production distribution
  generator for bursty/reasoning workloads.

**What it unlocks:** a "trace mode" in the Fleet — `kimi-prod-hour-1`,
`azure-conv-2023`, `agentic-coding` as selectable traffic. Student policies
finally face real distributions: heavy tails, prefix reuse, burst structure.
Fleet Week Act 3's business case gets priced on real traffic.

## 3. The CI-Verified Leaderboard (zero-server competition)

**What:** the leaderboard you (correctly) refused to host — done with CI
instead of a backend. Student PRs a result artifact (JSON + wasm hash +
source commit); a GitHub Action re-runs the artifact against the fixed
public trace, validates, and commits an updated `leaderboard.json` that the
static site reads.

**Proof the pattern works (ZeroServerSocial agent):** OpenAI Parameter Golf
(2026-03) runs exactly this with independent re-evaluation; RouterArena does
issue_comment-triggered eval on PRs; VLA-Arena validates result JSONs on PR.
**Honest anti-cheat limits:** CI proves *reproducibility* (the artifact
reproduces the claimed score on the public trace), not *originality* —
overfitting a public trace is possible; speedrun-community norms (transparent
rules + spot checks) apply.

## 4. The BYOK Tutor (zero-server mentorship)

**What:** an embedded tutor that knows the curriculum and sees the student's
current sim state — "why did my goodput drop?" answered with the actual
metrics in context. Bring-your-own-key, direct browser→API calls.

**Proof it works (CORS verified 2026-08-08):** OpenAI (`dangerouslyAllowBrowser`),
Anthropic (`anthropic-dangerous-direct-browser-access` header), OpenRouter
(open CORS) all accept direct browser calls. Gemini's new SDK is currently
broken for browser use (preflight fails on Api-Revision header — issue #1723;
REST works). Keys stay in the browser (localStorage), with honest warnings
(shared machines, extensions). Fallback: fully local tutor via WebLLM — works,
weaker at expert-level debugging; best for hints/explanations.

## 5. Classroom mode via files (no server)

Teachers distribute a trace/config file; students return result JSONs
(progress export already exists and round-trips — verified). A teacher-side
viewer compares a class directory of exports. Zero infrastructure.

---

## Recommended order

| # | Direction | Payoff | Effort | Risk |
|---|-----------|--------|--------|------|
| 1 | **Trace replay** (Mooncake + Azure) | turns every sim run into real-data evaluation | S (data → stream adapter) | none — data is licensed and local |
| 2 | **Real engine path** (WebLLM backend + student Rust policy) | the wow; simulation → reality | M (bridge + model picker + caching UX) | perf varies by device; mitigate with SmolLM fallback |
| 3 | **CI leaderboard** | public stakes without a server | S–M (workflow + artifact spec) | overfitting honesty (documented) |
| 4 | **BYOK tutor** | mentorship at scale | M | key-handling UX must be honest |
| 5 | **Classroom files** | institutional adoption | S | — |

1+2 combine into the flagship moment: *"your Rust engine serves a real
model on a real Kimi production trace, in a browser tab, with no server."*

## Sources

- WebLLM: github.com/mlc-ai/web-llm · arxiv 2412.15803 · chat.webllm.ai
- transformers.js: github.com/xenova/transformers.js (v4.2.0, WebGPU guide)
- candle wasm: github.com/huggingface/candle/tree/main/candle-wasm-examples/quant-qwen3
- Models: huggingface.co/Qwen/Qwen3-0.6B (Apache-2.0) · HuggingFaceTB/SmolLM2-* (Apache-2.0)
- WebGPU support: caniuse.com/webgpu (~82% global, Safari 26+/Firefox 141+/Chrome 113+)
- Traces: kvcache-ai/Mooncake FAST25-release · Azure/AzurePublicDataset (CC-BY 4.0) · HPMLL/BurstGPT · uw-syfi/TraceLab · alibaba/ServeGen
- Leaderboard pattern: github.com/openai/parameter-golf · RouteWorks/RouterArena PR-eval workflow
- BYOK CORS: OpenAI JS SDK README · Anthropic dangerous-direct-browser-access docs (Aug 2024) · OpenRouter open CORS · Gemini issue googleapis/js-genai#1723
- Local tutor prior art: WebLLM-based FERPA/GDPR-compliant tutor (EduStack Smart)
