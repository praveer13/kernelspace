import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l8',
  slug: 'rust-interior-mutability',
  trackId: 'r',
  index: 8,
  title: 'Interior Mutability: Cell, RefCell & Mutex',
  minutes: 38,
  hook: 'When mutation must live behind shared ownership, choose a tiny copy cell, runtime borrow checking, or a real lock.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `## One rule, three permissions

Sometimes an API needs shared outer access while a small implementation detail changes inside. Rust calls this **interior mutability**. To see what it changes, start with what the compiler checks. At every line, each *path* (a place the program can name, such as \`batch\`, \`table.blocks\` or \`*r\`) holds some of three permissions:

| Permission | Letter | What a line may do with the path |
|---|---|---|
| Read | R | read the value, copy it, or borrow it with \`&\` |
| Write | W | assign to it or change it in place |
| Own | O | move it away, or drop it when its scope ends |

A plain \`let\` gives a path R and O. Writing \`let mut\` adds W. Borrowing takes permissions away for as long as the borrow lives: \`&\` leaves the source with R only, and \`&mut\` leaves it with nothing. That is the many-readers-or-one-writer law, written as bookkeeping. Every operation needs some of the three, and a line that needs a permission its path no longer holds is an error.`,
    },
    {
      type: 'code',
      filename: 'push_while_borrowed.rs',
      lang: 'rust',
      code: `let mut batch = vec![8, 16, 32];
let first = &batch[0];
batch.push(64);
println!("{first}");`,
      chips: ['line 2: the borrow takes W and O', 'line 3: push needs W', 'rejected: E0502'],
      permissions: { trace: 'push-while-borrowed' },
      alt: {
        java: `List<Integer> batch = new ArrayList<>(List.of(8, 16, 32));
Integer first = batch.get(0);
batch.add(64);
System.out.println(first);`,
        python: `batch = [8, 16, 32]
first = batch[0]
batch.append(64)
print(first)`,
      },
      align: [
        {
          q: 'In Java and Python the same four steps (take the first element, add 64 to the list, print the element) compile and print 8. In the Rust version, which line does the compiler reject, and which permission is missing?',
          options: [
            'Line 2, where borrowing &batch[0] needs W on batch, and the let mut has not granted it yet',
            'Line 3, where push needs R on batch, and the borrow on line 2 took R, W and O away',
            'Line 4, where println needs W on first, because it formats the value it prints',
            'Line 3, where push needs W on batch, but the borrow on line 2 left it with R',
          ],
          correct: [3],
          explanation:
            'While a shared reference is still going to be used, its source keeps R and loses W and O. push changes the Vec, so it needs W, and line 3 comes before the last use of first on line 4.',
          why: [
            'The borrow on line 2 needs R, and batch holds R, W and O there. A let mut grants W from the start, and a borrow does not use it.',
            'A shared borrow takes W and O and leaves batch with R, so a read would be fine. It is `&mut` that takes R away. The missing permission here is W, not R.',
            'Printing reads first, which needs R, and first holds it. Nothing on line 4 changes any value, so no W is involved.',
            'Right: the borrow on line 2 takes W and O from batch until first is last used on line 4, and push needs W. The compiler reports E0502 on line 3.',
          ],
          kcs: ['r.borrow-rules', 'r.interior-mutability'],
        },
      ],
    },
    {
      type: 'prose',
      md: `## A write that needs only R

Look at the cost the rule puts on sharing. While \`first\` is alive, nobody can write to \`batch\`, however carefully they would do it. That is usually what you want. Sometimes it is not: a counter that every handler bumps, or a log that many callers append to, must be written through a *shared* reference, and a shared reference holds R only.

Interior mutability is a type whose methods take \`&self\` yet change what is inside. \`Cell::set\`, \`RefCell::borrow_mut\` and \`Mutex::lock\` each need only **R** on the path, so the compiler's bookkeeping passes. The write happens inside the type, which is allowed to do it because it guards the rule itself.

**Cell<T>** guards it the simplest way: no reference to the inside ever exists. \`get\` copies the value out and \`set\` moves a new one in, so there is nothing to alias.`,
    },
    {
      type: 'code',
      filename: 'hits.rs',
      lang: 'rust',
      code: `use std::cell::Cell;

let hits = Cell::new(0usize);
let a = &hits;
let b = &hits;
a.set(a.get() + 1);
b.set(b.get() + 1);
println!("{}", hits.get());`,
      chips: ['two & borrows, both fine', 'set and get need R only', 'accepted'],
      permissions: { trace: 'cell-counter' },
    },
    {
      type: 'prose',
      md: `In the diagram \`hits\` drops to R while \`a\` and \`b\` are alive and gets O back after their last use. Every use finds the R it needs, so no line is rejected: shared borrows never take R. A path also loses what it holds after its last use, which is why each row ends empty. The same counter held in a plain \`usize\` behind two \`&\` would not compile, because writing it needs W.

## RefCell is the same rule, checked later

**RefCell<T>** is for values that are not Copy, such as a \`Vec\`. You cannot copy them out, so it has to lend references to the inside. It keeps a count of live guards next to the value: \`borrow()\` returns a \`Ref\` guard and adds a reader; \`borrow_mut()\` returns a \`RefMut\` guard and needs the count at zero. The law is the one the compiler enforced above, with one difference. Both calls take \`&self\`, so to the compiler they are two shared borrows of the cell, and shared borrows never conflict. The check it would have made moves into the cell, to run time.

| Checked by | When it shows | A conflicting pair |
|---|---|---|
| The compiler, per path and line | before the program runs | E0502: \`&\` then a write |
| A guard counter inside RefCell | on that line, at run time | panic: BorrowMutError |
| A lock inside Mutex | on that line, across threads | the second thread waits |

Here is the same shape as the Vec above, with the Vec inside a RefCell.`,
    },
    {
      type: 'code',
      filename: 'log_conflict.rs',
      lang: 'rust',
      code: `use std::cell::RefCell;

let log = RefCell::new(vec!["prefill"]);
let seen = log.borrow();
log.borrow_mut().push("decode");
println!("{}", seen.len());`,
      chips: ['both calls need R only', 'accepted by the compiler', 'panics on line 5: BorrowMutError'],
      permissions: { trace: 'refcell-conflict' },
      alt: {
        java: `List<String> log = new ArrayList<>(List.of("prefill"));
for (String entry : log) {
    log.add("decode");
}`,
      },
      align: [
        {
          q: 'In Java, adding to a list while iterating over it throws ConcurrentModificationException when the loop runs. In this Rust version, where a Ref guard is alive when borrow_mut asks for the Vec, what happens and when?',
          options: [
            'The compiler rejects line 5 with E0502, because seen still holds a Ref guard on the log cell',
            'It compiles and runs, and the push on line 5 lands in the Vec while `seen` is still alive now',
            'It compiles, then panics on line 5 with BorrowMutError because a Ref guard is still alive',
            'It compiles, then panics on line 4 because borrow() needs the cell to be empty first',
          ],
          correct: [2],
          explanation:
            'borrow and borrow_mut both take &self, so the compiler needs R and accepts the program. RefCell counts its live guards instead: seen is still alive on line 5, so borrow_mut finds a reader and panics.',
          why: [
            'To the compiler, borrow and borrow_mut are two shared borrows of log, which never conflict, and both need R. The exclusive-access check happens when the program runs.',
            'The conflict is caught: RefCell refuses to hand out a writer while a reader guard is alive. If it did not, the push could reallocate the Vec under seen.',
            'Right: the compiler sees nothing wrong, and at run time the cell counts one live reader when borrow_mut asks for exclusive access. It panics with BorrowMutError on line 5.',
            'borrow() succeeds whenever no writer is live, and on line 4 there is none. The refusal comes later, from borrow_mut.',
          ],
          kcs: ['r.interior-mutability', 'r.borrow-rules'],
        },
      ],
    },
    {
      type: 'prose',
      md: `In the diagram no line is marked rejected. Every use of \`log\` finds the R it needs, and the compiler is satisfied. The rule is still being applied: the cell's counter is the permission check, carried out when the call happens instead of before the program starts.

| After line | Live guards | What the cell counts | What happens next |
|---|---|---|---|
| 4 | \`seen\` | 1 reader | \`borrow_mut\` needs 0 readers |
| 5 | none new | 1 reader | panic: BorrowMutError |

The panic is the Rust version of the Java exception, with the same cause: a reader and a writer on one value at once. The [Error Museum](/errors#BorrowMutError) keeps BorrowMutError beside the compile-time codes, with the wrong fix that tempts people and the right one.

## Make the guard shorter

A guard is a value, and its lifetime is the span of the borrow. A guard that is a temporary dies at the end of its statement, so the usual repair is to end the reader first. When a conflict is a legitimate possibility rather than a bug, \`try_borrow_mut\` asks without panicking.`,
    },
    {
      type: 'code',
      filename: 'log_fixed.rs',
      lang: 'rust',
      code: `use std::cell::RefCell;

let log = RefCell::new(vec!["prefill"]);
let count = log.borrow().len(); // the Ref guard is a temporary: gone at the semicolon
log.borrow_mut().push("decode");

if let Ok(mut entries) = log.try_borrow_mut() {
    entries.push("sample");
}
println!("{count} {}", log.borrow().len());`,
      chips: ['end the reader before the writer', 'try_borrow_mut returns Err, not a panic', 'prints 1 3'],
    },
    {
      type: 'callout',
      variant: 'segfault',
      title: 'Interior mutability is not an escape hatch',
      md: `RefCell trades a compile-time rejection for a possible runtime panic; Mutex trades unrestricted access for blocking and possible contention. Reach for them when shared mutation is truly part of the model, not to silence an ownership design you have not understood.`,
    },
    {
      type: 'prose',
      md: `## Mutex: the same rule across threads

**Mutex<T>** applies the rule between threads. \`lock\` also takes \`&self\`, so it too needs only R on the path. Instead of a counter it takes an operating-system lock, and instead of panicking it makes the second thread wait. The \`MutexGuard\` it returns holds the exclusive access, and dropping the guard (its O ending) releases the lock.`,
    },
    {
      type: 'code',
      filename: 'shared.rs',
      lang: 'rust',
      code: `use std::sync::Mutex;

let shared = Mutex::new(vec!["prefill"]);
{
    let mut guard = shared.lock().unwrap();
    guard.push("decode");
} // guard drops; mutex unlocks`,
      chips: ['lock needs R only', 'the guard holds the lock', 'drop releases it'],
    },
    {
      type: 'prose',
      md: `Keep critical sections small, never hold a synchronous guard across an await point, and decide how poisoned-lock errors should be handled rather than sprinkling unwrap blindly.

## Trigger the trap, then remove it

The [R8 Forge drill](/forge/rust-zero-r8) uses Cell for a counter, RefCell for a log, **try_borrow_mut** for non-panicking conflict detection, scoped guards to fix an already-borrowed failure, and Mutex-protected state. It is the direct ramp to the Arc/Mutex queue in executor lab 05. When a check fails, name the permission first: which path was used, which guard was still alive, and what the line needed.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'hits is declared with a plain let (no mut) as a Cell<usize>. Why does hits.set(1) compile?',
          options: [
            'set takes &self, so it needs only R on hits and the plain let already grants R',
            'set needs W on hits, and Cell quietly adds W to every binding that holds one',
            'set takes O on hits, which a plain let grants and the call hands back at the end',
            'set needs no permission at all because the compiler skips checks on std types',
          ],
          correct: [0],
          explanation:
            'The write happens inside Cell, behind a method that takes &self. The compiler checks only that the caller can read the path, and R is all a shared reference ever holds.',
          why: [
            'Right: Cell::set takes &self, so the call needs R, which hits holds. The change happens inside the type, which makes sure no reference to the inside exists.',
            'Cell does not alter permissions on a binding. If set needed W, the let would have to be mut, as it does for a plain usize, and this one does not.',
            'set does not move or drop the Cell, so it needs no O. It writes a new value into the Cell and drops the old one.',
            'The compiler checks std types like any others. It accepts this call because &self is satisfied by R, not because anything is skipped.',
          ],
          kcs: ['r.interior-mutability', 'r.borrow-rules'],
        },
        {
          q: 'A Ref guard from log.borrow() is still alive when log.borrow_mut() runs. Which statement is true?',
          options: [
            'The compiler reports E0502 on that line, since the guard took W and O away from log',
            'The cell counts one live reader at run time, so it panics with BorrowMutError',
            'borrow_mut waits until the guard is dropped, the way a Mutex lock would behave',
            'borrow_mut returns an Err value and the program carries on without the write',
          ],
          correct: [1],
          explanation:
            'Both calls need only R, so the compiler accepts them. RefCell checks the one-writer-or-many-readers law with a counter, and a writer asked for while a reader is live is a panic.',
          why: [
            'A Ref guard keeps only a shared borrow of log alive, and borrow_mut takes &self too. Two shared borrows do not conflict, so nothing is taken from log at compile time.',
            'Right: the same law that would be E0502 for a plain &, enforced one step later. borrow_mut finds the reader count above zero and panics with BorrowMutError.',
            'RefCell never waits. It is single-threaded, so waiting for a guard on the same thread could never end. Blocking is what a Mutex does.',
            'That is try_borrow_mut. The plain borrow_mut has no error return, so a conflict panics and the caller never gets a value to handle.',
          ],
          kcs: ['r.interior-mutability', 'r.borrow-rules'],
        },
        {
          q: 'A thread holds the MutexGuard from shared.lock().unwrap(). What ends its exclusive access, so that the next thread\'s lock() can return?',
          options: [
            'Calling unlock() on the Mutex, which hands the O of the data back, as with a Java ReentrantLock',
            'Dropping the guard, at scope end or with drop(guard), which ends the O that held the lock',
            'The end of the statement that called lock(), even when the guard was bound to a name',
            'The scheduler, when the holding thread calls sleep() inside the critical section',
          ],
          correct: [1],
          explanation:
            'The guard owns the lock obligation. When the guard is dropped, its O ends and the lock is released deterministically, so the next thread\'s lock() returns.',
          why: [
            'std::sync::Mutex has no unlock method, and nothing hands O back by hand. The lock is released by dropping the guard, at scope end or with an early drop(guard).',
            'Right: the guard holds the exclusive access, and its O ending is the release. That happens at scope end or on an explicit drop(guard), even during a panic.',
            'A guard bound with let lives until its scope ends. Only an unbound temporary, as in lock().unwrap().push(1), drops at the end of its statement.',
            'A sleeping or blocked thread keeps holding the lock, which is how deadlocks happen. Nothing releases it until the guard is dropped.',
          ],
          kcs: ['r.interior-mutability', 'r.permissions'],
        },
        {
          q: 'Code holds R on a single-threaded counter of Copy values, through a shared reference, and must change it with no guard and no lock. Which type makes that compile?',
          options: [
            'Cell<usize>, whose set and get need R and copy the value in and out',
            'Rc<usize>, which shares ownership and lets each owner update the counter',
            'RefCell<usize>, which mutates through a shared reference and is the general choice',
            'Arc<Mutex<usize>>, which is the standard way to share a mutable counter',
          ],
          correct: [0],
          explanation:
            'Cell takes &self, so its set and get need only R. No reference into it ever exists, so the write needs no guard and no aliasing check.',
          why: [
            'Right: Cell copies values in and out with get and set, so no reference into it exists and R is all a call needs. It needs no guard, borrow flag or lock.',
            'Rc shares ownership but hands out only shared access while it is shared: get_mut returns None once a second Rc exists, and make_mut would clone the counter instead of updating it. A shared counter needs Cell or RefCell inside the Rc.',
            'RefCell works with R alone but hands out Ref and RefMut guards and keeps a run-time borrow flag that can panic. The question rules out guards.',
            'It works but pays for atomic counting and a lock a single thread never needs, and it hands out a guard. It is overkill here.',
          ],
          kcs: ['r.interior-mutability', 'r.permissions'],
        },
      ],
    },
  ],
  kcs: ['r.interior-mutability', 'r.borrow-rules'],
}

export default lesson
