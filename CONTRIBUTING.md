# Contributing to KromaGit

Thanks for helping. Bug reports, ideas and pull requests are all welcome, big or small.

## Before you start

- **Found a bug?** [Open an issue](https://github.com/cheakimhengg/KromaGit/issues/new/choose) with the steps to reproduce it, your OS and your KromaGit version (bottom-right of the status bar).
- **Have an idea?** Open a feature request first if it's more than a small fix, so we can agree on the approach before you spend time on it.
- **Found a security problem?** Please don't open a public issue. See [SECURITY.md](SECURITY.md).

## Setting up

You need Node 20+, [pnpm](https://pnpm.io) 10, Rust 1.82+, Git 2.36+, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/cheakimhengg/KromaGit.git
cd KromaGit
pnpm install
pnpm tauri dev          # the desktop app, with hot reload
```

To work on the interface only, `pnpm dev` runs it in the browser with demo data, so you don't need Rust.

## Where things live

| Folder | What's in it |
|---|---|
| `src/` | The Vue 3 + TypeScript interface (components, Pinia stores, the commit-graph layout) |
| `src-tauri/src/` | The Rust backend: it runs your `git` and parses its output |
| `src/mock/` | Demo data used by `pnpm dev` |
| `tests/` | Front-end tests (Vitest) |
| `src-tauri/tests/` | Rust tests, including parsers run on real `git` output |
| `site/` | The website (plain HTML and CSS) |

## Making a change

1. Fork the repo and create a branch from `main`, e.g. `fix/diff-scroll` or `feat/blame-colors`.
2. Keep the change focused on one thing. Small pull requests get reviewed faster.
3. Add or update tests when you change behaviour.
4. Run the checks before pushing:

   ```bash
   pnpm typecheck && pnpm test
   cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
   ```

5. Open a pull request and fill in the template. Screenshots or a short clip help a lot for anything visual.

## Code style

- Follow the patterns already in the file you're editing.
- Prefer clear names over comments; keep comments for the *why*, not the *what*.
- Interface text should be short and plain: say what happens, not how it works internally.
- Anything that changes the repository should be undoable or ask first.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org): `feat: …`, `fix: …`, `docs: …`, `refactor: …`, `test: …`, `chore: …`. Write the summary as what the change does, e.g. `fix: keep split diff when jumping to a line`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
