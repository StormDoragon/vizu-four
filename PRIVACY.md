# Privacy

This covers the public demo at **https://vizu-four.onrender.com** and, where
noted, what the software does when you run it on your own machine.

**Short version:** no accounts, no analytics, no ads, no third-party scripts.
What you paste lives in the server's memory while you use it and is deleted
after two idle hours. The demo never runs your `run:` steps. Share links carry
your workflow in the link itself, readable by anyone who has the link. If an
AI key is configured, a failed step's details are sent to Anthropic to
explain the failure.

Don't paste anything confidential into a public demo. Use throwaway values
for secrets.

## What the server keeps, and for how long

| What | Where | How long |
|------|-------|----------|
| The workflow you paste | Parsed into server memory; the server does not keep the raw text | Until the session is deleted: after **2 hours** without activity, or when the server restarts |
| What-If values (env and vars overrides, event payload, secrets) | Server memory only. Secret values are never sent back to the browser: they are masked as `***` in every log, output and context | Same as the session |
| Step results (stdout, stderr, outputs) | Server memory | Same as the session |
| Scratch directories | The server's temp directory, one per session | Deleted with the session (a crash can leave them until the host clears its temp storage) |
| The `vizu_owner` cookie | Your browser. A random ID that lets only the browser that created a session open it. It isn't linked to anything about you | 30 days |
| Your IP address | Server memory, for rate limiting | Sliding 10-minute window. The app never writes it to disk |

The app writes nothing about your session to its logs. A server error may be
logged with its error message. The hosting provider (Render) keeps its own
HTTP request logs, which usually include IP address, URL path, status and
timing, under its own retention policy.

## What stays in your browser

The app keeps these in your browser's `localStorage`. They don't leave your
browser unless you share a link:

- `vizu-four:workflow-sources`: the text of up to the 20 most recent
  workflows you started, so **Share** can build a link later.
- `vizu-four:debug-prefs:<hash>`: for each workflow, its breakpoints,
  env/vars overrides, pause-on-failure setting and secret **names** (never
  values), so they come back the next time you open it.
- `vizu-theme`: your light or dark theme preference.

To remove them, clear this site's data in your browser settings.

## Share links

A share link contains the session itself, not a pointer to it: the workflow
text, breakpoints, mocked step results and env/vars overrides. They are
base64-encoded, **not encrypted**. Secret names and values are never included.

- Anyone who has the link can read everything in it, and a link can't be
  revoked or set to expire.
- New links (`/share#…`) keep this data after the `#`. Browsers don't send
  that part to the server, so it never reaches the server or the host's
  logs. It does stay in your browser history and wherever you paste the
  link.
- Older links (`/share/…`) carry the data in the URL path. The server and
  the host's request logs see the path.
- Opening a link creates a new session on the server, just like pasting the
  workflow would.

## AI failure explanations

When you select a failed step, the app asks the server for an explanation
automatically.

- **Without an API key** (`ANTHROPIC_API_KEY` unset), the explanation comes
  from offline rules on the server and nothing is sent anywhere.
- **With a key**, the server sends Anthropic's API the step's name (up to
  256 bytes), its `run:` script (the last 2 KB), its `uses:` value, exit
  code, the last 4 KB of stdout and of stderr, and any engine error. Every
  secret value you set is masked first, including secrets you added after
  the step ran. Anthropic handles this data under its own terms and privacy
  policy.

The explanation panel shows which one you got: **AI-generated (Claude)** or
**Heuristic analysis**. The demo's checked-in configuration
([`render.yaml`](./render.yaml)) sets no API key, so there the panel should
say "Heuristic analysis". If it says "AI-generated (Claude)", a key has been
added in the host's dashboard.

## What isn't collected

No accounts, no analytics, no advertising or tracking cookies, no
third-party scripts, fonts or CDNs. `vizu_owner` is the only cookie.

## On your own machine

Without `VIZU_DEMO_MODE`, `run:` steps execute for real on your machine,
with your user's privileges, in a scratch workspace or in a directory you
explicitly opt into. Everything described above then stays on your machine,
except AI explanations if you set a key.

## Contact

For questions, open an issue at
https://github.com/StormDoragon/vizu-four/issues. To report a security
problem, follow [SECURITY.md](./SECURITY.md) and don't open a public issue.
