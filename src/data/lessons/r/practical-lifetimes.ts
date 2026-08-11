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
          options: ['Extends heap allocation lifetime', 'Adds reference counting', 'Nothing; it supplies a compile-time relationship', 'Runs a destructor later'],
          correct: [2],
          explanation: 'Lifetimes are proof metadata erased after type checking. They never keep a referenced value alive.',
        },
        {
          q: 'Why must struct Block<\'a> declare a lifetime for its &[u32] field?',
          options: ['Slices always allocate', 'The type must state that Block cannot outlive the borrowed slice', 'The field is mutable', 'All structs require lifetimes'],
          correct: [1],
          explanation: 'A type that stores a reference must expose the validity relationship as part of its own type.',
        },
        {
          q: 'What is the right fix when data truly must outlive the input it came from?',
          options: ['Invent a longer lifetime annotation', 'Return or store owned data', 'Use a wildcard lifetime', 'Disable Drop'],
          correct: [1],
          explanation: 'Annotations can describe valid relationships, not create them. Ownership is required when independent lifetime is required.',
        },
      ],
    },
  ],
}

export default lesson
