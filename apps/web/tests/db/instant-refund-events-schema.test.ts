import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import { instantRefundEvents } from "@/lib/db/schema";

describe("DB schema: instant_refund_events", () => {
  it("exposes instant_refund_events in Drizzle schema + migration exists", () => {
    expect(instantRefundEvents).toHaveProperty("refundedTo");
    expect(instantRefundEvents.refundedTo.name).toBe("refunded_to");

    const migrationPath = resolve(
      __dirname,
      "..",
      "..",
      "src",
      "lib",
      "db",
      "migrations",
      "0007_instant_refund_events.sql",
    );
    expect(existsSync(migrationPath)).toBe(true);
  });
});

