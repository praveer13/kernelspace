# NEXT COURSES — what else deserves the kernelspace treatment

Researched 2026-08-03 (three parallel landscape studies, sources at the end).
The question: which subjects have the same shape as LLM serving — a physics
layer professionals use but can't reason about — and take the full formula:
bottom-to-expertise tracks, browser sims, local Rust labs graded in-browser,
a persistent simulated world, an adversarial capstone, agent-native tutoring.
Zero servers.

## The formula (what transfers, verbatim)

1. **Isomorphic teaching** — every idea mapped to something a backend
   engineer already owns (OS≡LLM was the prototype; JVM/Postgres/Netty
   analogies throughout).
2. **Sims as truth machines** — the physics made visible and interactive.
3. **Local-only Rust labs, browser-graded** — the zero-dep wasm ABI
   (`ks_alloc`/`ks_free`/`ks_run`/`ks_invoke`); `cargo test` ≡ site checks;
   traps render as "not implemented yet."
4. **A persistent world** — the Fleet pattern: student components plug in
   cumulatively and run against shared deterministic traffic.
5. **Calibrated adversarial scenarios** — thresholds proven against baselines
   (convoy/starvation), never guessed.
6. **A capstone that executes claims** — business cases recomputed, incident
   diagnosis graded on real telemetry.
7. **Agent-native tutoring** — llms.txt, per-lesson markdown, AGENTS.md in
   every lab zip. The student's own agent tutors; we see nothing.
8. **Zero-server, local-first** — honor system + exportable progress + git
   as the lab-work backup.

**Platform reuse (the actual 10x):** the kslab ABI, the zip/pack pipeline,
the progress store, the Fleet engine (admission/scheduling/memory sim), the
Fleet Week wizard, the conformance/divergence harness pattern — all carry to
any of the three subjects below with <20% rework.

---

## 1. DISTRIBUTED SYSTEMS CORRECTNESS — "byzantine" ⭐ top pick

**Pitch:** the Raft/Jepsen course the browser never got. MIT 6.824 is the
gold standard and it's Go-labs on a desktop; Jepsen's own training is
JVM/Clojure CLI. Nobody has a browser-native, visually-persistent,
wasm-graded correctness course. The mechanics fit our strongest muscle:
**invariant grading under adversarial injection** — exactly what the Fleet's
conformance harness and Fleet Week's incident drills already do.

**Track sketch:** processes & partial failure → time/clocks → replication
models → consensus → consistency models → transactions at scale → production
anatomy (Spanner/etcd/Kafka/TigerBeetle).

**Lab arc (all grade cleanly on invariants):**
1. Echo/idempotency — under loss + duplication
2. Sequential KV — correctness under retries
3. Leader election — ≤1 leader per term, even under partitions
4. Raft log replication — commit safety, log-matching; a Porcupine-style
   linearizability checker replays the history
5. Snapshots/compaction — recovery past a truncated log
6. Linearizable KV + 2PC — the capstone artifact

**The persistent world — "The Cluster":** 5 nodes, knobs for packet loss,
latency distribution, asymmetric partitions, clock skew; live Lamport
diagrams, term counters, per-node log lengths. Every failure is replayable
and the divergent state is visualized.

**Adversarial capstone:** split-brain (minority leader must lose no
committed writes), leader flap (term inflation), cascading timeout storm
(tune randomized backoff), clock skew, partition-heal divergence.

**Content hooks (verified, current):** Cloudflare Nov 2025 outage
(feature-file panic through a distributed config pipeline), AWS us-east-1
Oct 2025 (race in DNS enactors → cascade), GitHub Feb 2026 availability
report. Prior art to cite, not copy: Fly.io's Gossip Glomers/Maelstrom
(desktop-only), TigerBeetle's VOPR, turmoil/madsim (testing tools, not
courseware).

**Why it wins:** the audience fake-knowledge gap here is the widest in the
industry ("CAP theorem" as a conversation-ender), the grading mechanic is
our proven one, and The Cluster is the Fleet's architectural sibling.

## 2. DATABASE INTERNALS — "tablespace"

**Pitch:** the storage-engine course for backend engineers who've tuned
queries they couldn't explain. BusTub (CMU 15-445) is the gold standard and
it's C++-only, local-only. Our version: Rust, browser-graded, one persistent
engine you build subsystem by subsystem.

**Track sketch:** pages & slotted records → indexes (B+tree) → WAL &
recovery → MVCC → query execution (volcano) → planning & cost → 2026: vector
indexes (HNSW) and what pgvector-vs-purpose-built means.

**Lab arc (first five are invariant-gradeable):**
1. Slotted-page allocator (free-space accounting, no overlap)
2. B+tree with split/merge (sortedness, separators, sibling links, balance)
3. WAL + recovery (checksums, replay idempotence, committed-durable)
4. MVCC visibility (no dirty reads, repeatable snapshot, ww-conflicts)
5. Volcano executor (tuple-correct pull semantics)
6. Cost-based planner + mini-HNSW (heuristic grading — the honest stretch)

**The persistent world — "BufferPool World":** trace player over the
student's subsystems; hit rate, write amplification, checkpoint spikes,
vacuum bloat, hot-page contention — the database convoys.

**Datasets (verified):** TPC-C block-I/O traces (SNIA license), JOB/IMDB
join-order benchmark, ClickHouse's public web-analytics dataset, DuckDB's
tpch extension for generated scale factors.

**Why second:** equally hungry audience, equally buildable; the planner/vector
labs grade fuzzier, and the career-pressure is a notch below distsys.

## 3. COMPILERS & RUNTIMES — "runtime"

**Pitch:** Crafting Interpreters stops at the tree-walk/bytecode VM; almost
nobody teaches the *runtime* — GC, inline caches, JIT tiering — and nobody
targets wasm from a teaching JIT. The research verdict was decisive here:
**the browser cannot measure hardware honestly** (no PMU counters, throttled
timers — a perf-ninja course's core feedback loop dies in-browser), but a
compiler course builds artifacts that ARE the world, deterministic in wasm.

**Track sketch:** lexing/parsing (Pratt) → bytecode VM → optimization →
register allocation → garbage collection → JIT: inline caches, tier-up
policy, deopt.

**Lab arc:**
1. Lexer (token-stream correctness)
2. Pratt parser (precedence, error reporting)
3. Bytecode compiler + stack VM + disassembler
4. Peephole optimizer / simple register allocator
5. Inline-cache lab (polymorphic hit/miss counters)
6. **JIT tiering simulator — emits actual wasm from hot bytecode and runs
   it in the page**: tier-up gain and bailout cost measured for real. The
   browser is the native execution environment, not a proxy.

**The persistent world — "The Runtime":** a live heap with GC pause
visualization, tier-up counters, deopt storms on type feedback changes.

**Why third:** slightly further from the serving-engineer career path, but
it completes the trilogy's theme (understand the machine → the network →
the runtime) and contains the single most elegant lab idea of the three.

## Rejected, honestly

**CPU performance engineering (perf-ninja style):** the richest existing
materials, but the central feedback loop — cache misses, branch
mispredicts, IPC — has no honest in-browser measurement (wasm exposes no
PMU; wall-clock is noisy and throttled; only coarse 2× claims survive).
Revisit if wasm gains perf-counter access.

---

## Recommendation

**#1 first.** Widest gap, strongest mechanic-reuse, richest current content
(postmortems landing monthly). **#2** is the natural follow-up (same
audience, same invariants). **#3** when the first two prove the platform.

Each inherits: the lesson engine, kslab + zip pipeline, progress/export
system, Fleet-style world + capstone patterns, agent-tutoring surface —
and the audience kernelspace already has.

## Sources

- MIT 6.824/6.5840: pdos.csail.mit.edu/6.824 · Jepsen training + Maelstrom:
  jepsen.io, github.com/jepsen-io/maelstrom · Fly.io Gossip Glomers ·
  turmoil (tokio-rs), madsim-rs · TigerBeetle VOPR (tigerbeetle.com blog
  2025-02) · FoundationDB DST (antithesis.com) · postmortems:
  blog.cloudflare.com/18-november-2025-outage · aws.amazon.com/message/101925
- CMU 15-445/BusTub: 15445.courses.cs.cmu.edu, github.com/cmu-db/bustub ·
  CMU 15-721 · Database Internals (Petrov, O'Reilly) · Postgres internals
  (momjian.us) · TPC-C block-I/O traces (iotta.snia.org) · JOB/IMDB ·
  ClickHouse sample datasets · sql-execution-visualizer · USFCA B+tree vis
- Crafting Interpreters (craftinginterpreters.com) · LLVM Kaleidoscope ·
  injuly.in JIT-from-scratch · perf-ninja/perf-book (dendibakh) ·
  MIT 6.172 · Godbolt · uiCA · WebAssembly benchmarking guidelines
