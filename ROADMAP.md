# Prioritized Checklist — Actions Visual Debugger (`vizu-four`)

Every item below is tracked as a GitHub issue (linked inline) so status stays visible outside this file.

**Status:** the codebase audit and hardening pass is complete — all 28 findings fixed across 13 commits (concurrency race, zero-step deadlock, `if:` coercion, skip propagation, `timeout-minutes`, What-If removal, the security trio, `fail-fast`, relational coercion, runner-context fidelity, log capture, `steps.*` keying, six UI papercuts, dead code, request validation, crash-safe cleanup). 142 tests passing.

---

## Decided sequence

This is the agreed order of work, not a suggestion. Where it disagrees with an item's `priority:*` label, the reason is stated.

### 1. Demo scope: simulation-only — [#1](https://github.com/StormDoragon/vizu-four/issues/1)

**Decided.** The public demo ships with `run:` execution **disabled** rather than sandboxed. Docker-per-session was the alternative and was rejected for now: the point of the demo is to get user feedback *before* making that investment.

The delta is smaller than it sounds — `uses:` steps are already simulated today, so nothing changes there. Demo scope is:

- disable the `run:` spawn path
- cookie-scoped session ownership, checked in the `[id]` routes
- per-visitor rate limits

Still demonstrates the hardest, most demo-able parts: the expression engine, the `if:` always-truthy footgun detection, matrix expansion, context inspection, breakpoints.

> **Threat model note.** "Minimal" isolation is only sufficient *because execution is off*. With `run:` disabled the risk drops from remote code execution to session data exposure (a pasted workflow, plus any secret values typed into What-If). A cookie-set owner id covers that. **If `run:` is ever re-enabled on a shared host, minimal isolation is no longer sufficient and [#14](https://github.com/StormDoragon/vizu-four/issues/14) becomes a hard prerequisite.**

> **Open decision — mock failures.** Simulation-only means nothing ever fails, so the demo can't show the failure UX and AI explanation panel ([#4](https://github.com/StormDoragon/vizu-four/issues/4)) — arguably the most differentiating shipped feature. Cheapest fix reuses the Mock Outputs infrastructure from [#3](https://github.com/StormDoragon/vizu-four/issues/3): let a `run:` step be mocked with an exit code and canned stderr, not just outputs. A mocked non-zero exit would flow through the existing `continue-on-error` / `steps.*.outcome` / failure-panel / explain-endpoint path without new plumbing. **Decide this alongside the demo scope, not after the demo is up.**

### 2. Cheap wins + demo isolation — [#5](https://github.com/StormDoragon/vizu-four/issues/5), [#6](https://github.com/StormDoragon/vizu-four/issues/6)

- [#5](https://github.com/StormDoragon/vizu-four/issues/5) **keyboard shortcuts** (~½ day) — a step-debugger you have to mouse through is unpleasant. The ⌘/Ctrl+Enter handler in the expression playground is the pattern to extend.
- [#6](https://github.com/StormDoragon/vizu-four/issues/6) **persist breakpoints + What-If** (~1 day) — sessions are RAM-only, so a server restart loses all setup. The `session.revision` counter added during the audit fixes is the right invalidation primitive.
- **Minimal session isolation** for the demo (see scope above). Untracked — folded in here rather than filed separately.

### 3. Real workflow + workspace access — [#29](https://github.com/StormDoragon/vizu-four/issues/29)

Today you paste text or pick a bundled example, and the run workspace is an **empty temp dir** — so a real workflow's `npm ci` fails regardless of how it was loaded. File picker and real-working-tree execution ship together, behind an explicit opt-in. Ranks above most of P1: it's the difference between a demo toy and a tool.

### 4. Test/lint net + expression parity — [#30](https://github.com/StormDoragon/vizu-four/issues/30), [#13](https://github.com/StormDoragon/vizu-four/issues/13)

- [#30](https://github.com/StormDoragon/vizu-four/issues/30) **UI regression net + lint script** (~1 day) — zero React component tests exist, and `next build` type-checks without linting. The audit pass made ~12 UI-facing changes verified only by manual browser runs; that verification didn't survive the session.
- [#13](https://github.com/StormDoragon/vizu-four/issues/13) **expression engine edge cases** — the audit found a real divergence from GitHub (relational operators coerce both operands to numbers; `'apple' < 'banana'` is `false` on a real runner) that was *locked in by a test asserting the wrong behavior*. Direct evidence that more parity gaps exist and current tests can't be trusted to catch them. Relabelled P1 → P0 to match this position.

### 5. Time-travel — [#17](https://github.com/StormDoragon/vizu-four/issues/17)

The `stepIndex`-aware `/api/sessions/[id]/context` endpoint built during the audit fixes is most of it already; `StepRunRecord` stores per-step data. Remaining work is mostly UI — which is why it lands *after* the test net in step 4 rather than before it. Relabelled P2 → P1: it is not months-out power-feature work when most of it is built.

### 6. Visual polish and the rest

[#11](https://github.com/StormDoragon/vizu-four/issues/11)/[#12](https://github.com/StormDoragon/vizu-four/issues/12) visual + theme polish → [#10](https://github.com/StormDoragon/vizu-four/issues/10) matrix switcher → [#9](https://github.com/StormDoragon/vizu-four/issues/9) playground internals → [#8](https://github.com/StormDoragon/vizu-four/issues/8) share links → P3/P4 untouched.

### Explicitly deferred

**No investment in [#14](https://github.com/StormDoragon/vizu-four/issues/14) (Docker execution) or [#15](https://github.com/StormDoragon/vizu-four/issues/15) (import a real GitHub run) until the simulation-only demo has been in front of real users for a while.**

#15 is the easier one to talk yourself into early, because it looks like a demo booster. It isn't cheap: GitHub App registration, OAuth, token storage, plus reconstructing run context from a log format that doesn't expose what's needed. Same "wait for feedback" bar as Docker.

---

## Tracked backlog

Sections below mirror the `priority:*` labels on GitHub and are the canonical list. The sequence above is what to actually pick up next.

### P0 — Make it actually useful (next 1–2 weeks)
- [ ] Deploy a public demo (Vercel or similar) with 4–5 preloaded example workflows ([#1](https://github.com/StormDoragon/vizu-four/issues/1)) — **scoped to simulation-only; see sequence step 1**
- [x] Improve common `uses:` handlers (`actions/checkout`, `setup-node`, `setup-python`, `cache`, `upload/download-artifact`, `docker/login-action`) ([#2](https://github.com/StormDoragon/vizu-four/issues/2), merged via [#7](https://github.com/StormDoragon/vizu-four/pull/7))
- [x] Add "Mock outputs" UI for any `uses:` step (so users can stub results without real containers) ([#3](https://github.com/StormDoragon/vizu-four/issues/3), shipped in [`ec110d8`](https://github.com/StormDoragon/vizu-four/commit/ec110d8))
- [x] Better failure UX: auto-jump to failed step + prominent stdout/stderr + AI explanation panel ([#4](https://github.com/StormDoragon/vizu-four/issues/4), shipped in [`dd694b4`](https://github.com/StormDoragon/vizu-four/commit/dd694b4))
- [ ] Keyboard shortcuts for debugger controls (Step / Continue / Run to end) ([#5](https://github.com/StormDoragon/vizu-four/issues/5))
- [ ] Persist breakpoints + What-If overrides (localStorage) ([#6](https://github.com/StormDoragon/vizu-four/issues/6))
- [ ] Open a workflow from the repo + run against a real working tree (opt-in) ([#29](https://github.com/StormDoragon/vizu-four/issues/29))
- [ ] UI regression test net + lint script ([#30](https://github.com/StormDoragon/vizu-four/issues/30))
- [ ] Harden expression engine with more real-world edge-case tests ([#13](https://github.com/StormDoragon/vizu-four/issues/13)) — *was P1*

### P1 — Core experience polish (weeks 2–4)
- [ ] Time-travel: jump to any previous step and inspect full state at that point ([#17](https://github.com/StormDoragon/vizu-four/issues/17)) — *was P2; mostly built already*
- [ ] "Share session" link (serialize workflow + current debug state) ([#8](https://github.com/StormDoragon/vizu-four/issues/8))
- [ ] Expression playground improvements: show intermediate evaluation steps ([#9](https://github.com/StormDoragon/vizu-four/issues/9))
- [ ] Matrix lane switcher polish + "debug this combination only" ([#10](https://github.com/StormDoragon/vizu-four/issues/10))
- [ ] Visual improvements: clearer status colors, running indicators, better graph layout ([#11](https://github.com/StormDoragon/vizu-four/issues/11))
- [ ] Dark/light theme polish + basic responsive layout ([#12](https://github.com/StormDoragon/vizu-four/issues/12))

### P2 — Real power features (months 1–2)
- [ ] Real container / Docker execution for `uses:` steps (biggest technical leap) ([#14](https://github.com/StormDoragon/vizu-four/issues/14)) — **deferred until after demo feedback**
- [ ] GitHub App / PAT integration: import a real failed run + reconstruct context ([#15](https://github.com/StormDoragon/vizu-four/issues/15)) — **deferred until after demo feedback**
- [ ] "Create Fix PR" from AI suggestion ([#16](https://github.com/StormDoragon/vizu-four/issues/16))
- [ ] Support for reusable workflows and composite actions with better fidelity ([#18](https://github.com/StormDoragon/vizu-four/issues/18))

### P3 — Productization (months 2–4)
- [ ] User accounts + session history ([#19](https://github.com/StormDoragon/vizu-four/issues/19))
- [ ] Free tier (public repos) vs paid tiers ([#20](https://github.com/StormDoragon/vizu-four/issues/20))
- [ ] VS Code / Cursor extension that launches or embeds the debugger ([#21](https://github.com/StormDoragon/vizu-four/issues/21))
- [ ] Basic team features (shared sessions, org secrets support) ([#22](https://github.com/StormDoragon/vizu-four/issues/22))
- [ ] Collect anonymized failure patterns to improve AI explanations ([#23](https://github.com/StormDoragon/vizu-four/issues/23))

### P4 — Longer-term / scale
- [ ] Self-hosted / enterprise option ([#24](https://github.com/StormDoragon/vizu-four/issues/24))
- [ ] Windows & macOS runner emulation ([#25](https://github.com/StormDoragon/vizu-four/issues/25))
- [ ] Full high-fidelity microVM runner (beyond Docker) ([#26](https://github.com/StormDoragon/vizu-four/issues/26))
- [ ] Billing, SSO, audit logs, admin dashboard ([#27](https://github.com/StormDoragon/vizu-four/issues/27))
