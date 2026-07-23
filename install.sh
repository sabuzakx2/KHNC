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

mkdir -p "$APP_ROOT" "$CGI_ROOT" /etc/khnc /etc/khnc/backup-logs /usr/libexec

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

if [ -r "$SOURCE_DIR/openwrt/khnc-maintenance-worker" ]; then
  cp "$SOURCE_DIR/openwrt/khnc-maintenance-worker" /usr/libexec/khnc-maintenance-worker
  chmod 755 /usr/libexec/khnc-maintenance-worker
fi

if [ -r "$SOURCE_DIR/khnc-enforce" ]; then
  cp "$SOURCE_DIR/khnc-enforce" /usr/sbin/khnc-enforce
  chmod 755 /usr/sbin/khnc-enforce
  # One-time migration: pre-v0.11.0.9 stored a start timestamp indefinitely.
  # Reset only today's ephemeral usage counters, never saved policies.
  if [ ! -e /etc/khnc/.parental-runtime-v2 ]; then
    rm -f "/etc/khnc/runtime/$(date +%F)"/* 2>/dev/null || true
    touch /etc/khnc/.parental-runtime-v2
  fi
fi

if [ -r "$SOURCE_DIR/openwrt/khnc-parental.init" ]; then
  cp "$SOURCE_DIR/openwrt/khnc-parental.init" /etc/init.d/khnc-parental
  chmod 755 /etc/init.d/khnc-parental
  /etc/init.d/khnc-parental enable
  /etc/init.d/khnc-parental restart
fi

if [ ! -r /etc/khnc/maintenance.conf ]; then
  umask 077
  cat > /etc/khnc/maintenance.conf <<'EOF'
BACKUP_PROTOCOL='ssh'
NAS_HOST='192.168.1.10'
NAS_USER='kallos'
NAS_PORT='2202'
NAS_KEY='/root/.ssh/khnc_nas_key'
REMOTE_PATH='KHNC_Backup'
SMB_SHARE='//192.168.1.10/backup'
SMB_AUTH='/etc/khnc/smb.auth'
RETENTION='5'
SCHEDULE_ENABLED='0'
SCHEDULE_DAY='0'
SCHEDULE_TIME='03:30'
EOF
elif grep -q "^REMOTE_PATH='/volume1/backup/khnc'$" /etc/khnc/maintenance.conf; then
  # v0.11 initial builds used a path that normally requires NAS administrator
  # permission. Move the untouched default to the SSH user's writable home.
  sed -i "s|^REMOTE_PATH='/volume1/backup/khnc'$|REMOTE_PATH='KHNC_Backup'|" /etc/khnc/maintenance.conf
fi

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
