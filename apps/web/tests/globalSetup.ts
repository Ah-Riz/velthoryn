import { execSync } from "child_process";
import { resolve } from "path";

export default function globalSetup() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for API tests. Start Postgres and set DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci",
    );
  }

  if (process.env.CI) {
    return;
  }

  const webRoot = resolve(__dirname, "..");
  execSync("echo y | pnpm drizzle-kit push", {
    cwd: webRoot,
    stdio: "inherit",
    shell: "/bin/bash",
  });
}
