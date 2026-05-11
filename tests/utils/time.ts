import type { Connection } from "@solana/web3.js";

/**
 * Get the validator's current unix timestamp (slot-based, may lag wall clock).
 * Falls back to Date.now() if the query fails.
 */
export async function validatorNow(connection: Connection): Promise<number> {
  try {
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    return blockTime ?? Math.floor(Date.now() / 1000);
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Create time helpers bound to a connection that uses the validator's clock.
 * Call once per test suite setup.
 */
export async function createTimeHelpers(connection: Connection) {
  const now = await validatorNow(connection);
  return {
    now,
    past: (n: number) => now - n,
    future: (n: number) => now + n,
  };
}
