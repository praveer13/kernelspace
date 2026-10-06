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
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: 'A hot loop reads only the deadline field of each of a million request records. Which layout feeds that loop best?',
          options: [
            'One array of whole records, with each request\'s fields stored together in one struct',
            'One array per field, with the deadlines stored next to each other',
            'A linked list of records, with each node allocated as its request arrives',
            'A hash map keyed by request id, with each record looked up through its id',
          ],
          correct: [1],
          why: [
            'This is AoS. Each fetched line carries other fields the loop never reads, so only part of every line is useful.',
            'Right: this is SoA. Deadlines sit contiguously, so every byte of every fetched line is a deadline the loop wants, and the prefetcher streams it.',
            'Worse still: nodes can be scattered across the heap, so each step is a pointer chase and most of every line is unused.',
            'A hash map finds one record fast, but a sweep over all deadlines then visits entries in scattered order and wastes most of each line.',
          ],
          revealAt: 'AoS: the shape your language gives you',
          kcs: ['t0.data-layout'],
        },
        {
          kind: 'choice',
          q: 'Eight threads each increment their own counter. The eight counters sit side by side in one array, and no thread touches another\'s. How does total throughput compare with one thread?',
          options: [
            'About eight times higher, with every core working on its own counter in parallel',
            'A little under eight times higher, with some time lost starting up the threads',
            'About the same, with the cores taking turns because the OS runs one thread at a time',
            'Lower than one thread, with the cores fighting over the one line the counters share',
          ],
          correct: [3],
          why: [
            'That would hold if the counters were on separate lines. Here they share one 64-byte line, and coherence works per line, not per variable.',
            'Thread startup is a one-off cost. The loss here is on every increment, so it cannot be a small fixed overhead.',
            'The OS schedules these threads on separate cores that run in parallel. The slowdown comes from the cores, not the scheduler.',
            'Right: each write takes the line away from every other core, so ownership ping-pongs on every increment. The result can be 10x to 50x slower than one thread.',
          ],
          revealAt: 'False sharing: the line you did not know you were sharing',
          kcs: ['t0.false-sharing'],
        },
      ],
    },
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

In AoS, you allocate an array of these structs: request 0's 32 bytes, then request 1's, and so on. Two requests per cache line, perfectly packed. Now ask: *which requests are past their deadline?* The loop reads **8 bytes of \`deadline_ns\` from each 32-byte struct** — 16 useful bytes in every 64-byte line, so one quarter of every fetch is useful and the rest is payload you did not ask for. You have divided your effective memory bandwidth by four.

Flip the layout to SoA: one array per field. \`deadline_ns[]\` is a flat, contiguous array of eight million deadline values. Now every 64-byte line contains **8 deadlines you actually use**. The deadline sweep runs at full bandwidth, four times fewer DRAM trips, and the prefetcher streams happily. Nothing else changed — not the algorithm, not the arithmetic, not the language.`,
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
    // reads 8 B of deadline from each 32 B struct → 16 of 64 B per line, 1/4 bandwidth
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
      chips: ['64 B line = 8 deadlines', 'bandwidth ×4', 'SIMD-friendly'],
    },
    {
      type: 'prose',
      md: `## False sharing: the line you did not know you were sharing

There is a darker second half to the 64-byte rule. Caches are kept *coherent* across cores, and the unit they keep coherent is the whole line, not the byte. Fine — unless two threads are working on *different variables that happen to share a line*.

Picture a classic pattern: 8 worker threads, each incrementing its own counter in a contiguous \`u64 counts[8]\` array. Logically independent — zero sharing. Physically, all 8 counters live in **one** 64-byte line, and your "perfectly parallel" counter update runs **10–50× slower** than single-threaded. The figure below steps through what the hardware does to cause that. This is **false sharing**, and it is one of the nastiest performance bugs in concurrent code because the source looks correct, scales negatively with cores, and never shows up in profilers as anything but "mysterious stalls."`,
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
      predictAt: {
        step: 2,
        prompt: 'Core 0 has just written counter A, so it owns the cache line. Core 1 now writes counter B, a different variable in the same line. What does the hardware do?',
        options: [
          'Lets both cores write, with A and B being different bytes that cannot conflict',
          'Takes the line from core 0, with ownership moving to core 1 and back on every write',
          'Copies only B\'s 8 bytes to core 0, with the rest of the line staying put in both caches',
          'Stalls core 1 until core 0 finishes its loop, with the two writers running one after the other',
        ],
        correct: [1],
        why: [
          'Coherence tracks whole lines, not bytes. Different variables in one line still conflict, because a core must own the line to write any part of it.',
          'Right: core 1 must own the line to write, so core 0\'s copy is invalidated, and the line ping-pongs between cores on every write.',
          'Lines move whole. The protocol invalidates the other copy rather than patching 8 bytes, so there is no partial update to rely on.',
          'Nothing waits for a loop to end. The cores interleave their writes, each paying a line transfer every time, so they are slow but not strictly sequential.',
        ],
        kcs: ['t0.false-sharing', 't0.cache-lines'],
      },
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
      machine: 'layout',
      title: 'Layout lab: AoS vs SoA vs false sharing',
      tasks: [
        'Run the deadline sweep on the AoS layout; note effective bandwidth (~1/4 of peak).',
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
          options: [
            '1/2, counting one whole 32-byte struct as useful in each 64-byte line',
            '1/4, using 8 bytes of each 32-byte struct for 16 useful bytes per 64-byte line',
            '1/8, needing 8 bytes of each 64-byte line with a single struct fetched per line',
            '100%, with the hardware fetching just the 8-byte field the loop reads',
          ],
          correct: [1],
          explanation:
            'AoS packs whole 32-byte structs, so each 64-byte line holds 2 of them and the sweep uses 8 bytes of each: 16 useful bytes out of 64 = 1/4. In SoA the deadline array is contiguous, so 100% of each line is useful.',
          why: [
            'Counts structs instead of bytes. A line does hold two structs, but the sweep reads 8 bytes from each, so 16 of 64 bytes are used, not 32.',
            'Right: each line holds two 32-byte structs and the loop reads one 8-byte field from each: 16 useful bytes of 64. In SoA the deadline array is contiguous and every fetched byte is used.',
            'Assumes one struct per line. Structs are 32 bytes, so two share a line and both deadlines are read: 16 of 64, i.e. 1/4. One-eighth would need 64-byte structs.',
            'Only SoA gets this. The memory system moves whole 64-byte lines regardless of the 8 bytes requested, and AoS interleaves other fields into every line, so they are fetched but unused.',
          ],
          kcs: ['t0.data-layout', 't0.cache-lines'],
        },
        {
          q: 'Eight threads increment eight independent counters stored contiguously in one cache line. Throughput collapses because…',
          options: [
            'The OS serializes the threads onto one runqueue, leaving a single counter incrementing at a time',
            'Atomic CPU increments are slow, leaving eight threads on eight counters no faster than one',
            'Each write invalidates the line in other CPU cores, leaving ownership to ping-pong among them',
            'The counters overflow into their neighbors, leaving a CPU increment able to corrupt adjacent values',
          ],
          correct: [2],
          explanation:
            'Coherence works at line granularity, not variable granularity. Independent data in one line is still ONE line: each write forces ownership transfer, costing hundreds of cycles per increment.',
          why: [
            'The scheduler places threads on separate cores that run in parallel; nothing serializes them. The slowdown is cache-coherence traffic, and the same threads with padded counters scale almost linearly.',
            'An atomic costs tens of cycles when the line is already owned. With padded counters eight threads run near full speed each; the collapse comes from line ownership transfers, not the instruction.',
            'Right: coherence works per line, not per variable. Independent counters in one line still force an ownership transfer on every write, costing hundreds of cycles per increment. Padding gives each its own line.',
            'Sharing a line does not corrupt data: each counter owns distinct bytes and the hardware keeps writes to different addresses independent. The cost is purely performance, from coherence traffic.',
          ],
          kcs: ['t0.false-sharing'],
        },
        {
          q: 'The standard fix for false sharing is…',
          options: [
            'Wrap each counter in its own mutex, making threads take turns on the shared line',
            'Pad each hot variable onto its own cache line, giving each writer its own line',
            'Mark the counters volatile, forcing each core to re-read from memory instead of holding stale copies',
            'Replace the array with a linked list of separate allocations, keeping no two counters adjacent',
          ],
          correct: [1],
          explanation:
            'Padding gives each writer a private line, so coherence traffic disappears. Java\'s @Contended and Rust\'s #[repr(align(64))] exist for exactly this; LongAdder is the canonical success story.',
          why: [
            'A mutex serializes the increments and the lock word itself sits in a line that bounces between cores. It adds contention instead of removing the shared-line traffic that causes the problem.',
            'Right: padding gives each writer a private line, so coherence traffic disappears. Java\'s @Contended and Rust\'s #[repr(align(64))] exist for this, and LongAdder is the canonical success story.',
            'volatile controls compiler optimization and ordering, not cache-line ownership. Writes still invalidate the line on every other core, so the ping-pong remains.',
            'Separately allocated nodes can still land in one 64-byte line, since allocators promise no such spacing, and traversal adds pointer chasing. Only explicit alignment makes the separation deterministic.',
          ],
          kcs: ['t0.false-sharing'],
        },
        {
          q: 'When does AoS beat SoA?',
          options: [
            'In no case, with SoA strictly superior and fetching fewer bytes per record than AoS',
            'When the hot path reads most fields of a few records at a time, with one line fetch serving the whole record',
            'When the records are small, with one array of small structs taking less memory than parallel arrays',
            'When the workload is single-threaded, with SoA paying off only once several cores read the data',
          ],
          correct: [1],
          explanation:
            'Layout must match the access pattern: row-wise access (whole record) favors AoS — one or two lines deliver everything; column-wise access (one field, many records) favors SoA. Workload first, dogma never.',
          why: [
            'Dogma. SoA wastes bandwidth when you need all fields of a record: reading six fields touches six lines against one for AoS. Layout should follow the access pattern.',
            'Right: row-wise access favors AoS: one or two lines deliver the whole record. Column-wise access (one field, many records) favors SoA. Match layout to workload; neither wins in general.',
            'The same fields take the same total bytes in either layout; only the grouping differs. Record size alone does not decide, access pattern does.',
            'SoA\'s gain is useful bytes per fetched line, which helps a single thread too: the deadline sweep runs at full bandwidth on one core. Threads matter for false sharing, a different problem.',
          ],
          kcs: ['t0.data-layout'],
        },
      ],
    },
  ],
  kcs: ['t0.data-layout', 't0.false-sharing', 't0.cache-lines'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'Explain false sharing: what is shared, why does it slow code down, and what is the fix?',
        model:
          'Two threads write different variables that sit in the same 64-byte cache line. Coherence works per line, so each write invalidates the other core\'s copy and the line ping-pongs between cores, costing hundreds of cycles per write. The fix is layout: pad each hot variable onto its own line.',
        ideas: [
          'Different variables share one 64-byte cache line',
          'Coherence is per line, so each write invalidates other cores and the line ping-pongs',
          'Pad each hot variable onto its own line',
        ],
        kcs: ['t0.false-sharing', 't0.cache-lines'],
      },
      {
        prompt: 'Choose AoS or SoA for two loops: (a) a sweep that reads only the deadline of every request, (b) a handler that reads every field of one request. Justify each.',
        model:
          '(a) SoA: deadlines are contiguous, so every byte of each fetched 64-byte line is useful, against one quarter in AoS. (b) AoS: one or two lines carry the whole record, where SoA touches a line per field. The rule: pack what is read together.',
        ideas: [
          '(a) SoA, because contiguous deadlines make every byte of each fetched line useful',
          '(b) AoS, because one or two lines deliver the whole record',
          'The rule: match the layout to which fields are read together',
        ],
        kcs: ['t0.data-layout', 't0.cache-lines'],
      },
    ],
  },
}

export default lesson
