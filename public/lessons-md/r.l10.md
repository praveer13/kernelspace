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
   A. Whenever multiple atomics coordinate a data structure
   B. For an independent atomic counter with no other data to publish
   C. For unlocking a mutex
   D. For publishing initialized non-atomic data
   Answer: B — Relaxed guarantees atomic updates to the counter itself but establishes no visibility relationship for surrounding memory.

**Q2. What relationship does Release/Acquire establish when the Acquire observes the Release?**
   A. It deep-copies shared data
   B. Earlier writes before Release become visible after Acquire
   C. It prevents all thread scheduling
   D. It makes every future operation sequentially consistent
   Answer: B — The pair creates the happens-before edge used to publish initialized state safely.

**Q3. Why must compare_exchange code handle failure?**
   A. CAS always fails once
   B. Another thread may change the value between observation and the attempted update
   C. Atomics can tear
   D. Failure means memory corruption
   Answer: B — Contention is normal. A CAS loop recomputes from the newly observed state until it succeeds or chooses to stop.
