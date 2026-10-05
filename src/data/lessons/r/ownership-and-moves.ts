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
          options: [
            'The heap buffer was deep-copied, so a and b are now independent owners',
            'b owns the buffer, and a is no longer usable after the move',
            'a and b both point at the buffer and the last one to leave scope frees it',
            'The buffer was freed at once and a now holds an empty String that is still usable',
          ],
          correct: [1],
          explanation:
            'The pointer/length/capacity representation moves to b. Rust invalidates a so only one owner can eventually drop the buffer.',
          why: [
            'Assignment never deep-copies a String. Copying the heap bytes takes an explicit clone(); a plain let b = a moves the existing buffer to b.',
            'Right: the pointer, length and capacity move to b, and later use of a fails with E0382. Only one owner remains to free the buffer.',
            'That describes shared ownership with reference counting, which needs Rc or Arc. Plain assignment keeps a single owner, and a becomes unusable.',
            'Rust does not leave a valid empty String behind, as C++ std::move may. The source binding is dead, so there is nothing left to read from a.',
          ],
        },
        {
          q: 'Why is clone() intentionally explicit?',
          options: [
            'Implicit duplication would run Drop twice on one buffer, so the call must be spelled out',
            'Duplicating a heap value can allocate and copy a lot of data, so the cost is visible at the call site',
            'clone() is built on unsafe pointer copies, so Rust makes each use deliberate and auditable',
            'The compiler cannot tell whether a type is safe to duplicate, so the programmer must vouch for it each time',
          ],
          correct: [1],
          explanation:
            'Rust keeps potentially expensive duplication visible at the call site rather than hiding it behind assignment.',
          why: [
            'Mixes up moves with clones. clone() builds a separate buffer, so each owner drops its own. A move, not a copy, is what prevents the double free.',
            'Right: a clone may allocate and copy arbitrary amounts of data. Rust leaves cheap bit copies to Copy types and makes every costly duplicate visible.',
            'Clone is an ordinary trait method, and implementations like String\'s are safe code. Unsafe is not what the explicit call signals.',
            'The type itself decides, by implementing Clone or Copy. The compiler knows which types allow duplication, so no programmer vouching is involved.',
          ],
        },
        {
          q: 'What does Drop provide?',
          options: [
            'Cleanup run by a background collector some time after the owner leaves scope, like a Java finalizer',
            'Deterministic cleanup of whatever the value owns, such as memory, a file or a lock, when its owner ends',
            'Cleanup that happens only when code calls drop() explicitly, like close() in C',
            'Cleanup of heap memory only, since files and locks still need a manual close call',
          ],
          correct: [1],
          explanation:
            'When the owner leaves scope, Rust runs its destructor exactly once, covering memory and resources such as files or locks.',
          why: [
            'Rust has no collector. Drop runs at a fixed point, when the owner leaves scope, and does not wait for any background thread or timer.',
            'Right: Drop runs at a predictable point, once, when ownership ends. It can release any resource the type owns, including files and mutex guards.',
            'Drop runs automatically at the end of scope. Calling drop(x) merely moves x into a function that ends its life early; it is not required.',
            'Drop is a general destructor. File handles and MutexGuard values release their resources in Drop, so no separate manual close is needed.',
          ],
        },
      ],
    },
  ],
}

export default lesson
