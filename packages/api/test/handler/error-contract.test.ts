import { describe, expect, it } from "vitest";
import { schemas } from "@datagriff/todo-api-contract";
import { invoke, parse } from "../helpers/invoke.js";

// These paths fail before any DB access, so they run without a container and
// assert the RFC7807 error contract + x-request-id correlation.
describe("error contract (problem+json)", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const res = await invoke({
      method: "POST",
      resource: "/todos",
      body: { title: "x" },
      claims: null,
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers?.["content-type"]).toBe("application/problem+json");
    expect(res.headers?.["x-request-id"]).toBeTruthy();
    const problem = parse(res);
    expect(schemas.problemSchema.safeParse(problem).success).toBe(true);
    expect(problem).toMatchObject({ status: 401, title: "Unauthorized" });
  });

  it("returns 400 with field errors for an invalid body", async () => {
    const res = await invoke({ method: "POST", resource: "/todos", body: { title: "" } });
    expect(res.statusCode).toBe(400);
    const problem = parse(res) as { errors?: unknown[] };
    expect(schemas.problemSchema.safeParse(problem).success).toBe(true);
    expect(problem.errors?.length).toBeGreaterThan(0);
  });

  it("does not let a client-supplied x-request-id replace the gateway's", async () => {
    const res = await invoke({
      method: "POST",
      resource: "/todos",
      body: { title: "x" },
      claims: null,
      headers: { "x-request-id": "spoofed-by-client" },
    });
    expect(res.headers?.["x-request-id"]).toBe("test-request-id");
    expect((parse(res) as { request_id: string }).request_id).toBe("test-request-id");
  });

  it("returns 404 for an unknown route", async () => {
    const res = await invoke({ method: "GET", resource: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(schemas.problemSchema.safeParse(parse(res)).success).toBe(true);
  });
});
