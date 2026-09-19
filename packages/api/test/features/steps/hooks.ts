import { AfterAll, Before, BeforeAll, setDefaultTimeout } from "@cucumber/cucumber";
import { startDb, type TestDatabase } from "../../helpers/db.js";

setDefaultTimeout(60_000);

let db: TestDatabase;

// One Postgres for the whole suite (behavioural tests hit the real handler
// against a real database); every scenario starts from an empty table so
// assertions can be exact and scenario order is never load-bearing.
BeforeAll({ timeout: 180_000 }, async () => {
  db = await startDb();
});

Before(async () => {
  const { query } = await import("../../../src/db/pool.js");
  await query("TRUNCATE todos");
});

AfterAll(async () => {
  const { closePool } = await import("../../../src/db/pool.js");
  await closePool();
  await db?.stop();
});
