import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/repo/todos-repo.js";
import { BadRequestError } from "../../src/errors.js";

const row = {
  created_at: new Date("2026-01-02T03:04:05.678Z"),
  todo_id: "11111111-1111-4111-8111-111111111111",
};

describe("pagination cursor", () => {
  it("round-trips a keyset cursor", () => {
    expect(decodeCursor(encodeCursor(row))).toEqual({
      created_at: "2026-01-02T03:04:05.678Z",
      todo_id: row.todo_id,
    });
  });

  it("rejects an opaque string that is not a cursor as a 400", () => {
    expect(() => decodeCursor("abc")).toThrow(BadRequestError);
  });

  it("rejects a cursor whose id is not a uuid (would otherwise be a DB cast error)", () => {
    const bad = Buffer.from("2026-01-02T03:04:05.678Z|not-a-uuid").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow(BadRequestError);
  });

  it("rejects a cursor whose timestamp is not ISO-8601", () => {
    const bad = Buffer.from(`yesterday|${row.todo_id}`).toString("base64url");
    expect(() => decodeCursor(bad)).toThrow(BadRequestError);
  });

  it("rejects extra segments", () => {
    const bad = Buffer.from(`2026-01-02T03:04:05.678Z|${row.todo_id}|x`).toString("base64url");
    expect(() => decodeCursor(bad)).toThrow(BadRequestError);
  });
});
