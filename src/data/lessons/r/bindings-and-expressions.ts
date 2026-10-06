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
      md: `## The two small shapes the drill also uses

R1 asks you to accumulate values from a slice and swap a tuple. A **for** loop visits each item; a **let pattern** names tuple members. These are ordinary bindings, not two new systems concepts:`,
    },
    {
      type: 'code',
      filename: 'iteration_and_pairs.rs',
      lang: 'rust',
      code: `let samples = [3, -1, 4];
let mut total = 0;
for sample in samples {
    total += sample;
}

let point = (12, 7);
let (x, y) = point;            // destructure the tuple
let transposed = (y, x);`,
      chips: ['for item in collection', 'mutable accumulator', 'tuple pattern'],
    },
    {
      type: 'prose',
      md: `## Make rustc prove the basics

The [R1 Forge drill](/forge/rust-zero-r1) contains six small functions: mutable accumulation, shadowing, explicit conversion, block expressions, conditional values, and tuple destructuring. Its page now lists each behavior contract. Inside the workspace, read **src/lib.rs** for the exact example inputs and outputs, but edit only **src/exercises.rs**.

The starter **todo!()** bodies deliberately compile and then panic, so the first test run only says “unfinished.” That is expected. Once you replace one body, rustc's type errors become specific feedback about that attempt. Work one function and one check at a time.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'What does let x = x + 1 do when x already exists?',
          options: [
            'It mutates the existing binding in place and needs x to be declared with mut',
            'It creates a new binding named x that shadows the old one and may change the type',
            'It allocates a fresh x on the heap and keeps the old value alive beside it',
            'It is a compile error that rejects a second binding of the same name in one scope',
          ],
          correct: [1],
          explanation:
            'Shadowing creates a fresh binding. It can change both the value and the type without making the original binding mutable.',
          why: [
            'Mutating in place is spelled x = x + 1 and needs let mut. A new let starts a separate binding instead and leaves the old one untouched.',
            'Right: let starts a new binding that hides the old one for the rest of the scope. It can change the type too, and the old binding never became mutable.',
            'Shadowing is lexical name lookup, not allocation. Both values are ordinary locals, and the old one is simply unreachable by name after the new let.',
            'Rust allows rebinding a name in the same scope; that is exactly shadowing. The error people remember, E0384, comes from assigning twice to a non-mut binding.',
          ],
          kcs: ['r.bindings-expressions', 'r.scalar-types'],
        },
        {
          q: 'Why does removing the final semicolon from a Rust block matter?',
          options: [
            'The block turns lazy and runs its statements when the result is first read',
            'The final expression becomes the value that the block produces',
            'The block returns early and ends the enclosing function with that value',
            'The last line is skipped at runtime and the block produces no value',
          ],
          correct: [1],
          explanation:
            'A trailing expression is returned by the block. A semicolon turns it into a statement whose value is discarded.',
          why: [
            'Blocks are evaluated eagerly where they appear. Laziness would need a closure; a missing semicolon only changes which value the block produces.',
            'Right: a trailing expression without a semicolon is the block\'s value. Adding the semicolon turns it into a statement and the block evaluates to ().',
            'That is return, which exits the function. A block\'s tail expression only gives the block a value, and the enclosing function keeps running after it.',
            'Every expression is evaluated either way. The semicolon only discards the result, so the line still runs and the block then has the unit value.',
          ],
          kcs: ['r.bindings-expressions'],
        },
        {
          q: 'Which integer type is normally used for collection indexes?',
          options: [
            'The i32 type that Rust infers for integer literals',
            'The u32 type that is wide enough for a collection index',
            'The usize type that matches the pointer width of the target',
            'The isize type that keeps index minus one from underflowing',
          ],
          correct: [2],
          explanation:
            'usize matches the platform pointer width and is the index type used by slices and collections.',
          why: [
            'Indexing with an i32 is rejected with E0277. Vec and slice indexes must be usize, and Rust never widens or converts integer types implicitly.',
            'u32 does not implement slice indexing either. Besides, a collection can exceed 2^32 elements on 64-bit targets, which is why the index type tracks pointer width.',
            'Right: usize is as wide as a pointer on the target, so it can index any object in memory. Slices and Vecs index only with usize or ranges of it.',
            'isize does not implement indexing, and a signed type does not prevent underflow bugs. It would only turn an underflow into a negative index that is still invalid.',
          ],
          kcs: ['r.scalar-types'],
        },
      ],
    },
  ],
  kcs: ['r.bindings-expressions', 'r.scalar-types'],
}

export default lesson
