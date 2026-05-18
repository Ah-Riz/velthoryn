import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["./tests/globalSetup.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
