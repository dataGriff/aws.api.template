import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { schemas } from "@app/contracts";
import { startDb } from "../helpers/db.js";

let container: StartedPostgreSqlContainer;
let invoke: typeof import("../helpers/invoke.js").invoke;
let parse: typeof import("../helpers/invoke.js").parse;
let closePool: () => Promise<void>;

beforeAll(async () => {
  container = await startDb();
  ({ invoke, parse } = await import("../helpers/invoke.js"));
  ({ closePool } = await import("../../src/db/pool.js"));
}, 180_000);

afterAll(async () => {
  await closePool?.();
  await container?.stop();
});

// Contract layer: real responses must conform to the generated response schemas.
describe("responses conform to the contract", () => {
  it("POST /todos → 201 matches todoSchema", async () => {
    const res = await invoke({ method: "POST", resource: "/todos", body: { title: "contract" } });
    expect(res.statusCode).toBe(201);
    expect(schemas.todoSchema.safeParse(parse(res)).success).toBe(true);
    expect(res.headers?.location).toMatch(/\/v1\/todos\//);
  });

  it("GET /todos → 200 matches todoPageSchema", async () => {
    const res = await invoke({ method: "GET", resource: "/todos" });
    expect(res.statusCode).toBe(200);
    expect(schemas.todoPageSchema.safeParse(parse(res)).success).toBe(true);
  });

  it("GET /health → 200 matches healthStatusSchema", async () => {
    const res = await invoke({ method: "GET", resource: "/health", claims: null });
    expect(res.statusCode).toBe(200);
    expect(schemas.healthStatusSchema.safeParse(parse(res)).success).toBe(true);
  });
});
