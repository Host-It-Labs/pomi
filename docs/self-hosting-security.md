# Self-hosting security

## First administrator

Production startup requires a dedicated `POMI_ADMIN_BOOTSTRAP_TOKEN` of at
least 32 characters. Generate it separately from database, Redis, and JWT
secrets with `openssl rand -hex 32`. The backend compares it in constant time
and serializes competing first-administrator claims in PostgreSQL. Missing and
incorrect values return the same response.

Only the first account on a self-hosted deployment can claim administrator
access with this token. Enter it in the first account-creation form, never put
it in a public frontend build, URL, log, support message, or shared password
manager entry. Rotate the configured value if exposure is suspected.

## Transport and browser origins

Expose remote backends only through HTTPS. Clients accept plaintext HTTP only
for loopback development hosts and the Android emulator bridge in development;
the `VITE_ALLOW_INSECURE_REMOTE_BACKEND` override is for isolated development
testing and must stay `false` in releases.

Set `CORS_ORIGINS` to every exact frontend origin that may send credentialed
HTTP and Socket.IO requests. Do not use wildcards. A valid entry has a scheme,
host, and optional port but no path, trailing slash, credentials, query, or
fragment. Set `TRUST_PROXY_HOPS` to the exact trusted reverse-proxy depth so
Secure refresh cookies and origin-based rate limits use the real request
boundary.

## Sessions and upgrades

Access JWTs expire after 15 minutes and are validated against their server-side
session for REST and Socket.IO requests. Refresh credentials rotate, expire
after 365 days of inactivity, and revoke their session family when replay is
detected. Web refresh credentials use Secure, HttpOnly cookies; desktop and
Wear clients use their operating-system secure stores.

For a rolling upgrade, migrate the database and deploy the backend first, then
upgrade clients. `POMI_LEGACY_JWT_MIGRATION_UNTIL` may temporarily allow an
unexpired legacy bearer token to establish a new server-side session. Use a
short ISO-8601 UTC deadline and remove it after the rollout. Invalid or
plaintext remote backend URLs already saved by older clients are quarantined,
along with legacy browser authentication, before connection.

## Authentication capacity

The backend bounds sign-in attempts by network origin and normalized username.
It separately bounds automatic account creation by origin and across the whole
deployment. Configure the windows and limits with the `AUTH_ATTEMPT_*` and
`AUTH_REGISTRATION_*` variables shown in `packages/backend/.env.example`.

Every limited response uses HTTP 429, includes a `Retry-After` header, and uses
the same message regardless of which authentication capacity was reached.

When the backend sits behind a reverse proxy or load balancer, set
`TRUST_PROXY_HOPS` to the exact number of trusted proxy hops so Express can use
the verified client IP for the network-origin limit. Leave it at `0` when the
backend is directly reachable; never use a larger value than the actual proxy
boundary.

## Redis administration

Production Compose keeps Redis on the private container network. Do not add a
host port mapping. For deliberate administration, first authenticate to the
host with SSH, then run Redis CLI inside the private network:

```sh
docker compose -f packages/backend/docker-compose.yml exec redis redis-cli
```

This path relies on authenticated host and Docker access while keeping Redis
unreachable from ordinary host-network clients.
