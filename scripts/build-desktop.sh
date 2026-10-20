#!/bin/bash
# Build the desktop app entirely on the local APFS disk (exFAT corrupts large
# binaries), then copy artifacts back: PyInstaller sidecar -> electron-builder.
set -euo pipefail

PROJECT=/Volumes/whh_code/StudyForge
VENV="$HOME/.venvs/studyforge-server"
BUILD="$HOME/.studyforge/desktop-build"

rm -rf "$BUILD"
mkdir -p "$BUILD/server" "$BUILD/desktop/resources/mac" "$BUILD/desktop/resources/web-dist"

# 1) server sources (exclude runtime data)
rsync -a --exclude data --exclude __pycache__ --exclude .venv \
  "$PROJECT/server/" "$BUILD/server/"

# 2) PyInstaller sidecar（onedir：免解压，冷启动秒级；onefile 实测冷启动 ~27s）
cd "$BUILD/server"
"$VENV/bin/pip" install -q pyinstaller
"$VENV/bin/pyinstaller" --onedir --name studyforge-server --clean --noconfirm \
  --collect-all uvicorn --collect-all fastembed --collect-all onnxruntime --collect-all tokenizers \
  run.py --distpath "$BUILD/desktop/resources/mac"

# 3) web dist
cp -R "$PROJECT/web/dist/." "$BUILD/desktop/resources/web-dist/"

# 4) desktop shell sources + app icon
mkdir -p "$BUILD/desktop/build"
cp "$PROJECT/apps/desktop/main.js" "$PROJECT/apps/desktop/preload.js" \
   "$PROJECT/apps/desktop/package.json" "$BUILD/desktop/"
cp "$PROJECT/apps/desktop/build/icon.png" "$BUILD/desktop/build/icon.png"

# 5) electron-builder（ELECTRON_MIRROR：国内网络下 GitHub 直连会失败）
cd "$BUILD/desktop"
npm install --no-fund --no-audit
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npx electron-builder --mac

# 6) copy artifacts back
mkdir -p "$PROJECT/apps/desktop/release"
cp -R "$BUILD/desktop/release/." "$PROJECT/apps/desktop/release/"
echo "DESKTOP_BUILD_OK -> $PROJECT/apps/desktop/release"
