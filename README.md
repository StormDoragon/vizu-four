# Actions Visual Debugger (local-first MVP)

A visual, step-through debugger for GitHub Actions workflows: set breakpoints on
steps, inspect every context (`github`, `env`, `vars`, `secrets` (masked),
`matrix`, `needs`, `steps`, `runner`, `job`, `inputs`), explore matrix
combinations, edit values with What-If, and run `run:` steps for real in a
local scratch workspace — no push, no waiting on a runner.

This repository implements the **MVP slice** of a much larger product
blueprint. See [Scope](#scope-what-this-is-and-isnt) below for exactly what's
built versus what would come later.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000, paste a workflow (or click one of the bundled
examples under `examples/workflows/`), and click **Start Debugging**.

Requires Node.js 20+ and a Unix-like shell (`bash`) on PATH — `run:` steps
are executed with `bash --noprofile --norc -eo pipefail`, matching GitHub's
own default. Windows/macOS runner emulation isn't implemented (see Scope).

## What you can do

- **Visual workflow graph** — jobs laid out by `needs`, with each job's steps
  listed inside it, colored by status, click any step to inspect it.
- **Breakpoints** — click the dot next to a step to break there; **Step**,
  **Continue**, **Run to end**, and **Run all** control execution like a
  normal debugger. "Continue" resumes and stops at the *next* breakpoint or
  failure; breakpoints and the pause-on-failure toggle only gate the active
  lane, "Run all" drives the whole graph through unconditionally.
- **Context inspector** — live, masked view of every context available to
  the step at the current position.
- **Matrix explorer** — every `strategy.matrix` combination (after
  `include`/`exclude` expansion) is its own independent, independently
  steppable lane; pick one to focus and debug.
- **Expression playground** — evaluate any `${{ }}`-free expression against
  the active lane's real, current context.
- **What-If** — override env vars, `vars`, or provide local secret values at
  any point; takes effect on the next step you run, no commit needed.
- **Failure explanation** — a step that fails gets a heuristic root-cause
  analysis for free (pattern-matched against exit code/stdout/stderr); if
  `ANTHROPIC_API_KEY` is set in the environment, it upgrades to a live
  Claude call instead (same interface, richer answer, graceful fallback on
  any error).

## Architecture

```
src/
  lib/
    workflow/    YAML -> typed workflow model, needs graph (topo sort + cycle
                 detection), strategy.matrix expansion (include/exclude,
                 matches GitHub's documented semantics)
    expressions/ A real GitHub Actions expression engine: lexer, recursive-
                 descent parser, evaluator with GitHub's documented type
                 coercion rules, built-in functions (contains, startsWith,
                 endsWith, format, join, toJSON, fromJSON, hashFiles,
                 success/failure/cancelled/always), and template
                 interpolation for `${{ }}` (including the `if:`-only
                 auto-wrap rule and the "mixed literal text is always
                 truthy" footgun, both replicated on purpose)
    engine/      The local runner: a `DebugSession` holds one independent
                 "lane" per (job × matrix combination); `run:` steps execute
                 as real child processes (capturing $GITHUB_OUTPUT,
                 $GITHUB_ENV, $GITHUB_PATH, $GITHUB_STEP_SUMMARY exactly as
                 GitHub's runner does); `uses:` steps are simulated (see
                 Scope); secrets are masked in every captured log/output
    ai/          Deterministic failure-explanation heuristics, with an
                 optional live Claude upgrade
  app/
    api/         Next.js route handlers exposing the engine over HTTP
                 (sessions, control, breakpoints, what-if, context,
                 explain, expression evaluation)
    debug/[id]/  The debugger UI (React Flow graph + inspector panels)
```

Everything under `lib/` is pure/server-side and has unit tests (`npm test`)
independent of the UI — the expression engine and matrix expansion in
particular are tested against GitHub's documented examples and semantics.

## Scope: what this is, and isn't

The product blueprint this was built from describes a multi-quarter product
(local *and* remote-run debugging, a proprietary high-fidelity Docker/
microVM runner, IDE extensions, team cloud sync, enterprise self-hosting,
billing, a go-to-market plan, etc.). Building all of that isn't something
one session can honestly deliver, so this repo focuses entirely on the part
of the **MVP feature table** that makes the product's core claim real: a
true visual step-through debugger with genuine expression fidelity, matrix
exploration, and safe what-if editing — not a mockup of one.

**Built:**
- Visual workflow graph, step-through debugger, breakpoints, context
  inspector, matrix explorer, expression evaluator/playground, What-If,
  failure explanation — all from the MVP table, working end-to-end against
  real execution, not sample data.
- `run:` steps execute for real (a genuine local high-fidelity runner for
  the shell-command case, which is where most real CI failures live).
- `$GITHUB_OUTPUT` / `$GITHUB_ENV` / `$GITHUB_PATH` / `$GITHUB_STEP_SUMMARY`,
  `continue-on-error` vs. `outcome`/`conclusion`, job/step `if:` gating
  (including the default-implicit `success()`), and `needs.<job>.result`
  are all implemented with real fidelity, not stubs.

**Deliberately not built** (these are the parts of the blueprint that are
genuinely multi-month efforts, or need infrastructure/accounts this session
doesn't have):
- **Container/Docker-based action execution.** `uses:` steps are simulated
  (checkout/setup-*/cache/upload-download-artifact have small built-in
  handlers; anything else no-ops as a success with empty outputs, which
  What-If can override). A real local runner needs to actually pull and run
  action containers — that's the `act`-equivalent engine the blueprint
  calls out as a multi-month investment in its own right.
- **Real-run import from the GitHub API**, time-travel over a historical
  run, and the AI PR-fix-generator — explicitly V1 items in the blueprint.
- **IDE extensions, team cloud sync, SSO, audit logs, enterprise
  self-host** — these are packaging/distribution and org-features work, not
  debugger-engine work; the engine underneath would be unchanged.
- **Windows/macOS runner emulation** — steps run in whatever shell exists on
  this machine.
- 100% expression-engine parity with GitHub's runner. The evaluator
  implements the documented grammar, precedence, and type-coercion rules
  faithfully (with tests against GitHub's own documented matrix
  include/exclude example and the well-known "mixed `${{ }}` is always
  truthy" `if:` footgun), but the blueprint itself correctly flags
  "expression/runner fidelity gaps" as an ongoing investment area requiring
  parity testing against real runners — that continues to be true here.

## Security note

`run:` steps execute as real local processes with your own shell
privileges — this is the entire point (a faithful local runner), and it's
the same trust model as running the script yourself or using `act`. Don't
debug a workflow you don't trust. Secrets you provide via What-If never
leave the server process and are masked in every log/output/context sent to
the browser; they're never written to disk.

## Testing

```bash
npm test        # vitest — expression engine, matrix expansion, workflow
                 # parsing/graph, execution engine, failure heuristics
npm run typecheck
npm run build
```
