# Local development

Everything runs locally with no AWS account.

- `task up` starts Postgres, **cognito-local**, and the **Prism** mock via `local/docker-compose.yml`,
  then applies migrations.
- `task serve` runs the real Lambda handler behind a local HTTP server (`local/server.ts`).
- **Auth locally**: `task token` mints a JWT from cognito-local. Because cognito-local's trigger
  fidelity is partial, a **static-JWKS stub authorizer** is available so tests never depend on emulator
  quirks; the real pre-token trigger logic is exercised by unit tests.
- **SQL**: `task db:query -- <name>` runs a curated example query; `task db:console` opens Harlequin.
