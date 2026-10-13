# R.L8 — Interior Mutability: Cell, RefCell & Mutex

_Track R: Rust Zero · ~38 min · kernelspace_

> When mutation must live behind shared ownership, choose a tiny copy cell, runtime borrow checking, or a real lock.
## One rule, three permissions

Sometimes an API needs shared outer access while a small implementation detail changes inside. Rust calls this **interior mutability**. To see what it changes, start with what the compiler checks. At every line, each *path* (a place the program can name, such as `batch`, `table.blocks` or `*r`) holds some of three permissions:

| Permission | Letter | What a line may do with the path |
|---|---|---|
| Read | R | read the value, copy it, or borrow it with `&` |
| Write | W | assign to it or change it in place |
| Own | O | move it away, or drop it when its scope ends |

A plain `let` gives a path R and O. Writing `let mut` adds W. Borrowing takes permissions away for as long as the borrow lives: `&` leaves the source with R only, and `&mut` leaves it with nothing. That is the many-readers-or-one-writer law, written as bookkeeping. Every operation needs some of the three, and a line that needs a permission its path no longer holds is an error.

---

```rust
let mut batch = vec![8, 16, 32];
let first = &batch[0];
batch.push(64);
println!("{first}");
```

**Java**

```java
List<Integer> batch = new ArrayList<>(List.of(8, 16, 32));
Integer first = batch.get(0);
batch.add(64);
System.out.println(first);
```

**Python**

```python
batch = [8, 16, 32]
first = batch[0]
batch.append(64)
print(first)
```

**Align 1. The familiar version of this code compiles and prints 8. In the Rust version, which line does the compiler reject, and which permission is missing?**

- (o1) Line 3, where push needs W on batch but the borrow on line 2 left it with R
- (o2) Line 2, where borrowing &batch[0] needs O on batch, and a plain let never grants O
- (o3) Line 3, where push needs R on batch and the borrow took every permission away
- (o4) Line 4, where println needs W on first because it formats the value it prints

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._

---

## A write that needs only R

Look at the cost the rule puts on sharing. While `first` is alive, nobody can write to `batch`, however carefully they would do it. That is usually what you want. Sometimes it is not: a counter that every handler bumps, or a log that many callers append to, must be written through a *shared* reference, and a shared reference holds R only.

Interior mutability is a type whose methods take `&self` yet change what is inside. `Cell::set`, `RefCell::borrow_mut` and `Mutex::lock` each need only **R** on the path, so the compiler's bookkeeping passes. The write happens inside the type, which is allowed to do it because it guards the rule itself.

**Cell<T>** guards it the simplest way: no reference to the inside ever exists. `get` copies the value out and `set` moves a new one in, so there is nothing to alias.

---

```rust
use std::cell::Cell;

let hits = Cell::new(0usize);
let a = &hits;
let b = &hits;
a.set(a.get() + 1);
b.set(b.get() + 1);
println!("{}", hits.get());
```

---

In the diagram `hits` drops to R while `a` and `b` are alive and gets O back after their last use. Every use finds the R it needs, so no line is rejected: shared borrows never take R. A path also loses what it holds after its last use, which is why each row ends empty. The same counter held in a plain `usize` behind two `&` would not compile, because writing it needs W.

## RefCell is the same rule, checked later

**RefCell<T>** is for values that are not Copy, such as a `Vec`. You cannot copy them out, so it has to lend references to the inside. It keeps a count of live guards next to the value: `borrow()` returns a `Ref` guard and adds a reader; `borrow_mut()` returns a `RefMut` guard and needs the count at zero. The law is the one the compiler enforced above, with one difference. Both calls take `&self`, so to the compiler they are two shared borrows of the cell, and shared borrows never conflict. The check it would have made moves into the cell, to run time.

| Checked by | When it shows | A conflicting pair |
|---|---|---|
| The compiler, per path and line | before the program runs | E0502: `&` then a write |
| A guard counter inside RefCell | on that line, at run time | panic: BorrowMutError |
| A lock inside Mutex | on that line, across threads | the second thread waits |

Here is the same shape as the Vec above, with the Vec inside a RefCell.

---

```rust
use std::cell::RefCell;

let log = RefCell::new(vec!["prefill"]);
let seen = log.borrow();
log.borrow_mut().push("decode");
println!("{}", seen.len());
```

**Java**

```java
List<String> log = new ArrayList<>(List.of("prefill"));
for (String entry : log) {
    log.add("decode");
}
```

**Align 1. In Java the equivalent mistake, adding to a list while iterating it, throws ConcurrentModificationException when the loop runs. In this Rust version, what happens and when?**

- (o1) The compiler rejects line 5 with E0502, because seen still holds a shared borrow of log
- (o2) It compiles, then panics on line 5 with BorrowMutError since a Ref guard is still alive
- (o3) It compiles and runs, and the push on line 5 lands in the Vec while seen is still alive
- (o4) It compiles, then panics on line 4 because borrow() needs the cell to be empty first

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._

---

In the diagram no line is marked rejected. Every use of `log` finds the R it needs, and the compiler is satisfied. The rule is still being applied: the cell's counter is the permission check, carried out when the call happens instead of before the program starts.

| After line | Live guards | What the cell counts | What happens next |
|---|---|---|---|
| 4 | `seen` | 1 reader | `borrow_mut` needs 0 readers |
| 5 | none new | 1 reader | panic: BorrowMutError |

The panic is the Rust version of the Java exception, with the same cause: a reader and a writer on one value at once. The [Error Museum](/errors) keeps BorrowMutError beside the compile-time codes, with the wrong fix that tempts people and the right one.

## Make the guard shorter

A guard is a value, and its lifetime is the span of the borrow. A guard that is a temporary dies at the end of its statement, so the usual repair is to end the reader first. When a conflict is a legitimate possibility rather than a bug, `try_borrow_mut` asks without panicking.

---

```rust
use std::cell::RefCell;

let log = RefCell::new(vec!["prefill"]);
let count = log.borrow().len(); // the Ref guard is a temporary: gone at the semicolon
log.borrow_mut().push("decode");

if let Ok(mut entries) = log.try_borrow_mut() {
    entries.push("sample");
}
println!("{count} {}", log.borrow().len());
```

---

> **[segfault]** RefCell trades a compile-time rejection for a possible runtime panic; Mutex trades unrestricted access for blocking and possible contention. Reach for them when shared mutation is truly part of the model, not to silence an ownership design you have not understood.

---

## Mutex: the same rule across threads

**Mutex<T>** applies the rule between threads. `lock` also takes `&self`, so it too needs only R on the path. Instead of a counter it takes an operating-system lock, and instead of panicking it makes the second thread wait. The `MutexGuard` it returns holds the exclusive access, and dropping the guard (its O ending) releases the lock.

---

```rust
use std::sync::Mutex;

let shared = Mutex::new(vec!["prefill"]);
{
    let mut guard = shared.lock().unwrap();
    guard.push("decode");
} // guard drops; mutex unlocks
```

---

Keep critical sections small, never hold a synchronous guard across an await point, and decide how poisoned-lock errors should be handled rather than sprinkling unwrap blindly.

## Trigger the trap, then remove it

The [R8 Forge drill](/forge/rust-zero-r8) uses Cell for a counter, RefCell for a log, **try_borrow_mut** for non-panicking conflict detection, scoped guards to fix an already-borrowed failure, and Mutex-protected state. It is the direct ramp to the Arc/Mutex queue in executor lab 05. When a check fails, name the permission first: which path was used, which guard was still alive, and what the line needed.

---

**Q1. hits is declared with a plain let (no mut) as a Cell<usize>. Why does hits.set(1) compile?**

- (o1) set takes &self, so it needs only R on hits and the plain let already grants R
- (o2) set needs no permission at all because the compiler skips checks on std types
- (o3) set needs W on hits, and Cell quietly adds W to every binding that holds one
- (o4) set takes O on hits, which a plain let grants and the call hands back at the end

**Q2. A Ref guard from log.borrow() is still alive when log.borrow_mut() runs. Which statement is true?**

- (o1) borrow_mut returns an Err value and the program carries on without the write
- (o2) The cell counts one live reader at run time, so it panics with BorrowMutError
- (o3) borrow_mut waits until the guard is dropped, the way a Mutex lock would behave
- (o4) The compiler reports E0502 on that line, since the guard took W and O away from log

**Q3. What releases a std::sync::Mutex lock?**

- (o1) Dropping the MutexGuard that lock() returned, at scope end or by an explicit drop(guard)
- (o2) Calling unlock() on the Mutex when the critical section ends, as with a Java ReentrantLock
- (o3) The scheduler when the holding thread calls sleep() in the critical section
- (o4) The end of the statement that called lock(), whether or not the guard was bound to a name

**Q4. Which type lets a single-threaded counter of Copy values change through a shared reference, which holds R only, with no guard and no lock?**

- (o1) Cell<usize> that sets and gets the value by copy with no borrow tracking
- (o2) Rc<usize> that shares ownership and lets each owner update the counter
- (o3) RefCell<usize> that mutates through a shared reference and is the general choice
- (o4) Arc<Mutex<usize>> that is the standard way to share a mutable counter

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
