# Mock Mode

Mock mode is the default public demo mode.

## What it provides

- Synthetic business profile, services, staff, and appointment availability.
- Deterministic booking creation.
- Duplicate booking prevention.
- Confirmation delivery stub.

## Why it exists

- The hackathon demo must work without production SalonFlow access.
- It allows deterministic evaluation and local development.

## How to use

- Point the backend to `MockBusinessAdapter`.
- Keep the realtime client on ephemeral backend-issued sessions.

