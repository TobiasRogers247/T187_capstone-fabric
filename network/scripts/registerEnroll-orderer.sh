#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

require_command fabric-ca-client

DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
CA_NAME="ca-orderer"
CA_CERT="${ROOT_DIR}/organizations/fabric-ca/ordererOrg/ca-cert.pem"
ORG_DIR="${ROOT_DIR}/organizations/ordererOrganizations/${DOMAIN}"
ORG_MSP_DIR="${ORG_DIR}/msp"
ORDERER_DIR="${ORG_DIR}/orderers/orderer0.${DOMAIN}"
ADMIN_ID="${ORDERER_ADMIN_ID:-ordererAdmin}"
ADMIN_SECRET="${ORDERER_ADMIN_SECRET:-ordererAdminpw}"
ORDERER_SECRET="${ORDERER0_SECRET:-orderer0pw}"

require_file "${CA_CERT}"
mkdir -p "${ORG_DIR}"
export FABRIC_CA_CLIENT_HOME="${ORG_DIR}"

if ! has_signcert "${ORG_MSP_DIR}"; then
  fabric-ca-client enroll \
    -u "https://${ORDERER_CA_ADMIN_USER:-admin}:${ORDERER_CA_ADMIN_PASSWORD:-adminpw}@localhost:9054" \
    --caname "${CA_NAME}" \
    --tls.certfiles "${CA_CERT}"
  write_node_ou_config "${ORG_MSP_DIR}"
  mkdir -p "${ORG_MSP_DIR}/tlscacerts" "${ORG_DIR}/tlsca" "${ORG_DIR}/ca"
  cp "${CA_CERT}" "${ORG_MSP_DIR}/tlscacerts/ca.crt"
  cp "${CA_CERT}" "${ORG_DIR}/tlsca/tlsca.${DOMAIN}-cert.pem"
  cp "${CA_CERT}" "${ORG_DIR}/ca/ca.${DOMAIN}-cert.pem"
fi

register_identity "${CA_NAME}" "${CA_CERT}" orderer0 "${ORDERER_SECRET}" orderer
register_identity "${CA_NAME}" "${CA_CERT}" "${ADMIN_ID}" "${ADMIN_SECRET}" admin

if ! has_signcert "${ORDERER_DIR}/msp"; then
  fabric-ca-client enroll \
    -u "https://orderer0:${ORDERER_SECRET}@localhost:9054" \
    --caname "${CA_NAME}" \
    -M "${ORDERER_DIR}/msp" \
    --tls.certfiles "${CA_CERT}"
  cp "${ORG_MSP_DIR}/config.yaml" "${ORDERER_DIR}/msp/config.yaml"
fi

if [[ ! -f "${ORDERER_DIR}/tls/server.crt" ]]; then
  fabric-ca-client enroll \
    -u "https://orderer0:${ORDERER_SECRET}@localhost:9054" \
    --caname "${CA_NAME}" \
    -M "${ORDERER_DIR}/tls" \
    --enrollment.profile tls \
    --csr.hosts "orderer0.${DOMAIN}" \
    --csr.hosts localhost \
    --tls.certfiles "${CA_CERT}"
  copy_tls_files "${ORDERER_DIR}/tls"
fi

if ! has_signcert "${ORG_DIR}/users/Admin@${DOMAIN}/msp"; then
  fabric-ca-client enroll \
    -u "https://${ADMIN_ID}:${ADMIN_SECRET}@localhost:9054" \
    --caname "${CA_NAME}" \
    -M "${ORG_DIR}/users/Admin@${DOMAIN}/msp" \
    --tls.certfiles "${CA_CERT}"
  cp "${ORG_MSP_DIR}/config.yaml" "${ORG_DIR}/users/Admin@${DOMAIN}/msp/config.yaml"
fi

if [[ ! -f "${ORG_DIR}/users/Admin@${DOMAIN}/tls/server.crt" ]]; then
  fabric-ca-client enroll \
    -u "https://${ADMIN_ID}:${ADMIN_SECRET}@localhost:9054" \
    --caname "${CA_NAME}" \
    -M "${ORG_DIR}/users/Admin@${DOMAIN}/tls" \
    --enrollment.profile tls \
    --csr.hosts localhost \
    --tls.certfiles "${CA_CERT}"
  copy_tls_files "${ORG_DIR}/users/Admin@${DOMAIN}/tls"
fi

echo "Orderer organization enrollment complete."
