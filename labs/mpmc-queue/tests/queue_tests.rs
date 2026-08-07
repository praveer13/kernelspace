//! The browser runs the same six checks (see src/lib.rs). This file adds
//! ONE native-only test: the real race fuzzer. It compiles only for your
//! host target (std::thread), so the wasm module never sees it.
//!
//! A Mutex-based queue will pass everything here too — behaviorally
//! correct, wrong lesson. If you reached for one, go back: the point is
//! the sequence-number protocol, and `stress_threads` is where a wrong
//! memory ordering shows up. Run it ten times before you trust a pass.

use mpmc_queue as lab;

macro_rules! lab_test {
    ($name:ident, $check:expr) => {
        #[test]
        fn $name() {
            let c = $check;
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(fifo, lab::check_fifo());
lab_test!(backpressure, lab::check_backpressure());
lab_test!(wraparound, lab::check_wraparound());
lab_test!(model_gauntlet, lab::check_model_gauntlet());
lab_test!(slot_conservation, lab::check_slot_conservation());
lab_test!(burst_model, lab::check_burst_model());

/// The race fuzzer: 4 producers × 4 consumers, 100k unique values.
/// Conservation (count + sum + xor) over a shared Queue<1024>.
#[test]
fn stress_threads() {
    use lab::Queue;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;

    const PRODUCERS: u64 = 4;
    const PER: u64 = 25_000;
    const TOTAL: u64 = PRODUCERS * PER;

    let q = Arc::new(Queue::new(1024));
    let done = Arc::new(AtomicUsize::new(0));

    let producers: Vec<_> = (0..PRODUCERS)
        .map(|p| {
            let q = Arc::clone(&q);
            let done = Arc::clone(&done);
            thread::spawn(move || {
                for i in 0..PER {
                    let v = p * PER + i + 1; // unique, nonzero
                    while q.push(v).is_err() {
                        thread::yield_now();
                    }
                }
                done.fetch_add(1, Ordering::Release);
            })
        })
        .collect();

    let consumers: Vec<_> = (0..4)
        .map(|_| {
            let q = Arc::clone(&q);
            let done = Arc::clone(&done);
            thread::spawn(move || {
                let (mut n, mut sum, mut xor) = (0u64, 0u64, 0u64);
                loop {
                    match q.pop() {
                        Some(v) => {
                            n += 1;
                            sum = sum.wrapping_add(v);
                            xor ^= v;
                        }
                        None => {
                            if done.load(Ordering::Acquire) == PRODUCERS as usize {
                                break;
                            }
                            thread::yield_now();
                        }
                    }
                }
                (n, sum, xor)
            })
        })
        .collect();

    for p in producers {
        p.join().unwrap();
    }
    let (mut n, mut sum, mut xor) = (0u64, 0u64, 0u64);
    for c in consumers {
        let (cn, cs, cx) = c.join().unwrap();
        n += cn;
        sum = sum.wrapping_add(cs);
        xor ^= cx;
    }

    let want_sum = (1..=TOTAL).fold(0u64, |a, v| a.wrapping_add(v));
    let want_xor = (1..=TOTAL).fold(0u64, |a, v| a ^ v);
    assert_eq!(n, TOTAL, "consumed {n} of {TOTAL} — items lost or duplicated");
    assert_eq!(sum, want_sum, "sum mismatch — corruption under contention");
    assert_eq!(xor, want_xor, "xor mismatch — corruption under contention");
}
