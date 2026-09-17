import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/db.js";
import type { AuthContext } from "../../src/auth/claims.js";

let container: StartedPostgreSqlContainer;
let repo: typeof import("../../src/repo/todos-repo.js");
let closePool: () => Promise<void>;

const t1: AuthContext = { userSub: "u1", tenantId: "t1", groups: [] };
const t2: AuthContext = { userSub: "u1", tenantId: "t2", groups: [] };

beforeAll(async () => {
  container = await startDb();
  // Import after DATABASE_URL is set so the pool binds to the container.
  repo = await import("../../src/repo/todos-repo.js");
  ({ closePool } = await import("../../src/db/pool.js"));
}, 180_000);

afterAll(async () => {
  await closePool?.();
  await container?.stop();
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
