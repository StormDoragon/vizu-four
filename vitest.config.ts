import { defineConfig } from "vitest/config";
import path from "node:path";

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
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
