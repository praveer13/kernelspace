# R.L5 — Structs, Enums, Option & Result

_Track R: Rust Zero · ~32 min · kernelspace_

> Make invalid states hard to express, then move ordinary failure through the type system with Result and ?.
Systems code becomes manageable when the types carry the state. A **struct** groups fields. An **enum** says a value is exactly one of several variants, and each variant may carry different data. Match then forces every state transition to be considered.

Rust has no null. **Option<T>** is either Some(T) or None. Recoverable failure is **Result<T, E>**: Ok(T) or Err(E). Both are ordinary enums, so the same matching rules apply.

---

```rust
#[derive(Debug, PartialEq)]
struct Block {
    id: usize,
    used: usize,
    capacity: usize,
}

impl Block {
    fn free(&self) -> usize {
        self.capacity.saturating_sub(self.used)
    }
}

fn parse_capacity(raw: &str) -> Result<usize, String> {
    let n: usize = raw.parse().map_err(|_| "not an integer".to_owned())?;
    if n == 0 { Err("capacity must be positive".into()) } else { Ok(n) }
}
```

---

## The question-mark operator is typed early return

Applied to a Result, **?** unwraps Ok and continues; on Err, it converts the error if needed and returns it from the current function. Applied to Option, it similarly returns None. This is not exception control flow: callers see fallibility in the function signature, and no hidden stack unwinding is required.

Use panic for violated programmer invariants, not malformed input or capacity exhaustion. If a caller can reasonably react, return Option or Result.

---

> **[isomorphism]** The allocator needs blocks and optional fits; the KV manager needs sequence states and fallible allocation; the tokenizer needs explicit symbol variants. R5 is the point where their data models stop looking foreign.

---

## Model six small domains

The [R5 Forge drill](/forge/rust-zero-r5) covers struct methods, an enum state machine, Option lookup, Result validation, error propagation with **?**, and matching nested state. Finish this drill before allocator lab 01; its Vec, slice, and Option vocabulary is the direct prerequisite.

---

**Q1. What does Option<T> communicate that a nullable reference does not?**

- (o1) The value lives on the heap
- (o2) Absence is an explicit variant that must be handled
- (o3) The function cannot fail
- (o4) The value is mutable

**Q2. Inside a Result-returning function, what does expr? do when expr is Err?**

- (o1) Retries the expression
- (o2) Panics immediately
- (o3) Ignores the error
- (o4) Returns that error from the current function, converting it when supported

**Q3. When should ordinary input validation return Result instead of panic?**

- (o1) Only in unsafe code
- (o2) Never
- (o3) When the caller can reasonably handle invalid input
- (o4) Only when allocating

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
