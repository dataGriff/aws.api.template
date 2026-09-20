// Contract test layer: exercises the API over REAL HTTP against the local
// stack, so the gate does not rely solely on in-process handler invocation.
//
//   Postgres (testcontainers)  <-  local/server.ts (stub authorizer, loopback)
//        ^ every migration via node-pg-migrate      ^
//        |                                          |  real HTTP
//        +-- provider: Schemathesis (--checks all, stateful via links)
//        +-- consumer: the published client through every operation (sdk-consumer.ts)
//        +-- collection: httpyac replays the package's .http files
//
// The contract, the client and the collection all come from the installed
// @datagriff/todo-api-contract package: this layer proves the API honours the
// exact version it pins.
//
// Backward compatibility of the contract itself is the contract repo's gate
// (oasdiff); a major bump of the package is the signal to change this API.
//
// What it does NOT cover: anything API Gateway does in front of the Lambda
// (Cognito authorizer, request validator, gateway responses, CORS, throttling,
// WAF). That is the opt-in fuzz.yml run against a deployed stage.
//
// Hermetic: a fresh container and a random loopback port per run, torn down on
// exit (including failure / SIGINT). Set TEST_DATABASE_URL to reuse an existing
// empty Postgres instead of Docker (migrations still run) — the same switch the
// integration and BDD suites honour.
import { spawn, type ChildProcess } from "node:child_process";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parse } from "yaml";
import { runSdkConsumer } from "./sdk-consumer.js";
import { collectionPath, contractPath, contractVersion } from "../helpers/contract.js";

const execFile = promisify(execFileCb);

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "../..");
const root = join(apiDir, "../..");

const EXAMPLES = process.env.SCHEMATHESIS_EXAMPLES ?? "25";
const HEALTH_TIMEOUT_MS = 60_000;

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];
let exiting = false;

async function cleanupAll(): Promise<void> {
  if (exiting) return;
  exiting = true;
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch (err) {
      console.error("cleanup failed:", err);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.error(`\n${signal} received — tearing down`);
    void cleanupAll().then(() => process.exit(130));
  });
}

function fail(message: string): never {
  throw new Error(message);
}

// --- 1. Database ------------------------------------------------------------
async function startDatabase(): Promise<string> {
  console.log(
    process.env.TEST_DATABASE_URL
      ? "▶ using TEST_DATABASE_URL (no container) and applying migrations"
      : "▶ starting Postgres 16 (testcontainers) and applying migrations",
  );
  // startDb() applies every migration with the real runner and sets DATABASE_URL.
  const { startDb } = await import("../helpers/db.js");
  const db = await startDb();
  cleanups.push(async () => {
    console.log("▶ stopping Postgres");
    await db.stop();
  });
  return db.connectionUri;
}

// --- 2. Local server --------------------------------------------------------
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

async function startServer(databaseUrl: string, port: number): Promise<string> {
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  console.log(`▶ starting local/server.ts on ${baseUrl}`);
  // The stub authorizer only runs with APP_ENV=local (enforced by the server).
  const child: ChildProcess = spawn("pnpm", ["exec", "tsx", "../../local/server.ts"], {
    cwd: apiDir,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      APP_ENV: "local",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: process.env.LOG_LEVEL ?? "WARN",
      POWERTOOLS_DEV: "true",
      IDEMPOTENCY_TABLE: "",
    },
  });
  // Object wrapper: the exit code is set from an event callback, which TS
  // cannot see when narrowing a plain `let` inside the polling loops below.
  const state: { exited: number | null } = { exited: null };
  child.on("exit", (code) => (state.exited = code ?? -1));
  cleanups.push(async () => {
    if (state.exited !== null) return;
    console.log("▶ stopping local server");
    child.kill("SIGTERM");
    const deadline = Date.now() + 5_000;
    while (state.exited === null && Date.now() < deadline) await sleep(100);
    if (state.exited === null) child.kill("SIGKILL");
  });

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.exited !== null) fail(`local server exited early with code ${state.exited}`);
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) {
        console.log("▶ GET /v1/health → 200");
        return baseUrl;
      }
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  return fail(`local server did not answer GET /v1/health with 200 within ${HEALTH_TIMEOUT_MS} ms`);
}

// --- 3. Token ---------------------------------------------------------------
async function mintToken(): Promise<string> {
  const { stdout } = await execFile(process.execPath, [
    join(root, "scripts/mint-token.mjs"),
    "--print",
    "--sub",
    "http-test-user",
    "--tenant",
    "http-test-tenant",
  ]);
  const token = stdout.trim();
  if (!token) fail("mint-token.mjs --print produced no token");
  return token;
}

// --- 4. Schemathesis --------------------------------------------------------
function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? -1));
  });
}

async function runSchemathesis(baseUrl: string, token: string): Promise<void> {
  console.log(
    `▶ provider conformance: schemathesis --checks all (${EXAMPLES} examples per operation)`,
  );
  const code = await run("./scripts/schemathesis.sh", [], {
    SCHEMA: contractPath,
    API_URL: baseUrl,
    API_TOKEN: token,
    API_KEY: "local-dev-key",
    SCHEMATHESIS_EXAMPLES: EXAMPLES,
    // The stub authorizer accepts any well-formed bearer token, so the checks
    // that probe HOW auth is enforced are meaningless here; they are covered by
    // the deployed-stage fuzz run where API Gateway's Cognito authorizer is
    // in front. Every response-conformance check still runs.
    SCHEMATHESIS_EXCLUDE_CHECKS: "ignored_auth",
  });
  if (code !== 0) fail(`schemathesis failed (exit ${code})`);
}

// --- 5. .http collection ----------------------------------------------------
type HttpyacReport = {
  requests?: { name?: string; title?: string; response?: { statusCode?: number } }[];
  summary?: { totalRequests?: number; failedRequests?: number; successRequests?: number };
};

// Status codes each operation declares in the contract, keyed by operationId.
function declaredStatuses(): Map<string, Set<number>> {
  const spec = parse(readFileSync(contractPath, "utf8")) as {
    paths: Record<
      string,
      Record<string, { operationId?: string; responses?: Record<string, unknown> }>
    >;
  };
  const out = new Map<string, Set<number>>();
  for (const item of Object.values(spec.paths)) {
    for (const op of Object.values(item)) {
      if (op && typeof op === "object" && "operationId" in op && op.operationId) {
        out.set(op.operationId, new Set(Object.keys(op.responses ?? {}).map(Number)));
      }
    }
  }
  return out;
}

async function httpyac(
  baseUrl: string,
  token: string,
  extraVars: string[],
): Promise<HttpyacReport> {
  const args = [
    "send",
    collectionPath("todos.http"),
    collectionPath("health.http"),
    "--all",
    "--env",
    "local",
    "--var",
    `baseUrl=${baseUrl}`,
    "--var",
    `token=${token}`,
    "--var",
    "apiKey=local-dev-key",
    ...extraVars.flatMap((v) => ["--var", v]),
    "--json",
    "--output",
    "short",
  ];
  const { stdout } = await execFile("httpyac", args, {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  }).catch((err: { stdout?: string; code?: number }) => {
    // httpyac exits non-zero on failed requests but still prints the report.
    if (typeof err.stdout === "string" && err.stdout.trim().startsWith("{"))
      return { stdout: err.stdout };
    throw err;
  });
  return JSON.parse(stdout.slice(stdout.indexOf("{"))) as HttpyacReport;
}

// Pass 1 runs the collection exactly as generated (placeholder ids → declared
// 404s). Pass 2 substitutes a real id created over HTTP so get/update/delete
// are exercised on their success paths; there every request must be 2xx.
async function runHttpCollection(baseUrl: string, token: string): Promise<void> {
  const declared = declaredStatuses();
  const failures: string[] = [];

  const check = (report: HttpyacReport, label: string, requireSuccess: boolean) => {
    const seen = new Set<string>();
    for (const req of report.requests ?? []) {
      const name = req.name ?? req.title ?? "(unnamed)";
      const status = req.response?.statusCode;
      const allowed = declared.get(name);
      seen.add(name);
      console.log(`  [${label}] ${name} → ${status ?? "-"}`);
      if (status === undefined) failures.push(`${label} ${name}: no response`);
      else if (status >= 500) failures.push(`${label} ${name}: server error ${status}`);
      else if (!allowed)
        failures.push(
          `${label} ${name}: request name does not match an operationId (regenerate with task gen)`,
        );
      else if (!allowed.has(status))
        failures.push(`${label} ${name}: ${status} is not declared in the contract`);
      else if (requireSuccess && status >= 300)
        failures.push(`${label} ${name}: expected a 2xx, got ${status}`);
    }
    if (seen.size === 0) failures.push(`${label}: httpyac reported no requests`);
    return seen;
  };

  console.log("▶ httpyac pass 1: collection as generated (--env local)");
  const first = check(await httpyac(baseUrl, token, []), "as-generated", false);
  for (const mustPass of ["get_health", "list_todos", "create_todo"]) {
    if (declared.has(mustPass) && !first.has(mustPass))
      failures.push(`as-generated: ${mustPass} missing from the collection`);
  }

  console.log("▶ httpyac pass 2: with a real todo_id");
  const created = await fetch(`${baseUrl}/todos`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "http-layer fixture" }),
  });
  if (created.status !== 201) fail(`fixture POST /todos returned ${created.status}`);
  const { todo_id } = (await created.json()) as { todo_id: string };
  check(await httpyac(baseUrl, token, [`todo_id=${todo_id}`]), "real-id", true);

  if (failures.length) fail(`.http collection failed:\n  - ${failures.join("\n  - ")}`);
}

// --- main -------------------------------------------------------------------
try {
  console.log(`▶ contract under test: @datagriff/todo-api-contract ${contractVersion}`);
  const databaseUrl = await startDatabase();
  const port = Number(process.env.HTTP_TEST_PORT ?? (await freePort()));
  const baseUrl = await startServer(databaseUrl, port);
  const token = await mintToken();
  await runSchemathesis(baseUrl, token);
  await runSdkConsumer(baseUrl, token);
  await runHttpCollection(baseUrl, token);
  console.log("✔ contract layer passed (provider conformance, SDK consumer, .http collection)");
  await cleanupAll();
  process.exit(0);
} catch (err) {
  console.error("✖ contract layer failed:", err instanceof Error ? err.message : err);
  await cleanupAll();
  process.exit(1);
}
