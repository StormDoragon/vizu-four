# Prioritized Checklist — Actions Visual Debugger (`vizu-four`)

Every item below is tracked as a GitHub issue (linked inline) so status stays visible outside this file.

**Status:** the codebase audit and hardening pass is complete — all 28 findings fixed across 13 commits (concurrency race, zero-step deadlock, `if:` coercion, skip propagation, `timeout-minutes`, What-If removal, the security trio, `fail-fast`, relational coercion, runner-context fidelity, log capture, `steps.*` keying, six UI papercuts, dead code, request validation, crash-safe cleanup). 142 tests passing.

---

## Recommended order of work

Ordered by leverage, not by P-number. Where this disagrees with an item's P-label, the reason is stated.

### 1. Decide the demo question before building anything else — [#1](https://github.com/StormDoragon/vizu-four/issues/1)

**#1 is a design decision with a security prerequisite, not a task that can just be picked up.** Two blockers remain after the audit:

- Sessions live in one process-wide in-memory store with **no per-visitor ownership**. Anyone holding a session id can drive anyone else's session.
- `run:` steps execute real processes with the server's own shell privileges. On a public host that is remote code execution by design, not a bug. See the README security note.

Two paths:

- **(a) Sandbox properly** — Docker-per-session (overlaps [#14](https://github.com/StormDoragon/vizu-four/issues/14)). Weeks of work; unblocks the real "high-fidelity local runner" pitch.
- **(b) Simulation-only demo** — cookie-scoped session ownership, `run:` execution disabled, per-visitor rate limits. Days, not weeks. Still demonstrates the hardest and most demo-able parts: the expression engine, `if:` always-truthy footgun detection, matrix expansion, context inspection, breakpoints.

**Recommendation: (b) first.** The roadmap's own logic is to get user feedback before investing in Docker — so don't build Docker to get the feedback.

### 2. Cheap wins that make it feel like a debugger

- [#5](https://github.com/StormDoragon/vizu-four/issues/5) **keyboard shortcuts** (~½ day) — a step-debugger you have to mouse through is unpleasant. The ⌘/Ctrl+Enter handler added to the expression playground is the pattern to extend.
- [#6](https://github.com/StormDoragon/vizu-four/issues/6) **persist breakpoints + What-If** (~1 day) — sessions are RAM-only, so a server restart loses all setup. The `session.revision` counter added during the audit fixes is the right invalidation primitive.
- [#17](https://github.com/StormDoragon/vizu-four/issues/17) **time-travel** — **labelled P2, but pull it forward.** The `stepIndex`-aware `/api/sessions/[id]/context` endpoint built during the audit fixes is most of it already; `StepRunRecord` stores per-step data. Remaining work is mostly UI, and it is a genuinely differentiating feature.

### 3. Close the "can I use this on my actual repo?" gap — [#29](https://github.com/StormDoragon/vizu-four/issues/29)

Today you paste text or pick a bundled example, and the run workspace is an **empty temp dir** — so a real workflow's `npm ci` fails regardless of how it was loaded. File picker and real-working-tree execution must ship together. Ranks above most of P1: it is the difference between a demo toy and a tool.

### 4. Protect what was just changed

- **Untracked debt:** there are **zero React component tests** and **no lint script** (`next build` type-checks but never lints). The audit pass made ~12 UI-facing changes verified only by manual browser runs. One regression net plus `npm run lint` before adding more UI features (~1 day). *Not yet filed as an issue.*
- [#13](https://github.com/StormDoragon/vizu-four/issues/13) **expression engine edge cases** — **promote.** The audit found a real divergence from GitHub (relational operators coerce both operands to numbers; `'apple' < 'banana'` is `false` on a real runner) that was *locked in by a test asserting the wrong behavior*. Direct evidence that more parity gaps exist and current tests cannot be trusted to catch them.

### 5. Then the rest, unchanged

[#11](https://github.com/StormDoragon/vizu-four/issues/11)/[#12](https://github.com/StormDoragon/vizu-four/issues/12) visual + theme polish → [#10](https://github.com/StormDoragon/vizu-four/issues/10) matrix switcher → [#9](https://github.com/StormDoragon/vizu-four/issues/9) playground internals → [#8](https://github.com/StormDoragon/vizu-four/issues/8) share links → P2 [#14](https://github.com/StormDoragon/vizu-four/issues/14)/[#15](https://github.com/StormDoragon/vizu-four/issues/15)/[#16](https://github.com/StormDoragon/vizu-four/issues/16)/[#18](https://github.com/StormDoragon/vizu-four/issues/18) → P3/P4 untouched.

---

## Tracked backlog

Sections below mirror the `priority:*` labels on GitHub and are the canonical list. The ordering above is the recommendation for what to pick up next.

### P0 — Make it actually useful (next 1–2 weeks)
- [ ] Deploy a public demo (Vercel or similar) with 4–5 preloaded example workflows ([#1](https://github.com/StormDoragon/vizu-four/issues/1)) — **blocked on the sandboxing decision above**
- [x] Improve common `uses:` handlers (`actions/checkout`, `setup-node`, `setup-python`, `cache`, `upload/download-artifact`, `docker/login-action`) ([#2](https://github.com/StormDoragon/vizu-four/issues/2), merged via [#7](https://github.com/StormDoragon/vizu-four/pull/7))
- [x] Add "Mock outputs" UI for any `uses:` step (so users can stub results without real containers) ([#3](https://github.com/StormDoragon/vizu-four/issues/3), shipped in [`ec110d8`](https://github.com/StormDoragon/vizu-four/commit/ec110d8))
- [x] Better failure UX: auto-jump to failed step + prominent stdout/stderr + AI explanation panel ([#4](https://github.com/StormDoragon/vizu-four/issues/4), shipped in [`dd694b4`](https://github.com/StormDoragon/vizu-four/commit/dd694b4))
- [ ] Keyboard shortcuts for debugger controls (Step / Continue / Run to end) ([#5](https://github.com/StormDoragon/vizu-four/issues/5))
- [ ] Persist breakpoints + What-If overrides (localStorage) ([#6](https://github.com/StormDoragon/vizu-four/issues/6))
- [ ] Open a workflow from the repo + run against a real working tree (opt-in) ([#29](https://github.com/StormDoragon/vizu-four/issues/29))

### P1 — Core experience polish (weeks 2–4)
- [ ] "Share session" link (serialize workflow + current debug state) ([#8](https://github.com/StormDoragon/vizu-four/issues/8))
- [ ] Expression playground improvements: show intermediate evaluation steps ([#9](https://github.com/StormDoragon/vizu-four/issues/9))
- [ ] Matrix lane switcher polish + "debug this combination only" ([#10](https://github.com/StormDoragon/vizu-four/issues/10))
- [ ] Visual improvements: clearer status colors, running indicators, better graph layout ([#11](https://github.com/StormDoragon/vizu-four/issues/11))
- [ ] Dark/light theme polish + basic responsive layout ([#12](https://github.com/StormDoragon/vizu-four/issues/12))
- [ ] Harden expression engine with more real-world edge-case tests ([#13](https://github.com/StormDoragon/vizu-four/issues/13)) — *promote; see above*

### P2 — Real power features (months 1–2)
- [ ] Real container / Docker execution for `uses:` steps (biggest technical leap) ([#14](https://github.com/StormDoragon/vizu-four/issues/14))
- [ ] GitHub App / PAT integration: import a real failed run + reconstruct context ([#15](https://github.com/StormDoragon/vizu-four/issues/15))
- [ ] "Create Fix PR" from AI suggestion ([#16](https://github.com/StormDoragon/vizu-four/issues/16))
- [ ] Time-travel: jump to any previous step and inspect full state at that point ([#17](https://github.com/StormDoragon/vizu-four/issues/17)) — *promote; mostly built already, see above*
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
