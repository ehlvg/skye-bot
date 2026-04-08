import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "data/**", ".env", ".env.*"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
    },
  },
  eslintConfigPrettier,
  {
    rules: {
      // Codebase uses `any` extensively for OpenAI/grammy dynamic types — warn, don't block
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
