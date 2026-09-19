# Architecture

How the pieces fit together and why. This repo is **one API service**; the platform and the
contract are separate repos it depends on.

## Three repos

```
aws.contract.template ──publishes──▶ @datagriff/todo-api-contract (GitHub Packages)
                                              │  pinned version
                                              ▼
aws.infra.template ──publishes──▶ /platform/<env>/… (SSM)  ──▶  aws.api.template (this repo)
  network, KMS, Cognito, WAF,                 │                    Lambda, REST API, Postgres+proxy,
  certificate, alarm topic,                   │                    secret, idempotency table, alarms,
  deploy roles + state backends               │                    hostname, migrations, tests
```

- **Contract** (`@datagriff/todo-api-contract`): the handler validates with its zod schemas, the
  API Gateway spec is rendered from its `openapi.yaml` (`task gen`, drift-gated), the contract
  test layer runs its client and `.http` collection against the service, Schemathesis fuzzes from
  it. Changing the API's surface means releasing the contract, then `task contract:bump`.
- **Platform** (`aws.infra.template`): `infra/terraform/modules/platform` reads the SSM interface
  once and exposes typed outputs; the stack refuses to plan against another `interface/version`.
  Optional inputs (WAF ACL, certificate/zone) are read only when the matching flag is on here, so
  a platform without the feature fails at plan time with a clear message. This API's deploy role
  and state backend are created by the platform bootstrap when the service is registered.

## Request path

```
Client ──HTTPS──▶ (platform WAF?) ──▶ API Gateway REST API ──Cognito authorizer (platform pool)──▶ Lambda (middy + router)
                                              │                                                        │
                                        request validation                                       zod validation
                                        (from the contract)                                            │
                                                                                          RDS Proxy ─▶ Postgres (this API's)
```

- **API Gateway REST API** — imports the rendered contract (`body`), so request validation and the
  route surface come straight from the pinned package. Usage plans + API keys gate consumers; the
  platform's WAF is attached when `enable_waf` is on.
- **Cognito** — the platform's user pool issues JWTs with `custom:tenant_id` / `roles` claims
  (its pre-token trigger). The gateway's Cognito authorizer validates the token and exposes claims
  to the Lambda.
- **Lambda** — a single handler using **middy** middleware and a hand-written route table held to
  the contract by a unit test. Powertools provides logging, tracing (X-Ray) and metrics.
- **Postgres** — this API's own instance/cluster, reached via **RDS Proxy** (IAM auth, pooled),
  encrypted with the platform's `data` key. Migrations run out-of-band, never in the request path.

## Key decisions

See [decisions.md](decisions.md) for the full log. Headlines:

- Contract-first with a zod-emitting generator (Kubb) — now consumed as a versioned package.
- REST API (not HTTP API) for WAF, gateway validation and usage plans.
- Platform inputs only through the SSM interface; databases stay per-API.
- Tenant isolation in the repository layer, not Postgres RLS.
