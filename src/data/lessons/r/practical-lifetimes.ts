import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l9',
  slug: 'rust-practical-lifetimes',
  trackId: 'r',
  index: 9,
  title: 'Practical Lifetimes',
  minutes: 31,
  hook: 'Read lifetime syntax as a contract between references, then build the exact borrowed Block used later in T3.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `A lifetime annotation does not keep a value alive and does not change runtime behavior. It names a relationship the compiler must prove: an output reference came from a particular input, or a struct containing a reference cannot outlive its source.

Rust infers these relationships in ordinary calls. You write **'a** when a function signature or data type could otherwise be ambiguous.`,
    },
    {
      type: 'code',
      filename: 'lifetimes.rs',
      lang: 'rust',
      code: `struct Block<'a> {
    tokens: &'a [u32],
}

impl<'a> Block<'a> {
    fn first(&self) -> Option<&u32> {
        self.tokens.first()
    }
}

fn longer<'a>(left: &'a str, right: &'a str) -> &'a str {
    if left.len() >= right.len() { left } else { right }
}

fn prefix(input: &str, n: usize) -> &str {
    &input[..input.len().min(n)] // elision infers the relationship
}`,
      chips: ["'a names a relationship", 'annotations do not extend life', 'elision covers common signatures'],
    },
    {
      type: 'prose',
      md: `## Read the contract from the caller's side

The return of **longer** is usable only for the overlap in which both inputs remain valid, because either input might be chosen. A **Block<'a>** may live only while its token slice lives. The struct owns no token storage; it is a checked view.

If a requested reference really must outlive its input, annotations cannot make that safe. Return owned data, move ownership into the long-lived object, or redesign the boundary.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Do not annotate by superstition',
      md: `Adding the same lifetime to every reference can over-constrain an API by claiming unrelated borrows must overlap. Start with elision, read the compiler's missing-relationship message, and name only the relationship callers need.`,
    },
    {
      type: 'prose',
      md: `## Prove borrowed views

The [R9 Forge drill](/forge/rust-zero-r9) returns subslices, chooses between borrowed strings, defines **Block<'a>**, separates two unrelated lifetimes, and replaces an impossible escaping reference with owned data. T3.L1 uses the same Block shape; after this drill it is a reminder, not a cliff.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'What does a lifetime annotation do at runtime?',
          options: [
            "It keeps the referent alive until 'a ends and moves it to the heap if needed",
            "It adds a reference count at runtime as Rc does and 'a lasts while a holder remains",
            'Nothing at runtime and it is compile-time metadata on reference validity',
            'It stores a scope tag with the reference and checks it on dereference',
          ],
          correct: [2],
          explanation:
            'Lifetimes are proof metadata erased after type checking. They never keep a referenced value alive.',
          why: [
            'Annotations never extend or move a value. The referent dies when its owner does, and the compiler rejects code that would use the reference later.',
            'Reference counting is Rc and Arc, with a real runtime count. Lifetime parameters are erased after checking and add no counter to the value.',
            'Right: lifetimes are erased after borrow checking and generate no code. They only let the compiler prove references never outlive their referents.',
            'No scope tag or runtime check exists; a reference is a plain pointer. Dangling use is rejected at compile time, for example with E0597.',
          ],
        },
        {
          q: 'Why must struct Block<\'a> declare a lifetime for its &[u32] field?',
          options: [
            "A slice owns its elements and 'a tells Rust how long Block keeps that storage",
            'The type must say that a Block cannot outlive the slice it borrows',
            'Rust must know the size of Block and a slice length is unknown at compile time',
            'It is optional for shared slice fields when elision applies and required for &mut fields',
          ],
          correct: [1],
          explanation:
            'A type that stores a reference must expose the validity relationship as part of its own type.',
          why: [
            'A &[u32] borrows its elements and owns nothing. Someone else owns the storage, and \'a ties the Block to that owner\'s lifetime, not to an allocation.',
            'Right: the parameter is the contract that Block is only valid while its source slice is. rustc reports a missing one as E0106.',
            'A &[u32] is a fixed-size pointer and length pair, so Block\'s size is known. The lifetime says nothing about size; it relates validity.',
            'Elision does not apply to struct fields. A reference field always needs a named lifetime, shared or mutable, or E0106 is reported.',
          ],
        },
        {
          q: 'What is the right fix when data truly must outlive the input it came from?',
          options: [
            "Declare the return as 'static to keep the data valid until the program ends",
            'Return owned data such as a String or Vec with no borrow of the input',
            'Wrap the reference in a Box to give the data its own lifetime',
            'Copy the reference with a plain let binding to detach it from the input',
          ],
          correct: [1],
          explanation:
            'Annotations can describe valid relationships, not create them. Ownership is required when independent lifetime is required.',
          why: [
            '\'static is a claim the compiler checks, and a borrow from a shorter-lived input cannot satisfy it. Rust rejects it with a lifetime may not live long enough error.',
            'Right: copy or move the bytes into an owner such as String or Vec. Owned data has no tie to the input, so it can live as long as needed.',
            'Box<&T> still holds the original borrow, so it lives no longer than the input. Boxing moves the pointer to the heap, not the referent.',
            'A shared reference is Copy, so `let r2 = r` only duplicates the pointer. The copy keeps the input\'s lifetime. Only an owning conversion such as to_string or to_vec detaches it.',
          ],
        },
      ],
    },
  ],
}

export default lesson
