import type middy from "@middy/core";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { AppError, BadRequestError } from "../errors.js";
import { logger } from "../observability.js";

// The correlation id is always the gateway's request id (it is what appears in
// API Gateway access logs and X-Ray). A client-supplied x-request-id is never
// trusted as the primary id — a caller could spoof or collide it — but it is
// logged (bounded) so support can still tie a client-side trace to ours.
const requestId = (event: APIGatewayProxyEvent, context: Context): string =>
  event.requestContext?.requestId ?? context.awsRequestId;

const clientRequestId = (event: APIGatewayProxyEvent): string | undefined => {
  const value = event.headers?.["x-request-id"];
  return typeof value === "string" && value.length > 0 ? value.slice(0, 128) : undefined;
};

// Postgres "data exception" errors (SQLSTATE class 22: invalid text
// representation, string too long, invalid byte sequence, ...) mean the
// database rejected a VALUE the client sent, not that the service is broken.
// Defence in depth behind the schema validation: report them as 400 without
// echoing the driver message.
const PG_DATA_EXCEPTION = /^22/;
function normalize(err: Error): Error {
  const code = (err as { code?: unknown }).code;
  if (!(err instanceof AppError) && typeof code === "string" && PG_DATA_EXCEPTION.test(code)) {
    return new BadRequestError("Request contains a value the database cannot store");
  }
  return err;
}

// Maps thrown errors to RFC 7807 problem+json, and stamps x-request-id on every
// response for trace correlation.
export function errorMapper(): middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> {
  return {
    before: (request) => {
      const id = requestId(request.event, request.context);
      const clientId = clientRequestId(request.event);
      logger.appendKeys({ request_id: id, ...(clientId ? { client_request_id: clientId } : {}) });
    },
    after: (request) => {
      const id = requestId(request.event, request.context);
      if (request.response) {
        request.response.headers = { "x-request-id": id, ...request.response.headers };
      }
    },
    onError: (request) => {
      const id = requestId(request.event, request.context);
      const err = normalize(request.error as Error);
      const isApp = err instanceof AppError;
      const status = isApp ? err.status : 500;

      if (!isApp || status >= 500) {
        logger.error("Unhandled error", { error: err.message, stack: err.stack });
      }

      const problem = {
        type: "about:blank",
        title: isApp ? err.title : "Internal Server Error",
        status,
        detail: isApp && status < 500 ? err.message : "An unexpected error occurred",
        request_id: id,
        ...(isApp && err.errors ? { errors: err.errors } : {}),
      };

      request.response = {
        statusCode: status,
        headers: { "content-type": "application/problem+json", "x-request-id": id },
        body: JSON.stringify(problem),
      };
    },
  };
}
