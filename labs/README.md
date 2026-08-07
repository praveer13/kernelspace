# kernelspace forge — local labs

Real Rust. Your machine. Zero servers.

Each lab is a small crate. You edit exactly one file (marked `TODO(you)`),
prove it with `cargo test`, compile it to WebAssembly, and drop the `.wasm`
onto the lab page — the site runs the **same checks** and records your
completion. No account, no upload of your code, nothing leaves your machine
except nothing at all.

## The three lanes

**Lane A — your own machine (fastest if you have Rust)**

```sh
rustup target add wasm32-unknown-unknown   # one time
cd rust-allocator
cargo test                                  # red → green
cargo build --release --target wasm32-unknown-unknown
# drop target/wasm32-unknown-unknown/release/rust_allocator.wasm
# onto the lab page
```

Don't have Rust? `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
(Windows: https://rustup.rs)

**Lane B — VS Code Dev Containers (zero local setup)**

Open this folder in VS Code → "Reopen in Container". The image has the
toolchain and the wasm target preinstalled. Then the Lane A commands.

**Lane C — GitHub Codespaces (zero machine)**

Open the kernelspace repository in a Codespace — the repo's
`.devcontainer` gives you the same environment. Burns your free GitHub
quota, not ours.

## The loop

1. **Read the brief** on the lab page.
2. **Edit the one file** with `TODO(you)` markers. Nothing else.
3. `cargo test` until all six checks are green. The terminal and the site
   run the identical suite — if it's green here, it's green there.
4. **Build the wasm** (`--release`, target `wasm32-unknown-unknown`).
5. **Drop the `.wasm` onto the lab page.** It runs in your browser, in a
   sandbox, against the same checks. All green → lab complete (+XP).

A `todo!()` left in your code makes the module trap — the site shows
"not implemented yet". That's a feature, not a bug.

## Labs

| # | lab | track | you build |
|---|-----|-------|-----------|
| 01 | `rust-allocator/` | T1 | free-list allocator: split, coalesce, align, reuse |
| 02 | `kv-block-manager/` | T5 | vLLM's block manager: block tables, fork+CoW, refcounts |
| 03 | `bpe-tokenizer/` | T5 | byte-level BPE: ranked merges, UTF-8 roundtrip, exact-id contract |
| 04 | `mpmc-queue/` | T2 | Vyukov MPMC: sequence numbers, CAS cursors, + a native race fuzzer |
| 05 | `toy-executor/` | T3 | async executor: wakers, poll loop, block_on, nested spawn |
| 06 | `batching-scheduler/` | T5 | admission policy: goodput under SLO, convoys, aging, headroom |

## How grading works (honesty box)

The checks live in `src/lib.rs` of each lab — read them, that's allowed.
The site trusts the module you drop; this is the honor system, like every
problem set you've ever done. Your portfolio artifact is the repo with your
commit history, not our database. (A verified-badge server path is planned;
your local pass will be re-gradable retroactively.)
