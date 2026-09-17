import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { BadRequestError } from "./errors.js";

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

export const noContent = (headers: Record<string, string> = {}): APIGatewayProxyResult => ({
  statusCode: 204,
  headers,
  body: "",
});

// Parse + validate a JSON body against a zod schema, mapping failures to a 400
// with field-level errors (defence-in-depth behind gateway validation). The
// generated zod is loosely typed, so the validated shape is asserted to the
// caller-supplied contract type T.
export function parseBody<T>(event: APIGatewayProxyEvent, schema: z.ZodTypeAny): T {
  let raw: unknown;
  try {
    raw = event.body ? JSON.parse(event.body) : {};
  } catch {
    throw new BadRequestError("Request body is not valid JSON");
  }
  return validate<T>(schema, raw);
}

export function validate<T>(schema: z.ZodTypeAny, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestError(
      "Request validation failed",
      result.error.issues.map((i) => ({ field: i.path.join(".") || "(root)", message: i.message })),
    );
  }
  return result.data as T;
}
