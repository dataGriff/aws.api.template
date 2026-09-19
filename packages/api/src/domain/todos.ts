import type { Todo, TodoCreate, TodoUpdate } from "@app/contracts";
import type { AuthContext } from "../auth/claims.js";
import type { Queryable } from "../db/pool.js";
import { NotFoundError } from "../errors.js";
import * as repo from "../repo/todos-repo.js";

export const listTodos = (auth: AuthContext, params: repo.ListParams) => repo.list(auth, params);

export async function getTodo(auth: AuthContext, id: string): Promise<Todo> {
  const todo = await repo.getById(auth, id);
  if (!todo) throw new NotFoundError(`Todo ${id} not found`);
  return todo;
}

// The single way a todo comes into existence — the API (one per request,
// optionally idempotent) and the CSV import (many, inside one transaction via
// `conn`) both end here, so validation-adjacent rules never fork.
export const createTodo = (auth: AuthContext, input: TodoCreate, conn?: Queryable) =>
  repo.create(auth, input, conn);

export async function updateTodo(auth: AuthContext, id: string, patch: TodoUpdate): Promise<Todo> {
  const todo = await repo.update(auth, id, patch);
  if (!todo) throw new NotFoundError(`Todo ${id} not found`);
  return todo;
}

export async function deleteTodo(auth: AuthContext, id: string): Promise<void> {
  const deleted = await repo.remove(auth, id);
  if (!deleted) throw new NotFoundError(`Todo ${id} not found`);
}
