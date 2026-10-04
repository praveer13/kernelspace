# Forge without a local toolchain: zero-server options (as of 2026-10-03)

**Goal:** cut time-to-first-green for a Java/Python engineer on kernelspace's 8 labs and 10 drills, without the owner running any server.

**How this was researched:** primary sources (GitHub repos and APIs, official docs, live endpoint tests) plus benchmarks on an i5-13600KF (20 threads, Linux) with Node 22.22 / V8 12.4, Wasmtime 46.0.3 and headless Chromium 149. Web search was unavailable; sources were fetched directly. Gaps are marked **[unverified]**.

## Bottom line

1. **Near-term best: a GitHub "build bot".**
   - The learner creates a repo from a template once, edits the `TODO(you)` file in github.dev or Codespaces, and commits.
   - A workflow in *their* repo runs `cargo test` and builds the wasm, then pushes the results to a `ks-build` branch.
   - The lab page fetches `raw.githubusercontent.com/<o>/<r>/<sha>/…` (which sends CORS `*`) and grades it with the existing `runLabWasm`.
   - No toolchain, ZIP, terminal or drag-and-drop. Free on public repos. Each try takes about 30–60 s (estimated from measured step times).
2. **Long-term best: compile inside the page.**
   - A rustc compiled to WebAssembly, with LLVM and lld built in, already exists (oligamiq/rust_wasm, built on bjorn3's patches).
   - I used it to compile the real kernelspace crates to `wasm32-unknown-unknown`. The modules load with `{}` imports, and a solved copy of the R1 drill passed 6/6 checks through the existing ABI.
   - On V8, with a 60-line threads harness I wrote, each crate took **0.7–1.6 s**. The first download is about **36 MiB** (brotli), then cached.
   - What's left is engineering and maintenance:
     - the only usable build is rustc **1.83.0-dev (Sept 2024)**, with patches that are not upstream;
     - it needs cross-origin isolation;
     - it uses about 1–1.8 GB of RAM;
     - the only browser IDE built around it today (rubrc) runs 5–55× slower than the compiler itself.
3. **Add-on for the Rust Zero drills: Miri compiled to wasm.** It gives real rustc type and borrow errors in 0.09–0.7 s, runs the drills in the browser, and needs no special response headers. It is far too slow for the systems labs: lab 06's checks took 382 s.
4. **Rust Playground API: opt-in only, and only after asking its maintainers.** It works today: CORS allows any origin, and its wasm target returns WAT text. But it is one community-funded server with a 10 s cap and no published API terms, and it breaks the labs' promise that nothing leaves your machine.
5. **Rejected:** Godbolt (text output only), WebContainers/StackBlitz (no Rust), CodeSandbox SDK (owner-billed servers), Firebase Studio (shutting down), Gitpod→Ona and Replit (paid), rust-analyzer-wasm (stale; no borrow checker since Aug 2026).

## Ranked options

| Rank | Option | Owner servers? | Learner setup | First download | Time per try | Main risk |
|---|---|---|---|---|---|---|
| Near-term #1 | Template repo + Actions build bot | none (GitHub only) | GitHub account; click *Use template* once | none | ~30–60 s (est.) | solutions are public; 60 API requests/h per IP; tied to GitHub |
| Long-term #1 | In-page rustc+LLVM in wasm, with a small runtime of our own | none (static files on Pages) | none | ≈36 MiB, cached | 0.7–1.6 s measured on V8 (Node); 7–79 s inside rubrc today | old patched compiler; isolation headers; memory |
| Add-on | Miri in wasm, for drills and error checking | none | none | ~54 MB | 0.09–0.7 s to check; drills <0.5 s | June-2024 nightly; too slow for labs |
| Opt-in | Playground `/compile` → WAT → wasm | community server | none | 0.23 MB helper | ~2–5 s (est.) | ethics, no terms, 10 s cap, privacy |
| Keep | Codespaces / devcontainer (lanes B/C) | none | GitHub account; 1–3 min to boot [unverified] | 960 MB image (on GitHub's side) | ~1 s, native | uses the learner's 120 core-hours/month |
| Reject | Godbolt, WebContainers, CodeSandbox, Firebase Studio, Ona, Replit, rust-analyzer-wasm | — | — | — | — | §2, §5, §6 |

## 1. rustc in the browser

### Where the ecosystem stands
- **Cranelift can't produce wasm.** rustc_codegen_cranelift supports only x86_64, AArch64, riscv64 and s390x, so wasm32 output needs LLVM.
- **Linking needed a fix.** bjorn3's cranelift-in-browser demo stops at linking because "rustc doesn't have a builtin linker". He got lld linking working inside rustc on 2024-09-26 (bjorn3/rust PR #8).
- **The build in use is oligamiq's.** He builds rustc+LLVM+lld for `wasm32-wasip1-threads`, using whitequark's LLVM port to WASI.
  - Binaries are published as GitHub Releases, mirrored to GitHub and Cloudflare Pages; v0.2.1 came out 2026-08-29.
  - The build workflow pins a patched source tree at commit `cf327c2` (1.83.0) and takes about 3.5 h per Actions job.
  - The repo has no LICENSE file. Either ask the author or build it yourself.
- **Upstream has only part of it.** A subset of the patches went upstream (rust-lang/rust#130899, 2024). bjorn3's newest branch, `compile_rustc_for_wasm20`, is rebased onto 1.96.0 (Apr 2026) and still marked "[WIP]".
- **bjorn3's own caveats:** wasm has no mmap, "which rustc needs for performance reasons", and threads are "important for performance".
- **Runtime support is shrinking.** Wasmtime 47.0.0 (2026-07-20) removed wasi-threads, which it now calls "legacy". In browsers you depend on JS shims, and the threads shim's README says: "Firefox failed to run the demo … Chrome worked fine."
- **rubrc v2 (oligamiq) is the only browser IDE around this compiler.**
  - Its toolchain (rustc, cargo, LLVM/clang, rust-analyzer, a virtual filesystem and a shell) is one 384 MB wasm file, served as 55.9 MB of brotli in parts of at most 24 MiB.
  - The UI is Monaco plus xterm.js.
  - Its README says "not yet ready for general production use"; dependencies and proc-macros are unsupported.

### Measurements
All rows use the same `rustc_opt.wasm` (95.3 MB), which reports `rustc 1.83.0-dev`, host `wasm32-wasip1-threads`. Every build targets `wasm32-unknown-unknown`.

| Runtime | R1 drill | kv-block-manager | lab 06 (~1.9k lines) | xgrammar-lite |
|---|---|---|---|---|
| Native rustc 1.96, host target (baseline) | — | 0.19 s | 0.29 s | 0.25 s |
| Wasmtime 46, compiled ahead of time | 0.14 s (+ kit 0.20 s, harness 0.09 s) | 0.39 s | 0.63 s | 0.72 s |
| **V8 (Node 22) + my wasi-threads harness, fresh process each run** | **0.80 s** (+ kit 0.9 s, harness 0.7 s) | **1.23 s** | **1.48–1.55 s** (opt-level 0: 0.94–1.05 s; type/borrow check only: 0.56 s) | **1.60–1.64 s** |
| rubrc v2 in headless Chromium 149, via cargo | 7.4–9.7 s debug, 10.6–11.9 s release (as a single file) | — | 54–56 s debug, 49–79 s release | — |

- **The output is valid.** Each module exports `memory`, `ks_run`, `ks_alloc` and `ks_free`. The solved R1 copy gave 6/6 PASS, and the template stubs trap, which the page reports as "not implemented yet".
- **First load in the browser (rubrc, on a fast connection):** 56.2 MB downloaded and the shell was ready in 7–9 s. The `wasm32-unknown-unknown` standard library is a further 18.1 MB download, which unpacked to 67.8 MB in 2.7 s.
- **Problems I hit in rubrc:**
  - Calling `rustc` directly crashed the compiler (`panicked at std/src/sys/pal/wasi/os.rs:106:5: unsupported`), although `cargo build` worked.
  - Source containing non-ASCII characters reached its virtual filesystem as invalid UTF-8.
  - Later edits never reached the file, so builds went stale. Every file there carries the same 1 January timestamp. This last problem may partly come from my automation.
- **Memory:** Node's peak memory was 0.83–1.79 GB, depending on codegen-units and opt-level. The module caps shared memory at 1 GiB. Phones are **[unverified]**.
- **Interpretation:** the compiler is fast on V8, so rubrc's slowdown is in its own runtime layer. I did not profile it, so the cause is unconfirmed.

### What kernelspace would need
- **Files to host:**
  - `rustc_opt.wasm.br`: 18.8 MiB.
  - The `wasm32-unknown-unknown` standard library: 17.2 MiB brotli, 27 rlibs. libtest, proc_macro and getopts can be dropped.
  - The `kslab` and harness rlibs, about 70 KB, precompiled by *the same* compiler build.
- **Hosting:** kernelspace's own Pages site works.
  - The site limit is 1 GB.
  - The soft bandwidth limit is 100 GB/month, about 2,650 first-time downloads.
  - Cache the files in Cache Storage under content-hashed URLs.
- **Cross-origin isolation:**
  - kernelspace.naigap.com currently sends neither COOP nor COEP, and Pages can't add custom headers.
  - coi-serviceworker can add them. It reloads the page once on first visit and must be served from our own origin.
  - Google Fonts would then need CORS or COEP `credentialless`.
- **A small runtime of our own:**
  - one worker per wasm thread;
  - an in-memory filesystem shared across workers;
  - `--error-format=json`, so errors can be shown inline in the editor.
- **Keeping the compiler current:** rebuild it in kernelspace's own Actions from bjorn3's 1.96 branch. Whether that branch builds with LLVM is **[unverified]**.
- **Licences:** rustc is MIT/Apache-2.0; rubrc is MIT OR Apache-2.0; browser_wasi_shim is MIT/Apache-2.0; coi-serviceworker is MIT.

### Miri compiled to wasm (rubri, MIT)
- **What it is:** bjorn3's June-2024 Miri, run without its undefined-behaviour checks.
- **Download:** 54 MB first load (15.2 MB Miri plus 39 MB standard library).
- **Hosting:** no isolation headers needed.
- **Speed, measured on Node:**
  - type or borrow errors: 86–93 ms;
  - lab 06 full type and borrow check: 659 ms;
  - R6 drill suite: 378 ms;
  - **lab 06 check suite: 381.8 s**, against 10 ms native.
- **Precedent:** x0k/ppp (MIT, active Aug 2026) already ships a Miri-based Rust runtime in the browser.

## 2. Third-party compile services

### play.rust-lang.org
- **API:** `POST /compile` with `{target:"wasm", …}` runs `cargo build --target=wasm32-unknown-unknown` plus wasm-tools demangle, and returns **WAT text**.
  - `code` can be a list of files, an undocumented feature added 2026-05-05.
  - Flattening a lab (inlining `kslab` as a module) gives 17–54 KB per request.
- **Converting WAT back to wasm:** wabt.js 1.0.39 fails on this WAT. A helper built from the `wat` crate works: 226 KB gzipped, 3–10 ms per lab.
- **CORS:** `*`, re-verified; only `content-type` is allowed.
- **Limits:**
  - a hard 10 s timeout that includes queueing;
  - 512 MB per container;
  - production is a single 4-vCPU c7a.xlarge.
- **Speed:** a tiny compile took 2.37 s live; labs would likely take 2–5 s (estimate).
- **Terms:** none published. mdBook's `book.js` calling `/evaluate.json` from every mdBook site is the only precedent.

### Godbolt
Rust targeting wasm32 works, but the API returns assembly or disassembly text only. Its docs warn of future rate limits or authentication. Not usable.

### Ethics
Both services are community-funded with no SLA, and the playground runs on one server. If kernelspace uses it, compile only on a click, cache by source hash, tell learners their code goes to rust-lang.org, keep the fallbacks, and **ask the Rust infra/playground maintainers first.**

## 3. GitHub-only pipeline

| Fetch path (tested with curl) | CORS | Caching | Usable? |
|---|---|---|---|
| `raw.githubusercontent.com/<o>/<r>/<sha>/…` | `*` | max-age=300; a SHA in the path means no stale copies | **yes** |
| `<user>.github.io` (Pages) | `*` | max-age=600; ignores query strings | yes, but slower and has to be switched on by hand |
| api.github.com without login | `*` | 60 requests/h per IP | yes, for polling |
| Release assets | none on any hop | — | no |
| Actions artifact zip | — | 401 even on public repos | no |
| jsDelivr `/gh/` | `*` | SHA URLs cached for 1 year | fallback; 20 MB per file |

- **Use a template, not a fork.**
  - Workflows start disabled on forks (`disabled_fork` state); a repo created from a template has them on.
  - There is a documented one-click link, `github.com/new?template_owner=…&template_name=…`.
  - `permissions: contents: write` lets the workflow push.
  - Pushes made with `GITHUB_TOKEN` don't trigger new runs, so there are no loops.
- **Latency:**
  - queue 1–21 s;
  - job setup and checkout 1–5 s;
  - toolchain plus `rustup target add` 7–11 s (the runner image has Rust 1.98.1 but no wasm target);
  - building the lab 0.2–0.4 s;
  - push plus a 10–15 s polling interval.
  - Estimated total: **20–45 s**. Deploying to Pages instead adds 15–20 s.
- **Billing:** standard runners stay free on public repos (stated in GitHub's Dec 2025 notice). Private repos get 2,000 minutes/month.
- **Failure modes:**
  - a learner forks instead of using the template;
  - the `permissions` block is missing;
  - organisation policies block write access;
  - the 60/h limit is shared behind a campus or corporate network;
  - solutions are public;
  - Actions outages;
  - runner image changes (`ubuntu-latest` moves to 26.04 in Oct–Nov 2026);
  - Node 20 was removed from runners on 2026-09-23. Use `checkout@v5` or later; kernelspace's own `deploy.yml` still pins `@v4`-era actions.

## 4. Codespaces and devcontainers
- **Free quota:** 120 core-hours (60 h on a 2-core machine) and 15 GB-month per month; Pro gets 180 core-hours.
- **The learner always pays.** Prebuilds bill the repo owner and don't carry over to template copies.
- **Image:** `devcontainers/rust:1-bookworm` is maintained and is 960 MB compressed.
- **Time to boot:** 1–3 min **[unverified]**. Compiling is trivial: 1.8 s for the whole workspace on 2 CPUs.
- **No quota changes in 2025–26.**
- **Best use:** as the editor that feeds the build bot, so drag-and-drop goes away.

## 5. WebContainers, StackBlitz, CodeSandbox and others
- **WebContainers:** can run WASI programs but has no rustc or cargo. It needs COOP/COEP, only Chromium is fully supported, and commercial, for-profit use of the API needs a licence.
- **CodeSandbox:** Devboxes are virtual machines billed to the SDK token owner, which breaks the no-server rule, and the SDK is now marked "legacy" under Together AI.
- **Firebase Studio:** "sunsetting on March 22, 2027"; signups have been closed since 2026-06-22.
- **Gitpod:** gitpod.io redirects to Ona ("Part of OpenAI"), which starts at $20/month.
- **Replit:** Core costs $20/month.

## 6. Partial in-browser helpers
- **rust-analyzer in wasm:**
  - The demo was archived in 2022: 4.3 MB brotli, and it needs isolation headers.
  - On 2026-08-05 rust-analyzer removed its own borrow checker ("Our borrowck is both hopeless and not important"), which dropped the `need-mut`, `unused-mut` and `moved-out-of-ref` diagnostics.
  - It still catches type, name and missing-match-arm errors, but not the ownership errors the R3/R4/R9 drills teach. Use rustc itself for those.
- **Aquascope:**
  - Its playground runs a WASM build on GitHub Pages with coi-serviceworker; its server is "now only used for debugging". First load is 58.6 MB.
  - Its mdBook plugin can render ownership diagrams in Actions at build time, so pre-render a few diagrams rather than embedding the playground.
- **Editors:** CodeMirror 6 with `lang-rust` is **162.5 KB** gzipped and works on phones (`@codemirror/lsp-client` adds 22 KB). Monaco is 701 KB gzipped and doesn't support phones. Choose CodeMirror.

## 7. Other approaches
- **cargo, Wasmtime or WASI components in the browser:** not needed. rubrc ships a `cargo_opt.wasm`, but the labs have no dependencies, so `rustc --extern` is enough. The browser is already the wasm engine and only needs a WASI shim. The labs import nothing.
- **Upstream wasm proc-macros:** rust-lang/rust#160981 merged in Aug 2026 and #157709 is open. They would eventually allow derive macros in a compiler running in wasm; the labs don't use them.

## Lab page UX

**Near-term (build bot):**
```
Lab 06 · batching-scheduler          [brief] [checks]
▶ Build in your browser — no install (recommended)
  ① [Create my lab repo ↗]  (once; github.com/new?template_owner=…)
  ② Repo: [ alice/kernelspace-forge ]  ✓ found, workflow present
  ③ [Edit TODO file in github.dev ↗]   [Open in Codespaces ↗]
  ● build a1b2c3d running — cargo test + wasm … 0:24
  ✔ 5/6 checks green  (same results panel as drag-and-drop)
  ▸ compiler / cargo test output (ks-build/lab06/build.log)
▸ Prefer your machine? Lanes A/B + drag-and-drop (unchanged)
```
- The repo name is kept in localStorage.
- The page polls `branches/ks-build` only while a build is pending and the tab is visible, and shows how much of the API allowance is left.
- The workflow uses `contents: write`, cancel-in-progress concurrency, `rustup target add`, and `cargo test | tee` so output survives failures. It then builds the release wasm and force-pushes one orphan commit containing `dist/*.wasm` and the logs.

**Long-term (compile in the page):** a CodeMirror editor opens on the `TODO(you)` file. The first **Compile & grade** downloads the compiler (36 MiB, once); later compiles take 1–2 s (projected), with JSON diagnostics as inline markers and results through `runLabWasm`. Without `crossOriginIsolated` or enough memory, the page falls back to the build bot. *Export to repo* keeps the git-portfolio story.

## Gates before long-term rollout
Labs compile in ≤3 s in Chrome and Firefox on a mid-range laptop; the compiler is under ~6 months old, rebuilt in our own Actions; Safari and phones are tested (both **[unverified]**); Pages bandwidth is monitored.

**Still unverified:** Codespaces boot time, whether prebuild minutes are free on public repos, CodeSandbox free-tier limits, and the playground's `/execute` with `tests:true`.

## Reproduction
In this scratchpad: `bench/rustcw.sh` (Wasmtime), `v8bench/` (V8 harness), `bench/runlab.mjs` (a copy of the page's ABI runner), `pw/rubrc-probe*.mjs` and `.log` (Chromium), `area2/` (playground and WAT helper), `miri-bench/`.

## Sources
- https://github.com/oligamiq/rubrc · https://rubrc.pages.dev/ · https://rubrc.pages.dev/assets/vfs.core-G3YEEGQv.wasm.br.json
- https://github.com/oligamiq/rust_wasm · https://github.com/oligamiq/rust_wasm/releases · https://github.com/oligamiq/rust_wasm/blob/main/.github/workflows/rustc_llvm_with_lld.yml
- https://oligamiq.github.io/rust_wasm/v0.2.1/rustc_opt.wasm.tar.gz · https://oligamiq.github.io/rust_wasm/v0.2.1/wasm32-unknown-unknown.tar.gz
- https://github.com/bjorn3/browser_wasi_shim (README, examples/rustc.html, threads/README.md)
- https://github.com/bjorn3/rust/tree/compile_rustc_for_wasm20
- https://github.com/rust-lang/rust/pull/130899 · https://github.com/rust-lang/rust/pull/160981 · https://github.com/rust-lang/rust/pull/157709
- https://github.com/rust-lang/miri/issues/722#issuecomment-2374830330 · https://github.com/rust-lang/miri/issues/722#issuecomment-2377422924 · https://github.com/rust-lang/miri/issues/722#issuecomment-1280044650
- https://github.com/rust-lang/rustc_codegen_cranelift
- https://raw.githubusercontent.com/bytecodealliance/wasmtime/release-47.0.0/RELEASES.md · https://github.com/bytecodealliance/rfcs/blob/main/accepted/wasmtime-remove-wasi-threads.md
- https://github.com/LyonSyonII/rubri · https://garriga.dev/rubri/ · https://github.com/x0k/ppp
- https://github.com/gzuidhof/coi-serviceworker
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://github.com/rust-lang/rust-playground/blob/main/ui/src/server_axum.rs · https://github.com/rust-lang/rust-playground/blob/main/compiler/base/cargo-wasm · https://github.com/rust-lang/rust-playground/blob/main/compiler/base/orchestrator/src/coordinator.rs · https://github.com/rust-lang/rust-playground/commit/2dee10d4c
- https://github.com/rust-lang/simpleinfra/blob/master/terraform/playground/instance.tf · https://github.com/rust-lang/simpleinfra/blob/master/ansible/roles/playground/defaults/main.yml
- https://github.com/rust-lang/mdBook/blob/main/crates/mdbook-html/front-end/js/book.js · https://rustfoundation.org/policy/privacy-policy/
- https://github.com/compiler-explorer/compiler-explorer/blob/main/docs/API.md · https://github.com/compiler-explorer/compiler-explorer/blob/main/docs/Privacy.md · https://godbolt.org/api/compilers/rust
- https://www.npmjs.com/package/wabt · https://crates.io/crates/wat
- https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template · https://docs.github.com/en/rest/actions/workflows · https://docs.github.com/en/actions/using-workflows/triggering-a-workflow
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api · https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests
- https://docs.github.com/en/billing/concepts/product-billing/github-actions · https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions · https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions
- https://raw.githubusercontent.com/actions/runner-images/main/images/ubuntu/Ubuntu2404-Readme.md · https://github.com/actions/runner-images/issues/14748
- https://raw.githubusercontent.com/jsdelivr/jsdelivr/master/README.md · https://docs.github.com/en/codespaces/the-githubdev-web-based-editor
- https://docs.github.com/en/billing/concepts/product-billing/github-codespaces · https://docs.github.com/en/codespaces/prebuilding-your-codespaces/about-github-codespaces-prebuilds · https://raw.githubusercontent.com/devcontainers/images/main/src/rust/README.md
- https://webcontainers.io/guides/browser-support · https://webcontainers.io/enterprise · https://blog.stackblitz.com/posts/announcing-wasi/
- https://github.com/codesandbox/codesandbox-sdk · https://docs.together.ai/docs/together-code-sandbox · https://firebase.google.com/docs/studio · https://ona.com/pricing · https://replit.com/pricing
- https://github.com/rust-analyzer/rust-analyzer-wasm · https://github.com/rust-lang/rust-analyzer/commit/ed03b3740084da2cb9fc847d0dd7cdf4c97106e3 · https://rust-analyzer.github.io/book/diagnostics.html
- https://github.com/cognitive-engineering-lab/aquascope · https://cel.cs.brown.edu/aquascope/
- https://codemirror.net/ · https://www.npmjs.com/package/@codemirror/lsp-client · https://github.com/microsoft/monaco-editor
