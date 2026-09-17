# Architecture

How the pieces fit together and why.

## Request path

```
Client ──HTTPS──▶ (WAF?) ──▶ API Gateway REST API ──Cognito authorizer──▶ Lambda (middy + router)
                                    │                                          │
                              request validation                        zod validation
                              (from OpenAPI import)                            │
                                                                    RDS Proxy ─▶ Postgres
```

- **API Gateway REST API** — imports `api/openapi.yaml` (`body`), so request validation and the route
  surface come straight from the contract. Usage plans + API keys gate consumers; WAF is an opt-in front.
- **Cognito** — user pool + app clients issue JWTs. A **pre-token-generation trigger** injects custom
  claims (`custom:tenant_id`, roles). The gateway's Cognito authorizer validates the token and exposes
  claims to the Lambda.
- **Lambda** — a single handler using **middy** middleware and a **generated router**. Powertools
  provides logging, tracing (X-Ray) and metrics. Not the experimental Powertools REST router.
- **Postgres** — reached via **RDS Proxy** (IAM auth, pooled). Engine is parameterisable: Aurora
  Serverless v2 or a plain RDS instance. Migrations run out-of-band, never in the request path.

## Key decisions

See [decisions.md](decisions.md) for the full log. Headlines:

- Contract-first with a zod-emitting generator (Kubb) so we validate at runtime, not just compile time.
- `lower_snake_case` everywhere in the contract, enforced by Spectral.
- Static IP (egress and ingress) and custom DNS are opt-in Terraform flags, default off.

_Full component and sequence detail is expanded in the tutorial._
