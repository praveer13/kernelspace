import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't0.l4',
  slug: 'aos-vs-soa',
  trackId: 't0',
  index: 4,
  title: 'AoS vs SoA, False Sharing & Cache Lines',
  minutes: 20,
  hook: '64-byte cache lines: why your object graphs hate the CPU, and the layout change that fixes hot loops.',
  exercise: 'sim',
  simId: 'sim-memory',
  blocks: [
    {
      type: 'prose',
      md: `Lesson 2 gave you the hierarchy; lesson 3 gave you the stride. This lesson gives you the **atom**: the 64-byte cache line. The memory system never moves one byte at a time — it moves lines. Every performance mystery involving data layout reduces, eventually, to the question: *"when I fetch 64 bytes, how many of them did I actually want, and who else wanted the rest?"*

Two design patterns fall out of that question, and they power everything from game engines to columnar databases to the KV-cache layouts you will meet in T5: **Array of Structures (AoS)** — the object-oriented default — and **Structure of Arrays (SoA)** — the data-oriented one.`,
    },
    {
      type: 'prose',
      md: `## AoS: the shape your language gives you

Say you serve a million requests and track each one's state:

| Field | Type | Bytes |
|---|---|---|
| \`id\` | u64 | 8 |
| \`deadline_ns\` | u64 | 8 |
| \`tokens_in\` | u32 | 4 |
| \`tokens_out\` | u32 | 4 |
| \`priority\` | u8 | 1 |
| \`state\` | u8 | 1 |
| *(padding)* | — | 6 |
| **total** | | **32** |

In AoS, you allocate an array of these structs: request 0's 32 bytes, then request 1's, and so on. Two requests per cache line, perfectly packed. Now ask: *which requests are past their deadline?* The loop reads **8 bytes of \`deadline_ns\` per 64-byte line** — one eighth of every fetch is useful, the rest is payload you did not ask for. You have divided your effective memory bandwidth by eight.

Flip the layout to SoA: one array per field. \`deadline_ns[]\` is a flat, contiguous array of eight million deadline values. Now every 64-byte line contains **8 deadlines you actually use**. The deadline sweep runs at full bandwidth, eight times fewer DRAM trips, and the prefetcher streams happily. Nothing else changed — not the algorithm, not the arithmetic, not the language.`,
    },
    {
      type: 'code',
      filename: 'layout.rs — AoS vs SoA for the same workload',
      tabs: [
        {
          label: 'Rust',
          lang: 'rust',
          code: `// AoS — the OOP default: one struct, array of them
struct Request {
    id: u64,
    deadline_ns: u64,
    tokens_in: u32,
    tokens_out: u32,
    priority: u8,
    state: u8,
    // 6 bytes padding → 32 B total, 2 per cache line
}

fn count_expired_aos(reqs: &[Request], now: u64) -> usize {
    // reads 64 B of line for every 8 B of deadline → 1/8 bandwidth
    reqs.iter().filter(|r| r.deadline_ns < now).count()
}

// SoA — one contiguous array per field
struct Requests {
    id: Vec<u64>,
    deadline_ns: Vec<u64>,
    tokens_in: Vec<u32>,
    tokens_out: Vec<u32>,
    priority: Vec<u8>,
    state: Vec<u8>,
}

fn count_expired_soa(reqs: &Requests, now: u64) -> usize {
    // every fetched line is 8 useful deadlines → full bandwidth
    reqs.deadline_ns.iter().filter(|&&d| d < now).count()
}`,
        },
        {
          label: 'Python',
          lang: 'python',
          code: `# AoS: list of dicts/objects — the worst case, pointer soup
requests = [{"id": i, "deadline": d, ...} for i, d in ...]

# SoA in Python = columnar storage (this is literally pandas/polars)
deadlines = np.array(deadline_values, dtype=np.uint64)
expired = (deadlines < now).sum()   # contiguous, vectorized, fast`,
        },
        {
          label: 'Java',
          lang: 'java',
          code: `// AoS: Request[] is an array of *references* to heap objects —
// even worse than C AoS: pointer chase + object header (12–16 B)
// per element, plus GC scatter. SoA in Java:
final class Requests {
    final long[] id;
    final long[] deadlineNs;
    final int[] tokensIn;
    final int[] tokensOut;
    final byte[] priority;
    final byte[] state;
}
// flat primitive arrays: the only way to get C-like layout on the JVM
// (Valhalla value types aim to fix this — someday)`,
        },
      ],
      chips: ['64 B line = 8 deadlines', 'bandwidth ×8', 'SIMD-friendly'],
    },
    {
      type: 'prose',
      md: `## False sharing: the line you did not know you were sharing

There is a darker second half to the 64-byte rule. Caches are kept *coherent* across cores: if core 0 writes a line, every other core's copy of **that line** is invalidated. Fine — unless two threads are working on *different variables that happen to share a line*.

Picture a classic pattern: 8 worker threads, each incrementing its own counter in a contiguous \`u64 counts[8]\` array. Logically independent — zero sharing. Physically, all 8 counters live in **one** 64-byte line. Every increment on any core invalidates the line on all other cores; the line pinballs around the chip, and your "perfectly parallel" counter update runs **10–50× slower** than single-threaded. This is **false sharing**, and it is one of the nastiest performance bugs in concurrent code because the source looks correct, scales negatively with cores, and never shows up in profilers as anything but "mysterious stalls."`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — one cache line, two writers: the ping-pong of false sharing',
      height: 46,
      nodes: [
        { id: 'core0', x: 2, y: 6, w: 18, h: 9, label: 'core 0', sub: 'writes counter A' },
        { id: 'core1', x: 2, y: 30, w: 18, h: 9, label: 'core 1', sub: 'writes counter B' },
        { id: 'line', x: 40, y: 16, w: 26, h: 12, label: 'cache line 0x…40', sub: '[ A:8B | B:8B | … ] 64 B' },
        { id: 'l1a', x: 76, y: 6, w: 20, h: 9, label: 'L1 (core 0)', sub: 'exclusive?' },
        { id: 'l1b', x: 76, y: 30, w: 20, h: 9, label: 'L1 (core 1)', sub: 'invalid!' },
      ],
      edges: [
        { from: 'core0', to: 'line', label: 'write A' },
        { from: 'core1', to: 'line', label: 'write B' },
        { from: 'line', to: 'l1a' },
        { from: 'line', to: 'l1b' },
      ],
      steps: [
        { caption: 'Two threads, two counters, zero logical sharing. But A and B sit in the SAME 64-byte line — the unit of coherence.', active: ['core0', 'core1', 'line'] },
        { caption: 'Core 0 writes A: it must own the line exclusively. Core 1\'s copy is invalidated (MESI protocol) — even though core 1 only cares about B.', active: ['core0', 'l1a'], edges: ['core0->line', 'line->l1a'] },
        { caption: 'Core 1 writes B: now IT must own the line. Core 0\'s copy is invalidated. The line ping-pongs between cores on every single write — hundreds of cycles per "independent" increment.', active: ['core1', 'l1b'], edges: ['core1->line', 'line->l1b'] },
        { caption: 'The fix is layout, not locks: pad each counter to its own 64-byte line (Rust #[repr(align(64))], Java @Contended). True sharing is a protocol problem; false sharing is a packing problem.', active: ['line'] },
      ],
    },
    {
      type: 'code',
      filename: 'false_sharing.rs — pad to the line',
      lang: 'rust',
      code: `// BAD: 8 counters in one 64-byte line → coherence ping-pong
struct CountersBad([AtomicU64; 8]);   // 8 × 8 B = 64 B exactly

// GOOD: each counter owns a full line
#[repr(align(64))]
struct Padded(AtomicU64);             // one counter per cache line
struct CountersGood([Padded; 8]);     // 8 lines, zero false sharing

// typical result: 10–50× faster on 8 cores, identical source logic`,
      chips: ['#[repr(align(64))]', 'MESI coherence', '10–50×'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Java hands you this bug pre-packaged: the JDK added **@Contended** (jdk.internal) purely to pad hot fields to cache-line boundaries — it powers **LongAdder**, the drop-in fix for contended counters that every Java service eventually adopts after a bad incident. LongAdder is just "one counter per cache line, sum on read." Python hides all of it behind the GIL — CPython threads rarely write-share at this granularity, which is one accidental reason the GIL survives.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Padding is not free: you trade memory (8× for counters) for coherence traffic, and SoA can hurt when you genuinely need *all* fields of one record — then AoS is right and SoA fetches 6 lines instead of 1. The rule is workload-first: **pack what is read together; pad what is written concurrently.** Anyone who tells you one layout is always better has not benchmarked enough workloads.`,
    },
    {
      type: 'prose',
      md: `## Carrying it forward

SoA is not an exotic game-engine trick; it is the default shape of serious data systems — Apache Arrow, Parquet, DuckDB, ClickHouse are all columnar for exactly this bandwidth math. And in T5 you will see vLLM store the KV cache in fixed-size blocks partly so that decode reads stream through HBM in hardware-friendly patterns. The 64-byte line was decided by chip designers decades ago; everything you build either respects it or pays it.`,
    },
    {
      type: 'exercise',
      simId: 'sim-memory',
      title: 'Layout lab: AoS vs SoA vs false sharing',
      tasks: [
        'Run the deadline sweep on the AoS layout; note effective bandwidth (~1/8 of peak).',
        'Switch to SoA and rerun — watch bandwidth approach the DRAM roof.',
        'Run the 8-thread counter without padding; watch the line ping-pong counter explode.',
        'Enable 64-byte padding and rerun: same code, 10–50× throughput.',
      ],
      note: `You just demonstrated the two sides of the 64-byte rule: SoA maximizes *useful bytes per line fetched*; padding eliminates *unwanted sharing per line written*. Together they explain why "data-oriented design" people sound obsessed with layout — on memory-bound workloads, layout **is** the algorithm.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'A deadline-sweep reads one u64 field per record from an AoS array of 32-byte structs. What fraction of each fetched cache line is useful?',
          options: ['1/2', '1/4', '1/8', 'all of it'],
          correct: [2],
          explanation:
            '64-byte line ÷ 8-byte field = 8 fields per line… but AoS packs whole 32-byte structs, so each line holds 2 structs and you use 8 bytes of each: 16 useful bytes of 64 only if you touch both — in a pure single-field sweep the SoA comparison is the point: contiguous field arrays make 100% of each line useful.',
        },
        {
          q: 'Eight threads increment eight independent counters stored contiguously in one cache line. Throughput collapses because…',
          options: [
            'The OS serializes the threads on one runqueue',
            'Atomic increments are always slow regardless of layout',
            'Every write invalidates the shared line on all other cores (false sharing / coherence ping-pong)',
            'The counters overflow into each other',
          ],
          correct: [2],
          explanation:
            'Coherence works at line granularity, not variable granularity. Independent data in one line is still ONE line: each write forces ownership transfer, costing hundreds of cycles per increment.',
        },
        {
          q: 'The standard fix for false sharing is…',
          options: [
            'Add a mutex around each counter',
            'Pad/align each hot variable to its own 64-byte cache line',
            'Switch to volatile reads',
            'Use a linked list of counters instead of an array',
          ],
          correct: [1],
          explanation:
            'Padding gives each writer a private line, so coherence traffic disappears. Java\'s @Contended and Rust\'s #[repr(align(64))] exist for exactly this; LongAdder is the canonical success story.',
        },
        {
          q: 'When does AoS beat SoA?',
          options: [
            'Never — SoA is strictly superior',
            'When the hot path reads most fields of a few records at a time (one line fetch serves the whole record)',
            'When records are larger than one page',
            'When the workload is single-threaded',
          ],
          correct: [1],
          explanation:
            'Layout must match the access pattern: row-wise access (whole record) favors AoS — one or two lines deliver everything; column-wise access (one field, many records) favors SoA. Workload first, dogma never.',
        },
      ],
    },
  ],
}

export default lesson
