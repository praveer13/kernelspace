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
//! at 2.4× offered load. The final score also replays the recorded BurstGPT
//! slice and a response-heavy LMSYS published-aggregate shape. The exact
//! provenance, time scaling, and clamps live in public/traces/README.md.
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
//!
//! Build it in four stages. Each one turns specific checks green. Go in
//! order: a later stage reuses what an earlier one built. Look for the
//! `STAGE` markers below; the signatures never change.
//!
//!   STAGE 1  runs_clean                     a legal `schedule`: admit what
//!                                           fits, in arrival order
//!   STAGE 2  slo_light, burst               fill the batch each call, not one
//!                                           request at a time
//!   STAGE 3  convoy, starvation             order by prompt size, keep
//!                                           headroom, age the oldest
//!   STAGE 4  goodput_score, overload_seeded the replay traces and a fresh
//!                                           overload (the last is optional)
//!
//! Check a stage on your machine with `cargo test <check id>`, for example
//! `cargo test runs_clean`. A `todo!()` traps only the checks that reach it.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   runs_clean       an illegal action (an id that is not waiting, more
//!                    than max_running, resident memory over mem_cap), or an
//!                    admit list that is always empty
//!   slo_light        admitting so slowly that light traffic misses its TTFT
//!                    bound: one request per call, or none at all
//!   burst            a batch that never fills: one request admitted at a
//!                    time, or so much headroom per running sequence that the
//!                    batch stays tiny
//!   convoy           first-come-first-served, which sends the 8192-token
//!                    whale first; largest-first; a headroom of zero (decode
//!                    growth thrashes the pool) or a huge one
//!   starvation       pure smallest-first: with no aging the three longs never
//!                    run under an endless stream of shorts
//!   goodput_score    a policy that passes the checks above and still falls
//!                    short on real-shaped traffic: first-come-first-served,
//!                    largest-first or a huge headroom each miss a floor on
//!                    the three fixed replays (55% synthetic overload, 85%
//!                    BurstGPT, 70% LMSYS shape)
//!   overload_seeded  first-come-first-served on a freshly drawn 2.4x
//!                    overload (optional): where `goodput_score` replays one
//!                    fixed trace, this one is redrawn every run
//! ```

use crate::{Action, State};

pub struct Scheduler {
    // TODO(you): your state here (none is a fine answer).
    _priv: (),
}

impl Scheduler {
    // STAGE 1 · runs_clean
    //   No state is needed yet.
    pub fn new() -> Self {
        todo!("construct your scheduler")
    }

    // STAGE 1 · runs_clean
    //   Walk `state.waiting` in order and admit while a slot is free and the
    //   whole prompt fits under `mem_cap` minus what is resident.
    // STAGE 2 · slo_light, burst
    //   Keep walking: one call should admit everything that fits, not the
    //   first request only. Skip a request that does not fit yet; do not
    //   stop at it.
    // STAGE 3 · convoy, starvation
    //   Sort the candidates smallest prompt first (FIFO within a size), leave
    //   about 48 tokens of headroom per running sequence, and move requests
    //   older than ~900 iterations to the front.
    // STAGE 4 · goodput_score, overload_seeded
    //   The stage 3 shape is the reference shape and clears the floors. If
    //   one trace misses, tune the headroom and the age limit, and read your
    //   three scores with `cargo run --example calibrate -- --mine`.
    pub fn schedule(&mut self, state: &State) -> Action {
        let _ = state;
        todo!("guard the ancient, smallest-first the rest, admit what fits")
    }
}
