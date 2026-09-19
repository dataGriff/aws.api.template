import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanCommand } from "@aws-sdk/client-dynamodb";
import type { AuthContext } from "../../src/auth/claims.js";
import { ConflictError } from "../../src/errors.js";
import {
  idempotencyTableSchemaFromTerraform,
  startDynamo,
  type StartedDynamo,
} from "../helpers/dynamodb.js";

// The unit test proves the Powertools state machine with an in-memory store;
// this one proves the REAL DynamoDBPersistenceLayer against a table created
// with the exact key/TTL attributes Terraform declares. Domain is mocked (no
// Postgres needed): the subject is the store, not the todo.
vi.mock("../../src/domain/todos.js");

let dynamo: StartedDynamo;
let createTodoIdempotent: typeof import("../../src/idempotency.js").createTodoIdempotent;
let domain: typeof import("../../src/domain/todos.js");

const auth: AuthContext = { userSub: "u1", tenantId: "t1", groups: [] };
const other: AuthContext = { userSub: "u1", tenantId: "t2", groups: [] };
const todo = (title: string) => ({
  todo_id: "11111111-1111-4111-8111-111111111111",
  title,
  description: null,
  status: "open" as const,
  due_date: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

beforeAll(async () => {
  dynamo = await startDynamo();
  const config = await import("../../src/config.js");
  config.resetConfig();
  const idem = await import("../../src/idempotency.js");
  idem.resetIdempotency();
  idem.bindLambdaContext({ getRemainingTimeInMillis: () => 30_000 } as never);
  createTodoIdempotent = idem.createTodoIdempotent;
  domain = await import("../../src/domain/todos.js");
}, 180_000);

afterAll(async () => {
  await dynamo?.stop();
});

beforeEach(() => {
  vi.mocked(domain.createTodo).mockReset();
  vi.mocked(domain.createTodo).mockImplementation(async (_auth, input) => todo(input.title));
});

describe("idempotency against DynamoDB Local (real persistence layer)", () => {
  it("replays the first result for the same key and body", async () => {
    const first = await createTodoIdempotent(auth, { title: "same" }, "key-replay-0001");
    const second = await createTodoIdempotent(auth, { title: "same" }, "key-replay-0001");
    expect(second).toEqual(first);
    expect(domain.createTodo).toHaveBeenCalledTimes(1);
  });

  it("rejects the same key with a different body as 409", async () => {
    await createTodoIdempotent(auth, { title: "original" }, "key-mismatch-01");
    await expect(
      createTodoIdempotent(auth, { title: "changed" }, "key-mismatch-01"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(domain.createTodo).toHaveBeenCalledTimes(1);
  });

  it("scopes keys by tenant", async () => {
    await createTodoIdempotent(auth, { title: "mine" }, "key-shared-0001");
    await createTodoIdempotent(other, { title: "theirs" }, "key-shared-0001");
    expect(domain.createTodo).toHaveBeenCalledTimes(2);
  });

  it("writes items with the attributes Terraform's table is built for", async () => {
    const { hashKey, ttlAttribute } = idempotencyTableSchemaFromTerraform();
    const scan = await dynamo.client.send(new ScanCommand({ TableName: dynamo.tableName }));
    expect(scan.Items?.length ?? 0).toBeGreaterThan(0);
    const now = Math.floor(Date.now() / 1000);
    for (const item of scan.Items ?? []) {
      expect(item[hashKey]?.S, `key attribute ${hashKey}`).toBeTruthy();
      const ttl = Number(item[ttlAttribute]?.N);
      expect(ttl, `TTL attribute ${ttlAttribute} is an epoch-seconds number`).toBeGreaterThan(now);
      expect(item.status?.S).toBe("COMPLETED");
      expect(item.data?.S ?? item.data?.M, "cached response").toBeTruthy();
      expect(item.validation?.S, "payload hash for body validation").toBeTruthy();
    }
  });
});
