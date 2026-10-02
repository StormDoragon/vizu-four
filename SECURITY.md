# Security policy

Vizu Four is an experimental, local-first MVP. It is not a security boundary
or a sandbox. Local `run:` steps execute with the current user's privileges,
so only load workflows you trust.

The public demo is configured with `VIZU_DEMO_MODE=1`: shell execution and
host-workspace browsing are disabled, and `uses:` actions are simulated.

## Reporting a vulnerability

Please do not publish exploit details in a public issue.

Use GitHub's **Security → Report a vulnerability** flow when it is available.
If private vulnerability reporting is unavailable, open a public issue that
contains no sensitive details and asks the maintainer to establish a private
reporting channel.

Include the affected version or commit, reproduction conditions, impact, and
any suggested mitigation. Never include real credentials or production data.

## Supported version

Security fixes are applied to the current default branch. No released or
long-term-support version exists yet.

## Current boundaries

Release Intelligence accepts only public GitHub repositories and simple refs.
Its server collector uses a fixed API origin, no credentials or redirects,
bounded responses and deadlines, and no code execution or filesystem writes.
Per-process request/concurrency limits protect the public demo; the optional
AI path shares the debugger's spend budget. See README for numerical limits.

Repository metadata and model output are untrusted. AI can only rewrite
existing eligible changes, with exact per-change evidence IDs; application
code owns source URLs and classification flags. Text is displayed as React
text or a read-only textarea, and Markdown exports escape source formatting.
Security-sensitive descriptions are withheld from exports. Evidence membership
is not semantic verification; all drafts require human review. The feature
does not inspect code for vulnerabilities or guarantee detection of secrets.

- Real local execution is unsandboxed.
- `uses:` action execution is simulated.
- Windows and macOS runner emulation is not implemented.
- Shared deployments must keep `VIZU_DEMO_MODE=1` until container isolation is
  implemented and reviewed.

See [DEPLOY.md](./DEPLOY.md) and the README security section for operational
details and remaining limitations.
