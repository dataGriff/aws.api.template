import middy from "@middy/core";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { captureLambdaHandler } from "@aws-lambda-powertools/tracer/middleware";
import { logMetrics } from "@aws-lambda-powertools/metrics/middleware";
import { MetricUnit } from "@aws-lambda-powertools/metrics";
import type { S3Event, SQSEvent } from "aws-lambda";
import type { TodoImportError } from "@app/contracts";
import { todoImportContract, todoImportLimits } from "@app/contracts";
import type { AuthContext } from "../auth/claims.js";
import { withTransaction } from "../db/pool.js";
import { createTodo } from "../domain/todos.js";
import { logger, metrics, tracer } from "../observability.js";
import * as imports from "../repo/imports-repo.js";
import { MAX_REPORTED_ERRORS, parseImportCsv } from "./csv.js";
import * as storage from "./storage.js";

// Ingest Lambda: S3 "object created" under uploads/ -> SQS -> here.
//
// Trust model: the object key is only a lookup. The todo_imports row it maps to
// (written by create_import from a validated token) says whose todos the file
// may create; the file content and the key never do. Anything under uploads/
// that does not map to a pending import is quarantined as unexpected.
//
// Delivery is at-least-once (S3 -> SQS -> Lambda), so every outcome is
// idempotent: the final status transition is guarded in SQL and shares the
// transaction with the row inserts, so a replay can never double-create.

export type Outcome =
  | { kind: "completed"; importId: string; rowCount: number }
  | { kind: "rejected"; importId: string | undefined; errors: TodoImportError[] }
  | { kind: "skipped"; reason: string };

const UPLOAD_PREFIX = "uploads/";

export async function processObject(key: string): Promise<Outcome> {
  const log = logger.createChild({ persistentKeys: { object_key: key } });

  if (!key.startsWith(UPLOAD_PREFIX)) {
    return { kind: "skipped", reason: "object is outside the uploads/ prefix" };
  }

  const record = await imports.findByObjectKey(key);
  if (!record) {
    // Not created through the API: nobody is allowed to own its rows.
    return reject(undefined, key, [
      { row: 0, field: "object", message: "object does not belong to a registered import" },
    ]);
  }
  if (record.status === "completed" || record.status === "rejected") {
    return { kind: "skipped", reason: `import already ${record.status}` };
  }
  await imports.markProcessing(record.import_id);

  const info = await storage.head(key);
  if (info.size > todoImportLimits.maxBytes) {
    return reject(record.import_id, key, [
      { row: 0, field: "size", message: `file exceeds ${todoImportLimits.maxBytes} bytes` },
    ]);
  }
  if (info.contentType && info.contentType.split(";")[0]?.trim() !== "text/csv") {
    return reject(record.import_id, key, [
      {
        row: 0,
        field: "content_type",
        message: `content type must be text/csv (got ${info.contentType})`,
      },
    ]);
  }

  const outcome = parseImportCsv(await storage.read(key));
  if (!outcome.ok) {
    log.warn("import rejected", {
      import_id: record.import_id,
      row_count: outcome.rowCount,
      error_count: outcome.errorCount,
    });
    return reject(record.import_id, key, outcome.errors, outcome.rowCount, outcome.errorCount);
  }

  // Every row becomes a todo through the same domain function the API uses,
  // inside one transaction with the guarded status transition.
  const auth: AuthContext = { tenantId: record.tenant_id, userSub: record.user_sub, groups: [] };
  const finished = await withTransaction(async (tx) => {
    const done = await imports.finish(
      record.import_id,
      { status: "completed", rowCount: outcome.rowCount, createdCount: outcome.todos.length },
      tx,
    );
    if (!done) return false;
    for (const todo of outcome.todos) await createTodo(auth, todo, tx);
    return true;
  });
  if (!finished) return { kind: "skipped", reason: "import already finished (duplicate delivery)" };

  await storage.remove(key);
  metrics.addMetric("import_completed", MetricUnit.Count, 1);
  metrics.addMetric("import_rows_created", MetricUnit.Count, outcome.rowCount);
  log.info("import completed", { import_id: record.import_id, row_count: outcome.rowCount });
  return { kind: "completed", importId: record.import_id, rowCount: outcome.rowCount };
}

// Rejection = quarantine the object with its full report, record the outcome
// (first errors) on the import, and raise the alert metric. Nothing is written
// to todos.
async function reject(
  importId: string | undefined,
  key: string,
  errors: TodoImportError[],
  rowCount = 0,
  errorCount = errors.length,
): Promise<Outcome> {
  const report = {
    contract: todoImportContract,
    import_id: importId ?? null,
    object_key: key,
    rejected_at: new Date().toISOString(),
    row_count: rowCount,
    error_count: errorCount,
    errors,
  };
  const quarantined = await storage.quarantine(key, report);
  if (importId) {
    await imports.finish(importId, {
      status: "rejected",
      rowCount,
      createdCount: 0,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
    });
  }
  metrics.addMetric("import_rejected", MetricUnit.Count, 1);
  logger.error("import rejected and quarantined", {
    import_id: importId ?? null,
    object_key: key,
    quarantined_key: quarantined,
    error_count: errorCount,
    first_error: errors[0],
  });
  return { kind: "rejected", importId, errors };
}

// S3 encodes keys in event notifications the way it does in URLs ("+" for space).
const decodeKey = (key: string): string => decodeURIComponent(key.replace(/\+/g, " "));

// One SQS record = one S3 event notification (which may carry several object
// records). S3's subscription test event has no Records and is ignored.
export async function processSqsEvent(event: SQSEvent): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const message of event.Records) {
    const body = JSON.parse(message.body) as Partial<S3Event> & { Event?: string };
    if (!Array.isArray(body.Records)) {
      outcomes.push({ kind: "skipped", reason: body.Event ?? "not an S3 event" });
      continue;
    }
    for (const record of body.Records) {
      if (!record.eventName?.startsWith("ObjectCreated")) {
        outcomes.push({ kind: "skipped", reason: `event ${record.eventName ?? "unknown"}` });
        continue;
      }
      outcomes.push(await processObject(decodeKey(record.s3.object.key)));
    }
  }
  return outcomes;
}

// Unexpected errors (database down, S3 unreachable) propagate: SQS retries the
// message and, after maxReceiveCount, parks it on the dead-letter queue whose
// alarm pages the operator. Contract violations are NOT errors — they are the
// rejected outcome above and consume the message.
export const handler = middy<SQSEvent, Outcome[]>(processSqsEvent)
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }));
