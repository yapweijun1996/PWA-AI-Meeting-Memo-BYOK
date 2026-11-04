import js from "@eslint/js";
import ts from "typescript-eslint";
export default [
  { ignores: ["dist/**", "node_modules/**", "src/pwa/worker.template.js"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
