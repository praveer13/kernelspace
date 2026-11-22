import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t2-l6-task-size-and-io-uring',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t2.l6'],
  title: 'An async task holds its buffer, so the echo task is about a kilobyte; io_uring is blocked in default Docker; no NATS',
  before: 'A tokio task was "a few hundred bytes" even with a 1024-byte buffer in its body. The lesson did not say that default Docker blocks io_uring, and it put Dynamo\'s data plane "over NATS".',
  after: 'A task holds the locals live across its awaits: the echo server\'s future is about a kilobyte. Docker\'s default seccomp profile blocks io_uring_setup, enter and register; tokio\'s io_uring is unstable. Dynamo uses plain TCP by default.',
  why: 'The buffer is live across the read await, so the compiler stores it in the future. Tokio defaults to epoll, and Docker blocks io_uring calls by default.',
  source: {
    url: 'https://docs.docker.com/engine/security/seccomp/',
    title: 'Seccomp security profiles for Docker',
  },
} satisfies Erratum
