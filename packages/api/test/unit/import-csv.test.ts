import { describe, expect, it } from "vitest";
import { todoImportLimits } from "@app/contracts";
import { MAX_REPORTED_ERRORS, parseImportCsv } from "../../src/import/csv.js";

const csv = (s: string) => new TextEncoder().encode(s);
const HEADER = "title,description,status,due_date\n";

const rejected = (bytes: Uint8Array) => {
  const out = parseImportCsv(bytes);
  if (out.ok) throw new Error("expected rejection");
  return out;
};

describe("parseImportCsv — file contract (api/todo-import.odcs.yaml)", () => {
  it("accepts the example file and maps rows to todo_create shapes", () => {
    const out = parseImportCsv(
      csv(
        HEADER +
          "Write the tutorial,Cover the local stack,open,2030-01-31\n" +
          "Renew the certificate,,in_progress,\n" +
          '"Book the room, then send the invite","Quoted, with comma",done,2030-02-15\n',
      ),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rowCount).toBe(3);
    expect(out.todos[0]).toEqual({
      title: "Write the tutorial",
      description: "Cover the local stack",
      status: "open",
      due_date: "2030-01-31",
    });
    // Empty optional cells are "not provided", not empty strings or nulls.
    expect(out.todos[1]).toEqual({ title: "Renew the certificate", status: "in_progress" });
    expect(out.todos[2]?.title).toBe("Book the room, then send the invite");
  });

  it("accepts columns in any order, CRLF line endings and a UTF-8 BOM", () => {
    const out = parseImportCsv(csv("﻿status,title,due_date,description\r\ndone,Reordered,,\r\n"));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.todos[0]).toEqual({ title: "Reordered", status: "done" });
  });

  it("rejects an empty file and a header-only file as file-level errors (row 0)", () => {
    expect(rejected(csv("")).errors).toEqual([{ row: 0, field: "size", message: "file is empty" }]);
    expect(rejected(csv(HEADER)).errors[0]).toMatchObject({ row: 0, field: "rows" });
  });

  it("rejects a header that is not exactly the contract's columns", () => {
    for (const header of [
      "title,description,status\n", // missing
      "title,description,status,due_date,owner\n", // unknown
      "title,title,status,due_date\n", // duplicate
      "Title,description,status,due_date\n", // case matters
    ]) {
      const out = rejected(csv(header + "x,,,\n"));
      expect(out.errors).toHaveLength(1);
      expect(out.errors[0]).toMatchObject({ row: 0, field: "header" });
    }
  });

  it("rejects invalid UTF-8 rather than repairing it", () => {
    const bytes = new Uint8Array([...csv(HEADER), 0xff, 0xfe, 0x2c, 0x2c, 0x2c, 0x0a]);
    expect(rejected(bytes).errors[0]).toMatchObject({ row: 0, field: "encoding" });
  });

  it("rejects the whole file on a single bad row and names row, field and rule", () => {
    const out = rejected(
      csv(
        HEADER +
          "Good row,,open,2030-01-31\n" +
          ",Missing title,open,\n" +
          "Bad status,,archived,\n" +
          "Bad date,,open,31/01/2030\n" +
          "Impossible date,,open,2030-02-30\n" +
          `${"x".repeat(201)},,open,\n`,
      ),
    );
    expect(out.rowCount).toBe(6);
    expect(out.errors.map((e) => [e.row, e.field])).toEqual([
      [2, "title"],
      [3, "status"],
      [4, "due_date"],
      [5, "due_date"],
      [6, "title"],
    ]);
    expect(out.errors[2]?.message).toMatch(/yyyy-MM-dd/);
  });

  it("applies the API contract too: a NUL byte is rejected like a POST /todos body", () => {
    const out = rejected(csv(HEADER + "a\u0000b,,open,\n"));
    expect(out.errors[0]).toMatchObject({ row: 1, field: "title" });
    expect(out.errors[0]?.message).toMatch(/NUL/);
  });

  it("rejects rows with the wrong number of cells and malformed quoting", () => {
    expect(rejected(csv(HEADER + "only,two\n")).errors[0]).toMatchObject({
      row: 1,
      field: "(row)",
    });
    expect(rejected(csv(HEADER + '"unterminated,,open,\n')).errors[0]?.field).toBe("(row)");
  });

  it("enforces the physical limits from the contract (maxRows, maxBytes)", () => {
    const tooMany = HEADER + "r,,,\n".repeat(todoImportLimits.maxRows + 1);
    const out = rejected(csv(tooMany));
    expect(out.errors[0]).toMatchObject({ row: 0, field: "rows" });
    expect(out.rowCount).toBe(todoImportLimits.maxRows + 1);

    const tooBig = new Uint8Array(todoImportLimits.maxBytes + 1).fill(0x61);
    expect(rejected(tooBig).errors[0]).toMatchObject({ row: 0, field: "size" });

    const exactlyMax = HEADER + "ok,,,\n".repeat(todoImportLimits.maxRows);
    expect(parseImportCsv(csv(exactlyMax)).ok).toBe(true);
  });

  it("reports at most 100 errors (todo_import.errors maxItems) but counts them all", () => {
    const out = rejected(csv(HEADER + ",,,\n".repeat(150)));
    expect(out.errors).toHaveLength(MAX_REPORTED_ERRORS);
    expect(out.errorCount).toBe(150);
    expect(out.rowCount).toBe(150);
  });
});
