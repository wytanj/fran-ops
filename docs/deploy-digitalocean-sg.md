# Deploy fran-ops on DigitalOcean Singapore (JT bootstrap)

Step-by-step for a **DigitalOcean Basic shared CPU droplet in `sgp1` (Singapore)**, using **`s-1vcpu-2gb`** or a similar modest size and **Ubuntu 24.04**.
Canonical files live under [`deploy/vps/`](../deploy/vps/README.md). This page is the narrative checklist.

**Domain:** `ops.heyfran.com`

**Current fran-ops host placeholder:** `167.99.68.48` (DigitalOcean Singapore). DNS A `ops.heyfran.com` -> `167.99.68.48`. Keep bootstrap held until DNS and SSH access are confirmed.

**Hosting split:** Vercel is for frontends and short-lived HTTP. This droplet is for always-on `fran-ops`, `franbird`, workers, and `wacli`; do not default everything to Vercel.
**App path on server:** `/opt/fran-ops`
**TLS:** Caddy (ACME) -> `localhost:3000`
**Process:** systemd `fran-ops.service` -> `bun start`
**Alternate:** Fly.io region `sin` is a later option; this checklist keeps Caddy + Bun + systemd on the DigitalOcean droplet as primary.

> Scaffold only. Class C merge of Slack #1 is still after JT install.
> Do not apply DB migrations or change live Slack from an automated kick without JT yes.

## 1. Create the droplet

1. DigitalOcean Control Panel -> **Create Droplet** -> region **Singapore (`sgp1`)**.
2. Image: **Ubuntu 24.04**.
3. Size: Basic shared CPU **`s-1vcpu-2gb`** (or a similar modest size).
4. SSH key: add JT's public key; disable password authentication if offered.
5. Note the **public IPv4**.

## 2. DNS

Create an **A record**:

| Name | Type | Value |
| --- | --- | --- |
| `ops.heyfran.com` | A | `167.99.68.48` |

Wait until `dig +short ops.heyfran.com` returns the droplet IP before relying on TLS.

## 3. First SSH + baseline packages

```bash
ssh root@<droplet-ip>
apt update && apt upgrade -y
apt install -y curl git ufw
```

## 4. Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

## 5. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
# Ensure bun is on a path install.sh can symlink to /usr/local/bin/bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
bun --version
```

## 6. Clone fran-ops

```bash
git clone https://github.com/wytanj/fran-ops.git /opt/fran-ops
cd /opt/fran-ops
# After Class C merges land on master, pull that; until then use the deploy branch as needed:
# git fetch origin && git checkout loop/vps-deploy
bun install
```

## 7. Install Caddy

Follow the Caddy apt instructions in [`deploy/vps/README.md`](../deploy/vps/README.md) (cloudsmith stable repo), or:

```bash
# After caddy package is installed:
cp /opt/fran-ops/deploy/vps/Caddyfile /etc/caddy/Caddyfile
systemctl enable --now caddy
```

## 8. systemd unit + env

```bash
cd /opt/fran-ops
bash deploy/vps/install.sh
# Edit secrets - never commit them
nano /etc/fran-ops.env
# SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, DATABASE_URL, PORT=3000
```

## 9. Start and verify

```bash
systemctl start fran-ops
systemctl status fran-ops caddy
curl -sI https://ops.heyfran.com/slack/events
journalctl -u fran-ops -n 50 --no-pager
```

Expect Caddy to serve HTTPS and proxy to the Bun process. A 502 means fran-ops is down or listening on the wrong port.

## 10. Slack app URL

Point Event Subscriptions (and Interactivity / slash command request URLs if separate) at:

```text
https://ops.heyfran.com/slack/events
```

Complete Slack's URL verification with the same signing secret as `/etc/fran-ops.env`.

## Optional: Docker Compose

See [`deploy/vps/docker-compose.yml`](../deploy/vps/docker-compose.yml). Prefer systemd+bun for this always-on outbox poller unless you already standardize on containers.

## nginx note

nginx + certbot can replace Caddy; keep it documented only - ship Caddy as default for simpler ACME.