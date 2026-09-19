# Local development

Everything runs locally with no AWS account.

- `task up` starts Postgres and **cognito-local** via `local/docker-compose.yml`, then applies
  migrations.
- `task serve` runs the real Lambda handler behind a local HTTP server (`local/server.ts`).
- **Auth locally**: `local/server.ts` runs a **stub authorizer** that decodes the bearer JWT
  _without verifying it_ (it refuses to start unless `APP_ENV=local` and binds to `127.0.0.1` only).
  `task token` mints an unsigned stub token with the `sub` / `custom:tenant_id` / `cognito:groups`
  claims you ask for (`--sub`, `--tenant`, `--groups`) and writes it to the git-ignored
  `collections/http-client.private.env.json`; it does not talk to cognito-local. cognito-local is
  there for exercising real hosted-UI / token flows against the emulator; the pre-token trigger
  itself lives in the platform repo (`aws.infra.template/packages/cognito-pretoken`).
- **.http collections** ship in the contract package: `task http FILE=todos` sends
  `node_modules/…/collections/todos.http` at the local server with a stub token minted on the fly.
  For an editor's REST client, open the same files (`task contract:dir` prints the package
  directory) and pick the `local` environment.
- **Mock**: not part of the local stack any more — the contract package ships the spec, so
  `npx @stoplight/prism-cli mock "$(task -s contract:path)"` (or `task mock` in the contract repo)
  serves a mock on `:4010`.
- **Contract co-development**: `task contract:link` points `node_modules` at a built sibling
  checkout of `aws.contract.template` (`CONTRACT_DIR=…` to override); `task contract:unlink` goes
  back to the registry version.
- **SQL**: `task db:query -- <name>` runs a curated example query; `task db:console` opens Harlequin.
