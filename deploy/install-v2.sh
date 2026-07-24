#!/usr/bin/env bash
# FairShare v2 one-shot deploy: npm install + next build + systemd + nginx + cert.
# Idempotent — safe to re-run. Requires sudo + npm/node on PATH.
# Run AFTER the DNS A record for fairshare2.sweethomevacation.com → this box resolves.
#
# v1 keeps running untouched on :8792 / fairshare.sweethomevacation.com.
set -euo pipefail

DOMAIN=fairshare2.sweethomevacation.com
PORT=8793
ROOT=/home/ubuntu/fairshare
WEB="$ROOT/web-v2"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> 0/5 env — Next.js loads web-v2/.env.local; symlink it to the shared ../.env.local"
if [ ! -f "$ROOT/.env.local" ]; then
  echo "   ✗ $ROOT/.env.local missing (Supabase + OpenAI secrets). Aborting." >&2
  exit 1
fi
ln -sfn "$ROOT/.env.local" "$WEB/.env.local"

echo "==> 1/5 install deps + production build"
cd "$WEB"
npm install --no-audit --no-fund
npm run build

echo "==> 2/5 systemd service (port $PORT)"
sudo cp "$HERE/fairshare-v2.service" /etc/systemd/system/fairshare-v2.service
sudo systemctl daemon-reload
sudo systemctl enable --now fairshare-v2.service
sudo systemctl restart fairshare-v2.service
sleep 2
systemctl is-active fairshare-v2.service
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo " <- service healthy"

echo "==> 3/5 nginx vhost"
sudo cp "$HERE/fairshare-v2.nginx.conf" /etc/nginx/sites-available/$DOMAIN
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
sudo nginx -t
sudo systemctl reload nginx

echo "==> 4/5 verify DNS points here before cert"
want=$(curl -s -4 https://api.ipify.org)
got=$(getent hosts $DOMAIN | awk '{print $1}' | head -1 || true)
echo "   this box: $want   DNS says: ${got:-<unresolved>}"
if [ "$got" != "$want" ]; then
  echo "   ⚠ DNS not resolving to this box yet (or Cloudflare-proxied). Fix DNS, re-run." >&2
  exit 2
fi

echo "==> 5/5 Let's Encrypt cert"
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos \
  -m info@sweethomevacation.com --redirect
echo "==> done — https://$DOMAIN"
