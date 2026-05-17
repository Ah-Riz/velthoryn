import { describe, it, expect } from "vitest";
import { unixToDatetimeLocal, datetimeLocalToUnix } from "../../src/lib/stream/datetime";

describe("stream datetime helpers", () => {
  it("round-trips unix through datetime-local", () => {
    const unix = 1_700_000_000;
    const local = unixToDatetimeLocal(unix);
    const back = datetimeLocalToUnix(local);
    // datetime-local is minute precision in some browsers
    expect(Math.abs(back - unix)).toBeLessThanOrEqual(60);
  });
});
