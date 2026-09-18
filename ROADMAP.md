# Prioritized Checklist — Actions Visual Debugger (`vizu-four`)

### P0 — Make it actually useful (next 1–2 weeks)
- [ ] Deploy a public demo (Vercel or similar) with 4–5 preloaded example workflows
- [ ] Improve common `uses:` handlers (`actions/checkout`, `setup-node`, `setup-python`, `cache`, `upload/download-artifact`, `docker/login-action`)
- [ ] Add "Mock outputs" UI for any `uses:` step (so users can stub results without real containers)
- [ ] Better failure UX: auto-jump to failed step + prominent stdout/stderr + AI explanation panel
- [ ] Keyboard shortcuts for debugger controls (Step / Continue / Run to end)
- [ ] Persist breakpoints + What-If overrides (localStorage)

### P1 — Core experience polish (weeks 2–4)
- [ ] "Share session" link (serialize workflow + current debug state)
- [ ] Expression playground improvements: show intermediate evaluation steps
- [ ] Matrix lane switcher polish + "debug this combination only"
- [ ] Visual improvements: clearer status colors, running indicators, better graph layout
- [ ] Dark/light theme polish + basic responsive layout
- [ ] Harden expression engine with more real-world edge-case tests

### P2 — Real power features (months 1–2)
- [ ] Real container / Docker execution for `uses:` steps (biggest technical leap)
- [ ] GitHub App / PAT integration: import a real failed run + reconstruct context
- [ ] "Create Fix PR" from AI suggestion
- [ ] Time-travel: jump to any previous step and inspect full state at that point
- [ ] Support for reusable workflows and composite actions with better fidelity

### P3 — Productization (months 2–4)
- [ ] User accounts + session history
- [ ] Free tier (public repos) vs paid tiers
- [ ] VS Code / Cursor extension that launches or embeds the debugger
- [ ] Basic team features (shared sessions, org secrets support)
- [ ] Collect anonymized failure patterns to improve AI explanations

### P4 — Longer-term / scale
- [ ] Self-hosted / enterprise option
- [ ] Windows & macOS runner emulation
- [ ] Full high-fidelity microVM runner (beyond Docker)
- [ ] Billing, SSO, audit logs, admin dashboard

---

**Recommended immediate focus:**
Finish everything in **P0**, then ship the public demo. That gives real user feedback before investing heavily in the harder P2 items (especially Docker execution).
