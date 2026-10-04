# R.L1 — Bindings, Types & Expressions

_Track R: Rust Zero · ~24 min · kernelspace_

> Rust looks familiar until a block returns a value. Learn the small syntax rules that make every later error readable.
You already know variables, numbers, booleans, and functions. Rust changes the defaults: a binding is immutable, integer types have explicit widths, and most syntax that looks like control flow is also an expression.

The goal is not memorization. It is to make rustc's messages feel literal. When it says “cannot assign twice to immutable variable,” the fix is a deliberate **mut** or a new shadowing binding — not a workaround.

---

## Bindings are immutable; shadowing is a new binding

**let x = 4** binds a name once. **let mut x = 4** grants mutation. **let x = x + 1** shadows the old x with a new value and may even change its type. That distinction matters: mutation changes a value through one binding; shadowing ends one binding and starts another.

Rust infers local types, but public boundaries and ambiguous conversions should be explicit. The scalar vocabulary is compact: signed and unsigned integers such as **i32** and **usize**, floating point **f32/f64**, **bool**, and Unicode scalar **char**. Arithmetic never silently mixes numeric types.

---

```rust
let requests = 8;             // inferred i32, immutable
let requests = requests as usize; // shadow with a new type
let mut admitted = 0usize;
admitted += 1;

let capacity = {
    let blocks = 16;
    blocks * 4                 // no semicolon: block value
};

let label = if admitted < capacity {
    "open"                    // both branches return &str
} else {
    "full"
};
```

---

> **[analogy]** A Rust **let** is closer to a Java final local than a Python name, except shadowing lets you reuse the spelling during a transformation. A block's last expression behaves like a tiny Python lambda result: add a semicolon and you intentionally turn that result into the unit value **()**.

---

## The two small shapes the drill also uses

R1 asks you to accumulate values from a slice and swap a tuple. A **for** loop visits each item; a **let pattern** names tuple members. These are ordinary bindings, not two new systems concepts:

---

```rust
let samples = [3, -1, 4];
let mut total = 0;
for sample in samples {
    total += sample;
}

let point = (12, 7);
let (x, y) = point;            // destructure the tuple
let transposed = (y, x);
```

---

## Make rustc prove the basics

The [R1 Forge drill](/forge/rust-zero-r1) contains six small functions: mutable accumulation, shadowing, explicit conversion, block expressions, conditional values, and tuple destructuring. Its page now lists each behavior contract. Inside the workspace, read **src/lib.rs** for the exact example inputs and outputs, but edit only **src/exercises.rs**.

The starter **todo!()** bodies deliberately compile and then panic, so the first test run only says “unfinished.” That is expected. Once you replace one body, rustc's type errors become specific feedback about that attempt. Work one function and one check at a time.

---

**Q1. What does let x = x + 1 do when x already exists?**

- (o1) Fails in every case
- (o2) Mutates the original binding
- (o3) Allocates x on the heap
- (o4) Creates a new binding that shadows the old one

**Q2. Why does removing the final semicolon from a Rust block matter?**

- (o1) It disables type checking
- (o2) The final expression becomes the block value
- (o3) It makes the value mutable
- (o4) It makes the block asynchronous

**Q3. Which integer type is normally used for collection indexes?**

- (o1) f64
- (o2) i8
- (o3) char
- (o4) usize

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
