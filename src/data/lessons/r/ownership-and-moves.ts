import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l3',
  slug: 'rust-ownership-and-moves',
  trackId: 'r',
  index: 3,
  title: 'Ownership, Moves, Clones & Drops',
  minutes: 36,
  hook: 'Every resource has one owner. Follow the obligation through moves and the borrow checker stops feeling supernatural.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `Python and Java decide at run time whether an object is still reachable. Rust decides at compile time whether a name may still touch a value, and it keeps those books with three permissions. At every line, each path (a variable such as \`s\`, or a place inside one such as \`s.0\`) holds some of them:

- **Read (R):** the path can be read: printed, compared, lent out as a view.
- **Write (W):** the path can be changed in place. A plain \`let\` does not grant it; \`let mut\` does.
- **Own (O):** the path may be moved or dropped. The binding that holds O owns the value, and with it the cleanup obligation: the resource is dropped exactly once, when its owner leaves scope.

A fresh \`let s = String::from(...)\` holds R and O. A \`let mut\` holds all three. Everything in this lesson, moves, clones and drops, is a statement about which of the three a line needs and which it takes away. The compiler rejects a line exactly when it needs a permission its path no longer holds.`,
    },
    {
      type: 'code',
      filename: 'needs_write.rs',
      lang: 'rust',
      code: `let log = String::from("req-17");
log.push_str(" ok");        // E0596: push_str needs W, and let grants only R and O`,
      permissions: { trace: 'needs-write' },
      chips: ['let holds R and O', 'mut adds W', 'a use needs permissions'],
    },
    {
      type: 'prose',
      md: `The diagram under the code is the model made visible. Each row is a line, each column a path, and a letter is shown only while the path holds it. A **+** marks a permission the line gives and a **−** one it takes away. When a use needs a letter the path does not hold, the row says what is missing, and that is the line the compiler rejects. Here \`push_str\` needs Write and \`log\` never had it.`,
    },
    {
      type: 'prose',
      md: `## A move gives away Read and Own

Assignment normally **moves** a heap-owning value such as a \`String\` or \`Vec\`. The new binding gains the permissions and the old binding loses every one it held. The old binding is dead from that line onward, so any later use needs a permission it no longer has.`,
    },
    {
      type: 'code',
      filename: 'move.rs',
      lang: 'rust',
      code: `let prompt = String::from("Explain paging");
let queued = prompt;               // a move: prompt hands its R and O to queued
println!("{prompt} {queued}");     // E0382: prompt holds nothing now`,
      permissions: { trace: 'use-after-move' },
      alt: {
        java: `String prompt = "Explain paging";
String queued = prompt;               // two names for one object
System.out.println(prompt + " " + queued);   // runs: the GC keeps it alive`,
        python: `prompt = "Explain paging"
queued = prompt                       # two names for one object
print(prompt, queued)                 # runs: reference counting keeps it alive`,
      },
      align: [
        {
          q: 'The familiar version above runs, because both names refer to one live object. In the Rust version, which line does the compiler reject, and why?',
          options: [
            'Line 2, because a String has one Own and the assignment would hand it to two bindings at once',
            'Line 3, because the move on line 2 left prompt with no permissions and printing needs Read',
            'Line 3, because queued holds no Write permission and printing has to write the text out',
            'Line 1, because String::from takes Own of the literal and nothing is left to assign to prompt',
          ],
          correct: [1],
          explanation:
            'The move on line 2 takes Read and Own from prompt and gives them to queued. Line 2 itself is fine; line 3 needs Read on prompt, which no longer exists.',
          why: [
            'Line 2 is accepted. A move needs Read and Own on its source, and prompt holds both there; the assignment is how the one Own changes hands.',
            'Right: the move on line 2 is legal because prompt held Read and Own then. It leaves prompt with nothing, so printing it on line 3 lacks Read.',
            'Printing reads and never writes, so queued does not need Write. The rejected path is prompt, which has lost Read, not queued.',
            'String::from builds a new owned String and needs nothing from the literal that Rust would reject. Line 1 compiles.',
          ],
          kcs: ['r.permissions'],
        },
      ],
      chips: ['a move loses R and O', 'the new owner gains them', 'use after move needs R'],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Moved does not mean erased',
      md: `A move usually copies only the small stack representation — pointer, length, capacity — then takes every permission from the source binding. The heap bytes stay where they are. Rust gets zero-copy transfer and prevents two owners from freeing the same allocation.`,
    },
    {
      type: 'prose',
      md: `## Copy duplicates bits; Clone is explicit work

Small scalar values such as integers implement **Copy**. Assignment duplicates their bits and the source keeps every permission it had, so there is nothing to lose. Heap-owning values move by default.

Calling **clone()** is different work. It needs only Read on the source, so the source keeps what it had, and it builds a second buffer with an owner of its own. You can see that in the diagram: the clone line changes nothing for \`tokens\`, and a new path appears holding R and O. On the last line both copies lose everything: a path holds nothing after its last use.`,
    },
    {
      type: 'code',
      filename: 'clone.rs',
      lang: 'rust',
      code: `let tokens = vec![12, 40, 7];
let snapshot = tokens.clone();     // reads tokens, builds a second buffer
let moved = tokens;                // tokens gives up R and O
println!("{snapshot:?} {moved:?}");`,
      permissions: { trace: 'clone-keeps-source' },
      chips: ['clone needs R only', 'new buffer, new owner', 'the cost is an allocation and a copy'],
    },
    {
      type: 'prose',
      md: `## When clone is the wrong fix

A clone silences E0382 by buying a second owner. That is right when two independent buffers are what you want: a snapshot to compare against, or a copy handed to another thread. It is wrong when the code only needed to **read**. The code below pays for a full copy of the vector on every call, to keep a name alive for a function that never needed to own anything.

Ask which permission the callee really needs. If it is only Read, lend it. A signature that takes a read-only view (R4) leaves the caller holding R, W and O, and copies nothing. Reach for clone when you need an owner, and never as punctuation to quiet the compiler.`,
    },
    {
      type: 'code',
      filename: 'wrong_fix.rs',
      lang: 'rust',
      code: `fn total(batch: Vec<u32>) -> u32 {
    batch.iter().sum()
}

let batch = vec![12, 40, 7];
let a = total(batch.clone());      // copies the buffer so total can own it
let b = total(batch.clone());      // copies it again, only to read it
// better: fn total(batch: &[u32]) -> u32, then total(&batch) twice, no copy`,
      alt: {
        java: `static int total(List<Integer> batch) {
    return batch.stream().mapToInt(Integer::intValue).sum();
}

List<Integer> batch = List.of(12, 40, 7);
int a = total(batch);              // passes a reference, nothing is copied
int b = total(batch);`,
        python: `def total(batch):
    return sum(batch)

batch = [12, 40, 7]
a = total(batch)                   # passes a reference, nothing is copied
b = total(batch)`,
      },
      align: [
        {
          q: 'The familiar version passes batch twice with no copy. Which Rust change gets the same behaviour, and what does it keep?',
          options: [
            'Clone before each call, because a clone moves nothing and the copy costs the program nothing',
            'Declare batch with let mut, because the Write it gains lets total take the vector twice',
            'Make total borrow the vector, so it needs the Read permission and batch keeps what it held',
            'Call drop(batch) after the first call, because the second call then gets a fresh vector',
          ],
          correct: [2],
          explanation:
            'total only reads, so it should ask for Read. Lending a view leaves batch with everything it had and copies no data; clone buys an owner the function never needed.',
          why: [
            'A clone does allocate and copy the whole buffer on every call, and that is the cost the familiar version never pays. Moving nothing does not make it free.',
            'Write is not the missing permission. A mut binding adds W, but a call that takes the Vec by value still needs O, which the first call took.',
            'Right: the familiar code shares one object because the callee only reads. In Rust that is a read-only view, which asks for R alone and leaves the owner untouched.',
            'Dropping batch destroys it, and drop gives no fresh vector back. After it the name holds no permissions, so the second call fails too.',
          ],
          kcs: ['r.clone-copy-drop'],
        },
      ],
      chips: ['clone buys an owner', 'read-only needs only R', 'borrowing comes in R4'],
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'Read the error as a missing permission',
      md: `E0382 (use of a moved value) says the path no longer holds Read, because a move took it. E0596 says the path never held Write. R4 adds E0499 and E0502, where a live loan removes permissions from the lender. Each has an entry in the [Error Museum](/errors) with its diagram and the clone that tempts you.`,
    },
    {
      type: 'prose',
      md: `## Drop follows Own

When a scope ends, Rust drops each value whose owner is leaving, exactly once, in reverse order of declaration. The binding that still holds O at that point runs the destructor. A value that was moved away is dropped by its new owner, which is why a move can never cause a double free. \`drop(x)\` is only a move into a function that ends the value early.`,
    },
    {
      type: 'prose',
      md: `## Learn by repairing move errors

The [R3 Forge drill](/forge/rust-zero-r3) makes ownership cross function boundaries, collections, and match arms. Six checks distinguish Copy from move, return an owned value, clone only when two independent buffers are required, consume a Vec, and use **mem::replace** to move a field safely. Before you edit, name the permission the failing line needs and the line that took it. Read every compiler diagnostic from the first error down; later errors are often consequences.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'After let b = a for a String, which permissions does a hold?',
          options: [
            'Read alone, because the String is still in memory and Rust lets a look at it right after the move',
            'None, because the move gave Read and Own to b and left a without either one of them',
            'Read and Own, because the assignment copied the String and both bindings keep them',
            'Read and Write, because a move takes only the Own permission and leaves a the rest',
          ],
          correct: [1],
          explanation:
            'A move takes every permission from the source. b becomes the sole path with Read and Own, and a later use of a fails with E0382.',
          why: [
            'The buffer being in memory is not what the compiler checks. It tracks permissions, and the move removed Read from a along with the rest.',
            'Right: the move leaves a with no permissions, and b holds Read and Own. A later use of a needs Read and fails with E0382.',
            'Assignment of a String does not duplicate it. Only a clone() builds a second buffer, and two paths holding Own would mean two drops.',
            'A move removes all of the source\'s permissions, not just Own. Write is gone too, and so is the right to read.',
          ],
          kcs: ['r.ownership-moves', 'r.permissions'],
        },
        {
          q: 'What does s.clone() need from s, and what does it give back?',
          options: [
            'It needs Own of s, and returns the same buffer under a new name, leaving s dead',
            'It needs Write on s, and returns a shared handle to the buffer, leaving s counted',
            'It needs Read on s, and returns a separate buffer with an owner, leaving s intact',
            'It needs nothing from s, and returns a bitwise copy of the pointer, leaving s alone',
          ],
          correct: [2],
          explanation:
            'clone() takes Read on the source and builds a second buffer with an owner of its own. The source is unchanged, and the cost is the allocation and the copy.',
          why: [
            'Needing Own would be a move, and the source would be dead. A clone leaves s usable, and its result is a separate buffer, not the same one.',
            'Sharing a buffer between owners is what Rc does, with a count. A String clone never shares, and it does not need Write on the source.',
            'Right: clone reads s and builds a separate buffer with its own Own. The source keeps its permissions, and the price is an allocation and a copy.',
            'Copying the pointer bits is what plain assignment would do, and it would leave two owners of one buffer. A clone builds new heap bytes instead.',
          ],
          kcs: ['r.clone-copy-drop', 'r.permissions'],
        },
        {
          q: 'A function total(batch: Vec<u32>) reads its argument and nothing else, and a second call fails with E0382. What is a better repair than total(batch.clone())?',
          options: [
            'Declare batch with let mut, so it gains the Write permission the second call needs',
            'Move batch into a second let binding first, so each call can take an Own',
            'Call drop(batch) after the first call, so the second call gets a fresh Vec',
            'Change total to borrow the vector, so it asks for Read and batch keeps what it had',
          ],
          correct: [3],
          explanation:
            'The callee needs Read, so a view fits and copies nothing. Write is not the missing permission, and a clone buys an owner the function never needed.',
          why: [
            'The second call fails because the first took Own, not because Write is missing. mut adds W and cannot restore a permission the move took.',
            'A value has one owner, so moving it into a second binding leaves the first empty. Two calls cannot each take the same Own.',
            'drop(batch) is itself a move that ends the value. Afterwards batch holds nothing, so the second call would fail again.',
            'Right: the function never needed to own anything. A read-only view asks for Read alone, so the caller keeps its permissions and nothing is copied.',
          ],
          kcs: ['r.clone-copy-drop', 'r.permissions'],
        },
        {
          q: 'At the end of a scope, which permission decides which binding runs Drop?',
          options: [
            'Read, because the binding that used the value last is the one that runs Drop at scope end',
            'Own, because the binding that still holds it runs Drop and a moved-from one runs nothing',
            'Write, because the binding that changed the value last is the one that runs Drop at scope end',
            'None, because Drop runs later, when a collector notices that nothing refers to the value',
          ],
          correct: [1],
          explanation:
            'Drop runs exactly once, at the end of the scope of the binding that still holds Own. A value moved elsewhere is dropped by its new owner.',
          why: [
            'Reading is not tied to cleanup. A reader holds no obligation, and the last reader leaving scope drops nothing.',
            'Right: Own carries the cleanup obligation. Exactly one binding holds it, so Drop runs once, and a moved-from binding runs nothing.',
            'Writing is not tied to cleanup. A value nobody ever modified is still dropped by its owner, and the last writer owes nothing.',
            'Rust has no collector. Drop runs at a fixed point, when the owning scope ends, with no background thread or delay.',
          ],
          kcs: ['r.clone-copy-drop'],
        },
      ],
    },
  ],
  kcs: ['r.ownership-moves', 'r.clone-copy-drop', 'r.permissions'],
}

export default lesson
