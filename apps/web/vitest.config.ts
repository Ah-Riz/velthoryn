import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Devnet integration tests require a private RPC (set DEVNET_RPC_URL).
    // Public api.devnet.solana.com rate-limits under test load (HTTP 429).
    exclude: process.env.DEVNET_RPC_URL
      ? []
      : ["**/integration/devnet-*.test.ts"],
    globalSetup: ["./tests/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    alias: {
      "@/": resolve(__dirname, "src") + "/",
      "@velthoryn/client": resolve(__dirname, "../../clients/ts/src/index.ts"),
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@velthoryn/client": resolve(__dirname, "../../clients/ts/src/index.ts"),
      "bn.js": resolve(__dirname, "../../node_modules/.pnpm/bn.js@5.2.3/node_modules/bn.js/lib/bn.js"),
    },
  },
});
