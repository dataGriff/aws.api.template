import type { Todo, TodoCreate, TodoUpdate } from "@app/contracts";
import type { AuthContext } from "../auth/claims.js";
import { NotFoundError } from "../errors.js";
import * as repo from "../repo/todos-repo.js";

export const listTodos = (auth: AuthContext, params: repo.ListParams) => repo.list(auth, params);

export async function getTodo(auth: AuthContext, id: string): Promise<Todo> {
  const todo = await repo.getById(auth, id);
  if (!todo) throw new NotFoundError(`Todo ${id} not found`);
  return todo;
}

export const createTodo = (auth: AuthContext, input: TodoCreate) => repo.create(auth, input);

export async function updateTodo(auth: AuthContext, id: string, patch: TodoUpdate): Promise<Todo> {
  const todo = await repo.update(auth, id, patch);
  if (!todo) throw new NotFoundError(`Todo ${id} not found`);
  return todo;
}

export async function deleteTodo(auth: AuthContext, id: string): Promise<void> {
  const deleted = await repo.remove(auth, id);
  if (!deleted) throw new NotFoundError(`Todo ${id} not found`);
}
