import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't3.l4',
  slug: 'toy-executor',
  trackId: 't3',
  index: 4,
  title: 'Async Runtime Internals: Build a Toy Executor',
  minutes: 35,
  hook: 'Wakers and polling, demystified: async/await is a state machine plus a scheduler, and you can build one in an afternoon.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `\`async\`/\`await\` looks like language magic. It is not. It is two ordinary ideas fused: **the compiler rewrites your function into a state machine**, and **a runtime polls that machine, parking and resuming it as I/O completes.** Once you see the two halves separately, nothing about tokio, asyncio, or Node will ever mystify you again — including why blocking the loop is fatal (T2.L6) and why holding a lock across \`.await\` is poison (T3.L3).

In this lesson we build the runtime half: a toy executor — the ~50 lines at the heart of tokio — with futures, a poll loop, and wakers. This is the most-requested "how does it *actually* work" in systems Rust; after it, T3.L6's Dynamo architecture reads like plain text.`,
    },
    {
      type: 'prose',
      md: `## Half one: the compiler's state machine

An \`async fn\` returns a **Future**: an anonymous struct holding the locals that live across \`.await\` points, plus an enum for "where am I suspended." The trait is one method:

\`\`\`text
trait Future {
    type Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Self::Output>;
}
\`\`\`

\`poll\` means: *"run until you either finish (\`Poll::Ready(v)\`) or can't make progress (\`Poll::Pending\`)."* Each \`.await\` becomes: poll the inner future; if Pending, save state and return Pending up the chain. Crucially, **futures are inert** — creating one runs nothing (unlike a JS Promise, which starts immediately). Only polling advances them, and only the executor polls. That's why "async Rust does nothing without a runtime" is literally true, and why runtimes are interchangeable libraries rather than language builtins.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — the poll/wake cycle: executor, future, and the I/O source',
      height: 54,
      nodes: [
        { id: 'exec', x: 4, y: 8, w: 24, h: 10, label: 'executor', sub: 'task queue + poll loop', color: '#F97316' },
        { id: 'fut', x: 40, y: 8, w: 26, h: 10, label: 'future (state machine)', sub: 'State::ReadingLine' },
        { id: 'io', x: 74, y: 8, w: 22, h: 10, label: 'I/O source', sub: 'socket / reactor' },
        { id: 'wake', x: 40, y: 34, w: 26, h: 9, label: 'waker registration', sub: '"notify task #7"' },
        { id: 'requeue', x: 4, y: 34, w: 24, h: 9, label: 'task re-queued', sub: 'wake() → push' },
      ],
      edges: [
        { from: 'exec', to: 'fut', label: 'poll()' },
        { from: 'fut', to: 'io', label: 'read → EAGAIN' },
        { from: 'fut', to: 'wake', label: 'return Pending' },
        { from: 'wake', to: 'requeue', label: 'data ready → wake()' },
        { from: 'requeue', to: 'exec' },
      ],
      steps: [
        { caption: 'The executor pops task #7 and calls poll(). The future runs — real code executing on the executor\'s thread — until it needs the socket.', active: ['exec', 'fut'], edges: ['exec->fut'] },
        { caption: 'Socket not ready (EAGAIN). The future registers its WAKER with the reactor (epoll/io_uring interest list) and returns Pending. The thread is now FREE to poll other tasks — this is the whole trick.', active: ['fut', 'io', 'wake'], edges: ['fut->io', 'fut->wake'] },
        { caption: 'Bytes arrive; the reactor fires; wake() pushes task #7 back to the executor\'s queue. No thread slept for this connection — one thread multiplexes thousands.', active: ['wake', 'requeue'], edges: ['wake->requeue', 'requeue->exec'] },
        { caption: 'Re-polled, the future resumes at its saved state, reads the bytes, and either finishes (Ready) or parks at the next await. A task is just a resumable function with ~300 B of state.', active: ['exec', 'fut'], edges: ['exec->fut'] },
      ],
    },
    {
      type: 'prose',
      md: `## Half two: the waker, and 50 lines of executor

Polling has one obvious flaw: if a future returns Pending, when do we poll again? Re-polling in a hot loop would burn a core per task. The answer is the **Waker**: a handle the executor hands down via \`Context\`. A future that can't proceed arranges for its waker to be called when progress is possible (the reactor, a timer wheel, another task), then returns Pending and *costs nothing* until woken.

The executor is then shockingly small: a queue of ready tasks, a loop that polls each with a waker wired to re-enqueue, done. This is a real (single-threaded, no-frills) executor core:`,
    },
    {
      type: 'code',
      filename: 'toy_executor.rs — the heart of tokio, miniaturized',
      lang: 'rust',
      code: `use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::future::Future;
use std::task::{Context, Poll, Waker};

struct Task {
    fut: Mutex<Box<dyn Future<Output = ()> + Send>>,
    queue: Arc<Mutex<VecDeque<Arc<Task>>>>,   // re-enqueue handle
}

impl Task {
    fn wake(self: &Arc<Self>) {
        self.queue.lock().unwrap().push_back(self.clone());  // ready again
    }
}

struct Executor { queue: Arc<Mutex<VecDeque<Arc<Task>>>> }

impl Executor {
    fn spawn<F: Future<Output = ()> + Send + 'static>(&self, f: F) {
        self.queue.lock().unwrap().push_back(Arc::new(Task {
            fut: Mutex::new(Box::new(f)),
            queue: self.queue.clone(),
        }));
    }

    fn run(&self) {
        loop {
            let task = match self.queue.lock().unwrap().pop_front() {
                Some(t) => t,
                None => { thread::park(); continue; }   // sleep until a wake
            };
            let waker: Waker = make_waker(task.clone());      // wires wake()
            let mut cx = Context::from_waker(&waker);
            if let Poll::Ready(()) = task.fut.lock().unwrap().as_mut().poll(&mut cx) {
                // task complete — drop it
            }                                       // else: Pending; a future
        }                                           // wake() will re-queue it
    }
}`,
      chips: ['poll once per wake', 'Pending = free', 'thread::park between events'],
    },
    {
      type: 'prose',
      md: `## From the toy to tokio

Everything tokio adds is scale and ergonomics on this exact skeleton: **multi-threaded work-stealing** (each worker has a local queue; steal from peers on empty — the CFS-style balancing of async), a **reactor** (epoll/kqueue/IOCP, io_uring increasingly) turning OS events into waker calls, **timers** (a hierarchical timer wheel feeding the same wake mechanism), and \`spawn_blocking\` for the sync-code escape hatch (T2.L6's "never block the loop," institutionalized). Python note: \`asyncio\` is the same architecture with a green-thread flavor — an event loop, callbacks, and tasks — minus the compile-time Send/Sync proof that makes Rust's version data-race-free.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `If you've written a Java state machine for a protocol parser — \`enum State { READING_HEADER, READING_BODY }\` plus a \`step()\` method called when bytes arrive — you have already hand-written a future. The async fn syntax just makes the compiler write that struct for you, and the executor is the "dispatcher" your team inevitably built around NIO selectors. New syntax, old bones: T2's event loop with a type system.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Two executor footguns that burn every team once. **(1) The accidentally-blocking task**: one \`std::thread::sleep\` or sync DB call inside a task parks *the worker thread* — every task queued behind it stalls (head-of-line, T2.L4). Use \`spawn_blocking\`. **(2) The forgotten wake**: a custom Future that returns Pending without arranging a wake is never polled again — the task silently hangs. Rule: **every Pending must have a wake path.** If you can't name yours, you have the bug.`,
    },
    {
      type: 'prose',
      md: `## Why this is a serving-systems lesson

An inference engine's control plane is an async-runtime workload: thousands of SSE streams, scheduler ticks, KV-transfer completions, cancellation when clients disconnect. The reason Dynamo's data plane and vLLM's Rust frontends behave predictably under that load is exactly this lesson: inert futures, explicit wakes, no hidden threads. Build the toy in the exercise, then read production architecture with working knowledge instead of faith.`,
    },
    {
      type: 'exercise',
      simId: 'sim-engine',
      machine: 'executor',
      title: 'Build & drive a toy executor',
      tasks: [
        'Spawn 3 timer futures on the toy executor; trace each poll/wake to completion.',
        'Insert a task that returns Pending with no wake registration; observe the silent hang — then fix it.',
        'Add a blocking sleep inside one task; watch the executor thread stall; move it to spawn_blocking.',
        'Count polls per task with a metrics hook; explain why "poll once per wake" is the efficiency invariant.',
      ],
      note: `The hang and the stall are the two production bugs of async Rust, experienced in miniature: missing wakes kill tasks silently; blocking calls kill throughput loudly. tokio is this executor plus work-stealing, a reactor, and timers — nothing conceptually new.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'An async fn in Rust compiles to…',
          options: [
            'A new OS thread',
            'An inert state-machine struct implementing Future — nothing runs until an executor polls it',
            'A callback registered with the kernel',
            'A green thread with its own stack',
          ],
          correct: [1],
          explanation:
            'Unlike JS Promises, Rust futures are cold: creating one executes nothing. Each .await is a suspension point in the generated state machine; only poll() advances it. Runtimes are libraries, not builtins.',
        },
        {
          q: 'The Waker exists to…',
          options: [
            'Wake sleeping OS threads directly',
            'Let a Pending future arrange re-polling only when progress is possible — no busy-loop, no sleeping thread per task',
            'Cancel futures on timeout',
            'Serialize access to the reactor',
          ],
          correct: [1],
          explanation:
            'Pending + registered wake = the task costs nothing while waiting. The reactor/timer calls wake() on readiness, re-queueing the task. This is what lets one thread multiplex 100k connections.',
        },
        {
          q: 'A task that returns Poll::Pending without arranging a wake will…',
          options: [
            'Be polled continuously until ready',
            'Never be polled again — a silent, permanent hang',
            'Panic the executor',
            'Be moved to another thread',
          ],
          correct: [1],
          explanation:
            'The executor only polls queued tasks; the queue is fed by wakes. "Every Pending must have a wake path" is the invariant — violating it is the classic custom-Future bug.',
        },
        {
          q: 'tokio adds to the toy executor primarily…',
          options: [
            'A garbage collector',
            'Multi-threaded work-stealing, an OS reactor (epoll/io_uring) driving wakes, timers, and spawn_blocking for sync code',
            'Green threads with per-task stacks',
            'A priority scheduler with inheritance',
          ],
          correct: [1],
          explanation:
            'Same skeleton, production muscle: worker pools balancing like CFS, OS event sources translated into waker calls, timer wheels, and a dedicated pool so blocking code never stalls async workers.',
        },
      ],
    },
  ],
}

export default lesson
