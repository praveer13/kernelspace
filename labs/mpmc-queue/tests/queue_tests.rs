//! The browser runs the same six checks (see src/lib.rs). This file adds
//! ONE native-only test: the real race fuzzer. It compiles only for your
//! host target (std::thread), so the wasm module never sees it.
//!
//! Each check runs on its default seed, and the two seeded gauntlets also run
//! on 32 extra seeds, so a solution green here is green on the site's fresh
//! seeds.
//!
//! A Mutex-based queue will pass everything here too — behaviorally
//! correct, wrong lesson. If you reached for one, go back: the point is
//! the sequence-number protocol, and `stress_threads` is where a wrong
//! memory ordering shows up. Run it ten times before you trust a pass.

use mpmc_queue as lab;

macro_rules! lab_test {
    ($name:ident) => {
        #[test]
        fn $name() {
            let c = lab::LAB.run_check(stringify!($name), None).expect("check id is in CHECKS");
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(fifo);
lab_test!(backpressure);
lab_test!(wraparound);
lab_test!(model_gauntlet);
lab_test!(slot_conservation);
lab_test!(burst_model);

/// 32 fixed seeds, spread over the u32 range (a Weyl sequence).
fn extra_seeds() -> impl Iterator<Item = u32> {
    (1..=32u32).map(|i| i.wrapping_mul(0x9E37_79B9))
}

#[test]
fn seeded_checks_pass_on_32_extra_seeds() {
    for def in lab::CHECKS.iter().filter(|c| c.seeded) {
        for seed in extra_seeds() {
            let c = lab::LAB.run_check(def.id, Some(seed)).expect("check id is in CHECKS");
            assert!(c.pass, "[{} seed {}] {} — {}", c.id, seed, c.label, c.msg);
        }
    }
}

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
