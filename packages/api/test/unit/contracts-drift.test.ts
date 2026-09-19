import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { MAX_REPORTED_ERRORS } from "../../src/import/csv.js";

// Two contracts describe the same thing — a todo to create — over two
// interfaces: api/openapi.yaml (todo_create, HTTP) and api/todo-import.odcs.yaml
// (one CSV row). This test keeps their constraints identical so a change to one
// without the other fails the build instead of accepting rows the API would
// refuse (or vice versa).
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const openapi = parse(readFileSync(join(root, "api/openapi.yaml"), "utf8")) as {
  components: { schemas: Record<string, Record<string, unknown>> };
};
const odcs = parse(readFileSync(join(root, "api/todo-import.odcs.yaml"), "utf8")) as {
  apiVersion: string;
  schema: {
    properties: {
      name: string;
      logicalType: string;
      required?: boolean;
      enum?: { value: string }[];
      logicalTypeOptions?: { minLength?: number; maxLength?: number; format?: string };
    }[];
  }[];
};

const resolve = (node: Record<string, unknown>): Record<string, unknown> => {
  const ref = node.$ref as string | undefined;
  if (!ref) return node;
  const name = ref.split("/").at(-1)!;
  return resolve(openapi.components.schemas[name]!);
};

describe("ODCS file contract mirrors the OpenAPI todo_create schema", () => {
  const todoCreate = openapi.components.schemas.todo_create!;
  const apiProps = todoCreate.properties as Record<string, Record<string, unknown>>;
  const apiRequired = new Set(todoCreate.required as string[]);
  const fileProps = odcs.schema[0]!.properties;

  it("declares ODCS 3.2", () => {
    expect(odcs.apiVersion).toBe("v3.2.0");
  });

  it("has exactly the todo_create fields as columns", () => {
    expect(fileProps.map((p) => p.name).sort()).toEqual(Object.keys(apiProps).sort());
  });

  it.each(fileProps.map((p) => [p.name, p] as const))(
    "column %s carries the same constraints as the API field",
    (name, prop) => {
      const api = resolve(apiProps[name]!);
      expect(prop.required === true, "required").toBe(apiRequired.has(name));
      expect(prop.logicalTypeOptions?.maxLength, "maxLength").toBe(api.maxLength);
      expect(prop.logicalTypeOptions?.minLength, "minLength").toBe(api.minLength);
      if (api.enum)
        expect(
          prop.enum?.map((e) => e.value),
          "enum",
        ).toEqual(api.enum);
      else expect(prop.enum).toBeUndefined();
      expect(prop.logicalType === "date", "date typing").toBe(api.format === "date");
    },
  );

  it("caps the reported errors at the API's todo_import.errors maxItems", () => {
    const errors = (
      openapi.components.schemas.todo_import!.properties as Record<string, { maxItems: number }>
    ).errors!;
    expect(errors.maxItems).toBe(MAX_REPORTED_ERRORS);
  });
});
