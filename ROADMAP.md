# Prioritized Checklist — Vizu Debug & Release (`vizu-four`)

## Release Intelligence — first integrated MVP

Implemented locally alongside Debug; this entry does not claim a deployment:

- [x] Public repository + base/head flow and module navigation.
- [x] Bounded server-side public GitHub collection with immutable evidence links.
- [x] Deterministic classification, exclusions, and one typed canonical analysis.
- [x] Opt-in Anthropic wording with the shared AI budget and deterministic fallback.
- [x] Technical/customer Markdown, evidence inspection, and security review handling.
- [x] Validation, collection, evidence, AI, API, and UI regression tests.

Current limits: 40 commits, 10 PR lookups, 14 total GitHub requests, 300 files,
metadata-only impact, no grouping, no persistent result history. See README
for exact time, body, concurrency, and request limits. Release never executes
repository code and does not change the simulation-only public-debugger policy.

Next three implementation steps:

1. Evaluate a maintainer-reviewed set of real release ranges; measure false
   inclusion/exclusion and unsupported claims, then refine classification.
   *In progress:* `src/lib/release/eval/` holds the harness, metrics, and a
   173-case corpus. **Every case is synthetic**: hand-labeled development data
   by the implementer, not evidence of real-world accuracy. `maintainer-reviewed`
   cases are tracked separately; they require provenance (repository, immutable
   base/head SHAs, reviewer, date, review-record link) and must match every
   stated label, with no accepted mismatches. A well-formed provenance record is
   a pointer, not proof: the gate cannot verify that a human actually reviewed
   anything.

   Current measurements (synthetic only; accepted mismatches are counted):
   - Security: 42 of 45 positives flagged; 3 misses, all accepted and **pending
     maintainer decisions, not completed fixes**: `sec-bare-token-gap` ("Stop
     logging tokens in request traces"), and the original reproductions
     `sec-open-token-logs` ("fix: token leaked in logs") and `sec-open-keys-logs`
     ("fix: keys exposed in logs"). Their look-alike negatives ("fix: parser
     tokens leaked into the AST", "fix: object keys exposed in the debug view")
     are kept as guards and must stay unflagged, so the boundary between a bare
     token/key and a secret is documented, not papered over. 3 false alarms among
     15 negatives: 2 pre-existing ("security policy" docs, "credential manager")
     and 1 accepted (`sec-guard-sanitize-ui`).
   - Breaking: 35 of 36 positives flagged; 1 miss, accepted and pending
     (`br-incompatible-gap`: "incompatible with <runtime>" is also a bug report).
     0 false alarms among 21 negatives.
   - Inclusion: 5 false inclusions (CI/typo "Fix" noise) and 14 false exclusions
     (plain-English verbs such as `Fixed`, `Support`, `Implement`; prefixes such
     as emoji, `[feature]`, `PROJ-123:`; the accepted gaps above that are also
     excluded).

   What the tests enforce: each required security/breaking positive is asserted
   by id (42 and 35); each protected negative must keep its flag off per case
   (12 security, 21 breaking); accepted mismatches are pinned to five named
   cases; the aggregate ratchet may not worsen; the report lists accepted and
   unaccepted failures separately; ratios with no positives print N/A, never
   100%. Negation ("avoid", "prevent", "don't", ...) looks back 30 characters
   within one clause: a `;` or `.` ends it, and it crosses a line break only when
   the previous line ends on the negator ("fix: do not" / "drop support ..."),
   so "fix: prevent crashes; drop support for Node 16" is breaking. A phrase may
   wrap once, with spaces around the break; a blank line never matches. Detection
   time was measured linear on these input families, not proven for every input:
   repeated negated phrases (2.0x per doubling, 0.2 MB to 7 MB; a 1.8 MB
   single-line message takes ~35 ms), a negator followed by a long run of spaces
   (64,000 spaces: ~1 ms, after a quadratic backtracking bug was fixed), and a
   battery of 30 hostile 64 KB shapes (each under 5 ms). Regexes use bounded
   repeats and no unrestricted `.*`. Known limits:
   a leading "fix" is not treated as evidence that compatibility is preserved; confusable letters (e.g. Cyrillic for Latin) are
   not normalized; "log/logs" next to a secret noun is flagged conservatively.

   Open maintainer decisions (not resolved by the implementer): whether a revert
   belongs in release notes; whether typo-only fixes belong in technical notes;
   a dependency-bump policy; whether unmarked removals count as breaking;
   whether sanitize/UI wording and bare token/key wording (including the two
   reproductions above) are accepted review triggers; whether "incompatible
   with <runtime>" means breaking.
   Still needed: maintainer-labeled real ranges and an unsupported-claim measure
   for the opt-in AI wording.
2. Add local draft editing and explicit include/exclude overrides while
   preserving canonical evidence and security review markers.
3. Add bounded, cached pagination and PR grouping with explicit completeness
   tracking; introduce a shared limiter before supporting multiple instances.

Private access, GitHub App installation, authentication, billing, webhooks,
hosted changelogs, Slack, and publishing remain outside this MVP.

---

The historical Debug items below are tracked as GitHub issues (linked inline).

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

Local CI is **green on HEAD**: typecheck, lint, 714 tests, production build — and a headless-browser pass of every example, the failure demo, a zero-step workflow and the playground reports no page errors, console errors or 5xx responses. Formal sign-off still wants deploy-SHA confirmation on Render, and **#14** before any shared-host real `run:` execution.

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
