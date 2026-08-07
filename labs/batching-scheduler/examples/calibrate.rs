//! calibrate — race naive baselines against your scheduler on the same
//! deterministic scenarios the checks use.
//!
//!     cargo run --example calibrate
//!
//! Add your own policy to the race: write a fn like the two below, then
//! add it to the `policies` list in main. (The reference policy passes
//! all six checks; these two each fail at least one — figure out why.)

use batching_scheduler as lab;
use lab::{Action, State};

fn fit(s: &State, order: &mut Vec<&lab::ReqView>) -> Action {
    let mut used: u32 = s.running.iter().map(|r| r.prompt_tokens + r.decoded).sum();
    let mut slots = s.max_running - s.running.len();
    let mut admit = vec![];
    for r in order.drain(..) {
        if slots == 0 { break }
        if used + r.prompt_tokens > s.mem_cap { continue }
        admit.push(r.id); slots -= 1; used += r.prompt_tokens;
    }
    Action { admit, preempt: vec![] }
}

/// First-come-first-served, admit while anything fits.
fn fcfs(s: &State) -> Action { fit(s, &mut s.waiting.iter().collect()) }

/// Smallest-prompt-first, no aging. Watch what happens to the longs.
fn sjf(s: &State) -> Action {
    let mut w: Vec<_> = s.waiting.iter().collect();
    w.sort_by_key(|r| r.prompt_tokens);
    fit(s, &mut w)
}

fn main() {
    let scns = [lab::scn_light(), lab::scn_burst(), lab::scn_convoy(), lab::scn_starvation(), lab::scn_fleet()];
    let policies: [(&str, fn(&State) -> Action); 2] = [("fcfs", fcfs), ("sjf", sjf)];
    for scn in &scns {
        for (name, pol) in &policies {
            let mut p = *pol;
            match lab::simulate(scn, &mut p) {
                Ok(s) => println!(
                    "{:>10} {:>9}: goodput {:5.1}%  met {}/{}  completed {}  ttft_p95 {}",
                    scn.name, name, s.goodput() * 100.0, s.slo_met, s.total, s.completed, s.ttft_p95
                ),
                Err(e) => println!("{:>10} {:>9}: ILLEGAL — {}", scn.name, name, e),
            }
        }
    }
}
