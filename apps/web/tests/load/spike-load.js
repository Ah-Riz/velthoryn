/**
 * k6 spike load test — mixed read + prepare traffic.
 *
 * Hits health, campaigns list, and prepare in one scenario with a burst to 200 VUs.
 *
 * Stages:
 *   - 10s ramp to 5 VUs
 *   - 20s spike to 200 VUs
 *   - 60s sustain at 200 VUs
 *   - 30s ramp down
 *
 * Acceptance thresholds:
 *   - p95 response latency < 3000ms during spike
 *   - Error rate < 10% (429 rate limits tolerated under burst)
 *
 * Usage (from apps/web/):
 *   k6 run --env BASE_URL=http://localhost:3000 tests/load/spike-load.js
 */

import http from "k6/http";
import { check, group, sleep } from "k6";

export const options = {
  stages: [
    { duration: "10s", target: 5 },
    { duration: "20s", target: 200 },
    { duration: "60s", target: 200 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.10"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const CREATOR = "11111111111111111111111111111112";
const MINT = "11111111111111111111111111111114";
const POST_HEADERS = { "Content-Type": "application/json" };

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
    campaignId: 2_000_000_000_000 + iteration,
    cancellable: false,
    cancelAuthority: null,
    pauseAuthority: null,
  });
}

export default function spikeLoadTest() {
  group("GET /api/health", () => {
    const res = http.get(`${BASE}/api/health`);
    check(res, {
      "health responded": (r) => r.status === 200 || r.status === 503,
    });
  });

  group("GET /api/campaigns", () => {
    const res = http.get(`${BASE}/api/campaigns`);
    check(res, {
      "campaigns 200 or 401": (r) => r.status === 200 || r.status === 401,
    });
  });

  if (__ITER % 5 === 0) {
    group("POST /api/campaigns/prepare", () => {
      const res = http.post(
        `${BASE}/api/campaigns/prepare`,
        buildPreparePayload(__ITER),
        { headers: POST_HEADERS },
      );
      check(res, {
        "prepare 200 or 429": (r) => r.status === 200 || r.status === 429,
      });
    });
  }

  sleep(0.1);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const dur = metrics.http_req_duration;
  const failed = metrics.http_req_failed;

  const report = {
    timestamp: new Date().toISOString(),
    scenario: "mixed spike (health + campaigns + prepare)",
    peak_vus: 200,
    p50_ms: dur?.values?.["p(50)"]?.toFixed(2),
    p95_ms: dur?.values?.["p(95)"]?.toFixed(2),
    p99_ms: dur?.values?.["p(99)"]?.toFixed(2),
    error_rate_pct: failed?.values?.rate
      ? (failed.values.rate * 100).toFixed(2)
      : "0.00",
    total_requests: metrics.http_reqs?.values?.count,
    thresholds: {
      p95_ms_max: 3000,
      error_rate_pct_max: 10,
    },
  };

  console.log("\n=== Spike Load Test Report ===");
  console.log(JSON.stringify(report, null, 2));

  return {
    "tests/load/last-spike-report.json": JSON.stringify(report, null, 2),
    stdout: `\n=== Spike Load Summary ===\np50=${report.p50_ms}ms  p95=${report.p95_ms}ms  p99=${report.p99_ms}ms  errors=${report.error_rate_pct}%\n`,
  };
}
