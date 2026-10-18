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

Everything tokio adds is scale and ergonomics on this exact skeleton: **multi-threaded work-stealing** (each worker has a local queue; steal from peers on empty — the same pull-toward-idle idea as the kernel's per-CPU load balancer), a **reactor** (epoll/kqueue/IOCP, io_uring increasingly) turning OS events into waker calls, **timers** (a hierarchical timer wheel feeding the same wake mechanism), and \`spawn_blocking\` for the sync-code escape hatch (T2.L6's "never block the loop," institutionalized). Python note: \`asyncio\` is the same architecture with a green-thread flavor — an event loop, callbacks, and tasks — minus the compile-time Send/Sync proof that makes Rust's version data-race-free.`,
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
      type: 'callout',
      variant: 'info',
      md: `**Build this.** Lab 05, [Async, Demystified](/forge/toy-executor), is this executor in a file you edit: \`spawn\`, \`run\` and \`block_on\` in \`src/executor.rs\`, with the unsafe waker plumbing already given. Start with its first check, \`block_on\`, which needs only \`spawn\`, \`run\` and one wrapper task. The page grades each of the six checks on its own, so that first green arrives before you touch the other five. Readiness: R7 and R8.`,
    },
    // P4 protégé block (wave-3.md §16.9, task 3s-12). The misconception: an executor keeps re-polling a Pending task until
    // it is ready. No research file names an executor misconception; this one is the lesson's own named footgun ("the
    // forgotten wake", the warning callout above), the slip the content audit counts as misconception handling
    // (content.md §2). The sim preset that proves the fix: the toy executor below (sim-engine, machine 'executor'), where a
    // task that returns Pending with no wake registered is never polled again and hangs silently.
    {
      type: 'protege',
      title: 'Sam explains a Pending future',
      setup: 'Sam is porting a Java NIO service to tokio and wrote down how the executor works.',
      sentences: [
        'An async fn returns a future, and creating it runs none of its body.',
        'The executor polls a task, which runs until it finishes or returns Pending.',
        'A Pending task goes back on the queue, and the executor polls it again on the next pass until it is ready.',
        'Before returning Pending, a future registers its waker with whatever will make progress possible.',
        'When the socket becomes readable, the reactor calls wake() and the task goes back on the queue.',
      ],
      falseAt: 2,
      find: {
        offer: [0, 2, 3, 4],
        why: [
          'True: futures are inert, so nothing runs until an executor polls one. A JavaScript Promise, by contrast, starts at once.',
          'False: a Pending task leaves the queue and costs nothing until its waker fires. Polling it on every pass would burn a core per task, and the executor in this lesson parks its thread when the queue is empty.',
          'True: the waker is the future\'s way back onto the queue, so it has to be registered before Pending is returned.',
          'True: wake() pushes the task onto the ready queue, and the next poll resumes it at its saved state.',
        ],
      },
      tag: {
        q: 'Which mistaken idea sits behind the false sentence?',
        options: [
          'Believing that creating a future starts running its body',
          'Mixing up the reactor that fires wakers with the executor that polls',
          'Assuming each task needs a thread of its own to wait on',
          'Believing a waiting future gets retried in a busy loop and not woken',
        ],
        correct: [3],
        why: [
          'A real mix-up, but not this one: sentence 1 states that futures are inert, and sentence 3 is about what happens after Pending.',
          'Not this one: sentence 5 gives each its job correctly, and sentence 3 is about whether a waiting task is polled at all.',
          'Not this one: sentence 3 keeps the task on one executor, and the mistake is how often it is polled, not where it waits.',
          'Right: that is busy polling. A Pending task is polled again after its waker puts it back, which is why a task that never arranges a wake hangs forever.',
        ],
      },
      fix: {
        q: 'Which sentence should replace sentence 3?',
        options: [
          'A Pending task stays on the queue but is polled less often, so that a slow socket costs a little CPU.',
          'A Pending task is moved to a thread of its own, which blocks on the socket until the data arrives.',
          'A Pending task is dropped, and its future is created again from the start once the socket is ready.',
          'A Pending task leaves the queue, and the next poll comes after its waker puts it back on the queue.',
        ],
        correct: [3],
        why: [
          'Wrong: polling less often is still polling. A waiting task costs nothing because nothing polls it until its waker fires.',
          'Wrong: a thread per waiting task is the blocking model async replaces. One executor thread multiplexes thousands of waiting tasks.',
          'Wrong: the future keeps its state across Pending and resumes where it stopped; starting again would repeat work and lose its place.',
          'Right: the waker is the one way back. In the toy executor below, a task that returns Pending with no wake registered is never polled again and hangs silently.',
        ],
      },
      kcs: ['t3.wakers-executor'],
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
            'A task on a new operating system thread that the runtime spawns and joins when the result is needed',
            'An inert state-machine struct implementing Future that does nothing until an executor polls it',
            'A promise-like object that starts running immediately and calls back when it finishes as in JavaScript',
            'A green thread with its own growable stack that the runtime switches to at each await as in Go',
          ],
          correct: [1],
          explanation:
            'Unlike JS Promises, Rust futures are cold: creating one executes nothing. Each .await is a suspension point in the generated state machine; only poll() advances it. Runtimes are libraries, not builtins.',
          why: [
            'An async fn creates no thread. A future is just data polled by whichever thread the executor uses, which is why one thread can drive thousands of them.',
            'Right: the compiler generates a state machine holding the locals needed across .await points. Creating the future runs nothing; each poll() advances it to its next suspension.',
            'That is JavaScript, where a Promise starts eagerly. Rust futures are lazy: calling an async fn only builds the state machine, and a future dropped unpolled never ran its body.',
            'Goroutines have stacks; Rust async is stackless. The compiler stores only the locals needed across awaits inside the future, which is why a task is small.',
          ],
          kcs: ['t3.futures-state-machines'],
          miss: ['t3.async-fn-is-a-thread', '', 't3.async-fn-is-an-eager-promise', 't3.async-fn-is-a-green-thread'],
        },
        {
          q: 'The Waker exists to…',
          options: [
            'Interrupt the executor thread with a signal and make it abandon its current task to poll the ready one',
            'Let a Pending future be re-polled when progress is possible without a busy loop or a thread per task',
            'Carry the Output value of a finished future back to the task that awaited it and then wake that task',
            'Re-poll each Pending future on a fixed timer interval until it reports Ready instead of waiting for readiness',
          ],
          correct: [1],
          explanation:
            'Pending + registered wake = the task costs nothing while waiting. The reactor/timer calls wake() on readiness, re-queueing the task. This is what lets one thread multiplex 100k connections.',
          why: [
            'A waker never preempts running code. It only re-queues a task for a later poll, and the executor finishes its current poll() call first.',
            'Right: Pending plus a registered waker costs nothing while waiting. When the reactor or a timer calls wake(), the task is queued for another poll.',
            'Results travel through poll() returning Ready(value), not through the waker. The waker carries no data; it only signals that polling again could now make progress.',
            'Interval polling is the busy-loop the waker replaces. Fixed retries burn CPU while idle and add latency once ready; a wake fires exactly when readiness changes.',
          ],
          kcs: ['t3.wakers-executor'],
          miss: ['t3.waker-interrupts-the-executor', '', 't3.waker-carries-the-output', 't3.waker-polls-on-a-timer'],
        },
        {
          q: 'A task that returns Poll::Pending without arranging a wake will…',
          options: [
            'Be polled again on the next loop turn as the executor retries each Pending task in a busy loop',
            'Stay parked without being polled again and hang silently with no error and no panic',
            'Panic the executor through a debug assertion that detects the missing waker registration at run time',
            'Be polled again after a default retry interval elapses as runtimes fall back to timed polling',
          ],
          correct: [1],
          explanation:
            'The executor only polls queued tasks; the queue is fed by wakes. "Every Pending must have a wake path" is the invariant — violating it is the classic custom-Future bug.',
          why: [
            'Executors poll only tasks in the ready queue, which wakes fill. A Pending future with no wake is not re-queued, so there is no retry loop.',
            'Right: wake() is the only route back into the ready queue. Without one the task is never polled again, so it hangs silently with no error or panic.',
            'Nothing detects the missing wake. Pending is a valid return and the executor cannot know a wake is coming, so the failure shows up as a task that never finishes.',
            'Runtimes do not poll on a default interval; that would reintroduce busy-polling. A task with no wake path simply stays parked indefinitely.',
          ],
          kcs: ['t3.wakers-executor', 't3.futures-state-machines'],
          miss: ['t3.pending-is-retried-in-a-loop', '', 't3.missing-wake-panics', 't3.pending-is-retried-on-a-timer'],
        },
        {
          q: 'tokio adds to the toy executor primarily…',
          options: [
            'A tracing garbage collector that reclaims finished tasks with the buffers and sockets they held',
            'Work-stealing worker threads and a reactor that turns operating system events into wakes plus timers',
            'Stackful green threads, one per task, so an ordinary blocking call suspends only the task that made it',
            'Preemptive time slicing like an operating system scheduler that interrupts a long-running task and gives others a turn',
          ],
          correct: [1],
          explanation:
            'Same skeleton, production muscle: worker pools balancing like per-CPU kernel runqueues, OS event sources translated into waker calls, timer wheels, and a dedicated pool so blocking code never stalls async workers.',
          why: [
            'There is no collector. Futures own their state and tasks are reference-counted, so memory is reclaimed deterministically when the last handle drops.',
            'Right: tokio keeps the same poll-and-wake skeleton and adds worker threads that steal tasks, a reactor turning OS events into wakes, a timer wheel, and spawn_blocking.',
            'Tokio tasks are stackless futures. A blocking call inside one still blocks its worker thread, which is exactly why spawn_blocking exists.',
            'Tokio scheduling is cooperative: a task gives up its thread only at an .await. A long computation between awaits holds the worker and delays everything queued behind it.',
          ],
          kcs: ['t3.wakers-executor'],
          miss: ['t3.tokio-adds-a-collector', '', 't3.tokio-uses-stackful-green-threads', 't3.tokio-preempts-tasks'],
        },
      ],
    },
  ],
  kcs: ['t3.futures-state-machines', 't3.wakers-executor'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt:
          'Explain why a future that returns Pending without arranging a wake hangs, and how the executor and waker fit together.',
        model:
          'The executor polls only tasks in its ready queue. When poll returns Pending the task leaves the queue until its waker is called, which the reactor or a timer does when progress is possible, pushing the task back. A future that returns Pending with no wake path is never queued again, so it hangs silently.',
        ideas: [
          'The executor polls only tasks in its ready queue',
          'A Pending task leaves the queue until its waker is called by a reactor or timer',
          'With no wake path the task is never re-queued, so it hangs silently',
        ],
        kcs: ['t3.wakers-executor'],
      },
      {
        prompt:
          'Describe what an async fn compiles to, and why creating a future does nothing until it is polled.',
        model:
          'The compiler turns an async fn into a state machine: a struct holding the locals that live across await points, plus a record of where it is suspended. Creating it runs nothing. Only poll advances the machine, to its next await or to completion, and only the executor calls poll, so futures are inert without a runtime.',
        ideas: [
          'A struct of the locals kept across awaits, plus the current suspension point',
          'Creating the future runs no code: calling the async fn only builds the struct',
          'Only poll advances it, and the executor is what calls poll',
        ],
        kcs: ['t3.futures-state-machines'],
      },
    ],
  },
}

export default lesson
