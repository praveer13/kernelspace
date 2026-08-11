import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l4',
  slug: 'rust-borrowing-and-slices',
  trackId: 'r',
  index: 4,
  title: 'Borrowing, References & Slices',
  minutes: 34,
  hook: 'Lend a value without moving it: many readers or one writer, with slices as the universal zero-copy view.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `Moving into every function would be safe and exhausting. A reference lends access without transferring the cleanup obligation: **&T** reads, **&mut T** reads and writes.

The core rule is small enough to memorize: at one time, a value may have many shared references or one mutable reference — never both. References also cannot outlive the value they point to. Together those rules prevent iterator invalidation, dangling references, and data races.`,
    },
    {
      type: 'prose',
      md: `## Slices are borrowed windows

**&[T]** is a pointer plus a length into a contiguous sequence. It can view an array, a Vec, or a smaller range of either without allocation. **&str** is the UTF-8 string slice equivalent.

Prefer slice parameters over **&Vec<T>** and **&String**. The narrower type accepts more callers and promises less about the underlying owner.`,
    },
    {
      type: 'code',
      filename: 'borrows.rs',
      lang: 'rust',
      code: `fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().map(|&b| u64::from(b)).sum()
}

fn clamp_first(values: &mut [i32], ceiling: i32) {
    if let Some(first) = values.first_mut() {
        *first = (*first).min(ceiling);
    }
}

let mut values = vec![9, 4, 7];
let tail = &values[1..];       // shared window
let sum = checksum(tail);
// tail is no longer used, so its borrow ends here
clamp_first(&mut values, 5);`,
      chips: ['&[T] = pointer + length', 'borrows can end before scope end', 'mutation requires exclusivity'],
    },
    {
      type: 'callout',
      variant: 'segfault',
      title: 'The rejected program is the lesson',
      md: `Take a reference to a Vec element and then push into the Vec. Push may reallocate, making that reference dangle. Rust rejects the mutation while the reference is live. What looks like a picky rule is a concrete use-after-free prevented before the program exists.`,
    },
    {
      type: 'prose',
      md: `## Repair borrows, not symptoms

The [R4 Forge drill](/forge/rust-zero-r4) covers shared slice queries, mutable slice updates, non-overlapping **split_at_mut**, strings as **&str**, early borrow endings, and returning a subslice. Each function should operate without cloning or allocating unless its signature explicitly returns an owned value.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Which combination may exist at the same time for one value?',
          options: ['One &mut T and any number of &T', 'Many &T, or exactly one &mut T', 'Any number of &mut T', 'References are never allowed together'],
          correct: [1],
          explanation: 'Readers may share; a writer must be exclusive. The compiler uses this invariant to prevent mutation races and invalidation.',
        },
        {
          q: 'Why prefer &[T] to &Vec<T> in a read-only function parameter?',
          options: ['Slices are always heap allocated', 'A slice accepts more contiguous owners and exposes only the needed capability', 'Vec cannot be borrowed', 'Slices copy all elements'],
          correct: [1],
          explanation: 'Arrays, Vecs, and subslices can all coerce to &[T]. It is a zero-copy view with a smaller API contract.',
        },
        {
          q: 'Why can Vec::push conflict with a live element reference?',
          options: ['push is asynchronous', 'push may reallocate and invalidate the referenced address', 'References cannot point to integers', 'push consumes the Vec'],
          correct: [1],
          explanation: 'Growing a Vec may move its buffer. The borrow checker prevents keeping an address into the old buffer across that mutation.',
        },
      ],
    },
  ],
}

export default lesson
