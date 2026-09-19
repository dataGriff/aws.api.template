import type { APIGatewayProxyResult, Context } from "aws-lambda";
import { handler } from "../../src/handler.js";
import type { EventOptions } from "./events.js";
import { buildEvent } from "./events.js";

const context = {
  awsRequestId: "ctx-request-id",
  functionName: "test",
  memoryLimitInMB: "512",
  getRemainingTimeInMillis: () => 30_000,
} as unknown as Context;

// Invokes the real middy handler with a synthetic event — the same code path a
// deployed request takes, minus the gateway. Used by contract + BDD tests.
export async function invoke(opts: EventOptions): Promise<APIGatewayProxyResult> {
  // Cast: the middy header-normalizer augments the event type with rawHeaders,
  // which the synthetic event omits (the middleware adds it at runtime).
  const result = (await handler(buildEvent(opts) as never, context)) as APIGatewayProxyResult;
  return result;
}

export const parse = (res: APIGatewayProxyResult): unknown =>
  res.body ? JSON.parse(res.body) : undefined;
