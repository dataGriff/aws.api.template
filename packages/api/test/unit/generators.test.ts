import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { renderGatewaySpec, stringifyGatewaySpec } from "../../../../scripts/lib/gateway-spec.mjs";
import { contractPath } from "../helpers/contract.js";

// The drift gate only detects that generated output CHANGED; these tests pin
// down what the gateway renderer must produce from the real (installed) contract.
const contract = parse(readFileSync(contractPath, "utf8")) as Record<string, unknown>;
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

type Operation = { operationId?: string; security?: unknown[]; parameters?: unknown[] };
type PathItem = Partial<Record<(typeof METHODS)[number], Operation>> & {
  options?: Record<string, unknown>;
};

describe("render-gateway-spec", () => {
  const rendered = renderGatewaySpec(contract) as Record<string, unknown> & {
    paths: Record<string, PathItem & Record<string, unknown>>;
  };

  it("leaves the input contract untouched", () => {
    expect(contract).not.toHaveProperty("x-amazon-apigateway-request-validator");
  });

  it("gives every operation a Lambda proxy integration and the request validator", () => {
    expect(rendered["x-amazon-apigateway-request-validator"]).toBe("all");
    for (const item of Object.values(rendered.paths)) {
      for (const method of METHODS) {
        const op = item[method] as (Operation & Record<string, unknown>) | undefined;
        if (!op) continue;
        expect(op["x-amazon-apigateway-integration"]).toMatchObject({
          type: "aws_proxy",
          httpMethod: "POST",
          uri: "${lambda_invoke_arn}",
        });
      }
    }
  });

  it("adds a CORS preflight per path advertising exactly that path's methods", () => {
    for (const item of Object.values(rendered.paths)) {
      const present = ["OPTIONS", ...METHODS.filter((m) => item[m]).map((m) => m.toUpperCase())];
      const integration = item.options?.["x-amazon-apigateway-integration"] as {
        type: string;
        responses: { default: { responseParameters: Record<string, string> } };
      };
      expect(integration.type).toBe("mock");
      expect(
        integration.responses.default.responseParameters[
          "method.response.header.Access-Control-Allow-Methods"
        ],
      ).toBe(`'${present.join(",")}'`);
      expect(
        integration.responses.default.responseParameters[
          "method.response.header.Access-Control-Allow-Origin"
        ],
      ).toBe("'${cors_origin}'");
    }
  });

  it("turns the bearer scheme into the Cognito user-pools authorizer", () => {
    const schemes = (rendered.components as { securitySchemes: Record<string, unknown> })
      .securitySchemes;
    expect(schemes.cognito_jwt).toMatchObject({
      "x-amazon-apigateway-authtype": "cognito_user_pools",
      "x-amazon-apigateway-authorizer": { providerARNs: ["${cognito_user_pool_arn}"] },
    });
  });

  it("renders every gateway-generated error as problem+json with CORS headers", () => {
    const responses = rendered["x-amazon-apigateway-gateway-responses"] as Record<
      string,
      {
        statusCode: string;
        responseParameters: Record<string, string>;
        responseTemplates: Record<string, string>;
      }
    >;
    for (const key of [
      "DEFAULT_4XX",
      "DEFAULT_5XX",
      "UNAUTHORIZED",
      "ACCESS_DENIED",
      "THROTTLED",
      "REQUEST_TOO_LARGE",
      "BAD_REQUEST_BODY",
    ]) {
      expect(responses[key], key).toBeDefined();
      const r = responses[key]!;
      expect(r.responseParameters["gatewayresponse.header.Access-Control-Allow-Origin"]).toBe(
        "'${cors_origin}'",
      );
      const body = JSON.parse(
        r.responseTemplates["application/json"]!.replace(/\$context\.[\w.]+/g, "x"),
      ) as { status: number };
      expect(String(body.status)).toBe(r.statusCode);
    }
  });

  it("stringifies without YAML anchors or aliases and round-trips", () => {
    const yaml = stringifyGatewaySpec(rendered);
    expect(yaml).not.toMatch(/&a\d|\*a\d/);
    expect(parse(yaml)).toEqual(rendered);
  });
});
