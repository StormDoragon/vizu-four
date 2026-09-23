# Prioritized Checklist — Actions Visual Debugger (`vizu-four`)

Every item below is tracked as a GitHub issue (linked inline) so status stays visible outside this file.

**Status (September 2026):** MVP + demo isolation shipped. The first codebase audit/hardening pass is complete (28 findings across earlier commits). A follow-up independent security review of `7b1f3cf` found **8 remaining issues**; all eight are **fixed and merged** (`53a34a6` / [PR #31](https://github.com/StormDoragon/vizu-four/pull/31), key-masking regression `63eb857`): secret-as-object-key masking, YAML alias bomb rejection, cross-stream log masking, StreamMasker hold-back cap, expression response budget, accumulated session-state bounds, pending-step playground `env:` parity, Claude `AbortSignal` deadline. Public demo remains simulation-only (`VIZU_DEMO_MODE=1`).

**Third review pass (September 2026, branch `claude/code-review-bug-fixes-nqi3ue`)** was a full file-by-file sweep of the codebase — engine, expression engine, AI layer, every route, and every component — plus a headless-browser run of every flow. It found a **critical** security issue both earlier reviews missed and a spread of correctness, security-hardening, performance and UX bugs, all fixed with regression tests (or, for the visual ones, browser verification):

Security / correctness:
- **Process-wide DoS via `Object.prototype` pollution** (`418ca19`). Client-chosen lane/job ids were looked up without an own-property check, so stepping lane `__proto__` wrote `status` onto `Object.prototype` — after which every route, for every visitor, answered 500 until restart. One anonymous request against one's own session was enough; reproduced against a demo-mode production build and re-verified fixed. The same root cause also silently disabled the retired-secret size bound (a secret named `__proto__` made its tally `NaN`), let `needs: constructor` pass validation and crash the session, ran `uses: constructor@v1` with `Object` as its handler, and evaluated `constructor(1)` in an expression as a real call.
- **Unbounded request bodies** (`61e42bb`). Every POST buffered and parsed the whole body before any size check ran; bodies are now capped at 4 MiB while still arriving, `Content-Length` or not.
- **A late-declared secret was sent to the AI provider in the clear** (`4c11b2d`). The explain path is the one place step data leaves the server; it now re-masks against the secrets held now, and validates the model's reply before rendering it.
- **Breakpoints accepted any step key** (`418ca19`), growing an unbounded set; now validated like mock outputs, with share links skipping (not failing on) entries the server rejects.
- **Expression `!!!…` deep enough to overflow the walk** returned a 500 from the public evaluate endpoint (`c88b066`); now reported as an expression error.

Performance:
- **Env resolution was O(keys × context) per step** (`a786591`) — a large `env:` block over a matrix could stall the event loop for minutes; ~9× faster now.
- **A simulation-only run held the whole server** (`e90d977`): the run loop now yields between steps, so other visitors' requests are answered mid-run.

Correctness / UX:
- Workspace listing no longer 500s on one unreadable entry (`de82804`); a job with no steps no longer crashes the debugger (`17e4182`); the pause-on-failure toggle and What-If deletions no longer silently misbehave (`0fed05e`, `36bb1d4`); the playground error caret lands on the right character (`bae094a`); run controls are disabled while a shared session awaits consent (`1dd8d94`); simulation-only wording is honest in the mock editor, simulated-action notes and the home footer (`2f08a56`, `73ea1be`, `b5f80b2`); and the app has an icon with legible graph controls in both themes (`adbfeae`).

Local CI was **green on that HEAD**: typecheck, lint, 714 tests, production build — and a headless-browser pass of every example, the failure demo, a zero-step workflow and the playground reports no page errors, console errors or 5xx responses. Render is confirmed live on the merge commit (`2457151`).

**Readiness pass (September 2026).** A follow-up closed the remaining release gaps:
- **Verification in CI.** A GitHub Actions workflow now runs typecheck, lint, every test, a production build and a deployment check on Linux and macOS, Node 20/22/24, on every push. The deployment check (`npm run verify:deployment`) boots the production build in demo mode and confirms over HTTP that `run:` never executes, host browsing and the working-tree opt-in are refused, and every AI cost bound holds against a stand-in provider.
- **AI spend was not actually bounded per call.** The call cap limited how many explanations were sent, not how large each one was: the step name, `uses:` value and engine error went into the prompt whole, so a 1 MB workflow made one capped call cost what a hundred should. Every field is now clipped by UTF-8 bytes, and a prompt over 16 KB is never sent. That gives spend a hard ceiling, which DEPLOY.md now spells out.
- **Share links over ~16 KB were dead.** The token rode in the URL path, so the server answered 431 for any workflow over about 12 KB — and every opened link put the whole encoded session in server and host logs. New links carry it after the `#`, which browsers never send. Old links still open.
- **Disclosures.** `PRIVACY.md` (what's kept, where, for how long, and what reaches Anthropic), `SECURITY.md` (private reporting, scope, known trade-offs), a readable-by-anyone warning in the share dialog, links from the app's footer, and an explicit no-license statement.

**#14** remains required before any shared-host real `run:` execution.

---

## Decided sequence

This is the agreed order of work, not a suggestion. Where it disagrees with an item's `priority:*` label, the reason is stated.

### 1. Demo scope: simulation-only — [#1](https://github.com/StormDoragon/vizu-four/issues/1)

**Decided.** The public demo ships with `run:` execution **disabled** rather than sandboxed. Docker-per-session was the alternative and was rejected for now: the point of the demo is to get user feedback *before* making that investment.

The delta is smaller than it sounds — `uses:` steps are already simulated today, so nothing changes there. Demo scope is:

- ~~disable the `run:` spawn path~~ — **done** (`VIZU_DEMO_MODE=1`)
- ~~cookie-scoped session ownership, checked in the `[id]` routes~~ — **done**
- ~~per-visitor rate limits~~ — **done**
- ~~mockable `run:` outcomes, so the demo can still show a failure~~ — **done**

Still demonstrates the hardest, most demo-able parts: the expression engine, the `if:` always-truthy footgun detection, matrix expansion, context inspection, breakpoints.

> **Threat model note.** "Minimal" isolation is only sufficient *because execution is off*. With `run:` disabled the risk drops from remote code execution to session data exposure (a pasted workflow, plus any secret values typed into What-If). A cookie-set owner id covers that. **If `run:` is ever re-enabled on a shared host, minimal isolation is no longer sufficient and [#14](https://github.com/StormDoragon/vizu-four/issues/14) becomes a hard prerequisite.**

> **Resolved — mock failures.** Simulation-only would otherwise mean nothing ever fails, hiding the failure UX and AI explanation panel ([#4](https://github.com/StormDoragon/vizu-four/issues/4)) — arguably the most differentiating shipped feature. Resolved by extending the Mock Outputs infrastructure from [#3](https://github.com/StormDoragon/vizu-four/issues/3): a mock now carries an optional exit code and stderr, and applies to `run:` steps as well as `uses:` ones. A mocked non-zero exit flows through the existing `continue-on-error` / `steps.*.outcome` / failure-panel / explain-endpoint path with no new plumbing. The rule is the same in both modes: **a mocked step is not executed** — the mock decides its result outright, which is also what makes "stub out this slow step" work locally.

### 2–6. Shipped MVP work

Keyboard shortcuts, persist breakpoints/What-If, session isolation, real working-tree opt-in, test/lint net, expression edge cases, time-travel, visual polish, matrix focus, expression traces, and shareable session links are all **shipped**. See prior roadmap entries and closed issues [#5](https://github.com/StormDoragon/vizu-four/issues/5)–[#13](https://github.com/StormDoragon/vizu-four/issues/13), [#17](https://github.com/StormDoragon/vizu-four/issues/17), [#29](https://github.com/StormDoragon/vizu-four/issues/29), [#30](https://github.com/StormDoragon/vizu-four/issues/30).

### Explicitly deferred

**No investment in [#14](https://github.com/StormDoragon/vizu-four/issues/14) (Docker execution) or [#15](https://github.com/StormDoragon/vizu-four/issues/15) (import a real GitHub run) until the simulation-only demo has been in front of real users for a while.**

---

## Tracked backlog

### P0 / P1 — **done**
Demo, mocks, failure UX, shortcuts, persistence, workspace opt-in, tests, expression hardening, time-travel, share links, playground traces, matrix polish, visual/theme work.

### P2 — Real power features (months 1–2)
- [ ] Real container / Docker execution for `uses:` steps ([#14](https://github.com/StormDoragon/vizu-four/issues/14)) — **deferred until after demo feedback**; **hard prerequisite** for shared-host real `run:`
- [ ] GitHub App / PAT: import a real failed run ([#15](https://github.com/StormDoragon/vizu-four/issues/15))
- [ ] "Create Fix PR" from AI suggestion ([#16](https://github.com/StormDoragon/vizu-four/issues/16))
- [ ] Better reusable workflow / composite action fidelity ([#18](https://github.com/StormDoragon/vizu-four/issues/18))

### P3 — Productization
- [ ] User accounts + session history ([#19](https://github.com/StormDoragon/vizu-four/issues/19))
- [ ] Free vs paid tiers ([#20](https://github.com/StormDoragon/vizu-four/issues/20))
- [ ] VS Code / Cursor extension ([#21](https://github.com/StormDoragon/vizu-four/issues/21))
- [ ] Team features ([#22](https://github.com/StormDoragon/vizu-four/issues/22))
- [ ] Anonymized failure patterns for AI ([#23](https://github.com/StormDoragon/vizu-four/issues/23))

### P4 — Enterprise / platform
- [ ] Self-hosted deploy ([#24](https://github.com/StormDoragon/vizu-four/issues/24))
- [ ] Windows / macOS runner emulation ([#25](https://github.com/StormDoragon/vizu-four/issues/25))
- [ ] High-fidelity microVM runner ([#26](https://github.com/StormDoragon/vizu-four/issues/26))
- [ ] Billing, SSO, audit logs, admin ([#27](https://github.com/StormDoragon/vizu-four/issues/27))
