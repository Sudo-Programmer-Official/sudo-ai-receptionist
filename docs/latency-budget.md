# Latency Budget

Treat latency as a product requirement.

## Targets

- Session startup latency: p95 under 1.5s
- Voice response latency: p95 under 800ms after audio end
- Tool execution latency: p95 under 700ms for safe reads, under 1.5s for booking writes
- SalonFlow API latency: p95 under 500ms for reads, under 1.2s for writes
- Booking completion latency: p95 under 3.5s from confirmation to success
- Total conversation duration: track end-to-end for each session
- Error and retry counts: track per session and per adapter

## Instrumentation

- Session startup latency
- Voice response latency
- Tool execution latency
- SalonFlow API latency
- Booking completion latency
- Total conversation duration
- Retry count
- Error count

## Caching policy

- Cache business profile, hours, services, and policies.
- Do not cache appointment availability beyond a short safe period.
- Invalidate cached stable data when the business version changes.

