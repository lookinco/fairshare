#!/usr/bin/env bash
# Restart the FairShare service (picks up server.mjs changes).
set -euo pipefail
sudo systemctl restart fairshare.service
sleep 1
systemctl is-active fairshare.service
curl -fsS http://127.0.0.1:8792/api/health && echo " <- healthy"
