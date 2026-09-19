// Consumer-side contract conformance: drive the GENERATED SDK through every
// operation against the running local server and check each response with the
// generated zod schemas. This proves both halves of the contract agree —
// provider responses and consumer client. (Inside the workspace @app/sdk
// resolves to its source; `task test:contract` also builds the package and
// loads the published dist entry points so the shipped artifact is checked.)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { schemas } from "@app/contracts";
import {
  ApiError,
  createClient,
  createImport,
  createTodo,
  deleteTodo,
  getHealth,
  getImport,
  getTodo,
  listTodos,
  updateTodo,
} from "@app/sdk";
import { uploadWithPresignedPost } from "../helpers/aws.js";

const parse = <T>(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } },
  value: unknown,
  what: string,
): T => {
  const r = schema.safeParse(value);
  assert.ok(r.success, `${what} does not match the contract schema: ${JSON.stringify(r.error)}`);
  return r.data as T;
};

// `processImports` runs the ingest on whatever S3 has notified so far (the
// deployed Lambda mapping does this by itself; here the test drives it).
export async function runSdkConsumer(
  baseUrl: string,
  token: string,
  processImports: () => Promise<void>,
): Promise<void> {
  const { client } = createClient({ baseURL: baseUrl, token, apiKey: "local-dev-key" });
  const steps: string[] = [];
  const step = (s: string) => {
    steps.push(s);
    console.log(`  [sdk] ${s}`);
  };

  const health = parse<{ status: string }>(
    schemas.healthStatusSchema,
    await getHealth({ client }),
    "getHealth",
  );
  assert.equal(health.status, "ok");
  step("getHealth → ok");

  const key = `sdk-${randomUUID()}`;
  const created = parse<{ todo_id: string; status: string; title: string }>(
    schemas.todoSchema,
    await createTodo(
      { title: "sdk consumer", due_date: "2030-01-31" },
      { "idempotency-key": key },
      { client },
    ),
    "createTodo",
  );
  assert.equal(created.status, "open");
  step(`createTodo → ${created.todo_id}`);

  const fetched = parse<{ todo_id: string; due_date: string | null }>(
    schemas.todoSchema,
    await getTodo(created.todo_id, { client }),
    "getTodo",
  );
  assert.equal(fetched.todo_id, created.todo_id);
  assert.equal(fetched.due_date, "2030-01-31", "date round-trips as the same calendar day");
  step("getTodo → same todo, due_date intact");

  const page = parse<{ items: { todo_id: string }[]; next_cursor: string | null }>(
    schemas.todoPageSchema,
    await listTodos({ limit: 5, status: "open" }, { client }),
    "listTodos",
  );
  assert.ok(
    page.items.some((t) => t.todo_id === created.todo_id),
    "created todo appears in the list",
  );
  step(`listTodos → ${page.items.length} item(s)`);

  const updated = parse<{
    status: string;
    description: string | null;
    updated_at: string;
    created_at: string;
  }>(
    schemas.todoSchema,
    await updateTodo(created.todo_id, { status: "done", description: null }, { client }),
    "updateTodo",
  );
  assert.equal(updated.status, "done");
  assert.equal(updated.description, null);
  assert.ok(updated.updated_at >= updated.created_at);
  step("updateTodo → done");

  await deleteTodo(created.todo_id, { client });
  step("deleteTodo → 204");

  // Error path: the SDK must surface the status and the RFC 7807 body, not a
  // problem document typed as a Todo.
  await assert.rejects(getTodo(created.todo_id, { client }), (err: unknown) => {
    assert.ok(err instanceof ApiError, "non-2xx surfaces as ApiError");
    assert.equal(err.status, 404);
    parse(schemas.problemSchema, err.problem, "404 problem body");
    assert.ok(err.requestId, "x-request-id is exposed for support");
    return true;
  });
  step("getTodo after delete → ApiError 404 with problem+json");

  await assert.rejects(createTodo({ title: "" }, undefined, { client }), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 400);
    const errors = (err.problem as { errors?: { field: string }[] } | undefined)?.errors ?? [];
    assert.equal(errors[0]?.field, "title");
    return true;
  });
  step("createTodo with empty title → ApiError 400 naming the field");

  // CSV import: the SDK registers the import, a plain multipart POST uploads
  // the file to S3 with the signed fields, the ingest runs, and the SDK reads
  // the outcome — the whole file-interface contract from a consumer's seat.
  const started = parse<{
    import_id: string;
    status: string;
    upload: { url: string; fields: Record<string, string>; max_bytes: number };
  }>(
    schemas.todoImportSchema,
    await createImport({ file_name: "sdk.csv" }, { client }),
    "createImport",
  );
  assert.equal(started.status, "awaiting_upload");
  assert.ok(
    started.upload.fields.key?.endsWith(`${started.import_id}.csv`),
    "signed key is the import's",
  );
  step(
    `createImport → ${started.import_id} (upload target expires, max ${started.upload.max_bytes} bytes)`,
  );

  const uploaded = await uploadWithPresignedPost(
    started.upload,
    "title,description,status,due_date\nFrom the SDK,,open,2030-03-01\nSecond,,done,\n",
  );
  assert.ok(uploaded.status < 300, `upload rejected: ${uploaded.status} ${await uploaded.text()}`);
  step("multipart POST to the pre-signed target → accepted by S3");

  await processImports();
  const finished = parse<{
    status: string;
    row_count: number | null;
    created_count: number | null;
  }>(schemas.todoImportSchema, await getImport(started.import_id, { client }), "getImport");
  assert.equal(finished.status, "completed");
  assert.equal(finished.row_count, 2);
  assert.equal(finished.created_count, 2);
  step("getImport → completed, 2 rows created");

  const imported = parse<{ items: { title: string }[] }>(
    schemas.todoPageSchema,
    await listTodos({ limit: 100 }, { client }),
    "listTodos after import",
  );
  assert.ok(
    imported.items.some((t) => t.title === "From the SDK"),
    "imported todo is listed",
  );
  step("listTodos → imported todos visible to the same caller");

  await assert.rejects(createImport({ file_name: "notes.txt" }, { client }), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 400);
    const errors = (err.problem as { errors?: { field: string }[] } | undefined)?.errors ?? [];
    assert.equal(errors[0]?.field, "file_name");
    return true;
  });
  step("createImport with a non-.csv name → ApiError 400 naming the field");

  await assert.rejects(getImport(randomUUID(), { client }), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 404);
    return true;
  });
  step("getImport unknown id → ApiError 404");

  console.log(`▶ SDK consumer conformance: ${steps.length} steps passed`);
}
