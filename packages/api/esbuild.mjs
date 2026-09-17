import { build } from "esbuild";

// Bundle the Lambda handler for deployment. The AWS SDK v3 is provided by the
// nodejs runtime, so it is left external to keep the artifact small. Everything
// else (Powertools, middy, pg, zod, generated contracts) is bundled.
await build({
  entryPoints: ["src/handler.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  minify: true,
  external: ["@aws-sdk/*"],
  logLevel: "info",
});
