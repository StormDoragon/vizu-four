# Actions Visual Debugger (local-first MVP)

A visual, step-through debugger for GitHub Actions workflows: set breakpoints on
steps, inspect every context (`github`, `env`, `vars`, `secrets` (masked),
`matrix`, `needs`, `steps`, `runner`, `job`, `inputs`), explore matrix
combinations, edit values with What-If, and run `run:` steps for real in a
local scratch workspace — no push, no waiting on a runner.

This repository implements the **MVP slice** of a much larger product
blueprint. See [Scope](#scope-what-this-is-and-isnt) below for exactly what's
built versus what would come later, and [ROADMAP.md](./ROADMAP.md) for the
prioritized checklist of what's next.

Before using or deploying it, read [SECURITY.md](./SECURITY.md),
[PRIVACY.md](./PRIVACY.md), and [DEPLOY.md](./DEPLOY.md). Do not enter
production secrets or confidential workflow data into the public demo or a
share link.

## Status (September 2026)

| Layer | State |
|-------|--------|
| **MVP debugger** | Shipped end-to-end (graph, breakpoints, matrix lanes, expression playground, What-If, mocks, time-travel, share links, themes). |
| **Public demo** | [vizu-four.onrender.com](https://vizu-four.onrender.com) — **`VIZU_DEMO_MODE=1`** (`/api/config` → `{"simulationOnly":true}`). Real `run:` and host workspace browse are off. |
| **Hardening** | First audit pass (28 findings) plus a follow-up security review (**8 findings**) are **merged** on the default branch (`53a34a6`, regression `63eb857`). |
| **Live re-checks** | Demo-compatible findings re-probed over HTTP: YAML bomb rejected, secret-as-key masked, expression response budget held, oversized `event`/secrets rejected, pending-step `env` matches the playground, non-owner sessions → 404. |
| **Still open for formal sign-off** | Confirm Render deploy SHA in the dashboard; re-run full local `npm test` / typecheck / lint / build on a clean machine; real-execution masking tests need a local (non-demo) process. Container isolation ([#14](https://github.com/StormDoragon/vizu-four/issues/14)) remains a **hard prerequisite** before any shared host re-enables `run:`. |

## Live demo

**[vizu-four.onrender.com](https://vizu-four.onrender.com)** — running in
`VIZU_DEMO_MODE=1` (see [DEPLOY.md](./DEPLOY.md)), so `run:` steps are
simulated rather than executed for real. Click **⚠ See a failure debugged
(one click)** on the home page for the fastest way to see what the debugger
actually does.

This runs on Render's free tier as a single persistent instance (see
[DEPLOY.md](./DEPLOY.md#render-quickstart-recommended-free-one-instance-no-card)),
which is why it's the recommended host over a serverless platform: a
serverless deployment can route requests across multiple instances, each
with its own empty copy of the in-memory session store, causing sessions to
intermittently "disappear" mid-debug. One free-tier tradeoff: the instance
spins down after ~15 minutes idle, so the first request after a quiet
period can take up to a minute to wake it back up.

(An earlier `*.vercel.app` link for this project has been paused and is no
longer live — the Render URL above is the only public demo.)

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000, paste a workflow (or click one of the bundled
examples under `examples/workflows/`), and click **Start Debugging**. Or
click **⚠ See a failure debugged (one click)** to skip straight to a real
failed step with no setup — it works the same way in a `VIZU_DEMO_MODE=1`
deployment as it does locally, since the failure is a mocked step result
rather than something that depends on `run:` actually executing.

Requires Node.js 20+ and a Unix-like shell (`bash`) on PATH — `run:` steps
are executed with `bash --noprofile --norc -eo pipefail`, matching GitHub's
own default. Windows/macOS runner emulation isn't implemented (see Scope).

## What you can do

See the full feature list in the repository (graph, breakpoints, context
inspector, matrix explorer, expression playground, What-If, mocks, workspace
opt-in, time-travel, failure explanation, themes, share links).

## Security note

`run:` steps execute as real local processes with your own shell privileges —
same trust model as running the script yourself or using `act`. Don't debug a
workflow you don't trust. Secrets from What-If never leave the server process
and are masked in every log/output/context sent to the browser.

A debugged step's environment is **not** a copy of the debugger's
`process.env` — only a small allowlist is passed through, plus workflow
`env:` / `$GITHUB_ENV` / What-If.

Sessions are scoped to an anonymous per-visitor **httpOnly** cookie. Session
routes answer **404** (not 403) on ownership mismatch.

**That is isolation, not authentication.** Deploying publicly with real
execution requires sandboxing or disabling `run:` — the public demo runs with
execution **off** (`VIZU_DEMO_MODE=1`).

Workflow and debugging data can exist in server memory and browser storage,
and share links are self-contained and reversible. Optional live failure
explanations may send masked failure context to Anthropic when an operator
configures an API key. See [PRIVACY.md](./PRIVACY.md) for the current data-flow
and retention details.

### Hardening summary (latest)

1. **Initial audit / hardening** — concurrency, validation, ownership, rate
   limits, path confinement, env allowlist, mask-before-truncate, demo
   isolation (see [ROADMAP.md](./ROADMAP.md)).
2. **Follow-up security review (8 findings, merged)** —
   [#31](https://github.com/StormDoragon/vizu-four/pull/31) / `53a34a6`,
   regression `63eb857`:
   - Mask secrets used as **object keys** (not only values)
   - Reject YAML **alias/anchor amplification** (“YAML bomb”)
   - **Cross-stream** secret masking in combined stdout/stderr capture
   - Cap **StreamMasker** hold-back buffer
   - Enforce expression-evaluate **response budget**
   - Bound accumulated session state (`event`, nested inputs, scalars,
     retired-secret history)
   - Align expression playground **pending-step `env:`** with the inspector
   - Bound each Claude explanation with a single **`AbortSignal`**

**Residual:** unsandboxed local `run:`; opt-in real working tree (local only);
arbitrary workflow `shell:`; shared-host real execution needs
[#14](https://github.com/StormDoragon/vizu-four/issues/14). See
[DEPLOY.md](./DEPLOY.md) before any public deploy.

## Simulation-only mode (`VIZU_DEMO_MODE=1`)

Set `VIZU_DEMO_MODE=1` and **no `run:` step is ever spawned**. Mocks still
apply (how the demo shows failures). Workspace browse of the host is disabled.
Session creation is rate-limited. See [DEPLOY.md](./DEPLOY.md).

## Scope

**Built:** visual debugger, real local `run:` execution, expression engine,
matrix lanes, What-If, mocks, time-travel, share links, AI/heuristic failure
explanation.

**Not built:** container action execution, GitHub run import, IDE extensions,
team/SSO/billing, Windows/macOS runner emulation. Full scope notes and
expression divergences remain in git history and [ROADMAP.md](./ROADMAP.md).

## License

Vizu Four is available under the [MIT License](./LICENSE).
