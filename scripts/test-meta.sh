#!/usr/bin/env bash
# [SIG-FLD-VAL-001] Declared in posture, amplified in field.
# Meta test runner: prefers real test frameworks, falls back to lint.
set -euo pipefail

# Determine if there are any test files in the repo
HAS_TESTS=$(node -e '
  try {
    const fg = require("fast-glob");
    const patterns = [
      "**/*.{test,spec}.ts",
      "**/*.{test,spec}.tsx",
      "**/*.{test,spec}.js",
      "**/*.{test,spec}.jsx",
    ];
    const ignore = ["**/node_modules/**", "**/dist/**", "**/.git/**"]; 
    const files = fg.sync(patterns, { dot: false, ignore });
    process.exit(files.length > 0 ? 0 : 1);
  } catch (e) { process.exit(1); }
') && HAS_TESTS_EXIT=$? || HAS_TESTS_EXIT=$?

# Prefer vitest if present
if npx --yes --offline vitest --version >/dev/null 2>&1 || npx --yes vitest --version >/dev/null 2>&1; then
  if [ $HAS_TESTS_EXIT -eq 0 ]; then
    npx --yes vitest run --reporter=dot
    exit $?
  fi
fi

# Prefer jest if present
if npx --yes --offline jest --version >/dev/null 2>&1 || npx --yes jest --version >/dev/null 2>&1; then
  if [ $HAS_TESTS_EXIT -eq 0 ]; then
    npx --yes jest --ci
    exit $?
  fi
fi

# Fallback: no tests present → run lint only (do not bypass existing tests)
if [ $HAS_TESTS_EXIT -ne 0 ]; then
  echo "No test files detected; running lint as fallback." >&2
  npm run -s lint
  exit $?
fi

echo "A test runner was not detected but test files exist. Please add vitest or jest to devDependencies."
exit 1
