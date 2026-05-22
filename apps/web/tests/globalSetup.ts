import { execSync } from "child_process";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

export default function globalSetup() {
  const webRoot = resolve(__dirname, "..");
  loadEnvFile(resolve(webRoot, ".env.local"));
  loadEnvFile(resolve(webRoot, ".env"));

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for API tests. Set it in .env.local or as env var.",
    );
  }

  // Warn if pointing at Supabase (tests will truncate tables!)
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl.includes("supabase.co") || dbUrl.includes("supabase.in")) {
    console.warn(
      "\n⚠️  WARNING: DATABASE_URL points to Supabase. API tests that require DB " +
      "will skip destructive operations to protect your data.\n" +
      "   For full test coverage, use a local Postgres:\n" +
      "   DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci pnpm test\n",
    );
  }

  if (process.env.CI || !process.env.DRIZZLE_PUSH) {
    return;
  }

  execSync("echo y | pnpm drizzle-kit push", {
    cwd: webRoot,
    stdio: "inherit",
    shell: "/bin/bash",
  });
}
