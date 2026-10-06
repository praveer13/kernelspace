//! The browser and these tests run the same six checks (see src/lib.rs).
//! `cargo test` failing here = the site would fail too. One source of truth.
//!
//! Each check runs on its default seed, and every seeded check also runs on
//! 32 extra seeds, so a solution green here is green on the site's fresh seeds.

use radix_cache as lab;

macro_rules! lab_test {
    ($name:ident) => {
        #[test]
        fn $name() {
            let c = lab::LAB.run_check(stringify!($name), None).expect("check id is in CHECKS");
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(exact_match);
lab_test!(longest_prefix);
lab_test!(eviction_order);
lab_test!(block_conservation);
lab_test!(cow_divergence);
lab_test!(chat_hit_rate);

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

/// The `ks_invoke` bridge the Fleet's prefix router drives. It calls your cache, so on the template
/// every verb traps ("not implemented yet") like an unfinished check; with a working cache it answers
/// exactly as `labs/README.md` documents.
fn ids(start: u32, len: u32) -> String {
    (start..start + len).map(|i| i.to_string()).collect::<Vec<_>>().join(",")
}

#[test]
fn bridge_answers_reset_insert_and_match() {
    assert!(lab::invoke("insert 1,2,3").starts_with("err"), "a verb before reset is an error");
    assert_eq!(lab::invoke("reset"), "ok");
    assert_eq!(lab::invoke("match 1,2,3"), "0", "a fresh cache matches nothing");

    let doc = format!("{},{}", ids(1_000, 32), ids(2_000, 16));
    assert_eq!(lab::invoke(&format!("insert {doc}")), "ok 1");
    assert_eq!(lab::invoke(&format!("match {doc}")), "48", "an exact prompt matches in full");
    assert_eq!(lab::invoke(&format!("insert {doc}")), "ok 1", "a duplicate is a touch, not a second entry");

    // another branch off the same 32-token system prompt
    let chat = format!("{},{}", ids(1_000, 32), ids(3_000, 12));
    assert_eq!(lab::invoke(&format!("insert {chat}")), "ok 2");
    let query = format!("{doc},{}", ids(9_000, 11));
    assert_eq!(lab::invoke(&format!("match {query}")), "48", "the deepest cached ancestor wins");
    assert_eq!(lab::invoke(&format!("match {},{}", ids(1_000, 32), ids(4_000, 5))), "32", "the shared prefix");
    assert_eq!(lab::invoke(&format!("match {}", ids(77_000, 20))), "0", "an unrelated prompt misses");
    assert_eq!(lab::invoke("match"), "0", "no ids is an empty prompt");

    assert_eq!(lab::invoke("reset"), "ok");
    assert_eq!(lab::invoke(&format!("match {doc}")), "0", "reset clears the cache");
}

#[test]
fn bridge_evicts_to_make_room() {
    assert_eq!(lab::invoke("reset"), "ok");
    // 1,024 blocks of 16 tokens: forty 512-token prompts want 1,280 blocks, so leaves must go
    let mut entries = 0;
    for i in 0..40u32 {
        let reply = lab::invoke(&format!("insert {}", ids(100_000 * (i + 1), 512)));
        entries = reply.strip_prefix("ok ").unwrap_or_else(|| panic!("insert {i}: {reply}")).parse::<usize>().unwrap();
    }
    assert!(entries < 40, "the pool is full after 32 prompts, so entries were evicted (got {entries})");
    assert_eq!(lab::invoke(&format!("match {}", ids(4_000_000, 512))), "512", "the newest prompt is cached");
    assert_eq!(lab::invoke(&format!("match {}", ids(100_000, 512))), "0", "the oldest prompt was evicted");
}

#[test]
fn bridge_rejects_bad_commands() {
    assert_eq!(lab::invoke("reset"), "ok");
    for cmd in ["insert", "insert 1,x,3", "insert -1", "match 1,,2", "insert 1 2", "nope", ""] {
        assert!(lab::invoke(cmd).starts_with("err"), "{cmd:?} should be an error, got {:?}", lab::invoke(cmd));
    }
    let too_long = ids(0, 1_024 * 16 + 1);
    assert!(lab::invoke(&format!("insert {too_long}")).starts_with("err"), "a prompt bigger than the pool is refused, not an eviction storm");
    assert_eq!(lab::invoke(&format!("match {}", ids(0, 4))), "0");
}

#[test]
fn bridge_probe_matches_the_function() {
    for seed in [0, 1, 7, 0xC0FFEE] {
        assert_eq!(lab::invoke(&format!("probe {seed}")), lab::probe(seed));
    }
    assert!(lab::invoke("probe x").starts_with("err"));
}
