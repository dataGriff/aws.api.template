import middy from "@middy/core";
import httpHeaderNormalizer from "@middy/http-header-normalizer";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { captureLambdaHandler } from "@aws-lambda-powertools/tracer/middleware";
import { logMetrics } from "@aws-lambda-powertools/metrics/middleware";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { dispatch } from "./router/index.js";
import { errorMapper } from "./middleware/error-mapper.js";
import { logger, metrics, tracer } from "./observability.js";

const base = (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => dispatch(event);

// Middy stack (outer → inner): header normalization, Powertools logging/tracing/
// metrics, then the generated-route dispatch. errorMapper converts thrown errors
// to problem+json and stamps x-request-id. The Powertools REST event-handler
// router is intentionally NOT used (still experimental); routing lives in
// ./router so it can be swapped when that GAs.
export const handler = middy<APIGatewayProxyEvent, APIGatewayProxyResult>(base)
  .use(httpHeaderNormalizer())
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics))
  .use(errorMapper());
