// Generated from api/todo-import.odcs.yaml (ODCS v3.2.0) by `task gen` (scripts/gen-odcs.mjs).
// Do not edit by hand — change the data contract and regenerate.
import { z } from "zod";

export const todoImportContract = {
  "id": "todo-import",
  "name": "Todo import file",
  "version": "1.0.0",
  "apiVersion": "v3.2.0",
  "object": "todo_import",
  "delimiter": ","
} as const;

// Header row: exactly these columns, in any order.
export const todoImportColumns = ["title", "description", "status", "due_date"] as const;

// Physical limits the ingest enforces before any row is looked at.
export const todoImportLimits = {
  "maxBytes": 1048576,
  "maxRows": 1000,
  "encoding": "utf-8",
  "header": true,
  "quarantinePrefix": "quarantine/"
} as const;

// An empty cell is "not provided" for an optional column; required columns reject it.
const optionalCell = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(value);
};

// One data row after CSV parsing (every cell a string). Unknown columns are rejected.
export const todoImportRowSchema = z
  .object({
    /** Short title of the todo (1–200 characters) */
    title: z.string().min(1).max(200),
    /** Longer free text (up to 2000 characters) */
    description: optionalCell(z.string().max(2000)),
    /** Lifecycle state; defaults to open when empty */
    status: optionalCell(z.enum(["open", "in_progress", "done"])),
    /** Calendar day the todo is due, ISO 8601 (no time or zone) */
    due_date: optionalCell(z.string().refine(isCalendarDate, "must be a real calendar date formatted yyyy-MM-dd")),
  })
  .strict();
export type TodoImportRow = z.infer<typeof todoImportRowSchema>;
