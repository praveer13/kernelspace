import type { Lesson } from '../types'

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
        },
        {
          os: 'process capability',
          osLine: 'Authority is an explicit handle, not ambient global access.',
          llm: 'single-use credential',
          llmLine: 'One approved operation receives one short-lived, destination-scoped grant.',
        },
        {
          os: 'address-space isolation',
          osLine: 'A process cannot infer or read another process by default.',
          llm: 'tenant cache namespace',
          llmLine: 'KV and prefix identity include tenant and model context by construction.',
        },
      ],
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
            'User namespaces and rootless containers map container root to an unprivileged host user. The risk is the shared kernel attack surface, not an automatic root equivalence.',
            'Seccomp filters syscalls and network namespaces limit networking in containers. These controls are valuable but still run on one shared host kernel, and so do not add depth.',
          ],
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
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Turn the diagram into an abuse-case test plan',
      md: `For one real agent tool, write four negative tests before a happy-path demo: a prompt that asks for an undeclared destination, a tool that forks or emits unbounded output, a guest that probes the metadata endpoint, and a second tenant that times a known sensitive prefix. Record which layer rejects each attempt and which audit event proves it. If two layers both “probably handle it,” the boundary has no owner.`,
    },
  ],
}

export default lesson
