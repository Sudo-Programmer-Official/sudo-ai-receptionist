# Deployment Guide

## Environment variables

- `BUSINESS_ADAPTER=mock|salonflow`
- `SALONFLOW_BASE_URL`
- `SALONFLOW_INTEGRATION_TOKEN`
- `SALONFLOW_DEMO_TENANT_ID`
- `OPENAI_API_KEY`
- `OPENAI_REALTIME_MODEL`
- `RECEPTIONIST_API_PORT`

## Recommended deployment order

1. Deploy `receptionist-api`.
2. Deploy `receptionist-web`.
3. Point the backend to the appropriate adapter.
4. Validate the demo flow end to end.

## Demo environments

- Use separate credentials for demo and staging.
- Keep the demo tenant isolated from production.

