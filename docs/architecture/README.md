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

## File import path

```
Client ──POST /imports──▶ API Lambda ── todo_imports row + pre-signed S3 POST ──▶ Client
Client ──multipart POST (signed fields + file)──▶ S3 uploads/  ──ObjectCreated──▶ SQS ──▶ ingest Lambda
                                                     │                                       │ validate whole file:
                                                quarantine/ ◀──── reject (+ report) ◀────────┤ ODCS row schema →
                                                                                             │ todo_create schema →
                                                                                             ▼ createTodo() ×N, one tx
                                                                                          Postgres (todos, todo_imports)
```

- The **file format is a second contract**: `api/todo-import.odcs.yaml` (Open Data Contract Standard
  3.2). `task gen` renders it into the runtime row validator next to the OpenAPI-generated zod, and a
  unit test keeps its columns identical to `todo_create`.
- The API never touches file bytes: it mints a one-time **pre-signed POST** (key, type, size, KMS key
  pinned) and the client uploads straight to S3. S3 notifies an SQS queue (with a DLQ); the **ingest
  Lambda** validates the whole file and commits every row through the same `createTodo` the API uses,
  or quarantines the file with a report and alerts. See ADR-12.
- Locally the same code runs against **moto** (S3/SQS/KMS) with a small worker in place of the Lambda
  event-source mapping (`task import:worker`).

## Key decisions

See [decisions.md](decisions.md) for the full log. Headlines:

- Contract-first with a zod-emitting generator (Kubb) so we validate at runtime, not just compile time.
- `lower_snake_case` everywhere in the contract, enforced by Spectral.
- Static IP (egress and ingress) and custom DNS are opt-in Terraform flags, default off.

_Full component and sequence detail is expanded in the tutorial._
