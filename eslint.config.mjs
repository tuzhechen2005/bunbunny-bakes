import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // src/domain/ is pure: no Prisma, no server code, no Next.js, no runtime clock.
  {
    files: ["src/domain/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/*", "@/generated/*", "**/generated/prisma", "**/generated/prisma/*"],
              message: "src/domain must not import Prisma.",
            },
            {
              group: ["@/server", "@/server/*", "**/server/*"],
              message: "src/domain must not import server code.",
            },
            {
              group: ["next", "next/*"],
              message: "src/domain must not import Next.js.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "src/domain must not read the clock: pass `now` in as a parameter.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "src/domain must not read the clock: pass `now` in as a parameter.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Claude Code agent worktrees (local only):
    ".claude/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
