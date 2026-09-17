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

describe("pre-token-generation trigger", () => {
  it("adds tenant_id and roles claims to both tokens", async () => {
    const event = baseEvent({
      userAttributes: { "custom:tenant_id": "tenant-42" },
      groupConfiguration: { groupsToOverride: ["admin", "ops"] } as never,
    });
    const out = await handler(event, {} as never, () => {});
    const claims = (out as PreTokenGenerationV2TriggerEvent).response.claimsAndScopeOverrideDetails
      ?.accessTokenGeneration?.claimsToAddOrOverride;
    expect(claims).toEqual({ "custom:tenant_id": "tenant-42", roles: "admin,ops" });
  });

  it("omits claims when the user has no tenant or groups", async () => {
    const out = await handler(baseEvent({}), {} as never, () => {});
    const claims = (out as PreTokenGenerationV2TriggerEvent).response.claimsAndScopeOverrideDetails
      ?.idTokenGeneration?.claimsToAddOrOverride;
    expect(claims).toEqual({});
  });
});
