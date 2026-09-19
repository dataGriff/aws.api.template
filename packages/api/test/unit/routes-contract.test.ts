import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { routes } from "../../src/router/index.js";
import { contractPath } from "../helpers/contract.js";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

// The route table is hand-written; this test is what keeps it honest against
// the contract (the source of truth, from the installed package). Bump the
// package to a version with a new operation and this fails until the router
// serves it — and vice versa.
describe("router mirrors the contract", () => {
  it("serves exactly the operations the installed contract declares", () => {
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
