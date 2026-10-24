#!/data/data/com.termux/files/usr/bin/bash
# Builds Termux Studio Code APK entirely on-device in Termux (no Gradle).
#   aapt2 (resources) -> javac -> d8 (dex) -> zipalign -> apksigner
# Web UI is bundled with esbuild into the APK assets.
#
# Usage: ./build.sh [--install]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK_JAR="$HOME/android-sdk/android-34/android.jar"
DEPS="$HOME/codeworkspace-deps"
OUT="$HOME/codeworkspace-build"
KEYSTORE="$HOME/.codeworkspace/release.jks"
KS_PASS="codeworkspace"
APK_NAME="TermuxStudioCode.apk"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

[ -f "$SDK_JAR" ] || { echo "Missing $SDK_JAR"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"/{gen,classes,dex,assets/web}

step "Installing web dependencies"
mkdir -p "$DEPS"
if ! cmp -s "$ROOT/web/package.json" "$DEPS/package.json"; then
  cp "$ROOT/web/package.json" "$DEPS/package.json"
  (cd "$DEPS" && npm install --no-audit --no-fund)
else
  echo "up to date"
fi

step "Bundling web UI"
# esbuild cannot stat files on Android shared storage (FUSE), so bundle from a copy.
cp -r "$ROOT/web/src" "$OUT/websrc"
(cd "$OUT" && NODE_PATH="$DEPS/node_modules" esbuild ./websrc/main.js \
  --bundle --format=esm --splitting --minify --target=chrome100 \
  --outdir=assets/web --chunk-names='chunks/[name]-[hash]' \
  --legal-comments=none --log-level=warning --metafile=meta.json)
cp "$ROOT/web/index.html" "$OUT/assets/web/"
du -sh "$OUT/assets/web"

step "Compiling resources"
aapt2 compile --dir "$ROOT/android/res" -o "$OUT/res.zip"
aapt2 link -I "$SDK_JAR" --manifest "$ROOT/android/AndroidManifest.xml" \
  -A "$OUT/assets" --java "$OUT/gen" \
  -0 js -0 css -0 html \
  -o "$OUT/base.apk" "$OUT/res.zip"

step "Compiling Java"
find "$ROOT/android/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac --release 8 -Xlint:-options -encoding UTF-8 \
  -cp "$SDK_JAR" -d "$OUT/classes" @"$OUT/sources.txt"

step "Dexing"
d8 --release --min-api 27 --lib "$SDK_JAR" --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

step "Packaging"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && aapt add "$OUT/unsigned.apk" classes.dex > /dev/null)
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  step "Creating signing key"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias codeworkspace -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Roopesh, OU=Code Workspace, O=Roopesh" > /dev/null 2>&1
fi

step "Signing"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --v1-signing-enabled true --v2-signing-enabled true \
  --out "$ROOT/$APK_NAME" "$OUT/aligned.apk"
rm -f "$ROOT/$APK_NAME.idsig"
ls -lh "$ROOT/$APK_NAME"

if [ "${1:-}" = "--install" ]; then
  step "Installing"
  mkdir -p /storage/emulated/0/Download
  cp "$ROOT/$APK_NAME" "/storage/emulated/0/Download/$APK_NAME"
  termux-open "/storage/emulated/0/Download/$APK_NAME"
fi
