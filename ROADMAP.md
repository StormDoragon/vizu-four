# Prioritized Checklist — Actions Visual Debugger (`vizu-four`)

Every item below is tracked as a GitHub issue (linked inline) so status stays visible outside this file.

**Status (September 2026):** MVP + demo isolation shipped. The first codebase audit/hardening pass is complete (28 findings across earlier commits). A follow-up independent security review of `7b1f3cf` found **8 remaining issues**; all eight are **fixed and merged** (`53a34a6` / [PR #31](https://github.com/StormDoragon/vizu-four/pull/31), key-masking regression `63eb857`): secret-as-object-key masking, YAML alias bomb rejection, cross-stream log masking, StreamMasker hold-back cap, expression response budget, accumulated session-state bounds, pending-step playground `env:` parity, Claude `AbortSignal` deadline. Public demo remains simulation-only (`VIZU_DEMO_MODE=1`). Formal sign-off still wants deploy-SHA confirmation on Render, a clean local CI green run on HEAD, and **#14** before any shared-host real `run:` execution.

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
