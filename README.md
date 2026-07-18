# sudo-ai-receptionist

Reusable, low-latency AI receptionist platform.

SalonFlow is the first integration. The core system stays industry-agnostic and depends only on typed business contracts, not SalonFlow database models.

## What existed before Build Week

- The SalonFlow monorepo and its production application stack.
- Existing internal docs and operational patterns inside the SalonFlow repo.
- No standalone AI receptionist product repository existed yet.

## What was built during Build Week

- A standalone repository scaffold for `sudo-ai-receptionist`.
- Typed business contracts and conversation-state validation.
- A mock business adapter for demo mode.
- A SalonFlow HTTP adapter shell with timeout, retry, and idempotency patterns.
- A text-based receptionist agent core.
- An evaluation harness with deterministic scenarios.
- Initial documentation for architecture, latency, security, mock mode, deployment, and the demo script.

## Repository layout

```text
apps/
  receptionist-web/
  receptionist-api/
  demo-dashboard/
packages/
  agent-core/
  realtime-runtime/
  conversation-state/
  business-contracts/
  evaluation/
  observability/
  shared/
integrations/
  salonflow/
  mock-business/
docs/
```

## Quick start

```bash
npm install
npm run test
npm run eval
```

## Evaluation

Run the deterministic scenario suite with `npm run eval`. The JSON output can be archived with demo notes or compared between iterations.

## Demo mode

Use `MockBusinessAdapter` for the public hackathon demo. It is deterministic, does not require production SalonFlow access, and supports the full booking flow.

## SalonFlow mode

Use `SalonFlowAdapter` with a scoped integration token and a configurable base URL. The adapter talks only over authenticated HTTP.

## OpenAI realtime voice

The browser UI is scaffolded for a backend-mediated realtime session. The client never receives permanent OpenAI or SalonFlow credentials.
