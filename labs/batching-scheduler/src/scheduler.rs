//! scheduler.rs — forge lab 06 · THE ONLY FILE YOU EDIT
//!
//! Mission: the admission policy for a continuous-batching engine.
//! Once per iteration the harness calls `schedule` with the live state;
//! you return who to admit and who to preempt.
//!
//! Graded on GOODPUT UNDER SLO — a request counts only if it completes
//! with TTFT ≤ the scenario bound. Four scenarios stand between you and
//! done: a synchronized burst (admission control), an 8192-token whale
//! arriving with 88 shorts (the convoy), a never-ending short stream
//! with three longs inside (starvation), and a 400-request fleet trace
//! at 1.2× offered load.
//!
//! What you know at each call (see src/lib.rs for the types):
//!   * waiting: id, arrival, prompt_tokens  (output length is HIDDEN —
//!     production doesn't know it either)
//!   * running: + decoded, prefill_left
//!   * constraints: max_running slots, mem_cap resident tokens
//!     (resident = prompt + decoded; a full prompt is reserved at admit)
//!
//! The physics the checks enforce:
//!   * Illegal action (bad id, over slots, action pushes resident over
//!     mem_cap) = instant fail.
//!   * Decode GROWS resident memory every iteration. Admit right up to
//!     the cap and the engine auto-preempts the newest sequence for you
//!     (progress discarded). Leave ~48 tokens of headroom per running
//!     sequence, or watch the convoy scenario thrash.
//!   * Preempt yourself if you must — it discards the victim's progress
//!     (recompute mode). On these traces you won't need it.
//!   * Plain FCFS fails the convoy and the fleet. Pure smallest-first
//!     wins the fleet and starves the longs. The reference shape:
//!       1. requests older than ~900 iterations jump the queue
//!          (the starvation guard);
//!       2. everyone else smallest-prompt-first (FIFO within a class);
//!       3. admit in order while slots and (headroom-adjusted) memory fit;
//!          skip — don't stop at — requests that don't fit yet.
//!   * Want to race a baseline? examples/ has FCFS and SJF policies on
//!     the same simulator. `cargo run --example calibrate`.

use crate::{Action, State};

pub struct Scheduler {
    // TODO(you): your state here (none is a fine answer).
    _priv: (),
}

impl Scheduler {
    pub fn new() -> Self {
        todo!("construct your scheduler")
    }

    pub fn schedule(&mut self, state: &State) -> Action {
        let _ = state;
        todo!("guard the ancient, smallest-first the rest, admit what fits")
    }
}
