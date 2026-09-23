# Project history — `vizu-four`

A complete record of work on the Actions Visual Debugger, beginning to end.

> **Snapshot.** This file stops at the end of Phase 4, when the branch
> `claude/intelligent-gauss-ddn9nu` had **38 commits**, 9,260 lines of TS/TSX
> across 74 files, and **202 tests** in 15 files, all passing. It isn't kept
> current. Later work (the follow-up security review in
> [#31](https://github.com/StormDoragon/vizu-four/pull/31), the full sweep in
> [#32](https://github.com/StormDoragon/vizu-four/pull/32), and everything
> since) is in [ROADMAP.md](../ROADMAP.md) and the pull request history.

---

## Phase 0 — Build the MVP (`d68ddd1`)

A visual step-through debugger for GitHub Actions workflows, built from scratch as a Next.js 16 / TypeScript / Tailwind app.

| Layer | What was built |
|---|---|
| `lib/workflow/` | YAML → typed workflow model; `needs` graph with topological sort + cycle detection; `strategy.matrix` expansion with `include`/`exclude` following GitHub's documented semantics |
| `lib/expressions/` | A real expression engine — hand-written lexer → recursive-descent parser → evaluator, with GitHub's coercion rules and function library |
| `lib/engine/` | Execution engine + debug session model. The "lane" abstraction: one independently steppable lane per (job × matrix combo), keyed `${jobId}::${comboKey}` |
| `lib/ai/` | Failure explanation — heuristic pattern-matching for free, upgrading to a live Claude call when `ANTHROPIC_API_KEY` is set, with graceful fallback |
| `app/api/` | 11 routes wiring the engine to HTTP |
| `components/` | Workflow graph (React Flow), context inspector, matrix explorer, expression playground, step detail panel, debugger controls |

Plus 5 example workflows and a README stating MVP scope honestly.

## Phase 1 — First P0 features

- **#2 — `uses:` simulators** (`83ae395`, merged via PR #7): `actions/checkout`, `setup-node`, `setup-python`, `cache`, `upload`/`download-artifact`, `docker/login-action`. Follow-ups masked secrets in the `simulationNote` (`95cdb68`) and corrected the checkout note to say *empty scratch workspace*, not the real repo (`bb9df1e`) — the first of several honesty corrections.
- **#3 — Mock Outputs UI** (`ec110d8`) for `uses:` steps.
- **#4 — Failure UX** (`dd694b4`): auto-jump to the failed step, prominent stdout/stderr, auto-explanation.
- Roadmap written and **28 GitHub issues filed**, linked inline (`0f64b2d`, `778d128`).

## Phase 2 — The audit: 28 findings, all fixed, 17 commits

| # | Finding | Commit |
|---|---|---|
| 1, 2 | Concurrent lane-stepping race; zero-step job deadlock + 500 | `765e0a5` |
| 6 | Bare YAML boolean/number `if:` silently dropped | `0a558c8` |
| 7 | A *skipped* dependency didn't skip its dependents (only a failed one did) | `8347c2c` |
| 9 | `timeout-minutes` parsed then discarded | `0852716` |
| 10 | What-If overrides could be added or replaced, never removed | `949cad3` |
| **3** | `GET /api/sessions` listed every session, unauthenticated | `a51eb43` |
| **4** | Sessions and workspace dirs never reclaimed | `b8a323d` |
| **5** | `run:` steps inherited the server's full `process.env` | `f60b3ee` |
| 8 | `strategy.fail-fast` parsed but not enforced | `23e8c8c` |
| 11 | Relational operators diverged from GitHub — *locked in by a test asserting the wrong behavior* | `7eeba07` |
| 12, 13 | `runner.os` hardcoded; `runner.temp` ≠ `$RUNNER_TEMP` | `a28d353` |
| 14 | Common context fields returned `null` silently | `87349b6` |
| 15, 16 | Output truncation dropped the tail; stdout/stderr not interleaved | `93a4042` |
| 17 | Workflow `env:` couldn't override `CI`/`GITHUB_*` | `f265e0b` |
| 18 | `steps.*` exposed id-less steps under synthetic keys | `a7f40fc` |
| 19–24 | Six UI papercuts | `3926e87` |
| 26–28 | Dead code, request validation, crash-safe cleanup | `c23bbaa` |

**The security trio (#3/#4/#5)** was the sharpest part: an unauthenticated listing endpoint, unbounded resource growth, and a workflow being able to print the debugger's own `ANTHROPIC_API_KEY` into the browser. Finding **#11** mattered beyond its own fix — a wrong test was defending the wrong behavior, which is direct evidence the suite couldn't be trusted, and is why #13 got promoted to P0.

## Phase 3 — Re-prioritization

`28406fb`, `1944207`, `0bc5a40`. Filed **#29** (workflows are pasted text and the workspace is an empty temp dir, so a real `npm ci` fails regardless) and **#30** (zero React component tests; `next build` type-checks without linting). Moved `priority:*` labels to match. The decided sequence replaced the label ordering as the source of truth.

## Phase 4 — Executing the sequence

**Step 2 — cheap wins + isolation**

- **#5 keyboard shortcuts** (`0c775bc`) — `S`/`C`/`E`/`A`, `F10`/`F8` aliases, `?` overlay. Logic extracted into a pure module (`keyboardShortcuts.ts`, 20 tests) since no component harness exists.
- **#6 persistence** (`404ca46`) — keyed by **workflow content hash**, not session id; an id-keyed store could never restore, since every session gets a new id. Secret *values* deliberately excluded — only names come back, as empty rows.
- **Session isolation** (`6889f89`) — httpOnly `SameSite=Lax` owner cookie, checked by all nine session-resolving routes, answering **404 not 403** so a probe can't confirm an id exists.

**Step 1 — demo mode** (`4019a06`)

`VIZU_DEMO_MODE=1` disables the `run:` spawn path entirely; per-visitor rate limits (30/10min sliding, 25 live); and **mockable `run:` outcomes** — which resolved the open roadmap question, since simulation-only would otherwise mean nothing can ever fail, hiding the failure UX and explanation panel.

---

## Bugs found and fixed incidentally

- **Homepage placeholder was invalid YAML** — `run: echo "tests: ${{ ... }}"`; a plain scalar can't contain `: `. Every "Start Debugging" click was 400-ing.
- **Restore notice never rendered** — a real StrictMode bug. The restore effect bailed on a `cancelled` flag set by cleanup; double-mounting fired cleanup mid-restore, so server mutations landed but the `setState` calls were discarded.
- **Roadmap claimed 13 audit commits** — it was 17. Corrected (`55b9dfd`).

Three Playwright "failures" during verification turned out to be the test harness, not the app: fixed sleeps too short for dev-mode lazy compile, `textarea.type()` appending to existing content, a checkbox selector for what is actually a `<button>`, and an assertion expecting "Explain this failure" when the panel auto-analyzes and shows "Re-analyze".

## Judgment calls worth remembering

- **Persist a toggle, not a "forget" button** — a button would be undone by the next mutation.
- **404 over 403** for ownership mismatches — avoids an existence oracle.
- **"A mocked step is not executed"** — the coherent rule, matching how `uses:` already behaved, and what makes both the failure demo and "stub out this destructive command" work.
- **Content-hash keying** over session-id keying for persistence.
- **Documentation corrected wherever it overclaimed**: WhatIfPanel's "Nothing here is saved to disk", README's "no per-session ownership check", and repeated insistence that isolation ≠ authentication and does **not** make shared deployment safe while `run:` executes.

## Where things stood at this writing

**Issues: 28 total — 5 closed** (#2, #3, #4, #5, #6), **23 open.**

**Next:** sequence step 3 — **#29**, open a workflow from the repo and run against a real working tree.

**Two loose ends flagged but not acted on:** PR [#28](https://github.com/StormDoragon/vizu-four/pull/28) is open against this branch with a `DEPLOY.md` that predates demo mode and doesn't mention `VIZU_DEMO_MODE`; and no example workflow demonstrates a mocked failure, which is now the only way to reach the explanation panel in a simulation-only demo.

Deferred by product decision: **#14** (Docker) and **#15** (GitHub run import) until the demo has had real users.
