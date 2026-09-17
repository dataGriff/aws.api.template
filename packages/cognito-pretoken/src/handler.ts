import type { PreTokenGenerationV2TriggerHandler } from "aws-lambda";

// Enriches Cognito-issued tokens with the custom claims the API authorizes on.
// Uses the V2 trigger so claims land on the ACCESS token (not just the id
// token). Keep the claim set small — token size is quota-limited.
//
// tenant_id is sourced from the user's `custom:tenant_id` attribute (set at
// sign-up / admin provisioning). Groups become a `roles` claim.
export const handler: PreTokenGenerationV2TriggerHandler = async (event) => {
  const attrs = event.request.userAttributes ?? {};
  const tenantId = attrs["custom:tenant_id"];
  const groups = event.request.groupConfiguration?.groupsToOverride ?? [];

  const claims: Record<string, string> = {};
  if (tenantId) claims["custom:tenant_id"] = tenantId;
  if (groups.length) claims["roles"] = groups.join(",");

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: { claimsToAddOrOverride: claims },
      accessTokenGeneration: { claimsToAddOrOverride: claims },
    },
  };

  return event;
};
