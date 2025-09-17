#!/usr/bin/env bash
# [SIG-FLD-VAL-001] Declared in posture, amplified in field.
# Meta smoke runner: ensures the project builds; extend with plugin-level smoke as needed.
set -euo pipefail

# Prefer a lightweight build if available
if npm run -s build; then
  echo "Smoke: build succeeded."
  exit 0
fi

echo "Smoke: no build script or build failed." >&2
exit 1
