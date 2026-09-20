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

- Node.js **20+**
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

The rest of these are worth doing in addition, never instead:

- Run as a non-root user
- Prefer an isolated VM / container with tight network egress
- Do not attach real production secrets or privileged cloud credentials
- Consider IP allowlisting or basic auth if abuse becomes a problem

Running with real `run:` execution enabled (`VIZU_DEMO_MODE` unset) is only
appropriate for a single-user local install, or a host you're certain
nobody else can reach — the local-first, single-user use case this app was
originally built for.
