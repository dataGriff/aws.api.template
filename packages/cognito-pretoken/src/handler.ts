import type { PreTokenGenerationV2TriggerHandler } from "aws-lambda";

// Enriches Cognito-issued tokens with the custom claims the API authorizes on.
// Uses the V2 trigger so claims land on the ACCESS token (not just the id
// token). Keep the claim set small — token size is quota-limited.
//
// tenant_id is sourced from the user's `custom:tenant_id` attribute (set at
// sign-up / admin provisioning). Groups become a `roles` claim, JSON-encoded so
// group names containing separators are preserved exactly.
//
// A user without a tenant attribute is mis-provisioned: the trigger fails
// closed (Cognito refuses to issue the token) rather than minting a token the
// API would reject with 401 on every call.
export const handler: PreTokenGenerationV2TriggerHandler = async (event) => {
  const attrs = event.request.userAttributes ?? {};
  const tenantId = attrs["custom:tenant_id"];
  const groups = event.request.groupConfiguration?.groupsToOverride ?? [];

  if (!tenantId) {
    throw new Error("User has no custom:tenant_id attribute; refusing to issue a token");
  }

  const claims: Record<string, string> = { "custom:tenant_id": tenantId };
  if (groups.length) claims["roles"] = JSON.stringify(groups);

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: { claimsToAddOrOverride: claims },
      accessTokenGeneration: { claimsToAddOrOverride: claims },
    },
  };

  return event;
};
