#!/usr/bin/env bash
# [SIG-FLD-VAL-001] Declared in posture, amplified in field.
# Session start ritual: ensure work happens on a topic branch and branch exists remotely.
set -euo pipefail

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  echo "Detached HEAD state. Please checkout main to start." >&2
  exit 1
fi

if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo "You are on $CURRENT_BRANCH. Let's create a topic branch."
  read -rp "Enter topic branch name (e.g., feature/notion-datasource): " TOPIC
  if [ -z "${TOPIC}" ]; then
    echo "No branch name provided." >&2
    exit 1
  fi
  git checkout -b "$TOPIC"
  CURRENT_BRANCH="$TOPIC"
fi

echo "On branch: $CURRENT_BRANCH"

# Push upstream if not tracking
if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
  echo "Upstream already set for $CURRENT_BRANCH"
else
  echo "Setting upstream and pushing to origin..."
  git push -u origin "$CURRENT_BRANCH"
fi

echo "Session start complete. Work on '$CURRENT_BRANCH' and end with: npm run session:end"
