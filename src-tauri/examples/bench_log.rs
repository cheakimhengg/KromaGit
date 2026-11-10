//! Times the read-only load path on a real repository.
//! Usage: cargo run --release --example bench_log -- /path/to/repo
use std::time::Instant;

use kromagit_lib::git::{self, runner::Git};

fn main() {
    let path = std::env::args().nth(1).expect("usage: bench_log <repo>");
    let g = Git::new(&path);

    let t = Instant::now();
    let first = git::log::get_commits(&g, Some(1500)).unwrap();
    println!("first page: {} commits in {:?}", first.len(), t.elapsed());

    let t = Instant::now();
    let all = git::log::get_commits(&g, None).unwrap();
    let load = t.elapsed();
    let t = Instant::now();
    let json = serde_json::to_vec(&all).unwrap();
    println!("full log:   {} commits in {:?}, json {:.1} MB in {:?}", all.len(), load, json.len() as f64 / 1e6, t.elapsed());

    let t = Instant::now();
    let refs = git::refs::get_refs(&g).unwrap();
    println!("refs:       {} branches, {} tags in {:?}", refs.branches.len(), refs.tags.len(), t.elapsed());

    let t = Instant::now();
    let status = git::status::get_status(&g).unwrap();
    println!("status:     {} staged, {} unstaged in {:?}", status.staged.len(), status.unstaged.len(), t.elapsed());
}
