import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  // App source (React + TypeScript)
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    ignores: ["supabase/functions/**"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // (supabase as any).rpc() is the canonical pattern for RPCs the type
      // generator doesn't cover; enabling this rule would require suppresses
      // throughout messaging, documents, and admin pages.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // shadcn/ui generated files export constants alongside components by design;
  // splitting each into two files would break shadcn CLI re-generation.
  // AuthContext and main.tsx are intentional single-file patterns.
  {
    files: [
      "src/components/ui/**/*.{ts,tsx}",
      "src/contexts/AuthContext.tsx",
      "src/main.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  // Supabase Edge Functions — Deno runtime, no React, no browser globals.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.denoBuiltin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
