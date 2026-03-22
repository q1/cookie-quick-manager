#!/usr/bin/env bash

set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
KEY_PATH="${CERT_DIR}/fixture-key.pem"
CERT_PATH="${CERT_DIR}/fixture-cert.pem"
OPENSSL_CONFIG="${CERT_DIR}/openssl.cnf"

mkdir -p "${CERT_DIR}"

cat > "${OPENSSL_CONFIG}" <<'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = lvh.me

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = lvh.me
DNS.2 = *.lvh.me
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -days 3650 \
  -keyout "${KEY_PATH}" \
  -out "${CERT_PATH}" \
  -config "${OPENSSL_CONFIG}"

rm -f "${OPENSSL_CONFIG}"

echo "Generated fixture certificate:"
echo "  Key:  ${KEY_PATH}"
echo "  Cert: ${CERT_PATH}"
