import type { TodoCreate } from "@app/contracts";
import type { AuthContext } from "./auth/claims.js";
import { getConfig } from "./config.js";
import { createTodo } from "./domain/todos.js";

// Create is made idempotent on the Idempotency-Key header when a DynamoDB store
// is configured (deployed). Locally, or without a key, it runs directly.
export async function createTodoIdempotent(
  auth: AuthContext,
  input: TodoCreate,
  key: string | undefined,
) {
  const cfg = getConfig();
  if (!cfg.IDEMPOTENCY_TABLE || !key) return createTodo(auth, input);

  const [{ makeIdempotent, IdempotencyConfig }, { DynamoDBPersistenceLayer }] = await Promise.all([
    import("@aws-lambda-powertools/idempotency"),
    import("@aws-lambda-powertools/idempotency/dynamodb"),
  ]);

  const persistenceStore = new DynamoDBPersistenceLayer({ tableName: cfg.IDEMPOTENCY_TABLE });
  // Key on the Idempotency-Key header, scoped by tenant + user so the same key
  // cannot collide across tenants. Reusing a key with a different body raises an
  // idempotency mismatch (409), as the contract promises.
  const config = new IdempotencyConfig({ eventKeyJmesPath: "[key, tenant, user]" });
  const fn = makeIdempotent(
    (payload: { key: string; tenant: string; user: string; input: TodoCreate }) =>
      createTodo(auth, payload.input),
    { persistenceStore, config },
  );
  return fn({ key, tenant: auth.tenantId, user: auth.userSub, input });
}
