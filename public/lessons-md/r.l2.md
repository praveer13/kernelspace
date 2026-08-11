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
   A. It runs arms in parallel
   B. It must cover every possible variant
   C. It allocates no stack
   D. It accepts truthy values
   Answer: B — Exhaustive matching means a new variant produces useful compiler errors at every decision point that needs updating.

**Q2. What values does 0..4 produce?**
   A. 0, 1, 2, 3
   B. 0, 1, 2, 3, 4
   C. 1, 2, 3, 4
   D. Only 0 and 4
   Answer: A — Standard ranges exclude the upper bound. Use 0..=4 for an inclusive range.

**Q3. How can an infinite loop compute a value?**
   A. return is mandatory
   B. break can carry the loop result
   C. All loops evaluate to true
   D. Only by mutating a global
   Answer: B — A loop expression can end with break value; the loop then evaluates to that value.
