import { defineConfig } from "vitest/config";
import path from "node:path";

// `.mts`, not `.ts`: this file is ESM, and Vite's native config loader (set
// to become its default) reads a `.ts` config as CommonJS, warning on every
// run. The extension is the fix Vite names; `import.meta.dirname` replaces
// the `__dirname` that is not defined in an ES module.
export default defineConfig({
  test: {
    // Default environment for engine/lib tests, which is faster and closer
    // to how they actually execute (a Next.js server route, not a
    // browser). Component tests opt into jsdom individually with a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
