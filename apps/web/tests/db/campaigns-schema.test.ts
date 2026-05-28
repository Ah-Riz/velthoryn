import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import { campaigns } from "@/lib/db/schema";

describe("DB schema: campaigns", () => {
  it("exposes instant-refund campaign fields in Drizzle schema + migration exists", () => {
    // Most dangerous bug for this task: code paths “work” but silently drop these
    // fields because schema/migrations weren’t updated together.
    expect(campaigns).toHaveProperty("minCliffTime");
    expect(campaigns.minCliffTime.name).toBe("min_cliff_time");
    expect(campaigns).toHaveProperty("instantRefunded");
    expect(campaigns.instantRefunded.name).toBe("instant_refunded");

    // Migration is required to persist this to Postgres.
    const migrationPath = resolve(
      __dirname,
      "..",
      "..",
      "src",
      "lib",
      "db",
      "migrations",
      "0006_instant_refund_campaign_fields.sql",
    );
    expect(existsSync(migrationPath)).toBe(true);
  });
});

