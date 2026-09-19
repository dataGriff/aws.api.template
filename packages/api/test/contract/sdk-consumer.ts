// Consumer-side contract conformance: drive the GENERATED SDK (the artifact
// consumers install) through every operation against the running local server
// and check each response with the generated zod schemas. This proves both
// halves of the contract agree — provider responses and consumer client.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { schemas } from "@app/contracts";
import {
  ApiError,
  createClient,
  createTodo,
  deleteTodo,
  getHealth,
  getTodo,
  listTodos,
  updateTodo,
} from "@app/sdk";

const parse = <T>(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } },
  value: unknown,
  what: string,
): T => {
  const r = schema.safeParse(value);
  assert.ok(r.success, `${what} does not match the contract schema: ${JSON.stringify(r.error)}`);
  return r.data as T;
};

export async function runSdkConsumer(baseUrl: string, token: string): Promise<void> {
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

  console.log(`▶ SDK consumer conformance: ${steps.length} steps passed`);
}
