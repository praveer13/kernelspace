import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't3.l1',
  slug: 'ownership',
  trackId: 't3',
  index: 1,
  title: 'Ownership, Borrowing & Lifetimes',
  minutes: 30,
  hook: 'Live memory diagrams of the rules that make memory bugs unrepresentable — and the moment the borrow checker starts feeling like a colleague.',
  exercise: 'sim',
  simId: 'sim-allocator',
  blocks: [
    {
      // Retrieval, not teaching (wave-2.md §17.4): R3, R4 and R9 taught these rules, so the lesson opens by asking for
      // them. Each item tags the R KC it retrieves; the answers appear after the recap section below.
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: '`let b = a;` for an owning type (String, Vec) in Rust…',
          options: [
            'Copies the heap buffer into a second allocation that b owns independently of the original a',
            'Reference-counts the buffer and lets a and b both stay usable until the last one is dropped',
            'Moves ownership to b, with b taking over the drop and a statically unusable afterward',
            'Creates an immutable borrow of a that leaves a readable but forbids mutating it',
          ],
          correct: [2],
          why: [
            'The C++ copy-constructor habit. Rust copies implicitly only for Copy types; String and Vec are not Copy, so assignment moves, and a second allocation happens only if you call clone().',
            'The Java and Python reference model. Rust counts references only when you opt into Rc or Arc. Plain assignment keeps a single owner, so there is no count to keep a alive.',
            'Right: a move transfers the one obligation to drop. The compiler rejects any later use of a, so the buffer is freed exactly once, at a known point.',
            'A borrow needs the & operator, as in let b = &a, and a stays the owner. Plain assignment of an owning value moves it, and a cannot be read afterward.',
          ],
          revealAt: 'What R already settled',
          kcs: ['r.ownership-moves'],
        },
        {
          kind: 'choice',
          q: 'The borrow rule "many &T XOR one &mut T" directly prevents…',
          options: [
            'Memory leaks by freeing a borrowed value as soon as its last borrower finishes',
            'Iterator invalidation and data races by letting no one mutate while any readers exist',
            'Deadlocks by giving a value exclusive access that stops threads waiting on each other',
            'Out-of-bounds indexing panics by making a borrowed slice carry its own length',
          ],
          correct: [1],
          why: [
            'Leaks come from values never dropped, and safe Rust can still leak through mem::forget or Rc cycles. Borrowing frees nothing; the owner drops. The rules constrain aliasing, not whether a drop happens.',
            'Right: both bugs need a mutation overlapping another access to the same value. Many readers or one writer, checked statically, rules that out at no runtime cost.',
            'Deadlock is a lock-ordering problem, and two Mutex values taken in opposite order still hang in safe Rust. Exclusive borrows say nothing about threads waiting on each other.',
            'Slice indexing is bounds-checked at run time and panics when out of range. Borrow rules govern aliasing and lifetimes, not whether an index is valid.',
          ],
          revealAt: 'What R already settled',
          kcs: ['r.borrow-rules'],
        },
        {
          kind: 'choice',
          q: 'A function builds a String local to its body and returns `&s` pointing at it. The compiler rejects the function because…',
          options: [
            'References cannot be returned from a function at all, so every result that borrows has to become an owned value',
            'Returning &s makes a second mutable alias of the String, which breaks the rule of one writer at a time',
            'The String is dropped when the function returns, so the reference would outlive the value it points at',
            'The signature lacks a lifetime annotation, and writing <\'a> on it would keep the String alive for the caller',
          ],
          correct: [2],
          why: [
            'References are returnable: a function can hand back a slice of its argument. What is rejected is a reference to something that dies inside the call, and owning the value is the fix there.',
            'The reference here is shared, not mutable, and nothing else aliases the String. The problem is when the owner dies, not how many aliases exist.',
            'Right: a local owner is dropped at the closing brace, so a reference to it would dangle. The checker proves the owner outlives every borrow, and here it cannot.',
            'An annotation describes a relationship the code must already satisfy; it never extends how long a value lives. No lifetime can name a local, so the fix is to return the String itself.',
          ],
          revealAt: 'What R already settled',
          kcs: ['r.lifetimes'],
        },
        {
          kind: 'choice',
          q: 'A caller passes `v`, a Vec<u32>, to `fn total(v: Vec<u32>) -> u32` and then reads `v` again, so the compiler reports a use after move. The fix that copies nothing is…',
          options: [
            'Take a slice parameter and pass &v, so the function borrows a view and the caller keeps ownership of v',
            'Call total(v.clone()), so the function receives its own copy of the buffer and the caller keeps the original',
            'Mark the Vec as Copy, so the call duplicates the handle instead of moving it into the parameter',
            'Wrap the call in an unsafe block, so the compiler stops tracking v after the value has been moved',
          ],
          correct: [0],
          why: [
            'Right: a slice parameter borrows the elements for the call only. Nothing is copied, the caller still owns v afterward, and the function accepts arrays and slices as well.',
            'This compiles, but it allocates and copies the whole buffer to avoid a one-line signature change. The question asks for the fix that copies nothing, and clone is the habit to resist.',
            'Vec owns heap memory and has a destructor, so it cannot be Copy and the trait cannot be added. Only plain bit-copyable types are Copy.',
            'unsafe unlocks five extra operations and leaves the move checker on. A use after move is still an error inside the block.',
          ],
          revealAt: 'What R already settled',
          kcs: ['r.ownership-moves', 'r.borrow-rules'],
        },
      ],
    },
    {
      type: 'prose',
      md: `R3, R4 and R9 taught the three rules, and the four questions above asked for them from memory. This lesson does not teach them again. It asks what they cost when your data is not a tree.

Ownership gives every value exactly one owner, so owned data forms a tree: follow the owner links and you never loop back. A doubly-linked list, a graph, a cache with parent pointers or a map that several threads update is not a tree. Systems Rust has three tools for those shapes, and each one trades a compile-time guarantee for a cost you pay somewhere else. T3 starts by pricing them.`,
    },
    {
      type: 'prose',
      md: `## What R already settled

Three rules carry into everything below. Each has its own lesson if a question above missed.

- **Moves (R3):** one owner, one drop. Assigning an owning value moves it, and the old binding is statically dead.
- **Borrows (R4):** many \`&T\` or one \`&mut T\`, never both, for as long as a borrow lives. That is what rules out iterator invalidation and data races.
- **Lifetimes (R9):** an annotation is a contract between inputs and outputs, checked at every call. It never keeps data alive.

Together they prove that no reachable path can observe a dead value or a conflicting mutation. The proof is conservative, and it has a shape: **ownership edges form a tree.** That is the wall newcomers hit on lists with back-pointers, graphs and shared caches, and the three exits below are how systems code goes around it.`,
    },
    {
      type: 'prose',
      md: `## Graphs without leaks: the arena first

The first exit keeps single ownership and removes the pointers. One \`Vec\` owns every node, and a "link" is a \`usize\` index into it. Indices are not borrows, so there is nothing for the checker to fight, and a cycle is just two numbers that name each other. Your T1 allocator hands out offsets into a slab in the same way, and the layout is the one T0.L4 rewards: nodes sit densely in one array.`,
    },
    {
      type: 'code',
      filename: 'graph_arena.rs — one owner, links are numbers',
      lang: 'rust',
      code: `#[derive(Clone, Copy, PartialEq, Eq)]
struct NodeId(usize);                    // a handle, not a borrow

struct Node {
    label: String,
    edges: Vec<NodeId>,                  // links are numbers
}

#[derive(Default)]
struct Graph {
    nodes: Vec<Node>,                    // the single owner of every node
}

impl Graph {
    fn add(&mut self, label: &str) -> NodeId {
        self.nodes.push(Node { label: label.to_string(), edges: Vec::new() });
        NodeId(self.nodes.len() - 1)
    }
    fn link(&mut self, from: NodeId, to: NodeId) {
        self.nodes[from.0].edges.push(to);   // a cycle is two numbers
    }
}

let mut g = Graph::default();
let a = g.add("scheduler");
let b = g.add("block manager");
g.link(a, b);
g.link(b, a);        // a cycle: compiles, and cannot leak
// dropping g frees both nodes: one Vec, one owner, one drop`,
      chips: ['one Vec owns every node', 'links are indices', 'cycles cannot leak'],
    },
    {
      type: 'prose',
      md: `The arena's price is paid at run time and in discipline. An index is only a number, so if you remove a node and reuse its slot, an old \`NodeId\` quietly names the new occupant: a dangling pointer by another name, and the same shape as the ABA problem in T2.L5. The fix is a **generation counter** stored beside each slot and inside each handle, which crates such as \`slotmap\` package up. Until you need deletion, a plain \`Vec\` is enough.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — a strong cycle of Rc leaks; one Weak edge breaks it',
      height: 56,
      nodes: [
        { id: 'va', x: 2, y: 4, w: 24, h: 9, label: 'let a', sub: 'the only variable' },
        { id: 'na', x: 34, y: 4, w: 26, h: 11, label: 'Node A', sub: 'strong count 1' },
        { id: 'nb', x: 70, y: 22, w: 28, h: 11, label: 'Node B', sub: 'strong count 1' },
        { id: 'nc', x: 34, y: 42, w: 26, h: 11, label: 'Node C', sub: 'strong count 1' },
      ],
      edges: [
        { from: 'va', to: 'na' },
        { from: 'na', to: 'nb', label: 'Rc' },
        { from: 'nb', to: 'nc', label: 'Rc' },
        { from: 'nc', to: 'na', label: 'back-edge' },
      ],
      steps: [
        { caption: 'A chain built from Rc: the variable a owns A, A owns B, B owns C. Each strong count is 1, and dropping a would free A, then B, then C.', active: ['va', 'na', 'nb', 'nc'], edges: ['va->na', 'na->nb', 'nb->nc'] },
        { caption: 'Close the loop: C stores Rc::clone of A as its back-edge. A is now held by the variable and by C, so its strong count is 2.', active: ['nc', 'na'], edges: ['nc->na'] },
        { caption: 'The variable a goes out of scope, and A\'s count falls from 2 to 1, not 0. C still holds A, A holds B, B holds C, so every count stays above zero and nothing is ever freed. Safe Rust allows this: it is a leak, not a crash.', active: ['na', 'nb', 'nc'], edges: ['na->nb', 'nb->nc', 'nc->na'] },
        { caption: 'The fix is to make the back-edge a Weak (Rc::downgrade). A weak edge adds no strong count, so when a drops, A hits 0 and is freed, then B, then C. Following the weak edge later calls upgrade(), which returns None once its target is gone.', active: ['nc', 'na'], edges: ['nc->na'] },
      ],
    },
    {
      type: 'prose',
      md: `## Rc and RefCell: shared ownership, checked at run time

The second exit gives up single ownership. \`Rc<T>\` lets several owners share one value, freed when the last strong handle drops, and \`RefCell<T>\` lets you mutate through a shared handle by moving the borrow check from compile time to run time. Together they build the parent-and-child shape the arena avoids, with the tree's owning edges as \`Rc\` and the edges back up as \`Weak\`, exactly the fix in fig 1.`,
    },
    {
      type: 'code',
      filename: 'rc_tree.rs — owning edges down, Weak edges up',
      lang: 'rust',
      code: `use std::cell::RefCell;
use std::rc::{Rc, Weak};

struct Node {
    label: &'static str,
    children: RefCell<Vec<Rc<Node>>>,    // owning edges point down the tree
    parent: RefCell<Weak<Node>>,         // the edge back up must not own
}

let leaf = Rc::new(Node { label: "leaf", children: RefCell::new(vec![]), parent: RefCell::new(Weak::new()) });
let root = Rc::new(Node { label: "root", children: RefCell::new(vec![Rc::clone(&leaf)]), parent: RefCell::new(Weak::new()) });
*leaf.parent.borrow_mut() = Rc::downgrade(&root);   // weak: no strong count added

// Rc::strong_count(&root) == 1 and Rc::weak_count(&root) == 1
// drop(root) frees root; leaf.parent.borrow().upgrade() is now None`,
      chips: ['Rc = shared owner', 'RefCell = checked at run time', 'Weak breaks the cycle'],
    },
    {
      type: 'prose',
      md: `The price: every clone and drop of an \`Rc\` updates a plain integer count, and every \`borrow_mut()\` checks a flag. A conflicting borrow is no longer a compile error. It is a **panic** at the moment two borrows overlap, which means the bug moves from your build to your test suite, or to production. And \`Rc\` is neither \`Send\` nor \`Sync\`, so this shape cannot leave its thread (T3.L3).`,
    },
    {
      type: 'prose',
      md: `## Arc and Mutex: the same shape across threads

The third exit is the same idea made thread-safe: \`Arc<T>\` counts with atomic operations, and \`Mutex<T>\` makes a second locker wait instead of panicking. It is the \`Rc<RefCell<T>>\` of threaded code.`,
    },
    {
      type: 'code',
      filename: 'arc_graph.rs — one lock around the arena',
      lang: 'rust',
      code: `use std::sync::{Arc, Mutex};
use std::thread;

// One lock around the whole arena: simple, correct, serialises every access.
let g = Arc::new(Mutex::new(Graph::default()));
let handles: Vec<_> = (0..4).map(|i| {
    let g = Arc::clone(&g);                    // an atomic count bump per handle
    thread::spawn(move || {
        let mut graph = g.lock().unwrap();     // waits while another thread holds it
        graph.add(&format!("worker-{i}"));
    })                                         // the guard drops here: unlocked
}).collect();
for h in handles { h.join().unwrap(); }

// A Mutex per node allows parallel edits, and adds a rule you must keep:
// take node locks in one global order (say, by NodeId), or two threads that
// lock a then b, and b then a, can wait on each other forever.`,
      chips: ['Arc = atomic count', 'Mutex = waits for the lock', 'one global lock order'],
    },
    {
      type: 'prose',
      md: `Pairing an arena with one lock is the usual first design for threaded graphs: the cycle problem stays solved, and the only question left is how coarse the lock is.`,
    },
    {
      type: 'prose',
      md: `## What each one costs

| | Arena (\`Vec\` plus indices) | \`Rc<RefCell<T>>\` | \`Arc<Mutex<T>>\` |
|---|---|---|---|
| Threads | any, with one owner | one thread only | many threads |
| Handle clone and drop | a copy of an integer | a plain integer count | an atomic read-modify-write |
| Access check | bounds check on the index | borrow flag at run time | the lock, which waits |
| How it fails | a stale index names the wrong node | panic on overlapping borrows | deadlock from lock order, or a poisoned lock |
| Cycles | safe, no counts | leak unless an edge is \`Weak\` | leak unless an edge is \`Weak\` |

Read it as a ladder. Start with the arena: it has no counts and no hidden checks, and it keeps the data dense. Reach for \`Rc<RefCell<T>>\` only when ownership is genuinely dynamic on one thread, and for \`Arc<Mutex<T>>\` only when threads must share it. Each step down the ladder swaps a compile-time guarantee for a run-time check, so each step is a decision to write down, not a default.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `On the JVM a tracing collector frees whatever the program can no longer reach, and CPython adds a cycle collector to its reference counts, so cycles never bothered you there. Rust has no tracer behind \`Rc\`, so a strong cycle is invisible and permanent. The price you never saw is the one you now choose: counts, checks and locks written into the types.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Two traps catch most first designs. **A strong cycle in \`Rc\` or \`Arc\`** compiles, passes tests and leaks memory in a long-running service until something else fails; give every edge that points back up the tree a \`Weak\`. **A \`borrow_mut()\` held across a call that borrows again** compiles and then panics, so keep \`RefCell\` borrows to a single expression and never hold a guard while calling into code you do not control.`,
    },
    {
      type: 'prose',
      md: `## The simulator: replay the rules, then refactor

The exercise replays ownership scenarios on a live memory diagram. The first three tasks retrieve what R taught, so predict each verdict before you step. The last one is this lesson's: refactor a rejected graph to arena indices and see it compile.`,
    },
    {
      type: 'exercise',
      simId: 'sim-allocator',
      machine: 'rust-ownership',
      title: 'Ownership diagrams live',
      tasks: [
        'Step a move (`let b = a`) and verify: one owner, one drop; using `a` flags an error.',
        'Create two shared borrows, then attempt `push` on the owner — watch the rejection point.',
        'Return a reference to a stack local; locate the lifetime proof failure.',
        'Refactor the rejected graph case to arena indices; confirm it compiles and runs cache-friendlier.',
      ],
      note: `Everything rejected on screen was a T1 bug caught at build time: use-after-move (double-free's sibling), mutation-under-shared-borrow (iterator invalidation), escaping references (dangling). The arena refactor works because indices aren't borrows — ownership stays in one \`Vec\`, and "links" are just numbers.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The idiomatic systems-Rust answer to cyclic structures (graphs, linked lists) is…',
          options: [
            'Raw pointers between nodes inside an unsafe module that works around the borrow checker',
            'An arena with one owning Vec and usize indices standing in for pointers between graph nodes',
            'Box<Node> links in both directions that each own their target node',
            'Rc<RefCell<...>> around each link as the drop-in replacement for a pointer',
          ],
          correct: [1],
          explanation:
            'Arenas keep single ownership (the Vec) and replace pointers with indices: no borrow fights, O(1) access, dense layout (T0.L4). Rc<RefCell> is the fallback when ownership is genuinely dynamic.',
          why: [
            'Safe graphs are possible, because indices are not borrows. Raw pointers bring back dangling and aliasing bugs, so they belong only in small audited internals wrapped by a safe API.',
            'Right: ownership stays in the Vec and links are plain integers, so there are no borrows to fight. Access is O(1) and nodes are densely packed.',
            'A Box is a unique owner, so two nodes cannot both own the same target. Owned links can only form a tree, which is why back-links need a different technique.',
            'Rc<RefCell<T>> works but adds counts, runtime borrow checks that panic, and leaks on cycles. It is the fallback for genuinely dynamic ownership, not the first choice in systems code.',
          ],
          kcs: ['t3.cyclic-structures'],
          miss: ['t3.graph-needs-raw-pointers', '', 't3.box-links-form-a-graph', 't3.rc-refcell-is-the-default'],
        },
        {
          q: 'Two nodes each hold an Rc to the other, and the last variable pointing at either one goes out of scope. What happens to them?',
          options: [
            'Both nodes are freed in the order they were created, since dropping the last variable frees whatever it reaches',
            'The program panics at run time, because Rc detects the cycle as it drops and refuses to free either node',
            'Neither node is freed, because each keeps the other\'s strong count above zero and the leak is safe but lasting',
            'The compiler rejects the program, because two owners that point at each other can never be proved safe',
          ],
          correct: [2],
          explanation:
            'Rc frees a value when its own strong count reaches zero. In a strong cycle each count stays at one after the variables drop, so nothing is freed. Safe Rust allows the leak, and a Weak back-edge breaks it.',
          why: [
            'Rc has no reachability analysis. It frees a value only when that value\'s own strong count reaches zero, and a node held by its neighbour keeps its count above zero.',
            'Rc does not look for cycles, so nothing panics. A leak is not undefined behaviour or a detectable error, which is how one ships unnoticed and grows memory in a long-running service.',
            'Right: each node holds the other\'s count at one, so neither reaches zero and neither is dropped. The program stays memory-safe and leaks until exit, and a Weak back-edge fixes it.',
            'The borrow checker is satisfied, because Rc shares ownership by counting and cycles are legal. Leaking is allowed in safe Rust for the same reason mem::forget is safe.',
          ],
          kcs: ['t3.cyclic-structures'],
          miss: ['t3.rc-frees-reachable-nodes', 't3.rc-detects-cycles', '', 't3.compiler-rejects-cycles'],
        },
        {
          q: 'Moving a graph from Rc<RefCell<Node>> to Arc<Mutex<Node>> so worker threads can share it changes the price of sharing by…',
          options: [
            'Nothing but the names, as both pairs count handles and check access in the same way and differ only in what the compiler allows',
            'Making every handle clone and drop an atomic update, and making a conflicting access wait for the lock instead of panicking',
            'Moving the access check to compile time, because a Mutex proves exclusion statically and no run-time flag remains',
            'Making reference cycles safe, because atomic counts let Arc free a cycle once every thread has stopped using it',
          ],
          correct: [1],
          explanation:
            'Arc updates its count with an atomic read-modify-write on each clone and drop, and a Mutex makes a second locker wait where RefCell panics. That is the price of crossing threads, and cycles still leak.',
          why: [
            'The compiler accepts Arc across threads and rejects Rc, so the types differ for a reason. Atomic counts and a blocking lock are real run-time work that the single-threaded pair does not pay.',
            'Right: Arc updates its count with an atomic read-modify-write on each clone and drop, and a Mutex makes a second locker wait where RefCell panics. That is the price of crossing threads.',
            'A Mutex checks at run time too, by blocking until the lock is free. Only the compiler\'s Send and Sync checks are static, and they decide whether sharing is allowed, not whether it is contended.',
            'Atomic counts do not detect cycles. A strong Arc cycle leaks exactly like an Rc cycle, and a Weak back-edge is still the fix.',
          ],
          kcs: ['t3.shared-state-cost'],
          miss: ['t3.arc-mutex-is-a-rename', '', 't3.mutex-is-checked-at-compile-time', 't3.arc-frees-cycles'],
        },
        {
          q: 'An arena graph is shared by worker threads. Compared with one Mutex around the whole graph, giving every node its own Mutex…',
          options: [
            'Lets threads edit different nodes in parallel, so it adds a duty to lock in a fixed order or risk deadlock',
            'Lets threads edit in parallel with no new risk, because each lock guards a single value and cannot join a cycle',
            'Removes the need for Arc, because a lock held inside each node lets the nodes be shared without any count',
            'Trades safety for speed, because a lock per node lets two threads write the same node at the same moment',
          ],
          correct: [0],
          explanation:
            'Finer locks buy parallelism and cost design discipline: two threads that lock a then b, and b then a, deadlock. One global lock order, such as by NodeId, prevents it.',
          why: [
            'Right: independent locks let disjoint edits run together, but two threads that lock a then b and b then a can wait on each other forever. A single global order, such as by NodeId, prevents it.',
            'Fine-grained locks are where lock-order deadlock lives. Each lock is simple, but holding one while taking another forms a wait cycle between threads.',
            'A Mutex inside a node does not make the node shareable: threads still need a shared owner to reach it, so the nodes or the arena still sit behind an Arc.',
            'Each node\'s lock still gives exclusive access, so no two threads write one node at once. The cost of finer locks is design complexity and deadlock risk, not a data race.',
          ],
          kcs: ['t3.shared-state-cost'],
          miss: ['', 't3.per-node-locks-cannot-deadlock', 't3.per-node-mutex-replaces-arc', 't3.finer-locks-allow-data-races'],
        },
      ],
    },
  ],
  kcs: ['t3.cyclic-structures', 't3.shared-state-cost'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt:
          'Compare an arena, Rc with Weak, and Arc<Mutex<T>> for a graph, and say when each one is the right choice.',
        model:
          'An arena keeps one owner, a Vec, and links nodes by index: no counts and no borrow fights, so it is the first choice in systems code. Rc with Weak back-edges fits dynamic sharing on one thread, paid for with counts and run-time borrow checks. Arc<Mutex<T>> is the cross-thread version, paid for with atomics and a lock.',
        ideas: [
          'Arena: one Vec owns every node and links are indices, so there are no counts or borrow fights',
          'Rc with Weak back-edges handles dynamic sharing on one thread, paid for with counts and run-time checks',
          'Arc<Mutex<T>> is the cross-thread version, paid for with atomic counts and a lock',
        ],
        kcs: ['t3.cyclic-structures', 't3.shared-state-cost'],
      },
      {
        prompt:
          'Explain why a cycle of Rc values leaks without any unsafe code, and how a Weak edge fixes it.',
        model:
          'Rc frees a value when its strong count reaches zero. In a cycle each node holds the next one\'s count, so after the last variable drops every count is still one and nothing is freed. A Weak edge adds no strong count, so the owning edges form a tree, and upgrade returns None once the target is freed.',
        ideas: [
          'Rc frees a value only when its strong count reaches zero',
          'In a cycle every node holds another\'s count above zero, so nothing is freed and nothing panics',
          'A Weak edge adds no strong count, so the owning edges form a tree and upgrade() returns None after the free',
        ],
        kcs: ['t3.cyclic-structures'],
      },
    ],
  },
}

export default lesson
