#!/usr/bin/env node
// Mints an UNSIGNED stub JWT for local development and writes it into the
// git-ignored .http private environment (collections/http-client.private.env.json)
// so collections/*.http requests are runnable. The local server's stub authorizer
// reads (but does not verify) the token; nothing else accepts it. It never
// contacts cognito-local. For a DEPLOYED environment, obtain a real token from
// Cognito (USER_PASSWORD_AUTH against the test client) and put it in the same
// private file — never in the tracked http-client.env.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  if (env !== "local") {
    console.error(
      `Refusing to mint a stub token for '${env}': it is unsigned and only the local stub authorizer accepts it. Obtain a real Cognito token instead (docs/consumer-guide).`,
    );
    process.exit(1);
  }
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "collections",
    "http-client.private.env.json",
  );
  const envs = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  envs[env] = { ...(envs[env] ?? {}), token };
  writeFileSync(file, JSON.stringify(envs, null, 2) + "\n");
  console.log(
    `Wrote token for '${env}' (sub=${sub}, tenant=${tenant}) into collections/http-client.private.env.json (git-ignored)`,
  );
}
