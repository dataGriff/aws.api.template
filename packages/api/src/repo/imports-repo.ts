import type { TodoImport, TodoImportError, TodoImportStatus } from "@app/contracts";
import type { AuthContext } from "../auth/claims.js";
import { db, type Queryable } from "../db/pool.js";

// One row of todo_imports. Besides the caller-visible fields it carries the
// object key and the owning identity, which the ingest trusts.
export interface ImportRecord extends TodoImport {
  tenant_id: string;
  user_sub: string;
  object_key: string;
}

interface ImportRow {
  import_id: string;
  tenant_id: string;
  user_sub: string;
  file_name: string;
  object_key: string;
  status: TodoImportStatus;
  row_count: number | null;
  created_count: number | null;
  errors: TodoImportError[] | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

const COLUMNS = `import_id, tenant_id, user_sub, file_name, object_key, status, row_count,
  created_count, errors, created_at, updated_at, completed_at`;

function toRecord(row: ImportRow): ImportRecord {
  return {
    import_id: row.import_id,
    tenant_id: row.tenant_id,
    user_sub: row.user_sub,
    object_key: row.object_key,
    file_name: row.file_name,
    status: row.status,
    row_count: row.row_count,
    created_count: row.created_count,
    ...(row.errors ? { errors: row.errors } : {}),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

// The caller-visible shape (api/openapi.yaml todo_import): never leak the
// object key or the owner columns to clients.
export function toTodoImport(record: ImportRecord): TodoImport {
  return {
    import_id: record.import_id,
    status: record.status,
    file_name: record.file_name,
    row_count: record.row_count,
    created_count: record.created_count,
    ...(record.errors ? { errors: record.errors } : {}),
    created_at: record.created_at,
    updated_at: record.updated_at,
    completed_at: record.completed_at,
  };
}

export async function create(
  auth: AuthContext,
  input: { importId: string; fileName: string; objectKey: string },
): Promise<ImportRecord> {
  const rows = await db.query<ImportRow>(
    `INSERT INTO todo_imports (import_id, tenant_id, user_sub, file_name, object_key)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [input.importId, auth.tenantId, auth.userSub, input.fileName, input.objectKey],
  );
  return toRecord(rows[0]!);
}

// Scoped by tenant AND user like every other read.
export async function getById(auth: AuthContext, importId: string): Promise<ImportRecord | null> {
  const rows = await db.query<ImportRow>(
    `SELECT ${COLUMNS} FROM todo_imports WHERE tenant_id = $1 AND user_sub = $2 AND import_id = $3`,
    [auth.tenantId, auth.userSub, importId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

// Ingest only (no caller identity exists yet): the object key IS the lookup,
// and the row found is what says whose todos the file may create. An unknown
// key means the object did not come through create_import.
export async function findByObjectKey(objectKey: string): Promise<ImportRecord | null> {
  const rows = await db.query<ImportRow>(
    `SELECT ${COLUMNS} FROM todo_imports WHERE object_key = $1`,
    [objectKey],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

// Best-effort visibility while the file is being validated.
export async function markProcessing(importId: string): Promise<void> {
  await db.query(
    `UPDATE todo_imports SET status = 'processing', updated_at = now()
      WHERE import_id = $1 AND status = 'awaiting_upload'`,
    [importId],
  );
}

// The final transition is guarded: only an import that has not finished yet
// can be completed or rejected. A duplicate delivery (S3/SQS are at-least-once)
// therefore finds no row and the caller rolls back without writing anything.
export async function finish(
  importId: string,
  outcome: {
    status: "completed" | "rejected";
    rowCount: number;
    createdCount: number;
    errors?: TodoImportError[];
  },
  conn: Queryable = db,
): Promise<ImportRecord | null> {
  const rows = await conn.query<ImportRow>(
    `UPDATE todo_imports
        SET status = $2, row_count = $3, created_count = $4, errors = $5,
            updated_at = now(), completed_at = now()
      WHERE import_id = $1 AND status IN ('awaiting_upload', 'processing')
      RETURNING ${COLUMNS}`,
    [
      importId,
      outcome.status,
      outcome.rowCount,
      outcome.createdCount,
      outcome.errors ? JSON.stringify(outcome.errors) : null,
    ],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}
