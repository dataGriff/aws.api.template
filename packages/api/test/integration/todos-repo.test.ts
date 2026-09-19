import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDb, type TestDatabase } from "../helpers/db.js";
import type { AuthContext } from "../../src/auth/claims.js";

let db: TestDatabase;
let repo: typeof import("../../src/repo/todos-repo.js");
let closePool: () => Promise<void>;

const t1: AuthContext = { userSub: "u1", tenantId: "t1", groups: [] };
const t2: AuthContext = { userSub: "u1", tenantId: "t2", groups: [] };

beforeAll(async () => {
  db = await startDb();
  // Import after DATABASE_URL is set so the pool binds to the container.
  repo = await import("../../src/repo/todos-repo.js");
  ({ closePool } = await import("../../src/db/pool.js"));
}, 180_000);

afterAll(async () => {
  await closePool?.();
  await db?.stop();
});

describe("todos repo (real Postgres)", () => {
  it("creates and reads within a tenant", async () => {
    const created = await repo.create(t1, { title: "buy milk" });
    const fetched = await repo.getById(t1, created.todo_id);
    expect(fetched?.title).toBe("buy milk");
    expect(fetched?.status).toBe("open");
  });

  it("isolates rows across tenants", async () => {
    const created = await repo.create(t1, { title: "secret" });
    expect(await repo.getById(t2, created.todo_id)).toBeNull();
  });

  it("updates only owned rows", async () => {
    const created = await repo.create(t1, { title: "draft" });
    expect(await repo.update(t2, created.todo_id, { status: "done" })).toBeNull();
    const ok = await repo.update(t1, created.todo_id, { status: "done" });
    expect(ok?.status).toBe("done");
  });

  it("round-trips due_date as the same calendar day (no timezone shift)", async () => {
    const created = await repo.create(t1, { title: "dated", due_date: "2030-02-28" });
    expect(created.due_date).toBe("2030-02-28");
    const fetched = await repo.getById(t1, created.todo_id);
    expect(fetched?.due_date).toBe("2030-02-28");
  });

  it("clears description with an explicit null and advances updated_at", async () => {
    const created = await repo.create(t1, { title: "described", description: "text" });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await repo.update(t1, created.todo_id, { description: null });
    expect(updated?.description).toBeNull();
    expect(updated?.title).toBe("described");
    expect(new Date(updated!.updated_at).getTime()).toBeGreaterThan(
      new Date(created.updated_at).getTime(),
    );
  });

  it("filters by status while paginating, without overlap, and terminates", async () => {
    const tenant: AuthContext = { userSub: "filter", tenantId: "fl", groups: [] };
    for (let i = 0; i < 4; i++) await repo.create(tenant, { title: `open${i}` });
    for (let i = 0; i < 3; i++) await repo.create(tenant, { title: `done${i}`, status: "done" });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await repo.list(tenant, {
        limit: 2,
        status: "done",
        ...(cursor ? { cursor } : {}),
      });
      for (const t of page.items) {
        expect(t.status).toBe("done");
        seen.push(t.todo_id);
      }
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen).toHaveLength(3);
  });

  it("surfaces a NUL byte as a Postgres data exception (SQLSTATE 22021)", async () => {
    // Grounds the error mapper's `^22` → 400 rule in the real driver error.
    await expect(repo.create(t1, { title: "a\u0000b" })).rejects.toMatchObject({ code: "22021" });
  });

  it("paginates with an opaque cursor", async () => {
    const tenant: AuthContext = { userSub: "pager", tenantId: "pg", groups: [] };
    for (let i = 0; i < 5; i++) await repo.create(tenant, { title: `p${i}` });
    const page1 = await repo.list(tenant, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();
    const page2 = await repo.list(tenant, { limit: 2, cursor: page1.next_cursor! });
    expect(page2.items).toHaveLength(2);
    // no overlap between pages
    const ids = new Set(page1.items.map((t) => t.todo_id));
    expect(page2.items.every((t) => !ids.has(t.todo_id))).toBe(true);
  });
});
