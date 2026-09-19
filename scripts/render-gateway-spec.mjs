#!/usr/bin/env node
// Produces a deploy-time copy of the contract with API Gateway extensions
// injected (see scripts/lib/gateway-spec.mjs). The contract itself comes from
// the installed @datagriff/todo-api-contract package and stays clean (no AWS
// extensions) so it remains portable for SDKs/docs/consumers.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { renderGatewaySpec, stringifyGatewaySpec } from "./lib/gateway-spec.mjs";
import { contractPath, contractVersion } from "./lib/contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = parse(readFileSync(contractPath, "utf8"));
const outDir = join(root, "infra/terraform/modules/api-gateway");
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, "openapi.gateway.yaml"), stringifyGatewaySpec(renderGatewaySpec(spec)));
console.log(
  `Rendered infra/terraform/modules/api-gateway/openapi.gateway.yaml from contract ${contractVersion}`,
);
