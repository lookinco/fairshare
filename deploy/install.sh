#!/usr/bin/env bash
# FairShare one-shot deploy: systemd service + nginx vhost + Let's Encrypt cert.
# Idempotent — safe to re-run. Requires sudo. Run AFTER the DNS A record for
# fairshare.sweethomevacation.com → this box resolves.
set -euo pipefail

DOMAIN=fairshare.sweethomevacation.com
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> 1/4 systemd service (port 8792)"
sudo cp "$HERE/fairshare.service" /etc/systemd/system/fairshare.service
sudo systemctl daemon-reload
sudo systemctl enable --now fairshare.service
sleep 1
systemctl is-active fairshare.service
curl -fsS http://127.0.0.1:8792/api/health && echo " <- service healthy"

echo "==> 2/4 nginx vhost"
sudo cp "$HERE/fairshare.nginx.conf" /etc/nginx/sites-available/$DOMAIN
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
sudo nginx -t
sudo systemctl reload nginx

echo "==> 3/4 verify DNS points here before cert"
want=$(curl -s -4 https://api.ipify.org)
got=$(getent hosts $DOMAIN | awk '{print $1}' | head -1 || true)
echo "   this box: $want   DNS says: ${got:-<unresolved>}"
if [ "$got" != "$want" ]; then
  echo "   ⚠ DNS not resolving to this box yet (or Cloudflare-proxied). Fix DNS, re-run." >&2
  exit 2
fi

echo "==> 4/4 Let's Encrypt cert"
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos \
  -m info@sweethomevacation.com --redirect
echo "==> done — https://$DOMAIN"
