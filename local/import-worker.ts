// Local stand-in for the deployed SQS -> Lambda mapping of the CSV import
// ingest: long-polls the moto queue and runs the real handler
// (packages/api/src/import/handler.ts) against the local Postgres. Start with
// `task import:worker` next to `task serve`; then `task import:file FILE=…`.
import { applyLocalAwsDefaults } from "./local-env.mjs";
import { processQueueOnce, sqsClientFromEnv, type IngestHandler } from "./import-queue.js";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgresql://app:app@localhost:5432/app";
process.env.POWERTOOLS_SERVICE_NAME ??= "todo-api-local-import";
applyLocalAwsDefaults();

// middy's handler type also accepts the legacy callback argument; the worker calls it with two.
const { handler } = (await import("../packages/api/src/import/handler.ts")) as unknown as {
  handler: IngestHandler;
};
const sqs = sqsClientFromEnv();
const queueUrl = process.env.IMPORT_QUEUE_URL!;
console.log(`Import worker polling ${queueUrl} (bucket ${process.env.IMPORT_BUCKET})`);

let running = true;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (running = false));

while (running) {
  try {
    const outcomes = await processQueueOnce(sqs, queueUrl, handler, 20);
    for (const o of outcomes) console.log(JSON.stringify(o));
  } catch (err) {
    console.error("import worker error:", err);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}
