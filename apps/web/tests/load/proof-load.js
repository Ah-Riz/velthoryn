/**
 * k6 load test for GET /api/campaigns/:treeAddress/proof?beneficiary=...
 *
 * Target: ~50 RPS sustained (read-only DB lookup).
 *
 * Stages:
 *   - 30s ramp to 20 VUs
 *   - 60s sustain at 50 VUs
 *   - 30s ramp down
 *
 * Acceptance thresholds:
 *   - p95 response latency < 500ms
 *   - Error rate < 1% (404 = no leaf/campaign is not an error)
 *
 * Required env vars:
 *   - CAMPAIGN_ADDRESS — campaign tree PDA (treeAddress)
 *   - BENEFICIARY_ADDRESS — beneficiary wallet to look up
 *
 * Usage (from apps/web/):
 *   k6 run \
 *     --env BASE_URL=http://localhost:3000 \
 *     --env CAMPAIGN_ADDRESS=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU \
 *     --env BENEFICIARY_ADDRESS=11111111111111111111111111111111 \
 *     tests/load/proof-load.js
 */

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "60s", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const CAMPAIGN_ADDRESS = __ENV.CAMPAIGN_ADDRESS;
const BENEFICIARY_ADDRESS = __ENV.BENEFICIARY_ADDRESS;

const PROOF_URL =
  CAMPAIGN_ADDRESS && BENEFICIARY_ADDRESS
    ? `${BASE}/api/campaigns/${CAMPAIGN_ADDRESS}/proof?beneficiary=${encodeURIComponent(BENEFICIARY_ADDRESS)}`
    : null;

// 200 = proof found; 404 = campaign/leaf missing; 429 = rate limited
const EXPECTED_STATUSES = http.expectedStatuses({ min: 200, max: 429 });

export function setup() {
  if (!CAMPAIGN_ADDRESS || !BENEFICIARY_ADDRESS) {
    throw new Error(
      "proof-load.js requires CAMPAIGN_ADDRESS and BENEFICIARY_ADDRESS env vars",
    );
  }
  return { url: PROOF_URL };
}

export default function proofLoadTest(data) {
  const res = http.get(data.url, { responseCallback: EXPECTED_STATUSES });

  check(res, {
    "proof 200, 404, or 429": (r) =>
      r.status === 200 || r.status === 404 || r.status === 429,
    "proof has leaf on 200": (r) =>
      r.status !== 200 || r.json("leaf") != null,
  });

  sleep(0.2);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const dur = metrics.http_req_duration;
  const failed = metrics.http_req_failed;

  const report = {
    timestamp: new Date().toISOString(),
    endpoint: "GET /api/campaigns/:treeAddress/proof",
    campaign_address: CAMPAIGN_ADDRESS,
    beneficiary_address: BENEFICIARY_ADDRESS,
    target_rps: 50,
    p50_ms: dur?.values?.["p(50)"]?.toFixed(2),
    p95_ms: dur?.values?.["p(95)"]?.toFixed(2),
    p99_ms: dur?.values?.["p(99)"]?.toFixed(2),
    error_rate_pct: failed?.values?.rate
      ? (failed.values.rate * 100).toFixed(2)
      : "0.00",
    total_requests: metrics.http_reqs?.values?.count,
    thresholds: {
      p95_ms_max: 500,
      error_rate_pct_max: 1,
    },
  };

  console.log("\n=== Proof Load Test Report ===");
  console.log(JSON.stringify(report, null, 2));

  return {
    "tests/load/last-proof-report.json": JSON.stringify(report, null, 2),
    stdout: `\n=== Proof Load Summary ===\np50=${report.p50_ms}ms  p95=${report.p95_ms}ms  p99=${report.p99_ms}ms  errors=${report.error_rate_pct}%\n`,
  };
}
