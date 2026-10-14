import type { AuthoredItem } from '@/lib/items/types'
import type { Lesson } from '../types'

/**
 * Spiral items (wave-2.md §6.2): authored questions on earlier KCs of T2-T6, drawn by the t6.l10 checkpoint beside
 * the generated items. Refs are `item:<id>`; each option's `miss` names the slip it encodes.
 */
const SPIRAL: AuthoredItem[] = [
  {
    id: 't6.spiral.hot-expert',
    kcs: ['t6.all-to-all'],
    q: {
      q: 'In an expert-parallel MoE layer, one expert receives far more tokens than the others. What happens to that layer?',
      options: [
        'Only the GPU holding that expert slows down, while the others finish their share and start on the next layer',
        'The dispatch all-to-all rebalances tokens across the GPUs before the experts run, leaving no GPU with extra work',
        'The combine step waits for every GPU, leaving the whole layer paced by the one that holds the hot expert',
        'The extra tokens spill onto neighbouring experts, adding a small constant that overlapped compute then hides',
      ],
      correct: [2],
      explanation:
        'Each MoE layer ends with a combine that needs every GPU\'s output, so the slowest GPU sets the pace of all of them. That is why EPLB replicates hot experts instead of letting one GPU stall the fleet.',
      why: [
        'The other GPUs cannot move on: the combine all-to-all needs every expert\'s output before the next layer starts, so they wait for the hot one.',
        'The dispatch sends each token to the expert the router chose, and nothing rebalances it. Balance has to come from replicating or placing experts, as EPLB does.',
        'Right: the combine is a barrier across GPUs, so one overloaded expert sets the pace of the whole layer. Replicating hot experts is the fix.',
        'Tokens cannot move to another expert, because the router\'s choice is the computation. Overlap hides some communication, not an imbalance in how much each GPU computes.',
      ],
      kcs: ['t6.all-to-all'],
      miss: ['t6.hot-expert-is-local', 't6.all-to-all-rebalances', '', 't6.hot-expert-spills'],
    },
  },
  {
    id: 't6.spiral.tp-placement',
    kcs: ['t6.parallelism-composition'],
    q: {
      q: 'You lay out TP, PP and DP for a model across several 8-GPU nodes. Where should tensor parallelism go?',
      options: [
        'Inside one NVLink domain, where its all-reduce at each layer gets the fastest links on offer',
        'Across nodes, putting each layer\'s shards on different machines and letting the network share the load evenly',
        'Wherever memory is free, since its traffic is small beside the weights each GPU reads at every step',
        'On the slowest links, leaving the fastest ones for pipeline stages that exchange activations constantly',
      ],
      correct: [0],
      explanation:
        'TP all-reduces activations twice per layer, so it needs the highest bandwidth and lowest latency: keep it inside an NVLink domain. PP and DP tolerate the network because they communicate far less often.',
      why: [
        'Right: TP all-reduces after attention and after the MLP of every layer, so it stays on NVLink. PP sends one activation per stage boundary, and DP syncs once per step.',
        'Across nodes the all-reduce would run over InfiniBand or Ethernet, an order of magnitude slower, and it sits on the critical path of every layer.',
        'TP traffic is large, not small: every layer moves activations between shards. Placement is set by link bandwidth, not by where memory happens to be free.',
        'Backwards: pipeline stages pass one activation tensor per boundary, so PP tolerates slow links. TP is the axis that needs the fastest ones.',
      ],
      kcs: ['t6.parallelism-composition'],
      miss: ['', 't6.tp-across-nodes', 't6.tp-traffic-is-small', 't6.pp-needs-fastest-links'],
    },
  },
  {
    id: 't6.spiral.cache-key',
    kcs: ['t5.prefix-cache-keys'],
    q: {
      q: 'A prefix cache keys each block by the tokens before it. What else must the key cover for sharing to be safe across tenants and adapters?',
      options: [
        'Nothing more, because identical token ids always produce identical KV whichever model or tenant made them',
        'The request id of the first request that filled the block, letting the owner be found when it is evicted',
        'The model revision and adapter plus a server-held tenant salt, because KV depends on all three of them',
        'The time of the fill, keeping blocks older than the model\'s last update from matching a new prompt',
      ],
      correct: [2],
      explanation:
        'KV depends on the weights that computed it, adapter included, so the key must name them. A server-held tenant salt keeps one tenant\'s prefixes from ever matching another\'s, which also closes the timing channel.',
      why: [
        'Identical token ids give different KV under a different model revision or adapter, and a shared key would also let tenants hit each other\'s blocks.',
        'A request id says who filled the block, not whether another request may reuse it. Reuse is decided by the key, and ownership is tracked by refcounts.',
        'Right: KV is a function of the tokens and of the weights, adapter included, and a server-held salt keeps tenants apart. A client-supplied hint would not.',
        'Fill time does not make KV wrong. A model update changes the model revision, which belongs in the key, and a timestamp would also make identical prefixes miss.',
      ],
      kcs: ['t5.prefix-cache-keys'],
      miss: ['t5.key-is-token-ids-only', 't5.key-is-request-id', '', 't5.key-is-timestamp'],
    },
  },
  {
    id: 't6.spiral.cow-tail',
    kcs: ['t5.kv-copy-on-write'],
    q: {
      q: 'Two sequences share a prompt prefix whose last block is only partly full, and sequence A appends a token. What does the block manager do?',
      options: [
        'Writes in place, because the two sequences agree so far and the block can stay shared between them',
        'Copies every shared block of the prefix for A, keeping later appends away from shared data',
        'Frees the block and recomputes the prefix for A, since the two sequences no longer match',
        'Copies that one shared block for A, leaving the original with B and every full block still shared',
      ],
      correct: [3],
      explanation:
        'Only the partly full tail can be written. Copy-on-write copies that one block for the writer, drops one reference on the original and leaves the full prefix blocks shared.',
      why: [
        'B would see A\'s token in its own sequence. A write to a block with more than one owner must copy first, or both sequences change.',
        'Full prefix blocks are never written to, so copying them wastes memory. Only the tail block that A appends into needs a private copy.',
        'Recomputing the prefix throws away valid KV. The prefix is identical, and one block copy is far cheaper than a prefill.',
        'Right: copy only the shared tail block for the writer, decrement the original\'s refcount, and leave the full blocks shared by reference.',
      ],
      kcs: ['t5.kv-copy-on-write'],
      miss: ['t5.cow-write-in-place', 't5.cow-copies-whole-prefix', 't5.cow-recomputes-prefix', ''],
    },
  },
  {
    id: 't6.spiral.decode-speed',
    kcs: ['t4.decode-bandwidth'],
    q: {
      q: 'At batch size 1, the speed of decode in tokens per second is set mainly by what?',
      options: [
        'Memory bandwidth divided by weight bytes, since every token reads the whole model once while compute idles',
        'Peak FLOP/s divided by the FLOPs per token, since the chip multiplies matrices flat out during the whole step',
        'The size of the KV cache, since attention over the context is the only memory read each step performs',
        'The clock speed of a single warp, since one sequence cannot spread across the many cores of a chip',
      ],
      correct: [0],
      explanation:
        'Decode at batch 1 has an arithmetic intensity near 1 FLOP per byte, far left of the ridge point. Every token streams all the weights from HBM, so bandwidth over weight bytes is the ceiling.',
      why: [
        'Right: one token needs each weight once, which is about 1 FLOP per byte, so the step is bandwidth-bound and compute sits idle.',
        'That is the prefill ceiling. Decode at batch 1 does so little arithmetic per byte that the compute units wait on memory, far below peak FLOP/s.',
        'KV reads grow with context, but at short contexts the weights dominate the bytes of each step. The weights are what set the ceiling.',
        'A matrix-vector product spreads across all the SMs, so there is no single-warp limit. The limit is how fast the weights stream in from HBM.',
      ],
      kcs: ['t4.decode-bandwidth'],
      miss: ['', 't4.decode-is-compute-bound', 't4.decode-reads-only-kv', 't4.decode-single-warp'],
    },
  },
  {
    id: 't6.spiral.wasm-reach',
    kcs: ['t3.wasm-sandbox'],
    q: {
      q: 'Why is an untrusted Wasm module safer to host than a native shared library?',
      options: [
        'Wasm code runs slower than native, and that gap stops a module from reaching host memory in time',
        'Its reach ends at its linear memory and the imports the host gives it, with no ambient OS access',
        'The runtime scans each module for system calls before it runs, deleting any call it does not recognise',
        'Wasm modules run on a separate OS kernel, putting a hypervisor-style boundary behind every call they make',
      ],
      correct: [1],
      explanation:
        'A module has no way to name anything outside its linear memory except what the host imports into it. The sandbox is capability-shaped: no import, no access.',
      why: [
        'Speed is not a security property. A slow module that could reach host memory would still be dangerous; it simply has no pointer to it.',
        'Right: bounds-checked linear memory plus an explicit import list means the module reaches only what the host hands it.',
        'There is no scan-and-delete step. The module has no system-call instruction at all, only calls to functions the host chose to import.',
        'A Wasm module runs inside the host process, under the host\'s kernel. Its isolation comes from the memory and import model, not from a second kernel.',
      ],
      kcs: ['t3.wasm-sandbox'],
      miss: ['t3.wasm-safe-because-slow', '', 't3.wasm-scans-syscalls', 't3.wasm-has-own-kernel'],
    },
  },
  {
    id: 't6.spiral.overload-door',
    kcs: ['t2.admission-scheduling'],
    q: {
      q: 'A serving engine is overloaded and its queues keep growing. Why is queueing or refusing work at the door better than admitting everything?',
      options: [
        'Refused requests cost nothing, while admitted ones always cost GPU time, so rejection saves the most per request',
        'A good policy can meet every deadline whatever the load, and the door only needs to stop a few extras',
        'Admission is a courtesy to clients, since the engine\'s memory use does not depend on how many requests it holds',
        'Past capacity each admitted request slows the rest and fills KV blocks, so refusing early protects others',
      ],
      correct: [3],
      explanation:
        'Past capacity no scheduling policy saves every request: queues grow, KV memory fills and all of them miss their deadlines. Admission control keeps the work that is admitted inside what the engine can finish.',
      why: [
        'Money is not the reason. A refused request is also a failed one; the point is protecting the requests already admitted from an overloaded engine.',
        'No policy meets every deadline at any load. Little\'s law ties queue length to load, so extra work past capacity only lengthens everyone\'s wait.',
        'Memory use depends directly on admitted requests, since each one holds KV blocks. Admission is a capacity check, not a courtesy.',
        'Right: overload slows every admitted request and fills KV, so early refusal keeps the admitted ones inside their deadlines.',
      ],
      kcs: ['t2.admission-scheduling'],
      miss: ['t2.reject-saves-money', 't2.policy-meets-any-load', 't2.admission-is-courtesy', ''],
    },
  },
  {
    id: 't6.spiral.iteration-level',
    kcs: ['t5.continuous-batching'],
    q: {
      q: 'Why does continuous batching beat static batching on requests of mixed length?',
      options: [
        'It pads every request to one length, replacing the many small multiplies of a static batch with one big one',
        'It admits and retires requests each iteration, freeing a finished request\'s KV slot instead of idling',
        'It runs each request on its own GPU stream, so short requests never share a step with long ones',
        'It grows the batch past KV capacity, swapping idle requests to disk between steps to make room',
      ],
      correct: [1],
      explanation:
        'A static batch runs until its longest request finishes, so finished slots idle. Iteration-level scheduling checks every step: a finished request leaves and a waiting one joins, keeping the batch full.',
      why: [
        'Padding wastes compute rather than saving it. Continuous batching has no common length; each sequence advances one token per iteration.',
        'Right: scheduling per iteration lets a finished request release its slot and KV blocks at once, so the batch stays full and nothing idles on the longest request.',
        'Requests share each step in one batch, which is the point: one weight read serves many sequences. Separate streams would lose that sharing.',
        'KV capacity is a hard limit, and swapping to disk is far too slow for a step. Admission checks capacity rather than exceeding it.',
      ],
      kcs: ['t5.continuous-batching'],
      miss: ['t5.cb-pads-requests', '', 't5.cb-separate-streams', 't5.cb-swaps-to-disk'],
    },
  },
]

const lesson: Lesson = {
  id: 't6.l10',
  slug: 'security-boundaries',
  trackId: 't6',
  index: 10,
  title: 'Security Boundaries for Agentic Inference',
  minutes: 35,
  hook: 'The model emits untrusted instructions, tools touch real systems, shared caches remember prompts, and accelerators process secrets. Secure serving starts by drawing four different boundaries instead of calling the whole stack “the sandbox.”',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `Agentic inference joins four security problems that ordinary chat could mostly keep separate. **Model output is untrusted input** even when it looks like valid JSON. A tool runner executes code and opens files or sockets. A serving engine retains prompt-derived KV state for reuse. The infrastructure layer handles model weights, tenant data, credentials, and accelerator memory.

One control cannot cover all four. Grammar-constrained decoding proves shape, not intent. A container packages a process, but still shares the host kernel. Confidential computing protects data *in use*, but does not make an agent's actions safe. Prefix caching saves compute, but a shared timing signal can reveal whether somebody else used a prefix. Start with assets and trust boundaries, then assign one narrow control to each risk.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — deny by default at every agentic boundary',
      height: 70,
      nodes: [
        { id: 'prompt', x: 2, y: 23, w: 19, h: 18, label: 'untrusted input', sub: 'prompt · upload · tool result' },
        { id: 'model', x: 27, y: 23, w: 18, h: 18, label: 'model server', sub: 'tenant-scoped KV' },
        { id: 'broker', x: 51, y: 23, w: 18, h: 18, label: 'capability broker', sub: 'schema · policy · audit' },
        { id: 'microvm', x: 75, y: 23, w: 22, h: 18, label: 'ephemeral microVM', sub: 'tool + scratch only' },
        { id: 'secrets', x: 51, y: 52, w: 18, h: 13, label: 'secret broker', sub: 'short-lived grants' },
      ],
      edges: [
        { from: 'prompt', to: 'model', label: 'tokens' },
        { from: 'model', to: 'broker', label: 'proposed call' },
        { from: 'broker', to: 'microvm', label: 'least privilege' },
        { from: 'secrets', to: 'broker', label: 'scoped token' },
      ],
      steps: [
        {
          caption: 'Treat prompts, uploads, retrieved text, and prior tool output as hostile data. They may influence the model but receive no authority.',
          active: ['prompt', 'model'],
          edges: ['prompt->model'],
        },
        {
          caption: 'The model proposes a typed action. A deterministic broker validates schema, identity, tenant, destination, and policy before anything executes.',
          active: ['model', 'broker'],
          edges: ['model->broker'],
        },
        {
          caption: 'Mint a short-lived capability for one operation. Never place ambient cloud credentials or the control-plane token inside the worker.',
          active: ['broker', 'secrets'],
          edges: ['secrets->broker'],
        },
        {
          caption: 'Run the tool in a disposable, bounded microVM. Filter egress on the host, collect a capped result, then destroy the environment.',
          active: ['broker', 'microvm'],
          edges: ['broker->microvm'],
        },
      ],
    },
    {
      type: 'prose',
      md: `## Tool execution: a microVM is a boundary, not a policy

A Linux container isolates namespaces and cgroups, but its processes still reach the host through one shared kernel. For hostile generated code, a hardware-virtualized guest gives the kernel boundary more depth. [Firecracker](https://github.com/firecracker-microvm/firecracker) is a KVM-based virtual-machine monitor built around a deliberately small device model. Its companion **jailer** drops privileges and applies namespaces, cgroups, resource limits, and a default-deny seccomp filter. Firecracker reports application code can start in as little as 125 ms; products such as [E2B](https://www.e2b.dev/docs) use the same snapshot-and-microVM pattern for disposable agent sandboxes.

The VMM is only the execution boundary. The surrounding platform must still implement policy:

- boot from a signed, read-only root image; attach a fresh writable scratch disk and destroy it afterward;
- give the guest no ambient credentials, host mounts, Docker socket, metadata endpoint, or control-plane network path;
- allow only declared destinations and protocols through a host-side egress proxy — Firecracker does **not** filter guest network traffic for you;
- cap vCPU, memory, processes, wall time, disk, network bytes, and stdout/stderr before execution starts;
- pass a single-use capability for the requested operation, record the policy decision, and revoke it when the run ends;
- keep parsing and result truncation outside the guest, because an output bomb is still a denial-of-service attempt.

Warm snapshots amortize boot work, but never snapshot tenant secrets, prior scratch data, live tokens, or a predictable random-number-generator state. A reusable template should contain code and dependencies only; identity and authority arrive after restore.`,
    },
    {
      type: 'prose',
      md: `## Confidential GPU inference: protect use, not intent

Encryption at rest and in transit stops at the machine boundary. Confidential computing extends protection to data *in use*: a CPU trusted execution environment, a confidential-capable GPU, encrypted links, measured boot, and **remote attestation** let a tenant verify which software and device configuration will receive its model and prompts before releasing a key. NVIDIA's [confidential-computing platform matrix](https://docs.nvidia.com/datacenter/cloud-native/confidential-containers/latest/supported-platforms.html) documents supported CPU/GPU combinations; the [NVIDIA Attestation SDK](https://docs.nvidia.com/attestation/index.html) is the evidence-verification layer, not an “encrypt=true” switch.

Performance claims are configuration-specific. [One H100 study](https://arxiv.org/abs/2509.18886) of confidential LLM inference measured roughly **4–8% throughput overhead**, shrinking at larger workloads. [A later TDX/H100 study](https://arxiv.org/abs/2607.19353) measured larger throughput and time-to-first-token gaps under a different stack. The honest capacity plan benchmarks your model, batch mix, interconnect, attestation path, and software versions; it does not copy one paper's percentage into an SLO.

This boundary protects prompt and weight confidentiality against parts of the cloud infrastructure. It does **not** make a malicious prompt harmless, authorize tool calls, prevent application-level data exfiltration, erase request metadata, or eliminate every side channel. Attestation tells you *what code is running*. You still have to decide what that code may do.`,
    },
    {
      type: 'prose',
      md: `## Prefix caches create a tenant-visible timing oracle

Prefix reuse makes a matching prefill much faster than a miss. If mutually distrustful tenants share one cache namespace, an attacker can submit candidate prefixes, measure the latency distribution, and infer whether another request warmed one of them. [Early Bird](https://arxiv.org/abs/2409.20002) demonstrated this class of privacy attack against production-style LLM serving optimizations. The problem is not that KV tensors are returned directly; the **hit/miss timing difference is an observable bit**.

The safe default is strict tenant scoping: derive cache identity from a server-held tenant namespace plus model revision, tokenizer/template revision, adapter identity, and token prefix. Never accept the namespace or salt as an unauthenticated client hint. Do not cross-tenant-share prefixes containing system prompts, retrieved documents, user data, or tool results. Then add rate limits, latency normalization where warranted, probe detection, cache-event audit logs, and a “no shared cache” policy for high-sensitivity workloads.

Isolation costs hit rate. That is a real performance trade, not a reason to erase the boundary. Newer research such as [PrefixWall / CacheSolidarity](https://arxiv.org/abs/2603.10726) explores selective sharing with privacy controls, but its results are a design input, not permission to make every prefix global. Measure reuse recovered, leakage model, false positives, tail latency, and recompute cost under *your* tenant mix.`,
    },
    {
      type: 'statline',
      stats: [
        {
          value: '125 ms',
          label: 'Firecracker minimum reported startup',
          hint: 'Application-code startup under favorable conditions; use snapshots and measure your own image and host.',
        },
        {
          value: '4–8%',
          label: 'one H100 confidential-inference study',
          hint: 'Study-specific throughput overhead. Other configurations report larger gaps, so benchmark before capacity planning.',
        },
        {
          value: 'hit ≠ miss',
          label: 'cache timing is an observable signal',
          hint: 'A shared prefix cache can leak membership even when raw KV memory is never exposed.',
        },
        {
          value: '0 ambient',
          label: 'credentials inside a tool worker',
          hint: 'Mint one short-lived, operation-scoped capability only after deterministic policy approves the call.',
        },
      ],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Valid JSON is not authorization',
      md: `T6.L8's grammar mask can guarantee that \`{"tool":"transfer","amount":1000}\` parses. It cannot prove that the user owns the account, that the destination is allowed, or that the model was not prompt-injected. Resolve identity and policy in ordinary deterministic code, bind the decision to a narrow capability, and make the sandbox the final containment layer — never the first approval layer.`,
    },
    {
      type: 'isomorphism',
      title: 'One old systems principle at four layers',
      pairs: [
        {
          os: 'syscall validation',
          osLine: 'User space proposes; the kernel validates arguments and authority.',
          llm: 'tool-call broker',
          llmLine: 'The model proposes; deterministic code validates schema, identity, and policy.',
          breaks: 'A process\'s intent is fixed by its code; a tool call comes from a model whose intent any text in its context can steer (prompt injection), so schema-valid arguments are not authorization and the broker must check identity and policy in ordinary code.',
        },
        {
          os: 'process capability',
          osLine: 'Authority is an explicit handle, not ambient global access.',
          llm: 'single-use credential',
          llmLine: 'One approved operation receives one short-lived, destination-scoped grant.',
          breaks: 'A file descriptor stays usable until it is closed and can serve many operations; the credential is single-use and short-lived, minted only after policy approves that specific call and revoked when the run ends.',
        },
        {
          os: 'address-space isolation',
          osLine: 'A process cannot infer or read another process by default.',
          llm: 'tenant cache namespace',
          llmLine: 'KV and prefix identity include tenant and model context by construction.',
          breaks: 'Direct reads of another process\'s memory are blocked by hardware; a shared cache needs no read of the other tenant\'s data, because a hit is faster than a miss and that timing is itself an observable bit, and separating namespaces costs hit rate.',
        },
      ],
      principle:
        'Authority comes from a checked, narrow handle, never from ambient access. Validation, capabilities and namespaces carry over from the OS, but the caller is steerable text and hit-versus-miss timing is observable, so each boundary needs its own check.',
      breakItem: {
        q: 'The security pairs map OS isolation mechanisms onto agentic inference. Where does that mapping break?',
        options: [
          'A process\'s intent is fixed by its code, and a model\'s intent is steered by any text in its context',
          'The kernel validates the arguments before it acts on a syscall, and the broker validates schema, identity and policy before a tool runs',
          'A process holds an explicit handle rather than ambient access, and a tool worker holds a scoped credential rather than ambient access',
          'Separate address spaces keep one process from reading another, and separate cache namespaces keep one tenant from reading another\'s prefixes',
        ],
        correct: [0],
        why: [
          'Right: a process\'s intent is fixed by its code, but a model\'s can be steered by any text it reads. Schema-valid arguments are therefore not authorization, and the broker has to check identity and policy in ordinary code.',
          'This holds on both sides: a kernel and a tool broker both validate a proposed action before carrying it out. The pair claims exactly this, so it is not where the analogy stops.',
          'This holds on both sides: a process capability and a single-use credential both make authority an explicit, narrow thing to hold. The analogy agrees here, so it is not a break.',
          'This holds on both sides: separated address spaces and separated cache namespaces both stop one party reading another\'s data directly. The difference is a signal that namespaces leave open, hit-versus-miss timing.',
        ],
      },
      kcs: ['t6.isolation-boundaries', 't6.cache-timing-oracle', 't6.tool-authorization'],
    },
    {
      type: 'field-note',
      title: 'Firecracker security design',
      source: 'Firecracker project',
      href: 'https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md',
      published: 'Living design document',
      verified: '2026-08',
      md: `Read the threat-containment, jailer, seccomp, and network sections as an exercise in boundary ownership. The most important sentence is the one that refuses responsibility: guest egress filtering belongs to the host. Production security comes from finding every such seam and assigning it to a named control, owner, test, and log.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Why is a container alone a weak boundary for hostile model-generated code?',
          options: [
            'Containers cannot enforce memory or processor limits, letting generated code starve the host',
            'Its processes still share the host kernel, while a microVM adds a hardware-virtualized guest kernel boundary',
            'A container\'s root user is the same root on the host, letting any process in it edit host files directly',
            'Containers cannot restrict system calls or network access, leaving a full virtual machine as the sole place for deny-by-default policy',
          ],
          correct: [1],
          explanation:
            'Namespaces, cgroups, and seccomp remain valuable, but a container reaches one shared host kernel. A minimal KVM microVM adds another containment boundary; the surrounding platform must still constrain authority and egress.',
          why: [
            'cgroups enforce memory and CPU limits for containers. The weakness is the shared kernel, which a kernel bug in a syscall can turn into host compromise.',
            'Right: namespaces and cgroups still run on the host kernel, so a kernel flaw can escape. A microVM puts a separate guest kernel behind a hardware-virtualization boundary.',
            'Container root is host UID 0 by default, but Docker drops most capabilities and the mount namespace hides host files unless they are mounted in. User namespaces or rootless mode map it to an unprivileged host user. The deeper risk is the shared kernel attack surface.',
            'Seccomp filters syscalls and network namespaces limit networking in containers. These controls add depth, but they all run on one shared host kernel, so they cannot add the second kernel boundary a microVM gives.',
          ],
          kcs: ['t6.isolation-boundaries'],
          miss: ['t6.container-no-limits', '', 't6.container-root-is-host-root', 't6.container-no-syscall-policy'],
        },
        {
          q: 'Remote attestation for confidential GPU inference proves primarily that…',
          options: [
            'The model cannot leak data in its output, with the trusted environment encrypting each token it produces',
            'Expected measured software and confidential-capable hardware are running, with the tenant releasing secrets once that is shown',
            'Each tool call the agent makes is authorized, with attested code executing only the actions that policy approves',
            'Confidential mode adds no measurable overhead, with attestation checking that hardware encryption runs at line rate',
          ],
          correct: [1],
          explanation:
            'Attestation establishes a measured execution environment. Application policy, output safety, metadata protection, and tool authorization remain separate responsibilities.',
          why: [
            'Encryption protects data in use from the infrastructure. It does not stop a model from writing sensitive text into a reply that the application then returns.',
            'Right: attestation provides signed evidence of what software and hardware configuration will receive the data, so the tenant can verify it before releasing keys or prompts.',
            'Attestation says what code runs, not what that code may do. Authorizing tool calls remains the job of application policy and a broker.',
            'Attestation reports identity and measurements, not speed. Overhead is configuration-specific; one H100 study measured roughly 4–8% and a later TDX study measured larger gaps.',
          ],
          kcs: ['t6.tool-authorization', 't6.isolation-boundaries'],
          miss: ['t6.attestation-stops-leaks', '', 't6.attestation-authorizes-tools', 't6.attestation-proves-no-overhead'],
        },
        {
          q: 'How can a prefix cache leak information without exposing KV tensors?',
          options: [
            'Prompt text is stored in plaintext as the cache key, letting anyone who can query the cache enumerate the keys',
            'A hit and a miss have measurably different latency, creating a membership oracle for guessed prefixes',
            'Hashed block keys collide across tenants, returning another tenant\'s cached completion verbatim for a guessed prefix',
            'Shared device memory is not zeroed between requests, letting a new tenant read residual cache bytes from the previous one',
          ],
          correct: [1],
          explanation:
            'The attacker observes timing rather than memory. Tenant-scoped, server-derived namespaces are the default defense; sensitive prefixes should not cross tenant boundaries.',
          why: [
            'Cache keys are typically hashes of token blocks and are not exposed to clients. The leak needs no key access, only the ability to observe response latency.',
            'Right: a hit skips prefill and answers faster than a miss, so latency reveals whether a guessed prefix was recently cached, even though raw KV memory is never exposed.',
            'Collisions in a cryptographic hash are negligible, and a cache returns tensors rather than completions. The leak works through timing alone, with no wrong data returned.',
            'That is a memory-isolation bug, a different attack class. The prefix-cache channel works even when raw KV memory is never exposed, using only observed latency.',
          ],
          kcs: ['t6.cache-timing-oracle'],
          miss: ['t6.cache-keys-plaintext', '', 't6.hash-collision-returns-completion', 't6.unzeroed-memory'],
        },
        {
          q: 'A model emits a schema-valid request to transfer money. What authorizes execution?',
          options: [
            'The output grammar, with constrained decoding guaranteeing that the request matches the transfer schema',
            'The model\'s confidence score, with a high-probability tool call reflecting intent the user already approved',
            'A deterministic broker that checks identity and policy, with the worker then holding one narrow short-lived capability',
            'The microVM booting successfully, with an isolated sandbox making any action inside it safe to approve',
          ],
          correct: [2],
          explanation:
            'Parsing establishes syntax only. Authorization belongs to deterministic policy code, and the worker should receive no authority beyond that single approved operation.',
          why: [
            'A grammar mask proves the output parses, not that the user owns the account, the destination is allowed, or that the model was not prompt-injected.',
            'Token probability measures how likely the model found the text, not what the user intended. A prompt-injected call can be emitted with high confidence.',
            'Right: identity and policy are checked in ordinary deterministic code, and the worker gets one short-lived capability scoped to this operation, with no ambient authority.',
            'A sandbox contains damage after the decision; it does not make the decision. It is the last containment layer and must never be the first approval layer.',
          ],
          kcs: ['t6.tool-authorization'],
          miss: ['t6.grammar-authorizes', 't6.confidence-is-intent', '', 't6.sandbox-is-approval'],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Turn the diagram into an abuse-case test plan',
      md: `For one real agent tool, write four negative tests before a happy-path demo: a prompt that asks for an undeclared destination, a tool that forks or emits unbounded output, a guest that probes the metadata endpoint, and a second tenant that times a known sensitive prefix. Record which layer rejects each attempt and which audit event proves it. If two layers both “probably handle it,” the boundary has no owner.`,
    },
  ],
  kcs: ['t6.isolation-boundaries', 't6.cache-timing-oracle', 't6.tool-authorization'],
  ticket: {
    form: 'spiral',
    cr: [
      {
        prompt:
          'A model emits a schema-valid tool call that wires money. What must happen before it runs, and where does the sandbox sit?',
        model:
          'The grammar only proves the call parses. Deterministic code must check who the user is, the tenant, the destination and policy, then mint one short-lived capability for that single operation. The tool then runs in a disposable microVM with filtered egress. The sandbox is the last containment layer, not the approval layer.',
        ideas: [
          'A schema-valid call proves syntax only; it is not authorization',
          'A deterministic broker checks identity, destination and policy, then mints a single-use short-lived capability',
          'The microVM is the last containment layer after approval, not the approval itself',
        ],
        kcs: ['t6.tool-authorization', 't6.isolation-boundaries'],
      },
      {
        prompt:
          'How can a shared prefix cache leak another tenant\'s prompt without ever exposing a KV tensor, and what closes the leak?',
        model:
          'A hit skips prefill and answers faster than a miss, so latency is an observable bit. An attacker submits guessed prefixes and times them; a fast reply says someone recently cached that prefix. Closing it means a server-derived tenant namespace in the cache key, so tenants never share prefixes, plus rate limits and probe detection.',
        ideas: [
          'A hit skips prefill and is measurably faster than a miss, so latency is an observable signal',
          'The attacker times guessed prefixes: a fast reply means the prefix was recently cached',
          'A server-derived tenant namespace in the cache key stops tenants sharing prefixes at all',
        ],
        kcs: ['t6.cache-timing-oracle'],
      },
    ],
    spiral: SPIRAL,
  },
}

export default lesson
