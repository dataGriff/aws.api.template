import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { renderGatewaySpec, stringifyGatewaySpec } from "../../../../scripts/lib/gateway-spec.mjs";
import { generateCollection } from "../../../../scripts/lib/http-collection.mjs";

// The drift gate only detects that generated output CHANGED; these tests pin
// down what the generators must produce from the real contract.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const contract = parse(readFileSync(join(root, "api/openapi.yaml"), "utf8")) as Record<
  string,
  unknown
>;
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

describe("gen-http-collection", () => {
  const { files, env } = generateCollection(contract) as {
    files: Map<string, string>;
    env: Record<string, Record<string, string>>;
  };
  const all = [...files.values()].join("\n");
  const operations = Object.values(contract.paths as Record<string, PathItem>).flatMap((item) =>
    METHODS.map((m) => item[m]).filter((op): op is Operation => Boolean(op)),
  );

  it("emits exactly one named request per operation", () => {
    for (const op of operations) {
      expect(all.match(new RegExp(`^# @name ${op.operationId}$`, "m"))?.length ?? 0).toBe(1);
    }
    expect(all.match(/^# @name /gm)).toHaveLength(operations.length);
  });

  it("sends both auth headers on secured operations and none on public ones", () => {
    const blocks = all.split(/^### /m).slice(1);
    for (const block of blocks) {
      const name = /^# @name (\S+)/m.exec(block)?.[1];
      const op = operations.find((o) => o.operationId === name)!;
      const secured = (op.security ?? (contract.security as unknown[]) ?? []).length > 0;
      expect(block.includes("Authorization: Bearer {{token}}"), name).toBe(secured);
      expect(block.includes("x-api-key: {{apiKey}}"), name).toBe(secured);
    }
  });

  it("defines every placeholder the requests use, in every environment, without storing tokens", () => {
    const used = new Set([...all.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!));
    used.delete("token");
    used.delete("apiKey");
    for (const [name, vars] of Object.entries(env)) {
      for (const v of used) expect(vars, `${name} defines ${v}`).toHaveProperty(v);
      expect(vars).not.toHaveProperty("token");
    }
    expect(env.local!.baseUrl).toBe("http://localhost:3000/v1");
    expect(env.local!.cursor).toBe("");
  });
});
