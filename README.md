# KHNC

KHNC runs as a standalone OpenWrt service on port `8881`. LuCI remains on its existing port and document root.

## Install

Copy this repository to the router, then run:

```sh
chmod 755 install.sh uninstall.sh
./install.sh
```

Open KHNC at:

```text
http://<router-ip>:8881
```

The installer:

- installs the web root under `/usr/share/khnc/www`;
- starts a dedicated procd-managed uHTTPd instance on port `8881`;
- copies existing `/www/cgi-bin/khnc-*` scripts into the standalone service to preserve installed features;
- moves the old `/www/khnc` directory outside the LuCI web root after health verification;
- does not modify the LuCI uHTTPd configuration.

## Service management

```sh
/etc/init.d/khnc status
/etc/init.d/khnc restart
/etc/init.d/khnc stop
logread | grep -i khnc
```

## Uninstall

```sh
./uninstall.sh
```

Configuration and backups under `/etc/khnc` are preserved.

## Maintenance and SSD backup

KHNC v0.11 provides a Maintenance page for settings backup/restore, extroot SSD image backup, scheduling, history, NAS connection tests, and SHA256 verification.

SSD images are streamed directly from the router to the NAS (`dd | gzip | SHA256 | SSH/SMB`). No complete image is written to router storage. SSH mode requires key-based NAS access and `sha256sum` on both systems. SMB mode requires `smbclient` and a root-readable authentication file.

The default SSH target uses port `2202`, key `/root/.ssh/khnc_nas_key`, and remote directory `/volume1/backup/khnc`. Change these values on the Maintenance page before starting a backup.

SSD restore is intentionally not executed by KHNC. The history screen only generates a restore command. Always boot a separate recovery environment, verify the destination device, and verify SHA256 before using it.
