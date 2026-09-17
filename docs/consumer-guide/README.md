# Consumer guide

How to build against this API — before or after it is deployed. Everything a consumer needs is
generated from `api/openapi.yaml`.

## 1. Authenticate

The API uses Cognito JWTs. Send the access token as a bearer header; send your API key where usage
plans apply:

```http
Authorization: Bearer <cognito_access_token>
x-api-key: <your_api_key>
```

Get a token from the Cognito hosted UI (Authorization Code + PKCE) for user-facing apps, or via
`USER_PASSWORD_AUTH` against a test app client for scripts/CI:

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$APP_CLIENT_ID" \
  --auth-parameters USERNAME=alice@example.com,PASSWORD='…'
```

The token carries `custom:tenant_id` and `roles` claims (added by the pre-token trigger). The API scopes
every response to your tenant + user.

## 2. Explore with the .http collection

Import `collections/*.http` into the VS Code REST Client or JetBrains HTTP Client. Pick an environment
(`local` / `dev` / `staging` / `prod`) in `collections/http-client.env.json`, set your `token` and
`apiKey`, and fire requests. Run them headlessly with `httpyac send collections/todos.http --all`.

## 3. Generate a client

Use the published SDK, or generate your own from the contract:

```bash
# Your own typed client (fetch) with openapi-typescript / Kubb / orval, e.g.:
npx openapi-typescript api/openapi.yaml -o ./todo-api.d.ts

# …or consume the published package (once your org's registry is configured):
#   npm install @your-scope/todo-api-sdk
```

The generated SDK exposes typed functions per `operationId` (`listTodos`, `createTodo`, …) plus request
and response types.

## 4. Develop against the mock

No deployment needed — Prism serves realistic responses from the contract:

```bash
docker compose -f local/docker-compose.yml up prism    # http://localhost:4010
```

Point your client at the mock while the real API is still being built. Because both derive from the same
contract, switching to the real endpoint later is just a base-URL change.

## 5. Contract conventions to rely on

- **Errors** are RFC 7807 `application/problem+json` with a `request_id` for support.
- **Pagination** is cursor-based: pass the `next_cursor` from a page back as `cursor`.
- **Idempotency:** send an `Idempotency-Key` header on creates to make retries safe.
- **Field naming** is `lower_snake_case` throughout.
- **Versioning:** the base path is `/v1`; breaking changes ship under a new version.
