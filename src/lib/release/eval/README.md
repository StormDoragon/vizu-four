# Release classification evaluation

`corpus.ts` holds **synthetic** cases: hand-labeled probes written by the implementer. They find weaknesses; they are
**not evidence of real-world accuracy**. Real accuracy needs real release ranges labeled by a maintainer.

## Labeling a real range

1. **Pick a range you know well.** A public repository and two refs (tags, branches or commit SHAs), at most 40 commits.
   Label the *whole* range, including the dull commits: choosing only interesting ones biases the measurement.
2. **Generate a worksheet.** Every label starts blank, on purpose.

   ```sh
   npm run eval:worksheet -- <owner/repo> <base-ref> <head-ref> --out src/lib/release/eval/worksheets/<name>.json
   # no network or rate limit, from a local clone (no merged-PR titles):
   npm run eval:worksheet -- <owner/repo> <base-sha> <head-sha> --local <path-to-clone> --out ...
   ```

3. **Label blind.** Do not run the classifier or read its output first; scoring it against its own guesses is circular.
   For each row set:
   - `includeInNotes`: do you want this change in the release notes you would publish? (One global yes/no.)
   - `securitySensitive`: should a maintainer look before this is described publicly? A conservative trigger is fine.
   - `breakingChange`: does this break existing users?
   - `category` (optional, `null` to skip): `added`, `fixed`, `improved`, `documentation`, `security`, `breaking`,
     `internal`, `other`. Inclusion is scored either way.
   - `note`: anything a later reader needs, especially for policy calls (reverts, typo fixes, dependency bumps).
   - `skip: { "reason": "..." }` only for a row you truly cannot judge. Skips are printed in the test output, never hidden.
4. **Fill in the `review` block:** `reviewer` (you), `reviewedAt` (`YYYY-MM-DD`), and `recordUrl`, an `https` link to where
   the review is recorded (an issue, PR comment, or document). The tooling checks the fields are present and well
   formed. **It cannot check that a person really did the review**, so a worksheet is only as trustworthy as the person
   and the link behind it.
5. **Move the finished file to `reviewed/`** (`worksheets/` holds drafts and is never loaded) and run
   `npx vitest run src/lib/release/eval --reporter=verbose --silent=false`.

## What happens to a reviewed range

Cases load as `maintainer-reviewed`, are reported separately from the synthetic ones, and carry the flags the collector
would compute from the raw message and PR title. Today the gate (`gate.ts`) requires every reviewed case to match every
stated label with no accepted mismatches, so **the first labeled range will fail the test suite on each disagreement**.
That is the specified behavior, but a real range will almost certainly disagree somewhere; deciding how reviewed
disagreements should be reported (for example a measured baseline with a ratchet, and zero tolerance for security and
breaking misses) is a maintainer decision that has not been made.

Rules for the labels once they exist:
- Never edit a label to make a test pass, and never relax a threshold to absorb a disagreement. A disagreement is a finding.
- A range you tune the rules against stops being an unbiased measurement. Keep at least one labeled range untouched, and
  confirm any rule change on a range the rules have not seen.
- Differences from production: the product only looks up merged-PR titles for the first 10 commits; worksheets from the
  GitHub API look up all of them, and `--local` worksheets have none.
