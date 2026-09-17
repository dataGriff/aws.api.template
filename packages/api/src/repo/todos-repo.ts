import type { Todo, TodoCreate, TodoStatus, TodoUpdate } from "@app/contracts";
import type { AuthContext } from "../auth/claims.js";
import { query } from "../db/pool.js";

interface TodoRow {
  todo_id: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

const toDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function toTodo(row: TodoRow): Todo {
  return {
    todo_id: row.todo_id,
    title: row.title,
    description: row.description,
    status: row.status,
    due_date: toDate(row.due_date),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

const encodeCursor = (row: TodoRow): string =>
  Buffer.from(`${row.created_at.toISOString()}|${row.todo_id}`).toString("base64url");

function decodeCursor(cursor: string): { created_at: string; todo_id: string } {
  const [created_at, todo_id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!created_at || !todo_id) throw new Error("invalid cursor");
  return { created_at, todo_id };
}

export interface ListParams {
  status?: TodoStatus;
  limit: number;
  cursor?: string;
}

export interface Page {
  items: Todo[];
  next_cursor: string | null;
}

// Every query is scoped by tenant_id AND user_sub from the token — the client
// can never widen its own scope.
export async function list(auth: AuthContext, params: ListParams): Promise<Page> {
  const values: unknown[] = [auth.tenantId, auth.userSub];
  const where = ["tenant_id = $1", "user_sub = $2"];

  if (params.status) {
    values.push(params.status);
    where.push(`status = $${values.length}`);
  }
  if (params.cursor) {
    const c = decodeCursor(params.cursor);
    values.push(c.created_at, c.todo_id);
    where.push(`(created_at, todo_id) < ($${values.length - 1}, $${values.length})`);
  }
  values.push(params.limit + 1);

  const rows = await query<TodoRow>(
    `SELECT todo_id, title, description, status, due_date, created_at, updated_at
       FROM todos
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, todo_id DESC
      LIMIT $${values.length}`,
    values,
  );

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page.at(-1);
  return {
    items: page.map(toTodo),
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export async function getById(auth: AuthContext, todoId: string): Promise<Todo | null> {
  const rows = await query<TodoRow>(
    `SELECT todo_id, title, description, status, due_date, created_at, updated_at
       FROM todos WHERE tenant_id = $1 AND user_sub = $2 AND todo_id = $3`,
    [auth.tenantId, auth.userSub, todoId],
  );
  return rows[0] ? toTodo(rows[0]) : null;
}

export async function create(auth: AuthContext, input: TodoCreate): Promise<Todo> {
  const rows = await query<TodoRow>(
    `INSERT INTO todos (tenant_id, user_sub, title, description, status, due_date)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'open'), $6)
     RETURNING todo_id, title, description, status, due_date, created_at, updated_at`,
    [
      auth.tenantId,
      auth.userSub,
      input.title,
      input.description ?? null,
      input.status ?? null,
      input.due_date ?? null,
    ],
  );
  return toTodo(rows[0]!);
}

export async function update(
  auth: AuthContext,
  todoId: string,
  patch: TodoUpdate,
): Promise<Todo | null> {
  const sets: string[] = [];
  const values: unknown[] = [auth.tenantId, auth.userSub, todoId];
  // Keys are a fixed literal union, not user input — safe indexed access.
  /* eslint-disable security/detect-object-injection */
  for (const key of ["title", "description", "status", "due_date"] as const) {
    if (patch[key] !== undefined) {
      values.push(patch[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  /* eslint-enable security/detect-object-injection */
  if (sets.length === 0) return getById(auth, todoId);
  sets.push("updated_at = now()");

  const rows = await query<TodoRow>(
    `UPDATE todos SET ${sets.join(", ")}
      WHERE tenant_id = $1 AND user_sub = $2 AND todo_id = $3
     RETURNING todo_id, title, description, status, due_date, created_at, updated_at`,
    values,
  );
  return rows[0] ? toTodo(rows[0]) : null;
}

export async function remove(auth: AuthContext, todoId: string): Promise<boolean> {
  const rows = await query<{ todo_id: string }>(
    `DELETE FROM todos WHERE tenant_id = $1 AND user_sub = $2 AND todo_id = $3 RETURNING todo_id`,
    [auth.tenantId, auth.userSub, todoId],
  );
  return rows.length > 0;
}
