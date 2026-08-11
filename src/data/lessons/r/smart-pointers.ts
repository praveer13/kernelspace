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
          options: ['The entire inner value', 'Only a shared-ownership handle while incrementing the atomic count', 'The current thread', 'A mutable reference'],
          correct: [1],
          explanation: 'Arc cloning is shallow: it creates another handle to the same allocation and updates the reference count.',
        },
        {
          q: 'Why can Rc<T> not normally be sent to another thread?',
          options: ['T is always mutable', 'Its reference count is non-atomic', 'It always points to the stack', 'It has no Drop implementation'],
          correct: [1],
          explanation: 'Concurrent count updates would race. Arc pays for atomic count operations and is the cross-thread counterpart.',
        },
        {
          q: 'Which type expresses a non-owning edge that does not keep an Rc/Arc allocation alive?',
          options: ['Box', 'Weak', 'Vec', '&mut'],
          correct: [1],
          explanation: 'Weak handles can be upgraded while the allocation lives but do not contribute to the strong ownership count.',
        },
      ],
    },
  ],
}

export default lesson
