# AGENTS.md

Guidance for AI agents and developers. Kept intentionally light — details live in `docs/`.

## What this is

A reusable, contract-first, secure AWS API template: TypeScript Lambda + API Gateway REST API +
Cognito (custom claims) + Postgres, deployed with Terraform. The worked example is a multi-tenant Todo
app. See `docs/architecture/` for the full picture.

## Golden rules

- **The contract is the source of truth.** `api/openapi.yaml` drives generated code, gateway
  validation, the SDK, mocks, docs and `.http` files. Change the contract first, then run `task gen`.
- **Never edit generated code by hand.** Anything under `**/generated/`, `collections/`,
  `docs/api-reference/` is produced by `task gen` and gated in CI (`task gen:check`).
- **Everything runs through the Taskfile.** Don't invent ad-hoc scripts — add/extend a `task`. Git
  hooks and CI call the same targets so local == CI.
- **Contract naming is `lower_snake_case`** (enforced by Spectral). Let codegen emit it; don't remap.
- **Tenant isolation is mandatory.** Every query is scoped by the Cognito `sub`/tenant claim; never
  trust a client-supplied owner id.

## Common commands

| Command | Purpose |
| --- | --- |
| `mise install` | Install all pinned tools |
| `task up` / `task down` | Start / stop the local stack (Postgres, cognito-local, Prism) |
| `task gen` | Regenerate everything from the contract |
| `task check` | Fast gate (pre-commit) |
| `task ci` | Full gate — identical locally and in CI |
| `task test:fuzz` | Schemathesis property fuzzing |
| `task db:console` | Interactive SQL (Harlequin) |
| `task deploy ENV=dev` | Deploy an environment |

## Where to look

- **Build it yourself, step by step:** `docs/tutorial/` (also a ready-to-use ticket backlog)
- **Consume the API:** `docs/consumer-guide/`
- **Architecture & decisions:** `docs/architecture/`
- **Run locally:** `docs/local-dev/`
- **Testing strategy:** `docs/testing/`
- **Operate it (runbooks, rollback, rotation):** `docs/operations/`
- **Security model:** `docs/security/`

## Adopt this template for a new API

Run the `adopt-contract` skill (see `.claude/skills/adopt-contract/`) to swap the Todo contract for
your own and regenerate the whole project.
