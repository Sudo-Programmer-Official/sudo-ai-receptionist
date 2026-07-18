# SalonFlow Adapter

The SalonFlow integration is HTTP-only.

## Rules

- No direct database access.
- No copied SalonFlow implementation code.
- Use a scoped integration token.
- Use a configurable base URL.
- Support a dedicated demo tenant.
- Retry safe reads only.
- Use idempotency keys for booking writes.
- Return structured errors and sanitized messages.

## Endpoint shape

The adapter is written against a minimal REST surface:

- `GET /v1/businesses/:businessId/profile`
- `GET /v1/businesses/:businessId/services`
- `POST /v1/businesses/:businessId/availability`
- `POST /v1/businesses/:businessId/customers/resolve`
- `POST /v1/businesses/:businessId/bookings`
- `POST /v1/businesses/:businessId/confirmations`

