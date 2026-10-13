# R.L4 — Borrowing, References & Slices

_Track R: Rust Zero · ~40 min · kernelspace_

> Lend a value without moving it: many readers or one writer, with slices as the universal zero-copy view.
## Borrowing lends permissions

Moving into every function would be safe and exhausting. A reference lends access without transferring the cleanup obligation. To see exactly what a loan costs, track three permissions on every path the program can name: a variable **v**, a field **s.0**, or the target a reference points at.

- **R** (read): you can read the path.
- **W** (write): you can assign to it or mutate through it. Only a **let mut** binding starts with W.
- **O** (own): you can move it or drop it.

A **let mut v** binding holds **R, W and O**. A borrow lends some of them out and takes them from the lender until the reference's *last use*, not until the end of the scope:

- **&v** takes **W and O** from v. The lender keeps R, so any number of readers can share it.
- **&mut v** takes **R, W and O** from v. The borrower is the only way in.

Through **&T** the borrower can read the target. Through **&mut T** it can read and write it. That is the whole rule: many shared references or one mutable reference, never both, because a second **&mut** needs the W and R the first one took, while a second **&** needs only the R that **&** leaves in place.

---

```rust
let mut scores = vec![9, 4, 7];
let first = &scores[0];
println!("{first}");
scores.push(5);
let all = &mut scores;
all.push(6);
println!("{}", scores.len());
```

---

Read the table down the lines. **first** is the shared loan: while it lives, **scores** holds only R. Its last use is the **println!** on line 3, which is where **scores** gets W and O back, so the **push** on line 4 is allowed. **all** is the exclusive loan: **scores** holds nothing until **all**'s last use on line 6, and then everything returns. On line 7 even **scores** drops to nothing, because no later line uses it.

References also cannot outlive the value they point to. Together these rules prevent iterator invalidation, dangling references, and data races.

---

> **[segfault]** Take a reference to a Vec element and then push into the Vec. Push needs W, the shared reference took it, and push may reallocate, which would leave that reference dangling. Rust rejects the mutation while the reference is live. What looks like a picky rule is a concrete use-after-free prevented before the program exists.

---

```rust
let mut scores = vec![9, 4, 7];
for s in &scores {
    scores.push(*s);
}
```

**Java**

```java
List<Integer> scores = new ArrayList<>(List.of(9, 4, 7));
for (int s : scores) {
    scores.add(s);   // compiles; throws ConcurrentModificationException at run time
}
```

**Python**

```python
scores = [9, 4, 7]
for s in scores:
    scores.append(s)   # runs; the loop never ends, because the list keeps growing
```

**Align 1. The loop in your own language compiles and misbehaves at run time (Java throws, Python never stops). The Rust loop is rejected at compile time. Which line does the compiler reject, and which permission is missing there?**

- (o1) Line 3, scores.push(*s): scores keeps only R while the loop borrows it, and push needs W
- (o2) Line 1, let mut scores: a Vec that is iterated later cannot hold W from the start
- (o3) Line 2, for s in &scores: scores has no O left to lend, so the loop cannot borrow it
- (o4) Line 3, scores.push(*s): *s lacks R, because the loop variable stops borrowing after one pass

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._

---

## Slices are borrowed windows

**&[T]** is a pointer plus a length into a contiguous sequence. It can view an array, a Vec, or a smaller range of either without allocation. **&str** is the UTF-8 string slice equivalent.

A slice borrows like any other reference: **&values[1..]** takes W and O from all of **values**, not only from the elements in the window, because **values** is one path. Writes to the Vec wait for the window's last use.

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

## What the borrow checker cannot see

The checker reasons about paths and loans, not about your proof that two indexes differ or that a branch is dead. So it rejects two kinds of program, and this section is about telling them apart.

- **Rejected because it would dangle.** The push in the loop above may free the buffer a live reference points into. Nothing about it is conservative; the rejection is the bug report.
- **Rejected although it is safe.** No live path can reach memory that moved, was freed or changed under it, but the checker cannot see why. The tools are scoping, splitting and restructuring, and only rarely **unsafe** with a proof you write down.

Three programs come up again and again.

**1. Disjoint elements.** An index is a run-time value, so the checker tracks **v[0]** and **v[1]** as one path, **v**. The first **&mut v[0]** takes R, W and O from it, so the second finds nothing left to ask for. It is rejected with E0499 although the elements differ:

---

```rust
let mut v = vec![1, 2, 3];
let a = &mut v[0];
let b = &mut v[1];
*a += 1;
*b += 1;
```

---

**v.split_at_mut(1)** returns two disjoint windows, so each borrow covers only its own half. Its disjointness proof is a few lines of **unsafe** inside the standard library, written and audited once; that is what an unsafe boundary is in T3.

**2. Two-phase borrows.** **v.push(v.len())** looks like it needs **&mut v** first and a read of **v** second, which the simple rule rejects. It compiles: the **&mut v** is *reserved* while the arguments are evaluated and activated only when **push** runs, so **v** keeps R until then. Take the reference yourself with **let r = &mut v** and the reservation is gone: **r.push(v.len())** is E0502.

---

```rust
let mut v = vec![1, 2, 3];
v.push(v.len());                // accepted: two-phase borrow
let (a, b) = v.split_at_mut(1); // two disjoint windows
a[0] += 1;
b[0] += 1;
```

---

**3. A conditional return.** The borrow from **v.first()** flows into the return value, so the checker keeps **v** at R for the rest of the function, even on the path where the **if let** failed and nothing is borrowed. The push is rejected with E0502 although no path can dangle:

---

```rust
fn get_or_insert(v: &mut Vec<u32>) -> &u32 {
    if let Some(x) = v.first() {
        return x;
    }
    v.push(0);
    &v[0]
}
```

---

The repair restructures so the test finishes before the borrow you return begins:

---

```rust
fn get_or_insert(v: &mut Vec<u32>) -> &u32 {
    if v.is_empty() {
        v.push(0);          // the test's borrow is already over
    }
    &v[0]
}
```

---

To tell a real error from a safe one, ask what the line would do if the compiler let it through: could any live path still reach memory that moved, was freed or was changed under it? The loop and the push after **&v[0]** can. The first program above needs a split, the second nothing at all and the third a restructure.

## Repair borrows, not symptoms

The [R4 Forge drill](/forge/rust-zero-r4) covers shared slice queries, mutable slice updates, non-overlapping **split_at_mut**, strings as **&str**, early borrow endings, and returning a subslice. Each function should operate without cloning or allocating unless its signature explicitly returns an owned value. The codes you meet here, E0499 and E0502, each have a page in the [Error Museum](/errors).

---

**Q1. While a live &mut v borrow exists, which permissions has v itself given up?**

- (o1) Only O: v can still be read and written, but it can no longer be moved
- (o2) Only W: v can still be read, but nothing may write to it while the borrow lives
- (o3) R, W and O: the &mut becomes the only route into v until its last use
- (o4) W and O: v can still be read, exactly as it can under a shared borrow

**Q2. After let tail = &values[1..], what has values lost until tail's last use?**

- (o1) W and O on all of values, because the window is a borrow of the whole Vec path
- (o2) Nothing: the borrow covers elements 1 and later, so the first element stays writable
- (o3) Only O, since a slice is a view onto the data and reads and writes through values still work
- (o4) R, W and O on elements 1 and later, because a window is an exclusive loan

**Q3. Why does Vec::push conflict with a live shared reference to one of its elements?**

- (o1) push needs W on the Vec but the reference took it, and growth could free the buffer
- (o2) The Vec counts live element borrows at run time and push panics when that count is not zero
- (o3) push shifts the existing elements by one slot and changes what a held reference sees
- (o4) push consumes the Vec and leaves earlier references pointing at moved memory

**Q4. A function returns x from if let Some(x) = v.first(), then calls v.push(0) after the if, and the compiler rejects the push with E0502. Which repair keeps the function safe and cheap?**

- (o1) Test is_empty and push first, so the one borrow left is the one you return
- (o2) Take v by value instead, so the function owns it and may push as it likes
- (o3) Clone v before the if let, so the checker has a second Vec to borrow from
- (o4) Wrap the push in unsafe, since the path that reaches it holds no live reference

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
