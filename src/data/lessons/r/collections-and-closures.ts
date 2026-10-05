import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l6',
  slug: 'rust-collections-and-closures',
  trackId: 'r',
  index: 6,
  title: 'Collections, Closures & Iterators',
  minutes: 32,
  hook: 'Own a sequence with Vec, index by key with HashMap, and turn loops into explicit iterator pipelines.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `The Forge leans on two standard collections. **Vec<T>** owns contiguous elements and exposes slices; **HashMap<K, V>** owns keyed entries. Their methods encode ownership: inserting owned values moves them in, **get** lends a shared reference, and **get_mut** lends an exclusive one.

Closures are anonymous functions that may borrow or capture their environment. Iterator adapters accept closures and stay lazy until a consumer such as collect, sum, count, or fold requests results.`,
    },
    {
      type: 'code',
      filename: 'collections.rs',
      lang: 'rust',
      code: `use std::collections::HashMap;

fn histogram(tokens: &[u32]) -> HashMap<u32, usize> {
    let mut counts = HashMap::new();
    for &token in tokens {
        *counts.entry(token).or_insert(0) += 1;
    }
    counts
}

fn admitted_cost(costs: &[usize], limit: usize) -> usize {
    costs.iter()
        .copied()
        .filter(|cost| *cost <= limit)
        .map(|cost| cost * 2)
        .sum()
}`,
      chips: ['iter lends', 'into_iter consumes', 'pipelines are lazy'],
    },
    {
      type: 'prose',
      md: `## Choose the iterator that matches ownership

**iter()** yields shared references, **iter_mut()** yields mutable references, and **into_iter()** consumes the collection and yields owned elements. Most confusing closure errors are really a mismatch among those three ownership modes.

Use a plain loop when it states the algorithm better. Iterators are not a performance tax; they normally optimize to the same machine code. Their advantage is compositional intent, not point-free cleverness.`,
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'Entry avoids duplicate lookup',
      md: `HashMap's **entry(key).or_insert(value)** API performs one lookup and returns a mutable reference to the stored value. It is the idiomatic shape for counters, token tables, cache metadata, and grouped request queues.`,
    },
    {
      type: 'prose',
      md: `## Build the Forge data paths

The [R6 Forge drill](/forge/rust-zero-r6) asks for Vec filtering, stable sorting, a frequency map, grouped accumulation through entry, closure capture, and a map/filter/fold pipeline. It directly prepares tokenizer lab 03 and batching scheduler lab 06.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Which iterator consumes a Vec and yields owned elements?',
          options: [
            'iter() yields each element by value and copies it out of the Vec',
            'iter_mut() moves each element out and lets the loop body modify it',
            'into_iter() takes the Vec by value and yields each element in turn',
            'drain(..) yields owned elements and leaves the Vec usable afterwards',
          ],
          correct: [2],
          explanation:
            'into_iter takes ownership of the collection. iter and iter_mut only borrow it.',
          why: [
            'iter() yields shared references, &T, and leaves the Vec intact. Nothing is copied or moved out, so the elements stay owned by the Vec.',
            'iter_mut() yields &mut T references. Elements are changed in place and remain owned by the Vec, so nothing is moved out of it.',
            'Right: into_iter takes self, so the Vec is consumed and each element is moved out by value. The Vec binding cannot be used afterwards.',
            'drain(..) yields owned elements but only borrows the Vec mutably, leaving it empty and usable. It removes elements rather than consuming the Vec.',
          ],
        },
        {
          q: 'When do lazy iterator adapters actually perform work?',
          options: [
            'As soon as map is called and the closure runs over the whole input',
            'When a consumer such as collect or sum pulls items through the chain',
            'When the adapter is dropped at the end of the scope it was built in',
            'On a background thread pool that starts as soon as the adapter is built',
          ],
          correct: [1],
          explanation:
            'Adapters describe a pipeline. A consumer repeatedly requests the next item and drives the chain.',
          why: [
            'Calling map only wraps the iterator and runs no closure. The eager behaviour of a Python list comprehension does not apply to Rust adapters.',
            'Right: adapters only build a pipeline. A consumer such as collect, sum, count or fold calls next repeatedly, and each call pulls one item through.',
            'Dropping an unconsumed adapter runs nothing; the compiler even warns that iterators are lazy. Work happens only when something consumes items.',
            'Standard iterators are single-threaded. Parallel pipelines need a crate such as rayon, and even those start work only when consumed.',
          ],
        },
        {
          q: 'Why use HashMap::entry for a counter?',
          options: [
            'It locks the bucket and lets several threads increment one counter without a data race',
            'It finds or inserts the slot with one hash lookup and gives mutable access',
            'It returns a copy of the stored value and avoids borrowing the map',
            'It keeps a running count inside the map and needs no separate local variable at all',
          ],
          correct: [1],
          explanation:
            'The entry API expresses insert-if-absent followed by mutation with a single table lookup.',
          why: [
            'HashMap is not synchronized and entry takes &mut self. Sharing a counter across threads still needs a lock or atomics around the map.',
            'Right: entry does one hash lookup, inserts when absent, and returns a &mut V. The idiom *map.entry(k).or_insert(0) += 1 needs no second lookup.',
            'entry returns a mutable reference into the map, not a copy. Updating a copy would never change the stored count.',
            'The map keeps no hidden counters. The count is simply the value stored under each key, which entry lets you update in place.',
          ],
        },
      ],
    },
  ],
}

export default lesson
