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

- (o1) It requires a trailing wildcard arm in every match over any enum
- (o2) It raises a runtime error when no arm matches the value
- (o3) It must cover each variant and a new variant breaks incomplete matches
- (o4) Arms fall through to the next arm unless each ends with a break

**Q2. What values does 0..4 produce?**

- (o1) 0, 1, 2, 3 and the upper bound 4 is excluded
- (o2) 0, 1, 2, 3, 4 and both ends are included
- (o3) 0, 1, 2, 3 in a for loop and 0 through 4 in a slice index
- (o4) 1, 2, 3, 4 and counting starts at one

**Q3. How can an infinite loop compute a value?**

- (o1) Its last body expression becomes the loop value like a block tail
- (o2) A break can carry the result of the loop as in break n
- (o3) A return statement is the way a loop hands back a value
- (o4) It needs a declared type on the loop before break carries a value

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
