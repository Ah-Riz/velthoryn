#!/bin/bash
# Test runner script for clock validation improvements
# This runs the clock validation unit tests without needing the full Anchor framework

echo "Running clock validation unit tests..."

# Navigate to the tests directory
cd "$(dirname "$0")/tests/utils"

# Use ts-node to run the TypeScript test file
npx ts-node clock-validation.test.ts

echo "Clock validation tests completed."
