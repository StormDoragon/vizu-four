# Security policy

## Reporting a vulnerability

Report privately. Don't open a public issue for a vulnerability.

1. Use GitHub's private vulnerability reporting: go to the repository's
   **Security** tab, choose **Report a vulnerability**, or open
   https://github.com/StormDoragon/vizu-four/security/advisories/new
2. If that option isn't available, open an issue titled "Security contact
   request" with **no details**, and the maintainer will arrange a private
   channel.

Include what you found, the steps to reproduce it (a workflow or request
sequence is ideal), and the impact you expect. This is a personal project
with no bug bounty. Reports are handled on a best-effort basis. Please allow
reasonable time for a fix before disclosing publicly.

## Supported versions

Only the latest commit on the default branch, and the public demo
(https://vizu-four.onrender.com) that is deployed from it.

## What counts

The public demo runs in simulation-only mode (`VIZU_DEMO_MODE=1`), so the
following are in scope there:

- running a `run:` step, or any other code, on the server
- reading or listing files on the host
- opening, changing or observing another visitor's session
- getting a secret value back in any response, log, share link or AI request
  without it being masked
- getting around the rate limits or the AI budget in a way that runs up the
  operator's costs
- taking the instance down, or making it unresponsive, with a small number
  of requests

The same classes of issue count for a local install where they cross a
boundary the app claims to keep: for example, a step escaping its
`working-directory` confinement, a secret reaching output or the AI provider
unmasked, or a shared link replaying steps before its recipient consents.

## Known trade-offs (not vulnerabilities)

These are documented behavior. Reports that only restate them will be
closed:

- **Local `run:` execution.** Without `VIZU_DEMO_MODE`, `run:` steps execute
  real shell commands with your user's privileges, the same trust model as
  running the script yourself. Only debug workflows you trust. A shared link
  asks before replaying anything.
- **Deploying with execution on.** Running a shared or public instance
  without `VIZU_DEMO_MODE=1` exposes shell execution to anyone who can reach
  it. [DEPLOY.md](./DEPLOY.md) says not to.
- **Share links are readable.** A share link contains its workflow, mocks
  and overrides, encoded but not encrypted. See [PRIVACY.md](./PRIVACY.md#share-links).
- **Isolation, not authentication.** A session belongs to an anonymous
  cookie. There are no accounts.
- **Best-effort per-visitor limits.** Per-visitor rate limits are keyed on a
  cookie the visitor can discard and on the forwarded client address. The
  global limits are the real bound. See
  [DEPLOY.md](./DEPLOY.md#abuse-limits-and-what-they-actually-assume).
- **Volumetric load.** Plain request floods against the free-tier host.

## Past reviews

Three review passes (a first audit, a follow-up security review and a full
file-by-file sweep) and their fixes are summarized in
[ROADMAP.md](./ROADMAP.md).
