/**
 * k6 load test for the Velthoryn API.
 *
 * Targets:
 *   - 100 RPS on GET endpoints (campaigns list, health, schedule-templates)
 *   - 10  RPS on POST endpoints (simulate-vesting)
 *
 * Acceptance thresholds:
 *   - p95 response latency < 500ms
 *   - Error rate < 1%
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:3000 tests/load/api-load.js
 *   k6 run --env BASE_URL=https://staging.velthoryn.vercel.app tests/load/api-load.js
 */

import http from "k6/http";
import { check, group, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 20 },   // warm-up: ramp to 20 VUs
    { duration: "60s", target: 100 },  // sustain: 100 concurrent VUs
    { duration: "30s", target: 0 },    // ramp-down
  ],
  thresholds: {
    // 95th-percentile latency must stay below 500ms
    http_req_duration: ["p(95)<500"],
    // Error rate (non-2xx or network failures) must stay below 1%
    http_req_failed: ["rate<0.01"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";

const SIMULATE_PAYLOAD = JSON.stringify({
  amount: "1000000000",
  releaseType: 1,
  startTime: "1700000000",
  cliffTime: "1700000000",
  endTime: "1731536000",
});

const POST_HEADERS = {
  "Content-Type": "application/json",
};

export default function () {
  // -------------------------------------------------------------------------
  // GET endpoints — high-frequency read traffic
  // -------------------------------------------------------------------------

  group("GET /api/health", () => {
    const res = http.get(`${BASE}/api/health`);
    check(res, {
      "health 200": (r) => r.status === 200,
    });
  });

  group("GET /api/campaigns", () => {
    const res = http.get(`${BASE}/api/campaigns`);
    check(res, {
      "campaigns 200 or 401": (r) => r.status === 200 || r.status === 401,
    });
  });

  group("GET /api/schedule-templates", () => {
    const res = http.get(`${BASE}/api/schedule-templates`);
    check(res, {
      "templates 200": (r) => r.status === 200,
      "templates has body": (r) => r.body != null && r.body.length > 0,
    });
  });

  // -------------------------------------------------------------------------
  // POST endpoint — lower frequency write/compute traffic
  // Run every 10th iteration to approximate 10:100 POST:GET ratio
  // -------------------------------------------------------------------------

  if (__ITER % 10 === 0) {
    group("POST /api/simulate-vesting", () => {
      const res = http.post(
        `${BASE}/api/simulate-vesting`,
        SIMULATE_PAYLOAD,
        { headers: POST_HEADERS },
      );
      check(res, {
        "simulate 200 or 429": (r) => r.status === 200 || r.status === 429,
      });
    });
  }

  sleep(1);
}

/**
 * Summary handler — prints a structured report after the test run.
 * k6 calls this automatically if exported.
 */
export function handleSummary(data) {
  const metrics = data.metrics;
  const dur = metrics.http_req_duration;
  const failed = metrics.http_req_failed;

  const report = {
    timestamp: new Date().toISOString(),
    thresholds_passed: data.state.isStdErrTTY
      ? "check k6 exit code"
      : "see exit code",
    p50_ms: dur?.values?.["p(50)"]?.toFixed(2),
    p95_ms: dur?.values?.["p(95)"]?.toFixed(2),
    p99_ms: dur?.values?.["p(99)"]?.toFixed(2),
    error_rate_pct: failed?.values?.rate
      ? (failed.values.rate * 100).toFixed(2)
      : "0.00",
    total_requests: metrics.http_reqs?.values?.count,
  };

  console.log("\n=== Load Test Report ===");
  console.log(JSON.stringify(report, null, 2));

  return {
    "tests/load/last-report.json": JSON.stringify(report, null, 2),
    stdout: `\n=== Load Test Summary ===\np50=${report.p50_ms}ms  p95=${report.p95_ms}ms  p99=${report.p99_ms}ms  errors=${report.error_rate_pct}%\n`,
  };
}
