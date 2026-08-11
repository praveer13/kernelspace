# R.L8 — Interior Mutability: Cell, RefCell & Mutex

_Track R: Rust Zero · ~34 min · kernelspace_

> When mutation must live behind shared ownership, choose a tiny copy cell, runtime borrow checking, or a real lock.
Sometimes an API needs shared outer access while a small implementation detail changes inside. Rust calls this **interior mutability**. It does not remove the many-readers-or-one-writer law; it moves enforcement to a mechanism suited to the context.

**Cell<T>** replaces small Copy values. **RefCell<T>** checks shared/exclusive borrows at runtime on one thread. **Mutex<T>** coordinates exclusive access across threads and returns a guard whose lifetime holds the lock.

---

```rust
use std::cell::{Cell, RefCell};
use std::sync::Mutex;

let hits = Cell::new(0usize);
hits.set(hits.get() + 1);

let queue = RefCell::new(vec![1, 2]);
queue.borrow_mut().push(3); // guard ends at the semicolon

let shared = Mutex::new(vec!["prefill"]);
{
    let mut guard = shared.lock().unwrap();
    guard.push("decode");
} // guard drops; mutex unlocks
```

---

## “Already borrowed” is a runtime borrow-checker error

Holding **let read = cell.borrow()** and then calling **cell.borrow_mut()** violates the same aliasing rule that **&T** plus **&mut T** would violate. RefCell cannot prove the conflict statically, so it panics. Shorten guard lifetimes with inner scopes and do not call unknown code while a mutable guard is held.

For Mutex, keep critical sections small, never hold a synchronous guard across an await point, and decide how poisoned-lock errors should be handled rather than sprinkling unwrap blindly.

---

> **[segfault]** RefCell trades compile-time rejection for a possible runtime panic; Mutex trades unrestricted access for blocking and possible contention. Reach for them when shared mutation is truly part of the model, not to silence an ownership design you have not understood.

---

## Trigger the trap, then remove it

The [R8 Forge drill](/forge/rust-zero-r8) uses Cell for a counter, RefCell for a log, **try_borrow_mut** for non-panicking conflict detection, scoped guards to fix an already-borrowed failure, and Mutex-protected state. It is the direct ramp to the Arc/Mutex queue in executor lab 05.

---

**Q1. What happens when RefCell::borrow_mut conflicts with a live shared borrow?**
   A. It blocks until the borrow ends
   B. It panics at runtime
   C. It silently clones the value
   D. It creates a data race
   Answer: B — RefCell enforces the borrow law dynamically. try_borrow_mut returns an error when panic is not appropriate.

**Q2. What releases a std::sync::Mutex lock?**
   A. A manual unlock call is always required
   B. Dropping the MutexGuard
   C. Cloning the mutex
   D. The next lock attempt
   Answer: B — The guard owns the lock obligation. RAII releases it deterministically when the guard leaves scope.

**Q3. Which type best fits a single-threaded shared counter whose value is Copy?**
   A. Cell<usize>
   B. Arc<usize>
   C. Box<Mutex<usize>>
   D. Weak<usize>
   Answer: A — Cell provides simple get/set interior mutability for Copy values without borrow guards.
