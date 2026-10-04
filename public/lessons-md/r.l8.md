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

- (o1) It blocks until the borrow ends
- (o2) It panics at runtime
- (o3) It silently clones the value
- (o4) It creates a data race

**Q2. What releases a std::sync::Mutex lock?**

- (o1) A manual unlock call is always required
- (o2) Dropping the MutexGuard
- (o3) Cloning the mutex
- (o4) The next lock attempt

**Q3. Which type best fits a single-threaded shared counter whose value is Copy?**

- (o1) Cell<usize>
- (o2) Arc<usize>
- (o3) Box<Mutex<usize>>
- (o4) Weak<usize>

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
