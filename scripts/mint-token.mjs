#!/usr/bin/env node
// Mints a JWT for local development and writes it into the .http environment so
// collections/*.http requests are runnable. Locally the API server uses a stub
// authorizer that reads (but does not verify) the token, so an unsigned token is
// sufficient. For a DEPLOYED environment, obtain a real token from Cognito
// (USER_PASSWORD_AUTH against a test client) instead — see docs/consumer-guide.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) =>
      a.startsWith("--")
        ? [[a.slice(2), arr[i + 1]?.startsWith("--") ? true : (arr[i + 1] ?? true)]]
        : [],
    ),
);

const sub = args.sub ?? "local-user";
const tenant = args.tenant ?? "local-tenant";
const groups = (args.groups ?? "").split(",").filter(Boolean);
const env = args.env ?? "local";

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const payload = {
  sub,
  "custom:tenant_id": tenant,
  "cognito:groups": groups,
  token_use: "access",
  iat: now,
  exp: now + 3600,
};
const token = `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.stub`;

if (args.print) {
  process.stdout.write(token);
} else {
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "collections",
    "http-client.env.json",
  );
  const envs = JSON.parse(readFileSync(file, "utf8"));
  envs[env] ??= { baseUrl: "http://localhost:3000/v1", apiKey: "local-dev-key" };
  envs[env].token = token;
  writeFileSync(file, JSON.stringify(envs, null, 2) + "\n");
  console.log(
    `Wrote token for '${env}' (sub=${sub}, tenant=${tenant}) into collections/http-client.env.json`,
  );
}
