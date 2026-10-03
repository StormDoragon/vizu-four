# Vizu Four — Debug & Release Intelligence

Vizu has two modules:

- **Debug** (`/`) — a visual, step-through debugger for GitHub Actions
  workflows: set breakpoints on steps, inspect every context (`github`, `env`,
  `vars`, `secrets` (masked), `matrix`, `needs`, `steps`, `runner`, `job`,
  `inputs`), explore matrix combinations, edit values with What-If, and run
  `run:` steps for real in a local scratch workspace — no push, no waiting on
  a runner.
- **Release** (`/release`) — evidence-backed technical and customer release
  drafts from a public GitHub repository's commit range. Every included change
  links back to the commits, PRs, and files it came from, and nothing is
  published automatically.

This repository implements the **MVP slice** of a much larger product
blueprint. See [Scope](#scope) below for exactly what's built versus what
would come later, and [ROADMAP.md](./ROADMAP.md) for the prioritized checklist
of what's next.

Before using or deploying it, read [SECURITY.md](./SECURITY.md),
[PRIVACY.md](./PRIVACY.md), and [DEPLOY.md](./DEPLOY.md). Do not enter
production secrets or confidential workflow data into the public demo or a
share link.

## Status (October 2026)

| Layer | State |
|-------|--------|
| **Debug MVP** | Shipped end-to-end (graph, breakpoints, matrix lanes, expression playground, What-If, mocks, time-travel, share links, themes). |
| **Release MVP** | Merged on the default branch ([#33](https://github.com/StormDoragon/vizu-four/pull/33)): bounded public GitHub collection, deterministic classification, technical/customer notes, opt-in AI wording with deterministic fallback. |
| **Release evaluation** | Harness and a 177-case **synthetic** corpus in `src/lib/release/eval/` ([#34](https://github.com/StormDoragon/vizu-four/pull/34)–[#37](https://github.com/StormDoragon/vizu-four/pull/37)). No maintainer-reviewed real range exists yet; the labels in `labeling/` are AI-drafted and not a human review. Synthetic results are not evidence of real-world accuracy. |
| **Public demo** | [vizu-four.onrender.com](https://vizu-four.onrender.com) — **`VIZU_DEMO_MODE=1`** (`/api/config` → `{"simulationOnly":true}`). Real `run:` and host workspace browse are off. |
| **Hardening** | First audit pass (28 findings) plus a follow-up security review (**8 findings**) are **merged** on the default branch (`53a34a6`, regression `63eb857`). |
| **Live re-checks** | Demo-compatible findings re-probed over HTTP: YAML bomb rejected, secret-as-key masked, expression response budget held, oversized `event`/secrets rejected, pending-step `env` matches the playground, non-owner sessions → 404. |
| **Still open for formal sign-off** | Confirm Render deploy SHA in the dashboard; re-run full local `npm test` / typecheck / lint / build on a clean machine; real-execution masking tests need a local (non-demo) process; live GitHub and paid Anthropic behavior for Release need separate integration checks. Container isolation ([#14](https://github.com/StormDoragon/vizu-four/issues/14)) remains a **hard prerequisite** before any shared host re-enables `run:`. |

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

For Release, open **Release** in the navigation (or go to `/release`) and
enter a public repository with a base and head ref.

Requires Node.js 20+ and a Unix-like shell (`bash`) on PATH — `run:` steps
are executed with `bash --noprofile --norc -eo pipefail`, matching GitHub's
own default. Windows/macOS runner emulation isn't implemented (see Scope).

## Debug

Paste a workflow or pick a bundled example from `examples/workflows/`, then
step through it:

- **Workflow graph** of jobs and `needs`, with one lane per matrix combination.
- **Breakpoints** on steps, plus step / continue / time-travel through past
  states.
- **Context inspector** for every context, with secrets masked.
- **Matrix explorer** for `strategy.matrix` expansion, including
  `include`/`exclude`.
- **Expression playground** using the same expression engine as execution.
- **What-If** editing of env, vars, and secrets, and **mock outputs**
  for `uses:` steps (simulated, not executed).
- **Failure explanation** — heuristic by default, optionally a live Claude
  explanation when an operator configures `ANTHROPIC_API_KEY`.
- **Share links**, opt-in local **workspace** browsing, and light/dark
  **themes**.

### Simulation-only mode (`VIZU_DEMO_MODE=1`)

Set `VIZU_DEMO_MODE=1` and **no `run:` step is ever spawned**. Mocks still
apply (how the demo shows failures). Workspace browse of the host is disabled.
Session creation is rate-limited. See [DEPLOY.md](./DEPLOY.md).

## Release Intelligence

Open **Release** in the navigation (`/release`). Enter `owner/repository` or
an HTTPS GitHub repository URL, a base tag/branch/SHA, and a head ref. Click
**Analyze release**, inspect included and excluded changes and their sources,
then switch between **Technical** and **Customer** notes and copy Markdown.
Nothing is automatically published.

`POST /api/releases/analyze` accepts only:

```json
{"repository":"owner/repository","base":"v1.0.0","head":"main","useAi":false}
```

The server resolves refs to immutable SHAs, checks that the repository is
public, and uses GitHub's compare and commit-associated PR APIs. It sends no
GitHub credentials, follows no redirects, downloads no repository, and runs
no repository code. Links are constructed from collected SHAs, PR numbers,
and file paths, never taken from model output. Removed files link to base;
other files link to head. Files are comparison-level evidence, not evidence
attributed to an individual commit.

One canonical analysis contains each change's category, impact, importance,
confidence, securitySensitive, breakingChange, releaseWorthy, reason, and
evidence. Deterministic conventional-commit/merged-PR-title rules distinguish
features, fixes, performance, docs, internal maintenance, and unknown changes.
Simple Add/Fix/Improve-style titles also qualify, with lower confidence;
CI, test, build, and tooling scopes remain internal unless flagged for review.
Unknown items are retained for review but excluded from notes. Explicit
breaking and security signals override maintenance filtering. Both audiences
are derived from that analysis. Security-sensitive descriptions are withheld
from exports and AI prompts; technical notes retain a review placeholder.

AI wording is **opt-in per request**. If `ANTHROPIC_API_KEY` is configured,
eligible public titles are sent to Anthropic. Release shares Debug's
`VIZU_AI_MAX_CALLS_PER_WINDOW`, `VIZU_AI_MAX_CONCURRENT`,
`VIZU_AI_TIMEOUT_MS`, and `ANTHROPIC_MODEL` configuration. Release caps the
AI deadline at 20 seconds, disables provider retries, and caps output at
4096 tokens. Untrusted output must match the expected shape, exact change
membership, bounded strings, and evidence IDs belonging to the same change.
It cannot set flags, categories, release-worthiness, or URLs. No key, exhausted
budget, timeout, incomplete output, or failed validation yields deterministic
notes with a visible explanation instead.

### Release limits and caveats

- At most **40 commits**, with head descending from base. Larger, divergent,
  and incomplete comparisons fail explicitly; use a smaller range. Revision
  expressions and cross-repository comparisons are unsupported.
- At most **14 GitHub calls** per analysis: repository check, two ref lookups,
  comparison, and PR enrichment for the **first 10 commits**. Each association
  reads at most 10 PRs. Only a merged, same-repository PR whose merge SHA is
  the collected commit can supply its title. Enrichment failure is visible;
  direct commits still work. Multiple commits from a PR are not grouped.
- GitHub collection has a **15-second total deadline**, **2 MiB per response**,
  no retries, and at most **300 comparison files**. Potential file/PR
  truncation is disclosed. Commit messages are capped at 1200 characters and
  PR titles at 300, with warnings about omitted context. Security/breaking
  signals are detected before truncation. Large diff responses can hit the byte limit even
  with fewer than 40 commits; file patches are discarded, not analyzed.
- Release has independent limits: **5 requests/visitor**, **10/address**, and
  **20/instance per 10 minutes**, with **2 concurrent analyses**, **8 KiB
  request bodies**, and a **5-second body-read deadline**. Limits are in-memory
  per process; multi-instance deployments need a shared limiter. The address
  limit depends on a trusted proxy; the global cap does not. GitHub's anonymous
  allowance can be exhausted sooner and produces an actionable error.
- Impact is inferred from metadata. Evidence verifies source membership,
  **not the truth of a claim**. AI may still misinterpret a real source.
  Conventional messages may omit important changes; unknown or misleading
  messages require manual review. Security detection and token redaction are
  heuristic, not a secret scanner. Never submit credentials.
- Deterministic customer notes remove conventional prefixes; AI can improve
  language but does not inspect diffs or establish business outcomes.
- No persistence, private repositories, GitHub App, auth, billing, webhooks,
  hosted changelog, Slack, or automatic publishing. Results live in the
  current browser view; copy them before navigating away.

The debugger's execution, ownership, consent, and secret-masking boundaries
are unchanged by Release. Public deployments still require `VIZU_DEMO_MODE=1`.

### Evaluating release classification

`src/lib/release/eval/` holds the evaluation harness, metrics, and a
**synthetic** 177-case corpus. To measure accuracy on a real public range, a
maintainer generates a blank worksheet and labels it without looking at the
classifier's output:

```bash
npm run eval:worksheet -- <owner/repo> <base-ref> <head-ref> --out src/lib/release/eval/worksheets/<name>.json
```

See [`src/lib/release/eval/README.md`](./src/lib/release/eval/README.md) for
the full labeling, review-record, and calibration/hold-out workflow, and
[ROADMAP.md](./ROADMAP.md) for current synthetic measurements. Files in
`labeling/` are AI-drafted judgments for one range of this repository; they
are not a maintainer review and are not loaded as reviewed data.

## Verification

CI runs the entire typecheck, lint, and Vitest suite on Ubuntu with Node 22.
It also builds on Node 20, matching the runtime pinned in `render.yaml`.
Both jobs start the production server and run `node scripts/production-smoke.mjs`
after `npm run build`. This checks Release collection, canonical evidence,
both note outputs, no-key fallback, and Debug session ownership and demo
simulation through real HTTP routes. A test-only Node preload supplies fixed
GitHub API responses, so CI requires neither credentials nor live API quota.
Live GitHub and paid Anthropic behavior still need separate integration checks.
Release tests cover LF/CRLF metadata and case-sensitive, Unicode, and escaped
GitHub paths without using the host filesystem's path conventions. The full
test suite needs Node 22+ and Bash; Node 20 is checked as a production runtime.

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

Release only reads public GitHub metadata through a fixed API origin, sends no
GitHub credentials, and never downloads or runs repository code. With AI
wording opted in, eligible public titles are sent to Anthropic;
security-sensitive descriptions are withheld. Treat every draft as untrusted
until a person has reviewed it.

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

## Scope

**Built — Debug:** visual debugger, real local `run:` execution, expression
engine, matrix lanes, What-If, mocks, time-travel, share links, AI/heuristic
failure explanation.

**Built — Release:** public-repository range analysis, deterministic
classification with evidence links, technical and customer Markdown notes,
opt-in AI wording, and an offline evaluation harness.

**Not built:** container action execution, GitHub run import, IDE extensions,
team/SSO/billing, Windows/macOS runner emulation; for Release, private
repositories, a GitHub App, persistence, webhooks, hosted changelogs, and
automatic publishing. Full scope notes and expression divergences remain in
git history, [docs/history.md](./docs/history.md), and
[ROADMAP.md](./ROADMAP.md).

## License

Vizu Four is available under the [MIT License](./LICENSE).
