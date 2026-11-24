import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import functional from "eslint-plugin-functional";
import tseslint from "typescript-eslint";

const bannedSyntax = [
  { selector: "IfStatement", message: "Use switch, a strategy map or a Result match." },
  { selector: "ConditionalExpression", message: "Use switch, a strategy map or a Result match." },
  { selector: "Literal[raw='null']", message: "Use undefined." },
  {
    selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
    message: "No type casting.",
  },
  { selector: "ClassDeclaration", message: "Prefer closures." },
];

export default defineConfig(
  globalIgnores(["**/dist/**", "**/.astro/**", "**/.wrangler/**", "specs/**", "spikes/**"]),
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
    plugins: { functional },
    rules: {
      "no-restricted-syntax": ["error", ...bannedSyntax],
      "max-lines": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      "functional/no-let": "error",
      "functional/no-loop-statements": "error",
      "functional/no-this-expressions": "error",
    },
  },
);
