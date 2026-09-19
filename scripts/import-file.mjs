#!/usr/bin/env node
// Imports a CSV file through the API the way a consumer would, end to end:
//   POST /imports -> multipart POST of the file to the pre-signed target ->
//   poll GET /imports/{import_id} until completed or rejected.
// Local default: the stub-authorized server from `task serve` with the moto
// stack from `task up` and the worker from `task import:worker`. Point BASE_URL
// and TOKEN at a deployed stage to use it there (real Cognito token needed).
//
//   node scripts/import-file.mjs api/examples/todo-import.valid.csv
//   BASE_URL=https://…/v1 TOKEN=eyJ… API_KEY=… node scripts/import-file.mjs todos.csv
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/import-file.mjs <file.csv>");
  process.exit(64);
}
const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000/v1").replace(/\/$/, "");
const apiKey = process.env.API_KEY ?? "local-dev-key";
const token =
  process.env.TOKEN ??
  execFileSync(process.execPath, [
    join(dirname(fileURLToPath(import.meta.url)), "mint-token.mjs"),
    "--print",
  ]).toString();
const headers = { authorization: `Bearer ${token}`, "x-api-key": apiKey };

const call = async (path, init = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    console.error(`${init.method ?? "GET"} ${path} → ${res.status}`, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  return body;
};

const started = await call("/imports", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ file_name: basename(file) }),
});
console.log(`import ${started.import_id}: registered (${started.status})`);

const form = new FormData();
for (const [k, v] of Object.entries(started.upload.fields)) form.append(k, v);
form.append("file", new Blob([readFileSync(file)], { type: "text/csv" }), basename(file));
const uploaded = await fetch(started.upload.url, { method: "POST", body: form });
if (!uploaded.ok) {
  console.error(`upload rejected by S3: ${uploaded.status}\n${await uploaded.text()}`);
  process.exit(1);
}
console.log(`import ${started.import_id}: file uploaded (${uploaded.status})`);

const deadline = Date.now() + Number(process.env.IMPORT_TIMEOUT_MS ?? 60_000);
let current = started;
while (Date.now() < deadline && !["completed", "rejected"].includes(current.status)) {
  await new Promise((r) => setTimeout(r, 500));
  current = await call(`/imports/${started.import_id}`);
}
console.log(JSON.stringify(current, null, 2));
if (current.status === "completed") process.exit(0);
if (current.status === "rejected") {
  console.error("import REJECTED: nothing was created; the file was quarantined with a report");
  process.exit(2);
}
console.error("import did not finish in time — is `task import:worker` running?");
process.exit(3);
