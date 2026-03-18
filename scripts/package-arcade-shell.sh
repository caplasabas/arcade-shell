#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${ARCADESHELL_VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty)}"
BUILD_UI="${ARCADESHELL_BUILD_UI:-1}"
BUILD_SERVICE_BUNDLE="${ARCADESHELL_BUILD_SERVICE_BUNDLE:-1}"

OUT_DIR="$ROOT_DIR/dist-package/arcade-shell/${VERSION}"
RELEASE_DIR="$OUT_DIR/release"

SERVICE_DIR="$ROOT_DIR/apps/service"
SERVICE_ENTRY="$SERVICE_DIR/input.js"
SERVICE_BUNDLE="$SERVICE_DIR/input.bundle.cjs"

UI_PUBLIC_DIR="$ROOT_DIR/apps/ui/public"
UI_VERSION_FILE="$UI_PUBLIC_DIR/arcade-shell-build.json"
UI_VERSION_FILE_BAK="$UI_VERSION_FILE.pkg.bak"
UI_DIST_DIR="$ROOT_DIR/apps/ui/dist"
RELEASE_UI_DIST_DIR="$RELEASE_DIR/apps/ui/dist"

restore_ui_version_file() {
  if [[ -f "$UI_VERSION_FILE_BAK" ]]; then
    mv -f "$UI_VERSION_FILE_BAK" "$UI_VERSION_FILE"
  else
    rm -f "$UI_VERSION_FILE"
  fi
}

trap restore_ui_version_file EXIT

rm -rf "$OUT_DIR"
mkdir -p "$RELEASE_DIR"
mkdir -p "$UI_PUBLIC_DIR"

if [[ -f "$UI_VERSION_FILE" ]]; then
  cp "$UI_VERSION_FILE" "$UI_VERSION_FILE_BAK"
fi

cat <<EOF > "$UI_VERSION_FILE"
{
  "version": "$VERSION",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "[package-arcade-shell] wrote UI build metadata: $UI_VERSION_FILE"

if [[ "$BUILD_UI" != "0" ]]; then
  echo "[package-arcade-shell] building UI"
  npm --prefix "$ROOT_DIR/apps/ui" run build
else
  echo "[package-arcade-shell] skipping UI build (ARCADESHELL_BUILD_UI=0)"
fi

if [[ "$BUILD_SERVICE_BUNDLE" != "0" ]]; then
  echo "[package-arcade-shell] building service bundle"

  if [[ ! -f "$SERVICE_ENTRY" ]]; then
    echo "[package-arcade-shell] missing service entry: $SERVICE_ENTRY" >&2
    exit 1
  fi

  mkdir -p "$SERVICE_DIR"

  npx esbuild "$SERVICE_ENTRY" \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=cjs \
    --outfile="$SERVICE_BUNDLE"

  if [[ ! -f "$SERVICE_BUNDLE" ]]; then
    echo "[package-arcade-shell] failed to generate service bundle: $SERVICE_BUNDLE" >&2
    exit 1
  fi
else
  echo "[package-arcade-shell] skipping service bundle build (ARCADESHELL_BUILD_SERVICE_BUNDLE=0)"
fi

echo "[package-arcade-shell] exporting workspace"
EXCLUDE_ARGS=(
  --exclude roms/
  --exclude backup/
  --exclude dist-package/
  --exclude .git/
  --exclude node_modules/
  --exclude apps/ui/dist/
)

rsync -a --delete --exclude-from="$ROOT_DIR/.rsyncignore" "${EXCLUDE_ARGS[@]}" "$ROOT_DIR/" "$RELEASE_DIR/"
rm -rf "$RELEASE_DIR/dist-package"

if [[ ! -d "$UI_DIST_DIR" ]]; then
  echo "[package-arcade-shell] built UI dist missing: $UI_DIST_DIR" >&2
  exit 1
fi

mkdir -p "$RELEASE_UI_DIST_DIR"
rsync -a --delete "$UI_DIST_DIR/" "$RELEASE_UI_DIST_DIR/"

if [[ ! -f "$RELEASE_DIR/apps/service/input.bundle.cjs" ]]; then
  echo "[package-arcade-shell] packaged bundle missing: $RELEASE_DIR/apps/service/input.bundle.cjs" >&2
  exit 1
fi

if [[ ! -f "$RELEASE_UI_DIST_DIR/index.html" ]]; then
  echo "[package-arcade-shell] packaged UI dist missing index.html: $RELEASE_UI_DIST_DIR/index.html" >&2
  exit 1
fi

if [[ ! -f "$RELEASE_UI_DIST_DIR/arcade-shell-build.json" ]]; then
  echo "[package-arcade-shell] packaged UI build metadata missing: $RELEASE_UI_DIST_DIR/arcade-shell-build.json" >&2
  exit 1
fi

cat <<EOF > "$RELEASE_DIR/RELEASE_METADATA.json"
{
  "version": "$VERSION",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

pushd "$RELEASE_DIR" >/dev/null
tar --no-xattrs --no-acls --no-mac-metadata -czf "$OUT_DIR/arcade-shell-${VERSION}.tar.gz" .
popd >/dev/null

echo "[package-arcade-shell] packaged version $VERSION"
echo "[package-arcade-shell] tarball: $OUT_DIR/arcade-shell-${VERSION}.tar.gz"
echo "[package-arcade-shell] service bundle: $RELEASE_DIR/apps/service/input.bundle.cjs"
echo "[package-arcade-shell] UI dist: $RELEASE_UI_DIST_DIR"
echo "[package-arcade-shell] UI build metadata: $RELEASE_UI_DIST_DIR/arcade-shell-build.json"
