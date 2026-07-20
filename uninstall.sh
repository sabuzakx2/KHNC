#!/bin/sh
set -eu

INIT_SCRIPT=/etc/init.d/khnc
APP_DIR=/usr/share/khnc

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

if [ -x "$INIT_SCRIPT" ]; then
  "$INIT_SCRIPT" stop || true
  "$INIT_SCRIPT" disable || true
  rm -f "$INIT_SCRIPT"
fi

rm -rf "$APP_DIR"
rm -f /usr/libexec/khnc-maintenance-worker
sed -i '/# KHNC-MAINTENANCE$/d' /etc/crontabs/root 2>/dev/null || true
echo "KHNC standalone service removed. Configuration under /etc/khnc was preserved."
