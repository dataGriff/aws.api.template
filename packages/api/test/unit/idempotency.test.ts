import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../src/auth/claims.js";
import { ConflictError } from "../../src/errors.js";

// Swap the DynamoDB persistence layer for an in-memory one that still runs the
// real Powertools idempotency state machine (in-progress / completed / payload
// hash validation), so the 409 mapping is exercised end-to-end.
vi.mock("@aws-lambda-powertools/idempotency/dynamodb", async () => {
  const { BasePersistenceLayer } = await import("@aws-lambda-powertools/idempotency/persistence");
  type IdempotencyRecord = InstanceType<
    (typeof import("@aws-lambda-powertools/idempotency/persistence"))["IdempotencyRecord"]
  >;
  const {
    IdempotencyItemAlreadyExistsError,
    IdempotencyItemNotFoundError,
    IdempotencyRecordStatus,
  } = await import("@aws-lambda-powertools/idempotency");

  class InMemoryPersistenceLayer extends BasePersistenceLayer {
    private readonly store = new Map<string, IdempotencyRecord>();
    protected async _getRecord(idempotencyKey: string) {
      const record = this.store.get(idempotencyKey);
      if (!record) throw new IdempotencyItemNotFoundError();
      return record;
    }
    protected async _putRecord(record: IdempotencyRecord) {
      const existing = this.store.get(record.idempotencyKey);
      if (existing && existing.getStatus() !== IdempotencyRecordStatus.EXPIRED) {
        throw new IdempotencyItemAlreadyExistsError("exists", existing);
      }
      this.store.set(record.idempotencyKey, record);
    }
    protected async _updateRecord(record: IdempotencyRecord) {
      this.store.set(record.idempotencyKey, record);
    }
    protected async _deleteRecord(record: IdempotencyRecord) {
      this.store.delete(record.idempotencyKey);
    }
  }
  return { DynamoDBPersistenceLayer: InMemoryPersistenceLayer };
});

vi.mock("../../src/domain/todos.js");

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

// Config is read once at first use, so the table must be set before the module
// under test is imported.
process.env.IDEMPOTENCY_TABLE = "unit-test-table";
const { createTodoIdempotent, bindLambdaContext } = await import("../../src/idempotency.js");
const domain = await import("../../src/domain/todos.js");
bindLambdaContext({ getRemainingTimeInMillis: () => 30_000 } as never);

beforeEach(() => {
  vi.mocked(domain.createTodo).mockReset();
  vi.mocked(domain.createTodo).mockImplementation(async (_auth, input) => todo(input.title));
});

describe("createTodoIdempotent", () => {
  it("creates directly when no Idempotency-Key is supplied", async () => {
    await createTodoIdempotent(auth, { title: "no key" }, undefined);
    expect(domain.createTodo).toHaveBeenCalledTimes(1);
  });

  it("replays the first result for the same key and body", async () => {
    const first = await createTodoIdempotent(auth, { title: "same" }, "key-replay-0001");
    const second = await createTodoIdempotent(auth, { title: "same" }, "key-replay-0001");
    expect(second).toEqual(first);
    expect(domain.createTodo).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of a key with a different body as a 409 Conflict", async () => {
    await createTodoIdempotent(auth, { title: "original" }, "key-mismatch-01");
    await expect(
      createTodoIdempotent(auth, { title: "changed" }, "key-mismatch-01"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(domain.createTodo).toHaveBeenCalledTimes(1);
  });

  it("scopes keys by tenant so another tenant's identical key is independent", async () => {
    await createTodoIdempotent(auth, { title: "mine" }, "key-shared-0001");
    await createTodoIdempotent(other, { title: "theirs" }, "key-shared-0001");
    expect(domain.createTodo).toHaveBeenCalledTimes(2);
  });
});
