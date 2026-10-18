import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l4',
  slug: 'rust-borrowing-and-slices',
  trackId: 'r',
  index: 4,
  title: 'Borrowing, References & Slices',
  minutes: 40,
  hook: 'Lend a value without moving it: many readers or one writer, with slices as the universal zero-copy view.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `## Borrowing lends permissions

Moving into every function would be safe and exhausting. A reference lends access without transferring the cleanup obligation. To see exactly what a loan costs, track three permissions on every path the program can name: a variable **v**, a field **s.0**, or the target a reference points at.

- **R** (read): you can read the path.
- **W** (write): you can assign to it or mutate through it. Only a **let mut** binding starts with W.
- **O** (own): you can move it or drop it.

A **let mut v** binding holds **R, W and O**. A borrow lends some of them out and takes them from the lender until the reference's *last use*, not until the end of the scope:

- **&v** takes **W and O** from v. The lender keeps R, so any number of readers can share it.
- **&mut v** takes **R, W and O** from v. The borrower is the only way in.

Through **&T** the borrower can read the target. Through **&mut T** it can read and write it. That is the whole rule: many shared references or one mutable reference, never both, because a second **&mut** needs the W and R the first one took, while a second **&** needs only the R that **&** leaves in place.`,
    },
    {
      type: 'code',
      filename: 'permissions.rs',
      lang: 'rust',
      code: `let mut scores = vec![9, 4, 7];
let first = &scores[0];
println!("{first}");
scores.push(5);
let all = &mut scores;
all.push(6);
println!("{}", scores.len());`,
      chips: ['& takes W and O', '&mut takes R, W and O', 'a loan ends at its last use'],
      permissions: { trace: 'shared-then-exclusive' },
    },
    {
      type: 'prose',
      md: `Read the table down the lines. **first** is the shared loan: while it lives, **scores** holds only R. Its last use is the **println!** on line 3, which is where **scores** gets W and O back, so the **push** on line 4 is allowed. **all** is the exclusive loan: **scores** holds nothing until **all**'s last use on line 6, and then everything returns. Line 7 reads **scores** through **scores.len()**, which needs only R, and **scores** holds all three there. That is also its last use, so the row ends with **scores** holding nothing: a path loses what it holds after its last use, even a path that nothing borrows.

References also cannot outlive the value they point to. Together these rules prevent iterator invalidation, dangling references, and data races.`,
    },
    {
      type: 'callout',
      variant: 'segfault',
      title: 'The rejected program is the lesson',
      md: `Take a reference to a Vec element and then push into the Vec. Push needs W, the shared reference took it, and push may reallocate, which would leave that reference dangling. Rust rejects the mutation while the reference is live. What looks like a picky rule is a concrete use-after-free prevented before the program exists.`,
    },
    {
      type: 'code',
      filename: 'invalidation.rs',
      lang: 'rust',
      code: `let mut scores = vec![9, 4, 7];
for s in &scores {
    scores.push(*s);
}`,
      chips: ['the loop holds a shared loan', 'push needs W', 'E0502'],
      permissions: { trace: 'loop-invalidation' },
      alt: {
        java: `List<Integer> scores = new ArrayList<>(List.of(9, 4, 7));
for (int s : scores) {
    scores.add(s);   // compiles; throws ConcurrentModificationException at run time
}`,
        python: `scores = [9, 4, 7]
for s in scores:
    scores.append(s)   # runs; the loop never ends, because the list keeps growing`,
      },
      align: [
        {
          q: 'In Java, adding to a list inside a for-each loop over it throws ConcurrentModificationException at run time, and in Python the loop never stops because the list keeps growing. The Rust loop is rejected at compile time. Which line does the compiler reject, and which permission is missing there?',
          options: [
            'Line 2, for s in &scores: scores has no O left to lend, so the loop cannot borrow it',
            'Line 3, scores.push(*s): *s lacks R, because the loop variable stops borrowing after one pass',
            'Line 1, let mut scores: a Vec that can never hold W from the start if it is iterated later',
            'Line 3, scores.push(*s): scores has only R while the loop borrows it, so push lacks W',
          ],
          correct: [3],
          explanation:
            'The for loop holds a shared loan on scores for every iteration. A shared loan takes W and O, so the push on line 3 asks for W that scores does not have.',
          why: [
            'A shared borrow asks the lender for R, and scores holds R, W and O on line 2, so the borrow itself succeeds. W and O are taken from scores afterwards, which is what line 3 runs into.',
            '*s is read through the loop\'s shared reference, which is live for the whole loop, so it holds R on every pass. The permission that is missing is on scores, not on *s.',
            'let mut gives scores R, W and O at its declaration, and later uses do not take that back. Line 1 is accepted; the conflict starts when line 2 lends scores out.',
            'Right: the loop\'s shared borrow lives to the end of the loop, so scores holds R on line 3. push takes &mut self and needs W, which is exactly the permission missing. Java and Python let you write it and fail, or hang, later.',
          ],
          kcs: ['r.borrow-rules'],
        },
      ],
    },
    {
      type: 'prose',
      md: `## Slices are borrowed windows

**&[T]** is a pointer plus a length into a contiguous sequence. It can view an array, a Vec, or a smaller range of either without allocation. **&str** is the UTF-8 string slice equivalent.

A slice borrows like any other reference: **&values[1..]** takes W and O from all of **values**, not only from the elements in the window, because **values** is one path. Writes to the Vec wait for the window's last use.

Prefer slice parameters over **&Vec<T>** and **&String**. The narrower type accepts more callers and promises less about the underlying owner.`,
    },
    {
      type: 'code',
      filename: 'borrows.rs',
      lang: 'rust',
      code: `fn checksum(values: &[i32]) -> i64 {
    values.iter().map(|&v| i64::from(v)).sum()
}

fn clamp_first(values: &mut [i32], ceiling: i32) {
    if let Some(first) = values.first_mut() {
        *first = (*first).min(ceiling);
    }
}

let mut values = vec![9, 4, 7];
let tail = &values[1..];       // shared window
let sum = checksum(tail);
// tail is no longer used, so its borrow ends here
clamp_first(&mut values, 5);
println!("{sum} {values:?}");`,
      chips: ['&[T] = pointer + length', 'borrows can end before scope end', 'mutation requires exclusivity'],
    },
    {
      type: 'prose',
      md: `## What the borrow checker cannot see

The checker reasons about paths and loans, not about your proof that two indexes differ or that a branch is dead. So it rejects two kinds of program, and this section is about telling them apart.

- **Rejected because it would dangle.** The push in the loop above may free the buffer a live reference points into. Nothing about it is conservative; the rejection is the bug report.
- **Rejected although it is safe.** No live path can reach memory that moved, was freed or changed under it, but the checker cannot see why. The tools are scoping, splitting and restructuring, and only rarely **unsafe** with a proof you write down.

Three programs come up again and again.

**1. Disjoint elements.** An index is a run-time value, so the checker tracks **v[0]** and **v[1]** as one path, **v**. The first **&mut v[0]** takes R, W and O from it, so the second finds nothing left to ask for. It is rejected with E0499 although the elements differ:`,
    },
    {
      type: 'code',
      filename: 'disjoint.rs',
      lang: 'rust',
      code: `let mut v = vec![1, 2, 3];
let a = &mut v[0];
let b = &mut v[1];
*a += 1;
*b += 1;`,
      chips: ['one path: v', 'safe, and rejected', 'E0499'],
      permissions: { trace: 'disjoint-elements' },
    },
    {
      type: 'prose',
      md: `**v.split_at_mut(1)** returns two disjoint windows, so each borrow covers only its own half. Its disjointness proof is a few lines of **unsafe** inside the standard library, written and audited once; that is what an unsafe boundary is in T3.

**2. Two-phase borrows.** **v.push(v.len())** looks like it needs **&mut v** first and a read of **v** second, which the simple rule rejects. It compiles: the **&mut v** is *reserved* while the arguments are evaluated and activated only when **push** runs, so **v** keeps R until then. Take the reference yourself with **let r = &mut v** and the reservation is gone: **r.push(v.len())** is E0502.`,
    },
    {
      type: 'code',
      filename: 'analyzer_limits.rs',
      lang: 'rust',
      code: `let mut v = vec![1, 2, 3];
v.push(v.len());                // accepted: two-phase borrow
let (a, b) = v.split_at_mut(1); // two disjoint windows
a[0] += 1;
b[0] += 1;`,
      chips: ['two-phase: reserve, then activate', 'split_at_mut: the proof lives in std'],
    },
    {
      type: 'prose',
      md: `**3. A conditional return.** The borrow from **v.first()** flows into the return value, so the checker keeps **v** at R for the rest of the function, even on the path where the **if let** failed and nothing is borrowed. The push is rejected with E0502 although no path can dangle:`,
    },
    {
      type: 'code',
      filename: 'conditional_return.rs',
      lang: 'rust',
      code: `fn get_or_insert(v: &mut Vec<u32>) -> &u32 {
    if let Some(x) = v.first() {
        return x;
    }
    v.push(0);
    &v[0]
}`,
      chips: ['safe, and rejected', 'the loan reaches the return', 'E0502'],
    },
    {
      type: 'prose',
      md: `The repair restructures so the test finishes before the borrow you return begins:`,
    },
    {
      type: 'code',
      filename: 'conditional_return_fixed.rs',
      lang: 'rust',
      code: `fn get_or_insert(v: &mut Vec<u32>) -> &u32 {
    if v.is_empty() {
        v.push(0);          // the test's borrow is already over
    }
    &v[0]
}`,
      chips: ['test first, borrow once', 'no clone, no unsafe'],
    },
    {
      type: 'prose',
      md: `To tell a real error from a safe one, ask what the line would do if the compiler let it through: could any live path still reach memory that moved, was freed or was changed under it? The loop and the push after **&v[0]** can. The first program above needs a split, the second nothing at all and the third a restructure.

## Repair borrows, not symptoms

The [R4 Forge drill](/forge/rust-zero-r4) covers shared slice queries, mutable slice updates, non-overlapping **split_at_mut**, strings as **&str**, early borrow endings, and returning a subslice. Each function should operate without cloning or allocating unless its signature explicitly returns an owned value. The compile items for the lifetimes group, which cover these analyzer limits, have no page of their own, so practise them from the Error Museum entries they come from: [E0499](/errors#E0499) and [E0502](/errors#E0502). Each shows the diagram, the fix that keeps the program's behaviour, the clone that changes it, and practice items.`,
    },
    // P4 protégé block (wave-3.md §16.9, task 3s-12). The misconception: the borrow checker is an exact test of memory
    // safety, so every rejected program was a real bug. The evidence names it: the checker is sound but incomplete, and
    // learners must tell real violations from analyzer limits (Crichton, The Usability of Ownership; computing-education.md F4).
    // The family item that proves the fix: compile/verdict.analyzer-limits, whose options always include "compiles with 0
    // errors", the lure of this misconception, on programs such as disjoint.rs above (KC r.analyzer-limits).
    {
      type: 'protege',
      title: 'Sam explains what the borrow checker rejects',
      setup: 'Sam came to Rust from Java and wrote this note for the team wiki.',
      sentences: [
        'A shared borrow takes W and O from the lender until its last use, so the lender can still be read.',
        'A mutable borrow takes R, W and O, so while it lives the borrower is the one way to reach the value.',
        'Pushing to a Vec while a reference into it is live is rejected, because the push may move the buffer and leave the reference dangling.',
        'So every program the borrow checker rejects would have read freed or moved memory if it had compiled.',
        'A borrow ends at its last use, not at the end of its scope, so a later write to the lender can be accepted.',
      ],
      falseAt: 3,
      find: {
        offer: [0, 2, 3, 4],
        why: [
          'True: a shared loan leaves the lender R, which is why any number of readers can share it while writes wait.',
          'True: push may reallocate, so a live reference into the old buffer would dangle. That rejection is a real bug report.',
          'False: the checker is sound but not complete. It tracks v[0] and v[1] as one path, v, so two mutable borrows of different elements are rejected with E0499 although they never overlap.',
          'True: a loan ends at its last use, so the lender gets W back after that line even inside the same block.',
        ],
      },
      tag: {
        q: 'Which mistaken idea sits behind the false sentence?',
        options: [
          'Assuming a borrow lasts to the end of its scope and not to its last use',
          'Taking each refusal by the checker as proof of unsafe code',
          'Thinking a shared borrow takes away the right to read the value',
          'Believing a clone is the repair for a rejected borrow',
        ],
        correct: [1],
        why: [
          'A real mix-up, but not this one: sentence 5 states the last-use rule correctly, and sentence 4 is about which programs get rejected.',
          'Right: the checker reasons about paths and loans, so it rejects some programs it cannot prove safe. Sentence 4 treats every rejection as a real bug.',
          'Not this one: a shared borrow leaves the lender R, and sentence 4 says nothing about reading through the lender.',
          'Not this one: sentence 4 is about why a program is rejected, not about how to repair it, and a clone can change what the program does.',
        ],
      },
      fix: {
        q: 'Which sentence should replace sentence 4?',
        options: [
          'Some rejected programs would have raced with another thread instead, but each rejection is still a real bug.',
          'Some rejected programs are safe and still rejected, such as two mutable borrows of different elements of one Vec.',
          'Some rejected programs are safe to run once unsafe is added, because unsafe turns the borrow checker off for them.',
          'Some rejected programs are safe, and a clone of the borrowed value proves it by making the program compile.',
        ],
        correct: [1],
        why: [
          'Wrong: it keeps the false claim that every rejection is a real bug. disjoint.rs above is rejected and could not race or dangle.',
          'Right: the checker cannot see that two indexes differ, so v[0] and v[1] are one path and the second &mut is E0499. The E0499 practice items in the Error Museum, linked above, ask for exactly that verdict.',
          'Wrong: unsafe does not switch the borrow checker off. It allows raw-pointer dereferences and unsafe calls, which is how split_at_mut proves its two halves disjoint.',
          'Wrong: a clone makes a copy, so the program then works on different data. It compiles because the borrow is gone, which proves nothing about the original.',
        ],
      },
      kcs: ['r.analyzer-limits'],
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'While a live &mut v borrow exists, which permissions has v itself given up?',
          options: [
            'Only W: v can still be read, but nothing may write to it while the borrow lives',
            'W and O: v can still be read, exactly as it can under a shared borrow',
            'R, W and O: the &mut becomes the only route into v until its last use',
            'Only O: v can still be read and written, but it can no longer be moved',
          ],
          correct: [2],
          explanation:
            'A shared borrow takes W and O. An exclusive borrow also takes R, so v is unreachable except through the reference until the reference\'s last use.',
          why: [
            'Giving up only W would leave v readable while a writer exists, and the writer could change what a reader sees. An exclusive borrow takes R as well.',
            'That is the shared borrow: &v takes W and O and leaves R, so readers can coexist. &mut v takes R too, which is why a second reader or writer is rejected with E0502 or E0499.',
            'Right: &mut v takes R, W and O, so the reference is the only live path to the value. When it is last used, v gets all three back.',
            'Taking only O would leave v writable by two paths at once, which is the data race the rule exists to prevent. Moving v away is only one thing &mut stops.',
          ],
          kcs: ['r.borrow-rules'],
        },
        {
          q: 'After let tail = &values[1..], what has values lost until tail\'s last use?',
          options: [
            'Nothing: the borrow covers elements 1 and later, so the first element stays writable',
            'W and O on all of values, because the window is a borrow of the whole Vec path',
            'R, W and O on elements 1 and later, because a window is an exclusive loan',
            'Only O, since a slice is a view onto the data and reads and writes through values still work',
          ],
          correct: [1],
          explanation:
            'values is one path to the checker. A shared borrow of any part takes W and O from the whole of it, and R stays, so a window is a shared view of the Vec for as long as it is live.',
          why: [
            'The checker tracks values as a single path and does not split it by index, so a write to values[0] is rejected too. Disjoint windows need split_at_mut.',
            'Right: a shared slice takes W and O from the whole path and leaves R. After the last use of tail, values holds R, W and O again, and clamp_first(&mut values, 5) is allowed.',
            'A shared window is not exclusive, so it leaves R in place. Exclusive access to a range is what &mut values[1..] would take, and it would still take it from all of values.',
            'W is taken as well as O. Writing through values while tail is live could reallocate the buffer or change elements tail is reading, and the shared borrow forbids both.',
          ],
          kcs: ['r.slices', 'r.borrow-rules'],
        },
        {
          q: 'Why does Vec::push conflict with a live shared reference to one of its elements?',
          options: [
            'push needs W on the Vec but the reference took it, and growth could free the buffer',
            'push consumes the Vec and leaves earlier references pointing at moved memory',
            'The Vec counts live element borrows at run time and push panics when that count is not zero',
            'push shifts the existing elements by one slot and changes what a held reference sees',
          ],
          correct: [0],
          explanation:
            'push takes &mut self, which needs W. A live shared reference to an element holds the loan that removed W, and a push that grows the buffer would free the memory it points into.',
          why: [
            'Right: the shared reference took W and O from the Vec, and push asks for W. The checker rejects it with E0502 before the program runs, which is the use-after-free it prevents.',
            'push takes &mut self, not self, so the Vec is not moved and O is not involved. The conflict is the missing W while the shared borrow lives.',
            'That describes RefCell\'s run-time check. Vec tracks no borrows; the conflict is found at compile time, before the program runs.',
            'push writes after the last element and moves nothing in place. Elements move only when the buffer reallocates, which is the real hazard.',
          ],
          kcs: ['r.borrow-rules'],
        },
        {
          q: 'A function returns x from if let Some(x) = v.first(), then calls v.push(0) after the if, and the compiler rejects the push with E0502. Which repair keeps the function safe and cheap?',
          options: [
            'Test is_empty and push first, so the one borrow left is the one you return',
            'Clone v before the if let, so the checker has a second Vec to borrow from',
            'Wrap the push in unsafe, since the path that reaches it holds no live reference',
            'Take v by value instead, so the function owns it and may push as it likes',
          ],
          correct: [0],
          explanation:
            'The loan from first() reaches the return, so the checker keeps v at R after the if. The program is safe, but the checker cannot see that, so restructure: finish the test before the borrow you return starts.',
          why: [
            'Right: is_empty() ends its borrow immediately, push gets the W it needs, and the only loan left is the one &v[0] returns. Nothing is cloned or made unsafe.',
            'The clone would be new work, and it would not return a reference into the caller\'s Vec, which is what the signature promises. Cloning silences the checker by changing the program.',
            'unsafe does not turn the checker off for borrows, so the E0502 stays. unsafe is for a proof you write down, and this one is better expressed by restructuring.',
            'Taking v by value changes the signature and the caller loses its Vec, while the returned &u32 could no longer point into the caller\'s data. The fix should keep the contract.',
          ],
          kcs: ['r.analyzer-limits', 'r.borrow-rules'],
        },
      ],
    },
  ],
  kcs: ['r.borrow-rules', 'r.slices', 'r.analyzer-limits'],
}

export default lesson
