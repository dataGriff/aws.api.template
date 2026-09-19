import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runner } from "node-pg-migrate";

// The Ryuk resource reaper hangs on some Docker backends (notably macOS/colima).
// Tests stop their containers explicitly and CI runners are ephemeral, so it is
// safe to disable. Must be set before importing testcontainers.
process.env.TESTCONTAINERS_RYUK_DISABLED ??= "true";

const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
type StartedPostgreSqlContainer = Awaited<
  ReturnType<InstanceType<typeof PostgreSqlContainer>["start"]>
>;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations");

// Starts a real Postgres in Docker, applies EVERY migration with the same
// node-pg-migrate runner that `task db:migrate` uses (so the runner itself and
// any newly added migration are exercised), and points the app pool at it via
// DATABASE_URL. Requires Docker.
export async function startDb(): Promise<StartedPostgreSqlContainer> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("app")
    .withUsername("app")
    .withPassword("app")
    .start();

  process.env.DATABASE_URL = container.getConnectionUri();
  delete process.env.DB_IAM_AUTH;
  delete process.env.IDEMPOTENCY_TABLE;

  await runner({
    databaseUrl: container.getConnectionUri(),
    dir: migrationsDir,
    direction: "up",
    migrationsTable: "pgmigrations",
    noLock: true,
    log: () => {},
  });

  return container;
}
