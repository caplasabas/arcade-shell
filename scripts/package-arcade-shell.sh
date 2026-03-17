#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${ARCADESHELL_VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty)}"
BUILD_UI="${ARCADESHELL_BUILD_UI:-1}"
OUT_DIR="$ROOT_DIR/dist-package/arcade-shell/${VERSION}"
RELEASE_DIR="$OUT_DIR/release"

rm -rf "$OUT_DIR"
mkdir -p "$RELEASE_DIR"

if [[ "$BUILD_UI" != "0" ]]; then
  echo "[package-arcade-shell] building UI"
  npm --prefix "$ROOT_DIR/apps/ui" run build
else
  echo "[package-arcade-shell] skipping UI build (ARCADESHELL_BUILD_UI=0)"
fi

echo "[package-arcade-shell] exporting workspace"
EXCLUDE_ARGS=(
  --exclude roms/
  --exclude backup/
  --exclude dist-package/
  --exclude .git/
)
rsync -a --delete --exclude-from="$ROOT_DIR/.rsyncignore" "${EXCLUDE_ARGS[@]}" "$ROOT_DIR/" "$RELEASE_DIR/"
rm -rf "$RELEASE_DIR/dist-package"

cat <<EOF > "$RELEASE_DIR/RELEASE_METADATA.json"
{
  "version": "$VERSION",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

pushd "$RELEASE_DIR" >/dev/null
tar -czf "$OUT_DIR/arcade-shell-${VERSION}.tar.gz" .
popd >/dev/null

echo "[package-arcade-shell] packaged version $VERSION"
echo "[package-arcade-shell] tarball: $OUT_DIR/arcade-shell-${VERSION}.tar.gz"
