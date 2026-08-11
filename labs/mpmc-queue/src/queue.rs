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

#[allow(unused_imports)] // imports become live as the student completes the template
use std::sync::atomic::{AtomicU64, AtomicUsize};

pub struct Queue {
    // TODO(you): your state here.
    _priv: (),
}

impl Queue {
    pub fn new(capacity: usize) -> Self {
        let _ = capacity;
        todo!("round to pow2, init seq[i] = i, head = tail = 0")
    }

    pub fn push(&self, v: u64) -> Result<(), u64> {
        let _ = v;
        todo!("claim tail slot via CAS, store payload, publish seq")
    }

    pub fn pop(&self) -> Option<u64> {
        todo!("claim head slot via CAS, load payload, release seq")
    }
}
