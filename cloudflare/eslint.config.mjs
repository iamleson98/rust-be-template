import typescriptEslint from "@typescript-eslint/eslint-plugin";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [
  // Lint only what ships in the Worker — mirrors, sandbox state and
  // generated SDK code are excluded (see ignores below).
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "cloudflare-env.d.ts",
      "examples/**",
      "skills/**",
      "repo/**",
      "download/**",
      "tool-results/**",
      "dev-data/**",
      "bin/**",
      "migrations/**",
      "public/**",
      "container/**",
      "scripts/**",
      "src/spa/api/generated/**",
      "*.log",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettierConfig,

  {
    rules: {
      // ── Correctness (these guard against real bugs) ─────────────
      "prefer-const": "error",
      "no-debugger": "error",
      "no-unreachable": "error",
      "no-redeclare": "off", // TS compiler covers this better
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-throw-literal": "error",
      "no-self-compare": "error",
      "no-empty": "warn",
      "no-implicit-globals": "error",

      // Unused code must go away; underscore-prefixed params are intentional.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // `any` is a smell; unknown + narrowing is the contract. Generated
      // code is excluded above, so this applies to hand-written code.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-function-type": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      // @ts-ignore allowed only with an explanation (see custom-worker.ts).
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": "allow-with-description" }],

      // Hooks correctness — warnings so existing debt is visible, not silent.
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/purity": "warn",

      // Next.js: <img> blocks LCP; next/image is required except where
      // deliberately opted out (legacy SPA parity) via eslint-disable.
      "@next/next/no-img-element": "warn",
      "@next/next/no-page-custom-font": "error",

      // Logging: warn/error are legitimate; bare log is debug leftovers.
      "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],

      // Prettier owns formatting; ESLint owns semantics.
    },
  },

  // ── Backend: type-aware rules where data types matter most ──────
  // `||` used as a null-fallback silently eats "" and 0 — the exact
  // class of bug the user reported. These rules make the compiler and
  // the reviewer see it.
  {
    files: ["src/lib/**/*.ts", "src/app/api/**/*.ts", "src/app/api/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { string: true, number: true, bigint: true } },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/strict-boolean-expressions": "off", // too noisy for now
      "@typescript-eslint/no-confusing-non-null-assertion": "error",
    },
  },
];

export default eslintConfig;
