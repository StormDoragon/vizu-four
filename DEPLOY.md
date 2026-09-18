# Deploying the public demo

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

1. Open the public URL and confirm the five example buttons load.
2. Start **Needs Chain** or **Matrix Build**, step through a failure, confirm the graph + inspector work.
3. Paste the live URL into the README **Live demo** section and close issue #1.

## Security note for public demos

Anyone who can reach the instance can execute arbitrary `run:` scripts as the process user. For a public demo:

- Run as a non-root user
- Prefer an isolated VM / container with tight network egress
- Do not attach real production secrets or privileged cloud credentials
- Consider IP allowlisting or basic auth if abuse becomes a problem
