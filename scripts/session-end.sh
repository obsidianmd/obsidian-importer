#!/usr/bin/env bash
# [SIG-FLD-VAL-001] Declared in posture, amplified in field.
# End-of-coding-session ritual for obsidian-importer
# - Run all tests
# - Verify (lint + build)
# - Push topic branch
# - Create PR to main with prefilled body using gh CLI
set -euo pipefail

# Ensure gh is installed
if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install from https://cli.github.com/" >&2
  exit 1
fi

# Ensure clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes. Commit or stash before ending session." >&2
  exit 1
fi

echo "Running tests..."
npm test -- --run

# Verify project builds and lints
echo "Verifying project (lint + build)..."
npm run -s verify

# Optionally run governance checks locally if available
if [ -d "gorvernance/obsidian-importer" ] || [ -d "governance/obsidian-importer" ] || [ -n "${GOV_PATH:-}" ]; then
  echo "Running local governance checks..."
  GOV_PATH="${GOV_PATH:-gorvernance/obsidian-importer}" \
  REQUIRE_GOV=0 \
  npm run -s ci:pr || true
  GOV_PATH="${GOV_PATH:-gorvernance/obsidian-importer}" \
  REQUIRE_GOV=0 \
  npm run -s validate:links || true
  GOV_PATH="${GOV_PATH:-gorvernance/obsidian-importer}" \
  REQUIRE_GOV=0 \
  npm run -s perf:budgets || true
  GOV_PATH="${GOV_PATH:-gorvernance/obsidian-importer}" \
  REQUIRE_GOV=0 \
  npm run -s fixtures:redact || true
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "HEAD" ]; then
  echo "Detached HEAD state is not supported." >&2
  exit 1
fi
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "End-session must run on a topic branch, not on $BRANCH." >&2
  exit 1
fi

# Push branch (set upstream if needed)
if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  git push
else
  git push -u origin "$BRANCH"
fi

# Compute PR title/body
TITLE="$(git log -1 --pretty=%s)"
if [ -z "$TITLE" ]; then
  TITLE="Update: $BRANCH"
fi

tmpfile="$(mktemp)"
cat > "$tmpfile" <<'PR_BODY'
# PR Summary

- What change is introduced?
- Why is this necessary now?
- How was this tested?

## Governance

- Glyph(s) referenced:
  - `SIG-FLD-VAL-001` — Declaration Echoes Return Amplified
- Contracts impacted (list IDs):
  - e.g., `SIG-SYS-NOT-027` — Secrets & Privacy

## Downgrade Notes (if any)

If using a legacy or less-preferred path (e.g., Notion legacy DB API instead of Data Sources), explain:
- Reason for downgrade:
- Scope and duration:
- Mitigations and plan to restore alignment:

## Checklist

- [ ] New/changed source files include the glyph header on the first lines:

```ts
// [SIG-FLD-VAL-001] Declared in posture, amplified in field.
```

- [ ] Governance checks pass locally (or will pass in CI):
  - `npm run check:glyph-header`
  - `npm run ci:pr`
  - `npm run validate:links`
  - `npm run perf:budgets`
  - `npm run fixtures:redact`
PR_BODY

# Create PR using gh (pre-filled body modeled after template)
# If PR already exists, this will error; ignore with || true then print status
if ! gh pr create --base main --head "$BRANCH" --title "$TITLE" --body-file "$tmpfile"; then
  echo "PR may already exist. Showing status:" >&2
  gh pr status || true
fi

rm -f "$tmpfile"

# Show created PR URL
if gh pr view --json url >/dev/null 2>&1; then
  gh pr view --json url -q .url
fi

echo "End-of-session ritual complete. Review PR checks in GitHub."
echo "When CI is green, merge with: gh pr merge --squash --delete-branch"
