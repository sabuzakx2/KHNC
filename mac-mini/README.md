# KHNC Mac mini dashboard

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
Mobile: `http://<docker-server-ip>:9082`

The Docker adapter executes retained AX53U CGI scripts over SSH directly, including approved KHNC configuration, parental-policy, maintenance, and backup requests. Device display preferences are stored on the Mac mini volume at `/opt/khnc/data`. It does not depend on router ports 8881 or 8882.

## Wired-backhaul OpenWrt access points

When Wi-Fi is provided by separate OpenWrt APs, AX53U's DHCP leases remain the device inventory but do not contain the AP association table. Set `WIFI_APS` in `config/khnc.env` to a JSON array such as:

```ini
WIFI_APS=[{"name":"WHW03-01","host":"192.168.1.2","port":2202,"user":"root","key":"/run/secrets/khnc_whw03_01_key"}]
```

For an existing Home Assistant read-only key, copy `compose.wifi-ap.example.yml` to `compose.override.yml` before starting the containers. It mounts `/opt/homeassistant/config/ssh/network_readonly_ed25519` read-only at the path in the example above. KHNC then reads only hostapd client state over SSH and merges it with AX53U data. An unreachable AP is reported in `wifiSources.failures`; it does not make the main device API fail. `WIFI_APS` may contain both WHW03 units.

If that SSH key is a forced-command key, install `openwrt/ha-network-readonly` on the AP as `/root/ha-network-readonly`. It permits only `status`, `wifi_count`, and `wifi_stations`; KHNC uses only `wifi_stations`.
