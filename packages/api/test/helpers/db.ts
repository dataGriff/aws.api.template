import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runner } from "node-pg-migrate";

// The Ryuk resource reaper hangs on some Docker backends (notably macOS/colima).
// Tests stop their containers explicitly and CI runners are ephemeral, so it is
// safe to disable. Must be set before importing testcontainers.
process.env.TESTCONTAINERS_RYUK_DISABLED ??= "true";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations");

export interface TestDatabase {
  connectionUri: string;
  stop: () => Promise<void>;
}

// Starts a real Postgres 16 in Docker (or, when TEST_DATABASE_URL is set,
// reuses that EMPTY database and skips Docker), applies EVERY migration with
// the same node-pg-migrate runner that `task db:migrate` uses — so the runner
// itself and any newly added migration are exercised — and points the app pool
// at it via DATABASE_URL.
export async function startDb(): Promise<TestDatabase> {
  const preset = process.env.TEST_DATABASE_URL;
  let db: TestDatabase;
  if (preset) {
    db = { connectionUri: preset, stop: async () => {} };
  } else {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("app")
      .withUsername("app")
      .withPassword("app")
      .start();
    db = {
      connectionUri: container.getConnectionUri(),
      stop: () => container.stop().then(() => {}),
    };
  }

  process.env.DATABASE_URL = db.connectionUri;
  delete process.env.DB_IAM_AUTH;
  delete process.env.IDEMPOTENCY_TABLE;

  await runner({
    databaseUrl: db.connectionUri,
    dir: migrationsDir,
    direction: "up",
    migrationsTable: "pgmigrations",
    noLock: true,
    log: () => {},
  });

  return db;
}
