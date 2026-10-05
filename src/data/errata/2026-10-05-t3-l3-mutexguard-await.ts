import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t3-l3-mutexguard-await',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t3.l3'],
  title: 'A std MutexGuard held across .await blocks the worker threads of tasks that lock it, not the whole runtime',
  before:
    'Quiz Q4 keyed: the suspended task holds the lock "blocking all other tasks on that thread pool", and the guard "isn\'t Send-safe across suspension in most runtimes".',
  after:
    'Each task that calls lock() on that mutex blocks its worker thread, and the tasks queued on that thread wait with it. Tasks on other workers keep running. The std guard is !Send, so tokio::spawn rejects the future at compile time.',
  why: 'A contended lock() blocks its worker thread, so tasks queued there stall until another worker steals them, even if they never touch the mutex. If every worker is blocked in lock(), the holder cannot resume and the runtime deadlocks.',
  source: {
    url: 'https://tokio.rs/tokio/tutorial/shared-state',
    title: 'Tokio tutorial: Shared state (holding a MutexGuard across an .await)',
  },
  items: [
    {
      q: 'A task holds a std::sync::MutexGuard across an .await. Which tasks are blocked while it is parked?',
      options: [
        'Tasks on the whole runtime, with a held lock pausing the thread pool',
        'Tasks calling lock, with tasks queued behind them on their threads',
        'No task, with the await releasing the guard at the suspension point',
        'Only the holder, with other tasks woken once its future is dropped',
      ],
      correct: [1],
      why: [
        'Not the whole runtime: tasks on other workers keep running, and only the threads blocked in lock(), with the tasks queued on them, stall.',
        'Right: each task that calls lock() blocks its worker thread, and the tasks queued behind it wait too. If every worker is blocked this way, the holder cannot resume and the executor deadlocks.',
        'An await does not release the guard. It lives in the future\'s saved state, so the lock stays held until the guard is dropped.',
        'Dropping the future would release the lock, but a parked holder is not dropped. Other tasks block in lock() until it resumes and drops the guard.',
      ],
    },
  ],
} satisfies Erratum
