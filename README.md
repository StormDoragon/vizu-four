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

- **Visual workflow graph** — jobs auto-laid-out left-to-right by `needs`
  dependency level (via `@dagrejs/dagre`, sized per job from its actual step
  count), with each job's steps listed inside it, click any step to inspect
  it. Status is never color-only: every dot pairs a color with a shape
  (a hollow ring for "hasn't run yet", filled for everything else) and a
  glyph (✓/✕/–/▶), the same mapping used in the matrix tab and step detail
  panel. A step actually executing right now gets a spinning ring, not just
  a static dot.
- **Breakpoints** — click the dot next to a step to break there; **Step**,
  **Continue**, **Run to end**, and **Run all** control execution like a
  normal debugger. "Continue" resumes and stops at the *next* breakpoint or
  failure; breakpoints and the pause-on-failure toggle only gate the active
  lane, "Run all" drives the whole graph through unconditionally.
- **Context inspector** — live, masked view of every context available to
  the step at the current position.
- **Matrix explorer** — every `strategy.matrix` combination (after
  `include`/`exclude` expansion) is its own independent, independently
  steppable lane; pick one to focus and debug. A search box appears once a
  matrix has enough combinations to need one. **"Debug this combination
  only"** (🎯, on every lane row in the job node and the Matrix tab) makes
  that lane the steppable one and dims every sibling combination, with the
  focus visible at a glance from the job node's border, the Matrix tab, and
  a dismissible top-bar badge — no engine change, purely a client-side view
  preference.
- **Expression playground** — evaluate any `${{ }}`-free expression against
  the active lane's real, current context, with a full evaluation-steps
  breakdown below the result: every sub-expression's own value, in
  evaluation order; which context values it referenced (e.g.
  `steps.*.outputs.result`); a note when `==`/`!=`/a relational comparison
  coerced mismatched types; the untaken side of `&&`/`||` shown as
  short-circuited rather than a fabricated result; and, for a nested call
  like `contains(fromJSON(x), y)`, the failure pinned to the exact call that
  caused it, not just a whole-expression error.
- **What-If** — override env vars, `vars`, or provide local secret values at
  any point; takes effect on the next step you run, no commit needed.
- **Mock a step** — stub any step's outputs, and optionally give it a
  non-zero exit code and canned stderr. Works on `uses:` steps (always
  simulated anyway) and on `run:` steps, where **a mocked step is not
  executed** — the mock decides its result outright. That's how you stub out
  a slow or destructive command, and how you reach the failure paths
  (`continue-on-error`, `if: failure()`, the explanation panel) without
  having to write a workflow that genuinely breaks.
- **Open a workflow from the repo** — enter a directory on the machine
  running the debugger and list its `.github/workflows/*.yml` files with
  one click to load. Separately, an **explicit opt-in** lets that session's
  `run:` steps execute against that real directory instead of a disposable
  scratch workspace — the only way to debug a workflow that actually reads
  or writes repo files (`npm ci`, `pytest`, etc). Off by default; see
  [Real working-tree access](#real-working-tree-access) below.
- **Time-travel** — a bar above the step detail panel shows a `LIVE`/
  `HISTORY` badge and Prev/Next controls to scrub through any step a lane
  has already reached, without disturbing what Step/Continue/Run actually
  act on (always the active lane's live cursor). "History" covers browsing
  an earlier step in the active lane *or* a different lane entirely — e.g.
  after "Run all" fails a matrix lane that isn't the active one — with a
  "Jump to live" button to snap back.
- **Failure explanation** — a step that fails gets a heuristic root-cause
  analysis for free (pattern-matched against exit code/stdout/stderr); if
  `ANTHROPIC_API_KEY` is set in the environment, it upgrades to a live
  Claude call instead (same interface, richer answer, graceful fallback on
  any error).
- **Light/dark theme** — a toggle in the top bar (☾/☀) flips the whole app;
  the choice persists per-browser (`localStorage`) and is applied by an
  inline script before hydration, so a returning visitor never sees a flash
  of the wrong theme. Every color is a CSS custom property, not a hardcoded
  hex, so both themes share the same status-color semantics (success is
  still green, failure still red) recalibrated for contrast against their
  own background. Dark is unchanged from before this existed.
- **Responsive down to tablet width** — the graph/right-panel row and the
  step detail panel's two-column layout stack vertically (each independently
  scrollable) below `lg`, instead of clipping a fixed-width panel against a
  squeezed graph.

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
  include/exclude example, the object-filter (`.*`) examples from GitHub's
  own docs, expressions pulled from real, currently-running public
  workflows (`actions/checkout`, `git/git`), and the well-known "mixed
  `${{ }}` is always truthy" `if:` footgun), but the blueprint itself
  correctly flags "expression/runner fidelity gaps" as an ongoing
  investment area requiring parity testing against real runners — that
  continues to be true here. See "Confirmed expression-engine divergences"
  below for the one gap this pass found and deliberately left open, plus a
  real hyphenated-identifier bug it found and fixed.

### Confirmed expression-engine divergences

- **Hyphenated job/step ids** (`needs.ci-config.outputs.x`,
  `matrix.node-version`) previously threw a syntax error — the lexer's
  identifier characters didn't include `-`, even though GitHub's own
  property-dereference grammar does, specifically because job and step ids
  are conventionally kebab-case. **Fixed**, not just documented: confirmed
  against `git/git`'s own CI workflow, which relies on exactly this
  pattern (`needs.ci-config.outputs.enabled == 'yes'`).
- **Numeric string coercion is JavaScript's, not GitHub's.** GitHub's
  documented type-coercion table specifies a string is "parsed from any
  legal JSON number format, otherwise `NaN`." JSON's number grammar is
  stricter than JavaScript's `Number()`: no hex literals, no leading `+`,
  no leading zeros ahead of a nonzero digit. This engine's `toNumber()`
  uses `Number()` directly, so `'0x10' == 16`, `'+5' == 5`, and
  `'007' == 7` all evaluate `true` here, where a real runner would treat
  each left-hand string as `NaN` and get `false`. Left as a documented,
  test-locked divergence (see `evaluator.test.ts`) rather than fixed in
  this pass — real workflows essentially never compare against a hex or
  leading-zero string, and rewriting the coercion grammar is a bigger,
  more deliberate change than this pass's scope of adding test breadth.

## Security note

`run:` steps execute as real local processes with your own shell
privileges — this is the entire point (a faithful local runner), and it's
the same trust model as running the script yourself or using `act`. Don't
debug a workflow you don't trust. Secrets you provide via What-If never
leave the server process and are masked in every log/output/context sent to
the browser; they're never written to disk.

For convenience the debugger does remember some state per workflow in the
browser's `localStorage`: your breakpoints, env overrides, `vars`, and the
pause-on-failure setting, keyed by a hash of the workflow source. **Secret
values are deliberately excluded** — the browser never receives them in the
first place, so only a secret's *name* is remembered, and it comes back as
an empty row for you to re-enter. Turn the whole thing off (and clear what's
stored for that workflow) with the checkbox at the bottom of the What-If
panel.

A debugged step's process environment is **not** a copy of the debugger
server's own `process.env` — only a small allowlist is passed through
(`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `LC_ALL`,
`TZ`, `TERM`, `TMPDIR`, `TEMP`, `TMP`), plus whatever the workflow itself
sets via `env:`/`$GITHUB_ENV`/What-If. Otherwise a workflow being debugged
could read and print (and thus exfiltrate into the browser) secrets that
belong to the debugger process itself rather than to the workflow — for
example the `ANTHROPIC_API_KEY` used by the optional failure-explanation
feature.

Sessions are scoped to an anonymous per-visitor cookie. Every
`/api/sessions/[id]` route checks it — as does the expression evaluator,
which takes a session id in its request body — and answers `404` rather than
`403` on a mismatch, so a probe can't use the response to confirm that an id
exists. Knowing a session id is therefore not enough to read or drive it.

**That is isolation, not authentication, and it does not make this safe to
deploy publicly.** There are no accounts: the cookie is an anonymous bearer
token, so whoever holds it is that visitor. More importantly, `run:` steps
still execute with the server process's own shell privileges — on a shared
host, any visitor could run code as the server. Deploying this beyond your
own machine requires `run:` execution to be sandboxed or disabled first; the
next section is how to disable it.

## Simulation-only mode (`VIZU_DEMO_MODE=1`)

Set `VIZU_DEMO_MODE=1` and **no `run:` step is ever spawned**. Each one
reports success without executing, showing the fully-interpolated command
instead — which is most of what a debugger is for, since interpolation is
where the expression engine does its work. Everything else behaves exactly
as it does locally: expressions, matrix expansion, `if:` conditions,
`needs`, breakpoints, the context inspector, What-If.

This is the mode a shared deployment should run in. It's off by default, so
running locally is unaffected; a production build with execution still on
logs a warning at startup.

Two things to know:

- Mocks still apply, and are how a simulation-only demo shows a failure: mock
  a `run:` step with a non-zero exit code and it fails for real as far as the
  rest of the engine is concerned.
- The UI says so. A banner marks the session and every simulated step is
  badged, so a simulated success is never mistaken for a real one.

Session creation is rate-limited per visitor regardless of mode (30 per 10
minutes, 25 live sessions), since each session holds a workspace and a temp
directory.

## Real working-tree access

By default every session's workspace is a disposable `mkdtemp` scratch
directory — safe to throw away, but empty, so a real workflow's `npm ci`,
`pytest`, or anything that touches repo files fails for reasons that have
nothing to do with the workflow itself.

From the home page, **"Open a workflow from the repo"** lets you enter a
directory on the machine running the debugger and lists its
`.github/workflows/*.yml` files for one-click loading. That alone changes
nothing about execution — it's just a faster way to get YAML into the
textarea, same as pasting it.

A separate checkbox, shown only after a successful browse, is the actual
opt-in: **"Run this session's `run:` steps against `<directory>` instead of
a scratch workspace."** Checking it and starting a session means:

- `workspaceDir`, `github.workspace`, and `$GITHUB_WORKSPACE` are that real
  directory, not a temp copy.
- Unmocked `run:` steps execute for real against the files there — this is
  not a scratch copy, and there is no undo. The debugger's own scratch
  space (simulated-action artifacts, `$RUNNER_TEMP`) still lives under a
  temp dir, never inside your repo, but anything your workflow's own
  commands do to that directory is real.
- Ending the session **never** deletes that directory — only the disposable
  scratch-workspace path is ever reclaimed.

This is disabled entirely — both the directory browser and the opt-in — in
[simulation-only deployments](#simulation-only-mode-vizu_demo_mode1),
alongside `run:` execution itself: a shared deployment has no business
letting a visitor enumerate paths on the host, even with execution off.

## Testing

```bash
npm test        # vitest — expression engine, matrix expansion, workflow
                 # parsing/graph, execution engine, failure heuristics,
                 # and React component tests (Testing Library + jsdom)
npm run lint     # eslint (eslint-config-next); next lint was removed in Next 16
npm run typecheck
npm run build
```

Component tests live alongside their component (`ContextInspector.test.tsx`
next to `ContextInspector.tsx`) and opt into a DOM with a
`// @vitest-environment jsdom` docblock at the top of the file - the default
environment stays plain `node` for the much larger engine/lib suite, which
is faster and closer to how that code actually runs (a server route, not a
browser).
