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
          options: [
            'It blocks the thread until the shared borrows end as a Mutex lock would',
            'It panics at runtime with an already borrowed error message',
            'It returns an Err value that the caller must handle and the program goes on',
            'It creates a data race between the aliasing references',
          ],
          correct: [1],
          explanation:
            'RefCell enforces the borrow law dynamically. try_borrow_mut returns an error when panic is not appropriate.',
          why: [
            'RefCell never blocks. It is single-threaded, and waiting for a borrow held by the same thread would never end. That is Mutex behaviour.',
            'Right: borrow_mut panics with an already borrowed error when a guard is live. try_borrow_mut is the variant that returns an Err instead.',
            'That is try_borrow_mut, not borrow_mut. The plain method has no error return, so a conflict panics and the caller never gets a value to handle.',
            'RefCell is not Sync and the conflict is caught first, so no aliasing write happens. A panic stops the program before any race could occur.',
          ],
          kcs: ['r.interior-mutability', 'r.borrow-rules'],
        },
        {
          q: 'What releases a std::sync::Mutex lock?',
          options: [
            'Calling unlock() on the Mutex when the critical section ends, as with a Java ReentrantLock',
            'Dropping the MutexGuard that lock() returned, at scope end or by an explicit drop(guard)',
            'The end of the statement that called lock(), whether or not the guard was bound to a name',
            'The scheduler when the holding thread calls sleep() in the critical section',
          ],
          correct: [1],
          explanation:
            'The guard owns the lock obligation. RAII releases it deterministically when the guard leaves scope.',
          why: [
            'std::sync::Mutex has no unlock method. The lock is released by dropping the guard, either at scope end or with an early drop(guard).',
            'Right: the guard owns the lock, and dropping it unlocks. That happens at scope end or on an explicit drop(guard), even during a panic.',
            'A guard bound with let lives until its scope ends. Only an unbound temporary, as in lock().unwrap().push(1), drops at the end of its statement.',
            'A sleeping or blocked thread keeps holding the lock, which is how deadlocks happen. Nothing releases it until the guard is dropped.',
          ],
          kcs: ['r.interior-mutability'],
        },
        {
          q: 'Which type lets a single-threaded counter of Copy values change through a shared reference, with no guard and no lock?',
          options: [
            'Cell<usize> that sets and gets the value by copy with no borrow tracking',
            'Rc<usize> that shares ownership and lets each owner update the counter',
            'RefCell<usize> that mutates through a shared reference and is the general choice',
            'Arc<Mutex<usize>> that is the standard way to share a mutable counter',
          ],
          correct: [0],
          explanation:
            'Cell provides simple get/set interior mutability for Copy values without borrow guards.',
          why: [
            'Right: Cell copies values in and out with get and set, so no reference into it exists. It needs no guard, borrow flag or lock.',
            'Rc shares ownership but only hands out shared access, so nobody can update the counter through it. Rc alone gives no mutation.',
            'RefCell works but hands out Ref and RefMut guards and keeps a runtime borrow flag that can panic. The question rules out guards.',
            'It works but pays for atomic counting and a lock a single thread never needs, and it hands out a guard. It is overkill here.',
          ],
          kcs: ['r.interior-mutability'],
        },
      ],
    },
  ],
  kcs: ['r.interior-mutability', 'r.borrow-rules'],
}

export default lesson
