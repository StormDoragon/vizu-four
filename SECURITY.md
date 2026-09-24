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

- Real local execution is unsandboxed.
- `uses:` action execution is simulated.
- Windows and macOS runner emulation is not implemented.
- Shared deployments must keep `VIZU_DEMO_MODE=1` until container isolation is
  implemented and reviewed.

See [DEPLOY.md](./DEPLOY.md) and the README security section for operational
details and remaining limitations.
