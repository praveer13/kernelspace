/**
 * Seeded randomness shared by every multiple-choice surface (PLAN-100X §5.1 V1)
 * and, later, by graded seeds (§5.2 S3). Integer-only arithmetic, so the same
 * seed yields the same sequence in every browser.
 */

/** splitmix32: a small, fast, well-distributed 32-bit PRNG returning [0, 1). */
export function splitmix32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x9e3779b9) | 0
    let t = a ^ (a >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    t = t ^ (t >>> 15)
    return (t >>> 0) / 4294967296
  }
}

/**
 * Fisher–Yates permutation of [0, n) for this seed.
 * `order[displayPosition] = authoredIndex`: render `order.map(...)`, label options
 * by display position, and grade by the authored index, so authored `correct`
 * indices never change.
 */
export function shuffledOrder(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  const rand = splitmix32(seed)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = order[i]
    order[i] = order[j]
    order[j] = tmp
  }
  return order
}

/** A fresh 32-bit seed for a new attempt. */
export function freshSeed(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0]
}
