import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l1',
  slug: 'rust-bindings-and-expressions',
  trackId: 'r',
  index: 1,
  title: 'Bindings, Types & Expressions',
  minutes: 24,
  hook: 'Rust looks familiar until a block returns a value. Learn the small syntax rules that make every later error readable.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `You already know variables, numbers, booleans, and functions. Rust changes the defaults: a binding is immutable, integer types have explicit widths, and most syntax that looks like control flow is also an expression.

The goal is not memorization. It is to make rustc's messages feel literal. When it says “cannot assign twice to immutable variable,” the fix is a deliberate **mut** or a new shadowing binding — not a workaround.`,
    },
    {
      type: 'prose',
      md: `## Bindings are immutable; shadowing is a new binding

**let x = 4** binds a name once. **let mut x = 4** grants mutation. **let x = x + 1** shadows the old x with a new value and may even change its type. That distinction matters: mutation changes a value through one binding; shadowing ends one binding and starts another.

Rust infers local types, but public boundaries and ambiguous conversions should be explicit. The scalar vocabulary is compact: signed and unsigned integers such as **i32** and **usize**, floating point **f32/f64**, **bool**, and Unicode scalar **char**. Arithmetic never silently mixes numeric types.`,
    },
    {
      type: 'code',
      filename: 'expressions.rs',
      lang: 'rust',
      code: `let requests = 8;             // inferred i32, immutable
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
};`,
      chips: ['immutable by default', 'semicolon discards a value', 'usize indexes memory'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      title: 'From Java or Python',
      md: `A Rust **let** is closer to a Java final local than a Python name, except shadowing lets you reuse the spelling during a transformation. A block's last expression behaves like a tiny Python lambda result: add a semicolon and you intentionally turn that result into the unit value **()**.`,
    },
    {
      type: 'prose',
      md: `## Make rustc prove the basics

The [R1 Forge drill](/forge/rust-zero-r1) contains six small functions: mutable accumulation, shadowing, explicit conversion, block expressions, conditional values, and tuple destructuring. Download it, replace every **todo!()**, then upload the Wasm artifact. Keep the compiler output open; it is part of the lesson.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'What does let x = x + 1 do when x already exists?',
          options: ['Mutates the original binding', 'Creates a new binding that shadows the old one', 'Allocates x on the heap', 'Fails in every case'],
          correct: [1],
          explanation: 'Shadowing creates a fresh binding. It can change both the value and the type without making the original binding mutable.',
        },
        {
          q: 'Why does removing the final semicolon from a Rust block matter?',
          options: ['It makes the block asynchronous', 'The final expression becomes the block value', 'It makes the value mutable', 'It disables type checking'],
          correct: [1],
          explanation: 'A trailing expression is returned by the block. A semicolon turns it into a statement whose value is discarded.',
        },
        {
          q: 'Which integer type is normally used for collection indexes?',
          options: ['i8', 'f64', 'usize', 'char'],
          correct: [2],
          explanation: 'usize matches the platform pointer width and is the index type used by slices and collections.',
        },
      ],
    },
  ],
}

export default lesson
