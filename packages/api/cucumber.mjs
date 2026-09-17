export default {
  paths: ["test/features/**/*.feature"],
  import: ["test/features/steps/**/*.ts"],
  format: ["summary", "progress"],
  formatOptions: { snippetInterface: "async-await" },
};
