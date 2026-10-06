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

- (o1) b becomes the sole owner of the buffer and a is no longer usable
- (o2) The buffer was deep-copied and a and b are independent owners
- (o3) The buffer was freed at once and a holds an empty String that is still usable
- (o4) a and b both point at the buffer and the last one to leave scope frees it

**Q2. Why is clone() intentionally explicit?**

- (o1) Implicit duplication would call drop() twice on the same buffer, so the call must be spelled out
- (o2) The compiler cannot tell if a type is safe to clone(), so the programmer must vouch for it
- (o3) clone() is built on unsafe pointer copies, so each use must be deliberate and auditable
- (o4) Duplicating a heap value can copy a lot of data, so clone() makes the cost visible

**Q3. What does Drop provide?**

- (o1) Cleanup of heap memory while files and locks are left to a manual close call
- (o2) Cleanup run by a background collector some time after the owner leaves scope
- (o3) Deterministic cleanup of what the value owns such as memory or a file
- (o4) Cleanup that runs when the code calls drop by hand as it would call close in C

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
