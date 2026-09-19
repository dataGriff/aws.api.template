// Pure CSV -> validated todos. No I/O, so every rule is unit-testable.
//
// Two contracts are applied to every row, in order:
//   1. the FILE contract (api/todo-import.odcs.yaml, generated into
//      todoImportRowSchema): header, column set, cell formats, limits;
//   2. the API contract (api/openapi.yaml, generated todoCreateSchema) plus the
//      same NUL check the HTTP handler applies — the row becomes a TodoCreate
//      and goes through exactly the validation a POST /todos body would.
// The whole file is accepted or rejected: one violation rejects everything.
import { parse, type CsvError } from "csv-parse/sync";
import {
  schemas,
  todoImportColumns,
  todoImportContract,
  todoImportLimits,
  todoImportRowSchema,
} from "@app/contracts";
import type { TodoCreate, TodoImportError, TodoImportRow } from "@app/contracts";
import { AppError } from "../errors.js";
import { validate } from "../http.js";

export const MAX_REPORTED_ERRORS = 100; // api/openapi.yaml: todo_import.errors maxItems

export type CsvOutcome =
  | { ok: true; rowCount: number; todos: TodoCreate[] }
  | { ok: false; rowCount: number; errors: TodoImportError[]; errorCount: number };

// Row 0 = the file itself (size, encoding, header); data rows are 1-based.
const fileError = (field: string, message: string): TodoImportError => ({ row: 0, field, message });

function decodeUtf8(bytes: Uint8Array): string | TodoImportError {
  try {
    // fatal: an invalid byte sequence is a contract violation, not something to
    // repair with U+FFFD. ignoreBOM: false strips a leading BOM.
    return new TextDecoder(todoImportLimits.encoding, { fatal: true }).decode(bytes);
  } catch {
    return fileError("encoding", `file is not valid ${todoImportLimits.encoding}`);
  }
}

const expectedColumns = new Set<string>(todoImportColumns);

function checkHeader(header: string[]): TodoImportError | undefined {
  const seen = new Set(header);
  const missing = [...expectedColumns].filter((c) => !seen.has(c));
  const unknown = header.filter((c) => !expectedColumns.has(c));
  const duplicates = header.filter((c, i) => header.indexOf(c) !== i);
  if (missing.length || unknown.length || duplicates.length) {
    const parts = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      unknown.length ? `unknown: ${unknown.join(", ")}` : "",
      duplicates.length ? `duplicated: ${duplicates.join(", ")}` : "",
    ].filter(Boolean);
    return fileError(
      "header",
      `header must be exactly the columns ${[...expectedColumns].join(", ")} (${parts.join("; ")})`,
    );
  }
  return undefined;
}

function csvErrorToImportError(err: CsvError): TodoImportError {
  // csv-parse reports the 1-based physical line; data row = line - header.
  const line = typeof err.lines === "number" ? err.lines : 0;
  const row = Math.max(0, line - 1);
  switch (err.code) {
    case "CSV_RECORD_INCONSISTENT_COLUMNS":
    case "CSV_RECORD_INCONSISTENT_FIELDS_LENGTH":
      return {
        row,
        field: "(row)",
        message: "row does not have the same number of cells as the header",
      };
    case "CSV_QUOTE_NOT_CLOSED":
    case "CSV_INVALID_CLOSING_QUOTE":
      return { row, field: "(row)", message: "malformed quoting" };
    default:
      return { row, field: "(row)", message: `malformed CSV (${err.code})` };
  }
}

// Turns one validated file row into the API's create shape: empty optional
// cells were already dropped by the row schema, so only provided values travel.
export function rowToTodoCreate(row: TodoImportRow): TodoCreate {
  return {
    title: row.title,
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.status !== undefined ? { status: row.status } : {}),
    ...(row.due_date !== undefined ? { due_date: row.due_date } : {}),
  };
}

export function parseImportCsv(bytes: Uint8Array): CsvOutcome {
  const reject = (
    errors: TodoImportError[],
    rowCount = 0,
    errorCount = errors.length,
  ): CsvOutcome => ({
    ok: false,
    rowCount,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    errorCount,
  });

  if (bytes.byteLength === 0) return reject([fileError("size", "file is empty")]);
  if (bytes.byteLength > todoImportLimits.maxBytes)
    return reject([fileError("size", `file exceeds ${todoImportLimits.maxBytes} bytes`)]);

  const text = decodeUtf8(bytes);
  if (typeof text !== "string") return reject([text]);

  let records: Record<string, string>[];
  let headerError: TodoImportError | undefined;
  try {
    // csv-parse's sync API is untyped (any); every cell is a string here.
    const parsed: unknown = parse(text, {
      delimiter: todoImportContract.delimiter,
      // The first row names the columns; validated against the contract here so
      // a wrong header is reported once, as a file error, not as N row errors.
      columns: (header: string[]) => {
        headerError = checkHeader(header);
        return header;
      },
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      // One row above the cap is enough to prove the violation; never buffer more.
      to: todoImportLimits.maxRows + 1,
    });
    records = parsed as Record<string, string>[];
  } catch (err) {
    if (headerError) return reject([headerError]);
    return reject([csvErrorToImportError(err as CsvError)]);
  }
  if (headerError) return reject([headerError]);

  if (records.length === 0)
    return reject([fileError("rows", "file has a header but no data rows")]);
  if (records.length > todoImportLimits.maxRows)
    return reject(
      [fileError("rows", `file has more than ${todoImportLimits.maxRows} data rows`)],
      records.length,
    );

  const todos: TodoCreate[] = [];
  const errors: TodoImportError[] = [];
  records.forEach((record, index) => {
    const row = index + 1;
    const parsed = todoImportRowSchema.safeParse(record);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({ row, field: issue.path.join(".") || "(row)", message: issue.message });
      return;
    }
    try {
      todos.push(validate<TodoCreate>(schemas.todoCreateSchema, rowToTodoCreate(parsed.data)));
    } catch (err) {
      if (err instanceof AppError && err.errors) {
        for (const e of err.errors) errors.push({ row, field: e.field, message: e.message });
      } else throw err;
    }
  });

  if (errors.length) return reject(errors, records.length);
  return { ok: true, rowCount: records.length, todos };
}
