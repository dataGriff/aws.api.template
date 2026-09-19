export default {
  paths: ["test/features/**/*.feature"],
  import: ["test/features/steps/**/*.ts"],
  // One human formatter on stdout plus a machine-readable report for CI.
  format: ["progress", "message:test-results/cucumber.ndjson"],
  formatOptions: { snippetInterface: "async-await" },
};
