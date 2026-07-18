# Evaluation

## Runnable command

```bash
npm run eval
```

## Scenarios

- Successful booking
- Unavailable requested time
- Unknown service
- Missing customer details
- Customer changes their mind
- Customer interrupts the agent
- Duplicate booking attempt
- SalonFlow timeout
- Unrelated question

## Current scaffold coverage

The first-pass deterministic harness covers the booking path and several edge cases with the mock adapter. The remaining cases are represented in the planned scenario list and should be added as the implementation matures.

## Expected outcome shape

The evaluation command prints JSON with:

- `scenario`
- `passed`
- `transcript`

