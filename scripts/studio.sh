#!/usr/bin/env bash
# Builds Kino Studio, and installs it for the current user (no sudo).
#
#   scripts/studio.sh build      check the prerequisites and build bin/kino (`make run`)
#   scripts/studio.sh install    build and install (`make install`)
#   scripts/studio.sh uninstall  remove what install put in place (`make uninstall`)
#
# Linux: the app goes to $PREFIX/bin/kino (PREFIX defaults to ~/.local), with a
# menu entry and an icon. macOS: kino.app goes to ~/Applications, plus a `kino`
# command in $PREFIX/bin.
set -euo pipefail

cd "$(dirname "$0")/.."

WAILS_VERSION=v3.0.0-beta.33
PREFIX="${PREFIX:-$HOME/.local}"
BIN="$PREFIX/bin/kino"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP="$DATA/applications/kino.desktop"
ICON="$DATA/icons/hicolor/256x256/apps/kino.png"
MAC_APP="$HOME/Applications/kino.app"
OS="$(uname -s)"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

uninstall() {
  if [ "$OS" = Darwin ]; then
    rm -rf -- "$MAC_APP"
  else
    rm -f -- "$DESKTOP" "$ICON"
    command -v update-desktop-database >/dev/null && update-desktop-database -q "$DATA/applications" || true
  fi
  rm -f -- "$BIN"
  say "Kino Studio uninstalled (your projects and settings are untouched)"
}

MODE="${1:-install}"
case "$MODE" in
  build | install) ;;
  uninstall) uninstall; exit 0 ;;
  *) fail "usage: scripts/studio.sh build|install|uninstall" ;;
esac

case "$OS" in
  Linux | Darwin) ;;
  *) fail "Kino Studio builds on Linux and macOS. On Windows, run 'make app-package' to build an installer." ;;
esac

# ---- prerequisites: explain what is missing and how to get it ----

missing=()
command -v node >/dev/null || missing+=("Node.js (https://nodejs.org)")
command -v npm >/dev/null || missing+=("npm (comes with Node.js)")
command -v go >/dev/null || missing+=("Go (https://go.dev/dl)")
if [ "$OS" = Linux ]; then
  command -v gcc >/dev/null || command -v clang >/dev/null || missing+=("a C compiler (gcc)")
  if ! command -v pkg-config >/dev/null || ! pkg-config --exists gtk+-3.0 webkit2gtk-4.1; then
    missing+=("the GTK 3 and WebKitGTK 4.1 development packages")
  fi
else
  xcode-select -p >/dev/null 2>&1 || missing+=("the Xcode command line tools (xcode-select --install)")
fi
command -v ffmpeg >/dev/null || echo "note: ffmpeg is not installed. The studio works without it; the command-line renderer needs it."

if [ ${#missing[@]} -gt 0 ]; then
  printf '\033[1;31mMissing:\033[0m\n' >&2
  printf '  - %s\n' "${missing[@]}" >&2
  if [ "$OS" = Linux ]; then
    cat >&2 <<'EOF'

On Debian/Ubuntu:  sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
On Fedora:         sudo dnf install gcc pkgconf-pkg-config gtk3-devel webkit2gtk4.1-devel
On Arch:           sudo pacman -S base-devel pkgconf gtk3 webkit2gtk-4.1
EOF
  fi
  exit 1
fi

# wails3 builds the app; install the version this repo is tested with if it's missing
export PATH="$(go env GOPATH)/bin:$PATH"
if ! command -v wails3 >/dev/null || ! wails3 version 2>&1 | grep -qxF "$WAILS_VERSION"; then
  say "Installing the Wails $WAILS_VERSION build tool"
  go install -tags gtk3 "github.com/wailsapp/wails/v3/cmd/wails3@$WAILS_VERSION"
fi

# ---- build ----

say "Installing npm packages"
npm install --no-fund --no-audit --loglevel=error

if [ "$OS" = Darwin ] && [ "$MODE" = install ]; then
  say "Building kino.app (this takes a minute the first time)"
  wails3 task package
else
  say "Building Kino Studio (this takes a minute the first time)"
  wails3 task build
fi
[ "$MODE" = build ] && exit 0

# ---- install ----

mkdir -p "$PREFIX/bin"
if [ "$OS" = Darwin ]; then
  mkdir -p "$HOME/Applications"
  rm -rf -- "$MAC_APP"
  cp -R bin/kino.app "$MAC_APP"
  ln -sf "$MAC_APP/Contents/MacOS/kino" "$BIN"
  say "Installed kino.app in ~/Applications"
else
  install -m 755 bin/kino "$BIN"
  mkdir -p "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
  if command -v magick >/dev/null; then
    magick build/appicon.png -resize 256x256 "$ICON"
  elif command -v convert >/dev/null; then
    convert build/appicon.png -resize 256x256 "$ICON"
  else
    install -m 644 build/appicon.png "$ICON"
  fi
  cat >"$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Kino Studio
Comment=Write a short text file, get an animated explainer video
Exec=$BIN %f
Icon=kino
Categories=Development;
Terminal=false
StartupWMClass=kino
EOF
  command -v update-desktop-database >/dev/null && update-desktop-database -q "$DATA/applications" || true
  say "Installed Kino Studio in $BIN, with an entry in your applications menu"
fi

case ":$PATH:" in
  *":$PREFIX/bin:"*) say "Start it from the menu, or run: kino [project folder]" ;;
  *) echo "note: $PREFIX/bin is not in your PATH; add it to run 'kino' from a terminal." ;;
esac
