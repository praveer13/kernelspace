# kernelspace

**From cache lines to continuous batching.** The interactive course that takes
backend engineers from deploying APIs to reading the vLLM paper — systems
programming for LLM serving at scale.

**Live: https://kernelspace.naigap.com**

No signup, no servers. Every lesson, simulator, and lab check runs in your
browser; progress lives in `localStorage` and is exportable.

## What it is

Most LLM-infrastructure content is either API-level tutorials or assumes you
already speak systems. kernelspace starts at transistors and the memory
hierarchy, ramps Rust from zero, and ends with you building the pieces of a
vLLM-style engine yourself: paged KV cache, prefix caching, continuous
batching, structured output, cache-aware fleet routing — and defending every
choice with a measured number.

**Audience:** Java/Python backend engineers. No prior systems knowledge or
C++ assumed.

## Curriculum — 68 lessons, 9 tracks

| Track | Name | Lessons | Promise |
|---|---|---|---|
| R | Rust Zero | 10 | You know how to program. Now learn how Rust thinks. |
| T0 | Foundations | 6 | The machine under the abstraction: transistors to pointers. |
| T1 | C-Level Mental Model | 6 | Memory, pointers, and allocators — no GC to save you. |
| T2 | OS & Concurrency | 7 | Virtual memory, scheduling, and races — the 1970s toolkit. |
| T3 | Rust for Systems | 7 | Ownership as a compile-time memory protocol. |
| T4 | GPU Architecture | 7 | SMs, HBM, rooflines — why bandwidth is the whole game. |
| T5 | LLM Serving Systems | 10 | PagedAttention, prefix caching, continuous batching. |
| T6 | Mega-Scale Serving | 10 | MoE, wide EP, disaggregation, FP4 — the production canon. |
| T7 | Economics & SLO Engineering | 5 | Goodput, honest benchmarks, the frontier, the invoice. |
| T* | Capstone | 7 steps | Build a toy inference engine: tokenize → batch → measure. |

Plus a per-track paper spine and quarterly Field Notes keeping
landscape-sensitive lessons current.

## The Forge — real Rust, graded by real tests

Eight systems labs plus ten Rust Zero drill crates. Each lab is a small crate:
you edit one file marked `TODO(you)`, prove it with `cargo test`, compile to
WebAssembly, and drop the `.wasm` onto the lab page — the site runs the same
checks in-browser. Nothing leaves your machine.

- `rust-zero/r1…r10` — drill crates backing the Rust Zero track
- `rust-allocator` · `bpe-tokenizer` · `kv-block-manager` · `mpmc-queue`
- `batching-scheduler` · `radix-cache` · `toy-executor` · `xgrammar-lite`

Three ways to run them: your own toolchain, VS Code Dev Containers, or
GitHub Codespaces (`.devcontainer` included). See `labs/README.md`.

## Simulators, Fleet, and Fleet Week

Nine Rust-to-WASM simulators run 100% in the browser: memory hierarchy,
roofline model, quantizer, KV-cache pressure, continuous batching, and more.
**Fleet** lets you operate a simulated serving cluster (engine, cluster, and
EPD modes); **Fleet Week** is a four-act production scenario with a metrics
dashboard requirement.

## Opt-in leaderboard

The site is local-first — a personal best stays in your `localStorage`.
Public ranking is an explicit, separate choice: open a PR with your release
WASM and a signed manifest under `submissions/`. CI verifies the checksum and
re-runs the benchmark. See `submissions/README.md`.

## Development

Requires Node.js 20+ and [Bun](https://bun.sh).

```sh
bun install
bun run dev        # vite dev server
bun run lint       # eslint, must exit 0 before every commit
bun run build      # tsc -b && vite build
bun run preview    # serve the production build locally
```

Utility scripts: `bun run verify:traces`, `verify:leaderboard`,
`verify:field-notes`, `leaderboard:build`. Lab crates are packed for download
with `python3 scripts/pack-labs.py`.

## Repository layout

```
src/            React + TypeScript + Vite site (Tailwind, shadcn/ui)
  data/lessons/ lesson content, one folder per track (r, t0–t7)
  data/labs.ts  forge lab registry (check ids must match the crates)
  lib/          tracks, progress store, achievements
  pages/        Home, Curriculum, Lesson, Forge, Fleet, FleetWeek, …
labs/           Rust lab crates (templates + harness; _solutions never ship)
public/         static assets: badges, traces, lessons-md
scripts/        build/verify tooling (leaderboard, traces, lab packing)
submissions/    opt-in leaderboard entries (WASM + manifest PRs)
.github/        Pages deploy + leaderboard CI
```

Deployment is automatic: pushes to `master` build and publish to GitHub
Pages (custom domain `kernelspace.naigap.com`).
