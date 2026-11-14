#!/usr/bin/env bash
# Builds a small deterministic repository and captures real git output for the
# parser unit tests. Re-run from src-tauri/: bash tests/fixtures/make-fixtures.sh
set -euo pipefail

OUT="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 LC_ALL=C TZ=UTC
export GIT_AUTHOR_NAME="Mara Okafor" GIT_AUTHOR_EMAIL="mara@example.dev"
export GIT_COMMITTER_NAME="Mara Okafor" GIT_COMMITTER_EMAIL="mara@example.dev"
t=1700000000
tick() { t=$((t + 3600)); export GIT_AUTHOR_DATE="@$t +0000" GIT_COMMITTER_DATE="@$t +0000"; }
G() { git -c core.quotepath=false -c init.defaultBranch=main "$@"; }

cd "$WORK"
G init -q upstream.git --bare
G init -q repo
cd repo
G remote add origin ../upstream.git

tick; printf 'hello\n' > README.md; printf 'MIT\n' > LICENSE; mkdir -p src; printf 'fn main() {}\n' > src/main.rs
G add -A; G commit -qm "chore: initial commit"
tick; printf 'hello\nworld\n' > README.md; G commit -qam "docs: expand readme"
tick; G tag -a v0.1.0 -m "release 0.1.0"
G push -q origin main

G checkout -qb feature/parser
tick; printf 'pub fn parse() {}\n' > src/parser.rs; G add -A; G commit -qm "feat(parser): add parser module" -m "Body line one.
Body line two."
tick; printf 'pub fn parse() -> u8 { 1 }\n' > src/parser.rs; G commit -qam "fix(parser): return a value"
G checkout -q main
tick; printf 'fn main() { println!("hi"); }\n' > src/main.rs; G commit -qam "feat: say hi"
tick; G merge -q --no-ff feature/parser -m "Merge branch 'feature/parser'"
tick; G tag v0.2.0
G push -q origin main

G checkout -qb fix/gone
tick; printf 'x\n' > gone.txt; G add -A; G commit -qm "fix: temp branch"
G push -q -u origin fix/gone
G push -q origin --delete fix/gone
G checkout -q main
G checkout -qb "feature/ünïcode"
G checkout -q main
G branch -q --set-upstream-to=origin/main main
tick; printf 'local only\n' >> README.md; G commit -qam "chore: local ahead"

tick; G -c protocol.file.allow=always submodule add -q ../upstream.git vendor/upstream; G commit -qm "chore: add submodule"

tick; printf 'stashed\n' >> README.md; G stash push -q -m "wip readme"
G worktree add -q ../repo-hotfix -b hotfix/crlf >/dev/null 2>&1

# working copy: modified staged + unstaged, renamed, deleted, untracked, unicode
printf 'hello\nworld\nlocal only\nstaged line\n' > README.md; G add README.md
printf 'hello\nworld\nlocal only\nstaged line\nunstaged line\n' > README.md
G mv src/parser.rs src/parse.rs
G rm -q gone.txt 2>/dev/null || true
printf 'fn main() { println!("bye"); }\n' > src/main.rs
printf 'new\n' > "notes café.md"
rm LICENSE

G log --topo-order --no-color --decorate=full -z \
  --format='%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D' --branches --remotes --tags HEAD > "$OUT/log.bin"
G status --porcelain=v2 --branch -z --untracked-files=all > "$OUT/status.bin"
G diff --numstat -z -M > "$OUT/numstat_unstaged.bin"
G diff --cached --numstat -z -M > "$OUT/numstat_staged.bin"
G for-each-ref --format='%(refname)%00%(objectname)%00%(*objectname)%00%(upstream)%00%(upstream:track)%00%(HEAD)' \
  refs/heads refs/remotes refs/tags > "$OUT/refs.bin"
G remote -v > "$OUT/remotes.txt"
G submodule status > "$OUT/submodules.txt"
G stash list --format='%gd%x00%ct%x00%H%x00%P%x00%an%x00%ae%x00%gs' > "$OUT/stash.bin"
G worktree list --porcelain -z > "$OUT/worktrees.bin"
G diff --no-color --no-ext-diff -U3 -- README.md > "$OUT/diff_readme.txt"
G show -s -z --format='%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B' "$(G rev-parse feature/parser)" > "$OUT/show.bin"
G diff --name-status -z -M main~1 main > "$OUT/name_status.bin"

echo "fixtures written to $OUT"
