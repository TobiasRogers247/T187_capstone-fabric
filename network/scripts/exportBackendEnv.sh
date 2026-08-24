#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

base64_inline() {
  base64 "$1" | tr -d '\n'
}

DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
PLATFORM_ORG_DOMAIN="platform.${DOMAIN}"
BACKEND_SERVICE_IDENTITY_NAME="${BACKEND_SERVICE_IDENTITY_NAME:-backend-service}"
BACKEND_FABRIC_PEER_ENDPOINT="${BACKEND_FABRIC_PEER_ENDPOINT:-localhost:7051}"
BACKEND_FABRIC_CA_URL="${BACKEND_FABRIC_CA_URL:-https://localhost:7054}"
BACKEND_FABRIC_CA_AFFILIATION="${BACKEND_FABRIC_CA_AFFILIATION:-org1.department1}"
BACKEND_MSP_DIR="${ROOT_DIR}/organizations/peerOrganizations/${PLATFORM_ORG_DOMAIN}/users/${BACKEND_SERVICE_IDENTITY_NAME}@${PLATFORM_ORG_DOMAIN}/msp"
BACKEND_CERT_PATH="${BACKEND_MSP_DIR}/signcerts/cert.pem"
BACKEND_KEY_DIR="${BACKEND_MSP_DIR}/keystore"
BACKEND_KEY_PATH="$(find "${BACKEND_KEY_DIR}" -maxdepth 1 -type f | head -n 1)"
PEER_TLS_CA_PATH="${ROOT_DIR}/organizations/peerOrganizations/${PLATFORM_ORG_DOMAIN}/peers/peer0.${PLATFORM_ORG_DOMAIN}/tls/ca.crt"
PLATFORM_CA_CERT_PATH="${ROOT_DIR}/organizations/fabric-ca/platform/ca-cert.pem"

require_file "${BACKEND_CERT_PATH}"
require_file "${BACKEND_KEY_PATH}"
require_file "${PEER_TLS_CA_PATH}"
require_file "${PLATFORM_CA_CERT_PATH}"

cat <<EOF
FABRIC_PEER_ENDPOINT=${BACKEND_FABRIC_PEER_ENDPOINT}
FABRIC_PEER_HOST_OVERRIDE=peer0.${PLATFORM_ORG_DOMAIN}
FABRIC_MSP_ID=${PLATFORM_ORG_MSP:-PlatformOrgMSP}
FABRIC_CHANNEL=${FABRIC_CHANNEL_NAME:-energychannel}
FABRIC_CHAINCODE=${FABRIC_CHAINCODE_NAME:-energy-market}
FABRIC_IDENTITY_NAME=${BACKEND_SERVICE_IDENTITY_NAME}
FABRIC_CLIENT_CERT_BASE64=$(base64_inline "${BACKEND_CERT_PATH}")
FABRIC_CLIENT_KEY_BASE64=$(base64_inline "${BACKEND_KEY_PATH}")
FABRIC_TLS_CA_CERT_BASE64=$(base64_inline "${PEER_TLS_CA_PATH}")
FABRIC_CA_URL=${BACKEND_FABRIC_CA_URL}
FABRIC_CA_NAME=ca-platform
FABRIC_CA_ADMIN_ID=${PLATFORM_CA_ADMIN_USER:-admin}
FABRIC_CA_ADMIN_SECRET=${PLATFORM_CA_ADMIN_PASSWORD:-adminpw}
FABRIC_CA_AFFILIATION=${BACKEND_FABRIC_CA_AFFILIATION}
FABRIC_CA_TLS_CERT_BASE64=$(base64_inline "${PLATFORM_CA_CERT_PATH}")
EOF
