// Pure transformation: Open Data Contract Standard (ODCS 3.x) document -> the
// TypeScript module that validates one CSV row at runtime (zod), plus the
// physical limits the ingest enforces. Used by scripts/gen-odcs.mjs (I/O) and
// unit-tested directly. The generated module is the ONLY place the file
// contract's constraints exist in code — change the .odcs.yaml, run `task gen`.

const camel = (s) =>
  s.replace(/[-_]+(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toLowerCase());
const pascal = (s) => camel(s).replace(/^\w/, (c) => c.toUpperCase());

// Normalise the parts of the contract the generator needs. Fails loudly on
// anything it cannot express so a contract change never silently weakens
// validation.
export function readOdcs(contract) {
  if (contract?.kind !== "DataContract")
    throw new Error("not an ODCS document (kind: DataContract)");
  if (!/^v3\./.test(contract.apiVersion ?? ""))
    throw new Error(`unsupported ODCS apiVersion ${contract.apiVersion}`);
  const objects = contract.schema ?? [];
  if (objects.length !== 1)
    throw new Error(`expected exactly one schema object, found ${objects.length}`);
  const object = objects[0];
  const properties = (object.properties ?? []).map((p) => {
    const options = p.logicalTypeOptions ?? {};
    const values = (p.enum ?? []).map((e) => (typeof e === "object" && e !== null ? e.value : e));
    return {
      name: p.name,
      logicalType: p.logicalType ?? "string",
      required: p.required === true,
      description: p.description?.trim(),
      enum: values.length ? values.map(String) : undefined,
      minLength: options.minLength,
      maxLength: options.maxLength,
      pattern: options.pattern,
      format: options.format,
      minimum: options.minimum,
      maximum: options.maximum,
    };
  });
  const custom = Object.fromEntries(
    (contract.customProperties ?? []).map((c) => [c.property, c.value]),
  );
  const limits = {
    maxBytes: Number(custom.maxBytes),
    maxRows: Number(custom.maxRows),
    encoding: String(custom.encoding ?? "utf-8").toLowerCase(),
    header: custom.header !== false && custom.header !== "false",
    quarantinePrefix: String(custom.quarantinePrefix ?? "quarantine/"),
  };
  for (const k of ["maxBytes", "maxRows"]) {
    if (!Number.isInteger(limits[k]) || limits[k] <= 0)
      throw new Error(`customProperties.${k} must be a positive integer`);
  }
  if (limits.encoding !== "utf-8")
    throw new Error(`only utf-8 files are supported (encoding: ${limits.encoding})`);
  if (!limits.header) throw new Error("a header row is required (customProperties.header)");
  const csvServer = (contract.servers ?? []).find((s) => s.format === "csv");
  return {
    id: contract.id,
    name: contract.name,
    version: contract.version,
    apiVersion: contract.apiVersion,
    objectName: object.name,
    delimiter: csvServer?.delimiter ?? ",",
    properties,
    limits,
  };
}

// One zod expression per property. Every CSV cell arrives as a string, so
// numbers/booleans are coerced from text and an empty cell means "not provided".
export function zodFor(prop) {
  const opts = [];
  let expr;
  if (prop.enum) {
    expr = `z.enum([${prop.enum.map((v) => JSON.stringify(v)).join(", ")}])`;
  } else {
    switch (prop.logicalType) {
      case "string": {
        expr = "z.string()";
        const min = Math.max(prop.required ? 1 : 0, prop.minLength ?? 0);
        if (min > 0) opts.push(`.min(${min})`);
        if (prop.maxLength !== undefined) opts.push(`.max(${prop.maxLength})`);
        if (prop.pattern) opts.push(`.regex(new RegExp(${JSON.stringify(prop.pattern)}))`);
        break;
      }
      case "date":
        if (prop.format && prop.format !== "yyyy-MM-dd")
          throw new Error(`${prop.name}: only the yyyy-MM-dd date format is supported`);
        // One refinement (format + validity) so a bad cell yields one error, not two.
        expr = `z.string().refine(isCalendarDate, "must be a real calendar date formatted yyyy-MM-dd")`;
        break;
      case "integer":
        expr = "z.coerce.number().int()";
        if (prop.minimum !== undefined) opts.push(`.min(${prop.minimum})`);
        if (prop.maximum !== undefined) opts.push(`.max(${prop.maximum})`);
        break;
      case "number":
        expr = "z.coerce.number()";
        if (prop.minimum !== undefined) opts.push(`.min(${prop.minimum})`);
        if (prop.maximum !== undefined) opts.push(`.max(${prop.maximum})`);
        break;
      case "boolean":
        expr = `z.enum(["true", "false"]).transform((v) => v === "true")`;
        break;
      default:
        throw new Error(
          `${prop.name}: logicalType ${prop.logicalType} cannot be read from a CSV cell`,
        );
    }
  }
  const base = expr + opts.join("");
  return prop.required ? base : `optionalCell(${base})`;
}

export function renderOdcsModule(contract) {
  const m = readOdcs(contract);
  const base = camel(m.objectName);
  const lines = [
    `// Generated from api/${m.id}.odcs.yaml (ODCS ${m.apiVersion}) by \`task gen\` (scripts/gen-odcs.mjs).`,
    "// Do not edit by hand — change the data contract and regenerate.",
    'import { z } from "zod";',
    "",
    `export const ${base}Contract = ${JSON.stringify(
      {
        id: m.id,
        name: m.name,
        version: m.version,
        apiVersion: m.apiVersion,
        object: m.objectName,
        delimiter: m.delimiter,
      },
      null,
      2,
    )} as const;`,
    "",
    "// Header row: exactly these columns, in any order.",
    `export const ${base}Columns = [${m.properties.map((p) => JSON.stringify(p.name)).join(", ")}] as const;`,
    "",
    "// Physical limits the ingest enforces before any row is looked at.",
    `export const ${base}Limits = ${JSON.stringify(m.limits, null, 2)} as const;`,
    "",
    '// An empty cell is "not provided" for an optional column; required columns reject it.',
    "const optionalCell = <T extends z.ZodTypeAny>(schema: T) =>",
    '  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());',
    "const isCalendarDate = (value: string): boolean => {",
    "  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;",
    "  const t = Date.parse(`${value}T00:00:00Z`);",
    "  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(value);",
    "};",
    "",
    "// One data row after CSV parsing (every cell a string). Unknown columns are rejected.",
    `export const ${base}RowSchema = z`,
    "  .object({",
    ...m.properties.flatMap((p) => [
      ...(p.description ? [`    /** ${p.description.replace(/\s+/g, " ")} */`] : []),
      `    ${p.name}: ${zodFor(p)},`,
    ]),
    "  })",
    "  .strict();",
    `export type ${pascal(m.objectName)}Row = z.infer<typeof ${base}RowSchema>;`,
    "",
  ];
  return lines.join("\n");
}
