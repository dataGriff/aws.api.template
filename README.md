# aws.api.template

A **best-practice, secure AWS API template** you can clone and re-skin for any new API.

Contract-first · TypeScript Lambda · API Gateway **REST API** · **Cognito** (custom claims) ·
**Postgres** (parameterisable Aurora ↔ RDS) · **Terraform** (multi-env, OIDC) · fully runnable locally ·
BDD + contract + property tests · single-command CI that matches local exactly.

The bundled example is a **multi-tenant Todo API** — enough to demonstrate real state and per-user
authorization without domain noise. Swap it for your own contract with the **adopt-contract** skill.

---

## Quickstart

```bash
# 1. Install every pinned tool (node, pnpm, terraform, task, scanners, ...)
mise install

# 2. Install dependencies (also installs the git hooks via `prepare`)
pnpm install

# 3. Bring up the local stack (Postgres + cognito-local + Prism mock) and migrate
task up

# 4. Run the API locally and mint a token
task serve            # in one terminal
task token            # writes a local stub JWT into the git-ignored .http private env

# 5. Fire requests from collections/*.http (VS Code REST Client / JetBrains),
#    or run the full gate exactly as CI does:
task ci
```

## What you get

| Area               | Highlights                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contract-first** | `api/openapi.yaml` → generated zod+types, consumer SDK, Prism mock, `.http` collection, Redocly API reference. Drift is CI-gated.                                                                   |
| **Secure auth**    | Cognito user pool + app clients, **pre-token-generation trigger** adds custom claims, gateway Cognito authorizer, API keys + usage plans, WAF (opt-in).                                             |
| **Data**           | Postgres via RDS Proxy (IAM auth, pooled), parameterisable Aurora Serverless v2 ↔ RDS. Forward-only migrations run out-of-band.                                                                     |
| **Infra**          | Terraform modules + `dev/staging/prod` envs, GitHub OIDC deploy roles (no long-lived keys), S3+DynamoDB state, prod guardrails. Opt-in flags: WAF, RDS Proxy, egress/ingress static IP, custom DNS. |
| **Testing**        | vitest unit + integration (testcontainers), cucumber-js BDD, contract conformance against the generated schemas, Schemathesis fuzz.                                                                 |
| **DX**             | mise + Taskfile, lefthook hooks (`task check` / `task ci`), one CI that runs identically locally.                                                                                                   |
| **Ops**            | CloudWatch dashboard + alarms, X-Ray tracing, structured logs, SBOM, Infracost, semantic-release.                                                                                                   |

## Documentation

Docs use a fan-out layout under [`docs/`](docs/):

- 📘 **[Tutorial](docs/tutorial/)** — build it yourself, step by step (doubles as a ticket backlog)
- 🔌 **[Consumer guide](docs/consumer-guide/)** — auto-generate clients and call the API
- 📐 **[Architecture](docs/architecture/)** — components and decisions
- 💻 **[Local dev](docs/local-dev/)** — the local stack in detail
- 🧪 **[Testing](docs/testing/)** — the test pyramid and what each layer owns
- 🛠️ **[Operations](docs/operations/)** — deploy, rollback, secret rotation, runbooks
- 🔒 **[Security](docs/security/)** — auth model, threat surface, scanning
- 📖 **[API reference](docs/api-reference/)** — generated from the contract (published to GitHub Pages)

Agent/dev conventions live in [`AGENTS.md`](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).
