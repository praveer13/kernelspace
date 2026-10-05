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

- (o1) iter_mut(), which moves elements out so the loop body can modify them freely
- (o2) drain(..), which yields owned elements while keeping the Vec usable afterwards
- (o3) iter(), which yields each element by value, copied out of the Vec
- (o4) into_iter(), which takes the Vec by value and yields each element in turn

**Q2. When do lazy iterator adapters actually perform work?**

- (o1) As soon as map is called, which runs the closure over every element straight away
- (o2) On a background thread pool that starts as soon as the adapter is built
- (o3) When collect, sum or another consumer pulls items through the chain
- (o4) When the adapter is dropped at the end of its scope, as with other RAII cleanup

**Q3. Why use HashMap::entry for a counter?**

- (o1) It returns a copy of the stored value, so updating it never conflicts with borrowing the map
- (o2) It keeps a running count inside the map, so no separate counter variable is needed
- (o3) It locks the bucket so several threads can increment the same counter safely
- (o4) It finds or inserts the slot with a single hash lookup, then returns mutable access to the stored value

_Answers withheld: ask the learner to commit to an answer and explain it before discussing._
