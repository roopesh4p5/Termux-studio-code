#!/data/data/com.termux/files/usr/bin/sh
# code [path] — opens a folder (default: the current one) or a file in Termux Studio Code.
# Installed into $PREFIX/bin by the app.
target=$(realpath -- "${1:-.}") || exit 1

if [ -n "$TERMUX_STUDIO" ]; then
  # Inside the app's own terminal: ask it directly with an escape sequence
  # (wrapped for tmux passthrough), since Termux is in the background there.
  if [ -n "$TMUX" ]; then
    printf '\033Ptmux;\033\033]7771;%s\007\033\\' "$target"
  else
    printf '\033]7771;%s\007' "$target"
  fi
  exit 0
fi

am start -n com.roopesh.codeworkspace/.MainActivity -a com.roopesh.codeworkspace.OPEN \
  --es path "$target" >/dev/null 2>&1 || {
  echo "code: could not start Termux Studio Code. Is it installed?" >&2
  exit 1
}
