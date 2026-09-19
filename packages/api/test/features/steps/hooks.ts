import { AfterAll, Before, BeforeAll, setDefaultTimeout } from "@cucumber/cucumber";
import { startDb, type TestDatabase } from "../../helpers/db.js";
import { startAws, type StartedAws } from "../../helpers/aws.js";

setDefaultTimeout(60_000);

let db: TestDatabase;
// S3/SQS/KMS (moto) for the import scenarios; exported for the steps.
export let aws: StartedAws;

// One Postgres and one moto for the whole suite (behavioural tests hit the
// real handlers against real stores); every scenario starts from empty tables
// so assertions can be exact and scenario order is never load-bearing.
BeforeAll({ timeout: 240_000 }, async () => {
  db = await startDb();
  aws = await startAws();
  const { resetConfig } = await import("../../../src/config.js");
  const { resetAwsClients } = await import("../../../src/aws.js");
  resetConfig();
  resetAwsClients();
});

Before(async () => {
  const { query } = await import("../../../src/db/pool.js");
  await query("TRUNCATE todos, todo_imports");
});

AfterAll(async () => {
  const { closePool } = await import("../../../src/db/pool.js");
  await closePool();
  await aws?.stop();
  await db?.stop();
});
