import type { APIGatewayProxyEvent } from "aws-lambda";
import { UnauthorizedError } from "../errors.js";

// The trusted identity for a request, derived solely from validated token
// claims. Never populated from the request body/query — this is the anchor for
// tenant isolation.
export interface AuthContext {
  readonly userSub: string;
  readonly tenantId: string;
  readonly groups: readonly string[];
}

export function isAdmin(auth: AuthContext): boolean {
  return auth.groups.includes("admin");
}

// API Gateway's Cognito authorizer exposes validated claims here. The token
// signature/expiry are already verified by the gateway, so we only read.
export function extractAuth(event: APIGatewayProxyEvent): AuthContext {
  const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;

  const userSub = claims?.sub;
  const tenantId = claims?.["custom:tenant_id"];
  if (!userSub || !tenantId) {
    throw new UnauthorizedError("Token is missing required claims");
  }

  const rawGroups = claims["cognito:groups"] ?? "";
  const groups = rawGroups
    .replace(/^\[|\]$/g, "")
    .split(/[,\s]+/)
    .filter(Boolean);

  return { userSub, tenantId, groups };
}
