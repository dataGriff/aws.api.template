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

// Group membership arrives under different shapes depending on the source:
// - `cognito:groups` is an array in a raw token, and a bracketed/space-joined
//   string ("[admin ops]") once flattened by the API Gateway authorizer;
// - our pre-token trigger adds a `roles` claim as a JSON-encoded array so group
//   names containing commas or spaces survive the round trip intact.
// Read every shape and normalise to a string array.
function parseGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // Not JSON — fall through to the gateway's "[a b]" flattening.
    }
  }
  return trimmed
    .replace(/^\[|\]$/g, "")
    .split(/[,\s]+/)
    .filter(Boolean);
}

// API Gateway's Cognito authorizer exposes validated claims here. The token
// signature/expiry are already verified by the gateway, so we only read.
export function extractAuth(event: APIGatewayProxyEvent): AuthContext {
  const claims = event.requestContext.authorizer?.claims as Record<string, unknown> | undefined;

  const userSub = claims?.sub;
  const tenantId = claims?.["custom:tenant_id"];
  if (typeof userSub !== "string" || typeof tenantId !== "string") {
    throw new UnauthorizedError("Token is missing required claims");
  }

  const groups = [
    ...new Set([...parseGroups(claims?.["cognito:groups"]), ...parseGroups(claims?.["roles"])]),
  ];

  return { userSub, tenantId, groups };
}
