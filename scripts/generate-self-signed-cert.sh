#!/usr/bin/env bash
# Generates a self-signed TLS cert/key for the https://<IP>:<PORT> pm2 deployment (see root
# ecosystem.config.js and README's "Deployment" section). Browsers/clients will show a
# self-signed-cert warning on first visit — that's expected for an IP-address deployment with no
# real domain/CA; click through it (or install the cert locally if you want to avoid the warning).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

IP="${1:-}"
if [ -z "$IP" ] && [ -f "$ENV_FILE" ]; then
  IP="$(grep -E '^SERVER_IP=' "$ENV_FILE" | head -1 | cut -d '=' -f2- | tr -d '[:space:]"'"'"'')"
fi

if [ -z "$IP" ]; then
  echo "Usage: $0 <server-ip>   (or set SERVER_IP=... in $ENV_FILE)" >&2
  exit 1
fi

CERT_DIR="$ROOT_DIR/certs"
mkdir -p "$CERT_DIR"

# subjectAltName is required, not optional — modern clients (Chrome, most HTTP libraries) reject a
# cert that only sets CN, even for a plain IP address.
openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -subj "/CN=$IP" \
  -addext "subjectAltName=IP:$IP"

chmod 600 "$CERT_DIR/key.pem"

echo
echo "Generated self-signed certificate for $IP (valid 825 days):"
echo "  $CERT_DIR/cert.pem"
echo "  $CERT_DIR/key.pem"
echo
echo "Set these in $ENV_FILE (already the default in .env.example):"
echo "  SSL_CERT_PATH=./certs/cert.pem"
echo "  SSL_KEY_PATH=./certs/key.pem"
