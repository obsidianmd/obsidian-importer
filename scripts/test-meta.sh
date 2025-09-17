#!/usr/bin/env bash
# [SIG-FLD-VAL-001] Declared in posture, amplified in field.
# Meta test runner: prefers real test frameworks, falls back to lint.
set -euo pipefail

# Prefer vitest if present
if npx --yes --offline vitest --version >/dev/null 2>&1 || npx --yes vitest --version >/dev/null 2>&1; then
  npx --yes vitest run --reporter=dot
  exit $?
fi

# Prefer jest if present
if npx --yes --offline jest --version >/dev/null 2>&1 || npx --yes jest --version >/dev/null 2>&1; then
  npx --yes jest --ci --passWithNoTests
  exit $?
fi

# Fallback: lint only
echo "No test runner detected; running lint as fallback." >&2
npm run -s lint
