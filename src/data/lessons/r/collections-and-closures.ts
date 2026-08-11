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
          options: ['iter()', 'iter_mut()', 'into_iter()', 'windows()'],
          correct: [2],
          explanation: 'into_iter takes ownership of the collection. iter and iter_mut only borrow it.',
        },
        {
          q: 'When do lazy iterator adapters actually perform work?',
          options: ['As soon as map is called', 'When a consuming operation such as collect or sum drives them', 'Only on another thread', 'At compile time'],
          correct: [1],
          explanation: 'Adapters describe a pipeline. A consumer repeatedly requests the next item and drives the chain.',
        },
        {
          q: 'Why use HashMap::entry for a counter?',
          options: ['It sorts the map', 'It combines lookup/insertion and returns mutable access to the value', 'It clones every key', 'It makes the map lock-free'],
          correct: [1],
          explanation: 'The entry API expresses insert-if-absent followed by mutation with a single table lookup.',
        },
      ],
    },
  ],
}

export default lesson
