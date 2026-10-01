#!/usr/bin/env bash
# Idempotent-ish host install for fran-ops on Ubuntu 24.04 DigitalOcean Singapore (`sgp1`) droplet.
# Run as root from a cloned fran-ops tree:  sudo bash deploy/vps/install.sh
# Does NOT write secrets, apply DB migrations, or touch Slack live config.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_USER="${FRANOPS_USER:-franops}"
APP_DIR="${FRANOPS_DIR:-/opt/fran-ops}"
ENV_FILE="${FRANOPS_ENV:-/etc/fran-ops.env}"
UNIT_SRC="${REPO_ROOT}/deploy/vps/fran-ops.service"
CADDY_SRC="${REPO_ROOT}/deploy/vps/Caddyfile"
CADDY_DST="/etc/caddy/Caddyfile"

echo "==> fran-ops VPS install (idempotent checks)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  echo "==> Creating user ${APP_USER}"
  useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
else
  echo "==> User ${APP_USER} already exists"
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "==> ${APP_DIR} is not a git clone."
  echo "    Clone or sync fran-ops there first, e.g.:"
  echo "      git clone https://github.com/wytanj/fran-ops.git ${APP_DIR}"
  echo "    Then re-run this script."
  exit 1
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "==> Installing env template → ${ENV_FILE} (edit secrets before start)"
  install -m 640 -o root -g "${APP_USER}" \
    "${REPO_ROOT}/deploy/vps/fran-ops.env.example" "${ENV_FILE}"
else
  echo "==> ${ENV_FILE} already present (leaving unchanged)"
fi

BUN_BIN="$(command -v bun || true)"
if [[ -z "${BUN_BIN}" ]]; then
  if [[ -x /usr/local/bin/bun ]]; then
    BUN_BIN=/usr/local/bin/bun
  elif [[ -n "${SUDO_USER:-}" && -x "/home/${SUDO_USER}/.bun/bin/bun" ]]; then
    BUN_BIN="/home/${SUDO_USER}/.bun/bin/bun"
  fi
fi
if [[ -z "${BUN_BIN}" || ! -x "${BUN_BIN}" ]]; then
  echo "bun not found on PATH. Install Bun first: https://bun.sh" >&2
  exit 1
fi
# Unit expects /usr/local/bin/bun — symlink if needed
if [[ "${BUN_BIN}" != /usr/local/bin/bun ]]; then
  ln -sfn "${BUN_BIN}" /usr/local/bin/bun
  echo "==> Symlinked ${BUN_BIN} → /usr/local/bin/bun"
fi

echo "==> Installing systemd unit"
install -m 644 "${UNIT_SRC}" /etc/systemd/system/fran-ops.service
# Patch WorkingDirectory if APP_DIR differs from unit default
if [[ "${APP_DIR}" != /opt/fran-ops ]]; then
  sed -i "s|^WorkingDirectory=.*|WorkingDirectory=${APP_DIR}|" /etc/systemd/system/fran-ops.service
fi
systemctl daemon-reload
systemctl enable fran-ops.service

if command -v caddy >/dev/null 2>&1; then
  echo "==> Installing Caddyfile → ${CADDY_DST}"
  if [[ -f "${CADDY_DST}" ]] && ! grep -q "ops.heyfran.com" "${CADDY_DST}" 2>/dev/null; then
    echo "    Existing ${CADDY_DST} has no ops.heyfran.com block."
    echo "    Backing up to ${CADDY_DST}.bak and replacing with fran-ops Caddyfile."
    cp -a "${CADDY_DST}" "${CADDY_DST}.bak"
  fi
  install -m 644 "${CADDY_SRC}" "${CADDY_DST}"
  systemctl enable --now caddy
  systemctl reload caddy || systemctl restart caddy
else
  echo "==> caddy not installed; skip Caddyfile. Install Caddy then re-run, or copy manually."
fi

echo ""
echo "Done. Next (manual):"
echo "  1. Edit secrets:  sudoedit ${ENV_FILE}"
echo "  2. DNS A record:  ops.heyfran.com → this server public IP"
echo "  3. ufw:           allow 22/80/443 (see deploy/vps/README.md)"
echo "  4. Deps:          cd ${APP_DIR} && sudo -u ${APP_USER} bun install"
echo "  5. Start:         sudo systemctl start fran-ops"
echo "  6. Verify:        curl -sI https://ops.heyfran.com/slack/events"
echo "  7. Slack Event URL → https://ops.heyfran.com/slack/events"
echo ""
echo "Note: Class C merge of Slack #1 is still after JT install; this is deploy scaffold only."
echo "Do not apply DB migrations or change live Slack from an automated session without JT yes."
