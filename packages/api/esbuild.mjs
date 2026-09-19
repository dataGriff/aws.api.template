import { build } from "esbuild";

// Bundle the Lambda handler for deployment. The AWS SDK v3 is bundled rather
// than taken from the nodejs runtime: the runtime's copy is unversioned (AWS may
// change it without notice), not every package the app needs (rds-signer) is
// guaranteed to be present, and Powertools' tracer must patch the same SDK
// instance the app uses. Source maps are inlined because the Lambda zip only
// packages handler.js (NODE_OPTIONS=--enable-source-maps reads them).
//
// pg optionally requires a native binding and a Cloudflare-only socket shim;
// neither exists on Lambda, so they stay external and resolve lazily.
await build({
  entryPoints: ["src/handler.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: "inline",
  minify: true,
  external: ["pg-native", "cloudflare:sockets"],
  logLevel: "info",
});
