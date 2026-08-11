import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l8',
  slug: 'rust-interior-mutability',
  trackId: 'r',
  index: 8,
  title: 'Interior Mutability: Cell, RefCell & Mutex',
  minutes: 34,
  hook: 'When mutation must live behind shared ownership, choose a tiny copy cell, runtime borrow checking, or a real lock.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `Sometimes an API needs shared outer access while a small implementation detail changes inside. Rust calls this **interior mutability**. It does not remove the many-readers-or-one-writer law; it moves enforcement to a mechanism suited to the context.

**Cell<T>** replaces small Copy values. **RefCell<T>** checks shared/exclusive borrows at runtime on one thread. **Mutex<T>** coordinates exclusive access across threads and returns a guard whose lifetime holds the lock.`,
    },
    {
      type: 'code',
      filename: 'interior.rs',
      lang: 'rust',
      code: `use std::cell::{Cell, RefCell};
use std::sync::Mutex;

let hits = Cell::new(0usize);
hits.set(hits.get() + 1);

let queue = RefCell::new(vec![1, 2]);
queue.borrow_mut().push(3); // guard ends at the semicolon

let shared = Mutex::new(vec!["prefill"]);
{
    let mut guard = shared.lock().unwrap();
    guard.push("decode");
} // guard drops; mutex unlocks`,
      chips: ['Cell copies values', 'RefCell panics on conflict', 'Mutex guard scopes the lock'],
    },
    {
      type: 'prose',
      md: `## “Already borrowed” is a runtime borrow-checker error

Holding **let read = cell.borrow()** and then calling **cell.borrow_mut()** violates the same aliasing rule that **&T** plus **&mut T** would violate. RefCell cannot prove the conflict statically, so it panics. Shorten guard lifetimes with inner scopes and do not call unknown code while a mutable guard is held.

For Mutex, keep critical sections small, never hold a synchronous guard across an await point, and decide how poisoned-lock errors should be handled rather than sprinkling unwrap blindly.`,
    },
    {
      type: 'callout',
      variant: 'segfault',
      title: 'Interior mutability is not an escape hatch',
      md: `RefCell trades compile-time rejection for a possible runtime panic; Mutex trades unrestricted access for blocking and possible contention. Reach for them when shared mutation is truly part of the model, not to silence an ownership design you have not understood.`,
    },
    {
      type: 'prose',
      md: `## Trigger the trap, then remove it

The [R8 Forge drill](/forge/rust-zero-r8) uses Cell for a counter, RefCell for a log, **try_borrow_mut** for non-panicking conflict detection, scoped guards to fix an already-borrowed failure, and Mutex-protected state. It is the direct ramp to the Arc/Mutex queue in executor lab 05.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'What happens when RefCell::borrow_mut conflicts with a live shared borrow?',
          options: ['It blocks until the borrow ends', 'It panics at runtime', 'It silently clones the value', 'It creates a data race'],
          correct: [1],
          explanation: 'RefCell enforces the borrow law dynamically. try_borrow_mut returns an error when panic is not appropriate.',
        },
        {
          q: 'What releases a std::sync::Mutex lock?',
          options: ['A manual unlock call is always required', 'Dropping the MutexGuard', 'Cloning the mutex', 'The next lock attempt'],
          correct: [1],
          explanation: 'The guard owns the lock obligation. RAII releases it deterministically when the guard leaves scope.',
        },
        {
          q: 'Which type best fits a single-threaded shared counter whose value is Copy?',
          options: ['Cell<usize>', 'Arc<usize>', 'Box<Mutex<usize>>', 'Weak<usize>'],
          correct: [0],
          explanation: 'Cell provides simple get/set interior mutability for Copy values without borrow guards.',
        },
      ],
    },
  ],
}

export default lesson
