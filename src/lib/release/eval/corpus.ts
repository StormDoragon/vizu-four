import type { EvalCase } from "./types";

type Extra = Pick<EvalCase, "pullTitle" | "note" | "acceptedMismatch" | "openPolicy">;
type Row = [id: string, message: string, expected: EvalCase["expected"], extra?: Extra];

/** Built from code points so the file stays ASCII and the characters cannot be mangled by an editor. */
const NB_HYPHEN = String.fromCodePoint(0x2011);
const NB_SPACE = String.fromCodePoint(0x00a0);
const FULLWIDTH_SSRF = String.fromCodePoint(0xff33, 0xff33, 0xff32, 0xff26);
const LATE_FILLER = "filler text ".repeat(150);

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
  ["cc-revert", 'revert: "feat: add CSV export"', { releaseWorthy: false }, { note: "A revert is not a new feature.", openPolicy: "A revert can remove a previously shipped feature; whether it belongs in release notes is a maintainer policy." }],

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
  ["pe-remove", "Remove deprecated v1 endpoints", { releaseWorthy: true }, { note: "Removal is user-visible; at minimum it must not be silently dropped.", openPolicy: "Whether an unmarked removal counts as breaking is a maintainer policy; breaking is deliberately not asserted." }],
  ["pe-update-docs", "Update README with install steps", inc("documentation")],
  ["pe-typo", "Fix typo in README", exc(), { note: "Typo-only doc fixes are noise in customer notes.", openPolicy: "One global inclusion decision is scored; whether technical notes should keep typo fixes is a maintainer policy." }],
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
  ["bot-bump", "Bump lodash from 4.17.20 to 4.17.21", exc(), { openPolicy: "Dependency-bump exclusion needs a defined policy; metadata alone does not show a bump is irrelevant." }],
  ["bot-bump-scope", "chore(deps): bump react from 18.2.0 to 18.3.0", exc(), { openPolicy: "Dependency-bump exclusion needs a defined policy." }],
  ["bot-deps-dev", "build(deps-dev): bump vitest from 1.0.0 to 1.1.0", exc(), { openPolicy: "Dependency-bump exclusion needs a defined policy." }],
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

  // Security: vulnerability phrases (R1)
  ["sec-timing", "Use constant-time comparison to stop a timing attack on login", { releaseWorthy: true, securitySensitive: true }],
  ["sec-overflow", "Fix buffer overflow in the image decoder", { releaseWorthy: true, securitySensitive: true }],
  ["sec-zipslip", "Prevent zip slip when extracting archives", { releaseWorthy: true, securitySensitive: true }],
  ["sec-proto", "Fix prototype pollution in deep merge", { releaseWorthy: true, securitySensitive: true }],
  ["sec-deser-unsafe", "Replace unsafe deserialization of session cookies", { releaseWorthy: true, securitySensitive: true }],
  ["sec-deser-insecure", "Fix insecure deserialization in the importer", { releaseWorthy: true, securitySensitive: true }],
  ["sec-fullwidth", `Block ${FULLWIDTH_SSRF} via webhook URLs`, { releaseWorthy: true, securitySensitive: true }, { note: "Full-width Latin letters normalize (NFKC) to SSRF." }],
  // Security: secret exposure, verb-first and noun-first (R1)
  ["sec-secrets-noun", "Secrets exposure in build logs", { releaseWorthy: true, securitySensitive: true }],
  ["sec-password-noun", "Password disclosure through verbose error pages", { releaseWorthy: true, securitySensitive: true }],
  ["sec-apikey-leak", "API key leak in crash reports", { releaseWorthy: true, securitySensitive: true }],
  ["sec-session-token-noun", "Session token exposure in the referrer header", { releaseWorthy: true, securitySensitive: true }],
  ["sec-bearer-logged", "Bearer tokens logged on 401 responses", { releaseWorthy: true, securitySensitive: true }],
  ["sec-keys-dumped", "Access keys dumped by the debug endpoint", { releaseWorthy: true, securitySensitive: true }],
  ["sec-key-printed", "Stop printing the private key to the console", { releaseWorthy: true, securitySensitive: true }],
  ["sec-hardcoded-secret", "Remove hardcoded secret from the deploy script", { releaseWorthy: true, securitySensitive: true }],
  ["sec-hardcoded-hyphen", "Credentials hard-coded in the sample config", { releaseWorthy: true, securitySensitive: true }],
  ["sec-wrapped-lf", "Stop leaking\nAPI keys in logs", { releaseWorthy: true, securitySensitive: true }, { note: "Phrase split by ordinary hard wrapping (LF)." }],
  ["sec-wrapped-crlf", "Stop leaking\r\nAPI keys in logs", { releaseWorthy: true, securitySensitive: true }, { note: "Same phrase with CRLF; must match the LF case." }],
  ["sec-nb-space", `Stop leaking${NB_SPACE}API keys`, { releaseWorthy: true, securitySensitive: true }, { note: "Non-breaking space normalizes to a space." }],
  ["sec-late-footer", `fix: tighten handling\n\n${LATE_FILLER}\nThis also closes an authentication bypass.`, { releaseWorthy: true, securitySensitive: true }, { note: "Marker after more than 1200 characters; detection runs before truncation." }],
  ["sec-bare-token-gap", "Stop logging tokens in request traces", { releaseWorthy: true, securitySensitive: true }, { acceptedMismatch: { kinds: ["security miss", "false exclusion", "category"], reason: "A bare 'token' is also design/parser vocabulary and is deliberately not treated as a secret." }, openPolicy: "Whether unqualified token/key logging should alarm is a maintainer decision." }],
  // Security: R9 spellings and log vocabulary
  ["sec-r9-hyphen", "API-key leaked in logs", { releaseWorthy: true, securitySensitive: true }],
  ["sec-r9-nb-hyphen", `API${NB_HYPHEN}key leaked in logs`, { releaseWorthy: true, securitySensitive: true }, { note: "U+2011 non-breaking hyphen normalizes to '-'." }],
  ["sec-r9-nospace", "apikey exposed in logs", { releaseWorthy: true, securitySensitive: true }],
  ["sec-r9-logs", "Remove API keys from the logs", { releaseWorthy: true, securitySensitive: true }],
  ["sec-r9-log", "Stop writing the API key to the log", { releaseWorthy: true, securitySensitive: true }],
  ["sec-r9-logged", "API key logged on startup", { releaseWorthy: true, securitySensitive: true }],
  ["sec-r9-logging", "Stop logging API keys", { releaseWorthy: true, securitySensitive: true }],
  // Security: unresolved boundary. The two reproductions are kept verbatim, with their harder look-alike negatives beside them.
  ["sec-open-token-logs", "fix: token leaked in logs", { releaseWorthy: true, securitySensitive: true }, { acceptedMismatch: { kinds: ["security miss"], reason: "PENDING maintainer decision, not a completed fix: a bare 'token' is also parser/design vocabulary, so it is not treated as a secret." }, openPolicy: "Should an unqualified token/key beside an exposure verb and a sink such as 'logs' alarm? Needs a maintainer decision." }],
  ["sec-open-keys-logs", "fix: keys exposed in logs", { releaseWorthy: true, securitySensitive: true }, { acceptedMismatch: { kinds: ["security miss"], reason: "PENDING maintainer decision, not a completed fix: a bare 'keys' is also ordinary object/map vocabulary." }, openPolicy: "Same boundary as sec-open-token-logs." }],
  ["sec-guard-parser-leak", "fix: parser tokens leaked into the AST", { releaseWorthy: true, category: "fixed", securitySensitive: false }, { note: "Same shape as sec-open-token-logs; must stay unflagged until the boundary is decided." }],
  ["sec-guard-object-keys-exposed", "fix: object keys exposed in the debug view", { releaseWorthy: true, category: "fixed", securitySensitive: false }, { note: "Same shape as sec-open-keys-logs; must stay unflagged until the boundary is decided." }],
  ["sec-guard-paragraph-lf", "Fix memory leak.\n\nUpdate API keys docs", { releaseWorthy: true, securitySensitive: false }, { note: "Blank line separates paragraphs." }],
  ["sec-guard-paragraph-spaces", "Fix memory leak.\n  \nUpdate API keys docs", { releaseWorthy: true, securitySensitive: false }, { note: "A whitespace-only line is a blank line." }],
  ["sec-guard-paragraph-tab-crlf", "Fix memory leak.\r\n\t\r\nUpdate API keys docs", { releaseWorthy: true, securitySensitive: false }, { note: "Tab-only line, CRLF." }],
  // Security: protected negatives (R1/R5)
  ["sec-guard-parser-tokens", "Add a debug view that prints parser tokens", { releaseWorthy: true, category: "added", securitySensitive: false }],
  ["sec-guard-design-tokens", "Add an export that dumps design tokens to JSON", { releaseWorthy: true, category: "added", securitySensitive: false }],
  ["sec-guard-object-keys", "Add logging of object keys when validation fails", { releaseWorthy: true, category: "added", securitySensitive: false }],
  ["sec-guard-hardcoded-color", "Fix hardcoded colors by using theme variables", { releaseWorthy: true, category: "fixed", securitySensitive: false }],
  ["sec-guard-memory-leak-keys", "Fix memory leak when caching cache keys", { releaseWorthy: true, category: "fixed", securitySensitive: false }, { note: "'leak' near 'keys' but no secret noun: a memory leak, not exposure." }],

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
  ["sec-guard-sanitize-ui", "Add sanitize button to the cleanup toolbar", { releaseWorthy: true, category: "added", securitySensitive: false }, { acceptedMismatch: { kinds: ["security false alarm", "category"], reason: "Conservative: any 'sanitiz*' wording is flagged for manual review." }, openPolicy: "Whether conservative sanitize/UI alarms are an accepted review trigger is a maintainer decision." }],
  ["br-bracket", "[BREAKING] Change default port to 8080", { releaseWorthy: true, breakingChange: true }],
  ["br-colon-prefix", "BREAKING: remove the --legacy flag", { releaseWorthy: true, breakingChange: true }],
  ["br-incompatible", "Switch to a new storage format, not backwards compatible", { releaseWorthy: true, breakingChange: true }],
  ["br-lowercase-footer", "feat: new auth flow\n\nbreaking change: tokens expire hourly", { releaseWorthy: true, breakingChange: true }],
  ["br-guard-bare-breaking", "Fix breaking layout on tablet screens", { releaseWorthy: true, category: "fixed", breakingChange: false }, { note: "Bare 'breaking' is not a marker." }],
  ["br-guard-links", "fix: stop breaking links in email templates", { releaseWorthy: true, category: "fixed", breakingChange: false }],
  ["br-guard-not-compatible", "Fix chart that was not compatible with dark mode", { releaseWorthy: true, category: "fixed", breakingChange: false }],

  // Breaking: narrowed forms (R3/R4)
  ["br-plural-footer", "feat: new storage\n\nBREAKING CHANGES: the v1 format is removed", { releaseWorthy: true, breakingChange: true }],
  ["br-bracket-hyphen", "[breaking-change] Rename the connect API", { releaseWorthy: true, breakingChange: true }],
  ["br-bracket-after-type", "feat(api): [BREAKING] rename connect to open", { releaseWorthy: true, breakingChange: true }],
  ["br-drop-support", "Drop support for Node 16", { releaseWorthy: true, breakingChange: true }],
  ["br-dropped-support", "Dropped support for Python 3.8", { releaseWorthy: true, breakingChange: true }],
  ["br-remove-support", "Remove support for the legacy config format", { releaseWorthy: true, breakingChange: true }],
  ["br-no-longer-supports", "The client no longer supports Node 16", { releaseWorthy: true, breakingChange: true }],
  ["br-unicode-hyphen", `Adopt a new storage format (backwards${NB_HYPHEN}incompatible)`, { releaseWorthy: true, breakingChange: true }, { note: "Non-breaking hyphen normalizes to '-'." }],
  ["br-wrapped-lf", "This storage change is not\nbackwards compatible", { releaseWorthy: true, breakingChange: true }, { note: "Phrase split by ordinary hard wrapping (LF)." }],
  ["br-wrapped-crlf", "This storage change is not\r\nbackwards compatible", { releaseWorthy: true, breakingChange: true }, { note: "Same phrase with CRLF; must match the LF case." }],
  ["br-footer-lf", "feat: new auth\n\nBREAKING CHANGE: tokens expire hourly", { releaseWorthy: true, breakingChange: true }],
  ["br-footer-crlf", "feat: new auth\r\n\r\nBREAKING CHANGE: tokens expire hourly", { releaseWorthy: true, breakingChange: true }, { note: "Must match the LF case." }],
  ["br-late-bare-cr-footer", `feat: new auth\r${LATE_FILLER}\rBREAKING CHANGE: tokens expire hourly`, { releaseWorthy: true, breakingChange: true }, { note: "Footer after more than 1200 characters, separated by a bare CR." }],
  ["br-incompatible-gap", "Now incompatible with Node 16", { releaseWorthy: true, breakingChange: true }, { acceptedMismatch: { kinds: ["breaking miss", "false exclusion", "category"], reason: "'Incompatible with X' is equally a bug report (\"fix plugin incompatible with Node 20\"); not flagged." }, openPolicy: "Whether 'incompatible with <runtime>' should mean breaking is a maintainer decision." }],
  // Breaking: R10 positives. A leading "fix" does not make an introduced incompatibility safe.
  ["br-r10-ship", "fix: ship backwards-incompatible output", { releaseWorthy: true, breakingChange: true }],
  ["br-r10-making", "Fix the API by making it backwards incompatible", { releaseWorthy: true, breakingChange: true }],
  ["br-r10-fixes-colon", "Fixes: backwards-incompatible rename of --out", { releaseWorthy: true, breakingChange: true }],
  // Breaking: scope of negation. A clause end (;) or a new line starts a new declaration. (R14)
  ["br-scope-semicolon-prevent", "fix: prevent crashes; drop support for Node 16", { releaseWorthy: true, breakingChange: true }],
  ["br-scope-semicolon-preserve", "fix: preserve logging; drop support for Node 16", { releaseWorthy: true, breakingChange: true }],
  ["br-scope-newline-declaration", "fix: prevent crashes\nDrop support for Node 16", { releaseWorthy: true, breakingChange: true }, { note: "A new line is a new declaration; it does not borrow the previous line's 'prevent'." }],
  ["br-scope-semicolon-incompat", "fix: prevent crashes; ship backwards-incompatible output", { releaseWorthy: true, breakingChange: true }],
  ["br-scope-wrapped-phrase", "Drop support\nfor Node 16", { releaseWorthy: true, breakingChange: true }, { note: "A phrase split by ONE line wrap still matches." }],
  ["br-scope-guard-do-not", "fix: do not drop support for Node 16", { releaseWorthy: true, category: "fixed", breakingChange: false }],
  ["br-scope-guard-end-of-support", "fix: prevent end of support warnings", { releaseWorthy: true, category: "fixed", breakingChange: false }],
  ["br-scope-guard-wrapped-negator", "fix: do not\ndrop support for Node 16", { releaseWorthy: true, category: "fixed", breakingChange: false }, { note: "The negator ends the first line, so its clause continues onto the next." }],
  ["br-scope-guard-wrapped-prevent", "fix: prevent\nbackwards-incompatible output", { releaseWorthy: true, category: "fixed", breakingChange: false }],
  ["br-scope-guard-prevent-only", "fix: prevent crashes", { releaseWorthy: true, category: "fixed", breakingChange: false }, { note: "Alone, this contains nothing breaking; pins how the two-line case above is read." }],
  // Breaking: protected negatives, including negated support removal (R10/R11)
  ["br-guard-fix-avoid", "fix: avoid backwards-incompatible output", { releaseWorthy: true, category: "fixed", breakingChange: false }, { note: "'fix' with an explicit avoid stays a negative." }],
  ["br-guard-avoid-drop", "fix: avoid dropping support for Node 16", { releaseWorthy: true, category: "fixed", breakingChange: false }],
  ["br-guard-dont-remove", "fix: don't remove support for Python 3.8", { releaseWorthy: true, category: "fixed", breakingChange: false }],
  // Breaking: protected negatives (R3/R4)
  ["br-guard-avoid", "Add a check that avoids backwards-incompatible changes in the parser", { releaseWorthy: true, breakingChange: false }],
  ["br-guard-prevent", "Add a guard to prevent backward incompatible behavior when upgrading", { releaseWorthy: true, breakingChange: false }],
  ["br-guard-ensure", "Add a test ensuring no backwards-incompatible behavior is introduced", { releaseWorthy: true, breakingChange: false }, { note: "Known limit: the avoids-context window is 30 characters, so a far-away negator (\"restore ... the last release was backwards incompatible\") is still flagged." }],
  ["br-guard-doc-bracket", "docs: explain how to use [breaking] markers in the changelog", { releaseWorthy: true, category: "documentation", breakingChange: false }, { note: "A bracket in the middle of prose is a mention, not a declaration." }],
  ["br-guard-doc-footer", "docs: show a BREAKING CHANGE: footer example in CONTRIBUTING", { releaseWorthy: true, category: "documentation", breakingChange: false }, { note: "A footer example mid-line is not a footer line." }],
  ["br-guard-label", "Add a breaking-change label to the issue templates", { releaseWorthy: true, category: "added", breakingChange: false }],
  ["br-guard-remove-plain", "Remove the unused spinner component", { releaseWorthy: false, breakingChange: false }, { note: "There is no blanket 'remove' rule; an unused internal component is not customer-relevant." }],

  // Ambiguous / noisy
  ["am-update", "Update dependencies", exc(), { note: "Generic dependency updates are not user-facing.", openPolicy: "Dependency-bump exclusion needs a defined policy." }],
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
