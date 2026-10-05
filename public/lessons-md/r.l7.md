# R.L7 — Smart Pointers: Box, Rc & Arc

_Track R: Rust Zero · ~31 min · kernelspace_

> Choose heap placement or shared ownership deliberately: Box for one owner, Rc for one thread, Arc across threads.
A pointer type is an ownership policy. **Box<T>** puts one owned T on the heap. **Rc<T>** permits multiple owners on one thread using a non-atomic reference count. **Arc<T>** provides the same shared-ownership shape with an atomic reference count so ownership may cross threads safely.

None of them automatically grants mutation. Shared ownership and mutation are separate decisions — R8 adds the synchronization or runtime checking needed for the latter.

---

```rust
use std::rc::Rc;
use std::sync::Arc;

enum List {
    Node(u32, Box<List>),
    End,
}

let table = Rc::new(vec![3, 5, 8]);
let local_reader = Rc::clone(&table); // increments count, not Vec data

let config = Arc::new(String::from("decode"));
let worker_config = Arc::clone(&config);
std::thread::spawn(move || {
    assert_eq!(worker_config.as_str(), "decode");
}).join().unwrap();
```

---

## Clone the handle, not the payload

Calling **Rc::clone(&value)** or **Arc::clone(&value)** increments a count and makes the sharing visible. It does not deep-copy T. The final handle drops T. Reference counts cannot collect strong cycles, so use **Weak<T>** for non-owning back-edges.

Arc makes its count thread-safe, not its contents magically mutable or race-free. **Arc<Vec<T>>** is shared immutable data. For shared mutation, the common shape is **Arc<Mutex<T>>**.

---

> **[warning]** Rc cannot cross a thread boundary because its counter is non-atomic. Arc can cross only when the contained type satisfies the required thread-safety traits. The compiler rejects an Arc wrapped around thread-unsafe interior state rather than laundering it into safety.

---

## Pick the smallest ownership mechanism

The [R7 Forge drill](/forge/rust-zero-r7) builds a boxed recursive list, observes Rc strong counts, creates a Weak back-reference, shares immutable data through Arc, and distinguishes handle cloning from payload cloning. This is the ownership vocabulary for KV manager lab 02 and executor lab 05.

---

**Q1. What does Arc::clone(&x) copy?**

- (o1) The inner value when T implements Clone, and only a handle otherwise
- (o2) The inner value in full, so each thread gets its own private copy of the data
- (o3) A mutable handle to the shared value, so the new owner may write through it
- (o4) Only a new handle to the same allocation, bumping an atomic count

**Q2. Why can Rc<T> not normally be sent to another thread?**

- (o1) Rc allocates in thread-local storage, so other threads cannot address the value
- (o2) Rc keeps its value on the stack of the creating thread, where it would dangle elsewhere
- (o3) Its strong and weak counts use plain non-atomic updates, so concurrent clones may race
- (o4) Rc lacks the internal lock that Arc adds around T, so access from two threads would race on T

**Q3. Which type expresses a non-owning edge that does not keep an Rc/Arc allocation alive?**

- (o1) A second Rc stored in a RefCell, since interior mutability hides it from the strong count
- (o2) Weak, whose upgrade() method returns None once the last strong handle has been dropped
- (o3) A Box holding a pointer to the data, which observes it without counting as an owner
- (o4) A cloned Rc kept in a struct field, which the count ignores until it is dereferenced

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
