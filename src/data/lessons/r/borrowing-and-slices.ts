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
          options: [
            'One &mut T alongside any number of &T, because readers cannot see an in-progress write, so nothing races',
            'Many &T, or exactly one &mut T, but never a &mut T together with any other live reference',
            'Any number of &mut T, provided no two of them write the same element, since the compiler tracks each index',
            'At most one reference of either kind, since even two &T could see a half-written update',
          ],
          correct: [1],
          explanation:
            'Readers may share; a writer must be exclusive. The compiler uses this invariant to prevent mutation races and invalidation.',
          why: [
            'A live &T plus a &mut T is rejected with E0502. The reader could see the value change under it, or point at memory the writer reallocated.',
            'Right: shared references may coexist, but a &mut T must be the only live reference. Violations are E0499 for two &mut and E0502 for &mut with &T.',
            'Two live &mut T to the same value fail with E0499. The rule covers the whole value, not individual elements, which is why split_at_mut exists.',
            'Many &T are fine. Readers alone cannot change anything, so the compiler allows any number of them at once and limits only writers.',
          ],
        },
        {
          q: 'Why prefer &[T] to &Vec<T> in a read-only function parameter?',
          options: [
            'A &Vec<T> parameter forces the callee to allocate a new Vec, copy every element, then drop it, but a slice reuses the caller\'s buffer',
            'A slice accepts arrays, Vecs and subranges, and exposes only the access the callee needs',
            'A &Vec<T> moves the Vec into the callee for good, so the caller loses it, whereas a slice only borrows part of it',
            'Indexing and iteration need a slice type, so a &Vec<T> parameter cannot use either one',
          ],
          correct: [1],
          explanation:
            'Arrays, Vecs, and subslices can all coerce to &[T]. It is a zero-copy view with a smaller API contract.',
          why: [
            'Passing &Vec<T> allocates nothing either; it is just a pointer to the existing Vec. The difference is which callers the signature accepts.',
            'Right: arrays, Vecs and subranges all coerce to &[T], so one signature serves them all. It also promises less, since it cannot grow or reallocate the buffer.',
            'Both are borrows and neither moves anything. Moving would need a by-value Vec<T> parameter, which is a different signature altogether.',
            'A &Vec<T> indexes and iterates fine, because Vec implements Index and derefs to a slice. The reason to prefer slices is flexibility, not capability.',
          ],
        },
        {
          q: 'Why can Vec::push conflict with a live element reference?',
          options: [
            'push takes the Vec by value, so every earlier reference points at moved-from memory afterwards',
            'push can reallocate the buffer, leaving any held element reference pointing at freed heap memory',
            'Vec counts live element borrows at runtime, and push panics whenever that count is nonzero',
            'push shifts existing elements along by one slot, so the held reference would see a different value',
          ],
          correct: [1],
          explanation:
            'Growing a Vec may move its buffer. The borrow checker prevents keeping an address into the old buffer across that mutation.',
          why: [
            'push takes &mut self, not self, so the Vec is not moved. The conflict is that the &mut borrow overlaps a live shared reference to an element.',
            'Right: growth can allocate a new buffer and free the old one, so a held element reference would dangle. The borrow checker rejects it with E0502.',
            'That is RefCell\'s runtime check. Vec tracks no borrows; the conflict is found at compile time, before the program runs.',
            'push writes after the last element and moves nothing in place. Elements move only when the buffer reallocates, which is the real hazard.',
          ],
        },
      ],
    },
  ],
}

export default lesson
