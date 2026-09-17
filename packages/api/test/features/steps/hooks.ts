import { AfterAll, BeforeAll, setDefaultTimeout } from "@cucumber/cucumber";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../../helpers/db.js";

setDefaultTimeout(60_000);

let container: StartedPostgreSqlContainer;

// One Postgres container for the whole suite (behavioural tests hit the real
// handler against a real database).
BeforeAll({ timeout: 180_000 }, async () => {
  container = await startDb();
});

AfterAll(async () => {
  const { closePool } = await import("../../../src/db/pool.js");
  await closePool();
  await container?.stop();
});
