# Deployment Guide

## Environment variables

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

Recommended configuration for the API service:

- Root Directory: blank
- Build Command: `npm ci && npm run build:api`
- Start Command: `npm run start:api`

Health check:

- `GET /health`

## Demo environments

- Use separate credentials for demo and staging.
- Keep the demo tenant isolated from production.
