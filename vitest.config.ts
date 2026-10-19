import { defineConfig } from "vitest/config";
import path from "path";

// Tests run in Node. Server integration tests need a MySQL/MariaDB database
// (see tests/setup/env.js); they are skipped automatically when none is reachable.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,ts}"],
    setupFiles: ["tests/setup/env.js"],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: "forks",
    fileParallelism: false,
  },
});
