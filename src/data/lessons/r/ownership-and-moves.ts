import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l3',
  slug: 'rust-ownership-and-moves',
  trackId: 'r',
  index: 3,
  title: 'Ownership, Moves, Clones & Drops',
  minutes: 32,
  hook: 'Every resource has one owner. Follow the obligation through moves and the borrow checker stops feeling supernatural.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `Python and Java track object liveness at runtime. Rust makes a simpler promise at compile time: every resource has one owner, assignment normally transfers that ownership, and the resource is dropped exactly once when its owner leaves scope.

Think of ownership as a cleanup obligation, not as possession. A move hands that obligation to a new binding. The old binding is dead from that line onward.`,
    },
    {
      type: 'prose',
      md: `## Copy is cheap duplication; Clone is explicit work

Small scalar values such as integers implement **Copy**, so assignment duplicates their bits. Heap-owning values such as **String** and **Vec** move by default. Calling **clone()** performs an explicit deep copy when that is truly the desired semantics.

Do not use clone as borrow-checker punctuation. Ask who should own the value after the call. Often the correct repair is returning ownership, borrowing in R4, or moving the value into the longer-lived component.`,
    },
    {
      type: 'code',
      filename: 'moves.rs',
      lang: 'rust',
      code: `fn normalize(mut name: String) -> String {
    name.make_ascii_lowercase();
    name                         // move ownership back to caller
}

let original = String::from("Decode");
let snapshot = original.clone(); // explicit second buffer
let normalized = normalize(original);
// original is dead; normalized owns its buffer

drop(snapshot);                  // deterministic cleanup, usually implicit`,
      chips: ['one drop obligation', 'moves are usually zero-copy', 'clone is visible cost'],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Moved does not mean erased',
      md: `A move usually copies only the small stack representation — pointer, length, capacity — then forbids the source binding. The heap bytes stay where they are. Rust gets zero-copy transfer and prevents two owners from freeing the same allocation.`,
    },
    {
      type: 'prose',
      md: `## Learn by repairing move errors

The [R3 Forge drill](/forge/rust-zero-r3) makes ownership cross function boundaries, collections, and match arms. Six checks distinguish Copy from move, return an owned value, clone only when two independent buffers are required, consume a Vec, and use **mem::replace** to move a field safely. Read every compiler diagnostic from the first error down; later errors are often consequences.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'After let b = a for a String, what happened?',
          options: ['The heap buffer was deep-copied', 'b owns the buffer and a is no longer usable', 'a and b are garbage-collected aliases', 'The string was dropped immediately'],
          correct: [1],
          explanation: 'The pointer/length/capacity representation moves to b. Rust invalidates a so only one owner can eventually drop the buffer.',
        },
        {
          q: 'Why is clone() intentionally explicit?',
          options: ['It always uses unsafe code', 'It can represent real allocation and copying cost', 'It changes a value to mutable', 'It disables Drop'],
          correct: [1],
          explanation: 'Rust keeps potentially expensive duplication visible at the call site rather than hiding it behind assignment.',
        },
        {
          q: 'What does Drop provide?',
          options: ['Nondeterministic garbage collection', 'Deterministic resource cleanup at the end of ownership', 'Automatic deep copying', 'A way to skip the type checker'],
          correct: [1],
          explanation: 'When the owner leaves scope, Rust runs its destructor exactly once, covering memory and resources such as files or locks.',
        },
      ],
    },
  ],
}

export default lesson
