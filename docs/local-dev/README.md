# Local development

Everything runs locally with no AWS account.

- `task up` starts Postgres, **cognito-local**, and the **Prism** mock via `local/docker-compose.yml`,
  then applies migrations.
- `task serve` runs the real Lambda handler behind a local HTTP server (`local/server.ts`).
- **Auth locally**: `local/server.ts` runs a **stub authorizer** that decodes the bearer JWT
  _without verifying it_ (it refuses to start unless `APP_ENV=local` and binds to `127.0.0.1` only).
  `task token` mints an unsigned stub token with the `sub` / `custom:tenant_id` / `cognito:groups`
  claims you ask for (`--sub`, `--tenant`, `--groups`) and writes it to the git-ignored
  `collections/http-client.private.env.json`; it does not talk to cognito-local. cognito-local is
  there for exercising real hosted-UI / token flows against the emulator; the pre-token trigger logic
  itself is covered by unit tests.
- **.http collection**: `httpyac send collections/todos.http --all --env local` (the private env file
  is merged over `http-client.env.json`).
- **SQL**: `task db:query -- <name>` runs a curated example query; `task db:console` opens Harlequin.
