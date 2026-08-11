# R.L6 — Collections, Closures & Iterators

_Track R: Rust Zero · ~32 min · kernelspace_

> Own a sequence with Vec, index by key with HashMap, and turn loops into explicit iterator pipelines.
The Forge leans on two standard collections. **Vec<T>** owns contiguous elements and exposes slices; **HashMap<K, V>** owns keyed entries. Their methods encode ownership: inserting owned values moves them in, **get** lends a shared reference, and **get_mut** lends an exclusive one.

Closures are anonymous functions that may borrow or capture their environment. Iterator adapters accept closures and stay lazy until a consumer such as collect, sum, count, or fold requests results.

---

```rust
use std::collections::HashMap;

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
}
```

---

## Choose the iterator that matches ownership

**iter()** yields shared references, **iter_mut()** yields mutable references, and **into_iter()** consumes the collection and yields owned elements. Most confusing closure errors are really a mismatch among those three ownership modes.

Use a plain loop when it states the algorithm better. Iterators are not a performance tax; they normally optimize to the same machine code. Their advantage is compositional intent, not point-free cleverness.

---

> **[info]** HashMap's **entry(key).or_insert(value)** API performs one lookup and returns a mutable reference to the stored value. It is the idiomatic shape for counters, token tables, cache metadata, and grouped request queues.

---

## Build the Forge data paths

The [R6 Forge drill](/forge/rust-zero-r6) asks for Vec filtering, stable sorting, a frequency map, grouped accumulation through entry, closure capture, and a map/filter/fold pipeline. It directly prepares tokenizer lab 03 and batching scheduler lab 06.

---

**Q1. Which iterator consumes a Vec and yields owned elements?**
   A. iter()
   B. iter_mut()
   C. into_iter()
   D. windows()
   Answer: C — into_iter takes ownership of the collection. iter and iter_mut only borrow it.

**Q2. When do lazy iterator adapters actually perform work?**
   A. As soon as map is called
   B. When a consuming operation such as collect or sum drives them
   C. Only on another thread
   D. At compile time
   Answer: B — Adapters describe a pipeline. A consumer repeatedly requests the next item and drives the chain.

**Q3. Why use HashMap::entry for a counter?**
   A. It sorts the map
   B. It combines lookup/insertion and returns mutable access to the value
   C. It clones every key
   D. It makes the map lock-free
   Answer: B — The entry API expresses insert-if-absent followed by mutation with a single table lookup.
