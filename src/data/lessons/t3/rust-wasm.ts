import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't3.l5',
  slug: 'rust-wasm',
  trackId: 't3',
  index: 5,
  title: 'Rust + Wasm',
  minutes: 20,
  hook: 'The meta lesson: how this site\'s own exercises run — native-speed systems code in a sandboxed browser tab.',
  exercise: 'read',
  blocks: [
    {
      type: 'prose',
      md: `The simulators embedded in this course run at native speed, inside your browser tab, with no server involved. That's not JavaScript heroics — it's **WebAssembly (Wasm)**: a compact binary instruction format for a stack-based virtual machine, designed to run sandboxed code at near-native speed on the web. And its most natural source language is Rust: no GC to port, a mature \`wasm32-unknown-unknown\` target, and \`wasm-bindgen\` to bridge types to JavaScript.

This is the course's meta lesson — how the machine under the lessons is built — but it's also a legitimately important piece of modern systems knowledge, because Wasm has escaped the browser and is now a server-side sandboxing story (wasmtime, Spin, Cloudflare Workers, plugin systems from Envoy to Postgres).`,
    },
    {
      type: 'prose',
      md: `## What Wasm actually is

Strip the hype: Wasm is an **ISA for a virtual stack machine** — typed instructions (\`i32.add\`, \`local.get\`), a linear memory (one growable, byte-addressable \`ArrayBuffer\`), and a module format with imports/exports. There are no pointers beyond indices into linear memory, no syscalls by default, and no ambient capabilities: a module can only touch its own memory and call exactly the host functions it was handed. **The sandbox is the headline feature** — memory safety enforced by construction, which is why running untrusted code (your allocator traces in T1!) in a browser tab is safe.

Rust maps onto it almost perfectly: Rust has no runtime to port (no GC, no green threads — just a thin panic/alloc shim), \`wasm-bindgen\` generates the JS glue to pass strings/structs across the boundary, and \`wasm-pack\` builds the whole thing. The typical pipeline: \`lib.rs → cargo build --target wasm32-unknown-unknown → .wasm + JS shim → <script type="module">\`.`,
    },
    {
      type: 'code',
      filename: 'lib.rs — the allocator sim\'s core, compiled to Wasm',
      lang: 'rust',
      code: `use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Allocator {
    arena: Vec<u8>,
    free_list: Vec<usize>,     // simplified for the demo
}

#[wasm_bindgen]
impl Allocator {
    #[wasm_bindgen(constructor)]
    pub fn new(capacity: usize) -> Self {
        Self { arena: vec![0; capacity], free_list: vec![0] }
    }

    pub fn malloc(&mut self, n: usize) -> i32 {
        // …your T1.L3 free-list logic, unchanged —
        // the same code runs natively AND in the browser tab.
        n as i32 // (demo return: block offset)
    }

    pub fn inspect(&self) -> String {
        format!("{{\\"free_blocks\\": {}}}", self.free_list.len())
    }
}
// JS side:  const a = new Allocator(1 << 20);
//           a.malloc(4096);  JSON.parse(a.inspect());`,
      chips: ['wasm-bindgen glue', 'linear memory', 'same code, native + browser'],
    },
    {
      type: 'prose',
      md: `## The performance reality, honestly

"Near-native" needs footnotes. Wasm runs within ~1–2× of native for compute-bound numeric code (LLVM emits the same quality machine code either way, via the JIT in your browser engine). The overheads live at the **boundary**: every JS↔Wasm call with non-numeric data (strings, objects) pays marshalling; memory is a separate linear buffer, so DOM/canvas work happens through JS shims. Design accordingly: **cross the boundary rarely, with big payloads** — exactly the same lesson as JNI on the JVM, C extensions in Python, and CPU↔GPU transfers in T4. This is a law of computing: the fast path is always "stay on one side of the boundary."

This course's simulators obey it: the allocator/VM/roofline cores run entirely inside Wasm per step; the JS side only renders. The whole exercise loop never crosses more than once per frame.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Wasm is the JVM idea, minus the mistakes you studied in T0.L5: a portable bytecode target — but with **no GC mandated** (each language brings its own memory story, so Rust/C keep their zero-cost layouts), **capability security by default** (the sandbox isn't an add-on like the old SecurityManager), and **embed-anywhere** design (browser today, serverless edge, plugin hosts). Think "JVM applet, if it had been designed by the people who wrote the CVE reports."`,
    },
    {
      type: 'callout',
      variant: 'info',
      md: `Server-side Wasm is the reason to care beyond this course: **WASI** gives modules a POSIX-ish syscall surface; **wasmtime** runs them with µs cold starts (no OS process, no container); Cloudflare Workers, Fastly Compute, and Fermyon Spin sell it as the post-container isolation unit; Envoy/Postgres/Kafka use it for **safe plugins** — untrusted extension code that can't segfault the host. If you build a platform that runs customer code, Wasm is the sandbox your security team will actually approve.`,
    },
    {
      type: 'prose',
      md: `## And the GPU half

The browser story completes with **WebGPU**: a modern graphics/compute API (the successor spirit of Vulkan/Metal/DX12) exposed to JS and Wasm. T4's WGSL playground uses it directly — compute shaders running on your real GPU from a browser tab. Rust ↔ Wasm ↔ WebGPU is the full stack of this course's interactivity, and it's no coincidence that the same stack appears in serious products (in-browser LLM inference via WebGPU is exactly how "run a 4B model in a tab" demos work — your T4–T5 knowledge applies to it verbatim).`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'WebAssembly\'s security model is best described as…',
          options: [
            'Process isolation managed by the OS',
            'Capability-based: a module touches only its own linear memory and exactly the host functions it was explicitly given',
            'A Java-style SecurityManager policy file',
            'Code signing with trusted publishers',
          ],
          correct: [1],
          explanation:
            'No ambient authority: no syscalls unless the host imports them, no memory outside the linear buffer. The sandbox is structural, which is why it works for untrusted code in tabs and plugins.',
        },
        {
          q: 'Rust is an unusually good Wasm source language because…',
          options: [
            'Rust invented WebAssembly',
            'It has no GC/runtime to port — just thin alloc/panic shims — so the same zero-cost code compiles to wasm32 with mature tooling',
            'Rust is interpreted like JavaScript',
            'Wasm only supports Rust',
          ],
          correct: [1],
          explanation:
            'GC languages must ship a runtime into the module (or wait for WasmGC); Rust\'s runtime is nearly nothing. Same code, native and browser — that\'s how this site\'s simulators run identical logic everywhere.',
        },
        {
          q: 'The main performance trap in JS↔Wasm apps is…',
          options: [
            'Wasm instructions are 10× slower than native',
            'Crossing the boundary too often: marshalling strings/objects per call dominates — the fix is rare crossings with big payloads',
            'Linear memory is slower than DOM memory',
            'Browsers throttle Wasm after 30 seconds',
          ],
          correct: [1],
          explanation:
            'Compute inside Wasm is near-native; the toll booth is the boundary (same law as JNI, C extensions, and CPU↔GPU transfers). Batch across it; stay on one side per frame.',
        },
        {
          q: 'Server-side Wasm (wasmtime/WASI/Workers) sells which property over containers?',
          options: [
            'Bigger memory limits',
            'Microsecond cold starts and structural sandboxing for untrusted/plugin code — isolation without an OS process per unit',
            'Free GPU access',
            'Automatic scaling to zero cost',
          ],
          correct: [1],
          explanation:
            'No process, no image pull: instantiate a module in µs with capability security. That is why it wins plugin systems and edge functions — and why your security team prefers it to customer-supplied .so files.',
        },
      ],
    },
  ],
}

export default lesson
