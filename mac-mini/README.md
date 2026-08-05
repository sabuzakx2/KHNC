# KHNC Mac mini read-only dashboard

This first migration phase serves the existing KHNC desktop and mobile UI from Docker. It reads AX53U API data over SSH and never sends an OpenWrt configuration, firewall, Wi-Fi, DHCP, or parental-control command.

## `/opt/khnc` deployment

The deployed directory is intentionally aligned with the existing Docker host layout:

```
/opt/khnc/
├── backup/
├── compose.yml
├── config/
│   ├── khnc.env
│   ├── khnc_ax53u_key
│   └── known_hosts
├── data/
├── Dockerfile
├── public/
└── server.mjs
```

1. Copy these `mac-mini` files into `/opt/khnc`.
2. Create `config/khnc.env` from `config/khnc.env.example`.
3. Place the AX53U private key at `config/khnc_ax53u_key` and the AX53U host entry at `config/known_hosts`.
4. Run `sudo docker compose up -d --build` from `/opt/khnc`.
5. Open `http://<docker-server-ip>:9081`.

Desktop: `http://<docker-server-ip>:9081`
Mobile: `http://<docker-server-ip>:9081/mobile/`

This phase remains read-only. Device editing, parental-policy changes, maintenance actions, and backup actions are deliberately disabled until the router and Mac results have been compared.
