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

const listTodos: Handler = async (event) => {
  const auth = extractAuth(event);
  const q = event.queryStringParameters ?? {};
  const limit = Math.min(Math.max(Number.parseInt(q.limit ?? "20", 10) || 20, 1), 100);
  const status = q.status ? validate<TodoStatus>(schemas.todoStatusSchema, q.status) : undefined;
  const page = await todos.listTodos(auth, {
    limit,
    ...(status !== undefined ? { status } : {}),
    ...(q.cursor ? { cursor: q.cursor } : {}),
  });
  return json(200, page);
};

const createTodo: Handler = async (event) => {
  const auth = extractAuth(event);
  const input = parseBody<TodoCreate>(event, schemas.todoCreateSchema);
  const key = event.headers?.["idempotency-key"] ?? event.headers?.["Idempotency-Key"];
  const created = await createTodoIdempotent(auth, input, key);
  return json(201, created, { location: `/v1/todos/${created.todo_id}` });
};

const uuid = z.string().uuid();
const pathId = (event: APIGatewayProxyEvent): string => {
  const id = event.pathParameters?.todo_id;
  if (!id) throw new NotFoundError("Missing todo id");
  return validate<string>(uuid, id);
};

const getTodo: Handler = async (event) =>
  json(200, await todos.getTodo(extractAuth(event), pathId(event)));

const updateTodo: Handler = async (event) => {
  const auth = extractAuth(event);
  const patch = parseBody<TodoUpdate>(event, schemas.todoUpdateSchema);
  return json(200, await todos.updateTodo(auth, pathId(event), patch));
};

const deleteTodo: Handler = async (event) => {
  await todos.deleteTodo(extractAuth(event), pathId(event));
  return noContent();
};

// Keyed by "<METHOD> <resource>" where resource is the API Gateway path
// template. Mirrors the operations in api/openapi.yaml.
const routes: Record<string, Handler> = {
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
