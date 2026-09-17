import { defineConfig } from "@kubb/core";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginTs } from "@kubb/plugin-ts";
import { pluginZod } from "@kubb/plugin-zod";
import { pluginClient } from "@kubb/plugin-client";

// Generates a typed fetch client + types + zod for consumers. Published to the
// registry by release.yml. Consumers can also generate their own client from
// api/openapi.yaml — see docs/consumer-guide.
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
    pluginTs({ output: { path: "types" }, enumType: "literal", dateType: "string" }),
    pluginZod({ output: { path: "zod" }, typed: true, dateType: "string" }),
    pluginClient({
      output: { path: "client" },
      client: "fetch",
      dataReturnType: "data",
    }),
  ],
});
