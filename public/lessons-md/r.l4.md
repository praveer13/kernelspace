# R.L4 — Borrowing, References & Slices

_Track R: Rust Zero · ~34 min · kernelspace_

> Lend a value without moving it: many readers or one writer, with slices as the universal zero-copy view.
Moving into every function would be safe and exhausting. A reference lends access without transferring the cleanup obligation: **&T** reads, **&mut T** reads and writes.

The core rule is small enough to memorize: at one time, a value may have many shared references or one mutable reference — never both. References also cannot outlive the value they point to. Together those rules prevent iterator invalidation, dangling references, and data races.

---

## Slices are borrowed windows

**&[T]** is a pointer plus a length into a contiguous sequence. It can view an array, a Vec, or a smaller range of either without allocation. **&str** is the UTF-8 string slice equivalent.

Prefer slice parameters over **&Vec<T>** and **&String**. The narrower type accepts more callers and promises less about the underlying owner.

---

```rust
fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().map(|&b| u64::from(b)).sum()
}

fn clamp_first(values: &mut [i32], ceiling: i32) {
    if let Some(first) = values.first_mut() {
        *first = (*first).min(ceiling);
    }
}

let mut values = vec![9, 4, 7];
let tail = &values[1..];       // shared window
let sum = checksum(tail);
// tail is no longer used, so its borrow ends here
clamp_first(&mut values, 5);
```

---

> **[segfault]** Take a reference to a Vec element and then push into the Vec. Push may reallocate, making that reference dangle. Rust rejects the mutation while the reference is live. What looks like a picky rule is a concrete use-after-free prevented before the program exists.

---

## Repair borrows, not symptoms

The [R4 Forge drill](/forge/rust-zero-r4) covers shared slice queries, mutable slice updates, non-overlapping **split_at_mut**, strings as **&str**, early borrow endings, and returning a subslice. Each function should operate without cloning or allocating unless its signature explicitly returns an owned value.

---

**Q1. Which combination may exist at the same time for one value?**

- (o1) At most one reference of either kind, since even two &T could see a half-written update
- (o2) One &mut T alongside any number of &T, because readers cannot see an in-progress write
- (o3) Any number of &mut T, provided no two of them write the same element
- (o4) Many &T, or exactly one &mut T, but never a &mut T together with any other live reference

**Q2. Why prefer &[T] to &Vec<T> in a read-only function parameter?**

- (o1) A slice accepts arrays, Vecs and subranges, and exposes only the access the callee needs
- (o2) A &Vec<T> parameter forces the callee to allocate a new Vec, but a slice reuses the caller's existing buffer
- (o3) Indexing and iteration need a slice type, so a &Vec<T> parameter cannot use either one
- (o4) A &Vec<T> moves the Vec into the callee for good, whereas a slice only borrows part of it

**Q3. Why can Vec::push conflict with a live element reference?**

- (o1) push takes the Vec by value, so every earlier reference points at moved-from memory afterwards
- (o2) Vec counts live element borrows at runtime, and push panics whenever that count is nonzero
- (o3) push shifts existing elements along by one slot, so the held reference would see a different value
- (o4) push can reallocate the buffer, leaving any held element reference pointing at freed heap memory

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
