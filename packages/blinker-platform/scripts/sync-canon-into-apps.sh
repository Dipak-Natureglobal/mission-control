#!/usr/bin/env bash
# sync-canon-into-apps.sh
#
# Copies canon JSONs from blinker-platform/canon/ into each child app's
# src/constants/canon/ directory. Each app's canon copy is committed to
# its own repo — explicit, no symlinks, no npm dep magic. When canon
# changes here, run this script and commit to each child repo.
#
# Usage:
#   cd ~/Documents/Claude/Projects/blinker-platform
#   ./scripts/sync-canon-into-apps.sh

set -euo pipefail

CANON_DIR="$(cd "$(dirname "$0")/../canon" && pwd)"
PROJECTS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

APPS=(
  "protection-portal"
  "insurance-portal"
  "mission-control"
  "customer-portal"
  "refi-portal"
)

if [ ! -d "$CANON_DIR" ]; then
  echo "ERROR: canon directory not found at $CANON_DIR" >&2
  exit 1
fi

VERSION="$(cat "$CANON_DIR/_version" 2>/dev/null || echo unknown)"
echo "Syncing canon version: $VERSION"
echo "Canon source: $CANON_DIR"
echo ""

for APP in "${APPS[@]}"; do
  TARGET="$PROJECTS_DIR/$APP/src/constants/canon"
  if [ ! -d "$PROJECTS_DIR/$APP" ]; then
    echo "  [skip] $APP — directory does not exist yet"
    continue
  fi
  mkdir -p "$TARGET"
  cp -v "$CANON_DIR"/*.json "$TARGET/" 2>/dev/null || true
  cp -v "$CANON_DIR/_version" "$TARGET/_version" 2>/dev/null || true
  echo "  [ok]   $APP — synced to $TARGET"
done

echo ""
echo "Done. Each child app's src/constants/canon/ now contains canon $VERSION."
echo "Remember to commit the canon updates in each child repo."
