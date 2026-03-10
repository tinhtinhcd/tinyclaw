# Docker Setup (Backend + TinyOffice)

This setup runs TinyClaw backend and TinyOffice UI together in a single dev-oriented container.

## Files Added

- `Dockerfile`
- `docker-start.sh`
- `.dockerignore`
- `docker-compose.yml`

## Commands Discovered from Repo

### Backend (repo root)

- Install: `npm install` (or `npm ci` in Docker)
- Build: `npm run build:main`
- Start: `npm run queue`

`npm run queue` launches `dist/queue-processor.js`, which also starts the API server.

### TinyOffice (`tinyoffice/`)

- Install: `npm install`
- Build: `npm run build`
- Start (prod): `npm run start`
- Start (dev): `npm run dev`

## Ports

- Backend API: `3777` (`TINYCLAW_API_PORT`, default 3777)
- TinyOffice UI: `3000` (Next.js dev server in this Docker setup)

## Run with Docker Compose

```bash
docker compose up --build
```

Then open:

- UI: `http://localhost:3000`
- Backend API: `http://localhost:3777`

## How Processes Are Started

`docker-start.sh` starts:

1. backend: `npm run queue`
2. UI: `cd tinyoffice && npm run dev -- --hostname 0.0.0.0 --port 3000`

Behavior:

- If either process exits, the script exits non-zero.
- On shutdown (`SIGINT`/`SIGTERM`), both processes are terminated.

## Env Handling

- `docker-compose.yml` uses `env_file: .env`.
- Secrets are not hardcoded in Docker files.
- Compose overrides a few runtime-safe values:
  - `TINYCLAW_HOME=/app/.tinyclaw`
  - `TINYCLAW_API_PORT=3777`
  - `UI_PORT=3000`
  - `NEXT_PUBLIC_API_URL=http://localhost:3777`

### Minimum env vars typically needed for backend runtime

- `DEFAULT_PROVIDER`
- Provider credentials/model vars in your current setup (for example `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`)
- Any channel/integration vars you actively use (Slack, Linear, GitHub, etc.)

### TinyOffice env

- `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3777` in this setup)

## Limitations (Current MVP)

- Single-container/two-process model is practical for local use, but not ideal for production.
- Backend is built at image build time (`npm run build:main`), so code changes require rebuild.
- TinyOffice runs in dev mode for convenience.

## Optional Future Improvement

Split into two services in `docker-compose.yml`:

- `backend` service
- `tinyoffice` service

This gives cleaner isolation and more flexible scaling/lifecycle handling.
