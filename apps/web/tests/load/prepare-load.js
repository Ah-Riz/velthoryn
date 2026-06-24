/**
 * k6 load test for POST /api/campaigns/prepare.
 *
 * Target: ~10 RPS sustained (CPU-heavy Merkle tree build).
 *
 * Stages:
 *   - 30s ramp to 5 VUs
 *   - 60s sustain at 10 VUs
 *   - 30s ramp down
 *
 * Acceptance thresholds:
 *   - p95 response latency < 2000ms
 *   - Error rate < 5% (429 rate-limit responses count as non-errors)
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:3000 tests/load/prepare-load.js
 *   k6 run --env BASE_URL=https://staging.velthoryn.vercel.app tests/load/prepare-load.js
 */

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "60s", target: 10 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";

const CREATOR = "11111111111111111111111111111112";
const MINT = "11111111111111111111111111111114";

// Valid Solana pubkeys — one cliff/linear leaf per beneficiary (keeps each
// under the on-chain per-leaf cap of 8; ADR-003).
const BENEFICIARIES = [
  "11111111111111111111111111111111",
  "11111111111111111111111111111112",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  "SysvarRent111111111111111111111111111111111",
  "SysvarC1ock11111111111111111111111111111111",
  "Vote111111111111111111111111111111111111111",
  "Stake11111111111111111111111111111111111111",
  "Config1111111111111111111111111111111111111",
];

const POST_HEADERS = {
  "Content-Type": "application/json",
};

function buildPreparePayload(iteration) {
  const recipients = BENEFICIARIES.map((beneficiary, i) => ({
    beneficiary,
    amount: String((i + 1) * 1_000_000),
    releaseType: i % 2 === 0 ? 0 : 1,
    startTime: "1700000000",
    cliffTime: i % 2 === 0 ? "1731536000" : "1700000000",
    endTime: "1731536000",
    milestoneIdx: 0,
  }));

  return JSON.stringify({
    recipients,
    mint: MINT,
    creator: CREATOR,
    campaignId: 1_000_000_000_000 + iteration,
    cancellable: false,
    cancelAuthority: null,
    pauseAuthority: null,
  });
}

export default function prepareLoadTest() {
  const res = http.post(
    `${BASE}/api/campaigns/prepare`,
    buildPreparePayload(__ITER),
    { headers: POST_HEADERS },
  );

  check(res, {
    "prepare 200 or 429": (r) => r.status === 200 || r.status === 429,
    "prepare has merkleRoot on 200": (r) =>
      r.status !== 200 || (r.json("merkleRoot") != null && r.json("leafCount") === 10),
  });

  sleep(1);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const dur = metrics.http_req_duration;
  const failed = metrics.http_req_failed;

  const report = {
    timestamp: new Date().toISOString(),
    endpoint: "POST /api/campaigns/prepare",
    target_rps: 10,
    p50_ms: dur?.values?.["p(50)"]?.toFixed(2),
    p95_ms: dur?.values?.["p(95)"]?.toFixed(2),
    p99_ms: dur?.values?.["p(99)"]?.toFixed(2),
    error_rate_pct: failed?.values?.rate
      ? (failed.values.rate * 100).toFixed(2)
      : "0.00",
    total_requests: metrics.http_reqs?.values?.count,
    thresholds: {
      p95_ms_max: 2000,
      error_rate_pct_max: 5,
    },
  };

  console.log("\n=== Prepare Load Test Report ===");
  console.log(JSON.stringify(report, null, 2));

  return {
    "tests/load/last-prepare-report.json": JSON.stringify(report, null, 2),
    stdout: `\n=== Prepare Load Summary ===\np50=${report.p50_ms}ms  p95=${report.p95_ms}ms  p99=${report.p99_ms}ms  errors=${report.error_rate_pct}%\n`,
  };
}
