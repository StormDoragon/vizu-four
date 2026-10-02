import type { EvalCase } from "./types";

type Row = [id: string, message: string, expected: EvalCase["expected"], extra?: { pullTitle?: string; note?: string }];

const inc = (category: NonNullable<EvalCase["expected"]["category"]>) => ({ releaseWorthy: true, category });
/** Exclusions are scored on inclusion only: internal vs other are equivalent outcomes (both omitted from notes). */
const exc = () => ({ releaseWorthy: false });

/** Synthetic: hand-labeled probes of known-hard metadata shapes. Not evidence of real-world accuracy. */
const rows: Row[] = [
  // Conventional commits
  ["cc-feat", "feat: add CSV export", inc("added")],
  ["cc-feat-scope", "feat(api): add pagination to list endpoints", inc("added")],
  ["cc-fix", "fix: handle empty config file", inc("fixed")],
  ["cc-fix-scope", "fix(parser): reject unterminated strings", inc("fixed")],
  ["cc-perf", "perf: cache compiled templates", inc("improved")],
  ["cc-docs", "docs: document rate limits", inc("documentation")],
  ["cc-chore", "chore: refresh tooling", exc()],
  ["cc-ci", "ci: cache node_modules", exc()],
  ["cc-test", "test: cover empty input", exc()],
  ["cc-refactor", "refactor: split parser module", exc()],
  ["cc-style", "style: run prettier", exc()],
  ["cc-build", "build: bump webpack to 5.90", exc()],
  ["cc-breaking-bang", "feat!: drop Node 16 support", { releaseWorthy: true, category: "breaking", breakingChange: true }],
  ["cc-breaking-scope-bang", "refactor(api)!: rename createClient to connect", { releaseWorthy: true, category: "breaking", breakingChange: true }],
  ["cc-breaking-footer", "feat: new auth flow\n\nBREAKING CHANGE: tokens must now be refreshed hourly", { releaseWorthy: true, category: "breaking", breakingChange: true }],
  ["cc-uppercase-type", "Fix: correct off-by-one in pager", inc("fixed")],
  ["cc-revert", 'revert: "feat: add CSV export"', { releaseWorthy: false }, { note: "A revert undoes a change; it should not be announced as new." }],

  // Plain-English commits
  ["pe-add", "Add dark mode toggle", inc("added")],
  ["pe-introduce", "Introduce webhook retries", inc("added")],
  ["pe-fix", "Fix crash when saving without a title", inc("fixed")],
  ["pe-fixes", "Fixes #214: timezone offset in exports", inc("fixed"), { note: "Past-tense/issue-linking phrasing is very common." }],
  ["pe-fixed", "Fixed flaky pagination on slow networks", inc("fixed")],
  ["pe-resolve", "Resolve race condition in session store", inc("fixed")],
  ["pe-improve", "Improve search relevance", inc("improved")],
  ["pe-optimize", "Optimize image decoding", inc("improved")],
  ["pe-speed", "Speed up cold start by 40%", inc("improved")],
  ["pe-support", "Support Postgres 16", inc("added")],
  ["pe-implement", "Implement bulk delete", inc("added")],
  ["pe-allow", "Allow custom headers on outgoing requests", inc("added")],
  ["pe-remove", "Remove deprecated v1 endpoints", { releaseWorthy: true }, { note: "Removal is user-visible; at minimum it must not be silently dropped." }],
  ["pe-update-docs", "Update README with install steps", inc("documentation")],
  ["pe-typo", "Fix typo in README", exc(), { note: "Typo-only doc fixes are noise in customer notes." }],
  ["pe-update-ci", "Update CI to Node 22", exc()],
  ["pe-add-tests", "Add tests for the parser", exc()],
  ["pe-run-lint", "Run eslint --fix", exc()],
  ["pe-wip", "WIP", exc(), { note: "No signal at all; must not be announced." }],
  ["pe-misc", "misc cleanup", exc()],
  ["pe-lowercase-add", "add retry button to upload dialog", inc("added"), { note: "Lowercase imperative is common in casual repos." }],
  ["pe-lowercase-fix", "fix login redirect loop", inc("fixed")],

  // Merge / bot / release plumbing
  ["bot-merge-pr", "Merge pull request #12 from acme/feature-x", exc()],
  ["bot-merge-branch", "Merge branch 'main' into feature-x", exc()],
  ["bot-bump", "Bump lodash from 4.17.20 to 4.17.21", exc()],
  ["bot-bump-scope", "chore(deps): bump react from 18.2.0 to 18.3.0", exc()],
  ["bot-deps-dev", "build(deps-dev): bump vitest from 1.0.0 to 1.1.0", exc()],
  ["bot-release-commit", "Release v1.4.0", exc(), { note: "Version-bump/release commits are plumbing, not a change." }],
  ["bot-version", "chore(release): 1.4.0", exc()],
  ["bot-changelog", "Update CHANGELOG", exc()],
  ["bot-pr-title-wins", "wip stuff", { releaseWorthy: true, category: "added" }, { pullTitle: "feat: add SSO login" }],
  ["bot-merge-with-pr-title", "Merge pull request #44 from acme/sso", { releaseWorthy: true, category: "added" }, { pullTitle: "Add SSO login", note: "The merged PR title should supersede the merge-commit subject." }],

  // Security
  ["sec-cve", "fix: patch CVE-2024-12345 in the XML parser", { releaseWorthy: true, category: "security", securitySensitive: true }],
  ["sec-xss", "Fix XSS in comment rendering", { releaseWorthy: true, category: "security", securitySensitive: true }],
  ["sec-csrf", "fix(auth): add CSRF token to forms", { releaseWorthy: true, category: "security", securitySensitive: true }],
  ["sec-traversal", "Reject path traversal in upload names", { releaseWorthy: true, category: "security", securitySensitive: true }],
  ["sec-bypass", "Close authentication bypass on /admin", { releaseWorthy: true, category: "security", securitySensitive: true }],
  ["sec-injection", "Prevent SQL injection in search", { releaseWorthy: true, category: "security", securitySensitive: true }],
  ["sec-ssrf", "Block SSRF via webhook URLs", { releaseWorthy: true, category: "security", securitySensitive: true }, { note: "SSRF is a core vulnerability class missing from the keyword list." }],
  ["sec-sanitize", "Sanitize HTML in user bios", { releaseWorthy: true, securitySensitive: true }, { note: "No security keyword, but clearly a hardening change." }],
  ["sec-leak", "Stop leaking API keys into logs", { releaseWorthy: true, securitySensitive: true }, { note: "Secret exposure phrased without the word 'security'." }],
  ["sec-body-only", "fix: tighten input handling\n\nThis resolves a remote code execution issue (RCE) in the importer.", { releaseWorthy: true, category: "security", securitySensitive: true }],
  ["sec-false-alarm-docs", "docs: add security policy link to README", { releaseWorthy: true, category: "documentation", securitySensitive: false }, { note: "Mentions 'security' but is not a vulnerability fix; a false alarm costs a manual review, not a miss." }],
  ["sec-credential-ui", "Add credential manager screen", { releaseWorthy: true, category: "added", securitySensitive: false }, { note: "'credential' as a product noun, not a vulnerability." }],

  // Breaking, plain English
  ["br-plain-remove", "Remove support for the legacy config format (breaking)", { releaseWorthy: true, breakingChange: true }, { note: "Breaking marked in prose rather than via the Conventional Commits syntax." }],
  ["br-plain-rename", "Rename --out flag to --output (breaking change)", { releaseWorthy: true, breakingChange: true }],
  ["br-not-breaking", "fix: avoid breaking the layout on narrow screens", { releaseWorthy: true, category: "fixed", breakingChange: false }, { note: "The word 'breaking' is not a breaking change." }],

  ["sec-xxe", "Disable external entities to prevent XXE", { releaseWorthy: true, securitySensitive: true }],
  ["sec-open-redirect", "Fix open redirect on the login callback", { releaseWorthy: true, securitySensitive: true }],
  ["sec-priv-esc", "Prevent privilege escalation through role import", { releaseWorthy: true, securitySensitive: true }],
  ["sec-token-exposed", "fix: session token was exposed in query strings", { releaseWorthy: true, securitySensitive: true }],
  ["sec-password-leak", "Password hashes leaked in debug endpoint", { releaseWorthy: true, securitySensitive: true }],
  ["sec-guard-expose-ui", "Add support for exposing theme tokens to plugins", { releaseWorthy: true, category: "added", securitySensitive: false }, { note: "Design tokens, not secrets: 'expose' next to 'tokens' must not alarm." }],
  ["sec-guard-leak-memory", "Fix memory leak in the websocket client", { releaseWorthy: true, category: "fixed", securitySensitive: false }, { note: "A memory leak is not a secret leak." }],
  ["sec-guard-sanitize-ui", "Add sanitize button to the cleanup toolbar", { releaseWorthy: true }, { note: "Known cost: 'sanitize' flags this for manual review (category/security not scored)." }],
  ["br-bracket", "[BREAKING] Change default port to 8080", { releaseWorthy: true, breakingChange: true }],
  ["br-colon-prefix", "BREAKING: remove the --legacy flag", { releaseWorthy: true, breakingChange: true }],
  ["br-incompatible", "Switch to a new storage format, not backwards compatible", { releaseWorthy: true, breakingChange: true }],
  ["br-lowercase-footer", "feat: new auth flow\n\nbreaking change: tokens expire hourly", { releaseWorthy: true, breakingChange: true }],
  ["br-guard-bare-breaking", "Fix breaking layout on tablet screens", { releaseWorthy: true, category: "fixed", breakingChange: false }, { note: "Bare 'breaking' is not a marker." }],
  ["br-guard-links", "fix: stop breaking links in email templates", { releaseWorthy: true, category: "fixed", breakingChange: false }],
  ["br-guard-not-compatible", "Fix chart that was not compatible with dark mode", { releaseWorthy: true, category: "fixed", breakingChange: false }],

  // Ambiguous / noisy
  ["am-update", "Update dependencies", exc(), { note: "Generic dependency updates are not user-facing." }],
  ["am-merge-conflict", "Fix merge conflicts", exc(), { note: "Starts with 'Fix' but is repo plumbing." }],
  ["am-fix-ci", "Fix failing CI", exc()],
  ["am-fix-tests", "Fix flaky tests", exc()],
  ["am-fix-lint", "Fix lint errors", exc()],
  ["am-emoji", "✨ Add onboarding checklist", inc("added"), { note: "Gitmoji prefixes are common." }],
  ["am-bracket-prefix", "[feature] add team invites", inc("added"), { note: "Bracketed tag prefixes are common." }],
  ["am-ticket-prefix", "PROJ-123: fix duplicate invoices", inc("fixed"), { note: "Ticket-id prefixes are common." }],
  ["am-empty-ish", "update", exc()],
  ["am-body-signal", "Cleanup\n\nfix: users could not reset passwords after email change", { releaseWorthy: true, category: "fixed" }, { note: "The user-facing fix lives in the body, not the subject." }],
];

export const corpus: EvalCase[] = rows.map(([id, message, expected, extra]) => ({ id, source: "synthetic", message, expected, ...extra }));
