import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "../../src/repo/todos-repo.js";
import { invoke, parse } from "../helpers/invoke.js";

vi.mock("../../src/repo/todos-repo.js");

const todo = {
  todo_id: "11111111-1111-4111-8111-111111111111",
  title: "x",
  description: null,
  status: "open" as const,
  due_date: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.list).mockResolvedValue({ items: [], next_cursor: null });
  vi.mocked(repo.create).mockResolvedValue(todo);
  vi.mocked(repo.update).mockResolvedValue(todo);
});

// API Gateway's request validator only checks that required parameters are
// present; these rules must hold in the handler for the contract's 400s to be
// real — locally and deployed alike.
describe("query parameter validation (contract: limit 1..100, default 20)", () => {
  it.each([["0"], ["-5"], ["abc"], ["101"], ["1.5"]])(
    "rejects limit=%s with 400",
    async (limit) => {
      const res = await invoke({
        method: "GET",
        resource: "/todos",
        queryStringParameters: { limit },
      });
      expect(res.statusCode).toBe(400);
      expect((parse(res) as { errors: { field: string }[] }).errors[0]?.field).toBe("limit");
      expect(repo.list).not.toHaveBeenCalled();
    },
  );

  it("applies the default and passes a valid limit through", async () => {
    await invoke({ method: "GET", resource: "/todos" });
    expect(repo.list).toHaveBeenLastCalledWith(expect.anything(), { limit: 20 });
    await invoke({ method: "GET", resource: "/todos", queryStringParameters: { limit: "100" } });
    expect(repo.list).toHaveBeenLastCalledWith(expect.anything(), { limit: 100 });
  });

  it("rejects unknown query parameters with 400", async () => {
    const res = await invoke({
      method: "GET",
      resource: "/todos",
      queryStringParameters: { "": "false" },
    });
    expect(res.statusCode).toBe(400);
    const res2 = await invoke({
      method: "GET",
      resource: "/todos",
      queryStringParameters: { page: "2" },
    });
    expect(res2.statusCode).toBe(400);
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("rejects an unknown status filter with 400", async () => {
    const res = await invoke({
      method: "GET",
      resource: "/todos",
      queryStringParameters: { status: "archived" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH body validation (contract: minProperties 1)", () => {
  it("rejects an empty patch with 400 instead of a silent no-op 200", async () => {
    const res = await invoke({
      method: "PATCH",
      resource: "/todos/{todo_id}",
      pathParameters: { todo_id: todo.todo_id },
      body: {},
    });
    expect(res.statusCode).toBe(400);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("NUL characters (Postgres cannot store U+0000)", () => {
  it("rejects a body string containing \\u0000 with 400 instead of a database 500", async () => {
    const res = await invoke({ method: "POST", resource: "/todos", body: { title: "a\u0000b" } });
    expect(res.statusCode).toBe(400);
    expect((parse(res) as { errors: { field: string }[] }).errors[0]?.field).toBe("title");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("maps a Postgres data exception that slips through to 400, not 500", async () => {
    const pgError = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), {
      code: "22021",
    });
    vi.mocked(repo.create).mockRejectedValue(pgError);
    const res = await invoke({ method: "POST", resource: "/todos", body: { title: "ok" } });
    expect(res.statusCode).toBe(400);
    expect(res.headers?.["content-type"]).toBe("application/problem+json");
    expect((parse(res) as { detail: string }).detail).not.toContain("UTF8");
  });
});

describe("idempotency-key header (contract: string 8..128)", () => {
  it.each([["short"], ["x".repeat(129)]])("rejects %j with 400 naming the header", async (key) => {
    const res = await invoke({
      method: "POST",
      resource: "/todos",
      body: { title: "x" },
      headers: { "idempotency-key": key },
    });
    expect(res.statusCode).toBe(400);
    expect((parse(res) as { errors: { field: string }[] }).errors[0]?.field).toBe(
      "idempotency-key",
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("accepts a key within bounds and creation without a key", async () => {
    expect(
      (
        await invoke({
          method: "POST",
          resource: "/todos",
          body: { title: "x" },
          headers: { "idempotency-key": "12345678" },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await invoke({ method: "POST", resource: "/todos", body: { title: "x" } })).statusCode,
    ).toBe(201);
  });
});

describe("path id validation", () => {
  it("rejects a non-uuid id with 400 (declared on get/delete in the contract)", async () => {
    const res = await invoke({
      method: "GET",
      resource: "/todos/{todo_id}",
      pathParameters: { todo_id: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Location header", () => {
  it("is derived from the request path (stage- and base-path-agnostic)", async () => {
    const res = await invoke({ method: "POST", resource: "/todos", body: { title: "x" } });
    expect(res.statusCode).toBe(201);
    expect(res.headers?.location).toBe(`/v1/todos/${todo.todo_id}`);
  });
});
