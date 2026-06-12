#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-load-test.sh — Run k6 load tests against a target environment.
#
# Usage:
#   ./tests/load/run-load-test.sh [SCRIPT] [BASE_URL]
#
# SCRIPT: api | prepare | proof | spike | all  (default: api)
# BASE_URL: target API base (default: http://localhost:3000)
#
# Examples:
#   ./tests/load/run-load-test.sh
#   ./tests/load/run-load-test.sh prepare
#   ./tests/load/run-load-test.sh proof http://localhost:3000
#   ./tests/load/run-load-test.sh all https://staging.velthoryn.vercel.app
#
# proof script also needs:
#   CAMPAIGN_ADDRESS, BENEFICIARY_ADDRESS
#
# Prerequisites:
#   - k6 installed: https://k6.io/docs/get-started/installation/
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SCRIPT_ARG="${1:-api}"
BASE_URL="${2:-http://localhost:3000}"

if [[ "${SCRIPT_ARG}" == http://* ]] || [[ "${SCRIPT_ARG}" == https://* ]]; then
  BASE_URL="${SCRIPT_ARG}"
  SCRIPT_ARG="api"
fi

K6="${K6_BIN:-k6}"
if ! command -v "${K6}" >/dev/null 2>&1; then
  if [[ -x /tmp/k6-v0.57.0-linux-amd64/k6 ]]; then
    K6=/tmp/k6-v0.57.0-linux-amd64/k6
  else
    echo "error: k6 not found (set K6_BIN or install k6)" >&2
    exit 1
  fi
fi

run_script() {
  local name="$1"
  local file="$2"
  shift 2
  echo "=== Running ${name} against ${BASE_URL} ==="
  (
    cd "${WEB_ROOT}"
    "${K6}" run --env BASE_URL="${BASE_URL}" "$@" "tests/load/${file}"
  )
  echo ""
}

case "${SCRIPT_ARG}" in
  api)
    run_script "api-load" "api-load.js"
    ;;
  prepare)
    run_script "prepare-load" "prepare-load.js"
    ;;
  proof)
    if [[ -z "${CAMPAIGN_ADDRESS:-}" || -z "${BENEFICIARY_ADDRESS:-}" ]]; then
      echo "error: proof load test requires CAMPAIGN_ADDRESS and BENEFICIARY_ADDRESS env vars" >&2
      exit 1
    fi
    run_script "proof-load" "proof-load.js" \
      --env "CAMPAIGN_ADDRESS=${CAMPAIGN_ADDRESS}" \
      --env "BENEFICIARY_ADDRESS=${BENEFICIARY_ADDRESS}"
    ;;
  spike)
    run_script "spike-load" "spike-load.js"
    ;;
  all)
    run_script "api-load" "api-load.js"
    run_script "prepare-load" "prepare-load.js"
    if [[ -n "${CAMPAIGN_ADDRESS:-}" && -n "${BENEFICIARY_ADDRESS:-}" ]]; then
      run_script "proof-load" "proof-load.js" \
        --env "CAMPAIGN_ADDRESS=${CAMPAIGN_ADDRESS}" \
        --env "BENEFICIARY_ADDRESS=${BENEFICIARY_ADDRESS}"
    else
      echo "=== Skipping proof-load (set CAMPAIGN_ADDRESS + BENEFICIARY_ADDRESS) ==="
      echo ""
    fi
    run_script "spike-load" "spike-load.js"
    echo "=== All load tests complete ==="
    for report in last-report.json last-prepare-report.json last-proof-report.json last-spike-report.json; do
      if [[ -f "${WEB_ROOT}/tests/load/${report}" ]]; then
        echo "--- ${report} ---"
        cat "${WEB_ROOT}/tests/load/${report}"
        echo ""
      fi
    done
    ;;
  *)
    echo "error: unknown script '${SCRIPT_ARG}' (use api|prepare|proof|spike|all)" >&2
    exit 1
    ;;
esac
