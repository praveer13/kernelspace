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

## Template v2: one check at a time, on fresh seeds

Lab 01 (`rust-allocator`) is on template v2; the other crates move to it
in later Wave 1 tasks and run as before until then. On a v2 lab:

- **Each check runs on its own**, in a fresh copy of your module. A
  `todo!()` in one function marks only the checks that reach it as "not
  implemented yet", with the panic's text and line; the rest still run.
- **Each check gets 2 seconds.** An infinite loop marks that one check
  `timeout`, and grading carries on with the next.
- **Seeded checks draw new inputs when you grade.** `cargo test` runs them
  on their default seeds and on 32 extra seeds, so a crate that is green in
  the terminal is green on the site's fresh seeds too. A pass on fresh
  seeds is what the site records as *unseen*.
- **`kslab::trace!("…")`** writes a line to a 16 KiB buffer the site shows
  under that check (handy when a check fails and you want to see what your
  code did).

Under the hood, `ks_run` reads a few input lines (`v 2`, `list`,
`only <id>`, `seed <u32>`; empty input still means "every check, v1
report"), and the kit adds `ks_abi_version`, `ks_panic_msg` and
`ks_trace_drain`. The module still has zero imports.

### Which lab 01 check catches which mistake

| check | catches |
|---|---|
| `boot` | `new` or a first `alloc` that does not work at all |
| `align` | offsets that ignore the requested alignment |
| `no_overlap` | two live spans sharing a byte (an off-by-one split) |
| `reuse` | a bump allocator that never hands a freed block back |
| `coalesce` | a `free` that does not merge with its free neighbours on both sides; the heap's tail is used up first, so only a merged run can serve the request |
| `fragmentation` | the same under churn at ~75% occupancy on fresh seeds: a request may fail only when no free span that large exists among your live blocks, so first-, best- and next-fit all pass |

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

## Seed calibration (maintainers)

Every seeded check must pass the reference solution on every seed, and
every known wrong design (a *mutant*) must fail a required check. Both are
measured offline, because reference solutions are private:

- Reference solutions and mutants live only in `labs/_solutions/<lab>/`
  (`allocator.rs`, `mutants/*.rs`). The directory is gitignored, never
  committed and never packed; `pack-labs.py` fails on any `_solutions` path.
- `bun scripts/calibrate-lab-seeds.ts <lab> <solution.rs|.wasm> --mutants
  <dir> [--n 10000] [--mutant-n 1000]` builds each source into a scratch
  copy of the crate, runs every seeded check on n fresh seeds, and writes
  `labs/<lab>/calibration.json` (the only committed result).
- `bun run verify:labs` (the labs workflow) requires that file for every v2
  lab, measured on the current `src/lib.rs`, with the reference at 1.0 on
  each check and each mutant failing a required check on ≥ 99% of seeds.
- A seeded check that cannot reach 1.0 either rejects and redraws inside the
  harness (deterministically from the seed) or becomes `seeded: false`.

Lab 01's calibration: 10,000 fresh seeds per seeded check, reference 1.0;
the `nocoal`, `coal-left`, `coal-right`, `bump`, `nosplit`, `misalign` and
`overlap` mutants each fail at least one required check on every seed.
Best-fit, next-fit, top-down and round-to-32-byte allocators that coalesce
pass every check on 2,000 fresh seeds each.

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
