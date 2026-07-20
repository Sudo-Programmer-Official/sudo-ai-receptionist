# Deployment Guide

## Environment variables

- `ALLOWED_ORIGINS` comma-separated list of allowed browser origins
- `PORT` (Render sets this automatically)
- `BUSINESS_ADAPTER=mock|salonflow`
- `SALONFLOW_BASE_URL`
- `SALONFLOW_INTEGRATION_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_REALTIME_MODEL`
- `RECEPTIONIST_API_PORT`

## Recommended deployment order

1. Deploy `receptionist-api`.
2. Deploy `receptionist-web`.
3. Point the backend to the appropriate adapter.
4. Validate the demo flow end to end.

## Render configuration

Current app-root Render setup:

- Root Directory: `apps/receptionist-api`
- Build Command: `npm install --include=dev && npm run build`
- Start Command: `npm run start`
- Required Node version: `22.12.0`

Repository-root alternative:

- Root Directory: blank
- Build Command: `npm ci && npm run build:api`
- Start Command: `npm run start:api`

Health check:

- `GET /health`

Compiled entrypoint:

- `dist/apps/receptionist-api/src/server.js`
- This is the current output shape because the API build still references workspace source files via the shared path map. Collapsing it to `dist/server.js` would require wider workspace import restructuring and is deferred as post-demo debt.

## Demo environments

- Use separate credentials for demo and staging.
- Keep the demo tenant isolated from production.
