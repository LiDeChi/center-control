import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/__tests__/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 120000
  },
  resolve: {
    alias: {
      "@center/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@center/db": path.resolve(__dirname, "packages/db/src/index.ts")
    }
  }
});
