#!/usr/bin/env node
// Produces a deploy-time copy of the contract with API Gateway extensions
// injected: Lambda proxy integrations, request validators, the Cognito
// authorizer, and CORS preflight. The base api/openapi.yaml stays clean (no AWS
// extensions) so it remains portable for SDKs/docs/consumers. Terraform imports
// the rendered file via templatefile(), substituting ${lambda_invoke_arn},
// ${cognito_user_pool_arn} and ${cors_origin} at apply time.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = parse(readFileSync(join(root, "api/openapi.yaml"), "utf8"));
const outDir = join(root, "infra/terraform/modules/api-gateway");
mkdirSync(outDir, { recursive: true });

const METHODS = ["get", "post", "put", "patch", "delete"];
const lambdaIntegration = {
  type: "aws_proxy",
  httpMethod: "POST",
  uri: "${lambda_invoke_arn}",
  passthroughBehavior: "when_no_match",
};

// Request validators: validate body + params for every operation.
spec["x-amazon-apigateway-request-validators"] = {
  all: { validateRequestBody: true, validateRequestParameters: true },
};
spec["x-amazon-apigateway-request-validator"] = "all";

// Turn the bearer scheme into a Cognito user-pools authorizer.
spec.components ??= {};
spec.components.securitySchemes ??= {};
spec.components.securitySchemes.cognito_jwt = {
  type: "apiKey",
  name: "Authorization",
  in: "header",
  "x-amazon-apigateway-authtype": "cognito_user_pools",
  "x-amazon-apigateway-authorizer": {
    type: "cognito_user_pools",
    providerARNs: ["${cognito_user_pool_arn}"],
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "'${cors_origin}'",
  "Access-Control-Allow-Methods": "'GET,POST,PATCH,DELETE,OPTIONS'",
  "Access-Control-Allow-Headers": "'authorization,content-type,x-api-key,idempotency-key'",
};

for (const [, item] of Object.entries(spec.paths)) {
  const methodsPresent = ["OPTIONS"];
  for (const method of METHODS) {
    if (!item[method]) continue;
    methodsPresent.push(method.toUpperCase());
    item[method]["x-amazon-apigateway-integration"] = lambdaIntegration;
  }

  // CORS preflight via a mock integration.
  item.options = {
    summary: "CORS preflight",
    security: [],
    responses: {
      "204": {
        description: "CORS headers",
        headers: Object.fromEntries(
          Object.keys(corsHeaders).map((h) => [h, { schema: { type: "string" } }]),
        ),
      },
    },
    "x-amazon-apigateway-integration": {
      type: "mock",
      requestTemplates: { "application/json": '{"statusCode": 204}' },
      responses: {
        default: {
          statusCode: "204",
          responseParameters: Object.fromEntries(
            Object.entries(corsHeaders).map(([h, v]) => [
              `method.response.header.${h}`,
              v,
            ]),
          ),
        },
      },
    },
  };
}

writeFileSync(join(outDir, "openapi.gateway.yaml"), stringify(spec));
console.log("Rendered infra/terraform/modules/api-gateway/openapi.gateway.yaml");
