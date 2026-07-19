import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't1.l5',
  slug: 'compile-link-abi',
  trackId: 't1',
  index: 5,
  title: 'Compiling, Linking & the ABI',
  minutes: 20,
  hook: 'From source to a running process: the toolchain, symbol resolution, and the contract that lets strangers\' code call yours.',
  exercise: 'quiz',
  blocks: [
    {
      type: 'prose',
      md: `You type \`gcc main.c -o main\` (or \`cargo build\`, or your CI does) and a runnable artifact appears. Between the source and the process lies a pipeline every systems engineer should be able to narrate: **preprocess → compile → assemble → link → load**. Each stage has a distinct job, a distinct artifact, and a distinct failure mode you have absolutely seen in CI logs — "undefined reference," "relocation truncated," "cannot open shared object" — possibly without knowing which stage was speaking.

This is a guided tour with a purpose. The destination is the **ABI** — the application binary interface — because the ABI is the reason a Rust data plane can call a CUDA kernel compiled by NVIDIA's toolchain, and the reason "just call it from Python" (via C ABI) works at all.`,
    },
    {
      type: 'prose',
      md: `## The pipeline, stage by stage

**Preprocessing** is textual: \`#include\` pastes headers, \`#define\` expands macros. Output: one giant translation unit. **Compilation** parses that into an AST, optimizes, and emits assembly for your target ISA. **Assembly** turns mnemonics into machine code, producing an **object file** (\`.o\`): machine code plus metadata — sections (\`.text\` code, \`.data\` initialized, \`.bss\` zero-init), a **symbol table** (names this file defines vs names it needs), and **relocation entries** (addresses to patch later, because the file doesn't know where anything will finally live).

**Linking** is the matchmaker. It takes many object files and libraries, resolves every undefined symbol to a definition, assigns final addresses, patches the relocation entries, and emits an executable. Two flavors: **static** linking copies library code into the binary (big, self-contained, no version skew); **dynamic** linking records a promise — "needs \`libc.so.6\`" — that the **loader** fulfills at process start, mapping the shared library and patching a jump table (the PLT/GOT machinery).`,
    },
    {
      type: 'code',
      filename: 'pipeline — watching the stages',
      lang: 'c',
      code: `$ gcc -E main.c -o main.i      # 1. preprocess: headers pasted, macros gone
$ gcc -S main.c -o main.s      # 2. compile:   human-readable assembly
$ gcc -c main.c -o main.o      # 3. assemble:  object file (code + symbols)

$ nm main.o                    # symbol table: T = defined text, U = undefined
# 0000000000000000 T add
#                    U printf          ← needs a definition at link time

$ gcc main.o -o main           # 4. link: resolve U symbols, patch addresses
$ ldd ./main                   # 5. load-time deps (dynamic linking)
# linux-vdso.so.1
# libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6

$ readelf -h ./main            # ELF header: entry point, machine, sections`,
      chips: ['.o = code + symbols + relocations', 'nm is your friend', 'PLT/GOT'],
    },
    {
      type: 'prose',
      md: `## The ABI: the calling contract

Compilers from different vendors, and code written in different *languages*, can call each other only because they agree on a binary contract: the **ABI**. The System V AMD64 ABI (Linux/macOS) specifies, among other things: the first six integer arguments go in registers \`rdi, rsi, rdx, rcx, r8, r9\`; return values in \`rax\`; the stack is 16-byte aligned at call sites; \`rbp\` may hold the frame pointer; certain registers are caller-saved vs callee-saved. Your T1.L1 stack-frame ceremony is exactly this document, executed.

Language interop almost always means "speak the C ABI." C's ABI is the lingua franca because it is simple and stable: functions by name, POD structs by agreed layout. That is why Python's \`ctypes\`, Java's JNI/Panama, Rust's \`extern "C"\`, Node's N-API, and CUDA's host API all converge on it. When NVIDIA ships \`libcuda.so\` and PyTorch ships \`libtorch_cuda.so\`, the agreement binding them is an ABI.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `The ABI is a **REST API for machine code**: argument order = register assignment, serialization = struct layout rules, versioning = \`.so\` sonames. And like REST, the failure mode is contract skew: **name mangling** is why C++ interop breaks across compilers (each mangles signatures differently), and **struct layout** drift (one side padded, one packed) is the binary equivalent of a silently changed JSON field — same bytes, different meaning, no error until production.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Two CI classics, decoded. **"undefined reference to \`foo\`"** is a *link-time* error: the symbol was declared but never defined in any object/library on the link line (forgot \`foo.o\` or \`-lfoo\`). **"error while loading shared libraries: libfoo.so: cannot open"** is a *load-time* error: linking succeeded, but the loader can't find the .so at runtime (\`LD_LIBRARY_PATH\`/rpath). Same symptom family, different stages, different fixes.`,
    },
    {
      type: 'prose',
      md: `## Why a serving engineer cares

An LLM serving process is an ABI festival: Python orchestration calling into PyTorch's C++ core, calling cuBLAS/cuDNN, calling a custom CUDA attention kernel, calling NCCL for multi-GPU collectives — four toolchains, one process, held together by the C ABI and a pile of \`extern "C"\`. vLLM's custom kernels, TensorRT-LLM's plugins, Dynamo's Rust core talking to UCX/NIXL for KV transfer — all of it is symbols, sections, and relocation at the bottom. When a \`pip install\` blows up with \`undefined symbol: _ZN…\`, you now know: that's the C++ mangled name of a function whose definition your wheel expected and your system's library didn't provide. Version skew at the ABI layer — the supply chain of systems software.`,
    },
    {
      type: 'deepdive',
      title: 'Position-independent code & the PLT dance',
      md: `Shared libraries can't know their load address, so calls into them go through the **PLT** (procedure linkage table): the first call jumps to a stub that asks the dynamic linker to resolve the real address, writes it into the **GOT** (global offset table), and every later call jumps straight there. That's **lazy binding** — and it means the *first* call to any libc function in a fresh process is orders of magnitude slower than the rest. It also explains \`LD_BIND_NOW=1\` (resolve everything at startup: slower start, no first-call surprises) — a knob tail-latency-sensitive services sometimes flip deliberately.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'An object file (.o) contains machine code plus…',
          options: [
            'The full standard library',
            'A symbol table (defined/undefined names) and relocation entries (addresses to patch at link time)',
            'The process page table',
            'Debug printf statements',
          ],
          correct: [1],
          explanation:
            'Objects are incomplete by design: they record which symbols they define (T in nm) and which they need (U), plus where external addresses must be patched. The linker is the matchmaker that completes them.',
        },
        {
          q: '"undefined reference to `foo\'`" occurs at which stage?',
          options: ['Preprocessing', 'Compilation', 'Link time', 'Load time'],
          correct: [2],
          explanation:
            'The compiler was satisfied by a declaration (header); the linker then searched every object and library for the definition and found none — add the defining .o or -l library. Load-time failures ("cannot open shared object") happen later, when the .so can\'t be found at startup.',
        },
        {
          q: 'The System V AMD64 ABI specifies, among other things…',
          options: [
            'How Python objects are laid out',
            'Argument registers (rdi, rsi, rdx…), return register (rax), stack alignment, and caller/callee-saved registers',
            'The order of sections in an ELF file',
            'How the kernel schedules threads',
          ],
          correct: [1],
          explanation:
            'The ABI is the binary calling contract: where arguments and returns live, who preserves which registers, alignment rules. It is what makes cross-language, cross-compiler calls possible at all.',
        },
        {
          q: 'Why is the C ABI the lingua franca of language interop?',
          options: [
            'C is the fastest language',
            'It is simple and stable — functions by name, plain-data structs with agreed layout — so every runtime can generate and consume it',
            'The C standard requires all languages to support it',
            'It automatically prevents memory bugs',
          ],
          correct: [1],
          explanation:
            'ctypes, JNI, Rust extern "C", CUDA host APIs — all converge on the C ABI because it is the smallest common denominator with decades of stability. C++ can\'t even interoperate with itself across compilers without extern "C" (name mangling).',
        },
      ],
    },
  ],
}

export default lesson
