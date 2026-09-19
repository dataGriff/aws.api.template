import { describe, expect, it } from "vitest";
import type { PreTokenGenerationV2TriggerEvent } from "aws-lambda";
import { handler } from "../src/handler.js";

const baseEvent = (overrides: Partial<PreTokenGenerationV2TriggerEvent["request"]>) =>
  ({
    request: {
      userAttributes: {},
      groupConfiguration: {},
      ...overrides,
    },
    response: {},
  }) as unknown as PreTokenGenerationV2TriggerEvent;

const run = (event: PreTokenGenerationV2TriggerEvent) =>
  handler(event, {} as never, () => {}) as Promise<PreTokenGenerationV2TriggerEvent>;

const claimsOf = (out: PreTokenGenerationV2TriggerEvent) => ({
  access: out.response.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride,
  id: out.response.claimsAndScopeOverrideDetails?.idTokenGeneration?.claimsToAddOrOverride,
});

describe("pre-token-generation trigger", () => {
  it("adds tenant_id and a JSON roles claim to BOTH the access and id tokens", async () => {
    const out = await run(
      baseEvent({
        userAttributes: { "custom:tenant_id": "tenant-42" },
        groupConfiguration: { groupsToOverride: ["admin", "ops"] } as never,
      }),
    );
    const expected = { "custom:tenant_id": "tenant-42", roles: JSON.stringify(["admin", "ops"]) };
    expect(claimsOf(out).access).toEqual(expected);
    expect(claimsOf(out).id).toEqual(expected);
  });

  it("preserves group names containing separators", async () => {
    const out = await run(
      baseEvent({
        userAttributes: { "custom:tenant_id": "tenant-42" },
        groupConfiguration: { groupsToOverride: ["sales,eu", "eu west"] } as never,
      }),
    );
    expect(JSON.parse(claimsOf(out).access!["roles"]!)).toEqual(["sales,eu", "eu west"]);
  });

  it("omits the roles claim when the user has no groups", async () => {
    const out = await run(baseEvent({ userAttributes: { "custom:tenant_id": "tenant-42" } }));
    expect(claimsOf(out).access).toEqual({ "custom:tenant_id": "tenant-42" });
  });

  it("fails closed for a user with no tenant attribute", async () => {
    await expect(
      run(baseEvent({ groupConfiguration: { groupsToOverride: ["admin"] } as never })),
    ).rejects.toThrow(/custom:tenant_id/);
  });
});
