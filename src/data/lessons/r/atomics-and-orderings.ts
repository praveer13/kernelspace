import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l10',
  slug: 'rust-atomics-and-orderings',
  trackId: 'r',
  index: 10,
  title: 'Atomics & Memory Orderings',
  minutes: 42,
  hook: 'Atomicity is only half the contract. Use Relaxed for counters and Acquire/Release to publish initialized state.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `An atomic operation cannot tear and participates in a memory-ordering contract. That does not make an algorithm correct by itself. You must decide which writes another thread is allowed to observe, and in what order.

Start with three orderings. **Relaxed** guarantees atomic modification of that atomic value only. A **Release** operation publishes earlier writes. An **Acquire** operation that observes that release makes those earlier writes visible to its thread.`,
    },
    {
      type: 'code',
      filename: 'atomics.rs',
      lang: 'rust',
      code: `use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

fn next_id(counter: &AtomicUsize) -> usize {
    counter.fetch_add(1, Ordering::Relaxed)
}

fn try_lock(locked: &AtomicBool) -> bool {
    locked
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_ok()
}

fn unlock(locked: &AtomicBool) {
    locked.store(false, Ordering::Release);
}`,
      chips: ['Relaxed = atomic value only', 'Release publishes', 'Acquire observes'],
    },
    {
      type: 'prose',
      md: `## Compare-and-exchange is conditional ownership transfer

CAS changes an atomic only if it still equals the expected value. On success it returns the old value; on failure it reports the value actually observed. Real lock-free algorithms retry because another thread may win between your load and CAS.

The success and failure orderings describe different events. Failure performs only a load, so it cannot use Release. For a spin lock, successful Acquire pairs with Release unlock; failed probes can be Relaxed. For a metrics counter with no associated data, Relaxed is enough.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'The queue lab requires this lesson',
      md: `MPMC queue lab 04 uses CAS cursors plus Acquire/Release publication. Guessing SeqCst everywhere may hide the model but does not repair an incorrect protocol. Complete R10 first, and write down which store publishes each slot before implementing the queue.`,
    },
    {
      type: 'prose',
      md: `## Practice before lock-free

The [R10 Forge drill](/forge/rust-zero-r10) covers a Relaxed ticket counter, Release/Acquire publication, compare-exchange, fetch-update, a minimal spin lock, and an ordering classifier. Pair it with [Mara Bos, Rust Atomics and Locks chapters 2–3](https://marabos.nl/atomics/). Then proceed to MPMC queue lab 04.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'When is Ordering::Relaxed sufficient?',
          options: [
            'A ready flag that publishes a non-atomic buffer to a reader thread',
            'A standalone ticket or metrics counter that guards no other data',
            'The store that unlocks a spin lock around a critical section',
            'A compare_exchange loop that hands data to other threads',
          ],
          correct: [1],
          explanation:
            'Relaxed guarantees atomic updates to the counter itself but establishes no visibility relationship for surrounding memory.',
          why: [
            'A Relaxed flag does not order the buffer writes before it, so the reader may see the flag set and stale data. Publication needs Release and Acquire.',
            'Right: Relaxed keeps the update atomic but orders nothing else. When no other memory depends on the counter, such as a ticket id, that is enough.',
            'The unlocking store must be Release so the critical section\'s writes are visible to the next Acquire locker. Relaxed would let them be missed.',
            'Atomicity does not give ordering. A CAS that publishes or consumes other data needs Acquire or Release, so Relaxed fits only independent values.',
          ],
        },
        {
          q: 'What relationship does Release/Acquire establish when the Acquire observes the Release?',
          options: [
            'Other threads see the writes too and not only the thread that did the Acquire',
            'Writes made before the Release become visible to the thread that observes it',
            'The Acquire waits until the releasing thread leaves its critical section',
            'Both operations are upgraded to SeqCst and join the single global order',
          ],
          correct: [1],
          explanation:
            'The pair creates the happens-before edge used to publish initialized state safely.',
          why: [
            'Visibility is guaranteed only to a thread whose Acquire reads the released value. Other threads get no such edge from this pair.',
            'Right: the pair creates a happens-before edge. Everything the releasing thread wrote before its Release store is visible after the Acquire load that reads it.',
            'Acquire never blocks or waits. It is a load that either reads the released value or does not, and then the thread must retry or proceed.',
            'Orderings are chosen per operation. Release and Acquire do not upgrade other operations, and only SeqCst operations join the single global order.',
          ],
        },
        {
          q: 'Why must compare_exchange code handle failure?',
          options: [
            'A failure means the ordering was too weak and a stronger one removes failures',
            'Another thread can change the value after your load and Err returns what it saw',
            'A failure poisons the atomic and the caller must reset it before reuse',
            'A failure can tear the value and the caller must restore the old one',
          ],
          correct: [1],
          explanation:
            'Contention is normal. A CAS loop recomputes from the newly observed state until it succeeds or chooses to stop.',
          why: [
            'Failure is about the value, not the ordering. A stronger ordering does not stop another thread from winning the race, so the code must still handle Err.',
            'Right: the value can change between your load and the CAS. A failure returns Err with the value actually found, which a loop recomputes from.',
            'Atomics have no poisoning; that is a Mutex feature. After a failed CAS the atomic is intact and can be used again at once.',
            'Atomic operations never tear. A failed CAS leaves the value untouched, with only the observed value returned, so nothing needs restoring.',
          ],
        },
      ],
    },
  ],
}

export default lesson
