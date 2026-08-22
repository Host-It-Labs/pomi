# Self-hosting security

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
