import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readOdcs, renderOdcsModule, zodFor } from "../../../../scripts/lib/odcs-zod.mjs";
import { todoImportColumns, todoImportLimits, todoImportRowSchema } from "@app/contracts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const contract = parse(readFileSync(join(root, "api/todo-import.odcs.yaml"), "utf8")) as Record<
  string,
  unknown
>;

describe("ODCS -> zod generator (scripts/lib/odcs-zod.mjs)", () => {
  it("reads the real data contract: one object, its columns and physical limits", () => {
    const m = readOdcs(contract);
    expect(m.apiVersion).toBe("v3.2.0");
    expect(m.properties.map((p: { name: string }) => p.name)).toEqual([...todoImportColumns]);
    expect(m.limits).toEqual(todoImportLimits);
    expect(m.delimiter).toBe(",");
  });

  it("generated module on disk is what the generator renders now (drift gate for task gen)", () => {
    const onDisk = readFileSync(
      join(root, "packages/contracts/src/generated/odcs/todo-import.ts"),
      "utf8",
    );
    expect(onDisk).toBe(renderOdcsModule(contract));
  });

  it("maps every supported logical type and refuses the rest", () => {
    expect(zodFor({ name: "a", logicalType: "string", required: true, maxLength: 5 })).toBe(
      "z.string().min(1).max(5)",
    );
    expect(zodFor({ name: "a", logicalType: "string", required: false, minLength: 2 })).toBe(
      "optionalCell(z.string().min(2))",
    );
    expect(zodFor({ name: "a", logicalType: "string", required: true, pattern: "^[a-z]+$" })).toBe(
      'z.string().min(1).regex(new RegExp("^[a-z]+$"))',
    );
    expect(zodFor({ name: "a", logicalType: "string", required: true, enum: ["x", "y"] })).toBe(
      'z.enum(["x", "y"])',
    );
    expect(
      zodFor({ name: "a", logicalType: "integer", required: false, minimum: 1, maximum: 9 }),
    ).toBe("optionalCell(z.coerce.number().int().min(1).max(9))");
    expect(zodFor({ name: "a", logicalType: "number", required: true })).toBe("z.coerce.number()");
    expect(zodFor({ name: "a", logicalType: "boolean", required: true })).toContain(
      'z.enum(["true", "false"])',
    );
    expect(zodFor({ name: "a", logicalType: "date", required: false })).toContain("isCalendarDate");
    expect(() =>
      zodFor({ name: "a", logicalType: "date", required: true, format: "dd/MM/yyyy" }),
    ).toThrow(/yyyy-MM-dd/);
    expect(() => zodFor({ name: "a", logicalType: "array", required: true })).toThrow(
      /cannot be read/,
    );
  });

  it("refuses contracts it cannot enforce instead of weakening validation", () => {
    const clone = () =>
      structuredClone(contract) as Record<string, unknown> & {
        customProperties: { property: string; value: unknown }[];
        schema: unknown[];
      };
    const noMax = clone();
    noMax.customProperties = noMax.customProperties.filter((c) => c.property !== "maxRows");
    expect(() => readOdcs(noMax)).toThrow(/maxRows/);

    const latin = clone();
    latin.customProperties.find((c) => c.property === "encoding")!.value = "latin1";
    expect(() => readOdcs(latin)).toThrow(/utf-8/);

    const two = clone();
    two.schema = [...two.schema, ...two.schema];
    expect(() => readOdcs(two)).toThrow(/exactly one schema object/);

    expect(() => readOdcs({ kind: "Other" })).toThrow(/DataContract/);
  });

  it("generated row schema: empty optional cells vanish, required empty cell fails, unknown column fails", () => {
    expect(
      todoImportRowSchema.parse({ title: "t", description: "", status: "", due_date: "" }),
    ).toEqual({
      title: "t",
    });
    expect(
      todoImportRowSchema.safeParse({ title: "", description: "", status: "", due_date: "" })
        .success,
    ).toBe(false);
    expect(todoImportRowSchema.safeParse({ title: "t", extra: "1" }).success).toBe(false);
  });
});
