#!/bin/bash
# Build the web frontend on the local APFS disk (the exFAT volume corrupts
# large native binaries like rolldown bindings), then copy dist back.
set -euo pipefail

PROJECT=/Volumes/whh_code/StudyForge
LOCAL_BUILD_DIR="$HOME/.studyforge/web-build"

mkdir -p "$LOCAL_BUILD_DIR"
rsync -a --delete --exclude node_modules --exclude dist \
  "$PROJECT/web/" "$LOCAL_BUILD_DIR/"

cd "$LOCAL_BUILD_DIR"
npm install --no-fund --no-audit
npm run build

rm -rf "$PROJECT/web/dist"
cp -R "$LOCAL_BUILD_DIR/dist" "$PROJECT/web/dist"
echo "BUILD_OK -> $PROJECT/web/dist"
