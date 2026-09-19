import { describe, expect, it } from "vitest";
import { extractAuth, isAdmin } from "../../src/auth/claims.js";
import { UnauthorizedError } from "../../src/errors.js";
import { buildEvent } from "../helpers/events.js";

describe("extractAuth", () => {
  it("reads sub and tenant from validated claims", () => {
    const auth = extractAuth(
      buildEvent({
        method: "GET",
        resource: "/todos",
        claims: { sub: "u1", "custom:tenant_id": "t1" },
      }),
    );
    expect(auth).toMatchObject({ userSub: "u1", tenantId: "t1", groups: [] });
  });

  it("parses cognito:groups into an array", () => {
    const auth = extractAuth(
      buildEvent({
        method: "GET",
        resource: "/todos",
        claims: { sub: "u1", "custom:tenant_id": "t1", "cognito:groups": "[admin,ops]" },
      }),
    );
    expect(auth.groups).toEqual(["admin", "ops"]);
    expect(isAdmin(auth)).toBe(true);
  });

  it("reads groups from an array claim (local/raw token)", () => {
    const auth = extractAuth(
      buildEvent({
        method: "GET",
        resource: "/todos",
        claims: { sub: "u1", "custom:tenant_id": "t1", "cognito:groups": ["admin"] as never },
      }),
    );
    expect(auth.groups).toEqual(["admin"]);
    expect(isAdmin(auth)).toBe(true);
  });

  it("reads groups from the trigger's JSON-encoded 'roles' claim", () => {
    const auth = extractAuth(
      buildEvent({
        method: "GET",
        resource: "/todos",
        claims: { sub: "u1", "custom:tenant_id": "t1", roles: JSON.stringify(["admin", "ops"]) },
      }),
    );
    expect(auth.groups).toEqual(["admin", "ops"]);
    expect(isAdmin(auth)).toBe(true);
  });

  it("preserves group names containing separators via the JSON roles claim", () => {
    const auth = extractAuth(
      buildEvent({
        method: "GET",
        resource: "/todos",
        claims: { sub: "u1", "custom:tenant_id": "t1", roles: JSON.stringify(["sales,eu"]) },
      }),
    );
    expect(auth.groups).toEqual(["sales,eu"]);
    expect(isAdmin(auth)).toBe(false);
  });

  it("still accepts a legacy comma-joined 'roles' claim", () => {
    const auth = extractAuth(
      buildEvent({
        method: "GET",
        resource: "/todos",
        claims: { sub: "u1", "custom:tenant_id": "t1", roles: "admin,ops" },
      }),
    );
    expect(auth.groups).toEqual(["admin", "ops"]);
  });

  it("merges cognito:groups and roles without duplicates", () => {
    const auth = extractAuth(
      buildEvent({
        method: "GET",
        resource: "/todos",
        claims: {
          sub: "u1",
          "custom:tenant_id": "t1",
          "cognito:groups": "[admin]",
          roles: JSON.stringify(["admin", "ops"]),
        },
      }),
    );
    expect(auth.groups).toEqual(["admin", "ops"]);
  });

  it("rejects a token missing required claims", () => {
    expect(() =>
      extractAuth(buildEvent({ method: "GET", resource: "/todos", claims: { sub: "u1" } })),
    ).toThrow(UnauthorizedError);
  });

  it("rejects an unauthenticated request", () => {
    expect(() =>
      extractAuth(buildEvent({ method: "GET", resource: "/todos", claims: null })),
    ).toThrow(UnauthorizedError);
  });
});
