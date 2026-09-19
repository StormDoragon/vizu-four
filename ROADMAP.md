# Prioritized Checklist — Actions Visual Debugger (`vizu-four`)

Every item below is tracked as a GitHub issue (linked inline) so status stays visible outside this file.

**Status:** the codebase audit and hardening pass is complete — all 28 findings fixed across 17 commits (concurrency race, zero-step deadlock, `if:` coercion, skip propagation, `timeout-minutes`, What-If removal, the security trio, `fail-fast`, relational coercion, runner-context fidelity, log capture, `steps.*` keying, six UI papercuts, dead code, request validation, crash-safe cleanup). 296 tests passing.

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

### 2. Cheap wins + demo isolation — [#5](https://github.com/StormDoragon/vizu-four/issues/5), [#6](https://github.com/StormDoragon/vizu-four/issues/6)

- [x] ~~[#5](https://github.com/StormDoragon/vizu-four/issues/5) **keyboard shortcuts**~~ — shipped. `S`/`C`/`E`/`A` with `F10`/`F8` aliases, a `?` overlay, and button tooltips.
- [x] ~~[#6](https://github.com/StormDoragon/vizu-four/issues/6) **persist breakpoints + What-If**~~ — shipped. Keyed by workflow content hash (not session id, which is new every time), so it survives the server restart that drops the in-memory session. Secret *values* are deliberately excluded; only names are remembered, as empty rows to re-enter.
- [x] ~~**Minimal session isolation** for the demo~~ — shipped. Sessions carry an owner id from an httpOnly `SameSite=Lax` cookie; all nine session-resolving routes (including `/api/expressions/evaluate`, which takes a session id in its body, and `DELETE`, which previously had no check at all) answer 404 on a mismatch. Isolation, not authentication — it does **not** by itself make a shared deployment safe; see the threat-model note above.

### 3. Real workflow + workspace access — [#29](https://github.com/StormDoragon/vizu-four/issues/29)

- [x] ~~Load a workflow from the repo + run against a real working tree~~ — shipped. A directory browser lists `.github/workflows/*.yml` for one-click loading; a separate, explicit opt-in checkbox (shown only after a successful browse) makes that session's `run:` steps execute for real against that directory instead of a scratch workspace. Off by default - pasting YAML and bundled examples are unchanged. Disabled entirely in simulation-only deployments, alongside `run:` execution itself. Session cleanup never deletes a real working tree, only the disposable scratch path; the debugger's own artifact-simulation scratch space was moved off `workspaceDir` onto the session's temp root so it never lands inside a real repo either.

### 4. Test/lint net + expression parity — [#30](https://github.com/StormDoragon/vizu-four/issues/30), [#13](https://github.com/StormDoragon/vizu-four/issues/13)

- [x] ~~[#30](https://github.com/StormDoragon/vizu-four/issues/30) **UI regression net + lint script**~~ — shipped. `npm run lint` (ESLint via `eslint-config-next`'s flat config - `next lint` was removed in Next 16) runs clean. Vitest gained React Testing Library + jsdom for component tests, opted into per-file via a `// @vitest-environment jsdom` docblock so the fast `node` default for engine/lib tests is untouched. 10 new component tests cover exactly the classes of regression the audit pass fixed by hand: `ContextInspector`'s stale-error-clearing and revision-triggered refetch, `MatrixExplorer`'s selected-lane highlight and steppable-lane marker, `DebuggerApp`'s parse-warning banner and dismissal, `StepDetailPanel`'s interleaved `combinedOutput` rendering.
- [x] ~~[#13](https://github.com/StormDoragon/vizu-four/issues/13) **expression engine edge cases**~~ — shipped. Real-world-derived coverage: GitHub's own documented object-filter (`.*`) examples, and expressions pulled from real, currently-running public workflows (`actions/checkout`, `git/git`) rather than invented approximations. That survey found and fixed a genuine bug, not just a coverage gap: hyphenated job/step ids (`needs.ci-config...`, `matrix.node-version` - kebab-case is the dominant real-world convention) previously threw a syntax error, since the lexer's identifier grammar didn't include `-` even though GitHub's own does for exactly this reason. One divergence was found and deliberately left open rather than fixed - numeric-string coercion uses JavaScript's `Number()` where GitHub's docs specify "any legal JSON number format" (stricter: no hex, no leading `+`, no leading zeros) - documented in the README's new "Confirmed expression-engine divergences" section and locked in by a test rather than silently drifting further.

### 5. Time-travel — [#17](https://github.com/StormDoragon/vizu-four/issues/17)

- [x] ~~Time-travel to any previously executed step~~ — shipped, as the "cheap version" the issue's notes anticipated: the `stepIndex`-aware `/api/sessions/[id]/context` endpoint and `StepRunRecord`'s per-step data already reconstructed history on demand, so this was UI, not an engine change. A time-travel bar above the step detail panel shows a `LIVE`/`HISTORY` badge, Prev/Next controls that scrub through a lane's executed steps (never past its live cursor - there's nothing to show for a step that hasn't run), and a "Jump to live" button. "Live" is defined precisely (`isLiveSelection`, unit-tested): the active lane at its live step index - a different lane, or an earlier step in the active lane, is always "history," so it can never be confused with what Step/Continue/Run actually act on (which is always `activeLaneId`, unchanged by browsing). Works per-lane, so it holds across matrix lanes without new per-lane state.

### 6. Visual polish and the rest

- [x] ~~[#11](https://github.com/StormDoragon/vizu-four/issues/11) **status colors, running indicator, graph layout**~~ — shipped. A single `statusStyles.ts` module (color + a redundant non-color glyph per status, WCAG 1.4.1) replaced three independently hand-copied color maps (JobNode, MatrixExplorer, StepDetailPanel) that had already quietly drifted - e.g. "pending" alone had three different colors across them, one of which (`#484f58`) contrast-checked at ~2.2:1 against every panel background, below even the 3:1 WCAG non-text minimum. Not-yet-run states now render as a hollow ring rather than a filled dot, so "pending" and "skipped" are told apart by shape as well as shade. The "currently executing" indicator is a real client-driven spinning ring, not the old `animate-pulse` on a server "running" status that (in this synchronous request/response engine) resolves and clears entirely within one HTTP round trip and was never actually observable from the browser. Graph layout moved from a fixed `level * 340, index * 280` grid to `@dagrejs/dagre`'s layered algorithm, sized per node from its actual step count/matrix selector - verified against a new 12-job example (`06-large-graph.yml`) with real fan-out/fan-in: zero overlapping boxes, confirmed both by a Playwright bounding-box check and by eye.
- [x] ~~[#12](https://github.com/StormDoragon/vizu-four/issues/12) **light theme + responsive layout**~~ — shipped. Every hardcoded `bg-*`/`text-white`/`text-gray-N`/`border-gray-N` color became a CSS-custom-property-backed Tailwind token (`bg`, `status`, `ink`) so a `[data-theme="light"]` selector in `globals.css` can override the whole palette at once; dark's own token values were chosen to be byte-identical to the RGB the app already rendered, so dark mode is provably unchanged. A toggle in the top bar flips `data-theme` and persists the choice to `localStorage` (`src/lib/theme.ts`), applied by a synchronous inline `<script>` in `<head>` before hydration so a returning light-mode visitor never sees a dark flash. The 6 solid-color-filled buttons (`bg-status-running`/`bg-status-failure`) keep literal `text-white` in both themes on purpose — white-on-blue doesn't need to invert with the theme. Layout: the graph/right-panel row and the step-detail two-column grid now stack instead of clipping below `lg` (tablet width), verified live at 820px in both themes.
- [x] ~~[#10](https://github.com/StormDoragon/vizu-four/issues/10) **matrix switcher polish + "debug this combination only"**~~ — shipped. A search/filter box appears above the lane list once a matrix's combinations exceed a threshold (>8 in the job node's dropdown, >6 across the Matrix tab) — small matrices stay unfiltered, since a box would just be one more thing to click past for 2-3 combos. "Debug this combination only" is a new 🎯 toggle on every lane row (job node and Matrix tab alike) that both makes that lane the steppable one and marks it "focused" - purely client-side view state (`focusedLaneId` in `DebuggerApp`), not sent to the engine. While a lane is focused, every sibling combination across every matrix job dims to 40% opacity in the Matrix tab, and the badge is visible from three places at once so it's unambiguous without opening a tab to check: an amber "FOCUSED" tag + border on the job node itself, a "Focused: ⟨job⟩ — ⟨combo⟩" banner with a one-click "Show all combinations" in the Matrix tab, and a dismissible pill in the top bar. Verified live with a 12-combination matrix (4 node versions × 3 OSes) in both themes.
- [ ] [#9](https://github.com/StormDoragon/vizu-four/issues/9) playground internals → [#8](https://github.com/StormDoragon/vizu-four/issues/8) share links → P3/P4 untouched.

### Explicitly deferred

**No investment in [#14](https://github.com/StormDoragon/vizu-four/issues/14) (Docker execution) or [#15](https://github.com/StormDoragon/vizu-four/issues/15) (import a real GitHub run) until the simulation-only demo has been in front of real users for a while.**

#15 is the easier one to talk yourself into early, because it looks like a demo booster. It isn't cheap: GitHub App registration, OAuth, token storage, plus reconstructing run context from a log format that doesn't expose what's needed. Same "wait for feedback" bar as Docker.

---

## Tracked backlog

Sections below mirror the `priority:*` labels on GitHub and are the canonical list. The sequence above is what to actually pick up next.

### P0 — Make it actually useful (next 1–2 weeks)
- [ ] Deploy a public demo (Vercel or similar) with 4–5 preloaded example workflows ([#1](https://github.com/StormDoragon/vizu-four/issues/1)) — **scoped to simulation-only; see sequence step 1**
- [x] Improve common `uses:` handlers (`actions/checkout`, `setup-node`, `setup-python`, `cache`, `upload/download-artifact`, `docker/login-action`) ([#2](https://github.com/StormDoragon/vizu-four/issues/2), merged via [#7](https://github.com/StormDoragon/vizu-four/pull/7))
- [x] Add "Mock outputs" UI for any `uses:` step (so users can stub results without real containers) ([#3](https://github.com/StormDoragon/vizu-four/issues/3), shipped in [`ec110d8`](https://github.com/StormDoragon/vizu-four/commit/ec110d8)) — since extended to `run:` steps, with a mockable exit code and stderr
- [x] Better failure UX: auto-jump to failed step + prominent stdout/stderr + AI explanation panel ([#4](https://github.com/StormDoragon/vizu-four/issues/4), shipped in [`dd694b4`](https://github.com/StormDoragon/vizu-four/commit/dd694b4))
- [x] Keyboard shortcuts for debugger controls (Step / Continue / Run to end) ([#5](https://github.com/StormDoragon/vizu-four/issues/5))
- [x] Persist breakpoints + What-If overrides (localStorage) ([#6](https://github.com/StormDoragon/vizu-four/issues/6))
- [x] Open a workflow from the repo + run against a real working tree (opt-in) ([#29](https://github.com/StormDoragon/vizu-four/issues/29))
- [x] UI regression test net + lint script ([#30](https://github.com/StormDoragon/vizu-four/issues/30))
- [x] Harden expression engine with more real-world edge-case tests ([#13](https://github.com/StormDoragon/vizu-four/issues/13)) — *was P1*

### P1 — Core experience polish (weeks 2–4)
- [x] Time-travel: jump to any previous step and inspect full state at that point ([#17](https://github.com/StormDoragon/vizu-four/issues/17)) — *was P2; mostly built already*
- [ ] "Share session" link (serialize workflow + current debug state) ([#8](https://github.com/StormDoragon/vizu-four/issues/8))
- [ ] Expression playground improvements: show intermediate evaluation steps ([#9](https://github.com/StormDoragon/vizu-four/issues/9))
- [x] Matrix lane switcher polish + "debug this combination only" ([#10](https://github.com/StormDoragon/vizu-four/issues/10))
- [x] Visual improvements: clearer status colors, running indicators, better graph layout ([#11](https://github.com/StormDoragon/vizu-four/issues/11))
- [x] Dark/light theme polish + basic responsive layout ([#12](https://github.com/StormDoragon/vizu-four/issues/12))

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
