# KHNC Mac mini read-only dashboard

This first migration phase only reads AX53U status via SSH. It never sends an OpenWrt configuration, firewall, Wi-Fi, DHCP, or parental-control command.

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

This phase remains read-only: it runs only AX53U status commands over SSH.
