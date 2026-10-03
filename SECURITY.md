# Security policy

Vizu Four is an experimental, local-first MVP with two modules, **Debug** and
**Release**. It is not a security boundary or a sandbox. Debug's local `run:`
steps execute with the current user's privileges, so only load workflows you
trust.

The public demo is configured with `VIZU_DEMO_MODE=1`: shell execution and
host-workspace browsing are disabled, and `uses:` actions are simulated.

## Reporting a vulnerability

Please do not publish exploit details in a public issue.

Use GitHub's **Security → Report a vulnerability** flow when it is available.
If private vulnerability reporting is unavailable, open a public issue that
contains no sensitive details and asks the maintainer to establish a private
reporting channel.

Include the affected module (Debug or Release), the version or commit,
reproduction conditions, impact, and any suggested mitigation. Never include
real credentials or production data.

## Supported version

Security fixes are applied to the current default branch. No released or
long-term-support version exists yet.

## Current boundaries

### Debug

- Real local execution is unsandboxed.
- `uses:` action execution is simulated.
- Windows and macOS runner emulation is not implemented.
- Sessions are isolated per visitor by an httpOnly cookie; this is isolation,
  not authentication.
- Shared deployments must keep `VIZU_DEMO_MODE=1` until container isolation
  ([#14](https://github.com/StormDoragon/vizu-four/issues/14)) is implemented
  and reviewed.

### Release

Release Intelligence accepts only public GitHub repositories and simple refs.
Its server collector uses a fixed API origin, no credentials or redirects,
bounded responses and deadlines, and no code execution or filesystem writes.
Per-process request/concurrency limits protect the public demo; the optional
AI path shares the debugger's spend budget. See README for numerical limits.

Repository metadata and model output are untrusted. AI can only rewrite
existing eligible changes, with exact per-change evidence IDs; application
code owns source URLs and classification flags. Text is displayed as React
text or a read-only textarea, and Markdown exports escape source formatting.
Security-sensitive descriptions are withheld from exports and AI prompts.
Evidence membership is not semantic verification; all drafts require human
review. The feature does not inspect code for vulnerabilities, and its
security detection and token redaction are heuristics, not a secret scanner.

### Evaluation tooling

`scripts/release-eval-worksheet.mjs` is a maintainer tool, not part of the
deployed app. Run it on a trusted machine. It reads public GitHub data and is
unauthenticated unless `GITHUB_TOKEN` is set; the token is only sent to
`api.github.com`, never to the loopback test API. Completed worksheets are
untrusted data: they are masked and flag-checked on import, and a review
record is a pointer that the tooling cannot verify.

See [DEPLOY.md](./DEPLOY.md), [PRIVACY.md](./PRIVACY.md), and the README
security section for operational details and remaining limitations.
