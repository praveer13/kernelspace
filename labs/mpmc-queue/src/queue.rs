//! queue.rs — forge lab 04 · THE ONLY FILE YOU EDIT
//!
//! Mission: Vyukov's bounded MPMC queue. No Mutex. The queue is shared
//! across threads through `&self`, so all mutable state lives in atomics.
//!
//! The design (T2.L5's picture, now yours):
//!
//!     buf:  Vec<AtomicU64>     // one slot per payload (u64 is Copy: no
//!                              // MaybeUninit dance needed — store the
//!                              // payload, THEN publish via the seq cell)
//!     seq:  Vec<AtomicUsize>   // per-slot sequence number — THE trick
//!     head: AtomicUsize        // pop cursor (monotonic, never wraps in code)
//!     tail: AtomicUsize        // push cursor
//!     mask: usize              // capacity - 1 (capacity is a power of two)
//!
//! Slot i belongs to a "cycle". seq[i] tells you whose turn it is:
//!   * pushing at tail t: slot is yours when seq[t & mask] == t
//!   * popping at head h: slot is full  when seq[h & mask] == h + 1
//!   * after storing payload at tail t: publish with seq[t & mask] = t + 1
//!   * after loading payload at head h: release with seq[h & mask] = h + capacity
//! The signed difference (seq - expected) tells full vs empty apart when
//! head == tail — the classic ring-buffer ambiguity, solved by sequences.
//!
//! Algorithm, per op:
//!   loop {
//!     pos = tail.load(Acquire)               // (or head, for pop)
//!     slot = pos & mask
//!     s = seq[slot].load(Acquire)
//!     dif = s as isize - expected as isize   // expected: pos (push) / pos+1 (pop)
//!     if dif == 0 {                          // slot is yours to CLAIM
//!         if compare_exchange_weak(pos, pos+1, AcqRel, Acquire).is_ok() { break with pos }
//!     } else if dif < 0 {
//!         return Err(v)                      // full (push) / None (pop)
//!     }                                      // dif > 0: someone beat you — retry
//!   }
//!   // you own the slot now: store/load the payload, publish/release seq
//!
//! Init: seq[i] = i, head = 0, tail = 0. new() may round capacity UP to a
//! power of two (checks only use powers of two anyway).
//!
//! Memory-ordering cheatsheet: claim cursors with CAS (AcqRel), publish and
//! release slots with Release stores, observe with Acquire loads. Get an
//! ordering wrong and the native `stress_threads` test will find it — maybe
//! not on your first run. Run it ten times.
//!
//! Build it in four stages. Each one turns specific checks green. Go in
//! order: a later stage reuses what an earlier one built. Look for the
//! `STAGE` markers below; the signatures never change.
//!
//!   STAGE 1  fifo                           `new`, `push`, `pop` on one
//!                                           thread: the sequence numbers
//!                                           and the CAS claim
//!   STAGE 2  backpressure                   a full ring hands `Err(v)` back
//!                                           with the caller's own `v`, and a
//!                                           popped slot is free for the next
//!                                           push: `pop` releases it
//!   STAGE 3  wraparound, slot_conservation  the same release over many laps
//!                                           of the ring
//!   STAGE 4  model_gauntlet, burst_model    every branch at once, on seeds
//!                                           drawn when you grade
//!
//! Check a stage on your machine with `cargo test <check id>`, for example
//! `cargo test fifo`. A `todo!()` traps only the checks that reach it.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   fifo                a pop on an empty ring that returns a value instead
//!                       of None, a ring one slot smaller than asked for (the
//!                       8th push fails), a pop that reads the wrong slot
//!   backpressure        a full ring that says Ok, an Err that hands back a
//!                       different value, a freed slot that the next push
//!                       never gets (the check pops once, then pushes again:
//!                       `pop` must release the slot it emptied)
//!   wraparound          a pop that releases its slot at `pos + 1` instead of
//!                       `pos + capacity`, so it is stale on the next lap; a
//!                       release that is skipped now and then
//!   slot_conservation   the same two mistakes over 100 fill-and-drain laps:
//!                       a ring that loses a slot per lap runs dry
//!   model_gauntlet      what the four above miss: 3000 random operations on
//!                       a 4 to 32 slot ring, every Ok, Err and value
//!                       compared with a VecDeque
//!   burst_model         floods past the capacity, then partial drains: a
//!                       false full or a phantom slot at the edge of a burst
//! ```
//!
//! The browser runs one thread, so none of these checks races. The native
//! `stress_threads` test does (4 producers, 4 consumers, 100k items): a wrong
//! Release or Acquire passes every check above and fails only there.

#[allow(unused_imports)] // imports become live as the student completes the template
use std::sync::atomic::{AtomicU64, AtomicUsize};

pub struct Queue {
    // TODO(you): your state here. Stage 1 needs `buf`, `seq`, `head`, `tail`
    // and `mask`; nothing is added in later stages.
    _priv: (),
}

impl Queue {
    // STAGE 1 · fifo
    //   Round the capacity up to a power of two; seq[i] = i, head = tail = 0.
    pub fn new(capacity: usize) -> Self {
        let _ = capacity;
        todo!("round to pow2, init seq[i] = i, head = tail = 0")
    }

    // STAGE 1 · fifo
    //   The claim loop from the header: Acquire loads, then a CAS on `tail`
    //   when the slot is yours. Store the payload, THEN publish seq = t + 1.
    // STAGE 2 · backpressure
    //   dif < 0 means the slot still holds an unpopped value from the last
    //   lap: return Err(v) with the value you were given.
    pub fn push(&self, v: u64) -> Result<(), u64> {
        let _ = v;
        todo!("claim tail slot via CAS, store payload, publish seq")
    }

    // STAGE 1 · fifo
    //   The mirror image on `head`: expected = h + 1, and dif < 0 is None.
    // STAGE 2 · backpressure
    //   Release the slot for the NEXT lap: seq = h + capacity, not h + 1.
    //   The check pops once and pushes again, so the freed slot must be
    //   reusable already.
    // STAGE 3 · wraparound, slot_conservation
    //   Nothing new to write: they run the release over many laps. A release
    //   that is skipped now and then, or that lands at h + 1, shows up here.
    // STAGE 4 · model_gauntlet, burst_model
    //   Nothing new to write: these run every branch above in random order.
    pub fn pop(&self) -> Option<u64> {
        todo!("claim head slot via CAS, load payload, release seq")
    }
}
