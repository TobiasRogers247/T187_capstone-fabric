#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

require_command fabric-ca-client

DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
ORG_DOMAIN="audit.${DOMAIN}"
CA_NAME="ca-audit"
CA_URL="https://localhost:8054"
CA_CERT="${ROOT_DIR}/organizations/fabric-ca/audit/ca-cert.pem"
ORG_DIR="${ROOT_DIR}/organizations/peerOrganizations/${ORG_DOMAIN}"
ORG_MSP_DIR="${ORG_DIR}/msp"
PEER_DIR="${ORG_DIR}/peers/peer0.${ORG_DOMAIN}"
ADMIN_ID="${AUDIT_ADMIN_ID:-auditAdmin}"
ADMIN_SECRET="${AUDIT_ADMIN_SECRET:-auditAdminpw}"
PEER_SECRET="${AUDIT_PEER0_SECRET:-peer0auditpw}"

require_file "${CA_CERT}"
mkdir -p "${ORG_DIR}"
export FABRIC_CA_CLIENT_HOME="${ORG_DIR}"

if ! has_signcert "${ORG_MSP_DIR}"; then
  fabric-ca-client enroll \
    -u "https://${AUDIT_CA_ADMIN_USER:-admin}:${AUDIT_CA_ADMIN_PASSWORD:-adminpw}@localhost:8054" \
    --caname "${CA_NAME}" \
    --tls.certfiles "${CA_CERT}"
  write_node_ou_config "${ORG_MSP_DIR}"
  mkdir -p "${ORG_MSP_DIR}/tlscacerts" "${ORG_DIR}/tlsca" "${ORG_DIR}/ca"
  cp "${CA_CERT}" "${ORG_MSP_DIR}/tlscacerts/ca.crt"
  cp "${CA_CERT}" "${ORG_DIR}/tlsca/tlsca.${ORG_DOMAIN}-cert.pem"
  cp "${CA_CERT}" "${ORG_DIR}/ca/ca.${ORG_DOMAIN}-cert.pem"
fi

register_identity "${CA_NAME}" "${CA_CERT}" peer0 "${PEER_SECRET}" peer
register_identity "${CA_NAME}" "${CA_CERT}" "${ADMIN_ID}" "${ADMIN_SECRET}" admin

if ! has_signcert "${PEER_DIR}/msp"; then
  fabric-ca-client enroll \
    -u "https://peer0:${PEER_SECRET}@localhost:8054" \
    --caname "${CA_NAME}" \
    -M "${PEER_DIR}/msp" \
    --tls.certfiles "${CA_CERT}"
  cp "${ORG_MSP_DIR}/config.yaml" "${PEER_DIR}/msp/config.yaml"
fi

if [[ ! -f "${PEER_DIR}/tls/server.crt" ]]; then
  fabric-ca-client enroll \
    -u "https://peer0:${PEER_SECRET}@localhost:8054" \
    --caname "${CA_NAME}" \
    -M "${PEER_DIR}/tls" \
    --enrollment.profile tls \
    --csr.hosts "peer0.${ORG_DOMAIN}" \
    --csr.hosts localhost \
    --tls.certfiles "${CA_CERT}"
  copy_tls_files "${PEER_DIR}/tls"
fi

if ! has_signcert "${ORG_DIR}/users/Admin@${ORG_DOMAIN}/msp"; then
  fabric-ca-client enroll \
    -u "https://${ADMIN_ID}:${ADMIN_SECRET}@localhost:8054" \
    --caname "${CA_NAME}" \
    -M "${ORG_DIR}/users/Admin@${ORG_DOMAIN}/msp" \
    --tls.certfiles "${CA_CERT}"
  cp "${ORG_MSP_DIR}/config.yaml" "${ORG_DIR}/users/Admin@${ORG_DOMAIN}/msp/config.yaml"
fi

echo "Audit organization enrollment complete."
