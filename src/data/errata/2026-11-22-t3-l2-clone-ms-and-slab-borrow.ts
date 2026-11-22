import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t3-l2-clone-ms-and-slab-borrow',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t3.l2'],
  title: 'A 100 MiB clone costs tens of milliseconds, and the slab listing now borrows its owner',
  before: 'A 100 MiB clone was said to burn about 30 µs. The slab view took raw parts, so its lifetime was unbounded and PhantomData tied it to nothing.',
  after: 'A host clone is DRAM-bound and takes tens of milliseconds. The listing builds views from a borrowed Mapping, and its safety contract forbids writers during the view.',
  why: 'The 30 µs divided 100 MiB by GPU memory bandwidth. A constructor taking raw parts borrows nothing, so the compiler cannot stop the owner dropping first.',
  source: {
    url: 'https://doc.rust-lang.org/nomicon/unbounded-lifetimes.html',
    title: 'The Rustonomicon: Unbounded Lifetimes',
  },
} satisfies Erratum
