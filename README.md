# aws.api.template

A **best-practice, secure AWS API template** you can clone and re-skin for **one API service**:
TypeScript Lambda · API Gateway **REST API** · its own **Postgres** (parameterisable Aurora ↔ RDS)
· **Terraform** (multi-env, OIDC) · fully runnable locally · BDD + contract + property tests ·
single-command CI that matches local exactly.

It is one of three templates — the API deploys **onto a platform** and implements **a published
contract**:

| Repo                                                                        | Owns                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **aws.api.template** (this)                                                 | One API: Lambda, REST API, database + proxy + secret, idempotency table, alarms, hostname, tests  |
| [aws.infra.template](https://github.com/dataGriff/aws.infra.template)       | The platform, per account: state + OIDC deploy roles, VPC, KMS, Cognito, WAF, certificate, alarms |
| [aws.contract.template](https://github.com/dataGriff/aws.contract.template) | The contract as the `@datagriff/todo-api-contract` package (spec, types, zod, client, .http)      |

The bundled example is a **multi-tenant Todo API**. Swap it for your own with the **adopt-api**
skill (after authoring your contract with the contract template's `author-contract` skill).

---

## Quickstart

```bash
# 0. Registry auth for the contract package (GitHub Packages, scope @datagriff):
#    add `//npm.pkg.github.com/:_authToken=<PAT with read:packages>` to ~/.npmrc

# 1. Install every pinned tool (node, pnpm, terraform, task, scanners, ...)
mise install

# 2. Install dependencies (also installs the git hooks via `prepare`)
pnpm install

# 3. Bring up the local stack (Postgres + cognito-local) and migrate
task up

# 4. Run the API locally and fire the contract's .http collection at it
task serve            # in one terminal
task http FILE=todos  # stub token minted on the fly; or `task token` for your editor's REST client

# 5. Run the full gate exactly as CI does:
task ci
```

## What you get

| Area                | Highlights                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contract-first**  | The API pins a version of `@datagriff/todo-api-contract`: zod validation in the handler, the API Gateway spec rendered from it (drift-gated), the published client run against the service on every PR. |
| **Platform-native** | Reads the platform's SSM interface (`/platform/<env>/…`) for VPC, KMS keys, Cognito, WAF ACL, certificate and alarm topic; refuses to plan against another interface version.                           |
| **Secure auth**     | Platform Cognito JWTs validated by the gateway's Cognito authorizer; every query scoped by tenant + user claims; API keys + usage plans; opt-in WAF attachment.                                         |
| **Data**            | Its own Postgres via RDS Proxy (IAM auth, pooled), parameterisable Aurora Serverless v2 ↔ RDS, encrypted with the platform's data key. Forward-only migrations run out-of-band.                         |
| **Infra**           | Terraform `stack` + `dev/staging/prod` envs; deploy role + state backend provisioned by the platform bootstrap; prod guardrails; opt-in WAF and custom hostname.                                        |
| **Testing**         | vitest unit + integration (testcontainers), cucumber-js BDD, contract tests over real HTTP (Schemathesis provider + published client consumer + .http replay), Schemathesis fuzz.                       |
| **DX**              | mise + Taskfile, lefthook hooks (`task check` / `task ci`), one CI that runs identically locally.                                                                                                       |
| **Ops**             | CloudWatch dashboard + alarms into the platform topic, X-Ray tracing, structured logs, SBOM, Infracost, semantic-release.                                                                               |

## Documentation

Docs use a fan-out layout under [`docs/`](docs/):

- 📘 **[Tutorial](docs/tutorial/)** — build it yourself, step by step (doubles as a ticket backlog)
- 🔌 **[Consumer guide](docs/consumer-guide/)** — consumers install the contract package; pointer
- 📐 **[Architecture](docs/architecture/)** — components, the three-repo picture, decisions
- 💻 **[Local dev](docs/local-dev/)** — the local stack in detail
- 🧪 **[Testing](docs/testing/)** — the test pyramid and what each layer owns
- 🛠️ **[Operations](docs/operations/)** — first-time wiring, deploy, rollback, contract bumps
- 🔒 **[Security](docs/security/)** — auth model, threat surface, scanning

Agent/dev conventions live in [`AGENTS.md`](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).
