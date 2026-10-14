/**
 * Prove it v1, "Prove it, no AI", for lab 05 (docs/specs/wave-3.md §8.2; the mechanics are lab 01's, wave-1.md §13.3).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions below about their
 * own `executor.rs`. One question returns 30 days later as a Today item (`followUpRef`). The state machine, the draw and
 * the ledger payload are the same for every lab: they live in src/lib/forge/prove.ts. The panel is
 * src/components/forge/ProveIt.tsx, which draws from the bundle's `prove`.
 *
 * There is no Prove-it v2 for this lab (§7.2): its bridge answers `probe` only, and a probe line summarises a whole
 * run, so there is no seeded list of verb calls whose replies the learner could predict.
 */

import type { ProveQuestion } from '../types'

export const PROVE_LAB_ID = 'toy-executor'

const FUTURES = 't3.futures-state-machines'
const WAKERS = 't3.wakers-executor'

export const PROVE_QUESTIONS: readonly ProveQuestion[] = [
  {
    id: 'take-poll-restore',
    prompt: 'Walk through one turn of your `run`: what does it take out of the task, what does it call, and what does it do with the result?',
    model:
      'It pops the next task off the queue, then takes the future out of the task’s `RefCell<Option<…>>`, leaving `None` behind. It builds a waker with `make_waker(&task)`, wraps it in a `Context` and polls the future. On `Poll::Pending` it puts the future back into the task, because the waker will re-queue the task and the next poll needs the future. On `Poll::Ready` it just lets the future drop, so a finished task cannot be polled again.',
    ideas: [
      'takes the future out of the task, builds a waker for the task and polls with it',
      'on Pending the future goes back into the task, and nothing is queued by the loop',
      'on Ready the future is dropped, so the task is finished for good',
    ],
    kcs: [FUTURES],
  },
  {
    id: 'borrow-scope',
    prompt: 'Where does your `run` end its borrow of the queue, and what would happen if the borrow lasted through the poll?',
    model:
      'The pop is a `let` statement of its own, with `queue.borrow_mut().pop_front()` on the right. The `RefMut` is a temporary, so it is gone at the semicolon, before the poll starts. That matters because a poll can call `spawn` or a waker, and both take `borrow_mut` on the same queue. With a guard held across the poll, the first wake would panic with "already borrowed", which is what turns every check red, starting with `block_on`.',
    ideas: [
      'the pop is a statement of its own, so the RefMut guard is a temporary that ends at the semicolon',
      'a poll can wake or spawn, and both borrow the same queue mutably',
      'a guard held across the poll panics at the first wake, and every check goes red',
    ],
    kcs: [WAKERS],
  },
  {
    id: 'who-requeues',
    prompt: 'What puts a Pending task back on the queue in your executor, and what goes wrong if `run` does it as well?',
    model:
      'Only the waker: `wake_task` pushes the task onto the back of the queue when something calls `wake` or `wake_by_ref`. My `run` does not queue a Pending task at all, it only puts the future back. If the loop also re-queued it, a task parked on a gate would be polled again at once and on every round, which is what `pending_repoll` counts: more than the 2 polls it wants. A task that wakes itself would also be queued twice, and `fifo_poll` would see a different poll order.',
    ideas: [
      'only the waker re-queues a task, by pushing it onto the back of the queue',
      'if the loop re-queued Pending tasks too, a parked task would be polled again with no wake',
      'a self-waking task would sit in the queue twice, which changes the poll order',
    ],
    kcs: [WAKERS, FUTURES],
  },
  {
    id: 'stale-wake',
    prompt: 'A task has finished and an old waker clone wakes it afterwards. What does your `run` do with that queue entry, and does it count as a poll?',
    model:
      'The entry pops like any other, but the task’s future is `None` because it was taken and dropped when the task returned Ready. My `run` sees `None` and skips the entry with `continue`, before the poll and before the counter is touched. A skipped entry is not a poll: nothing was polled. Counting it would make `run()` report more polls than the tasks made, and a Ready future must never be polled again.',
    ideas: [
      'the future was taken and dropped on Ready, so the stale entry holds `None`',
      'run skips such an entry before polling, with a continue',
      'it is not counted as a poll, so the count stays equal to the real polls',
    ],
    kcs: [WAKERS],
  },
  {
    id: 'poll-count',
    prompt: '`many_tasks` expects exactly 3000 polls for 1000 tasks. Where does 3000 come from, and where in your `run` is the count incremented?',
    model:
      'The yields are a shuffle of 200 each of 0, 1, 2, 3 and 4, which total 200 × (0 + 1 + 2 + 3 + 4) = 2000. Every task is polled once for each yield and once more to finish, so the polls are 2000 + 1000 = 3000, whatever the order. My `run` adds one to its counter right before each real poll, after the check that the task still has a future, so skipped entries and Ready tasks are never counted twice.',
    ideas: [
      'the yields total 2000, one poll for each, and 1000 tasks add one finishing poll each',
      'so 3000 holds for any shuffle, because the order does not change the count',
      'the counter goes up once per real poll, after the skip for a task with no future',
    ],
    kcs: [WAKERS],
  },
  {
    id: 'block-on-output',
    prompt: 'The tasks of your executor have `Output = ()`. How does your `block_on` get a future’s Output back out?',
    model:
      'It creates an `Rc<RefCell<Option<Output>>>` and keeps one clone. It spawns a wrapper async block that moves in the other clone and the future, awaits the future and stores the result in the cell. It then calls `run`, so the wrapper is polled through every Pending, and finally takes the value out of the cell. Rc and RefCell are enough because the executor is single-threaded; the cell is the only way out, since a spawned task returns nothing.',
    ideas: [
      'an Rc<RefCell<Option<…>>> is shared between block_on and a wrapper task',
      'the wrapper awaits the future and stores its Output, and block_on runs the executor',
      'afterwards block_on takes the value out, since a spawned task itself returns nothing',
    ],
    kcs: [FUTURES],
  },
]

/** The Today follow-up item for a question: a constructed response, 30 days after the attempt. */
export const followUpRef = (qid: string): `item:${string}` => `item:lab05.prove.${qid}`
