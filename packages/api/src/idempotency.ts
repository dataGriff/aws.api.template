import type { TodoCreate } from "@datagriff/todo-api-contract/types";
import type { Context } from "aws-lambda";
import type { AuthContext } from "./auth/claims.js";
import { getConfig } from "./config.js";
import { createTodo } from "./domain/todos.js";
import { ConflictError } from "./errors.js";

type Payload = { key: string; tenant: string; user: string; input: TodoCreate; auth: AuthContext };
type IdempotentCreate = (payload: Payload) => Promise<ReturnType<typeof createTodo>>;
type Idempotent = {
  fn: IdempotentCreate;
  registerLambdaContext: (context: Context) => void;
};

// The wrapped function (and its DynamoDB persistence layer / client) is built
// once per execution environment and reused across warm invocations.
let idempotent: Promise<Idempotent> | undefined;

// Powertools derives the in-progress record's expiry from the remaining
// invocation time, so the current Lambda context is bound per request (see the
// middleware in handler.ts).
let lambdaContext: Context | undefined;
export function bindLambdaContext(context: Context): void {
  lambdaContext = context;
}

// Tests only: drop the cached layer so a changed table/endpoint is picked up.
export function resetIdempotency(): void {
  idempotent = undefined;
}

async function buildIdempotent(
  tableName: string,
  endpoint: string | undefined,
): Promise<Idempotent> {
  const [{ makeIdempotent, IdempotencyConfig }, { DynamoDBPersistenceLayer }] = await Promise.all([
    import("@aws-lambda-powertools/idempotency"),
    import("@aws-lambda-powertools/idempotency/dynamodb"),
  ]);

  // Table attribute names are Powertools' defaults (id, expiration, status,
  // data, validation); infra/terraform/stack/main.tf declares the table with
  // the same key and TTL attribute, and the integration test asserts that.
  const persistenceStore = new DynamoDBPersistenceLayer({
    tableName,
    ...(endpoint
      ? {
          clientConfig: {
            endpoint,
            region: getConfig().AWS_REGION,
            credentials: { accessKeyId: "local", secretAccessKey: "local" },
          },
        }
      : {}),
  });
  // Key on the Idempotency-Key header, scoped by tenant + user so the same key
  // cannot collide across tenants. The request body is hashed alongside the
  // key: reusing a key with a different body is rejected as a conflict (409)
  // rather than silently replaying the first response.
  const config = new IdempotencyConfig({
    eventKeyJmesPath: "[key, tenant, user]",
    payloadValidationJmesPath: "input",
  });
  const fn = makeIdempotent((payload: Payload) => createTodo(payload.auth, payload.input), {
    persistenceStore,
    config,
  }) as unknown as IdempotentCreate;
  return { fn, registerLambdaContext: (context) => config.registerLambdaContext(context) };
}

// Create is made idempotent on the Idempotency-Key header when a DynamoDB store
// is configured (deployed). Locally, or without a key, it runs directly.
export async function createTodoIdempotent(
  auth: AuthContext,
  input: TodoCreate,
  key: string | undefined,
) {
  const cfg = getConfig();
  if (!cfg.IDEMPOTENCY_TABLE || !key) return createTodo(auth, input);

  idempotent ??= buildIdempotent(cfg.IDEMPOTENCY_TABLE, cfg.IDEMPOTENCY_ENDPOINT);
  const { fn, registerLambdaContext } = await idempotent;
  if (lambdaContext) registerLambdaContext(lambdaContext);
  try {
    return await fn({ key, tenant: auth.tenantId, user: auth.userSub, input, auth });
  } catch (err) {
    throw mapIdempotencyError(err);
  }
}

// Powertools raises plain Errors; translate the ones that are the client's
// fault into the contract's 409 so the error mapper does not report a 500.
function mapIdempotencyError(err: unknown): unknown {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "IdempotencyValidationError":
      return new ConflictError("Idempotency-Key was already used with a different request body");
    case "IdempotencyAlreadyInProgressError":
    case "IdempotencyItemAlreadyExistsError":
      return new ConflictError("A request with this Idempotency-Key is already in progress");
    default:
      return err;
  }
}
