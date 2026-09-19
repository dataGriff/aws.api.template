import { build } from "esbuild";

await build({
  entryPoints: ["src/handler.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: "inline",
  minify: true,
  external: ["@aws-sdk/*"],
  logLevel: "info",
});
