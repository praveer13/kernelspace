import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t3-l4-toy-executor-compiles',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t3.l4'],
  title: 'The toy executor listing now compiles and wakes',
  before: 'A Box<dyn Future> polled without Pin (error E0599), and a loop that parked holding the queue lock with no unpark',
  after: 'Pin<Box<dyn Future>>, std Wake, a Condvar wait taken without the queue lock, and a leaf future whose helper thread wakes it',
  why: 'A boxed future cannot be polled without Pin, and a thread that sleeps holding the queue lock blocks every wake. The listing now compiles and finishes in wake order.',
  source: {
    url: 'https://doc.rust-lang.org/std/task/trait.Wake.html',
    title: 'std::task::Wake, The Rust Standard Library',
  },
} satisfies Erratum
