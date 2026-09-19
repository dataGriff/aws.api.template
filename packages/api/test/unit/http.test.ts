import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseBody, validate } from "../../src/http.js";
import { BadRequestError } from "../../src/errors.js";
import { buildEvent } from "../helpers/events.js";

const schema = z.object({ title: z.string().min(1) });

describe("parseBody", () => {
  it("returns the parsed body on valid input", () => {
    const event = buildEvent({ method: "POST", resource: "/todos", body: { title: "hi" } });
    expect(parseBody(event, schema)).toEqual({ title: "hi" });
  });

  it("throws BadRequest with field errors on invalid input", () => {
    const event = buildEvent({ method: "POST", resource: "/todos", body: { title: "" } });
    try {
      parseBody(event, schema);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestError);
      expect((e as BadRequestError).errors?.[0]?.field).toBe("title");
    }
  });

  it("throws BadRequest on malformed JSON", () => {
    const event = buildEvent({ method: "POST", resource: "/todos" });
    event.body = "{not json";
    expect(() => parseBody(event, schema)).toThrow(BadRequestError);
  });
});

describe("validate", () => {
  it("rejects a non-uuid string", () => {
    expect(() => validate(z.string().uuid(), "nope")).toThrow(BadRequestError);
  });
});
