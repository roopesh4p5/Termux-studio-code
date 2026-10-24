#!/data/data/com.termux/files/usr/bin/bash
# Termux Studio Code — one-shot Termux setup.
#   curl -fsSL https://raw.githubusercontent.com/roopesh4p5/Termux-studio-code/dev/docs/setup.sh | bash
#
# Installs the tools the app uses from Termux (ttyd for the integrated terminal, git,
# node, python), lets the app run commands in Termux, and downloads + opens the APK.
set -euo pipefail

APK_URL="https://raw.githubusercontent.com/roopesh4p5/Termux-studio-code/dev/docs/TermuxStudioCode.apk"
DOWNLOADS="/storage/emulated/0/Download"
PROPS="$HOME/.termux/termux.properties"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

if [ -z "${PREFIX:-}" ] || [ ! -d /data/data/com.termux ]; then
  echo "Run this inside Termux (install it from F-Droid: https://f-droid.org/packages/com.termux/)" >&2
  exit 1
fi

step "Updating packages"
yes | pkg update -y
yes | pkg upgrade -y

step "Installing tools (ttyd, git, nodejs, python, openssh, curl)"
yes | pkg install -y ttyd git nodejs python openssh curl termux-tools

step "Allowing Termux Studio Code to run commands in Termux"
mkdir -p "$HOME/.termux"
touch "$PROPS"
if grep -qE '^[[:space:]]*allow-external-apps[[:space:]]*=' "$PROPS"; then
  sed -i -E 's/^[[:space:]]*allow-external-apps[[:space:]]*=.*/allow-external-apps=true/' "$PROPS"
else
  echo 'allow-external-apps=true' >> "$PROPS"
fi
termux-reload-settings || true

step "Granting Termux storage access"
if [ ! -d "$HOME/storage/shared" ]; then
  termux-setup-storage || true
  echo "Tap 'Allow' on the storage prompt. Waiting a few seconds…"
  for _ in $(seq 1 20); do [ -d "$HOME/storage/shared" ] && break; sleep 1; done
fi

if [ -n "$(git config --global user.name 2>/dev/null || true)" ]; then
  echo "git user: $(git config --global user.name)"
else
  echo "Tip: set your git identity with"
  echo "  git config --global user.name  \"Your Name\""
  echo "  git config --global user.email \"you@example.com\""
fi

step "Downloading Termux Studio Code APK"
mkdir -p "$DOWNLOADS"
curl -fL --progress-bar -o "$DOWNLOADS/TermuxStudioCode.apk" "$APK_URL"

step "Opening the installer"
termux-open "$DOWNLOADS/TermuxStudioCode.apk" || echo "Open Download/TermuxStudioCode.apk from your file manager to install."

cat <<'EOF'

Done. After installing the app:
  1. Open Termux Studio Code and allow "All files access" when asked.
  2. Open the integrated terminal (Ctrl+`) and tap "Allow" on the
     "Run commands in Termux environment" permission prompt.
  3. Keep Termux running in the background (optional: termux-wake-lock).
EOF
