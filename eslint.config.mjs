import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// eslint-config-next already registers the "jsx-a11y" plugin instance (via its
// own require of eslint-plugin-jsx-a11y) for all source files. Spreading
// jsxA11y.flatConfigs.recommended as-is re-registers "jsx-a11y" under a
// different object reference, which ESLint's flat config rejects with
// "Cannot redefine plugin". Apply only its `rules`, reusing the
// already-registered plugin.
const { rules: jsxA11yRecommendedRules } = jsxA11y.flatConfigs.recommended;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: jsxA11yRecommendedRules },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
