#!/usr/bin/env bash
#
# Deploy the refinance-prototype build to S3 + CloudFront.
#
# Usage:
#   ./scripts/deploy.sh prod       # npm run build       (MissionControl prod)
#   ./scripts/deploy.sh staging    # npm run build:stage (MissionControl dev)
#
# Optional env overrides:
#   S3_BUCKET           default: refinance-prototype
#   CLOUDFRONT_DIST_ID  default: E2QH6G2L5VCECW
#   AWS_PROFILE         AWS credentials profile to use
#   SKIP_BUILD=1        reuse existing dist/ instead of rebuilding
#
# Requires AWS perms on the target account:
#   s3:ListBucket, s3:PutObject, s3:DeleteObject  (bucket + /*)
#   cloudfront:CreateInvalidation                 (distribution)

set -euo pipefail

# --- args ------------------------------------------------------------------
MODE="${1:-}"
case "$MODE" in
  prod)    BUILD_CMD="npm run build" ;;
  staging) BUILD_CMD="npm run build:stage" ;;
  *)
    echo "Usage: $0 {prod|staging}" >&2
    exit 1
    ;;
esac

# --- config ----------------------------------------------------------------
S3_BUCKET="${S3_BUCKET:-refinance-prototype}"
CLOUDFRONT_DIST_ID="${CLOUDFRONT_DIST_ID:-E2QH6G2L5VCECW}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

cd "$ROOT_DIR"

echo "==> mode=$MODE  bucket=$S3_BUCKET  dist=$CLOUDFRONT_DIST_ID"

# --- sanity: creds ---------------------------------------------------------
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "ERROR: AWS credentials not configured / invalid." >&2
  echo "       Set AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY." >&2
  exit 1
fi

# --- build -----------------------------------------------------------------
if [ "${SKIP_BUILD:-}" = "1" ]; then
  echo "==> SKIP_BUILD=1, reusing existing dist/"
  [ -d "$DIST_DIR" ] || { echo "ERROR: dist/ not found, cannot skip build." >&2; exit 1; }
else
  echo "==> building ($BUILD_CMD)"
  $BUILD_CMD
fi

[ -f "$DIST_DIR/index.html" ] || { echo "ERROR: dist/index.html missing after build." >&2; exit 1; }

# --- sync hashed assets (long cache, immutable) ----------------------------
# Everything except the HTML entrypoints gets a content hash from Vite, so it
# is safe to cache forever. --delete prunes stale objects from prior deploys.
echo "==> syncing hashed assets"
aws s3 sync "$DIST_DIR" "s3://$S3_BUCKET" \
  --delete \
  --exclude "*.html" \
  --cache-control "public, max-age=31536000, immutable"

# --- sync HTML (no cache, must revalidate) ---------------------------------
echo "==> syncing HTML entrypoints"
aws s3 sync "$DIST_DIR" "s3://$S3_BUCKET" \
  --exclude "*" \
  --include "*.html" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"

# --- invalidate CloudFront -------------------------------------------------
echo "==> invalidating CloudFront"
INVALIDATION_ID="$(aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' --output text)"

echo "==> done. invalidation=$INVALIDATION_ID"
