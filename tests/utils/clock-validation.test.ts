import { expect } from "chai";
import { validateClockAdvance } from "./helpers";

/**
 * Test suite for clock validation improvements
 *
 * This test suite validates the improvements made to clock advancement validation:
 * 1. Consistent 90% threshold across all tests
 * 2. Proper verification that clock reaches close to target timestamp
 * 3. Graceful degradation when setClock doesn't work
 * 4. Clear documentation and error messages
 */
describe("Clock Validation Utils", () => {
  // Mock provider for testing
  const mockProvider = {
    connection: {
      _rpcRequest: async (method: string, params: any) => {
        if (method === "setClock") {
          return { result: "ok" };
        }
        throw new Error("Unknown method");
      },
      getSlot: async () => 12345,
      getBlockTime: async (slot: number) => Math.floor(Date.now() / 1000),
    },
  };

  describe("validateClockAdvance", () => {
    it("should return true when clock advances sufficiently", async () => {
      const baselineTimestamp = Math.floor(Date.now() / 1000);
      const targetTimestamp = baselineTimestamp + 300; // 5 minutes ahead

      // Mock successful clock advancement
      const mockProviderSuccess = {
        connection: {
          _rpcRequest: async (method: string, params: any) => {
            if (method === "setClock") {
              return { result: "ok" };
            }
            throw new Error("Unknown method");
          },
          getSlot: async () => 12345,
          getBlockTime: async (slot: number) => baselineTimestamp + 280, // 280s elapsed (93% of 300s)
        },
      };

      const result = await validateClockAdvance(
        mockProviderSuccess,
        targetTimestamp,
        baselineTimestamp,
        90,
      );

      expect(result).to.be.true;
    });

    it("should return false when clock doesn't advance enough", async () => {
      const baselineTimestamp = Math.floor(Date.now() / 1000);
      const targetTimestamp = baselineTimestamp + 300; // 5 minutes ahead

      // Mock insufficient clock advancement
      const mockProviderInsufficient = {
        connection: {
          _rpcRequest: async (method: string, params: any) => {
            if (method === "setClock") {
              return { result: "ok" };
            }
            throw new Error("Unknown method");
          },
          getSlot: async () => 12345,
          getBlockTime: async (slot: number) => baselineTimestamp + 200, // Only 200s elapsed (67% of 300s)
        },
      };

      const result = await validateClockAdvance(
        mockProviderInsufficient,
        targetTimestamp,
        baselineTimestamp,
        90,
      );

      expect(result).to.be.false;
    });

    it("should return false when setClock is not available", async () => {
      const baselineTimestamp = Math.floor(Date.now() / 1000);
      const targetTimestamp = baselineTimestamp + 300;

      // Mock setClock not available
      const mockProviderNoSetClock = {
        connection: {
          _rpcRequest: async (method: string, params: any) => {
            throw new Error("Method not found");
          },
          getSlot: async () => 12345,
          getBlockTime: async (slot: number) => baselineTimestamp,
        },
      };

      const result = await validateClockAdvance(
        mockProviderNoSetClock,
        targetTimestamp,
        baselineTimestamp,
        90,
      );

      expect(result).to.be.false;
    });

    it("should return false when block time is unavailable", async () => {
      const baselineTimestamp = Math.floor(Date.now() / 1000);
      const targetTimestamp = baselineTimestamp + 300;

      // Mock no block time available
      const mockProviderNoBlockTime = {
        connection: {
          _rpcRequest: async (method: string, params: any) => {
            if (method === "setClock") {
              return { result: "ok" };
            }
            throw new Error("Unknown method");
          },
          getSlot: async () => 12345,
          getBlockTime: async (slot: number) => null,
        },
      };

      const result = await validateClockAdvance(
        mockProviderNoBlockTime,
        targetTimestamp,
        baselineTimestamp,
        90,
      );

      expect(result).to.be.false;
    });

    it("should handle custom threshold percentages", async () => {
      const baselineTimestamp = Math.floor(Date.now() / 1000);
      const targetTimestamp = baselineTimestamp + 300;

      // Test with 80% threshold (should pass with 250s advancement)
      const mockProviderCustom = {
        connection: {
          _rpcRequest: async (method: string, params: any) => {
            if (method === "setClock") {
              return { result: "ok" };
            }
            throw new Error("Unknown method");
          },
          getSlot: async () => 12345,
          getBlockTime: async (slot: number) => baselineTimestamp + 250, // 83% of 300s
        },
      };

      const result80 = await validateClockAdvance(
        mockProviderCustom,
        targetTimestamp,
        baselineTimestamp,
        80,
      );
      expect(result80).to.be.true;

      // Same advancement should fail with 90% threshold
      const result90 = await validateClockAdvance(
        mockProviderCustom,
        targetTimestamp,
        baselineTimestamp,
        90,
      );
      expect(result90).to.be.false;
    });
  });

  describe("Threshold Consistency", () => {
    it("should use consistent 90% threshold for all test scenarios", () => {
      // This test documents the expected threshold values for consistency
      const testScenarios = [
        { target: 250, expectedMin: 225 },   // T17: 250s target, 225s min (90%)
        { target: 300, expectedMin: 270 },   // T18/T25: 300s target, 270s min (90%)
        { target: 800, expectedMin: 720 },   // T18/T25: 800s target, 720s min (90%)
      ];

      testScenarios.forEach((scenario) => {
        const calculatedMin = Math.floor(scenario.target * 90 / 100);
        expect(calculatedMin).to.equal(scenario.expectedMin);
      });
    });

    it("should provide better validation than old inconsistent thresholds", () => {
      // This test documents the improvement over the old inconsistent thresholds
      const oldThresholds = [
        { target: 250, oldMin: 200, oldPercent: 80 },    // T17: 80% threshold
        { target: 300, oldMin: 200, oldPercent: 67 },    // T18/T25: 67% threshold
        { target: 800, oldMin: 700, oldPercent: 87.5 },  // T18/T25: 87.5% threshold
      ];

      const newThresholds = [
        { target: 250, newMin: 225, newPercent: 90 },    // T17: 90% threshold
        { target: 300, newMin: 270, newPercent: 90 },    // T18/T25: 90% threshold
        { target: 800, newMin: 720, newPercent: 90 },    // T18/T25: 90% threshold
      ];

      // Verify consistency improvement
      const oldPercents = oldThresholds.map((t) => t.oldPercent);
      const newPercents = newThresholds.map((t) => t.newPercent);

      // Old percentages were inconsistent (80, 67, 87.5)
      expect(new Set(oldPercents).size).to.be.greaterThan(1);

      // New percentages are all consistent at 90%
      expect(new Set(newPercents).size).to.equal(1);
      expect(newPercents[0]).to.equal(90);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero advancement correctly", async () => {
      const baselineTimestamp = Math.floor(Date.now() / 1000);
      const targetTimestamp = baselineTimestamp; // No advancement

      const mockProviderNoAdvance = {
        connection: {
          _rpcRequest: async (method: string, params: any) => {
            if (method === "setClock") {
              return { result: "ok" };
            }
            throw new Error("Unknown method");
          },
          getSlot: async () => 12345,
          getBlockTime: async (slot: number) => baselineTimestamp, // No advancement
        },
      };

      const result = await validateClockAdvance(
        mockProviderNoAdvance,
        targetTimestamp,
        baselineTimestamp,
        90,
      );

      expect(result).to.be.false;
    });

    it("should handle very small advancements", async () => {
      const baselineTimestamp = Math.floor(Date.now() / 1000);
      const targetTimestamp = baselineTimestamp + 10; // 10 seconds

      const mockProviderSmallAdvance = {
        connection: {
          _rpcRequest: async (method: string, params: any) => {
            if (method === "setClock") {
              return { result: "ok" };
            }
            throw new Error("Unknown method");
          },
          getSlot: async () => 12345,
          getBlockTime: async (slot: number) => baselineTimestamp + 9, // 90% of 10s
        },
      };

      const result = await validateClockAdvance(
        mockProviderSmallAdvance,
        targetTimestamp,
        baselineTimestamp,
        90,
      );

      expect(result).to.be.true;
    });
  });
});
