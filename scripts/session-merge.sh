#!/usr/bin/env bash
# [SIG-FLD-VAL-001] Declared in posture, amplified in field.
# Merge ritual: waits for CI on the open PR for the current branch, then merges with squash and deletes branch remotely.
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install from https://cli.github.com/" >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "HEAD" ]; then
  echo "Detached HEAD state is not supported." >&2
  exit 1
fi
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "You are on $BRANCH. Switch to your topic branch to merge its PR or pass the branch name as argument." >&2
  echo "Usage: bash scripts/session-merge.sh <topic-branch>"
fi
BRANCH="${1:-$BRANCH}"

# Ensure PR exists
if ! gh pr view --head "$BRANCH" >/dev/null 2>&1; then
  echo "No PR found for branch '$BRANCH'. Create one first (npm run session:end)." >&2
  exit 1
fi

# Wait for checks to pass
echo "Waiting for CI checks to pass on PR for '$BRANCH'..."
if ! gh pr checks --watch --fail-fast --interval 10 --required --verbose --head "$BRANCH"; then
  echo "Checks did not pass. Aborting merge." >&2
  exit 1
fi

# Merge
echo "Merging PR for '$BRANCH' with --squash --delete-branch..."
gh pr merge --squash --delete-branch --auto --subject "squash: $BRANCH" --body "Automated merge after green CI." --head "$BRANCH"

echo "Merge requested. You can verify with: gh pr view --head '$BRANCH'"
