# Privacy and data handling

This notice describes the repository's current behavior. Vizu Four is an
experimental, local-first MVP, not a hosted production service.

## Local use

When you run Vizu Four locally, workflow and debugging data is processed by
the local Next.js process and your browser. Local `run:` steps execute with
your user account's privileges.

## Public demo

The public demo at <https://vizu-four.onrender.com> runs in simulation-only
mode. It does not spawn `run:` commands or browse the host working tree.

Creating a debugging session sends the workflow and supplied debugging values
to the demo server. Sessions are stored in process memory and are reclaimed
after approximately two hours of inactivity or when the process restarts.
An anonymous `httpOnly` cookie scopes session access to the visitor; it is
isolation, not user authentication.

Do not enter confidential workflow content, production credentials, or
personal data into the public demo.

## Browser storage

The browser uses local storage for the selected theme, cached workflow source,
and non-secret debugging preferences. Secret values are not written to local
storage; secret names may be remembered so the UI can ask you to re-enter them.
Clear site data in your browser to remove this local state.

## Share links

Share links are self-contained and reversible. Anyone with a share link can
decode the workflow YAML, event/context values, environment overrides,
variables, and mocked results included in it. Dedicated What-If secret values
are excluded, but ordinary values may still be sensitive.

Treat share links as sensitive. Do not create or distribute one until you have
reviewed all included workflow text and values.

## Failure explanations

Failure explanations use local heuristics by default. If the operator sets an
`ANTHROPIC_API_KEY`, masked failure context may be sent to Anthropic for an
optional explanation. Masking is a defense-in-depth control, not a guarantee
that arbitrary workflow output contains no sensitive information. Operators
should disclose whether the hosted deployment enables this optional provider.

## Analytics and third parties

The repository does not include product analytics. Hosting and infrastructure
providers may process ordinary request metadata under their own policies.

## Changes

This notice should be updated whenever storage, analytics, authentication,
hosting, or third-party data flows change.
