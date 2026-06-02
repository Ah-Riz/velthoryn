import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: [
      "tests/lib/**/*.test.ts",
      "tests/math/**/*.test.ts",
      "tests/merkle/**/*.test.ts",
      "tests/anchor/**/*.test.ts",
    ],
    exclude: [
      "tests/lib/db-*.test.ts",
      "tests/lib/db-pool.test.ts",
      "tests/lib/sync-engine.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@velthoryn/client": resolve(__dirname, "../../clients/ts/src/index.ts"),
      "bn.js": resolve(__dirname, "../../node_modules/.pnpm/bn.js@5.2.3/node_modules/bn.js/lib/bn.js"),
    },
  },
});
