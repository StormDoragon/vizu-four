# Deploying the public demo

> **Before you deploy anywhere shared or public: set `VIZU_DEMO_MODE=1`.**
> `run:` steps otherwise execute real shell commands as this process — see
> [Security note for public demos](#security-note-for-public-demos) below
> for exactly why this isn't optional.

This app is a **long-running Node process**, not a pure serverless function:

- Debug sessions live in an in-memory store (`src/lib/engine/store.ts`)
- `run:` steps spawn real `bash` child processes and write to a scratch workspace on disk

Because of that, **Vercel / Netlify serverless is a poor fit** (no sticky process, limited subprocess + filesystem). Prefer a host that runs a single Node server:

| Host | Notes |
|------|--------|
| [Railway](https://railway.app) | Simple `npm run build && npm start`, free tier often enough for a demo |
| [Fly.io](https://fly.io) | Good for a small always-on VM |
| [Render](https://render.com) | Web Service, Node environment |
| Any VPS / Docker | `node server` or the Dockerfile below |

## Render quickstart (recommended: free, one instance, no card)

The in-memory session store (`src/lib/engine/store.ts`) lives in a single
process's memory. Any host that runs **more than one instance** of that
process — including Vercel's serverless model, where each request can land
on a different Lambda with its own empty memory — will intermittently
"lose" a session mid-debug. Render's free Web Service tier runs exactly
**one** instance, so this class of bug can't happen there.

1. Push this repo to GitHub (already done for this branch).
2. In the Render dashboard: **New +** → **Blueprint**, connect this repo.
   Render reads [`render.yaml`](./render.yaml) at the repo root and creates
   the service pre-configured with `VIZU_DEMO_MODE=1`, `npm ci && npm run
   build` as the build command, and `npm start` as the start command — no
   manual field-filling needed.
3. Wait for the first build to finish, then open the assigned
   `https://<name>.onrender.com` URL and confirm demo mode is on (see
   "After deploy" below) before sharing it.

Live at **https://vizu-four.onrender.com** — verified: `/api/config` returns
`{"simulationOnly":true}`, and the one-click failure demo lands on a real
failed step with the mocked exit code and stderr.

Free-tier tradeoff: the instance spins down after ~15 minutes idle, so the
first request after a quiet period is slow to wake it back up. That's a
latency cost, not a correctness one — the session-loss bug this section
opened with only happens with *multiple concurrent* instances, which the
free tier never runs.

## Requirements

- Node.js **20.9+** (Node 20 reached end-of-life in April 2026, so prefer 22 or 24; running the test suite needs 22.22.2+ or 24.15+)
- Unix-like environment with `bash` on `PATH` (matches GitHub's default shell)
- Outbound network only if you set `ANTHROPIC_API_KEY` for richer failure explanations

## Build & run (production)

```bash
npm ci
npm run build
npm start
# listens on PORT (default 3000)
```

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | No | Listen port (default `3000`) |
| `ANTHROPIC_API_KEY` | No | Enables live Claude upgrades for failure explanations; heuristic fallback always works |
| `VIZU_DEMO_MODE` | **Yes, on any shared or publicly-reachable host** | Set to `1` to disable real `run:` execution (simulation-only). See the security note below — this is not optional once anyone but you can reach the instance. |
| `VIZU_AI_MAX_CALLS_PER_WINDOW` | No | Live Claude calls allowed per 10 minutes, instance-wide (default `200`) |
| `VIZU_AI_MAX_CONCURRENT` | No | Live Claude calls allowed in flight at once (default `4`) |
| `VIZU_AI_TIMEOUT_MS` | No | How long one Claude call may take before it is abandoned (default `20000`) |

### If you set `ANTHROPIC_API_KEY` on a shared host

That key is the only way this app can spend your money, and the explanation
endpoint is reachable by anyone who can reach the instance. Three bounds
apply by default and are worth setting deliberately:

- **Spend**, via `VIZU_AI_MAX_CALLS_PER_WINDOW`. This is the actual cap.
- **Concurrency**, via `VIZU_AI_MAX_CONCURRENT`. A burst can hold open more
  sockets and memory than the spend cap suggests, because none of those
  calls have completed yet.
- **Per-call timeout**, via `VIZU_AI_TIMEOUT_MS`, so a hung provider call
  does not occupy a concurrency slot indefinitely and turn an outage there
  into an outage here.

Running out of budget is not an error: the endpoint falls back to the
offline heuristic explanation, so the feature degrades rather than breaking.
A value that is not a positive integer falls back to the default rather than
being read as "unlimited", so a typo cannot silently remove the bound.

Per-visitor rate limits on the endpoint are separate and always on: 40
explanations per visitor and 80 per client address every 10 minutes. At the
default cap that stops one visitor from spending the whole instance budget.
Below 40, one visitor can spend it all, and everyone gets the offline
explanation until the window rolls over.

### What a key can cost, at most

Each explanation is one call to Claude, and each call is bounded at both
ends:

- **Prompt:** at most 16 KB (`MAX_PROMPT_BYTES` in `src/lib/ai/explain.ts`).
  Each field is clipped to its own share: the step name and `uses:` to 256
  bytes each, the engine error to 1 KB, the end of the `run:` script to 2 KB,
  and the ends of stdout and stderr to 4 KB each. A prompt that still comes
  out larger isn't sent.
- **Reply:** at most 1,024 output tokens (`max_tokens`).

So one ten-minute window costs at most `VIZU_AI_MAX_CALLS_PER_WINDOW` ×
(16,384 input + 1,024 output tokens). At the default model's price (Claude
Sonnet 5: $2 per million input tokens and $10 per million output tokens as of
September 2026; check
[current pricing](https://platform.claude.com/docs/en/about-claude/pricing),
and note that `ANTHROPIC_MODEL` changes the model), that's about $0.043 per
call. Running flat out, every window, all day:

| `VIZU_AI_MAX_CALLS_PER_WINDOW` | At most per hour | At most per day |
|---|---|---|
| `200` (default) | $51.61 | $1,238.63 |
| `30` | $7.74 | $185.79 |
| `10` | $2.58 | $61.93 |

That's what someone saturating the cap with maximum-size prompts around the
clock could spend. The table assumes the extreme of one token per byte, so it
overstates what real text costs, and an ordinary failure's prompt is only a
few KB. For any public instance with a key:

1. Set `VIZU_AI_MAX_CALLS_PER_WINDOW` to what you'd accept losing per hour,
   instead of keeping the default.
2. Set a spend limit on the key's workspace in the Claude Console. It's the
   one bound that doesn't depend on this app being correct.

The SDK may retry a call that failed with a retryable error, at most twice
and inside the same `VIZU_AI_TIMEOUT_MS` deadline. The cap counts calls, not
those retries.

`npm run build && npm run verify:deployment` checks every bound against a
production build, using a stand-in for Anthropic's API: the call cap, the
concurrency cap, the timeout, the prompt ceiling and the per-visitor 429. CI
runs it on every push.

## Docker (optional)

```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends bash && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
```

## After deploy

1. Confirm the instance is actually running in demo mode (see the security
   note below) **before** sharing the URL with anyone.
2. Open the public URL and confirm the five example buttons load.
3. Start **Needs Chain** or **Matrix Build**, step through a failure, confirm the graph + inspector work.
4. Paste the live URL into the README **Live demo** section and close issue #1.

## Security note for public demos

`run:` steps execute as real child processes with this server's own shell
privileges. Anyone who can reach the instance can execute arbitrary shell
commands as that process user — including reading environment variables,
the filesystem, and anything else that process can reach. Railway/Fly/
Render's free and shared tiers, and any VPS you don't fully control
end-to-end, all count as **shared hosts** for this purpose: the workload is
either multi-tenant at the infrastructure layer, or reachable by anyone on
the internet, which is the same exposure either way.

**On a shared or publicly-reachable host, `VIZU_DEMO_MODE=1` is required, not
optional.** This is what actually removes the risk — it disables `run:`
execution entirely (see `src/lib/deployment.ts`), rather than merely
containing the blast radius of code that's still running. Everything else
in the debugger (expressions, matrix expansion, `if:` conditions,
breakpoints, `uses:` simulation) behaves identically in demo mode; only real
shell execution is turned off. The server itself only *warns* on startup if
you forget (`warnIfUnsafeDeployment()` — check your deploy logs for it), it
can't enforce this from inside the process, so setting the variable is on
you.

### Abuse limits and what they actually assume

Session creation is limited in three scopes: per visitor (an `httpOnly`
cookie), per client address, and a global ceiling for the whole process,
plus caps on how many sessions may be live at once.

Only the global scope is unconditional. The per-visitor scope is keyed on a
cookie the visitor can simply discard, and the address scope reads the last
`x-forwarded-for` entry — which is trustworthy **only if your host always
appends or overwrites that entry and nothing can reach the process around
it**. Render does sit in front of the app this way, but that has not been
verified end to end here, and behind a longer proxy chain the last entry can
be an intermediary shared by many visitors. Treat per-visitor and per-address
as best-effort layers; the global ceiling and the live-session caps are what
actually bound the instance.

The rest of these are worth doing in addition, never instead:

- Run as a non-root user
- Prefer an isolated VM / container with tight network egress
- Do not attach real production secrets or privileged cloud credentials
- Consider IP allowlisting or basic auth if abuse becomes a problem

Running with real `run:` execution enabled (`VIZU_DEMO_MODE` unset) is only
appropriate for a single-user local install, or a host you're certain
nobody else can reach — the local-first, single-user use case this app was
originally built for.
