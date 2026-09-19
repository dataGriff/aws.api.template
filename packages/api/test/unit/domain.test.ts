import { describe, expect, it, vi, beforeEach } from "vitest";
import * as repo from "../../src/repo/todos-repo.js";
import * as domain from "../../src/domain/todos.js";
import { NotFoundError } from "../../src/errors.js";
import type { AuthContext } from "../../src/auth/claims.js";

vi.mock("../../src/repo/todos-repo.js");

const auth: AuthContext = { userSub: "u1", tenantId: "t1", groups: [] };

beforeEach(() => vi.resetAllMocks());

describe("domain.getTodo", () => {
  it("returns the todo when present", async () => {
    vi.mocked(repo.getById).mockResolvedValue({
      todo_id: "1",
      title: "x",
      description: null,
      status: "open",
      due_date: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    await expect(domain.getTodo(auth, "1")).resolves.toMatchObject({ todo_id: "1" });
  });

  it("throws NotFound when absent", async () => {
    vi.mocked(repo.getById).mockResolvedValue(null);
    await expect(domain.getTodo(auth, "1")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("domain.deleteTodo", () => {
  it("throws NotFound when nothing was deleted", async () => {
    vi.mocked(repo.remove).mockResolvedValue(false);
    await expect(domain.deleteTodo(auth, "1")).rejects.toBeInstanceOf(NotFoundError);
  });
});
