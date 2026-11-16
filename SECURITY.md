# Security policy

## Supported versions

Security fixes go into the latest release. KromaGit updates itself (Settings → Updates), so please update before reporting.

## Reporting a problem

Please **don't open a public issue** for security problems.

Report them privately through GitHub instead: go to the repository's **Security** tab and click **Report a vulnerability**. Include:

- what the problem is and what someone could do with it,
- steps to reproduce it,
- your OS and KromaGit version.

You'll get a reply within a few days. Once the problem is fixed and released, you're welcome to be credited in the release notes.

## What's in scope

KromaGit runs on your computer and has no server, so the most important areas are:

- **Code leaving your machine:** anything sent to an AI provider without the consent prompt, or secrets that slip past redaction.
- **API keys:** keys should only ever live in the OS keychain.
- **Running commands:** a repository, file name or branch name that makes KromaGit run something it shouldn't.
- **Updates:** anything that would let an unsigned or tampered update install.
