# Prioritized Checklist — Actions Visual Debugger (`vizu-four`)

Every item below is tracked as a GitHub issue (linked inline) so status stays visible outside this file.

### P0 — Make it actually useful (next 1–2 weeks)
- [ ] Deploy a public demo (Vercel or similar) with 4–5 preloaded example workflows ([#1](https://github.com/StormDoragon/vizu-four/issues/1))
- [x] Improve common `uses:` handlers (`actions/checkout`, `setup-node`, `setup-python`, `cache`, `upload/download-artifact`, `docker/login-action`) ([#2](https://github.com/StormDoragon/vizu-four/issues/2), merged via [#7](https://github.com/StormDoragon/vizu-four/pull/7))
- [x] Add "Mock outputs" UI for any `uses:` step (so users can stub results without real containers) ([#3](https://github.com/StormDoragon/vizu-four/issues/3), shipped in [`ec110d8`](https://github.com/StormDoragon/vizu-four/commit/ec110d8))
- [ ] Better failure UX: auto-jump to failed step + prominent stdout/stderr + AI explanation panel ([#4](https://github.com/StormDoragon/vizu-four/issues/4))
- [ ] Keyboard shortcuts for debugger controls (Step / Continue / Run to end) ([#5](https://github.com/StormDoragon/vizu-four/issues/5))
- [ ] Persist breakpoints + What-If overrides (localStorage) ([#6](https://github.com/StormDoragon/vizu-four/issues/6))

### P1 — Core experience polish (weeks 2–4)
- [ ] "Share session" link (serialize workflow + current debug state) ([#8](https://github.com/StormDoragon/vizu-four/issues/8))
- [ ] Expression playground improvements: show intermediate evaluation steps ([#9](https://github.com/StormDoragon/vizu-four/issues/9))
- [ ] Matrix lane switcher polish + "debug this combination only" ([#10](https://github.com/StormDoragon/vizu-four/issues/10))
- [ ] Visual improvements: clearer status colors, running indicators, better graph layout ([#11](https://github.com/StormDoragon/vizu-four/issues/11))
- [ ] Dark/light theme polish + basic responsive layout ([#12](https://github.com/StormDoragon/vizu-four/issues/12))
- [ ] Harden expression engine with more real-world edge-case tests ([#13](https://github.com/StormDoragon/vizu-four/issues/13))

### P2 — Real power features (months 1–2)
- [ ] Real container / Docker execution for `uses:` steps (biggest technical leap) ([#14](https://github.com/StormDoragon/vizu-four/issues/14))
- [ ] GitHub App / PAT integration: import a real failed run + reconstruct context ([#15](https://github.com/StormDoragon/vizu-four/issues/15))
- [ ] "Create Fix PR" from AI suggestion ([#16](https://github.com/StormDoragon/vizu-four/issues/16))
- [ ] Time-travel: jump to any previous step and inspect full state at that point ([#17](https://github.com/StormDoragon/vizu-four/issues/17))
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

---

**Recommended immediate focus:**
Finish everything in **P0**, then ship the public demo. That gives real user feedback before investing heavily in the harder P2 items (especially Docker execution).
