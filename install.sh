#!/bin/sh
set -eu

APP_ROOT=/usr/share/khnc/www
CGI_ROOT="$APP_ROOT/cgi-bin"
INIT_SCRIPT=/etc/init.d/khnc
LEGACY_WEB=/www/khnc
LEGACY_CGI=/www/cgi-bin
PORT=8881
SOURCE_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"

fail() { printf 'KHNC install error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run this installer as root"
[ -x /usr/sbin/uhttpd ] || fail "uhttpd is required (opkg install uhttpd)"
[ -r "$SOURCE_DIR/index.html" ] || fail "index.html not found in $SOURCE_DIR"
[ -r "$SOURCE_DIR/openwrt/khnc.init" ] || fail "openwrt/khnc.init not found"

mkdir -p "$APP_ROOT" "$CGI_ROOT" /etc/khnc

# Preserve APIs that may only exist on an already-installed router.
for API in "$LEGACY_CGI"/khnc-*; do
  [ -f "$API" ] || continue
  cp -p "$API" "$CGI_ROOT/$(basename "$API")"
done

for FILE in index.html app.js styles.css version.json infra.json; do
  [ -r "$SOURCE_DIR/$FILE" ] && cp "$SOURCE_DIR/$FILE" "$APP_ROOT/$FILE"
done

for API in "$SOURCE_DIR"/khnc-*; do
  [ -f "$API" ] || continue
  cp "$API" "$CGI_ROOT/$(basename "$API")"
done
chmod 755 "$CGI_ROOT"/khnc-* 2>/dev/null || true

cp "$SOURCE_DIR/openwrt/khnc.init" "$INIT_SCRIPT"
chmod 755 "$INIT_SCRIPT"

"$INIT_SCRIPT" enable
"$INIT_SCRIPT" restart
sleep 1

if ! wget -qO- "http://127.0.0.1:$PORT/version.json" >/dev/null 2>&1; then
  "$INIT_SCRIPT" stop || true
  fail "standalone service did not answer on port $PORT; check logread"
fi

# Remove the old /khnc URL only after the standalone service is healthy.
if [ -d "$LEGACY_WEB" ]; then
  BACKUP="/etc/khnc/legacy-web-$(date +%Y%m%d-%H%M%S)"
  mv "$LEGACY_WEB" "$BACKUP"
  printf 'Legacy /khnc files moved to %s\n' "$BACKUP"
fi

LAN_IP="$(ip -4 addr show dev br-lan 2>/dev/null | awk '/inet / {sub(/\/.*/,"",$2); print $2; exit}')"
printf 'KHNC installed successfully.\n'
printf 'Open: http://%s:%s\n' "${LAN_IP:-router-ip}" "$PORT"
printf 'LuCI remains on its existing port.\n'
