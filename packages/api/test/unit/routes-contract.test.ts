import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { routes } from "../../src/router/index.js";

const contractPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../api/openapi.yaml");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

// The route table is hand-written; this test is what keeps it honest against
// the contract (the source of truth). Add an operation to api/openapi.yaml and
// this fails until the router serves it — and vice versa.
describe("router mirrors the contract", () => {
  it("serves exactly the operations declared in api/openapi.yaml", () => {
    const spec = parse(readFileSync(contractPath, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const declared = new Set<string>();
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of METHODS) {
        if (item[method]) declared.add(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(new Set(Object.keys(routes))).toEqual(declared);
  });
});
