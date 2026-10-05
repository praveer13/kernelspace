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

- (o1) b owns the buffer, and a is no longer usable after the move
- (o2) The heap buffer was deep-copied, so a and b are now independent owners
- (o3) The buffer was freed at once and a now holds an empty String that is still usable
- (o4) a and b both point at the buffer and the last one to leave scope frees it

**Q2. Why is clone() intentionally explicit?**

- (o1) Implicit duplication would run Drop twice on one buffer, so the call must be spelled out
- (o2) The compiler cannot tell whether a type is safe to duplicate, so the programmer must vouch for it each time
- (o3) clone() is built on unsafe pointer copies, so Rust makes each use deliberate and auditable
- (o4) Duplicating a heap value can allocate and copy a lot of data, so the cost is visible at the call site

**Q3. What does Drop provide?**

- (o1) Cleanup of heap memory only, since files and locks still need a manual close call
- (o2) Cleanup run by a background collector some time after the owner leaves scope, like a Java finalizer
- (o3) Deterministic cleanup of whatever the value owns, such as memory, a file or a lock, when its owner ends
- (o4) Cleanup that happens only when code calls drop() explicitly, like close() in C

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
