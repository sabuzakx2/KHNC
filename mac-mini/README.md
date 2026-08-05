# KHNC Mac mini read-only dashboard

This first migration phase only reads AX53U status via SSH. It never sends an OpenWrt configuration, firewall, Wi-Fi, DHCP, or parental-control command.

## Start

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Ensure the Mac mini can connect without a password:
   `ssh -i ~/.ssh/khnc_ax53u_key -p 2222 root@192.168.1.1 'ubus call system board'`
3. Run `docker compose up -d --build`.
4. Open `http://127.0.0.1:9081` on the Mac mini.

The Compose binding is loopback-only for this phase. It can be exposed to the LAN after the read-only result is validated against the router UI.
