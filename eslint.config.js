import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/generated/**",
      "docs/api-reference/**",
      "**/.terraform/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.test.ts", "**/test/**", "scripts/**"],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      "security/detect-non-literal-fs-filename": "off",
    },
  },
);
