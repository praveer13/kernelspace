import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't3.l2',
  slug: 'zero-copy',
  trackId: 't3',
  index: 2,
  title: 'Zero-Copy, Slices & unsafe Rust',
  minutes: 25,
  hook: 'When copying bytes is the bottleneck, borrow views instead — and when the compiler can\'t check you, document invariants like a professional.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `In T0 you learned that memory bandwidth is the scarce resource. A copy is the most expensive "simple" thing a program does: a stray \`.clone()\` on a 100 MB buffer burns ~30 µs of pure bandwidth and pollutes half your cache — and in a serving pipeline, copies multiply: socket → parse → tokenize → transfer → kernel. **Zero-copy** is the discipline of passing *views* instead of *payloads* at every layer boundary, and Rust is unusually good at it because the borrow checker can prove a view never outlives its buffer.

This lesson is the two halves of high-performance Rust: slices and borrowing views (the safe 99%), and \`unsafe\` (the audited 1%) — when you need it, and how professionals fence it in.`,
    },
    {
      type: 'prose',
      md: `## Slices: windows into memory you don't own

A slice \`&[T]\` is a fat pointer: \`(ptr, len)\` — 16 bytes describing a contiguous run of memory owned by someone else. \`&str\` is the same idea for UTF-8 text. Because slices *borrow*, the compiler guarantees the view can't escape its source: no dangling window, ever. That guarantee is what makes zero-copy APIs routine instead of terrifying:

\`\`\`text
let buf: Vec<u8> = read_frame();        // owned: 64 KB on the heap
let header: &[u8] = &buf[0..16];        // view #1 — 16 bytes of metadata
let payload: &[u8] = &buf[16..];        // view #2 — zero copies so far
route(header, payload);                 // pass views, not clones
\`\`\`

The standard library is built on this: \`split\`, \`chunks\`, \`trim\`, \`str::find\` all return views. The ecosystem doubles down: the \`bytes\` crate's \`Bytes\` type is a reference-counted immutable buffer handing out zero-copy slices — the backbone of tokio, hyper, and every serious Rust network service. When Dynamo's data plane moves a KV block description from NATS message to transfer request without copying the payload, this is the machinery.`,
    },
    {
      type: 'code',
      filename: 'zero_copy.rs — parse without copying',
      lang: 'rust',
      code: `// A wire parser that allocates NOTHING:
fn parse_frame(buf: &[u8]) -> Option<(&[u8], &[u8])> {
    let (len_bytes, rest) = buf.split_at_checked(4)?;
    let len = u32::from_be_bytes(len_bytes.try_into().ok()?) as usize;
    let (payload, _next) = rest.split_at_checked(len)?;
    Some((payload, &rest[..0]))       // views into caller's buffer
}

// The lifetime story: 'payload' borrows from 'buf'. The compiler
// refuses to let the caller free buf while payload is alive —
// zero-copy WITHOUT the dangling-pointer risk C accepts silently.

// bytes::Bytes when the buffer must outlive the stack frame:
use bytes::Bytes;
fn shard_kv_block(b: &Bytes, n: usize) -> Vec<Bytes> {
    (0..n).map(|i| b.slice(i * 4096..(i + 1) * 4096)).collect()
    // refcount bumps, no memcpy: 12 slices, one underlying buffer
}`,
      chips: ['(ptr, len) = 16 B', 'views not clones', 'Bytes = ref-counted zero-copy'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `The JVM world pays a *serialization tax* here: row objects → JSON → bytes → parse → row objects, two full copies per hop — that's why Kafka clients added \`ByteBuffer\` pooling and why Arrow's pitch ("one columnar layout from NIC to GPU, no serde") took over data infrastructure. Python's \`memoryview\`/\`bytearray\` slicing is the same idea, minus the compile-time aliasing proof. Rust's contribution isn't the concept — it's that the borrow checker makes zero-copy the *safe default* instead of the expert-only path.`,
    },
    {
      type: 'prose',
      md: `## unsafe: the audited escape hatch

Some things the compiler cannot verify: raw memory from the kernel or a GPU, FFI boundaries, intrusive data structures, pointer arithmetic on a giant mmap'd slab. For these, Rust offers \`unsafe\` blocks — which do **not** disable the borrow checker; they unlock five extra powers: dereference raw pointers, call unsafe/FFI functions, access mutable statics, implement unsafe traits, and touch \`union\` fields.

The professional discipline around \`unsafe\` is the whole lesson:

- **Keep it tiny and wrapped.** Unsafe internals, safe public API. Callers see a normal borrow-checked interface; the invariant argument lives in one auditable module.
- **Write the invariants down.** Every \`unsafe\` block gets a \`// SAFETY:\` comment stating why the operation is sound (what pointer is valid, for how long, under whose lock). Rust culture treats a missing SAFETY comment like a missing test.
- **Test with Miri.** Rust's interpreter for undefined behavior — it runs your unsafe code against an abstract machine that flags OOB reads, use-after-free, and aliasing violations (Tree Borrows/Stacked Borrows rules).`,
    },
    {
      type: 'code',
      filename: 'unsafe_slab.rs — fenced, documented, minimal',
      lang: 'rust',
      code: `/// A view into a shared-memory slab mapped from /dev/shm.
/// Safe API; unsafe internals.
pub struct SlabView<'a> {
    base: *const u8,          // raw pointer: borrow checker can't see it
    len: usize,
    _life: std::marker::PhantomData<&'a [u8]>,  // tie view to owner lifetime
}

impl<'a> SlabView<'a> {
    /// # Safety
    /// Caller guarantees 'base..base+len' is a live, readable mapping
    /// for the whole lifetime 'a (e.g. the mmap outlives every view).
    pub unsafe fn new(base: *const u8, len: usize) -> Self {
        Self { base, len, _life: std::marker::PhantomData }
    }

    pub fn get(&self, i: usize) -> Option<u8> {
        if i >= self.len { return None; }
        // SAFETY: bounds checked above; new()'s contract guarantees the
        // mapping is live and readable for 'a, and &self proves no
        // conflicting &mut exists (shared XOR mutable).
        Some(unsafe { *self.base.add(i) })
    }
}`,
      chips: ['SAFETY comments', 'PhantomData ties lifetimes', 'Miri-testable'],
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `The most common real-world unsafe bug is **aliasing**: creating a \`&mut\` while a raw pointer also writes the same bytes (instant UB under the aliasing model, and LLVM will optimize accordingly). The rule of thumb: while any safe reference exists, raw pointers to that memory are read-only or dead. And remember — unsafe code is where bugs *concentrate*, but the blast radius is still smaller than C: safe code can only be corrupted through the unsafe module's mistakes, which is where all review attention goes.`,
    },
    {
      type: 'prose',
      md: `## Why this lesson sits here

Serving systems live or die on copy discipline: every tensor moved between devices, every KV block shipped over RDMA, every SSE token streamed to a client is a chance to copy needlessly or to view instead. Rust gives you both the safe view machinery (slices, \`Bytes\`, lifetimes that prove views don't escape) and the professional scaffolding for the moments you touch raw memory (device buffers, io_uring rings, GPU mappings). Next: the concurrency half — Send, Sync, and channels.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'A Rust slice &[T] is…',
          options: [
            'An owned array on the heap',
            'A fat pointer (ptr, len) describing a borrowed, contiguous view — the compiler proves it never outlives its source',
            'A copy of the original data',
            'A reference-counted buffer',
          ],
          correct: [1],
          explanation:
            '16 bytes of metadata, zero payload copies, lifetime-checked. This is what makes zero-copy parsing/serialization the safe default in Rust rather than an expert technique.',
        },
        {
          q: 'bytes::Bytes achieves zero-copy sharing by…',
          options: [
            'Compressing the buffer',
            'Reference-counting one immutable underlying buffer and handing out (offset, len) slices that just bump the count',
            'Using unsafe everywhere',
            'Copying on first write',
          ],
          correct: [1],
          explanation:
            'Slicing a Bytes is a refcount bump — no memcpy. It is the tokio/hyper ecosystem\'s backbone for passing buffers between layers without the serialization tax.',
        },
        {
          q: 'Inside an unsafe block, Rust…',
          options: [
            'Disables the borrow checker entirely',
            'Permits five extra powers (raw-pointer deref, unsafe/FFI calls, mutable statics, unsafe traits, unions) — normal borrow rules still apply',
            'Turns off bounds checking globally',
            'Skips all lifetime analysis',
          ],
          correct: [1],
          explanation:
            'unsafe is additive, not a bypass: it unlocks capabilities the compiler cannot verify, which is why invariants move into SAFETY comments and Miri tests around a tiny, wrapped surface.',
        },
        {
          q: 'The professional pattern for unsafe Rust is…',
          options: [
            'Mark whole modules unsafe for convenience',
            'Tiny unsafe internals behind a safe, borrow-checked API, with documented invariants and Miri coverage',
            'Avoid unsafe in all circumstances, even FFI',
            'Use unsafe only in tests',
          ],
          correct: [1],
          explanation:
            'Callers should never inherit obligations they can\'t see. Safe wrappers concentrate risk into auditable units — which is also why Rust\'s aggregate CVE story beats C++ even though unsafe exists.',
        },
      ],
    },
  ],
}

export default lesson
