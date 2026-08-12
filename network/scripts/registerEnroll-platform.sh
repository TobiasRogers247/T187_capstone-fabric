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

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

register_identity() {
  local name="$1"
  local secret="$2"
  local type="$3"

  set +e
  local output
  output="$(
    fabric-ca-client register \
      --caname "${PLATFORM_CA_NAME}" \
      --id.name "${name}" \
      --id.secret "${secret}" \
      --id.type "${type}" \
      --tls.certfiles "${PLATFORM_CA_CERT}" 2>&1
  )"
  local status=$?
  set -e

  if [[ ${status} -ne 0 ]] && ! grep -qi "already registered" <<<"${output}"; then
    printf '%s\n' "${output}" >&2
    exit "${status}"
  fi
}

require_command fabric-ca-client

PLATFORM_CA_NAME="ca-platform"
PLATFORM_CA_URL="https://localhost:7054"
DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
PLATFORM_ORG_DOMAIN="platform.${DOMAIN}"
PLATFORM_CA_CERT="${ROOT_DIR}/organizations/fabric-ca/platform/ca-cert.pem"
PLATFORM_ORG_DIR="${ROOT_DIR}/organizations/peerOrganizations/${PLATFORM_ORG_DOMAIN}"
PLATFORM_MSP_DIR="${PLATFORM_ORG_DIR}/msp"
PLATFORM_PEER_DIR="${PLATFORM_ORG_DIR}/peers/peer0.${PLATFORM_ORG_DOMAIN}"
PLATFORM_ADMIN_ID="${PLATFORM_ADMIN_ID:-platformAdmin}"
PLATFORM_ADMIN_SECRET="${PLATFORM_ADMIN_SECRET:-platformAdminpw}"
PLATFORM_PEER0_SECRET="${PLATFORM_PEER0_SECRET:-peer0pw}"
BACKEND_SERVICE_IDENTITY_NAME="${BACKEND_SERVICE_IDENTITY_NAME:-backend-service}"
BACKEND_SERVICE_SECRET="${BACKEND_SERVICE_SECRET:-backend-service-pw}"

require_file "${PLATFORM_CA_CERT}"

rm -rf "${PLATFORM_ORG_DIR}"
mkdir -p "${PLATFORM_ORG_DIR}"
export FABRIC_CA_CLIENT_HOME="${PLATFORM_ORG_DIR}"

echo "Enrolling platform CA admin"
fabric-ca-client enroll \
  -u "https://${PLATFORM_CA_ADMIN_USER:-admin}:${PLATFORM_CA_ADMIN_PASSWORD:-adminpw}@localhost:7054" \
  --caname "${PLATFORM_CA_NAME}" \
  --tls.certfiles "${PLATFORM_CA_CERT}"

CA_CERT_FILE="$(basename "${PLATFORM_MSP_DIR}"/cacerts/*)"

cat > "${PLATFORM_MSP_DIR}/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/${CA_CERT_FILE}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/${CA_CERT_FILE}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/${CA_CERT_FILE}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/${CA_CERT_FILE}
    OrganizationalUnitIdentifier: orderer
EOF

mkdir -p "${PLATFORM_MSP_DIR}/tlscacerts" "${PLATFORM_ORG_DIR}/tlsca" "${PLATFORM_ORG_DIR}/ca"
cp "${PLATFORM_CA_CERT}" "${PLATFORM_MSP_DIR}/tlscacerts/ca.crt"
cp "${PLATFORM_CA_CERT}" "${PLATFORM_ORG_DIR}/tlsca/tlsca.${PLATFORM_ORG_DOMAIN}-cert.pem"
cp "${PLATFORM_CA_CERT}" "${PLATFORM_ORG_DIR}/ca/ca.${PLATFORM_ORG_DOMAIN}-cert.pem"

echo "Registering platform identities"
register_identity "peer0" "${PLATFORM_PEER0_SECRET}" "peer"
register_identity "${PLATFORM_ADMIN_ID}" "${PLATFORM_ADMIN_SECRET}" "admin"
register_identity "${BACKEND_SERVICE_IDENTITY_NAME}" "${BACKEND_SERVICE_SECRET}" "client"

echo "Enrolling peer0 MSP"
fabric-ca-client enroll \
  -u "https://peer0:${PLATFORM_PEER0_SECRET}@localhost:7054" \
  --caname "${PLATFORM_CA_NAME}" \
  -M "${PLATFORM_PEER_DIR}/msp" \
  --tls.certfiles "${PLATFORM_CA_CERT}"
cp "${PLATFORM_MSP_DIR}/config.yaml" "${PLATFORM_PEER_DIR}/msp/config.yaml"

echo "Enrolling peer0 TLS"
fabric-ca-client enroll \
  -u "https://peer0:${PLATFORM_PEER0_SECRET}@localhost:7054" \
  --caname "${PLATFORM_CA_NAME}" \
  -M "${PLATFORM_PEER_DIR}/tls" \
  --enrollment.profile tls \
  --csr.hosts "peer0.${PLATFORM_ORG_DOMAIN}" \
  --csr.hosts localhost \
  --tls.certfiles "${PLATFORM_CA_CERT}"

cp "${PLATFORM_PEER_DIR}/tls/tlscacerts/"* "${PLATFORM_PEER_DIR}/tls/ca.crt"
cp "${PLATFORM_PEER_DIR}/tls/signcerts/"* "${PLATFORM_PEER_DIR}/tls/server.crt"
cp "${PLATFORM_PEER_DIR}/tls/keystore/"* "${PLATFORM_PEER_DIR}/tls/server.key"
cp "${PLATFORM_PEER_DIR}/tls/tlscacerts/"* "${PLATFORM_MSP_DIR}/tlscacerts/ca.crt"

echo "Enrolling platform admin MSP"
fabric-ca-client enroll \
  -u "https://${PLATFORM_ADMIN_ID}:${PLATFORM_ADMIN_SECRET}@localhost:7054" \
  --caname "${PLATFORM_CA_NAME}" \
  -M "${PLATFORM_ORG_DIR}/users/Admin@${PLATFORM_ORG_DOMAIN}/msp" \
  --tls.certfiles "${PLATFORM_CA_CERT}"
cp "${PLATFORM_MSP_DIR}/config.yaml" "${PLATFORM_ORG_DIR}/users/Admin@${PLATFORM_ORG_DOMAIN}/msp/config.yaml"

echo "Enrolling backend-service MSP"
fabric-ca-client enroll \
  -u "https://${BACKEND_SERVICE_IDENTITY_NAME}:${BACKEND_SERVICE_SECRET}@localhost:7054" \
  --caname "${PLATFORM_CA_NAME}" \
  -M "${PLATFORM_ORG_DIR}/users/${BACKEND_SERVICE_IDENTITY_NAME}@${PLATFORM_ORG_DOMAIN}/msp" \
  --tls.certfiles "${PLATFORM_CA_CERT}"
cp "${PLATFORM_MSP_DIR}/config.yaml" "${PLATFORM_ORG_DIR}/users/${BACKEND_SERVICE_IDENTITY_NAME}@${PLATFORM_ORG_DOMAIN}/msp/config.yaml"

echo "Platform enrollment complete."
