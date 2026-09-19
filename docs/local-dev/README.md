# Local development

Everything runs locally with no AWS account.

- `task up` starts Postgres, **cognito-local**, the **Prism** mock and **moto** (S3 + SQS + KMS for the
  CSV import) via `local/docker-compose.yml`, applies migrations and provisions the import bucket,
  queue, key and bucket notification in moto (`local/aws-local-init.mjs`, idempotent).
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
- **CSV import**: run `task import:worker` next to `task serve` — it stands in for the deployed
  SQS → Lambda mapping by polling the moto queue and running the real ingest handler
  (`packages/api/src/import/handler.ts`). Then `task import:file FILE=api/examples/todo-import.valid.csv`
  drives the whole flow as a client would (register, upload to the pre-signed target, poll the status)
  and prints the outcome; try `todo-import.invalid.csv` to see a rejection, then look at
  `quarantine/` in the bucket (`aws --endpoint-url http://localhost:5000 s3 ls s3://todo-api-local-imports/quarantine/ --recursive`).
  `local/local-env.mjs` holds the local names; the code reads them from the same environment
  variables the Lambdas get (`IMPORT_BUCKET`, `IMPORT_KMS_KEY_ARN`, `AWS_ENDPOINT_URL`).
