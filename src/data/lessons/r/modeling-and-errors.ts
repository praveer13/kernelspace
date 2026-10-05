import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l5',
  slug: 'rust-modeling-and-errors',
  trackId: 'r',
  index: 5,
  title: 'Structs, Enums, Option & Result',
  minutes: 32,
  hook: 'Make invalid states hard to express, then move ordinary failure through the type system with Result and ?.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `Systems code becomes manageable when the types carry the state. A **struct** groups fields. An **enum** says a value is exactly one of several variants, and each variant may carry different data. Match then forces every state transition to be considered.

Rust has no null. **Option<T>** is either Some(T) or None. Recoverable failure is **Result<T, E>**: Ok(T) or Err(E). Both are ordinary enums, so the same matching rules apply.`,
    },
    {
      type: 'code',
      filename: 'model.rs',
      lang: 'rust',
      code: `#[derive(Debug, PartialEq)]
struct Block {
    id: usize,
    used: usize,
    capacity: usize,
}

impl Block {
    fn free(&self) -> usize {
        self.capacity.saturating_sub(self.used)
    }
}

fn parse_capacity(raw: &str) -> Result<usize, String> {
    let n: usize = raw.parse().map_err(|_| "not an integer".to_owned())?;
    if n == 0 { Err("capacity must be positive".into()) } else { Ok(n) }
}`,
      chips: ['Option replaces null', 'Result makes failure visible', '? returns Err early'],
    },
    {
      type: 'prose',
      md: `## The question-mark operator is typed early return

Applied to a Result, **?** unwraps Ok and continues; on Err, it converts the error if needed and returns it from the current function. Applied to Option, it similarly returns None. This is not exception control flow: callers see fallibility in the function signature, and no hidden stack unwinding is required.

Use panic for violated programmer invariants, not malformed input or capacity exhaustion. If a caller can reasonably react, return Option or Result.`,
    },
    {
      type: 'callout',
      variant: 'isomorphism',
      title: 'This is the Forge vocabulary',
      md: `The allocator needs blocks and optional fits; the KV manager needs sequence states and fallible allocation; the tokenizer needs explicit symbol variants. R5 is the point where their data models stop looking foreign.`,
    },
    {
      type: 'prose',
      md: `## Model six small domains

The [R5 Forge drill](/forge/rust-zero-r5) covers struct methods, an enum state machine, Option lookup, Result validation, error propagation with **?**, and matching nested state. Finish this drill before allocator lab 01; its Vec, slice, and Option vocabulary is the direct prerequisite.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'What does Option<T> communicate that a nullable reference does not?',
          options: [
            'None carries an error that says why the value is missing',
            'Absence is a type variant and the compiler forces callers to handle it',
            'The value is boxed on the heap and a null pointer marks the empty case at runtime',
            'Each access is checked for null at runtime and throws on failure as in Java',
          ],
          correct: [1],
          explanation:
            'Some and None are part of the static type, so callers cannot accidentally dereference absence without handling it.',
          why: [
            'None carries no data. Explaining a failure is the job of Result<T, E>, whose Err holds a reason, while Option only says a value is present or not.',
            'Right: Option is an ordinary enum, so absence is visible in the type. Reaching the T requires a match, if let or a method that handles None.',
            'Option<T> is stored inline, with no heap allocation. Pointer-like payloads such as Box may use a null niche, but that is an optimization.',
            'No runtime null check exists, because there are no null references. The compiler enforces handling statically, so there is no NPE to throw.',
          ],
          kcs: ['r.enums-option-result', 'r.control-flow-match'],
        },
        {
          q: 'Inside a Result-returning function, what does expr? do when expr is Err?',
          options: [
            'It panics with the error value as unwrap does instead of returning it',
            'It unwinds like an exception to a catching caller, so signatures need no Result',
            'It returns the Err from the current function and converts it with From',
            'It evaluates to the error value and execution goes on as in Go',
          ],
          correct: [2],
          explanation:
            'The ? operator is concise typed propagation, not an exception or hidden retry.',
          why: [
            'Panicking is what unwrap and expect do. The ? operator returns the error to the caller instead, so the caller decides whether to recover.',
            'Rust has no exception handlers for Result. The error travels by ordinary return, and the signature must declare the Result type that carries it.',
            'Right: ? is an early return of the Err, passed through From::from so error types can differ. The caller sees the failure in the function\'s signature.',
            'Execution does not continue past a failed ?. The function returns immediately, so later statements never see the error value.',
          ],
          kcs: ['r.error-propagation', 'r.enums-option-result'],
        },
        {
          q: 'When should ordinary input validation return Result instead of panic?',
          options: [
            'When the caller can reasonably react such as rejecting a bad config value',
            'When the code is a library crate and a binary crate should panic instead',
            'When failures are frequent and rare ones should panic to save unwinding cost',
            'When the error is an I/O failure while a malformed value should panic',
          ],
          correct: [0],
          explanation:
            'Expected, recoverable failure belongs in the signature. Panic is for broken invariants or unrecoverable programmer mistakes.',
          why: [
            'Right: if a caller can recover, retry or report the problem, the function should return Result. Panics are for broken invariants, not bad external input.',
            'Applications also handle bad input, for example by reporting it to the user. Whether code is a library or binary does not decide Result versus panic.',
            'The rule is about who can recover, not speed. Result suits rare failures too, and panicking on bad input makes callers unable to respond.',
            'Malformed input is expected, recoverable failure, so it returns Err just like an I/O error does. Invariants are things only a bug can violate.',
          ],
          kcs: ['r.error-propagation'],
        },
      ],
    },
  ],
  kcs: ['r.enums-option-result', 'r.error-propagation'],
}

export default lesson
