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

- (o1) The value is boxed on the heap and a null pointer marks the empty case at runtime
- (o2) Absence is a type variant and the compiler forces callers to handle it
- (o3) Each access is checked for null at runtime and throws on failure as in Java
- (o4) None carries an error that says why the value is missing

**Q2. Inside a Result-returning function, what does expr? do when expr is Err?**

- (o1) It evaluates to the error value and execution goes on as in Go
- (o2) It panics with the error value as unwrap does instead of returning it
- (o3) It unwinds like an exception to a catching caller, so signatures need no Result
- (o4) It returns the Err from the current function and converts it with From

**Q3. When should ordinary input validation return Result instead of panic?**

- (o1) When failures are frequent and rare ones should panic to save unwinding cost
- (o2) When the code is a library crate and a binary crate should panic instead
- (o3) When the caller can reasonably react such as rejecting a bad config value
- (o4) When the error is an I/O failure while a malformed value should panic

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
