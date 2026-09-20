# AGENTS.md

Guidance for AI agents and developers. Kept intentionally light — details live in `docs/`.

## What this is

A reusable, contract-first, secure AWS API template for **one API service**: TypeScript Lambda +
API Gateway REST API + its own Postgres, deployed with Terraform **onto a platform**
(`aws.infra.template`: network, KMS, Cognito, WAF, alarms, deploy roles) and implementing **a
published contract** (`aws.contract.template` → the `@datagriff/todo-api-contract` package). The
worked example is a multi-tenant Todo app. See `docs/architecture/` for the full picture.

## Golden rules

- **The contract is the source of truth, and it is a dependency.** The API pins an exact version of
  `@datagriff/todo-api-contract` (`packages/api/package.json`; bumps are explicit diffs). To change the API's surface, change
  the contract repo, release it, then `task contract:bump VERSION=…` here and run `task gen`. Never
  copy the spec into this repo.
- **Never edit generated code by hand.** `infra/terraform/modules/api-gateway/openapi.gateway.yaml`
  is rendered by `task gen` from the installed contract and gated in CI (`task gen:check`).
- **Platform inputs come only from the SSM interface.** `infra/terraform/modules/platform` reads
  `/platform/<env>/…`; never read platform state or hard-code platform ids.
- **Everything runs through the Taskfile.** Don't invent ad-hoc scripts — add/extend a `task`. Git
  hooks and CI call the same targets so local == CI.
- **Tenant isolation is mandatory.** Every query is scoped by the Cognito `sub`/tenant claim; never
  trust a client-supplied owner id.

## Common commands

| Command                        | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `mise install`                 | Install all pinned tools                                      |
| `task up` / `task down`        | Start / stop the local stack (Postgres, cognito-local)        |
| `task gen`                     | Render the gateway spec from the installed contract           |
| `task contract:bump VERSION=x` | Pin a new contract version                                    |
| `task contract:link`           | Co-develop against a sibling `aws.contract.template` checkout |
| `task http FILE=todos`         | Fire the contract's .http collection at the local server      |
| `task check`                   | Fast gate (pre-commit)                                        |
| `task ci`                      | Full gate — identical locally and in CI                       |
| `task test:fuzz`               | Schemathesis property fuzzing                                 |
| `task db:console`              | Interactive SQL (Harlequin)                                   |
| `task deploy ENV=dev`          | Deploy an environment                                         |

## Where to look

- **Build it yourself, step by step:** `docs/tutorial/` (also a ready-to-use ticket backlog)
- **Consume the API:** the contract repo's consumer guide (`docs/consumer-guide/` points there)
- **Architecture & decisions:** `docs/architecture/`
- **Run locally:** `docs/local-dev/`
- **Testing strategy:** `docs/testing/`
- **Operate it (wiring, deploy, rollback, rotation):** `docs/operations/`
- **Security model:** `docs/security/`

## Adopt this template for a new API

Author your contract with the contract template's `author-contract` skill and release it, then run
the `adopt-api` skill here (see `.claude/skills/adopt-api/`) to pin it and replace the Todo domain.
