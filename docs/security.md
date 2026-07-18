# Security

## Requirements

- Validate environment variables at startup.
- Never commit secrets.
- Keep OpenAI and SalonFlow credentials server-side.
- Use scoped integration credentials.
- Redact phone numbers and customer data from logs.
- Apply rate limiting and basic abuse protection.
- Sanitize errors before returning them to the client.

## Notes

- The browser receives only ephemeral session data.
- Tool execution happens in the backend.
- Demo and staging environments should use separate credentials and separate business IDs.

