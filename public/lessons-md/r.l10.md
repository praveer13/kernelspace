# R.L10 — Atomics & Memory Orderings

_Track R: Rust Zero · ~42 min · kernelspace_

> Atomicity is only half the contract. Use Relaxed for counters and Acquire/Release to publish initialized state.
An atomic operation cannot tear and participates in a memory-ordering contract. That does not make an algorithm correct by itself. You must decide which writes another thread is allowed to observe, and in what order.

Start with three orderings. **Relaxed** guarantees atomic modification of that atomic value only. A **Release** operation publishes earlier writes. An **Acquire** operation that observes that release makes those earlier writes visible to its thread.

---

```rust
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

fn next_id(counter: &AtomicUsize) -> usize {
    counter.fetch_add(1, Ordering::Relaxed)
}

fn try_lock(locked: &AtomicBool) -> bool {
    locked
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_ok()
}

fn unlock(locked: &AtomicBool) {
    locked.store(false, Ordering::Release);
}
```

---

## Compare-and-exchange is conditional ownership transfer

CAS changes an atomic only if it still equals the expected value. On success it returns the old value; on failure it reports the value actually observed. Real lock-free algorithms retry because another thread may win between your load and CAS.

The success and failure orderings describe different events. Failure performs only a load, so it cannot use Release. For a spin lock, successful Acquire pairs with Release unlock; failed probes can be Relaxed. For a metrics counter with no associated data, Relaxed is enough.

---

> **[warning]** MPMC queue lab 04 uses CAS cursors plus Acquire/Release publication. Guessing SeqCst everywhere may hide the model but does not repair an incorrect protocol. Complete R10 first, and write down which store publishes each slot before implementing the queue.

---

## Practice before lock-free

The [R10 Forge drill](/forge/rust-zero-r10) covers a Relaxed ticket counter, Release/Acquire publication, compare-exchange, fetch-update, a minimal spin lock, and an ordering classifier. Pair it with [Mara Bos, Rust Atomics and Locks chapters 2–3](https://marabos.nl/atomics/). Then proceed to MPMC queue lab 04.

---

**Q1. When is Ordering::Relaxed sufficient?**

- (o1) Every compare_exchange loop because the compare and swap happen as one atomic step
- (o2) A standalone ticket or metrics counter that guards no other data
- (o3) The store that unlocks a spin lock since only one atomic bool changes
- (o4) A ready flag set after filling a non-atomic buffer, because the flag store is itself atomic

**Q2. What relationship does Release/Acquire establish when the Acquire observes the Release?**

- (o1) Both operations become SeqCst, so every atomic in the program gets one global order
- (o2) The Acquire blocks until the releasing thread leaves its critical section as with a lock
- (o3) Every thread sees the writes at once and not only the thread that performed the Acquire
- (o4) Writes made before the Release are visible to the thread whose Acquire load observes it

**Q3. Why must compare_exchange code handle failure?**

- (o1) A failed CAS poisons the atomic, as with a Mutex, and it must be reset before reuse
- (o2) A failed CAS means the Acquire ordering was too weak, and a stronger one removes failures
- (o3) Another thread can change the value after your load, so Err returns what it saw
- (o4) A failed CAS can tear the value, so the caller must restore the old one

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
