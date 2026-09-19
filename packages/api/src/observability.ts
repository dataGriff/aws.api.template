import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics } from "@aws-lambda-powertools/metrics";

// Shared Powertools instances (structured logging, X-Ray tracing, EMF metrics).
// Service/namespace come from env so a re-skinned service reports under its name.
const serviceName = process.env.POWERTOOLS_SERVICE_NAME ?? "todo-api";

export const logger = new Logger({ serviceName });
export const tracer = new Tracer({ serviceName });
export const metrics = new Metrics({
  serviceName,
  namespace: process.env.POWERTOOLS_METRICS_NAMESPACE ?? "app",
});
