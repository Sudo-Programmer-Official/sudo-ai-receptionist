# Architecture

```mermaid
flowchart LR
  Browser[receptionist-web] --> API[receptionist-api]
  API --> Core[agent-core]
  Core --> Contracts[business-contracts]
  Core --> State[conversation-state]
  Core --> Obs[observability]
  Core --> Shared[shared]
  Core --> Mock[integrations/mock-business]
  Core --> SF[integrations/salonflow]
  Browser -->|ephemeral session only| API
  API -->|server-side tool execution| Mock
  API -->|server-side tool execution| SF
  API --> Dashboard[demo-dashboard]
```

## Principles

- The core agent depends only on the adapter contract.
- SalonFlow is an integration, not a framework dependency.
- Tool execution happens on the server.
- Voice sessions are ephemeral and mediated by the backend.
- Stable business metadata is cached; appointment availability is not cached beyond a very short safe window.

