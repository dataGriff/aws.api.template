import type { APIGatewayProxyEvent } from "aws-lambda";

export interface EventOptions {
  method: string;
  resource: string;
  path?: string;
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
  body?: unknown;
  headers?: Record<string, string>;
  claims?: Record<string, string> | null;
}

// Builds an API Gateway proxy event shaped like the real Cognito-authorized
// request, so tests exercise the exact handler code path.
export function buildEvent(opts: EventOptions): APIGatewayProxyEvent {
  const claims =
    opts.claims === null
      ? undefined
      : (opts.claims ?? { sub: "user-1", "custom:tenant_id": "tenant-1" });

  return {
    httpMethod: opts.method,
    resource: opts.resource,
    path: opts.path ?? opts.resource,
    pathParameters: opts.pathParameters ?? null,
    queryStringParameters: opts.queryStringParameters ?? null,
    headers: opts.headers ?? {},
    multiValueHeaders: {},
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {
      requestId: "test-request-id",
      authorizer: claims ? { claims } : null,
    } as APIGatewayProxyEvent["requestContext"],
  } as APIGatewayProxyEvent;
}
