# R.L9 — Practical Lifetimes

_Track R: Rust Zero · ~31 min · kernelspace_

> Read lifetime syntax as a contract between references, then build the exact borrowed Block used later in T3.
A lifetime annotation does not keep a value alive and does not change runtime behavior. It names a relationship the compiler must prove: an output reference came from a particular input, or a struct containing a reference cannot outlive its source.

Rust infers these relationships in ordinary calls. You write **'a** when a function signature or data type could otherwise be ambiguous.

---

```rust
struct Block<'a> {
    tokens: &'a [u32],
}

impl<'a> Block<'a> {
    fn first(&self) -> Option<&u32> {
        self.tokens.first()
    }
}

fn longer<'a>(left: &'a str, right: &'a str) -> &'a str {
    if left.len() >= right.len() { left } else { right }
}

fn prefix(input: &str, n: usize) -> &str {
    &input[..input.len().min(n)] // elision infers the relationship
}
```

---

## Read the contract from the caller's side

The return of **longer** is usable only for the overlap in which both inputs remain valid, because either input might be chosen. A **Block<'a>** may live only while its token slice lives. The struct owns no token storage; it is a checked view.

If a requested reference really must outlive its input, annotations cannot make that safe. Return owned data, move ownership into the long-lived object, or redesign the boundary.

---

> **[warning]** Adding the same lifetime to every reference can over-constrain an API by claiming unrelated borrows must overlap. Start with elision, read the compiler's missing-relationship message, and name only the relationship callers need.

---

## Prove borrowed views

The [R9 Forge drill](/forge/rust-zero-r9) returns subslices, chooses between borrowed strings, defines **Block<'a>**, separates two unrelated lifetimes, and replaces an impossible escaping reference with owned data. T3.L1 uses the same Block shape; after this drill it is a reminder, not a cliff.

---

**Q1. What does a lifetime annotation do at runtime?**

- (o1) It keeps the referent alive until 'a ends, moving it to the heap if needed
- (o2) It stores a scope tag with the reference and checks it on dereference, panicking if the scope ended
- (o3) It adds a reference count to the referent, as Rc does, so 'a lasts while any holder remains
- (o4) Nothing at runtime, because it is compile-time metadata relating how long references stay valid

**Q2. Why must struct Block<'a> declare a lifetime for its &[u32] field?**

- (o1) The type must say that a Block cannot outlive its borrowed slice, so rustc can check it
- (o2) Rust needs 'a to compute the size of Block, because a slice length is unknown at compile time
- (o3) It is optional for shared slice fields, since elision applies; &mut fields demand it
- (o4) A slice owns its elements, and 'a tells Rust how long Block keeps that storage allocated

**Q3. What is the right fix when data truly must outlive the input it came from?**

- (o1) Copy the reference with `let r2 = r`, so the copy no longer depends on the input
- (o2) Return or store owned data, such as a Vec or String, so nothing borrows from the input
- (o3) Declare the return as 'static, so the reference stays valid for the whole program
- (o4) Wrap the reference in a Box, because heap placement gives it an independent lifetime

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
