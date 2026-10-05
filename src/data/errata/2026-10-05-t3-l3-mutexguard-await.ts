import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t3-l3-mutexguard-await',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t3.l3'],
  title: 'A std MutexGuard held across .await blocks only the tasks that lock it, not every task',
  before:
    'Quiz Q4 keyed: the suspended task holds the lock "blocking all other tasks on that thread pool", and the guard "isn\'t Send-safe across suspension in most runtimes".',
  after:
    'Only tasks that call lock() on that mutex block, each holding a worker thread, so the executor can stall or deadlock. The std guard is !Send, so tokio::spawn rejects the future at compile time.',
  why: 'Tasks that never touch the mutex keep running. The real hazard is blocked worker threads that the parked holder needs in order to resume, which the compiler flags for multi-threaded spawn.',
  source: {
    url: 'https://tokio.rs/tokio/tutorial/shared-state',
    title: 'Tokio tutorial: Shared state (holding a MutexGuard across an .await)',
  },
  items: [
    {
      q: 'A task holds a std::sync::MutexGuard across an .await. Which tasks are blocked while it is parked?',
      options: [
        'Tasks on the whole runtime, with a held lock pausing the thread pool',
        'Tasks that call lock on that mutex, each blocking its worker thread',
        'No task, with the await releasing the guard at the suspension point',
        'The holder alone, with other tasks woken once its future is dropped',
      ],
      correct: [1],
      why: [
        'Tasks that never touch the mutex keep running. A held lock blocks only the threads of tasks that try to take it.',
        'Right: each task that calls lock() blocks its worker thread. If the holder needs one of those threads to resume, the executor deadlocks.',
        'An await does not release the guard. It lives in the future\'s saved state, so the lock stays held until the guard is dropped.',
        'Dropping the future would release the lock, but a parked holder is not dropped. Other tasks block in lock() until it resumes and drops the guard.',
      ],
    },
  ],
} satisfies Erratum
