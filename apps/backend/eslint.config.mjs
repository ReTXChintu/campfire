import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  // The smoke and visual scripts are plain Node ES modules, run directly with `node`, so they get
  // Node's globals (process, console, fetch, Buffer…) rather than tripping no-undef on every one.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  { ignores: ["dist/**"] },
);
