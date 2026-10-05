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

- (o1) It is a compile error that rejects a second binding of the same name in one scope
- (o2) It mutates the existing binding in place and needs x to be declared with mut
- (o3) It allocates a fresh x on the heap and keeps the old value alive beside it
- (o4) It creates a new binding named x that shadows the old one and may change the type

**Q2. Why does removing the final semicolon from a Rust block matter?**

- (o1) The last line is skipped at runtime and the block produces no value
- (o2) The final expression becomes the value that the block produces
- (o3) The block returns early and ends the enclosing function with that value
- (o4) The block turns lazy and runs its statements when the result is first read

**Q3. Which integer type is normally used for collection indexes?**

- (o1) The u32 type that is wide enough for a collection index
- (o2) The i32 type that Rust infers for integer literals
- (o3) The isize type that keeps index minus one from underflowing
- (o4) The usize type that matches the pointer width of the target

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
