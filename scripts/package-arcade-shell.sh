#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
VERSION="${ARCADESHELL_VERSION:-$PACKAGE_VERSION}"
BUILD_UI="${ARCADESHELL_BUILD_UI:-1}"
BUILD_SERVICE_BUNDLE="${ARCADESHELL_BUILD_SERVICE_BUNDLE:-1}"
INCLUDE_ROMS="${ARCADESHELL_INCLUDE_ROMS:-0}"

OUT_DIR="$ROOT_DIR/dist-package/arcade-shell/${VERSION}"
RELEASE_DIR="$OUT_DIR/release"

SERVICE_DIR="$ROOT_DIR/apps/service"
SERVICE_BUNDLE_SOURCE="$SERVICE_DIR/dist/input.bundle.cjs"
SERVICE_BUNDLE="$SERVICE_DIR/input.bundle.cjs"
UINPUT_HELPER_SOURCE="$SERVICE_DIR/uinput-helper.c"
RETRO_OVERLAY_SOURCE="$SERVICE_DIR/arcade-retro-overlay.c"

UI_PUBLIC_DIR="$ROOT_DIR/apps/ui/public"
UI_VERSION_FILE="$UI_PUBLIC_DIR/arcade-shell-build.json"
UI_VERSION_FILE_BAK="$UI_VERSION_FILE.pkg.bak"
UI_DIST_DIR="$ROOT_DIR/apps/ui/dist"

OS_DIR="$ROOT_DIR/os"
DEFAULT_DIR="$ROOT_DIR/default"
UPDATER_SOURCE="$ROOT_DIR/scripts/arcade-shell-updater.mjs"
ROMS_DIR="$ROOT_DIR/roms"
RETROARCH_CORES_DIR="$ROMS_DIR/cores"
RETROARCH_NEOGEO_ZIP="$ROMS_DIR/neogeo/neogeo.zip"

RELEASE_UI_DIST_DIR="$RELEASE_DIR/apps/ui/dist"
RELEASE_SERVICE_DIR="$RELEASE_DIR/apps/service"
RELEASE_BIN_DIR="$RELEASE_DIR/apps/bin"
RELEASE_OS_DIR="$RELEASE_DIR/os"
RELEASE_DEFAULT_DIR="$RELEASE_DIR/default"
RELEASE_SCRIPTS_DIR="$RELEASE_DIR/scripts"

restore_ui_version_file() {
  if [[ -f "$UI_VERSION_FILE_BAK" ]]; then
    mv -f "$UI_VERSION_FILE_BAK" "$UI_VERSION_FILE"
  else
    rm -f "$UI_VERSION_FILE"
  fi
}

trap restore_ui_version_file EXIT

rm -rf "$OUT_DIR"
mkdir -p "$RELEASE_DIR" "$UI_PUBLIC_DIR"

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
  npm --prefix "$SERVICE_DIR" run bundle

  if [[ ! -f "$SERVICE_BUNDLE_SOURCE" ]]; then
    echo "[package-arcade-shell] failed to generate service bundle: $SERVICE_BUNDLE_SOURCE" >&2
    exit 1
  fi

  install -m 0644 "$SERVICE_BUNDLE_SOURCE" "$SERVICE_BUNDLE"
else
  echo "[package-arcade-shell] skipping service bundle build (ARCADESHELL_BUILD_SERVICE_BUNDLE=0)"
fi

if [[ ! -d "$UI_DIST_DIR" ]]; then
  echo "[package-arcade-shell] built UI dist missing: $UI_DIST_DIR" >&2
  exit 1
fi

if [[ ! -f "$UINPUT_HELPER_SOURCE" ]]; then
  echo "[package-arcade-shell] missing helper source: $UINPUT_HELPER_SOURCE" >&2
  exit 1
fi

if [[ ! -f "$RETRO_OVERLAY_SOURCE" ]]; then
  echo "[package-arcade-shell] missing overlay source: $RETRO_OVERLAY_SOURCE" >&2
  exit 1
fi

if [[ ! -d "$OS_DIR" ]]; then
  echo "[package-arcade-shell] missing os payload: $OS_DIR" >&2
  exit 1
fi

if [[ ! -d "$DEFAULT_DIR" ]]; then
  echo "[package-arcade-shell] missing default payload: $DEFAULT_DIR" >&2
  exit 1
fi

if [[ ! -f "$UPDATER_SOURCE" ]]; then
  echo "[package-arcade-shell] missing updater source: $UPDATER_SOURCE" >&2
  exit 1
fi

echo "[package-arcade-shell] staging runtime payload"

mkdir -p \
  "$RELEASE_UI_DIST_DIR" \
  "$RELEASE_SERVICE_DIR" \
  "$RELEASE_BIN_DIR" \
  "$RELEASE_OS_DIR" \
  "$RELEASE_DEFAULT_DIR" \
  "$RELEASE_SCRIPTS_DIR"

rsync -a --delete "$UI_DIST_DIR/" "$RELEASE_UI_DIST_DIR/"
install -m 0644 "$SERVICE_BUNDLE" "$RELEASE_SERVICE_DIR/input.bundle.cjs"
install -m 0644 "$UINPUT_HELPER_SOURCE" "$RELEASE_BIN_DIR/uinput-helper.c"
install -m 0644 "$RETRO_OVERLAY_SOURCE" "$RELEASE_BIN_DIR/arcade-retro-overlay.c"
rsync -a --delete \
  --exclude '.DS_Store' \
  --exclude '.env.arcade-service' \
  "$OS_DIR/" \
  "$RELEASE_OS_DIR/"
rsync -a --delete \
  --exclude '.DS_Store' \
  "$DEFAULT_DIR/" \
  "$RELEASE_DEFAULT_DIR/"
install -m 0755 "$UPDATER_SOURCE" "$RELEASE_SCRIPTS_DIR/arcade-shell-updater.mjs"

if [[ "$INCLUDE_ROMS" == "1" ]]; then
  if [[ ! -d "$ROMS_DIR" ]]; then
    echo "[package-arcade-shell] missing roms directory: $ROMS_DIR" >&2
    exit 1
  fi

  mkdir -p "$RELEASE_DIR/roms"
  rsync -a --delete --exclude '.DS_Store' "$ROMS_DIR/" "$RELEASE_DIR/roms/"
else
  if [[ -d "$RETROARCH_CORES_DIR" ]]; then
    mkdir -p "$RELEASE_DIR/roms/cores"
    rsync -a --delete --exclude '.DS_Store' "$RETROARCH_CORES_DIR/" "$RELEASE_DIR/roms/cores/"
  fi

  if [[ -f "$RETROARCH_NEOGEO_ZIP" ]]; then
    mkdir -p "$RELEASE_DIR/roms/neogeo"
    install -m 0644 "$RETROARCH_NEOGEO_ZIP" "$RELEASE_DIR/roms/neogeo/neogeo.zip"
  fi
fi

required_runtime_files=(
  "$RELEASE_UI_DIST_DIR/index.html"
  "$RELEASE_UI_DIST_DIR/arcade-shell-build.json"
  "$RELEASE_UI_DIST_DIR/retro-overlay.html"
  "$RELEASE_SERVICE_DIR/input.bundle.cjs"
  "$RELEASE_BIN_DIR/uinput-helper.c"
  "$RELEASE_BIN_DIR/arcade-retro-overlay.c"
  "$RELEASE_OS_DIR/.xinitrc"
  "$RELEASE_OS_DIR/bin/arcade-retro-launch.sh"
  "$RELEASE_OS_DIR/bin/arcade-retro-session.sh"
  "$RELEASE_OS_DIR/boot/boot.png"
  "$RELEASE_OS_DIR/boot/config.txt"
  "$RELEASE_OS_DIR/boot/cmdline.txt"
  "$RELEASE_OS_DIR/retroarch.cfg"
  "$RELEASE_OS_DIR/retroarch-single-x.cfg"
  "$RELEASE_DEFAULT_DIR/arcade-shell-updater.env.example"
  "$RELEASE_DEFAULT_DIR/arcade-watchdog.env.example"
  "$RELEASE_OS_DIR/systemd/arcade-input.service"
  "$RELEASE_OS_DIR/systemd/arcade-ui.service"
  "$RELEASE_OS_DIR/systemd/arcade-shell-updater.service"
  "$RELEASE_SCRIPTS_DIR/arcade-shell-updater.mjs"
)

for file in "${required_runtime_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "[package-arcade-shell] required runtime file missing: $file" >&2
    exit 1
  fi
done

cat <<EOF > "$RELEASE_DIR/RELEASE_METADATA.json"
{
  "version": "$VERSION",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "include_roms": $([[ "$INCLUDE_ROMS" == "1" ]] && echo true || echo false)
}
EOF

mkdir -p "$RELEASE_DIR/os"
printf "%s\n" "$VERSION" > "$RELEASE_DIR/os/.arcade-shell-version"

pushd "$RELEASE_DIR" >/dev/null
tar --no-xattrs --no-acls --no-mac-metadata -czf "$OUT_DIR/arcade-shell-${VERSION}.tar.gz" .
popd >/dev/null

echo "[package-arcade-shell] packaged version $VERSION"
echo "[package-arcade-shell] tarball: $OUT_DIR/arcade-shell-${VERSION}.tar.gz"
echo "[package-arcade-shell] service bundle: $RELEASE_SERVICE_DIR/input.bundle.cjs"
echo "[package-arcade-shell] UI dist: $RELEASE_UI_DIST_DIR"
echo "[package-arcade-shell] UI build metadata: $RELEASE_UI_DIST_DIR/arcade-shell-build.json"
