# Consumer guide

How to build against this API as a consumer — without waiting for it to be deployed.

- **Generate a client** from the published contract (`api/openapi.yaml`) or the released SDK package.
- **Develop against the mock** — a Prism mock server serves realistic responses from the contract.
- **Explore interactively** — import `collections/*.http` into VS Code REST Client or JetBrains HTTP
  Client; switch environment (local/dev/staging/prod) in `http-client.env.json`.
- **Authenticate** — obtain a Cognito JWT; send it as `Authorization: Bearer <token>`. Send your API
  key as `x-api-key` where usage plans apply.
- **Read the reference** — the generated [API reference](../api-reference/).

_Expanded in Phase 8._
