import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const unsafeHtml = {
  selector:
    "JSXAttribute[name.name='dangerouslySetInnerHTML'], Property[key.name='dangerouslySetInnerHTML'], Property[key.value='dangerouslySetInnerHTML'], AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/], CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]",
  message: "Render sanitized HTML only through src/markdown/SafeHtml.tsx.",
};

const graphqlDocument = /^\s*(query|mutation|subscription|fragment)\b[^]*[{]/u.source;

export default defineConfig(
  globalIgnores([
    "dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "dev-dist/**",
    ".wrangler/**",
    "src/data/graphql-env.d.ts",
    "schema/**",
  ]),
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ["**/*.{js,ts,tsx}"],
    ignores: ["src/markdown/SafeHtml.tsx"],
    rules: { "no-restricted-syntax": ["error", unsafeHtml] },
  },
  {
    files: ["src/{app,features,ui}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", { name: "fetch", message: "Use src/data hooks." }],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].map((object) => ({
          object,
          property: "fetch",
          message: "Use src/data hooks.",
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: ["gql.tada", "graphql", "@0no-co/graphql.web"].map((name) => ({
            name,
            message: "Use src/data hooks.",
          })),
          patterns: [
            {
              group: ["**/data/internal/**", "**/data/**/internal/**"],
              message: "Use public src/data exports.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        unsafeHtml,
        {
          selector: "CallExpression[callee.name='graphql']",
          message: "GraphQL belongs in src/data.",
        },
        {
          selector: "TaggedTemplateExpression[tag.name='graphql']",
          message: "GraphQL belongs in src/data.",
        },
        {
          selector: `TemplateElement[value.raw=/${graphqlDocument}/], Literal[value=/${graphqlDocument}/]`,
          message: "GraphQL belongs in src/data.",
        },
      ],
    },
  },
);
