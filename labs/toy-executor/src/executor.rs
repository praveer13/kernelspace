//! executor.rs — forge lab 05 · THE ONLY FILE YOU EDIT
//!
//! Mission: a single-threaded async executor. The unsafe waker plumbing
//! is in the harness (src/lib.rs); you build the state machine:
//!
//!     pub struct Executor { queue: Rc<TaskQueue> }   // suggested
//!
//! Contract (enforced by the harness):
//!   * `Executor::new()`      — a fresh queue.
//!   * `spawn(&self, fut)`    — box the future into a `Task`, wrap in Rc,
//!                              push onto the queue. Must be callable from
//!                              inside a poll (check 6).
//!   * `run(&self) -> usize`  — drain the queue; return the number of
//!                              polls executed. Pop a task, TAKE its future
//!                              out, poll it with `make_waker(&task)`:
//!                              Pending → put the future back; Ready → let
//!                              it drop. A popped task whose future is
//!                              already None (woken after completing) is
//!                              skipped — and is NOT a poll.
//!   * `block_on(future)`     — run one future to completion and return
//!                              its Output. Hint: an Executor, an
//!                              Rc<RefCell<Option<Output>>>, and one
//!                              spawned wrapper task.
//!
//! The invariants the checks probe:
//!   * Pending without wake = never re-polled (check 3 counts polls).
//!   * Woken tasks run in FIFO wake order (check 2).
//!   * Ready futures are dropped, never re-polled (check 5 counts).
//!   * Don't hold the queue borrow across poll() — the polled future may
//!     spawn (check 6) or wake (every check) into that same queue.
//!     (`while let Some(t) = queue.borrow_mut().pop_front()` holds the
//!     RefMut for the whole loop body. Ask the reference solution how it
//!     knows.)
//!
//! If the page hangs on drop: your run loop re-queues unconditionally —
//! re-read the third bullet.
//!
//! Build it in four stages. Each one turns specific checks green. Go in
//! order: a later stage reuses what an earlier one built. Look for the
//! `STAGE` markers below; the signatures never change.
//!
//!   STAGE 1  block_on                   `new`, `spawn`, a `run` that polls
//!                                       and restores, and `block_on`
//!   STAGE 2  fifo_poll, pending_repoll  poll order, an exact poll count, and
//!                                       no re-poll without a wake
//!   STAGE 3  ping_pong, nested_spawn    wakers stored across tasks; `spawn`
//!                                       from inside a poll
//!   STAGE 4  many_tasks                 1000 tasks, nothing lost, nothing
//!                                       polled twice
//!
//! Check a stage on your machine with `cargo test <check id>`, for example
//! `cargo test block_on`. A `todo!()` traps only the checks that reach it.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   block_on         a block_on that polls once and gives up at the first
//!                    Pending; a Pending future dropped instead of put back;
//!                    a pass over a snapshot of the queue, which never runs
//!                    the wake a poll made; a queue borrow held across poll
//!                    (the wake inside the poll panics, and so does every
//!                    other check)
//!   fifo_poll        a stack where a queue belongs, so tasks are polled
//!                    newest first; a run() whose count differs from the
//!                    polls it made
//!   pending_repoll   a loop that puts every Pending task back whether or not
//!                    it was woken: a parked task is polled again at once
//!   ping_pong        a wake lost between two tasks: the waker one task
//!                    stored fires during the other's poll, and run() must
//!                    still reach it
//!   nested_spawn     children and grandchildren spawned during a poll that
//!                    never run, or a spawn that finds the queue borrowed
//!   many_tasks       1000 tasks: any task lost, or a poll count above 3000
//! ```
//!
//! One mistake can turn several checks red. Fix the earliest red check first.

use std::future::Future;

#[allow(unused_imports)] // imports become live as the student completes the template
use crate::{make_waker, Task, TaskQueue};
#[allow(unused_imports)]
use std::cell::RefCell;
#[allow(unused_imports)]
use std::rc::Rc;
#[allow(unused_imports)]
use std::task::{Context, Poll};

pub struct Executor {
    // TODO(you): your state here. Stage 1 needs only the queue; nothing is
    // added in later stages.
    _priv: (),
}

impl Executor {
    // STAGE 1 · block_on
    //   A fresh `TaskQueue`, shared through an `Rc`.
    pub fn new() -> Self {
        todo!("a fresh TaskQueue")
    }

    // STAGE 1 · block_on
    //   Box the future into a `Task` and push the `Rc`.
    // STAGE 3 · nested_spawn
    //   A poll may call this, so the queue must not be borrowed then.
    pub fn spawn(&self, fut: impl Future<Output = ()> + 'static) {
        let _ = fut;
        todo!("box it, Task {{ future, queue }}, push_back the Rc")
    }

    // STAGE 1 · block_on
    //   Pop one task, TAKE its future out, poll it with `make_waker(&task)`,
    //   put it back on Pending. Loop until the queue is empty. Take the
    //   borrow in its own statement, so the RefMut is gone before the poll.
    // STAGE 2 · fifo_poll, pending_repoll
    //   Count only real polls. Never push a Pending task yourself: the
    //   waker does that when something wakes it.
    // STAGE 3 · ping_pong, nested_spawn
    //   Look at the live queue again each turn, never a snapshot: a wake or
    //   a spawn made during a poll must be run by this same call.
    // STAGE 4 · many_tasks
    //   No new code: the same loop at 1000 tasks.
    pub fn run(&self) -> usize {
        todo!("pop → take future → poll → restore on Pending; count polls")
    }
}

// STAGE 1 · block_on
//   An Executor, an `Rc<RefCell<Option<Output>>>`, one spawned wrapper task
//   that stores the Output; run; take it.
pub fn block_on<F: Future + 'static>(future: F) -> F::Output
where
    F::Output: 'static,
{
    let _ = future;
    todo!("spawn a wrapper that stores the Output; run; take it")
}
