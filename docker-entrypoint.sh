#!/bin/sh
set -e

CERT_DIR=/etc/nginx/certs
CERT_FILE=$CERT_DIR/server.crt
KEY_FILE=$CERT_DIR/server.key

# Generate self-signed cert if none is mounted
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "── Generating self-signed TLS certificate ──"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/CN=localhost/O=AI Conversation Investigator/C=US" 2>/dev/null
  echo "── Certificate generated ──"
fi

echo "── Starting nginx ──"
exec nginx -g "daemon off;"
