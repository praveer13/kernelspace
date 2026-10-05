# R.L2 — Functions, Control Flow & Match

_Track R: Rust Zero · ~26 min · kernelspace_

> Write ordinary logic in Rust: typed functions, value-returning branches, loops, and your first exhaustive match.
Rust functions make their contracts visible: parameter and return types are written down, while local types are usually inferred. Control flow is expression-oriented, so **if** and **match** can compute values without temporary mutable variables.

This lesson stays ownership-free on purpose. First make the syntax boring; moves and borrows arrive next.

---

## Four loops, one exit value

Use **for item in iterator** for bounded traversal, **while condition** when the condition owns the shape, and **loop** for an explicit state machine. A **break value** can return a result from loop. Ranges are half-open by default: **0..n** visits zero through n − 1.

Rust has no truthiness. Conditions must be **bool**, which removes an entire family of “empty string means false” surprises.

---

```rust
fn classify_load(active: usize, capacity: usize) -> &'static str {
    match (active, capacity) {
        (_, 0) => "disabled",
        (0, _) => "idle",
        (a, c) if a >= c => "full",
        _ => "open",
    }
}

fn first_power_above(limit: u32) -> u32 {
    let mut n = 1;
    loop {
        if n > limit { break n; }
        n *= 2;
    }
}
```

---

> **[info]** A Java switch or Python match can quietly ignore a newly added case. Rust requires every possibility to be covered. The wildcard arm **_** is useful, but named arms are better when adding a new enum variant should force every consumer to reconsider its behavior.

---

## Drill the shapes

The [R2 Forge drill](/forge/rust-zero-r2) asks for six pure functions: a branch expression, range sum, while-based search, loop with a break value, tuple match, and guarded match. None needs allocation or borrowing. If ownership appears in an error, you have made the solution more complicated than the problem.

---

**Q1. What property makes match especially useful with enums?**

- (o1) It requires a trailing default arm, as a Java switch often does, to stay safe
- (o2) It raises a runtime error when no arm matches, so tests must exercise every variant
- (o3) It must cover every variant, so a newly added variant breaks incomplete matches
- (o4) Arms fall through to the next one unless each ends with a break, as in a C switch

**Q2. What values does 0..4 produce?**

- (o1) 0, 1, 2, 3, because the upper bound is excluded unless you write the inclusive form 0..=4
- (o2) 0, 1, 2, 3, 4, because Rust ranges include both ends, as in Ruby
- (o3) 0, 1, 2, 3 in a for loop, but v[0..4] as a slice index includes element 4
- (o4) 1, 2, 3, 4, because Rust ranges count from one, like Lua or Fortran arrays

**Q3. How can an infinite loop compute a value?**

- (o1) Its last body expression becomes the value, as with the tail of a block
- (o2) break can carry the loop's result, as in break n
- (o3) Only through return, since every loop evaluates to the unit value
- (o4) It needs a declared type, as in loop -> u32, before break may carry a value

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
