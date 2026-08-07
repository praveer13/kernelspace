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

use std::future::Future;

use crate::{make_waker, Task, TaskQueue};
use std::cell::RefCell;
use std::rc::Rc;
use std::task::{Context, Poll};

pub struct Executor {
    // TODO(you): your state here.
    _priv: (),
}

impl Executor {
    pub fn new() -> Self {
        todo!("a fresh TaskQueue")
    }

    pub fn spawn(&self, fut: impl Future<Output = ()> + 'static) {
        let _ = fut;
        todo!("box it, Task {{ future, queue }}, push_back the Rc")
    }

    pub fn run(&self) -> usize {
        todo!("pop → take future → poll → restore on Pending; count polls")
    }
}

pub fn block_on<F: Future + 'static>(future: F) -> F::Output
where
    F::Output: 'static,
{
    let _ = future;
    todo!("spawn a wrapper that stores the Output; run; take it")
}
