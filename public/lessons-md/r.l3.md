# R.L3 — Ownership, Moves, Clones & Drops

_Track R: Rust Zero · ~32 min · kernelspace_

> Every resource has one owner. Follow the obligation through moves and the borrow checker stops feeling supernatural.
Python and Java track object liveness at runtime. Rust makes a simpler promise at compile time: every resource has one owner, assignment normally transfers that ownership, and the resource is dropped exactly once when its owner leaves scope.

Think of ownership as a cleanup obligation, not as possession. A move hands that obligation to a new binding. The old binding is dead from that line onward.

---

## Copy is cheap duplication; Clone is explicit work

Small scalar values such as integers implement **Copy**, so assignment duplicates their bits. Heap-owning values such as **String** and **Vec** move by default. Calling **clone()** performs an explicit deep copy when that is truly the desired semantics.

Do not use clone as borrow-checker punctuation. Ask who should own the value after the call. Often the correct repair is returning ownership, borrowing in R4, or moving the value into the longer-lived component.

---

```rust
fn normalize(mut name: String) -> String {
    name.make_ascii_lowercase();
    name                         // move ownership back to caller
}

let original = String::from("Decode");
let snapshot = original.clone(); // explicit second buffer
let normalized = normalize(original);
// original is dead; normalized owns its buffer

drop(snapshot);                  // deterministic cleanup, usually implicit
```

---

> **[warning]** A move usually copies only the small stack representation — pointer, length, capacity — then forbids the source binding. The heap bytes stay where they are. Rust gets zero-copy transfer and prevents two owners from freeing the same allocation.

---

## Learn by repairing move errors

The [R3 Forge drill](/forge/rust-zero-r3) makes ownership cross function boundaries, collections, and match arms. Six checks distinguish Copy from move, return an owned value, clone only when two independent buffers are required, consume a Vec, and use **mem::replace** to move a field safely. Read every compiler diagnostic from the first error down; later errors are often consequences.

---

**Q1. After let b = a for a String, what happened?**
   A. The heap buffer was deep-copied
   B. b owns the buffer and a is no longer usable
   C. a and b are garbage-collected aliases
   D. The string was dropped immediately
   Answer: B — The pointer/length/capacity representation moves to b. Rust invalidates a so only one owner can eventually drop the buffer.

**Q2. Why is clone() intentionally explicit?**
   A. It always uses unsafe code
   B. It can represent real allocation and copying cost
   C. It changes a value to mutable
   D. It disables Drop
   Answer: B — Rust keeps potentially expensive duplication visible at the call site rather than hiding it behind assignment.

**Q3. What does Drop provide?**
   A. Nondeterministic garbage collection
   B. Deterministic resource cleanup at the end of ownership
   C. Automatic deep copying
   D. A way to skip the type checker
   Answer: B — When the owner leaves scope, Rust runs its destructor exactly once, covering memory and resources such as files or locks.
