import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l7',
  slug: 'rust-smart-pointers',
  trackId: 'r',
  index: 7,
  title: 'Smart Pointers: Box, Rc & Arc',
  minutes: 31,
  hook: 'Choose heap placement or shared ownership deliberately: Box for one owner, Rc for one thread, Arc across threads.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `A pointer type is an ownership policy. **Box<T>** puts one owned T on the heap. **Rc<T>** permits multiple owners on one thread using a non-atomic reference count. **Arc<T>** provides the same shared-ownership shape with an atomic reference count so ownership may cross threads safely.

None of them automatically grants mutation. Shared ownership and mutation are separate decisions — R8 adds the synchronization or runtime checking needed for the latter.`,
    },
    {
      type: 'code',
      filename: 'pointers.rs',
      lang: 'rust',
      code: `use std::rc::Rc;
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
}).join().unwrap();`,
      chips: ['Box = one heap owner', 'Rc = shared/local', 'Arc = shared/thread-safe count'],
    },
    {
      type: 'prose',
      md: `## Clone the handle, not the payload

Calling **Rc::clone(&value)** or **Arc::clone(&value)** increments a count and makes the sharing visible. It does not deep-copy T. The final handle drops T. Reference counts cannot collect strong cycles, so use **Weak<T>** for non-owning back-edges.

Arc makes its count thread-safe, not its contents magically mutable or race-free. **Arc<Vec<T>>** is shared immutable data. For shared mutation, the common shape is **Arc<Mutex<T>>**.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Send and Sync still decide',
      md: `Rc cannot cross a thread boundary because its counter is non-atomic. Arc can cross only when the contained type satisfies the required thread-safety traits. The compiler rejects an Arc wrapped around thread-unsafe interior state rather than laundering it into safety.`,
    },
    {
      type: 'prose',
      md: `## Pick the smallest ownership mechanism

The [R7 Forge drill](/forge/rust-zero-r7) builds a boxed recursive list, observes Rc strong counts, creates a Weak back-reference, shares immutable data through Arc, and distinguishes handle cloning from payload cloning. This is the ownership vocabulary for KV manager lab 02 and executor lab 05.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'What does Arc::clone(&x) copy?',
          options: [
            'The inner value in full and each thread gets a private copy of the data',
            'A new handle to the same allocation and an atomic count goes up',
            'The inner value when T implements Clone and a handle otherwise',
            'A mutable handle to the shared value that lets the new owner write through it',
          ],
          correct: [1],
          explanation:
            'Arc cloning is shallow: it creates another handle to the same allocation and updates the reference count.',
          why: [
            'That is T::clone. Arc::clone never copies the payload; both handles point at the same allocation, which is the point of sharing.',
            'Right: Arc::clone creates another pointer to the same allocation and increments the atomic strong count. The payload is neither copied nor moved.',
            'Arc::clone does not depend on T: Clone, and it works for types that are not Clone. It always duplicates the handle only.',
            'Arc gives shared access only. Writing through it needs interior mutability such as Mutex, because a plain Arc<T> never hands out &mut T.',
          ],
        },
        {
          q: 'Why can Rc<T> not normally be sent to another thread?',
          options: [
            'Rc allocates in thread-local storage and other threads cannot address it',
            'Its strong and weak counts use non-atomic updates and clones may race',
            'Rc keeps its value on the stack of the creating thread and it would dangle',
            'Rc lacks the internal lock that Arc adds around T and access would race',
          ],
          correct: [1],
          explanation:
            'Concurrent count updates would race. Arc pays for atomic count operations and is the cross-thread counterpart.',
          why: [
            'Rc allocates on the ordinary heap, which every thread can address. It is blocked because its count is not thread-safe, not because of where it lives.',
            'Right: Rc updates its counts non-atomically, so Rc is not Send and rustc rejects thread::spawn with E0277. Arc makes the same updates atomically.',
            'Rc::new puts the value on the heap, not on a stack frame. Moving the handle to another thread would not dangle it; the count is the problem.',
            'Arc has no lock either; it differs from Rc only in using atomic counts. Mutation across threads needs a Mutex in both cases.',
          ],
        },
        {
          q: 'Which type expresses a non-owning edge that does not keep an Rc/Arc allocation alive?',
          options: [
            'A second Rc stored in a RefCell that hides it from the strong count',
            'Weak whose upgrade gives no handle once the last strong handle is dropped',
            'A Box holding a pointer to the data that observes it without owning it',
            'A cloned Rc kept in a struct field that the count ignores until it is used',
          ],
          correct: [1],
          explanation:
            'Weak handles can be upgraded while the allocation lives but do not contribute to the strong ownership count.',
          why: [
            'A RefCell changes nothing about counting. Any Rc inside it still adds one to the strong count and keeps the value alive, so cycles still leak.',
            'Right: Weak is a non-owning handle that adds to the weak count only. upgrade() returns Some while a strong owner exists and None after the last one drops.',
            'Box is an owning pointer and cannot borrow data owned by an Rc. It would need its own allocation or a move, not an observation.',
            'Every Rc clone increments the strong count when created, whether or not it is dereferenced. Only Weak avoids that.',
          ],
        },
      ],
    },
  ],
}

export default lesson
