import type middy from "@middy/core";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { AppError } from "../errors.js";
import { logger } from "../observability.js";

const requestId = (event: APIGatewayProxyEvent, context: Context): string =>
  event.headers?.["x-request-id"] ?? event.requestContext?.requestId ?? context.awsRequestId;

// Maps thrown errors to RFC 7807 problem+json, and stamps x-request-id on every
// response for trace correlation.
export function errorMapper(): middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> {
  return {
    after: (request) => {
      const id = requestId(request.event, request.context);
      if (request.response) {
        request.response.headers = { "x-request-id": id, ...request.response.headers };
      }
    },
    onError: (request) => {
      const id = requestId(request.event, request.context);
      const err = request.error as Error;
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
