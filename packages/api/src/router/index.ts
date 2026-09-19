import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { schemas } from "@app/contracts";
import type { TodoCreate, TodoStatus, TodoUpdate } from "@app/contracts";
import { extractAuth } from "../auth/claims.js";
import * as todos from "../domain/todos.js";
import { createTodoIdempotent } from "../idempotency.js";
import { json, noContent, parseBody, validate } from "../http.js";
import { NotFoundError } from "../errors.js";

type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

const health: Handler = async () =>
  json(200, { status: "ok", version: process.env.SERVICE_VERSION ?? "dev" });

// Query parameter validation mirrors api/openapi.yaml. API Gateway's request
// validator only checks that required parameters are *present*, so range and
// type constraints must be enforced here to honour the contract's 400s.
// .strict(): unknown query parameters are rejected (400), the same stance the
// contract takes on request bodies with additionalProperties: false.
const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(512).optional(),
    status: schemas.todoStatusSchema.optional(),
  })
  .strict();

const listTodos: Handler = async (event) => {
  const auth = extractAuth(event);
  const q = validate<{ limit: number; cursor?: string; status?: TodoStatus }>(
    listQuerySchema,
    event.queryStringParameters ?? {},
  );
  const page = await todos.listTodos(auth, {
    limit: q.limit,
    ...(q.status !== undefined ? { status: q.status } : {}),
    ...(q.cursor ? { cursor: q.cursor } : {}),
  });
  return json(200, page);
};

// Location is built from the request's own path so it is correct behind the
// stage URL (/v1/todos) and a custom domain with any base-path mapping.
const locationFor = (event: APIGatewayProxyEvent, id: string): string => {
  const base = (event.requestContext?.path ?? event.path ?? "").replace(/\/+$/, "");
  return `${base}/${id}`;
};

// Mirrors the contract's idempotency-key parameter (string, 8..128). API
// Gateway does not schema-validate header values, so the bound is enforced here.
const idempotencyKeySchema = z.string().min(8).max(128).optional();

const createTodo: Handler = async (event) => {
  const auth = extractAuth(event);
  const input = parseBody<TodoCreate>(event, schemas.todoCreateSchema);
  // Headers are lower-cased by the header-normalizer middleware.
  const key = validate<string | undefined>(
    idempotencyKeySchema,
    event.headers?.["idempotency-key"],
    "idempotency-key",
  );
  const created = await createTodoIdempotent(auth, input, key);
  return json(201, created, { location: locationFor(event, created.todo_id) });
};

const uuid = z.string().uuid();
const pathId = (event: APIGatewayProxyEvent): string => {
  const id = event.pathParameters?.todo_id;
  if (!id) throw new NotFoundError("Missing todo id");
  return validate<string>(uuid, id, "todo_id");
};

const getTodo: Handler = async (event) =>
  json(200, await todos.getTodo(extractAuth(event), pathId(event)));

// The generated zod schema cannot express the contract's `minProperties: 1`,
// so the "at least one field" rule is applied here.
const todoUpdateSchema = schemas.todoUpdateSchema.refine(
  (patch) => Object.values(patch as Record<string, unknown>).some((v) => v !== undefined),
  { message: "At least one field must be provided" },
);

const updateTodo: Handler = async (event) => {
  const auth = extractAuth(event);
  const patch = parseBody<TodoUpdate>(event, todoUpdateSchema);
  return json(200, await todos.updateTodo(auth, pathId(event), patch));
};

const deleteTodo: Handler = async (event) => {
  await todos.deleteTodo(extractAuth(event), pathId(event));
  return noContent();
};

// Keyed by "<METHOD> <resource>" where resource is the API Gateway path
// template. Must match the operations in api/openapi.yaml exactly — a unit
// test (test/unit/routes-contract.test.ts) fails the build on drift.
export const routes: Readonly<Record<string, Handler>> = {
  "GET /health": health,
  "GET /todos": listTodos,
  "POST /todos": createTodo,
  "GET /todos/{todo_id}": getTodo,
  "PATCH /todos/{todo_id}": updateTodo,
  "DELETE /todos/{todo_id}": deleteTodo,
};

export async function dispatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const resource = event.resource ?? event.path;
  const route = routes[`${event.httpMethod} ${resource}`];
  if (!route) throw new NotFoundError(`No route for ${event.httpMethod} ${resource}`);
  return route(event);
}
