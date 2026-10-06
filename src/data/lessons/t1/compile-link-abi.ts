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
  kcs: ['t1.compile-link', 't1.abi'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'A build prints "undefined reference to foo", and a deployed binary prints "cannot open shared object file". Which stage speaks in each case, and what fixes each?',
        model:
          'Undefined reference comes from the linker: foo was declared but no object or library on the link line defines it, so add the defining .o or an -l flag. Cannot open shared object comes from the loader at startup: linking worked, but the .so is not on its search path, so fix the path or rpath.',
        ideas: [
          'Undefined reference is link time: no definition on the link line',
          'Cannot open shared object is load time: the loader cannot find the .so',
          'The fixes differ: add the .o or -l, or repair the search path',
        ],
        kcs: ['t1.compile-link'],
      },
      {
        prompt: 'Why can a Rust data plane call a C++ CUDA library at all? Say what the ABI fixes.',
        model:
          'Both sides compile against the same calling convention, usually the C ABI. It fixes which registers carry arguments and results, stack alignment, which registers each side must preserve, and plain struct layout. With those fixed, separately compiled code from any language can call each other without ever seeing source.',
        ideas: [
          'The ABI fixes argument and return registers and stack alignment',
          'It fixes which side saves which registers, and plain struct layout',
          'So separately compiled code in any language can call each other',
        ],
        kcs: ['t1.abi'],
      },
    ],
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: 'A binary is dynamically linked against libc.so.6. When does the library\'s code get mapped into the process?',
          options: [
            'At link time, when the linker copies the library functions into the executable',
            'At process start, when the loader maps the library and sets up its lazily filled jump table',
            'At the first call, when the kernel scheduler fetches the library it still needs',
            'At compile time, when the compiler reads the header and pulls the code in',
          ],
          correct: [1],
          why: [
            'That is static linking. A dynamically linked binary stays small because the library code is not copied into it.',
            'Right: dynamic linking records a promise in the binary, and the loader fulfils it at startup by mapping the .so and setting up the PLT and GOT, whose slots fill in at the first call to each function (lazy binding).',
            'The scheduler decides which thread runs, and it does not load libraries. Lazy binding resolves addresses at the first call, but the library is already mapped.',
            'A header only declares functions. The compiler never reads library code, and the definition is found much later.',
          ],
          revealAt: 'The pipeline, stage by stage',
          kcs: ['t1.compile-link'],
        },
        {
          kind: 'choice',
          q: 'Python\'s ctypes calls a C library that was built years earlier. What makes the call possible without recompiling either side?',
          options: [
            'Python embeds a C compiler, and it rebuilds the library for each new interpreter version',
            'The library exports Python bytecode, and the interpreter can run it directly',
            'The operating system translates each call between the two languages, as it is made',
            'Both sides follow the same calling convention for names, registers and struct layout',
          ],
          correct: [3],
          why: [
            'Python does not embed a compiler. ctypes calls into the existing machine code as it stands, with no rebuild step.',
            'A C library holds machine code, not bytecode. The interpreter calls that code through the ABI rather than running it.',
            'The OS does not translate calls between languages. It loads both pieces of code, and they meet at the ABI.',
            'Right: the C ABI fixes function names, which registers carry arguments and results, and plain struct layout, so unrelated toolchains agree.',
          ],
          revealAt: 'The ABI: the calling contract',
          kcs: ['t1.abi'],
        },
      ],
    },
    {
      type: 'prose',
      md: `You type \`gcc main.c -o main\` (or \`cargo build\`, or your CI does) and a runnable artifact appears. Between the source and the process lies a pipeline every systems engineer should be able to narrate: **preprocess → compile → assemble → link → load**. Each stage has a distinct job, a distinct artifact, and a distinct failure mode you have absolutely seen in CI logs — "undefined reference," "relocation truncated," "cannot open shared object" — possibly without knowing which stage was speaking.

This is a guided tour with a purpose. The destination is the **ABI** — the application binary interface — because the ABI is the reason a Rust data plane can call a CUDA kernel compiled by NVIDIA's toolchain, and the reason "just call it from Python" (via C ABI) works at all.`,
    },
    {
      type: 'prose',
      md: `## The pipeline, stage by stage

**Preprocessing** is textual: \`#include\` pastes headers, \`#define\` expands macros. Output: one giant translation unit. **Compilation** parses that into an AST, optimizes, and emits assembly for your target ISA. **Assembly** turns mnemonics into machine code, producing an **object file** (\`.o\`): machine code plus metadata — sections (\`.text\` code, \`.data\` initialized, \`.bss\` zero-init), a **symbol table** (names this file defines vs names it needs), and **relocation entries** (addresses to patch later, because the file doesn't know where anything will finally live).

**Linking** is the matchmaker. It takes many object files and libraries, resolves every undefined symbol to a definition, assigns final addresses, patches the relocation entries, and emits an executable. Two flavors: **static** linking copies library code into the binary (big, self-contained, no version skew); **dynamic** linking records a promise — "needs \`libc.so.6\`" — that the **loader** fulfills at process start, mapping the shared library and setting up a jump table (the PLT/GOT machinery) whose slots fill in on each function's first call.`,
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
            'Copies of each library function it calls, leaving the linker to concatenate the files',
            'A symbol table of defined and undefined names, plus relocation entries to be patched',
            'The final virtual address of each function, resolved by the compiler before linking',
            'A page table for the kernel, marking sections as readable or executable',
          ],
          correct: [1],
          explanation:
            'Objects are incomplete by design: they record which symbols they define (T in nm) and which they need (U), plus where external addresses must be patched. The linker is the matchmaker that completes them.',
          why: [
            'Assumes the compiler pulls in library code. A .o holds only your translation unit and lists unresolved names; the linker finds the definitions in other objects and libraries.',
            'Right: the object lists what it defines and what it still needs, plus relocation entries marking where the linker must patch in final addresses.',
            'Addresses are not final at compile time. The compiler leaves placeholders with relocations; the linker assigns addresses, and the loader may shift them again with ASLR.',
            'Page tables belong to a running process and live in the kernel. An object file has sections with flags, but no page table and nothing mapped yet.',
          ],
          kcs: ['t1.compile-link'],
        },
        {
          q: '"undefined reference to `foo\'`" occurs at which stage?',
          options: ['Preprocessing', 'Compilation', 'Link time', 'Load time'],
          correct: [2],
          explanation:
            'The compiler was satisfied by a declaration (header); the linker then searched every object and library for the definition and found none — add the defining .o or -l library. Load-time failures ("cannot open shared object") happen later, when the .so can\'t be found at startup.',
          why: [
            'Preprocessing only expands #include and macros. It never looks up function definitions, so it cannot report a missing one.',
            'The compiler works per file and accepts a header declaration, trusting that the definition exists elsewhere. A missing definition is invisible to it.',
            'Right: the linker searches all objects and libraries for a definition of foo, finds none, and reports undefined reference. Fix by adding the .o or -l library.',
            'Load-time failures look different, such as "cannot open shared object file", when the dynamic loader cannot find a .so. This message comes from the static linker.',
          ],
          kcs: ['t1.compile-link'],
        },
        {
          q: 'The System V AMD64 ABI specifies, among other things…',
          options: [
            'The opcode encodings, with the exact effect of a vector add on the registers',
            'Argument and return registers, with stack alignment and register-saving rules',
            'How the kernel schedules threads across cores, with a call blocking on I/O or a lock',
            'The in-memory layout of objects, for managed languages such as Java and Python',
          ],
          correct: [1],
          explanation:
            'The ABI is the binary calling contract: where arguments and returns live, who preserves which registers, alignment rules. It is what makes cross-language, cross-compiler calls possible at all.',
          why: [
            'Describes the ISA. The psABI names baseline feature levels (x86-64-v2 and up), but opcode encodings and semantics live in the Intel and AMD manuals. The ABI covers how compiled code calls other compiled code.',
            'Right: the ABI fixes where arguments and results live, stack alignment, and caller-saved versus callee-saved registers, so separately compiled code can call each other.',
            'Scheduling is an OS policy, not part of a calling convention. The ABI says how a call is made, not which thread or core runs it.',
            'Managed-language object layouts belong to each runtime. The C ABI covers only plain C types, which is why runtimes bridge through C-compatible structs.',
          ],
          kcs: ['t1.abi'],
        },
        {
          q: 'Why is the C ABI the lingua franca of language interop?',
          options: [
            'C is the fastest language, with each other runtime wrapping it to get native speed',
            'It is simple and stable, with named functions and plain structs for any runtime',
            'The C standard requires a C-compatible interface, with each language implementation exposing one',
            'Calls through it are checked by the compiler, ruling out memory bugs across the boundary',
          ],
          correct: [1],
          explanation:
            'ctypes, JNI, Rust extern "C", CUDA host APIs — all converge on the C ABI because it is the smallest common denominator with decades of stability. C++ can\'t even interoperate with itself across compilers without extern "C" (name mangling).',
          why: [
            'Speed is not the reason. Languages adopt the C ABI because it is a stable common interface, and Rust or C++ code behind the same interface runs just as fast.',
            'Right: unmangled function names and plain data layouts are easy to generate and consume, and the convention has been stable for decades, so every runtime can speak it.',
            'No standard imposes this. The C standard covers the C language only; languages offer C interop by their own choice.',
            'The C ABI carries raw pointers and no checking, so memory bugs cross the boundary freely. Safe wrappers have to be added on top.',
          ],
          kcs: ['t1.abi'],
        },
      ],
    },
  ],
}

export default lesson
