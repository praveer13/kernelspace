import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't2.l6',
  slug: 'async-io',
  trackId: 't2',
  index: 6,
  title: 'Async I/O: epoll, io_uring, Event Loops',
  minutes: 25,
  hook: 'Why one thread can serve 100k connections, why Rust\'s tokio exists, and the ring buffers that made I/O syscall-free.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `The naive network server is one thread per connection: simple to write, dead on arrival at scale. 10,000 connections means 10,000 threads — 10,000 stacks (~80 GB of address space), constant context switches, and a scheduler drowning in runnable threads that are 99% blocked. The realization that broke this open (the "C10k problem," named in 1999): **threads are the wrong unit for I/O-bound concurrency.** The right unit is the *event*: "socket 42 is readable now."

Async I/O is the machinery for handling many connections with few threads by never blocking on the slow thing. Three generations of it matter to you: \`select/poll\` (the ancestors), \`epoll\`/kqueue/IOCP (the scalable event notifiers), and \`io_uring\` (the modern Linux design that changed the game again). Node.js, nginx, Netty, and Rust's tokio are all — underneath — these syscalls plus a scheduler.`,
    },
    {
      type: 'prose',
      md: `## From readiness to completion

**epoll** (Linux, 2002) inverts the question. Instead of asking "which of these 10,000 fds is ready?" on every loop (O(n) per wake — that was \`select\`/\`poll\`'s death), you *register* fds once with \`epoll_ctl\`, and \`epoll_wait\` returns only the ready ones. O(ready), not O(total). The thread does: wait for events → handle each ready fd until \`EAGAIN\` → wait again. One thread, 100k connections, no problem — this is the engine under nginx and Node (\`libuv\`).

**io_uring** (Linux, 2019) goes further. epoll tells you a socket is *readable*; you then \`read()\` — a syscall per operation. io_uring instead uses two shared **ring buffers** between user and kernel: you push *submission* entries ("read fd 42 into this buffer," "send this," even "open this file") onto the SQ, and the kernel posts *completion* entries to the CQ. No syscall per I/O at all in the common path — you ring a doorbell (or the kernel polls), and completions appear. It's async for *everything*, not just sockets: files too, which epoll never handled (files are always "ready"). The design is batching + shared-memory rings: if T2.L4's batching lesson and T0's cache-line lesson had a child, it's io_uring.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — io_uring: two rings replace the syscall stream',
      height: 46,
      nodes: [
        { id: 'app', x: 4, y: 8, w: 20, h: 10, label: 'your app', sub: 'userspace' },
        { id: 'sq', x: 36, y: 4, w: 26, h: 9, label: 'SQ (submissions)', sub: 'mmap\'d ring', color: '#22D3EE' },
        { id: 'cq', x: 36, y: 30, w: 26, h: 9, label: 'CQ (completions)', sub: 'mmap\'d ring', color: '#FB7185' },
        { id: 'kern', x: 74, y: 8, w: 22, h: 10, label: 'kernel', sub: 'io worker' },
        { id: 'dev', x: 74, y: 30, w: 22, h: 9, label: 'NIC / NVMe', sub: 'the slow thing' },
      ],
      edges: [
        { from: 'app', to: 'sq', label: 'push ops' },
        { from: 'sq', to: 'kern', label: 'doorbell' },
        { from: 'kern', to: 'dev' },
        { from: 'kern', to: 'cq', label: 'post results' },
        { from: 'cq', to: 'app', label: 'consume' },
      ],
      steps: [
        { caption: 'The app writes submission entries directly into a ring it SHARES with the kernel (mmap): read, write, accept, fsync — batched, no syscall per op.', active: ['app', 'sq'], edges: ['app->sq'] },
        { caption: 'One doorbell (or zero, with SQPOLL) tells the kernel work is waiting. The kernel executes ops asynchronously against the device.', active: ['kern', 'dev'], edges: ['sq->kern', 'kern->dev'] },
        { caption: 'Completions are posted to the second ring. The app consumes results whenever it likes — batching both directions. Syscall count per 1000 I/Os: ~1.', active: ['cq', 'app'], edges: ['kern->cq', 'cq->app'] },
      ],
    },
    {
      type: 'prose',
      md: `## The event loop you already know — and its Rust descendant

An **event loop** is epoll plus a scheduler with a friendly API: \`on_readable(socket, callback)\`. JavaScript's entire concurrency model is one (that's why Node exists — and why blocking it is fatal, T2.L4). Java's Netty wraps it for the JVM. And Rust's **tokio** is the same architecture with a zero-cost twist: an \`async fn\` compiles to a **state machine** (a struct with an enum of suspension points), and the runtime polls these state machines across a small pool of OS threads, work-stealing between them. No garbage collector, no per-connection stack — a suspended task is a few hundred bytes in a slab, not 1 MB of thread stack.

That last comparison is worth a table, because it decides architectures:`,    },
    {
      type: 'prose',
      md: `| Model | Unit of concurrency | Cost per idle connection | Switches via |
|---|---|---|---|
| Thread-per-conn | OS thread | ~1 MB stack + scheduler entry | kernel context switch |
| Event loop (Node/nginx) | callback/closure | ~KBs of JS/C state | userspace, same thread |
| tokio task | state-machine struct | ~hundreds of bytes | userspace poll, work-stealing |

The serving relevance is not subtle: an inference cluster's control plane is a giant I/O problem — thousands of concurrent HTTP/SSE streams, KV-transfer connections, and scheduler events. It is exactly the workload io_uring and tokio were built for, and exactly why Dynamo's data plane is Rust + tokio over NATS rather than threads and queues of the 2005 kind.`,
    },
    {
      type: 'code',
      filename: 'echo.rs — a tokio server in one screen',
      lang: 'rust',
      code: `use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::main]                              // work-stealing runtime
async fn main() -> std::io::Result<()> {
    let listener = TcpListener::bind("0.0.0.0:8080").await?;
    loop {
        let (mut sock, _peer) = listener.accept().await?;
        tokio::spawn(async move {           // a task: ~hundreds of bytes,
            let mut buf = [0u8; 1024];      // not a 1 MB thread stack
            loop {
                match sock.read(&mut buf).await {
                    Ok(0) | Err(_) => return,      // peer closed
                    Ok(n) => { let _ = sock.write_all(&buf[..n]).await; }
                }
            }
        });                                 // awaits = suspension points;
    }                                       // the OS thread never blocks
}`,
      chips: ['epoll underneath', 'task ≈ 300 B', 'await = state-machine edge'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You have met this pattern as **reactive** everything: Netty's EventLoopGroup, Spring WebFlux, Node's loop, asyncio. And you have met its failure mode too — the "colored function" problem: one blocking call (\`time.sleep\`, a sync JDBC driver) inside async code poisons the whole loop, because the *thread* is the scarce resource, not the connection. io_uring's pitch is "even file I/O can stay async"; tokio's pitch is "the compiler builds the state machine for you." Same physics as the GIL lesson: block the wrong thread and everything queues behind you.`,
    },
    {
      type: 'prose',
      md: `## Checkpoint yourself

You should now be able to trace a request through a modern async server: NIC interrupt → kernel → completion on the CQ (or readability via epoll) → event loop wakes → task polled → your handler runs to the next await. Every word in that sentence is a T2 concept: interrupts, rings, schedulers, state machines. T3 next: the language these runtimes are written in.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'epoll beat select/poll for C10k because…',
          options: [
            'It uses more threads',
            'Registration is one-time and each wake returns only ready fds — O(ready) instead of O(total) scanning per iteration',
            'It bypasses the kernel entirely',
            'It compresses socket buffers',
          ],
          correct: [1],
          explanation:
            'select/poll re-scan the full fd set per wake — death at 10k connections. epoll keeps the set in the kernel and hands back only events. That inversion is what made nginx/Node practical.',
        },
        {
          q: 'io_uring\'s key advance over epoll is…',
          options: [
            'It works on files as well as sockets, and moves ops/completions through shared rings — eliminating per-I/O syscalls',
            'It uses bigger buffers',
            'It removes the need for async programming',
            'It only works with NVMe drives',
          ],
          correct: [0],
          explanation:
            'epoll is readiness notification for sockets (you still syscall per read/write, and files are always "ready"). io_uring is a completion model for ANY I/O through mmap\'d SQ/CQ rings: batch submissions, batch completions, ~zero syscalls.',
        },
        {
          q: 'A suspended tokio task costs ~hundreds of bytes instead of ~1 MB because…',
          options: [
            'Rust stacks are smaller',
            'The async fn compiles to a state-machine struct holding only live locals across the await — no dedicated OS thread or stack',
            'Tokio compresses idle tasks',
            'Tasks share one register file',
          ],
          correct: [1],
          explanation:
            'The compiler splits the function at awaits and stores only what survives each suspension point. Thousands of idle tasks fit in a slab; a work-stealing pool polls the ready ones. This is why Rust async scales like an event loop with thread ergonomics.',
        },
        {
          q: 'Why is one blocking call inside async code so damaging?',
          options: [
            'It corrupts the event queue',
            'The blocking call occupies the entire OS thread the loop runs on — every task on that thread stalls behind it (head-of-line blocking)',
            'Async runtimes forbid blocking calls at compile time',
            'It forces a context switch to kernel mode',
          ],
          correct: [1],
          explanation:
            'The thread is the scarce resource. Block it with time.sleep or a sync driver call and all 100k connections on that loop wait. The fix: offload blocking work to a dedicated thread pool (tokio::task::spawn_blocking, asyncio executors).',
        },
      ],
    },
  ],
}

export default lesson
