#!/usr/bin/env sh
# Documented bypass for the AI Reviewer pre-commit hook.
# Usage: ./scripts/commit-skip.sh "reason for skipping review"
#
# This logs the skip to docs/review-skips.md then commits with --no-verify.
# Using raw `git commit --no-verify` also works but won't log the reason.

REASON="${1}"
if [ -z "${REASON}" ]; then
  echo "Usage: ./scripts/commit-skip.sh \"reason for skipping review\""
  exit 1
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BRANCH=$(git rev-parse --abbrev-ref HEAD)
AUTHOR=$(git config user.name)

LOG_FILE="docs/review-skips.md"

# Ensure the log file exists with a header
if [ ! -f "${LOG_FILE}" ]; then
  cat > "${LOG_FILE}" << 'EOF'
# Review Skip Log

Entries added when commits bypass the AI Reviewer (Layer 2).
Layer 1 linters still run — only AI review is skipped.

| Timestamp | Branch | Author | Reason |
|-----------|--------|--------|--------|
EOF
fi

# Append the entry
printf "| %s | %s | %s | %s |\n" \
  "${TIMESTAMP}" "${BRANCH}" "${AUTHOR}" "${REASON}" \
  >> "${LOG_FILE}"

echo "[commit-skip] Logged bypass to ${LOG_FILE}"
echo "[commit-skip] Committing with --no-verify..."

SKIP_AI_REVIEW=1 git commit --no-verify "$@"
