# Independent API prototype (not deployed)

This is a small Cloudflare Worker prototype intended to verify independent API hosting before migrating Rene Social Hub. It is **not** a replacement for the AppDeploy backend.

- `GET /health` returns a safe status response.
- All other endpoints return HTTP 501 Not Implemented.
- No Meta accounts, access tokens, scheduled posts, authentication, database, or cron jobs are connected.
- Never store real social tokens or client data in this public repository.

Next: validate hosting and costs, design secure owner login and token storage, implement OAuth callbacks, migrate owner data safely, and test publishing before switching anything live.
