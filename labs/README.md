# kernelspace forge — local labs

Real Rust. Your machine. Zero servers.

Each lab is a small crate. You edit exactly one file (marked `TODO(you)`),
prove it with `cargo test`, compile it to WebAssembly, and drop the `.wasm`
onto the lab page — the site runs the **same checks** and records your
completion. No account, no upload of your code, nothing leaves your machine
except nothing at all.

## The three lanes

**Lane A — your own machine (fastest if you have Rust)**

Open any Forge drill or lab page and copy its **one-command workspace** line.
It creates a fresh directory, downloads that exercise's standalone ZIP,
extracts it, and enters the correct crate. The command stops rather than
overwriting the directory if you already started that exercise. Then:

```sh
rustup target add wasm32-unknown-unknown   # one time
cargo test                                  # red → green
cargo build --release --target wasm32-unknown-unknown
# drop target/wasm32-unknown-unknown/release/<crate_name>.wasm
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
3. `cargo test` until every check is green. The terminal and the site
   run the identical suite — if it's green here, it's green there.
4. **Build the wasm** (`--release`, target `wasm32-unknown-unknown`).
5. **Drop the `.wasm` onto the lab page.** It runs in your browser, in a
   sandbox, against the same checks. All green → lab complete (+XP).

A `todo!()` left in your code makes the module trap — the site shows
"not implemented yet". That's a feature, not a bug.

## Rust Zero drills

| lesson | crate | focus |
|---|---|---|
| R1 | `rust-zero/r1-bindings/` | bindings, types, expressions |
| R2 | `rust-zero/r2-control-flow/` | functions, loops, match |
| R3 | `rust-zero/r3-ownership/` | moves, clones, drops |
| R4 | `rust-zero/r4-borrowing/` | references and slices |
| R5 | `rust-zero/r5-modeling/` | structs, enums, Option, Result |
| R6 | `rust-zero/r6-collections/` | Vec, HashMap, iterators |
| R7 | `rust-zero/r7-smart-pointers/` | Box, Rc, Arc |
| R8 | `rust-zero/r8-interior-mutability/` | Cell, RefCell, Mutex |
| R9 | `rust-zero/r9-lifetimes/` | practical lifetime contracts |
| R10 | `rust-zero/r10-atomics/` | atomics and orderings |

## Systems labs

| # | lab | track | you build |
|---|-----|-------|-----------|
| 01 | `rust-allocator/` | T1 | free-list allocator: split, coalesce, align, reuse |
| 02 | `kv-block-manager/` | T5 | vLLM's block manager: block tables, fork+CoW, refcounts |
| 03 | `bpe-tokenizer/` | T5 | byte-level BPE: ranked merges, UTF-8 roundtrip, exact-id contract |
| 04 | `mpmc-queue/` | T2 | Vyukov MPMC: sequence numbers, CAS cursors, + a native race fuzzer |
| 05 | `toy-executor/` | T3 | async executor: wakers, poll loop, block_on, nested spawn |
| 06 | `batching-scheduler/` | T5 | admission policy: goodput under SLO, convoys, aging, headroom |
| 07 | `radix-cache/` | T5 | automatic prefix caching: longest match, CoW sharing, leaf LRU, hit rate |
| 08 | `xgrammar-lite/` | T6 | JSON Schema → pushdown matcher → whole-BPE-token masks + compile cache |

### Lab 08 structured-output contract

`xgrammar-lite` deliberately separates tokenizer tokens from grammar bytes.
The harness parses a practical JSON Schema subset; the student compiles it to
a pushdown matcher and speculates each complete lab-03-style BPE token through
that machine. A token may cross a quote, colon, comma, and value boundary, so
checking only its first byte is wrong. The native overhead check calibrates a
512-token mask in microseconds; the WASM check runs the same semantic workload
without relying on a browser clock. Equivalent normalized schemas must reuse
one compiled program through the cache.

### Lab 06 trace calibration

`batching-scheduler` keeps six checks, but its final goodput check now races
the policy across three fixed distributions. These numbers were measured with
`cargo run -p batching-scheduler --example calibrate` against the exact tables
shipped in the crate; the reference column uses the private reference policy.

| scored trace | requests | FCFS | pure SJF | reference | pass floor |
|---|---:|---:|---:|---:|---:|
| synthetic fleet overload | 400 | 10.0% | 62.5% | 62.5% | 55.0% |
| BurstGPT v2 busiest-hour slice | 480 | 55.0% | 91.5% | 90.6% | 85.0% |
| LMSYS published-aggregate shape | 360 | 54.2% | 76.7% | 76.7% | 70.0% |

The reference mean is 76.6%. BurstGPT and the response-heavy LMSYS shape both
separate FCFS from size-aware admission, while the independent starvation
check prevents pure SJF from passing the lab. Trace provenance and the LMSYS
redistribution constraint are documented in `public/traces/README.md` in the
full repository and encoded in the JSON artifacts used by Fleet.

## How grading works (honesty box)

The checks live in `src/lib.rs` of each lab — read them, that's allowed.
The site trusts the module you drop; this is the honor system, like every
problem set you've ever done. Your portfolio artifact is the repo with your
commit history, not our database. (A verified-badge server path is planned;
your local pass will be re-gradable retroactively.)

## Don't lose your work (two answers, both trivial)

**Your code → git.** On day one, inside the unzipped folder:

```sh
git init && git add -A && git commit -m "lab 01: template"
# then one commit per green check:
#   git commit -am "boot+align green"
```

That repo — with its commit history — IS your portfolio artifact. Push it
to a private GitHub repo and your work survives any laptop.

**Your progress → JSON snapshot.** Everything the site tracks (lessons,
quizzes, lab completions, XP, achievements, Fleet Week scores + design
doc) lives in your browser's localStorage. Export a snapshot anytime from
the **Progress page → data ownership → Export**, and re-import it on any
device/browser. Local by default, portable on demand.
