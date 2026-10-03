# Public preview shipping scope

Vizu Four ships a simulation-only hosted Debug module and a Release module for
public GitHub metadata. Release produces drafts for human review, with local
wording edits, inclusion overrides, immutable source links and protected security
details. Nothing is automatically published. This preview makes no claim of
independently measured real-world classification accuracy.

## Product decisions for this preview

- Plain-English changes and common emoji/ticket prefixes are recognized with
  low confidence. Users can include or exclude any candidate and edit ordinary
  technical/customer wording before copying notes.
- Test-only, CI-only, duplicate merge and administrative review-summary entries
  are excluded by default. Their security flags remain visible; explicit breaking
  declarations remain included. Typo-only fixes are excluded by default.
- Reverts and dependency-only updates without an explicit release/security/
  breaking signal remain manual inclusion decisions. The classifier does not
  infer whether a reverted feature was previously released or whether a version
  bump changes runtime behavior.
- Unmarked removal wording is included for review; a generic removal is not
  automatically a breaking declaration. Removing documented support is breaking.
- "Now incompatible with ..." declares new incompatibility and is breaking.
  "Fix plugin incompatible with ..." is a bug report; prevention is not an
  introduction of incompatibility. New accumulated configuration caps require
  migration review because existing accepted configurations can be rejected.
- Sanitization terminology remains a conservative review trigger, including
  occasional UI wording false alarms. Protected details stay out of customer
  exports and AI prompts; technical notes show a review placeholder.
- Local edits cannot remove source security/breaking flags or change evidence.
  New sensitive wording is also withheld. Edits are held only in the current
  browser page and clear on reset, a new analysis or navigation.

## Evaluation provenance

The original 40-row AI draft and its null human review record remain unchanged.
It is now development data because it informed rule changes. The development
test pins its checksum and reports every disagreement under `ai-draft`.

Before these changes it had 25 false exclusions, seven false inclusions,
11 security misses and one breaking miss against those AI labels. Current
development results: zero inclusion disagreements, zero security/breaking misses,
29/40 matching categories, four security false alarms and one breaking false
alarm. These are agreement figures on tuned development data, not accuracy
estimates. Category differences often reflect prioritizing security over another
valid description of the same change.

The optional human-reviewed ratchet is implemented and tested with fixtures.
It pins exact case/disagreement pairs for inclusion, category and false alarms.
New disagreements fail; resolved ones require removing the old allowance.
Security and breaking misses are always hard failures. No human baseline is
populated, and AI data cannot populate it. The existing human gate is therefore
strict by default. The hold-out worksheet is still blank and untouched. Fresh
independent human labels are required before any accuracy claim.

AI wording remains opt-in and unverified semantically. Evidence membership
checks do not establish that a rewritten claim is supported; users must review
wording. The deployed no-provider mode uses deterministic wording.

## Release checks

For every release, use Ubuntu Node 22 for typecheck, lint, the full test suite,
production build and production smoke. Node 20 separately verifies the deployed
runtime's build and production smoke. Preserve the shell and symlink tests;
Windows failures in those Unix-dependent tests are not grounds to weaken them.

1. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
   and `node scripts/production-smoke.mjs` in the supported Linux environment.
2. Require both GitHub Actions jobs on the exact PR head before merging.
3. Confirm Render's last successfully deployed commit matches the merged main
   commit. Check `/api/config`, the home page and `/release`.
4. Analyze a small real public GitHub range. Confirm immutable evidence, both
   audience outputs, local edits, include/exclude/reset and protected details.
5. Keep `VIZU_DEMO_MODE=1`. Shared-host real shell execution remains blocked on
   the isolation work tracked in issue #14.

The account, billing, extension, team, container/microVM runner and other roadmap
issues remain future product work. They are not marked complete by this preview.
