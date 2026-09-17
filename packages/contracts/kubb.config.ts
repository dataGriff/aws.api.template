import { defineConfig } from "@kubb/core";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginTs } from "@kubb/plugin-ts";
import { pluginZod } from "@kubb/plugin-zod";

// Generates runtime zod schemas + matching TS types from the contract.
// The API handler validates requests/responses with the zod schemas
// (defence-in-depth behind API Gateway's own request validation).
export default defineConfig({
  root: ".",
  input: { path: "../../api/openapi.yaml" },
  output: {
    path: "./src/generated",
    clean: true,
    barrelType: "named",
  },
  plugins: [
    pluginOas({ validate: true }),
    pluginTs({
      output: { path: "types" },
      enumType: "literal",
      dateType: "string",
    }),
    pluginZod({
      output: { path: "zod" },
      typed: true,
      dateType: "string",
      inferred: true,
    }),
  ],
});
