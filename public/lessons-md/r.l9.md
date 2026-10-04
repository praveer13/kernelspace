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

- (o1) Extends heap allocation lifetime
- (o2) Adds reference counting
- (o3) Nothing; it supplies a compile-time relationship
- (o4) Runs a destructor later

**Q2. Why must struct Block<'a> declare a lifetime for its &[u32] field?**

- (o1) Slices always allocate
- (o2) The type must state that Block cannot outlive the borrowed slice
- (o3) The field is mutable
- (o4) All structs require lifetimes

**Q3. What is the right fix when data truly must outlive the input it came from?**

- (o1) Invent a longer lifetime annotation
- (o2) Return or store owned data
- (o3) Use a wildcard lifetime
- (o4) Disable Drop

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
