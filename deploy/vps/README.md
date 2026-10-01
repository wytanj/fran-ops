# fran-ops - DigitalOcean Singapore VPS deploy (Caddy + systemd)

Deploy scaffold for an always-on fran-ops bus on a DigitalOcean droplet in **`sgp1` (Singapore)**.
**Primary path:** Ubuntu 24.04 + Bun + systemd + Caddy (ACME TLS).
**Alternate note:** Fly.io region **`sin`** can be evaluated later, but the primary deployment path remains Caddy + Bun + systemd on a DigitalOcean droplet.
**Suggested size:** DigitalOcean Basic shared CPU **`s-1vcpu-2gb`** or a similar modest droplet.
**Alternate:** `docker-compose.yml` in this folder (optional; not the default for the outbox poller).

**Current fran-ops host placeholder:** `167.99.68.48` (DigitalOcean Singapore). DNS A `ops.heyfran.co` -> `167.99.68.48`. Keep bootstrap held until DNS and SSH access are confirmed.

**Canonical host:** ops.heyfran.co. The former .com host had NS issues; use .co for DNS, TLS, and Slack URLs.

**Hosting split:** Vercel is for frontends and short-lived HTTP. This droplet is for always-on `fran-ops`, `franbird`, workers, and `wacli`; do not default everything to Vercel.

> Class C merge of Slack #1 still happens after JT install. This folder is **deploy scaffold only**.
> Do not apply migrations or touch live Slack from an automated session without JT yes in his own words.

Longer walkthrough: [`docs/deploy-digitalocean-sg.md`](../../docs/deploy-digitalocean-sg.md).

## What ships here

| File | Role |
| --- | --- |
| `Caddyfile` | TLS + reverse proxy `ops.heyfran.co` -> `localhost:3000` |
| `fran-ops.service` | systemd unit: `bun start`, `EnvironmentFile=/etc/fran-ops.env`, `Restart=always`, user `franops` |
| `fran-ops.env.example` | Env template (copy to `/etc/fran-ops.env`; never commit secrets) |
| `install.sh` | Idempotent-ish installer for unit + Caddyfile + user + env template |
| `docker-compose.yml` | Optional container path |

Slack Events, slash commands, and block actions hit **`/slack/events`** on the Bolt HTTP receiver (`socketMode: false`).

## Quick path (JT)

1. Create a DigitalOcean **Droplet** in **Singapore (`sgp1`)**, using **Ubuntu 24.04**, a Basic shared CPU size such as **`s-1vcpu-2gb`** (or similar modest size), and attach your SSH key.
2. DNS: A record `ops.heyfran.co` -> `167.99.68.48` (wait for propagation).
3. SSH in, install Bun, clone fran-ops to `/opt/fran-ops`, `bun install`.
4. Install Caddy (see below), open ufw (22/80/443), copy env, run `install.sh`.
5. Fill `/etc/fran-ops.env`, `systemctl start fran-ops`, verify HTTPS, set Slack Event Subscriptions URL.

Fly.io `sin` is an alternate deployment region for later evaluation. Do not switch this bootstrap to Fly: keep the Caddy + Bun + systemd droplet path as primary.

## Firewall (ufw)

Allow SSH + HTTP/HTTPS only; deny other inbound.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Do **not** expose Postgres or Bun's `PORT` (3000) publicly - Caddy terminates TLS on 443 and proxies to localhost.

## Caddy (preferred)

```bash
# Ubuntu 24.04 - official Caddy package (check current docs if apt repo moves)
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Then either run `sudo bash deploy/vps/install.sh` from the clone, or:

```bash
sudo cp deploy/vps/Caddyfile /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Caddy obtains Let's Encrypt certs for `ops.heyfran.co` once DNS points here and ports 80/443 are open.

### nginx alternative (docs only - not shipped as default)

If you prefer nginx + certbot instead of Caddy, terminate TLS on 443 and `proxy_pass http://127.0.0.1:3000;` for `ops.heyfran.co`, including `/slack/events`. Prefer Caddy for simpler ACME on this bus.

## systemd + Bun

```bash
# After clone at /opt/fran-ops and bun on PATH:
sudo bash /opt/fran-ops/deploy/vps/install.sh
sudoedit /etc/fran-ops.env   # fill SLACK_* and DATABASE_URL
cd /opt/fran-ops && sudo -u franops bun install
sudo systemctl start fran-ops
sudo systemctl status fran-ops
journalctl -u fran-ops -f
```

Unit highlights:

- `WorkingDirectory=/opt/fran-ops`
- `EnvironmentFile=/etc/fran-ops.env`
- `ExecStart=/usr/local/bin/bun start` -> `bun src/slack.ts`
- `Restart=always`
- `User=franops`

## Env

Copy [`fran-ops.env.example`](./fran-ops.env.example) -> `/etc/fran-ops.env` (mode `640`, `root:franops`).

Required: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `DATABASE_URL`.
Default `PORT=3000`. Optional `SLACK_APP_TOKEN` (Socket Mode). Supabase placeholders for later storage work.

## Verify

```bash
curl -sI https://ops.heyfran.co/slack/events
# Expect a response from the Bolt app (not a Caddy 502). Slack URL verification needs a live signing secret.

sudo systemctl is-active fran-ops caddy
```

## Slack Event URL

In the Slack app settings (Event Subscriptions / Interactivity / Slash Commands as applicable):

- Request URL: `https://ops.heyfran.co/slack/events`

Keep signing secret in `/etc/fran-ops.env` matching the Slack app. Do not paste production tokens into git.

## Outbox note

`bun start` polls `publishPending` on an interval. systemd `Restart=always` keeps that loop alive across crashes and reboots - that is why host systemd+bun is the primary path for this bus.